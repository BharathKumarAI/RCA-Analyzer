"""Scoped feedback curation and a leased SQL job queue; no automatic approval."""

import asyncio
import hashlib
import json
import time
import uuid

from sqlalchemy import Boolean, Column, Float, Integer, JSON, MetaData, String, Table, UniqueConstraint, and_, cast, func, insert, literal, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.capabilities.resolver import CapabilityResolver
from app.configuration.service import AUTHOR_ROLES
from app.configuration.parameters import audit
from app.optimization.content import canonical, digest
from app.optimization.improvement_models import ImprovementJob
from app.optimization.models import Case, Dataset
from app.persistence.database import initialize_tables, scoped_engine
from app.persistence.feedback import feedback
from app.persistence.store import evidence, runs
from app.policy.redaction import redact
from app.runtime.run_contract import content_hash
from app.schemas.evidence import EvidenceBundle

metadata = MetaData(schema="optimization")


def scope_columns():
    return [Column("tenant_id", String(256), nullable=False), Column("project_id", String(256), nullable=False), Column("author_subject", String(256), nullable=False)]


jobs = Table("improvement_jobs", metadata,
    Column("job_id", String(128), primary_key=True), *scope_columns(),
    Column("payload_json", String, nullable=False), Column("fingerprint", String(128), nullable=False),
    Column("idempotency_key", String(128)), Column("status", String(32), nullable=False),
    Column("attempts", Integer, nullable=False), Column("cancel_requested", Boolean, nullable=False),
    Column("lease_owner", String(128)), Column("lease_until", Float),
    Column("result_json", String), Column("error", String),
    Column("created_at", Float, nullable=False), Column("updated_at", Float, nullable=False),
    UniqueConstraint("tenant_id", "project_id", "author_subject", "idempotency_key"))
schedules = Table("improvement_schedules", metadata,
    Column("schedule_id", String(128), primary_key=True), *scope_columns(),
    Column("name", String(128), nullable=False), Column("payload_json", String, nullable=False),
    Column("interval_seconds", Integer, nullable=False), Column("enabled", Boolean, nullable=False),
    Column("revision", Integer, nullable=False), Column("next_run_at", Float, nullable=False),
    Column("created_at", Float, nullable=False), Column("updated_at", Float, nullable=False))
candidates = Table("improvement_candidates", metadata,
    Column("candidate_id", String(128), primary_key=True), *scope_columns(),
    Column("source_key", String(256), nullable=False), Column("source_run_id", String(128), nullable=False),
    Column("source_subject", String(256), nullable=False), Column("capability", String(64), nullable=False),
    Column("status", String(32), nullable=False), Column("revision", Integer, nullable=False),
    Column("payload_json", String, nullable=False), Column("verified_json", String),
    Column("verifier_subject", String(256)), Column("reason", String),
    Column("created_at", Float, nullable=False), Column("updated_at", Float, nullable=False),
    UniqueConstraint("tenant_id", "project_id", "source_key"))


