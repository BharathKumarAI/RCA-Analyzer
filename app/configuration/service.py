"""Approval service for content-addressed, data-only agent definitions."""

from __future__ import annotations
import hashlib
import logging
import time
import uuid
from typing import Any
import yaml
from app.configuration.yaml_data import load_yaml_data
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
    update,
)
from sqlalchemy.ext.asyncio import AsyncEngine
from app.configuration.models import AgentDefinition, AgentDraft
from app.identity.principals import Role, UserPrincipal

from app.tools.catalog import ALLOWED_ACTIONS as ALLOWED_TOOLS

ADMIN_ROLES = frozenset({Role.PLATFORM_ADMIN, Role.PROJECT_OWNER})
AUTHOR_ROLES = ADMIN_ROLES | frozenset({Role.PROJECT_MANAGER})
metadata = MetaData(schema="governance")
drafts = Table(
    "agent_config_drafts",
    metadata,
    Column("draft_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("author_subject", String(256), nullable=False),
    Column("definition_json", String, nullable=False),
    Column("blob_hash", String(128), nullable=False),
    Column("status", String(16), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("reviewed_at", Float),
    Column("reviewer_subject", String(256)),
    Column("review_reason", String),
)
active = Table(
    "active_agent_configs",
    metadata,
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("agent_id", String(64), nullable=False),
    Column("draft_id", String(128), nullable=False),
    Column("content_hash", String(128), nullable=False),
    Column("updated_at", Float, nullable=False),
    __import__("sqlalchemy").PrimaryKeyConstraint(
        "tenant_id", "project_id", "agent_id"
    ),
)
audit = Table(
    "agent_config_audit",
    metadata,
    Column("event_id", Integer, primary_key=True, autoincrement=True),
    Column("draft_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("event", String(16), nullable=False),
    Column("actor_subject", String(256), nullable=False),
    Column("reason", String, nullable=False),
    Column("created_at", Float, nullable=False),
)


class AgentConfigurationService:
    def __init__(
        self,
        engine: AsyncEngine,
        blob_store: Any,
        registry: Any,
        profiles: Any,
        *,
        stage_store=None,
    ):
        self.stage_store = stage_store
        self.engine, self.blob_store, self.registry, self.profiles = (
            scoped_engine(engine),
            blob_store,
            registry,
            profiles,
        )

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    @staticmethod
    def _scope(table, p):
        return and_(
            table.c.tenant_id == p.tenant_id, table.c.project_id == p.project_id
        )

    def _profile_names(self):
        value = self.profiles
        if hasattr(value, "profiles"):
            value = value.profiles
        return set(value) if isinstance(value, dict) else set()

    def _stage_names(self):
        value = self.profiles
        if hasattr(value, "stages"):
            return set(value.stages) | {"extraction", "triage", "logs", "synthesis"}
        if isinstance(value, dict) and "stages" in value:
            return set(value["stages"])
        return {"extraction", "triage", "logs", "synthesis", "fast_synthesis"}

    def _parse(self, source: str) -> AgentDefinition:
        data = load_yaml_data(source)
        definition = AgentDefinition.model_validate(data)
        cap = self.registry.get(definition.capability)
        if not cap or not cap.enabled:
            raise ValueError("capability is missing or disabled")
        if definition.model_profile not in self._profile_names():
            raise ValueError("unknown model profile")
        if definition.stage_model not in self._stage_names():
            raise ValueError("unknown stage model")
        if not set(definition.tools).issubset(ALLOWED_TOOLS & set(cap.allowed_actions)):
            raise ValueError("tool is not allowed by capability")
        return definition

    async def _record(self, row):
        return AgentDraft(
            draft_id=row.draft_id,
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            author_subject=row.author_subject,
            definition=AgentDefinition.model_validate_json(row.definition_json),
            content_hash=row.blob_hash,
            status=row.status,
            created_at=row.created_at,
            reviewed_at=row.reviewed_at,
            reviewer_subject=row.reviewer_subject,
            review_reason=row.review_reason,
        )

    async def submit(self, yaml_text: str, principal: UserPrincipal) -> AgentDraft:
        if not set(principal.roles) & AUTHOR_ROLES:
            raise PermissionError("principal cannot author agent configurations")
        definition = self._parse(yaml_text)
        canonical = yaml.safe_dump(
            definition.model_dump(mode="json"), sort_keys=True, allow_unicode=True
        ).encode()
        digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
        stored = await self.blob_store.put(canonical)
        if stored != digest:
            raise ValueError("blob store returned an unexpected content hash")
        now, did = time.time(), "draft_" + uuid.uuid4().hex
        async with self.engine.begin() as c:
            await c.execute(
                insert(drafts).values(
                    draft_id=did,
                    tenant_id=principal.tenant_id,
                    project_id=principal.project_id,
                    author_subject=principal.subject,
                    definition_json=definition.model_dump_json(),
                    blob_hash=digest,
                    status="PENDING",
                    created_at=now,
                )
            )
            await c.execute(
                insert(audit).values(
                    draft_id=did,
                    tenant_id=principal.tenant_id,
                    project_id=principal.project_id,
                    event="SUBMITTED",
                    actor_subject=principal.subject,
                    reason="submitted",
                    created_at=now,
                )
            )
        await self.sync_stage(did, principal)
        return await self._get(did, principal)

    async def _get(self, did, p):
        async with self.engine.connect() as c:
            row = (
                await c.execute(
                    select(drafts).where(
                        and_(drafts.c.draft_id == did, self._scope(drafts, p))
                    )
                )
            ).first()
        return await self._record(row) if row else None

    async def approve(self, draft_id, principal, expected_hash, reason):
        return await self._review(
            draft_id, principal, expected_hash, reason, "APPROVED"
        )

    async def reject(self, draft_id, principal, expected_hash, reason):
        return await self._review(
            draft_id, principal, expected_hash, reason, "REJECTED"
        )

    async def _review(self, did, p, expected, reason, status):
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            raise ValueError(
                "review reason is required and must be at most 2000 characters"
            )
        if not set(p.roles) & ADMIN_ROLES:
            raise PermissionError("admin approval required")
        async with self.engine.begin() as c:
            row = (
                await c.execute(
                    select(drafts).where(
                        and_(drafts.c.draft_id == did, self._scope(drafts, p))
                    )
                )
            ).first()
            if not row:
                return None
            if row.author_subject == p.subject:
                raise PermissionError("authors cannot review their own draft")
            if row.blob_hash != expected:
                raise ValueError("draft content hash mismatch")
            blob = await self.blob_store.get(row.blob_hash)
            if "sha256:" + hashlib.sha256(blob).hexdigest() != row.blob_hash:
                raise ValueError(
                    "stored configuration blob failed integrity validation"
                )
            definition = self._parse(blob.decode("utf-8"))
            snapshot = AgentDefinition.model_validate_json(row.definition_json)
            canonical = yaml.safe_dump(
                definition.model_dump(mode="json"), sort_keys=True, allow_unicode=True
            ).encode()
            if canonical != blob or definition != snapshot:
                raise ValueError(
                    "configuration snapshot does not match its approved blob"
                )
            if row.status != "PENDING":
                raise ValueError("draft is no longer pending")
            now = time.time()
            result = await c.execute(
                update(drafts)
                .where(and_(drafts.c.draft_id == did, drafts.c.status == "PENDING"))
                .values(
                    status=status,
                    reviewed_at=now,
                    reviewer_subject=p.subject,
                    review_reason=reason,
                )
            )
            if result.rowcount != 1:
                raise ValueError("draft review raced with another reviewer")
            await c.execute(
                insert(audit).values(
                    draft_id=did,
                    tenant_id=p.tenant_id,
                    project_id=p.project_id,
                    event=status,
                    actor_subject=p.subject,
                    reason=reason,
                    created_at=now,
                )
            )
            if status == "APPROVED":
                definition = AgentDefinition.model_validate_json(row.definition_json)
                values = dict(
                    tenant_id=p.tenant_id,
                    project_id=p.project_id,
                    agent_id=definition.id,
                    draft_id=did,
                    content_hash=expected,
                    updated_at=now,
                )
                if c.dialect.name == "sqlite":
                    from sqlalchemy.dialects.sqlite import insert as dialect_insert
                elif c.dialect.name == "postgresql":
                    from sqlalchemy.dialects.postgresql import insert as dialect_insert
                else:
                    dialect_insert = None
                if dialect_insert is not None:
                    statement = (
                        dialect_insert(active)
                        .values(**values)
                        .on_conflict_do_update(
                            index_elements=["tenant_id", "project_id", "agent_id"],
                            set_=values,
                        )
                    )
                    await c.execute(statement)
                else:
                    await c.execute(
                        delete(active).where(
                            and_(
                                active.c.tenant_id == p.tenant_id,
                                active.c.project_id == p.project_id,
                                active.c.agent_id == definition.id,
                            )
                        )
                    )
                    await c.execute(insert(active).values(**values))
        await self.sync_stage(did, p)
        return await self._get(did, p)

    async def revoke(self, draft_id, principal, reason):
        if not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("admin approval required")
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            raise ValueError(
                "review reason is required and must be at most 2000 characters"
            )
        async with self.engine.begin() as c:
            row = (
                await c.execute(
                    select(drafts).where(
                        and_(
                            drafts.c.draft_id == draft_id,
                            self._scope(drafts, principal),
                        )
                    )
                )
            ).first()
            if not row:
                return None
            definition = AgentDefinition.model_validate_json(row.definition_json)
            await c.execute(
                delete(active).where(
                    and_(
                        active.c.tenant_id == principal.tenant_id,
                        active.c.project_id == principal.project_id,
                        active.c.agent_id == definition.id,
                        active.c.draft_id == draft_id,
                    )
                )
            )
            result = await c.execute(
                update(drafts)
                .where(
                    and_(drafts.c.draft_id == draft_id, drafts.c.status == "APPROVED")
                )
                .values(
                    status="REVOKED",
                    reviewed_at=time.time(),
                    reviewer_subject=principal.subject,
                    review_reason=reason,
                )
            )
            if result.rowcount != 1:
                raise ValueError("only an approved draft can be revoked")
            await c.execute(
                insert(audit).values(
                    draft_id=draft_id,
                    tenant_id=principal.tenant_id,
                    project_id=principal.project_id,
                    event="REVOKED",
                    actor_subject=principal.subject,
                    reason=reason,
                    created_at=time.time(),
                )
            )
        await self.sync_stage(draft_id, principal)
        return await self._get(draft_id, principal)

    async def list(self, principal):
        async with self.engine.connect() as c:
            rows = (
                await c.execute(
                    select(drafts)
                    .where(self._scope(drafts, principal))
                    .order_by(drafts.c.created_at.desc())
                )
            ).all()
        return [await self._record(r) for r in rows]

    async def list_audit(self, principal, limit=100):
        """List configuration governance events within the caller's project."""
        async with self.engine.connect() as c:
            rows = (
                await c.execute(
                    select(audit)
                    .where(self._scope(audit, principal))
                    .order_by(audit.c.created_at.desc())
                    .limit(max(1, min(limit, 100)))
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def approved(self, principal, capability):
        async with self.engine.connect() as c:
            q = (
                select(drafts)
                .join(
                    active,
                    and_(
                        active.c.draft_id == drafts.c.draft_id,
                        active.c.content_hash == drafts.c.blob_hash,
                    ),
                )
                .where(
                    and_(self._scope(drafts, principal), drafts.c.status == "APPROVED")
                )
            )
            rows = (await c.execute(q)).all()
        result = []
        for row in rows:
            blob = await self.blob_store.get(row.blob_hash)
            if "sha256:" + hashlib.sha256(blob).hexdigest() != row.blob_hash:
                raise ValueError(
                    "stored configuration blob failed integrity validation"
                )
            definition = self._parse(blob.decode("utf-8"))
            if definition != AgentDefinition.model_validate_json(row.definition_json):
                raise ValueError(
                    "configuration snapshot does not match its active blob"
                )
            if not capability or definition.capability == capability:
                result.append(await self._record(row))
        return result

    async def sync_stage(self, draft_id, principal, *, strict=False):
        if self.stage_store is None:
            return
        try:
            # Lock the durable row while projecting so concurrent review/revoke cannot
            # publish an older stage after a newer committed state.
            async with self.engine.begin() as c:
                await c.execute(
                    update(drafts)
                    .where(
                        drafts.c.draft_id == draft_id, self._scope(drafts, principal)
                    )
                    .values(status=drafts.c.status)
                )
                row = (
                    await c.execute(
                        select(drafts)
                        .where(
                            drafts.c.draft_id == draft_id,
                            self._scope(drafts, principal),
                        )
                        .with_for_update()
                    )
                ).first()
                if row:
                    if (row.tenant_id, row.project_id) != (
                        self.stage_store.settings.tenant_id,
                        self.stage_store.settings.project_id,
                    ):
                        raise PermissionError(
                            "Framework stage outside deployment scope"
                        )

                    content = await self.blob_store.get(row.blob_hash)
                    await self.stage_store.sync(
                        row.draft_id, row.status, row.blob_hash, content
                    )
        except Exception as exc:
            if strict:
                raise
            logging.getLogger(__name__).error(
                "Framework stage sync pending draft_id=%s error_type=%s",
                draft_id,
                type(exc).__name__,
            )
