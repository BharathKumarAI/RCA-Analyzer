"""Scoped immutable datasets, evaluated revisions and explicit approval write-back."""

import asyncio
import json
import threading
import time
import uuid
from pathlib import Path

from app.persistence.database import scoped_engine, initialize_tables
from sqlalchemy import (
    Column,
    Float,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    and_,
    delete,
    insert,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError

from app.capabilities.resolver import CapabilityResolver
from app.configuration.service import ADMIN_ROLES, AUTHOR_ROLES
from app.connectors.providers.blob import ConfigurationBlobStore
from app.optimization.content import (
    canonical,
    digest,
    read_platform,
    replace_target,
    target_text,
)
from app.optimization.evaluation import OPTIMIZATION_LOCK, optimize
from app.optimization.models import Dataset
from app.policy.redaction import redact

metadata = MetaData(schema="optimization")
datasets = Table(
    "optimization_datasets",
    metadata,
    Column("record_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("dataset_id", String(64), nullable=False),
    Column("version", String(64), nullable=False),
    Column("blob_hash", String(128), nullable=False),
    Column("purpose", String(32), nullable=False),
    Column("metadata_json", String, nullable=False),
    Column("author_subject", String(256), nullable=False),
    Column("created_at", Float, nullable=False),
    UniqueConstraint("tenant_id", "project_id", "dataset_id", "version"),
)
revisions = Table(
    "optimization_revisions",
    metadata,
    Column("optimization_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("author_subject", String(256), nullable=False),
    Column("request_json", String, nullable=False),
    Column("dataset_hash", String(128), nullable=False),
    Column("parent_hash", String(128)),
    Column("context_hash", String(128), nullable=False),
    Column("report_hash", String(128)),
    Column("status", String(32), nullable=False),
    Column("reason", String),
    Column("created_at", Float, nullable=False),
    Column("deadline", Float, nullable=False),
    Column("reviewer_subject", String(256)),
    Column("reviewed_at", Float),
)
active = Table(
    "active_optimized_content",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("report_hash", String(128), nullable=False),
    Column("optimization_id", String(128), nullable=False),
)
changes = Table(
    "optimization_changes", metadata,
    Column("change_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("optimization_id", String(128), nullable=False),
    Column("actor_subject", String(256), nullable=False),
    Column("action", String(32), nullable=False),
    Column("previous_hash", String(128), nullable=False),
    Column("restored_hash", String(128)),
    Column("reason", String, nullable=False),
    Column("created_at", Float, nullable=False),
)


class OptimizationService:
    def __init__(
        self, engine, settings, configurations, model_factory=None, *, platform=None
    ):
        self.engine, self.settings, self.configurations = (
            scoped_engine(engine),
            settings,
            configurations,
        )
        self.model_factory = model_factory
        from app.configuration.platform import PlatformConfiguration

        platform = platform or PlatformConfiguration.load(settings)
        self.config = platform.optimization
        self.registry = platform.registry
        self.base_bundle, self.platform_hash, self.files = read_platform(
            settings, self.registry
        )
        self.blobs = ConfigurationBlobStore(
            settings.artifact_uri("optimizations"), self.config.max_blob_bytes
        )
        self.stop_events = set()
        self.workers = set()
        self.knowledge = None

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    @staticmethod
    def scope(table, principal):
        return and_(
            table.c.tenant_id == principal.tenant_id,
            table.c.project_id == principal.project_id,
        )

    def check_platform(self):
        from app.capabilities.registry import CapabilityRegistry
        registry = CapabilityRegistry(str(self.settings.content_root / "capabilities"),
            self.settings.projects_root, managed_skills=self.registry.managed_skills,
            active_skill_ids=self.registry.active_skill_ids)
        if read_platform(self.settings, registry)[1] != self.platform_hash:
            raise ValueError(
                "Platform files changed; restart before evaluating or approving content"
            )

    async def _artifact(self, content_hash):
        return json.loads(await self.blobs.get(content_hash))

    async def effective(self, principal):
        async with self.engine.connect() as connection:
            row = (
                await connection.execute(
                    select(active).where(self.scope(active, principal))
                )
            ).first()
        if row is None:
            return None
        self.check_platform()
        report = await self._artifact(row.report_hash)
        if report["platform_hash"] != self.platform_hash:
            # New trusted skills change the baseline. Stale optimized text must
            # not hide them or prevent the current capability from executing.
            return None
        return {
            "bundle": report["bundle"],
            "revision_hash": row.report_hash,
            "optimization_id": row.optimization_id,
        }

    async def _context(self, principal, capability):
        self.check_platform()
        selected = await self.effective(principal)
        bundle = selected["bundle"] if selected else self.base_bundle
        definitions = await self.configurations.approved(principal, capability)
        # Environment execution limits matter; credentials and storage locations do not enter the artifact.
        limits = {
            name: getattr(self.settings, name)
            for name in (
                "max_llm_calls",
                "max_parallel_models",
                "max_evidence_items",
                "max_evidence_chars",
                "max_context_chars",
                "run_timeout_seconds",
                "parallel_evidence",
                "default_log_window",
            )
        }
        context_hash = digest(
            {
                "platform": self.platform_hash,
                "bundle": bundle,
                "limits": limits,
                "agents": [a.model_dump(mode="json") for a in definitions],
            }
        )
        return (
            bundle,
            selected["revision_hash"] if selected else None,
            context_hash,
            definitions,
        )

    async def register_dataset(self, dataset, principal):
        if not set(principal.roles) & AUTHOR_ROLES:
            raise PermissionError("Dataset author role required")
        value = dataset.model_dump(mode="json")
        # Reject known secrets instead of changing labels or silently evaluating a different dataset.
        if redact(value, max_text=32000) != value:
            raise ValueError(
                "Remove known sensitive content or oversized fields before registering a dataset"
            )
        if self.registry.get(dataset.capability) is None:
            raise ValueError("Unknown dataset capability")
        await self.validate_corpus(dataset, principal)
        await self.validate_provenance(dataset, principal)
        blob_hash = await self.blobs.put(canonical(value))
        info = {
            "description": dataset.description,
            "capability": dataset.capability,
            "train_cases": len(dataset.train),
            "holdout_cases": len(dataset.holdout),
            "knowledge_documents": len(dataset.knowledge_corpus),
        }
        try:
            async with self.engine.begin() as connection:
                await connection.execute(
                    insert(datasets).values(
                        record_id="dataset_" + uuid.uuid4().hex,
                        tenant_id=principal.tenant_id,
                        project_id=principal.project_id,
                        dataset_id=dataset.id,
                        version=dataset.version,
                        blob_hash=blob_hash,
                        purpose=dataset.purpose,
                        metadata_json=json.dumps(info),
                        author_subject=principal.subject,
                        created_at=time.time(),
                    )
                )
        except IntegrityError:
            raise ValueError(
                "Dataset versions are immutable; submit a new version"
            ) from None
        return {
            "dataset_id": dataset.id,
            "version": dataset.version,
            "content_hash": blob_hash,
            "purpose": dataset.purpose,
            **info,
        }

    async def list_datasets(self, principal):
        async with self.engine.connect() as connection:
            rows = (
                await connection.execute(
                    select(datasets)
                    .where(self.scope(datasets, principal))
                    .order_by(datasets.c.created_at.desc())
                    .limit(100)
                )
            ).all()
        return [
            {
                "dataset_id": row.dataset_id,
                "version": row.version,
                "content_hash": row.blob_hash,
                "purpose": row.purpose,
                "created_at": row.created_at,
                "author_subject": row.author_subject,
                **json.loads(row.metadata_json),
            }
            for row in rows
        ]

    async def _dataset(self, request, principal):
        async with self.engine.connect() as connection:
            row = (
                await connection.execute(
                    select(datasets).where(
                        self.scope(datasets, principal),
                        datasets.c.dataset_id == request.dataset_id,
                        datasets.c.version == request.dataset_version,
                    )
                )
            ).first()
        if row is None:
            raise ValueError("Dataset version not found in this project")
        return Dataset.model_validate(
            await self._artifact(row.blob_hash)
        ), row.blob_hash

    async def validate_corpus(self, dataset, principal):
        if self.knowledge is not None:
            from app.configuration.knowledge import matches_associations
            from app.persistence.platform_admin import platform_knowledge
            async with self.engine.connect() as connection:
                required = (await connection.execute(select(platform_knowledge.c.doc_id, platform_knowledge.c.required_associations).where(
                    self.scope(platform_knowledge, principal), platform_knowledge.c.required_associations["required"].as_boolean().is_(True),
                ).limit(501))).mappings().all()
            if len(required) > 500:
                raise ValueError("Required knowledge catalog exceeds its review limit")
            required_ids = set()
            for case in [*dataset.train, *dataset.holdout]:
                for row in required:
                    association = row["required_associations"]
                    if dataset.capability not in association.get("capability_ids", []):
                        continue
                    if case.knowledge_scope is None and (association.get("environment_ids") or association.get("connector_instance_ids")):
                        raise ValueError("Required knowledge needs recorded environment and connector scope for every case")
                    if matches_associations({"associations": association}, dataset.capability,
                                            case.knowledge_scope.environment_ids if case.knowledge_scope else (),
                                            case.knowledge_scope.instance_ids if case.knowledge_scope else ()):
                        required_ids.add(row["doc_id"])
            if required_ids - {row["doc_id"] for row in dataset.knowledge_corpus}:
                raise ValueError("The frozen corpus must include approved required knowledge for every recorded case")
        if not dataset.knowledge_corpus:
            return
        if self.knowledge is None:
            raise ValueError("Knowledge service is unavailable")
        rows = await self.knowledge.frozen_corpus(principal, document_ids=[row["doc_id"] for row in dataset.knowledge_corpus])
        if dataset.knowledge_policy != (await self.knowledge.policy(principal)).model_dump(mode="json"):
            raise ValueError("Knowledge retrieval policy changed; curate a new dataset version")
        if canonical(sorted(rows, key=lambda row: row["doc_id"])) != canonical(sorted(dataset.knowledge_corpus, key=lambda row: row["doc_id"])):
            raise ValueError("Knowledge corpus changed or is no longer approved; curate a new dataset version")
        cases = [*dataset.train, *dataset.holdout]
        if any((row.get("associations") or {}).get(key) for row in rows for key in ("environment_ids", "connector_instance_ids")) and any(case.knowledge_scope is None for case in cases):
            raise ValueError("Associated knowledge requires recorded environment and connector scope for every case")
        if any(set(case.knowledge_document_ids) - {row["doc_id"] for row in rows} for case in cases):
            raise ValueError("The frozen corpus must include each case's explicitly selected knowledge")

    async def validate_provenance(self, dataset, principal):
        from app.optimization.improvement import ImprovementService, candidates
        recorded_families = set()
        for case in [*dataset.train, *dataset.holdout]:
            if not case.provenance:
                continue  # Explicit manually supplied datasets make no server-verification claim.
            async with self.engine.connect() as connection:
                row = (await connection.execute(select(candidates).where(self.scope(candidates, principal), candidates.c.candidate_id == case.provenance.get("candidate_id")))).mappings().first()
            if row is None or row["capability"] != dataset.capability:
                raise ValueError("Verified candidate provenance is unavailable in this scope")
            authoritative = ImprovementService.case(ImprovementService.view(row))
            if authoritative != case:
                raise ValueError("Verified candidate changed; curate a new dataset version")
            family = authoritative.incident_id or authoritative.provenance["source_run_id"]
            if family in recorded_families:
                raise ValueError("Each recorded incident may appear only once to prevent train/holdout leakage")
            recorded_families.add(family)

    async def execute(self, request, principal):
        if not self.config.enabled:
            raise ValueError("Optimization is disabled")
        if not set(principal.roles) & AUTHOR_ROLES:
            raise PermissionError("Optimization author role required")
        dataset, dataset_hash = await self._dataset(request, principal)
        await self.validate_corpus(dataset, principal)
        await self.validate_provenance(dataset, principal)
        resolved = CapabilityResolver(self.registry).resolve(
            dataset.capability, principal, check_health=False
        )
        if not resolved.is_authorized:
            raise PermissionError("Principal cannot evaluate this capability")
        for cases, minimum in [
            (dataset.train, self.config.min_train_cases),
            (dataset.holdout, self.config.min_holdout_cases),
        ]:
            if not minimum <= len(cases) <= self.config.max_cases_per_split:
                raise ValueError("Dataset split sizes do not meet configured limits")
        if (
            request.target_kind == "skill"
            and request.target_name not in resolved.capability.skills
        ):
            raise ValueError("Skill is not used by this capability")
        bundle, parent, context_hash, definitions = await self._context(
            principal, dataset.capability
        )
        try:
            original = target_text(bundle, request)
        except KeyError:
            raise ValueError("Unknown optimization target") from None
        replace_target(bundle, request, original, self.config.max_asset_chars)
        if not OPTIMIZATION_LOCK.acquire(blocking=False):
            raise OverflowError(
                "Another optimization is using this process's model budget"
            )
        stop = threading.Event()
        self.stop_events.add(stop)
        optimization_id = "opt_" + uuid.uuid4().hex
        worker = None
        try:
            async with self.engine.begin() as connection:
                await connection.execute(
                    insert(revisions).values(
                        optimization_id=optimization_id,
                        tenant_id=principal.tenant_id,
                        project_id=principal.project_id,
                        author_subject=principal.subject,
                        request_json=request.model_dump_json(),
                        dataset_hash=dataset_hash,
                        parent_hash=parent,
                        context_hash=context_hash,
                        status="RUNNING",
                        created_at=time.time(),
                        deadline=time.time() + self.config.timeout_seconds,
                    )
                )
            uri = self.settings.optimization_tracking_uri.get_secret_value()
            if uri.startswith("sqlite:///"):
                Path(uri.removeprefix("sqlite:///")).parent.mkdir(
                    parents=True, exist_ok=True
                )
            # Each project has a separate experiment; no project data enters another project's run.
            experiment = (
                "rca-optimization-"
                + digest([principal.tenant_id, principal.project_id])[7:23]
            )
            worker = asyncio.create_task(
                asyncio.to_thread(
                    optimize,
                    self.settings,
                    self.config,
                    dataset,
                    request,
                    bundle,
                    self.files,
                    principal,
                    definitions,
                    uri,
                    experiment,
                    stop,
                    self.model_factory,
                )
            )
            self.workers.add(worker)
            report = await asyncio.shield(worker)
            report.update(
                platform_hash=self.platform_hash,
                context_hash=context_hash,
                dataset_hash=dataset_hash,
                request=request.model_dump(mode="json"),
            )
            report_hash = await self.blobs.put(canonical(report))
            async with self.engine.begin() as connection:
                await connection.execute(
                    update(revisions)
                    .where(
                        revisions.c.optimization_id == optimization_id,
                        revisions.c.status == "RUNNING",
                    )
                    .values(
                        report_hash=report_hash,
                        status="PENDING_APPROVAL"
                        if report["comparison"]["eligible"]
                        else "NO_IMPROVEMENT",
                    )
                )
            return await self.get(optimization_id, principal)
        except asyncio.CancelledError:
            stop.set()
            if worker is not None:
                await asyncio.gather(worker, return_exceptions=True)
            await self._fail(optimization_id, "Cancelled; no content was activated")
            raise
        except Exception as exc:
            await self._fail(
                optimization_id, "Optimization failed: " + type(exc).__name__
            )
            return await self.get(optimization_id, principal)
        finally:
            if worker is not None:
                self.workers.discard(worker)
            self.stop_events.discard(stop)
            OPTIMIZATION_LOCK.release()

    async def _fail(self, optimization_id, reason):
        async with self.engine.begin() as connection:
            await connection.execute(
                update(revisions)
                .where(
                    revisions.c.optimization_id == optimization_id,
                    revisions.c.status == "RUNNING",
                )
                .values(status="FAILED", reason=reason)
            )

    async def get(self, optimization_id, principal, include_report=True):
        async with self.engine.begin() as connection:
            row = (
                await connection.execute(
                    select(revisions).where(
                        self.scope(revisions, principal),
                        revisions.c.optimization_id == optimization_id,
                    )
                )
            ).first()
            if row is None:
                return None
            if row.status == "RUNNING" and row.deadline < time.time():
                await connection.execute(
                    update(revisions)
                    .where(
                        revisions.c.optimization_id == optimization_id,
                        revisions.c.status == "RUNNING",
                    )
                    .values(status="FAILED", reason="Optimization deadline exceeded")
                )
                row = (
                    await connection.execute(
                        select(revisions).where(
                            revisions.c.optimization_id == optimization_id
                        )
                    )
                ).first()
        result = {
            key: getattr(row, key)
            for key in (
                "optimization_id",
                "status",
                "author_subject",
                "created_at",
                "reviewer_subject",
                "reviewed_at",
                "reason",
                "dataset_hash",
                "report_hash",
            )
        }
        result["request"] = json.loads(row.request_json)
        async with self.engine.connect() as connection:
            result["is_active"] = bool(await connection.scalar(select(active.c.optimization_id).where(self.scope(active, principal), active.c.optimization_id == optimization_id)))
            result["changes"] = [dict(item) for item in (await connection.execute(select(changes).where(self.scope(changes, principal), changes.c.optimization_id == optimization_id).order_by(changes.c.created_at.desc()).limit(100))).mappings().all()]
        if include_report and row.report_hash:
            report = await self._artifact(row.report_hash)
            result["report"] = {
                key: value
                for key, value in report.items()
                if key not in {"bundle", "baseline_bundle"}
            }
        return result

    async def list(self, principal):
        async with self.engine.connect() as connection:
            ids = (
                (
                    await connection.execute(
                        select(revisions.c.optimization_id)
                        .where(self.scope(revisions, principal))
                        .order_by(revisions.c.created_at.desc())
                        .limit(100)
                    )
                )
                .scalars()
                .all()
            )
        return [await self.get(item, principal, include_report=False) for item in ids]

    async def review(self, optimization_id, principal, expected_hash, reason, approve):
        if not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("Administrator review required")
        if not reason.strip() or len(reason) > 2000:
            raise ValueError("A bounded review reason is required")
        async with self.engine.connect() as connection:
            row = (
                await connection.execute(
                    select(revisions).where(
                        self.scope(revisions, principal),
                        revisions.c.optimization_id == optimization_id,
                    )
                )
            ).first()
        if row is None:
            return None
        if row.author_subject == principal.subject:
            raise PermissionError(
                "Authors cannot approve or reject their own revisions"
            )
        if row.status != "PENDING_APPROVAL" or row.report_hash != expected_hash:
            raise ValueError("Revision is not pending or the report hash changed")
        report = await self._artifact(row.report_hash)
        if not report["comparison"]["eligible"]:
            raise ValueError("Only passing comparisons can be approved")
        from app.optimization.models import OptimizationRequest

        request = OptimizationRequest.model_validate_json(row.request_json)
        dataset, _ = await self._dataset(request, principal)
        await self.validate_corpus(dataset, principal)
        await self.validate_provenance(dataset, principal)
        _, parent, current_context, _ = await self._context(
            principal, dataset.capability
        )
        if approve and (
            parent != row.parent_hash or current_context != row.context_hash
        ):
            raise ValueError(
                "Active content or runtime context changed; evaluate again before approval"
            )
        async with self.engine.begin() as connection:
            changed = await connection.execute(
                update(revisions)
                .where(
                    revisions.c.optimization_id == optimization_id,
                    revisions.c.status == "PENDING_APPROVAL",
                    revisions.c.report_hash == expected_hash,
                )
                .values(
                    status="APPROVED" if approve else "REJECTED",
                    reviewer_subject=principal.subject,
                    reviewed_at=time.time(),
                    reason=reason,
                )
            )
            if changed.rowcount != 1:
                raise ValueError("Another reviewer changed this revision")
            if approve:
                values = {
                    "report_hash": expected_hash,
                    "optimization_id": optimization_id,
                }
                if row.parent_hash is None:
                    try:
                        await connection.execute(
                            insert(active).values(
                                tenant_id=principal.tenant_id,
                                project_id=principal.project_id,
                                **values,
                            )
                        )
                    except IntegrityError:
                        raise ValueError(
                            "Active content changed during approval"
                        ) from None
                else:
                    updated = await connection.execute(
                        update(active)
                        .where(
                            self.scope(active, principal),
                            active.c.report_hash == row.parent_hash,
                        )
                        .values(**values)
                    )
                    if updated.rowcount != 1:
                        raise ValueError("Active content changed during approval")
        # The database is the authority for review and activation, not mutable MLflow tags.
        return await self.get(optimization_id, principal)

    async def rollback(self, optimization_id, principal, expected_hash, reason, *, revoke=False):
        """Independently reviewed, compare-and-swap restoration of recorded content."""
        if not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("Administrator review required")
        if not reason.strip() or len(reason) > 2000:
            raise ValueError("A bounded review reason is required")
        if not revoke:
            self.check_platform()
        async with self.engine.begin() as connection:
            row = (await connection.execute(select(revisions).where(self.scope(revisions, principal), revisions.c.optimization_id == optimization_id))).first()
            if row is None:
                raise LookupError("Optimization not found")
            if row.author_subject == principal.subject:
                raise PermissionError("A different administrator must review restoration")
            if row.status != "APPROVED" or row.report_hash != expected_hash:
                raise ValueError("Only the exact active approved revision can be restored")
            parent = None
            if row.parent_hash and not revoke:
                parent = (await connection.execute(select(revisions).where(self.scope(revisions, principal), revisions.c.report_hash == row.parent_hash, revisions.c.status == "APPROVED"))).first()
                if parent is None:
                    raise ValueError("The previous revision is no longer approved; revoke instead")
                report = await self._artifact(parent.report_hash)
                if report["platform_hash"] != self.platform_hash:
                    raise ValueError("Previous content is incompatible; revoke instead")
            statement = update(active).values(report_hash=parent.report_hash, optimization_id=parent.optimization_id) if parent else delete(active)
            changed = await connection.execute(statement.where(self.scope(active, principal), active.c.report_hash == expected_hash, active.c.optimization_id == optimization_id))
            if changed.rowcount != 1:
                raise ValueError("Active content changed; reload before restoration")
            await connection.execute(update(revisions).where(revisions.c.optimization_id == optimization_id).values(status="REVOKED"))
            await connection.execute(insert(changes).values(change_id="change_" + uuid.uuid4().hex, tenant_id=principal.tenant_id, project_id=principal.project_id, optimization_id=optimization_id, actor_subject=principal.subject, action="revoke" if revoke else "rollback", previous_hash=expected_hash, restored_hash=parent.report_hash if parent else None, reason=redact(reason.strip(), max_text=2000), created_at=time.time()))
        return await self.get(optimization_id, principal)

    async def aclose(self):
        for stop in list(self.stop_events):
            stop.set()
        if self.workers:
            await asyncio.gather(*list(self.workers), return_exceptions=True)