class ImprovementService:
    # Leases fence completion, not model calls: interrupted evaluations may be repeated,
    # but evaluation never activates content and stale attempts cannot finish a job.
    lease_seconds = 60
    max_attempts = 3

    def __init__(self, engine, optimizations, knowledge, store, *, resolve_context=None, runner=None, max_capture_text_chars=None):
        self.engine = scoped_engine(engine)
        self.optimizations, self.knowledge, self.store = optimizations, knowledge, store
        self.resolve_context = resolve_context
        self.runner, self.max_capture_text_chars = runner, max_capture_text_chars
        self.optimizations.knowledge = knowledge
        self.worker = None
        self.current = None
        self.closed = False
        self.worker_id = uuid.uuid4().hex

    async def initialize(self):
        await initialize_tables(self.engine, metadata)
        from app.optimization.closure_tracking import ClosureTrackingService
        await ClosureTrackingService(self).initialize()

    @staticmethod
    def scope(table, principal):
        return and_(table.c.tenant_id == principal.tenant_id, table.c.project_id == principal.project_id)

    @staticmethod
    def author(principal):
        if not set(principal.roles) & AUTHOR_ROLES:
            raise PermissionError("Project administrator permission required")

    @staticmethod
    def view(row):
        result = dict(row)
        for field, name in (("payload_json", "payload"), ("result_json", "result"), ("verified_json", "verification")):
            if field in result:
                value = result.pop(field)
                result[name] = json.loads(value) if value else None
        result.pop("lease_owner", None)
        result.pop("idempotency_key", None)
        return result

    async def list(self, table, principal, limit=100):
        self.author(principal)
        if table is candidates:
            # The browser requests a single full snapshot when it opens a candidate.
            # Do not hydrate up to 100 large evidence bundles for every list refresh.
            incident = func.json_extract(table.c.payload_json, "$.incident_id") if self.engine.dialect.name == "sqlite" else cast(table.c.payload_json, JSON)["incident_id"].as_string()
            statement = select(*[column for column in table.c if column.name not in {"payload_json", "verified_json"}], incident.label("incident_id"))
        else:
            statement = select(table)
        async with self.engine.connect() as connection:
            rows = (await connection.execute(statement.where(self.scope(table, principal)).order_by(table.c.created_at.desc()).limit(limit))).mappings().all()
        return [self.view(row) for row in rows]

    async def get(self, table, identifier, principal):
        self.author(principal)
        async with self.engine.connect() as connection:
            row = (await connection.execute(select(table).where(self.scope(table, principal), list(table.primary_key)[0] == identifier))).mappings().first()
        if row is None:
            raise LookupError("Improvement record not found")
        result = self.view(row)
        async with self.engine.connect() as connection:
            result["history"] = [dict(item) for item in (await connection.execute(select(audit).where(audit.c.tenant_id == principal.tenant_id, audit.c.project_id == principal.project_id, audit.c.tool == "improvement", audit.c.variable_name == identifier[-64:]).order_by(audit.c.event_id.desc()).limit(100))).mappings().all()]
        return result

    async def _audit(self, connection, row, action, details=None, actor=None):
        identifier = row.get("job_id") or row.get("candidate_id") or row.get("schedule_id")
        await connection.execute(insert(audit).values(tenant_id=row["tenant_id"], project_id=row["project_id"], tool="improvement", variable_name=identifier[-64:], actor_subject=actor or "worker:" + self.worker_id, action=action, revision=row.get("revision", row.get("attempts", 0)), details={"record_id": identifier, **redact(details or {}, max_text=32000)}, created_at=time.time()))

    async def enqueue(self, payload, principal, key=None):
        self.author(principal)
        if key is not None and (not key.strip() or len(key) > 128):
            raise ValueError("Invalid idempotency key")
        value = payload.model_dump(mode="json")
        if payload.kind == "optimize":
            await self.optimizations._dataset(payload.optimization, principal)
        elif payload.kind == "capture_knowledge":
            from app.optimization.knowledge_capture import KnowledgeCaptureService
            await KnowledgeCaptureService(self).validate(payload.capture, principal)
        elif payload.capability:
            resolved = CapabilityResolver(self.optimizations.registry).resolve(payload.capability, principal, check_health=False)
            if not resolved.is_authorized:
                raise PermissionError("Capability is unavailable")
        fingerprint = digest(value)
        identifier, now = "job_" + uuid.uuid4().hex, time.time()
        try:
            async with self.engine.begin() as connection:
                await connection.execute(insert(jobs).values(job_id=identifier, tenant_id=principal.tenant_id, project_id=principal.project_id, author_subject=principal.subject, payload_json=json.dumps(value), fingerprint=fingerprint, idempotency_key=key, status="QUEUED", attempts=0, cancel_requested=False, created_at=now, updated_at=now))
        except IntegrityError:
            if key is None:
                raise
            async with self.engine.connect() as connection:
                row = (await connection.execute(select(jobs).where(self.scope(jobs, principal), jobs.c.author_subject == principal.subject, jobs.c.idempotency_key == key))).mappings().first()
            if row is None or row["fingerprint"] != fingerprint:
                raise ValueError("Idempotency key is already bound to another request") from None
            return self.view(row)
        return await self.get(jobs, identifier, principal)

    async def control(self, job_id, principal, *, retry=False):
        self.author(principal)
        async with self.engine.begin() as connection:
            row = (await connection.execute(select(jobs).where(self.scope(jobs, principal), jobs.c.job_id == job_id))).mappings().first()
            if row is None:
                raise LookupError("Job not found")
            if retry:
                if row["status"] not in {"FAILED", "CANCELLED"}:
                    raise ValueError("Only failed or cancelled jobs can be retried")
                # Retrying is a new bounded budget, with the same immutable request.
                values = dict(status="QUEUED", cancel_requested=False, attempts=0, error=None, result_json=row["result_json"] if json.loads(row["payload_json"])["kind"] in {"capture_knowledge", "track_closures"} else None, lease_owner=None, lease_until=None)
            elif row["status"] in {"QUEUED", "RUNNING"}:
                values = dict(cancel_requested=True, status="CANCELLED" if row["status"] == "QUEUED" else "RUNNING")
            else:
                return self.view(row)
            conditions = [jobs.c.job_id == job_id, jobs.c.status == row["status"]]
            if retry:
                conditions.append(jobs.c.updated_at == row["updated_at"])
            changed = await connection.execute(update(jobs).where(*conditions).values(**values, updated_at=time.time()))
            if changed.rowcount != 1:
                raise ValueError("Job changed; reload before controlling it")
            await self._audit(connection, row, "retry" if retry else "cancel", actor=principal.subject)
        return await self.get(jobs, job_id, principal)

    async def save_schedule(self, payload, principal, schedule_id=None):
        self.author(principal)
        if payload.job.kind == "capture_knowledge":
            from app.optimization.knowledge_capture import KnowledgeCaptureService
            await KnowledgeCaptureService(self).validate(payload.job.capture, principal)
        now = time.time()
        values = dict(name=payload.name.strip(), payload_json=payload.job.model_dump_json(), interval_seconds=payload.interval_seconds, enabled=payload.enabled, next_run_at=now + payload.interval_seconds, updated_at=now)
        if not values["name"]:
            raise ValueError("Schedule name is required")
        async with self.engine.begin() as connection:
            if schedule_id:
                changed = await connection.execute(update(schedules).where(self.scope(schedules, principal), schedules.c.schedule_id == schedule_id, schedules.c.revision == payload.expected_revision).values(**values, revision=schedules.c.revision + 1, author_subject=principal.subject))
                if changed.rowcount != 1:
                    raise ValueError("Schedule changed or was not found")
            else:
                schedule_id = "schedule_" + uuid.uuid4().hex
                await connection.execute(insert(schedules).values(schedule_id=schedule_id, tenant_id=principal.tenant_id, project_id=principal.project_id, author_subject=principal.subject, revision=1, created_at=now, **values))
        return await self.get(schedules, schedule_id, principal)

    async def prepare(self, payload, principal, *, after_source_key=None, before=None):
        """Freeze recorded operational evidence. Ratings are signals, never labels."""
        self.author(principal)
        from app.persistence.triage import investigation_events
        source_key = literal("run:") + feedback.c.run_id + literal(":") + cast(feedback.c.revision, String)
        run_capability = func.json_extract(runs.c.contract_json, "$.capability") if self.engine.dialect.name == "sqlite" else cast(runs.c.contract_json, JSON)["capability"].as_string()
        paged = before is not None or after_source_key is not None
        vote_scope, calibration_scope = [], []
        if after_source_key:
            vote_scope.append(source_key > after_source_key)
            calibration_scope.append(investigation_events.c.event_id > after_source_key)
        if before is not None:
            vote_scope.append(feedback.c.updated_at <= before)
            calibration_scope.append(investigation_events.c.occurred_at <= before)
        if payload.capability:
            vote_scope += [select(runs.c.run_id).where(self.scope(runs, principal), runs.c.run_id == feedback.c.run_id, run_capability == payload.capability).exists()]
            calibration_scope += [select(runs.c.run_id).where(self.scope(runs, principal), runs.c.run_id == investigation_events.c.payload["source_run_id"].as_string(), run_capability == payload.capability).exists()]
        async with self.engine.connect() as connection:
            known = select(candidates.c.source_key).where(self.scope(candidates, principal)).union(select(audit.c.details["source_key"].as_string()).where(audit.c.tenant_id == principal.tenant_id, audit.c.project_id == principal.project_id, audit.c.tool == "improvement", audit.c.action == "skip_source"))
            votes = (await connection.execute(select(feedback).where(self.scope(feedback, principal), source_key.not_in(known), *vote_scope).order_by(source_key if paged else feedback.c.updated_at).limit(payload.limit + 1))).mappings().all()
            calibration = (await connection.execute(select(investigation_events).where(self.scope(investigation_events, principal), investigation_events.c.event_type == "SRE_CALIBRATION_FEEDBACK", investigation_events.c.event_id.not_in(known), *calibration_scope).order_by(investigation_events.c.event_id if paged else investigation_events.c.occurred_at).limit(payload.limit + 1))).mappings().all()
        signals = [(f"run:{row['run_id']}:{row['revision']}", row["run_id"], dict(row)) for row in votes]
        signals += [(row["event_id"], (row["payload"] or {}).get("source_run_id"), dict(row["payload"] or {})) for row in calibration]
        if paged:
            signals.sort(key=lambda item: item[0])
        more = len(signals) > payload.limit
        created, skipped = [], []
        unauthorized = 0

        async def skip(source, reason):
            skipped.append({"source_key": source, "reason": reason})
            async with self.engine.begin() as connection:
                await self._audit(connection, {"job_id": source, "tenant_id": principal.tenant_id, "project_id": principal.project_id}, "skip_source", {"source_key": source, "reason": reason})

        for source, run_id, signal in signals[:payload.limit]:
            if not run_id:
                await skip(source, "No recorded investigation provenance")
                continue
            async with self.engine.connect() as connection:
                run = (await connection.execute(select(runs).where(self.scope(runs, principal), runs.c.run_id == run_id))).mappings().first()
                recorded = (await connection.execute(select(evidence).where(self.scope(evidence, principal), evidence.c.run_id == run_id).limit(101))).mappings().all()
            if run is None:
                await skip(source, "Investigation unavailable")
                continue
            contract = json.loads(run["contract_json"])
            if content_hash(contract) != run["snapshot_hash"]:
                await skip(source, "Investigation snapshot integrity check failed")
                continue
            if payload.capability and contract["capability"] != payload.capability:
                continue
            if contract["mode"] != "live" or run["status"] not in {"SUCCEEDED", "PARTIAL"} or len(recorded) > 100:
                await skip(source, "Requires a completed live investigation within evidence bounds")
                continue
            resolved = CapabilityResolver(self.optimizations.registry).resolve(contract["capability"], principal, check_health=False)
            if not resolved.is_authorized:
                unauthorized += 1
                continue
            bundles = [EvidenceBundle.model_validate_json(item["bundle_json"]).model_dump(mode="json") for item in recorded]
            if any(bundle["content_hash"] != item["content_hash"] or content_hash(json.loads(bundle["content_json"])) != bundle["content_hash"] or (bundle["tenant_id"], bundle["project_id"], bundle["run_id"]) != (principal.tenant_id, principal.project_id, run_id) for bundle, item in zip(bundles, recorded, strict=True)):
                await skip(source, "Recorded evidence integrity check failed")
                continue
            snapshot = json.loads(contract.get("model_config_json") or "{}")
            data = {"prompt": contract["request"]["text"], "incident_id": contract["request"].get("incident_id"), "signal": signal, "recorded_result": json.loads(run["result_json"]) if run["result_json"] else None, "evidence": bundles, "run_snapshot_hash": run["snapshot_hash"], "source_created_at": run["created_at"], "knowledge_scope": snapshot.get("knowledge_scope"), "knowledge_document_ids": contract["request"].get("knowledge_document_ids", [])}
            data = redact(data, max_text=32000)
            if len(canonical(data)) > self.optimizations.config.max_blob_bytes:
                await skip(source, "Recorded evidence exceeds curation budget")
                continue
            candidate_id = "candidate_" + hashlib.sha256(f"{principal.tenant_id}:{principal.project_id}:{source}".encode()).hexdigest()
            now = time.time()
            try:
                async with self.engine.begin() as connection:
                    await connection.execute(insert(candidates).values(candidate_id=candidate_id, tenant_id=principal.tenant_id, project_id=principal.project_id, author_subject=principal.subject, source_key=source, source_run_id=run_id, source_subject=run["subject"], capability=contract["capability"], status="NEEDS_REVIEW", revision=1, payload_json=json.dumps(data), created_at=now, updated_at=now))
                created.append(candidate_id)
            except IntegrityError:
                pass  # Another leased preparation already froze the same source revision.
        return {"candidate_ids": created, "created": len(created), "skipped": skipped, "inspected": min(len(signals), payload.limit), "unauthorized": unauthorized, "next_cursor": signals[payload.limit - 1][0] if more else None}

    async def verify_candidate(self, candidate_id, payload, principal):
        self.author(principal)
        row = await self.get(candidates, candidate_id, principal)
        if principal.subject in {row["source_subject"], row["author_subject"]}:
            raise PermissionError("An independent administrator must verify source outcomes")
        facts = [item.strip() for item in payload.expected_facts]
        if not all(facts) or any(len(item) > 4000 for item in facts) or not payload.reason.strip():
            raise ValueError("Bounded verified facts and reason are required")
        value = {"expected_outcome": payload.expected_outcome, "expected_facts": facts}
        if redact(value, max_text=4000) != value:
            raise ValueError("Remove sensitive data from verified facts")
        async with self.engine.begin() as connection:
            changed = await connection.execute(update(candidates).where(self.scope(candidates, principal), candidates.c.candidate_id == candidate_id, candidates.c.revision == payload.expected_revision).values(status="VERIFIED", revision=candidates.c.revision + 1, verified_json=json.dumps(value), verifier_subject=principal.subject, reason=redact(payload.reason.strip(), max_text=2000), updated_at=time.time()))
            if changed.rowcount != 1:
                raise ValueError("Candidate changed; reload before verifying")
            await self._audit(connection, row, "verify", {"verification": value, "reason": payload.reason, "source_run_id": row["source_run_id"], "source_snapshot_hash": row["payload"]["run_snapshot_hash"]}, actor=principal.subject)
        return await self.get(candidates, candidate_id, principal)

    @staticmethod
    def case(row):
        if row["status"] != "VERIFIED" or not row["verifier_subject"]:
            raise ValueError("Only independently verified candidates can enter a benchmark")
        content = row["payload"]
        ticket, logs, snapshots, attachments = None, [], {}, []
        for item in content["evidence"]:
            data = json.loads(item["content_json"])
            name = item["source"]["connector"]
            if name == "itsm" and isinstance(data, dict):
                ticket = data
            elif name == "log_search" and isinstance(data, list):
                logs.extend(data)
            elif name == "attachments":
                attachments.append(data.get("text", "") if isinstance(data, dict) else str(data))
            elif name not in {"knowledge", "attachments"} and isinstance(data, dict):
                snapshots[name] = data
        return Case(id=row["candidate_id"][-64:], prompt=content["prompt"], incident_id=content["incident_id"], ticket=ticket, logs=logs, recorded_sources=snapshots, attachments=attachments, knowledge_scope=content.get("knowledge_scope"), knowledge_document_ids=content.get("knowledge_document_ids", []), provenance={"candidate_id": row["candidate_id"], "candidate_revision": row["revision"], "source_run_id": row["source_run_id"], "source_snapshot_hash": content["run_snapshot_hash"], "evidence_ids": [item["evidence_id"] for item in content["evidence"]], "verified_by": row["verifier_subject"], "verified_at": row["updated_at"]}, **row["verification"])

    async def publish_dataset(self, payload, principal):
        self.author(principal)
        identifiers = payload.train_ids + payload.holdout_ids
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("Training and held-out candidates must be distinct")
        rows = [await self.get(candidates, identifier, principal) for identifier in identifiers]
        if any(row["capability"] != payload.capability for row in rows):
            raise ValueError("Candidate capability must match the dataset")
        cases = [self.case(row) for row in rows]
        families = [case.incident_id or case.provenance["source_run_id"] for case in cases]
        if len(set(families)) != len(families):
            raise ValueError("Each incident may appear only once to prevent train/holdout leakage")
        corpus = await self.knowledge.frozen_corpus(principal, document_ids=payload.knowledge_document_ids) if payload.knowledge_document_ids else []
        policy = (await self.knowledge.policy(principal)).model_dump(mode="json") if corpus else {}
        dataset = Dataset(id=payload.id, version=payload.version, purpose="benchmark", capability=payload.capability, description=payload.description, train=cases[:len(payload.train_ids)], holdout=cases[len(payload.train_ids):], knowledge_corpus=corpus, knowledge_policy=policy)
        return await self.optimizations.register_dataset(dataset, principal)

    async def draft_knowledge(self, candidate_id, payload, principal):
        from app.configuration.knowledge import KnowledgeInput
        row = await self.get(candidates, candidate_id, principal)
        if row["revision"] != payload.expected_revision:
            raise ValueError("Candidate changed; reload before creating knowledge")
        case = self.case(row)
        text = "\n".join(["# " + payload.title, "", "Verified observations", *["- " + fact for fact in case.expected_facts], "", "Outcome: " + case.expected_outcome, "Source investigation: " + row["source_run_id"], "Source snapshot: " + row["payload"]["run_snapshot_hash"], "Verified by: " + row["verifier_subject"], "Evidence: " + ", ".join(case.provenance["evidence_ids"])])
        return await self.knowledge.save(principal, KnowledgeInput(title=payload.title, category=payload.category, content=text), max_text_chars=32000)

    async def tick_schedules(self):
        now = time.time()
        async with self.engine.begin() as connection:
            rows = (await connection.execute(select(schedules).where(schedules.c.tenant_id == self.optimizations.settings.tenant_id, schedules.c.enabled.is_(True), schedules.c.next_run_at <= now).order_by(schedules.c.next_run_at).limit(25).with_for_update(skip_locked=True))).mappings().all()
            for row in rows:
                changed = await connection.execute(update(schedules).where(schedules.c.schedule_id == row["schedule_id"], schedules.c.next_run_at == row["next_run_at"], schedules.c.revision == row["revision"]).values(next_run_at=now + row["interval_seconds"], updated_at=now))
                if changed.rowcount != 1:
                    continue
                # Coalesce missed intervals and avoid an ever-growing schedule backlog.
                key = f"schedule:{row['schedule_id']}:{row['revision']}"
                pending = await connection.scalar(select(jobs.c.job_id).where(jobs.c.tenant_id == row["tenant_id"], jobs.c.project_id == row["project_id"], jobs.c.idempotency_key.startswith(key + ":", autoescape=True), jobs.c.status.in_(["QUEUED", "RUNNING"])).limit(1))
                if pending:
                    continue
                await connection.execute(insert(jobs).values(job_id="job_" + uuid.uuid4().hex, tenant_id=row["tenant_id"], project_id=row["project_id"], author_subject=row["author_subject"], payload_json=row["payload_json"], fingerprint=digest(json.loads(row["payload_json"])), idempotency_key=key + ":" + str(row["next_run_at"]), status="QUEUED", attempts=0, cancel_requested=False, created_at=now, updated_at=now))

    async def claim(self):
        now = time.time()
        eligible = and_(jobs.c.tenant_id == self.optimizations.settings.tenant_id, or_(jobs.c.status == "QUEUED", and_(jobs.c.status == "RUNNING", jobs.c.lease_until < now)))
        async with self.engine.begin() as connection:
            await connection.execute(update(jobs).where(eligible, jobs.c.attempts >= self.max_attempts).values(status="FAILED", error="Recovery attempt limit reached; review before retry", updated_at=now))
            row = (await connection.execute(select(jobs).where(eligible, jobs.c.attempts < self.max_attempts).order_by(jobs.c.created_at).limit(1).with_for_update(skip_locked=True))).mappings().first()
            if row is None:
                return None
            owner = self.worker_id + ":" + uuid.uuid4().hex
            changed = await connection.execute(update(jobs).where(jobs.c.job_id == row["job_id"], jobs.c.updated_at == row["updated_at"], eligible).values(status="RUNNING", lease_owner=owner, lease_until=now + self.lease_seconds, attempts=row["attempts"] + 1, updated_at=now))
            if changed.rowcount == 1:
                await self._audit(connection, row, "recover" if row["status"] == "RUNNING" else "start", {"attempt": row["attempts"] + 1})
            return dict(row) | {"lease_owner": owner} if changed.rowcount == 1 else None

    async def run_once(self):
        if self.resolve_context is None:
            raise RuntimeError("A fresh membership/runtime resolver is required")
        await self.tick_schedules()
        row = await self.claim()
        if row is None:
            return False
        token = and_(jobs.c.job_id == row["job_id"], jobs.c.lease_owner == row["lease_owner"], jobs.c.status == "RUNNING")

        checkpoint = json.loads(row["result_json"]) if row["result_json"] else None

        async def progress(value):
            nonlocal checkpoint
            async with self.engine.begin() as connection:
                changed = await connection.execute(update(jobs).where(token, jobs.c.cancel_requested.is_(False)).values(result_json=json.dumps(value), lease_until=time.time() + self.lease_seconds, updated_at=time.time()))
                if changed.rowcount != 1:
                    raise asyncio.CancelledError("Capture job stopped or lost its worker lease")
            checkpoint = json.loads(json.dumps(value))

        async def execute():
            async with self.resolve_context(row["tenant_id"], row["project_id"], row["author_subject"]) as context:
                principal, optimizations, knowledge, *runtime = context
                if (principal.tenant_id, principal.project_id, principal.subject) != (row["tenant_id"], row["project_id"], row["author_subject"]):
                    raise PermissionError("Job membership scope changed")
                self.author(principal)
                scoped = ImprovementService(self.engine, optimizations, knowledge, self.store, runner=runtime[0] if runtime else self.runner, max_capture_text_chars=runtime[1] if len(runtime) > 1 else self.max_capture_text_chars)
                payload = ImprovementJob.model_validate_json(row["payload_json"])
                if payload.kind == "prepare_feedback":
                    return await scoped.prepare(payload, principal)
                if payload.kind == "capture_knowledge":
                    from app.optimization.knowledge_capture import KnowledgeCaptureService
                    return await KnowledgeCaptureService(scoped).execute(payload.capture, principal, checkpoint, progress)
                if payload.kind == "track_closures":
                    from app.optimization.closure_tracking import ClosureTrackingService
                    return await ClosureTrackingService(scoped).execute(payload, principal, checkpoint, progress)
                result = await optimizations.execute(payload.optimization, principal)
                return {"optimization_id": result["optimization_id"], "status": result["status"]}

        async def heartbeat(task):
            try:
                while not task.done():
                    async with self.engine.begin() as connection:
                        current = (await connection.execute(select(jobs).where(token))).mappings().first()
                        if current is None or current["cancel_requested"]:
                            task.cancel()
                            return
                        await connection.execute(update(jobs).where(token).values(lease_until=time.time() + self.lease_seconds, updated_at=time.time()))
                    await asyncio.sleep(self.lease_seconds / 3)
            except Exception:
                task.cancel()
                raise

        self.current = asyncio.create_task(execute())
        monitor = asyncio.create_task(heartbeat(self.current))
        status, result, error, capacity_wait = "SUCCEEDED", None, None, False
        try:
            if row["cancel_requested"]:
                self.current.cancel()
            result = await self.current
            if result.get("status") == "CONTINUE":
                status, capacity_wait = "QUEUED", True
            if result.get("status") == "FAILED":
                status, error = "FAILED", "Evaluation failed; inspect the linked optimization report"
        except asyncio.CancelledError:
            status, error = ("QUEUED", "Worker shutdown; queued for recovery") if self.closed else ("CANCELLED", "Stopped by operator or lost worker lease")
        except OverflowError:
            status, error, capacity_wait = "QUEUED", "Waiting for the current evaluation budget", True
        except Exception as exc:
            status, error = "FAILED", "Job failed: " + type(exc).__name__
        finally:
            monitor.cancel()
            await asyncio.gather(monitor, return_exceptions=True)
            self.current = None
            async with self.engine.begin() as connection:
                changed = await connection.execute(update(jobs).where(token).values(status=status, result_json=json.dumps(result or checkpoint) if result or checkpoint else None, error=error, lease_owner=None, lease_until=None, updated_at=time.time(), **({"attempts": row["attempts"]} if capacity_wait else {})))
                if changed.rowcount == 1:
                    await self._audit(connection, row, status.lower(), {"result": result, "error": error})
        return status != "QUEUED"

    async def _work(self):
        while not self.closed:
            try:
                if await self.run_once():
                    continue
            except asyncio.CancelledError:
                return
            except Exception:
                # A DB interruption leaves the lease recoverable by another worker.
                import logging
                logging.getLogger(__name__).exception("Improvement worker could not claim or persist work")
            await asyncio.sleep(2)

    def start(self):
        if self.resolve_context is None:
            raise RuntimeError("A fresh membership/runtime resolver is required")
        if self.worker is None:
            self.worker = asyncio.create_task(self._work())

    async def aclose(self):
        self.closed = True
        if self.current:
            self.current.cancel()
        if self.worker:
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
