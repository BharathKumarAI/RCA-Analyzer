"""Durable, tenant-scoped run and evidence persistence."""

import hashlib
import json
import re
import tempfile
import time
import uuid
from pathlib import Path
from app.connectors.providers.blob import ConfigurationBlobStore
from app.persistence.lineage import track_transactions
from app.persistence.database import scoped_engine, initialize_tables
from sqlalchemy import (
    Column,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    and_,
    delete,
    insert,
    select,
    text,
    update,
    func,
)
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.exc import IntegrityError
from app.runtime.run_contract import (
    RunContract,
    RunResponse,
    TERMINAL_STATUSES,
    content_hash,
)
from app.schemas.evidence import EvidenceBundle
from app.identity.principals import UserPrincipal

metadata = MetaData(schema="runtime")
runs = Table(
    "runs",
    metadata,
    Column("run_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False),
    Column("idempotency_key_hash", String(64), unique=True),
    Column("request_hash", String(128), nullable=False),
    Column("contract_json", String, nullable=False),
    Column("snapshot_hash", String(128), nullable=False),
    Column("deadline", Float, nullable=False),
    Column("status", String(32), nullable=False),
    Column("stage", String(128), nullable=False),
    Column("result_json", String),
    Column("reason", String),
    Column("trace_id", String(256)),
    Column("evidence_count", Integer, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)
evidence = Table(
    "evidence",
    metadata,
    Column("evidence_id", String(128), primary_key=True),
    Column("run_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("bundle_json", String, nullable=False),
    Column("content_hash", String(128), nullable=False),
)
attachments = Table(
    "attachments",
    metadata,
    Column("attachment_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False),
    Column("payload_json", String, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("expires_at", Float, nullable=False),
)

chats = Table(
    "chats",
    metadata,
    Column("chat_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False),
    Column("created_at", Float, nullable=False),
)
chat_runs = Table(
    "chat_runs",
    metadata,
    Column("run_id", String(128), primary_key=True),
    Column("chat_id", String(128), nullable=False, index=True),
)


class InvestigationStore:
    def __init__(self, database_url: str = "sqlite+aiosqlite:///./rca_analyzer.db"):
        if (
            database_url.startswith("sqlite+aiosqlite:///")
            and database_url != "sqlite+aiosqlite:///:memory:"
        ):
            path = Path(database_url.removeprefix("sqlite+aiosqlite:///"))
            if not path.is_absolute():
                path = Path.cwd() / path
            path.parent.mkdir(parents=True, exist_ok=True)
            database_url = "sqlite+aiosqlite:///" + str(path)
        self.attachment_blob_uri = None
        self.attachment_scope = None
        self._temporary_attachment_root = None
        self.engine: AsyncEngine = scoped_engine(
            track_transactions(create_async_engine(database_url, pool_pre_ping=True))
        )

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    async def aclose(self):
        await self.engine.dispose()
        if self._temporary_attachment_root is not None:
            self._temporary_attachment_root.cleanup()

    async def ping(self):
        async with self.engine.connect() as c:
            await c.execute(text("SELECT 1"))
        return True

    @staticmethod
    def _key(p, key):
        return hashlib.sha256(
            f"{p.tenant_id}\0{p.project_id}\0{p.subject}\0{key}".encode()
        ).hexdigest()

    @staticmethod
    def _scope(t, p):
        return and_(t.c.tenant_id == p.tenant_id, t.c.project_id == p.project_id)

    @staticmethod
    def _response(row):
        d = dict(row._mapping)
        contract = json.loads(d["contract_json"])
        raw_result = d.pop("result_json")
        result = json.loads(raw_result) if raw_result else None
        for k in (
            "contract_json",
            "request_hash",
            "snapshot_hash",
            "tenant_id",
            "project_id",
            "subject",
            "idempotency_key_hash",
            "deadline",
        ):
            d.pop(k, None)
        return RunResponse(
            **d,
            result=result,
            mode=contract["mode"],
            capability=contract["capability"],
            chat_id=contract["request"].get("chat_id"),
        )

    async def create_run(
        self,
        contract: RunContract,
        idempotency_key: str | None,
        request_hash: str,
        deadline: float,
    ) -> tuple[RunResponse, bool]:
        if contract.request.chat_id:
            await self.require_chat(contract.request.chat_id, contract.principal)
        now = time.time()
        idem = (
            self._key(contract.principal, idempotency_key) if idempotency_key else None
        )
        values = dict(
            run_id=contract.run_id,
            tenant_id=contract.tenant_id,
            project_id=contract.project_id,
            subject=contract.principal.subject,
            idempotency_key_hash=idem,
            request_hash=request_hash,
            contract_json=contract.model_dump_json(),
            snapshot_hash=contract.snapshot_hash,
            deadline=deadline,
            status="RUNNING",
            stage="queued",
            evidence_count=0,
            revision=0,
            created_at=now,
            updated_at=now,
        )
        async with self.engine.begin() as c:
            try:
                async with c.begin_nested():
                    await c.execute(insert(runs).values(**values))
                    if contract.request.chat_id:
                        await c.execute(
                            insert(chat_runs).values(
                                run_id=contract.run_id, chat_id=contract.request.chat_id
                            )
                        )
            except IntegrityError:
                if not idem:
                    raise
                row = (
                    await c.execute(
                        select(runs).where(runs.c.idempotency_key_hash == idem)
                    )
                ).first()
                if row is None or row.request_hash != request_hash:
                    raise ValueError(
                        "Idempotency key was reused with a different request"
                    )
                return self._response(row), False
        return await self.get_run(contract.run_id, contract.principal), True

    async def get_run(self, run_id: str, principal: UserPrincipal):
        async with self.engine.begin() as c:
            row = (
                await c.execute(
                    select(runs).where(
                        and_(runs.c.run_id == run_id, self._scope(runs, principal))
                    )
                )
            ).first()
            if row and row.status == "RUNNING":
                if row.deadline < time.time():
                    await c.execute(
                        update(runs)
                        .where(
                            and_(
                                runs.c.run_id == run_id,
                                self._scope(runs, principal),
                                runs.c.status == "RUNNING",
                            )
                        )
                        .values(
                            status="FAILED",
                            reason="Run deadline exceeded",
                            updated_at=time.time(),
                            revision=runs.c.revision + 1,
                        )
                    )
                    row = (
                        await c.execute(
                            select(runs).where(
                                and_(
                                    runs.c.run_id == run_id,
                                    self._scope(runs, principal),
                                )
                            )
                        )
                    ).first()
            return self._response(row) if row else None

    async def list_runs(self, principal, limit=50, before=None):
        q = (
            select(runs)
            .where(self._scope(runs, principal))
            .order_by(runs.c.created_at.desc())
            .limit(max(1, min(limit, 100)))
        )
        if before is not None:
            q = q.where(runs.c.created_at < before)
        return await self._list_responses(q, principal)

    async def run_counts(self, principal):
        """Return durable run counts for the authenticated project scope."""
        now = time.time()
        async with self.engine.begin() as c:
            await c.execute(
                update(runs)
                .where(self._scope(runs, principal), runs.c.status == "RUNNING", runs.c.deadline < now)
                .values(status="FAILED", reason="Run deadline exceeded", updated_at=now, revision=runs.c.revision + 1)
            )
            rows = (
                await c.execute(
                    select(runs.c.status, func.count())
                    .where(self._scope(runs, principal))
                    .group_by(runs.c.status)
                )
            ).all()
        counts = {status: count for status, count in rows}
        return {
            "total": sum(counts.values()),
            "active": sum(counts.get(status, 0) for status in ("RUNNING", "QUEUED")),
            "by_status": counts,
        }

    async def list_attachments(self, principal, limit=100):
        """List non-expired attachment metadata in the authenticated project."""
        async with self.engine.connect() as c:
            rows = (await c.execute(
                select(attachments)
                .where(and_(attachments.c.tenant_id == principal.tenant_id,
                            attachments.c.project_id == principal.project_id,
                            attachments.c.expires_at > time.time()))
                .order_by(attachments.c.created_at.desc())
                .limit(max(1, min(limit, 100)))
            )).all()
        result = []
        for row in rows:
            payload = json.loads(row.payload_json)
            result.append({"id": row.attachment_id,
                           "title": payload.get("filename", row.attachment_id),
                           "size_bytes": payload.get("size_bytes"),
                           "media_type": payload.get("media_type"),
                           "created_at": row.created_at,
                           "expires_at": row.expires_at,
                           "status": "available"})
        return result

    async def _list_responses(self, query, principal):
        """List in one query, with one bounded refresh if deadlines have expired."""
        now = time.time()
        async with self.engine.begin() as c:
            rows = (await c.execute(query)).all()
            expired = [
                row.run_id
                for row in rows
                if row.status == "RUNNING" and row.deadline < now
            ]
            if expired:
                await c.execute(
                    update(runs)
                    .where(
                        runs.c.run_id.in_(expired),
                        self._scope(runs, principal),
                        runs.c.status == "RUNNING",
                        runs.c.deadline < now,
                    )
                    .values(
                        status="FAILED",
                        reason="Run deadline exceeded",
                        updated_at=now,
                        revision=runs.c.revision + 1,
                    )
                )
                rows = (await c.execute(query)).all()
        return [self._response(row) for row in rows]

    async def update_run(self, run_id, principal, **fields):
        valid = {"status", "stage", "result", "reason", "trace_id", "evidence_count"}
        unknown = set(fields) - valid
        if unknown:
            raise ValueError(f"Unknown run fields: {sorted(unknown)}")
        allowed = dict(fields)
        if "status" in allowed and allowed["status"] not in {
            "RUNNING",
            *TERMINAL_STATUSES,
        }:
            raise ValueError("Invalid run status")
        if "result" in allowed:
            allowed["result_json"] = (
                allowed.pop("result").model_dump_json() if allowed["result"] else None
            )
        async with self.engine.begin() as c:
            row = (
                await c.execute(
                    select(runs).where(
                        and_(runs.c.run_id == run_id, self._scope(runs, principal))
                    )
                )
            ).first()
            if not row:
                return None
            if row.status in TERMINAL_STATUSES:
                return self._response(row)
            await c.execute(
                update(runs)
                .where(
                    and_(
                        runs.c.run_id == run_id,
                        self._scope(runs, principal),
                        runs.c.status == "RUNNING",
                    )
                )
                .values(**allowed, updated_at=time.time(), revision=runs.c.revision + 1)
            )
        return await self.get_run(run_id, principal)

    async def save(self, bundle: EvidenceBundle, principal):
        if (bundle.tenant_id, bundle.project_id) != (
            principal.tenant_id,
            principal.project_id,
        ):
            raise PermissionError("Evidence scope violation")
        if content_hash(json.loads(bundle.content_json)) != bundle.content_hash:
            raise ValueError("Evidence content hash mismatch")
        async with self.engine.begin() as c:
            run = (
                await c.execute(
                    select(runs.c.run_id).where(
                        and_(
                            runs.c.run_id == bundle.run_id,
                            self._scope(runs, principal),
                            runs.c.status == "RUNNING",
                        )
                    )
                )
            ).first()
            if not run:
                raise PermissionError("Evidence requires a running scoped run")
            await c.execute(
                insert(evidence).values(
                    evidence_id=bundle.evidence_id,
                    run_id=bundle.run_id,
                    tenant_id=bundle.tenant_id,
                    project_id=bundle.project_id,
                    bundle_json=bundle.model_dump_json(),
                    content_hash=bundle.content_hash,
                )
            )

    async def get(self, evidence_id, principal):
        async with self.engine.connect() as c:
            row = (
                await c.execute(
                    select(evidence.c.bundle_json).where(
                        and_(
                            evidence.c.evidence_id == evidence_id,
                            evidence.c.tenant_id == principal.tenant_id,
                            evidence.c.project_id == principal.project_id,
                        )
                    )
                )
            ).first()
            if not row:
                return None
            bundle = EvidenceBundle.model_validate_json(row.bundle_json)
            if content_hash(json.loads(bundle.content_json)) != bundle.content_hash:
                raise ValueError("Evidence content hash mismatch")
            return bundle

    async def list_by_run(self, run_id, principal):
        async with self.engine.connect() as c:
            q = select(evidence.c.bundle_json).where(
                and_(
                    evidence.c.run_id == run_id,
                    evidence.c.tenant_id == principal.tenant_id,
                    evidence.c.project_id == principal.project_id,
                )
            )
            bundles = [
                EvidenceBundle.model_validate_json(r.bundle_json)
                for r in (await c.execute(q)).all()
            ]
        for bundle in bundles:
            if content_hash(json.loads(bundle.content_json)) != bundle.content_hash:
                raise ValueError("Evidence content hash mismatch")
        return bundles

    def _attachment_blobs(self, attachment_id, payload, scope):
        """Derive owned blob paths from trusted scope and generated identifiers."""
        if not re.fullmatch(r"att_[0-9a-f]{32}", attachment_id):
            raise ValueError("Invalid attachment ID")
        chat_id = payload.get("chat_id")
        if chat_id and not re.fullmatch(r"chat_[0-9a-f]{32}", chat_id):
            raise ValueError("Invalid chat ID")
        if self.attachment_blob_uri is not None:
            if tuple(scope) != self.attachment_scope:
                raise PermissionError("Attachment outside deployment scope")
            root = self.attachment_blob_uri.rstrip("/")
            if chat_id:
                artifact_id = "artifact_" + attachment_id.removeprefix("att_")
                uri = f"{root}/{chat_id}/uploads/processed/{artifact_id}"
            else:
                uri = f"{root}/_detached/{attachment_id}"
        else:
            if self.engine.dialect.name != "sqlite":
                raise ValueError(
                    "Configure project blob storage before saving attachments"
                )
            database = self.engine.url.database
            if database in {None, "", ":memory:"}:
                if self._temporary_attachment_root is None:
                    self._temporary_attachment_root = tempfile.TemporaryDirectory(
                        prefix="rca-attachments-"
                    )
                root = Path(self._temporary_attachment_root.name)
            else:
                root = Path(database + ".attachments")
            scope_hash = content_hash(list(scope)).removeprefix("sha256:")
            uri = str(root.resolve() / scope_hash / attachment_id)
        if not uri.startswith("gs://") and Path(uri).resolve() != Path(uri).absolute():
            raise ValueError("Attachment paths cannot follow symlinks")
        return ConfigurationBlobStore(uri, 8 * 1024 * 1024, binary=True, suffix=".json")

    async def save_attachment(
        self, payload: dict, principal: UserPrincipal, ttl_seconds: int = 86400
    ) -> str:
        """Persist metadata in SQL and extracted content in owned blob storage."""
        if (
            not isinstance(payload, dict)
            or not payload.get("filename")
            or not payload.get("sha256")
        ):
            raise ValueError("attachment payload requires filename and sha256")
        if ttl_seconds <= 0 or ttl_seconds > 7 * 86400:
            raise ValueError("invalid attachment TTL")
        if payload.get("chat_id"):
            await self.require_chat(payload["chat_id"], principal)
        attachment_id = "att_" + uuid.uuid4().hex
        now = time.time()
        processed = {
            k: payload[k]
            for k in ("filename", "media_type", "text", "sha256", "warnings")
            if k in payload
        }
        data = json.dumps(processed, ensure_ascii=False, sort_keys=True).encode()
        stored = {k: value for k, value in processed.items() if k != "text"}
        if payload.get("chat_id"):
            stored["chat_id"] = payload["chat_id"]
        stored["processed_hash"] = "sha256:" + hashlib.sha256(data).hexdigest()
        blobs = self._attachment_blobs(
            attachment_id, stored, (principal.tenant_id, principal.project_id)
        )
        if len(data) > blobs.max_bytes:
            raise ValueError("Extracted attachment exceeds blob size limit")
        # Catalog first: interrupted writes remain discoverable by TTL cleanup.
        async with self.engine.begin() as c:
            await c.execute(
                insert(attachments).values(
                    attachment_id=attachment_id,
                    tenant_id=principal.tenant_id,
                    project_id=principal.project_id,
                    subject=principal.subject,
                    payload_json=json.dumps(stored, ensure_ascii=False),
                    created_at=now,
                    expires_at=now + ttl_seconds,
                )
            )
        await blobs.put(data)
        return attachment_id

    async def get_attachments(
        self, ids: list[str], principal: UserPrincipal
    ) -> list[dict]:
        if (
            not ids
            or len(ids) > 50
            or any(not isinstance(i, str) or not i.startswith("att_") for i in ids)
        ):
            raise ValueError("invalid attachment IDs")
        async with self.engine.begin() as c:
            q = select(attachments).where(
                and_(
                    attachments.c.attachment_id.in_(ids),
                    attachments.c.tenant_id == principal.tenant_id,
                    attachments.c.project_id == principal.project_id,
                    attachments.c.subject == principal.subject,
                    attachments.c.expires_at > time.time(),
                )
            )
            rows = (await c.execute(q)).all()
            if len(rows) != len(set(ids)):
                raise PermissionError(
                    "attachment missing, expired, or outside principal scope"
                )
        by_id = {}
        for row in rows:
            stored = json.loads(row.payload_json)
            try:
                data = await self._attachment_blobs(
                    row.attachment_id, stored, (row.tenant_id, row.project_id)
                ).get(stored["processed_hash"])
            except FileNotFoundError:
                raise ValueError("Extracted attachment blob is unavailable") from None
            by_id[row.attachment_id] = (
                stored | json.loads(data) | {"attachment_id": row.attachment_id}
            )
        return [by_id[i] for i in ids]

    async def delete_expired(
        self,
        retention_seconds: int,
        attachment_ttl: int | None = None,
        *,
        scope: tuple[str, str] | None = None,
    ) -> int:
        if retention_seconds < 0:
            raise ValueError("invalid retention")
        cutoff = time.time() - retention_seconds

        def scoped(table):
            return (
                and_(table.c.tenant_id == scope[0], table.c.project_id == scope[1])
                if scope
                else True
            )

        async with self.engine.begin() as c:
            if attachment_ttl is not None and attachment_ttl < 0:
                raise ValueError("invalid attachment TTL")
            expired_attachments = (
                await c.execute(
                    select(attachments).where(
                        attachments.c.expires_at <= time.time(), scoped(attachments)
                    )
                )
            ).all()
            for row in expired_attachments:
                payload = json.loads(row.payload_json)
                await self._attachment_blobs(
                    row.attachment_id, payload, (row.tenant_id, row.project_id)
                ).delete(payload["processed_hash"])
            result = await c.execute(
                delete(attachments).where(
                    attachments.c.attachment_id.in_(
                        [row.attachment_id for row in expired_attachments]
                    )
                )
            )
            old = (
                select(runs.c.run_id)
                .where(
                    and_(
                        runs.c.status.in_(list(TERMINAL_STATUSES)),
                        runs.c.updated_at < cutoff,
                        scoped(runs),
                    )
                )
                .scalar_subquery()
            )
            await c.execute(delete(chat_runs).where(chat_runs.c.run_id.in_(old)))
            await c.execute(delete(evidence).where(evidence.c.run_id.in_(old)))
            result2 = await c.execute(
                delete(runs).where(
                    and_(
                        runs.c.status.in_(list(TERMINAL_STATUSES)),
                        runs.c.updated_at < cutoff,
                        scoped(runs),
                    )
                )
            )
            return (result.rowcount or 0) + (result2.rowcount or 0)

    async def create_chat(self, principal):
        record = dict(
            chat_id="chat_" + uuid.uuid4().hex,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            subject=principal.subject,
            created_at=time.time(),
        )
        async with self.engine.begin() as c:
            await c.execute(insert(chats).values(**record))
        return {"chat_id": record["chat_id"], "created_at": record["created_at"]}

    async def require_chat(self, chat_id, principal):
        async with self.engine.connect() as c:
            row = (
                await c.execute(
                    select(chats).where(
                        chats.c.chat_id == chat_id,
                        self._scope(chats, principal),
                        chats.c.subject == principal.subject,
                    )
                )
            ).first()
        if row is None:
            raise PermissionError("Chat not found")
        return {"chat_id": row.chat_id, "created_at": row.created_at}

    async def list_chats(self, principal, limit=50, before=None):
        q = select(chats).where(
            self._scope(chats, principal), chats.c.subject == principal.subject
        )
        if before is not None:
            q = q.where(chats.c.created_at < before)
        async with self.engine.connect() as c:
            rows = (
                await c.execute(q.order_by(chats.c.created_at.desc()).limit(limit))
            ).all()
        return [{"chat_id": r.chat_id, "created_at": r.created_at} for r in rows]

    async def list_chat_runs(self, chat_id, principal, limit=50, before=None):
        await self.require_chat(chat_id, principal)
        q = (
            select(runs)
            .join(chat_runs, chat_runs.c.run_id == runs.c.run_id)
            .where(
                chat_runs.c.chat_id == chat_id,
                self._scope(runs, principal),
                runs.c.subject == principal.subject,
            )
        )
        if before is not None:
            q = q.where(runs.c.created_at < before)
        return await self._list_responses(
            q.order_by(runs.c.created_at.desc()).limit(max(1, min(limit, 100))),
            principal,
        )
