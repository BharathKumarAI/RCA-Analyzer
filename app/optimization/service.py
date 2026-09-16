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
        blob_hash = await self.blobs.put(canonical(value))
        info = {
            "description": dataset.description,
            "capability": dataset.capability,
            "train_cases": len(dataset.train),
            "holdout_cases": len(dataset.holdout),
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

    async def execute(self, request, principal):
        if not self.config.enabled:
            raise ValueError("Optimization is disabled")
        if not set(principal.roles) & AUTHOR_ROLES:
            raise PermissionError("Optimization author role required")
        dataset, dataset_hash = await self._dataset(request, principal)
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

    async def aclose(self):
        for stop in list(self.stop_events):
            stop.set()
        if self.workers:
            await asyncio.gather(*list(self.workers), return_exceptions=True)
