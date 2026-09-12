"""Scoped immutable bundle revisions and independent workflow review."""
import time
import uuid

import yaml
from sqlalchemy import Column, Float, MetaData, String, Table, and_, insert, select, update

from app.capabilities.resolver import CapabilityResolver
from app.configuration.harness_bundles import (
    BUILTINS, BundleInput, Workspace, Permissions, canonical, compile_bundle,
    compatibility, enriched_graph,
)
from app.configuration.service import AUTHOR_ROLES, ADMIN_ROLES
from app.configuration.workflow import available_builtins, default_workflow
from app.persistence.database import initialize_tables
from app.runtime.run_contract import content_hash

metadata = MetaData(schema="governance")
bundles = Table("harness_bundles", metadata,
    Column("draft_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("capability", String(128), nullable=False),
    Column("author_subject", String(256), nullable=False),
    Column("blob_hash", String(128), nullable=False),
    Column("revision", String(128), nullable=False),
    Column("status", String(32), nullable=False),
    Column("reviewer_subject", String(256)),
    Column("reason", String(2000)),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False))
activations = Table("harness_activations", metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("capability", String(128), primary_key=True),
    Column("draft_id", String(128), nullable=False),
    Column("revision", String(128), nullable=False))
bundle_audit = Table("harness_bundle_audit", metadata,
    Column("id", String(128), primary_key=True),
    Column("draft_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("actor", String(256), nullable=False),
    Column("action", String(32), nullable=False),
    Column("revision", String(128), nullable=False),
    Column("timestamp", Float, nullable=False),
    Column("reason", String(2000), nullable=False))


class HarnessConflict(ValueError):
    pass


class HarnessWorkspaceService:
    def __init__(self, engine, blob_store, platform, settings, configurations):
        self.engine, self.blob_store = engine, blob_store
        self.platform, self.settings, self.configurations = platform, settings, configurations
        self.registry, self.profiles = platform.registry, platform.profiles

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    @staticmethod
    def scope(table, p):
        return and_(table.c.tenant_id == p.tenant_id, table.c.project_id == p.project_id)

    def capability(self, p, key):
        if (p.tenant_id, p.project_id) != (self.settings.tenant_id, self.settings.project_id):
            raise PermissionError("Outside deployment scope")
        result = CapabilityResolver(self.registry).resolve(key, p, check_health=False)
        if not result.is_authorized:
            raise PermissionError("Capability is not authorized")
        return result.capability

    async def default(self, p, capability):
        cap = self.capability(p, capability)
        runtime = self.registry.inheritance.runtime(p, self.settings, self.platform.prompts)
        stages = self.profiles.resolve(cap.model_profile)
        approved = await self.configurations.approved(p, cap.id)
        project = self.registry.inheritance.project(p)
        approved = self.registry.harness.filter_approved(approved, project.harness if project else None)
        actions = [a for a in cap.allowed_actions if a.split('.')[0] not in runtime['disabled_connectors']]
        names = available_builtins(cap, stages, runtime['workflow'], actions, attachments=True, specialists=bool(approved))
        definition = default_workflow(names, runtime['workflow'].parallel_evidence and runtime['settings'].parallel_evidence)
        files = {"rca/workflow.yaml": yaml.safe_dump(definition.model_dump(mode="json"), sort_keys=False)}
        for name in names:
            stage = BUILTINS[name]
            model_stage = "triage" if stage in {"orchestrator", "router"} else stage
            tools = [a for a in actions if (name == 'triage_agent' and a == 'itsm.get_ticket')
                     or (name == 'logs_investigator' and a == 'log_search.query_range')
                     or (name == 'connector_evidence_investigator' and a.split('.')[0] not in {'itsm', 'log_search'})]
            files[f"agents/{name}.yaml"] = yaml.safe_dump({
                "name": name, "agent_class": "LlmAgent", "description": name.replace('_', ' '),
                "instruction": runtime['prompts'][stage], "tools": [{"name": t} for t in tools],
                "x-rca": {"model_profile": cap.model_profile, "stage_model": model_stage, "builtin": name}}, sort_keys=False)
        return BundleInput(files=files, capability=capability)

    async def row(self, p, draft_id):
        async with self.engine.connect() as c:
            return (await c.execute(select(bundles).where(bundles.c.draft_id == draft_id, self.scope(bundles, p)))).first()

    async def active_row(self, p, capability):
        async with self.engine.connect() as c:
            return (await c.execute(select(bundles).join(activations, bundles.c.draft_id == activations.c.draft_id).where(
                self.scope(bundles, p), self.scope(activations, p), activations.c.capability == capability,
                bundles.c.status == "APPROVED"))).first()

    async def load(self, row):
        return BundleInput.model_validate_json(await self.blob_store.get(row.blob_hash))

    def validate(self, p, bundle):
        cap = self.capability(p, bundle.capability)
        # Validate against resolved project permissions, not the broader platform capability.
        class ScopedRegistry:
            def get(_, key):
                return cap if key == cap.id else None
        compilation = compile_bundle(bundle, ScopedRegistry(), self.profiles)
        permitted = set(self.registry.inheritance.policy.model_profiles) | {cap.model_profile}
        for definition in [*compilation.agents.values(), *compilation.overrides.values()]:
            if definition.model_profile not in permitted:
                from app.configuration.harness_bundles import Diagnostic
                compilation.diagnostics.append(Diagnostic(path=compilation.sources.get(definition.id, "rca/workflow.yaml"), message="Model profile is not delegated to this project"))
        return compilation

    async def workspace(self, p, capability, draft_id=None, bundle=None):
        cap = self.capability(p, capability)
        active = await self.active_row(p, capability)
        row = await self.row(p, draft_id) if draft_id else active
        if draft_id and (not row or row.capability != capability):
            raise LookupError("Draft not found")
        source = bundle or (await self.load(row) if row else await self.default(p, capability))
        compilation = self.validate(p, source)
        can_edit = bool(set(p.roles) & AUTHOR_ROLES)
        revision = row.revision if row else content_hash(source.model_dump(mode="json"))
        return Workspace(files=source.files, graph=enriched_graph(compilation, cap, self.profiles, can_edit),
            diagnostics=compilation.diagnostics, compatibility=compatibility(), revision=revision,
            active_revision=active.revision if active else None, draft_id=row.draft_id if row else None,
            status=row.status if row else "PLATFORM", permissions=Permissions(edit=can_edit,
                review=bool(set(p.roles) & ADMIN_ROLES) and bool(row and row.author_subject != p.subject)),
            capability=capability, capabilities=[c.id for c in self.registry.list_all()
                if CapabilityResolver(self.registry).resolve(c.id, p, check_health=False).is_authorized],
            author=row.author_subject if row else None)

    async def save(self, p, bundle, expected_revision, draft_id=None):
        if not set(p.roles) & AUTHOR_ROLES:
            raise PermissionError("Author role required")
        self.capability(p, bundle.capability)
        current = await self.workspace(p, bundle.capability, draft_id)
        if current.revision != expected_revision:
            raise HarnessConflict("Workspace changed; reload or export local edits before saving")
        old = await self.row(p, draft_id) if draft_id else None
        if old and old.status == "DRAFT" and old.author_subject != p.subject:
            raise PermissionError("Only the draft author can edit it")
        # Every saved source is content addressed; revisions change on every transition.
        digest = await self.blob_store.put(canonical(bundle))
        now, did = time.time(), (old.draft_id if old and old.status == "DRAFT" else "harness_" + uuid.uuid4().hex)
        revision = content_hash([digest, uuid.uuid4().hex])
        async with self.engine.begin() as c:
            if old and old.status == "DRAFT":
                changed = await c.execute(update(bundles).where(bundles.c.draft_id == did, self.scope(bundles, p), bundles.c.revision == expected_revision).values(blob_hash=digest, revision=revision, updated_at=now))
                if changed.rowcount != 1:
                    raise HarnessConflict("Draft changed; reload before saving")
            else:
                await c.execute(insert(bundles).values(draft_id=did, tenant_id=p.tenant_id, project_id=p.project_id,
                    capability=bundle.capability, author_subject=p.subject, blob_hash=digest, revision=revision,
                    status="DRAFT", created_at=now, updated_at=now))
            await self.audit(c, p, did, "SAVE", revision, "Draft saved")
        return await self.workspace(p, bundle.capability, did)

    async def audit(self, c, p, did, action, revision, reason):
        await c.execute(insert(bundle_audit).values(id=uuid.uuid4().hex, draft_id=did, tenant_id=p.tenant_id,
            project_id=p.project_id, actor=p.subject, action=action, revision=revision, timestamp=time.time(), reason=reason))

    async def transition(self, p, did, action, expected, reason):
        if not reason.strip():
            raise ValueError("A review reason is required")
        statuses = {"submit": "PENDING", "approve": "APPROVED", "reject": "REJECTED", "revoke": "REVOKED"}
        async with self.engine.begin() as c:
            row = (await c.execute(select(bundles).where(bundles.c.draft_id == did, self.scope(bundles, p)).with_for_update())).first()
            if not row:
                raise LookupError("Draft not found")
            self.capability(p, row.capability)
            if row.revision != expected:
                raise HarnessConflict("Draft changed; review the current revision")
            if action == "submit":
                if row.author_subject != p.subject or not set(p.roles) & AUTHOR_ROLES:
                    raise PermissionError("Only the author can submit this draft")
                required = "DRAFT"
            else:
                if not set(p.roles) & ADMIN_ROLES or (action != "revoke" and row.author_subject == p.subject):
                    raise PermissionError("Independent administrator review required")
                required = "APPROVED" if action == "revoke" else "PENDING"
            if row.status != required:
                raise HarnessConflict("Invalid review transition from " + row.status)
            if action in {"submit", "approve"}:
                compilation = self.validate(p, await self.load(row))
                if any(d.severity == "error" for d in compilation.diagnostics):
                    raise ValueError("Resolve configuration diagnostics before submission or approval")
            revision = content_hash([row.blob_hash, action, uuid.uuid4().hex])
            changed = await c.execute(update(bundles).where(bundles.c.draft_id == did, bundles.c.revision == expected).values(
                status=statuses[action], revision=revision, reviewer_subject=p.subject if action != "submit" else None,
                reason=reason, updated_at=time.time()))
            if changed.rowcount != 1:
                raise HarnessConflict("Draft changed during review")
            if action == "approve":
                from sqlalchemy.dialects.sqlite import insert as sqlite_insert
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                upsert = sqlite_insert if self.engine.dialect.name == "sqlite" else pg_insert
                statement = upsert(activations).values(tenant_id=p.tenant_id, project_id=p.project_id,
                    capability=row.capability, draft_id=did, revision=revision)
                await c.execute(statement.on_conflict_do_update(index_elements=["tenant_id", "project_id", "capability"], set_={"draft_id": did, "revision": revision}))
            if action == "revoke":
                from sqlalchemy import delete
                await c.execute(delete(activations).where(self.scope(activations, p), activations.c.draft_id == did))
            await self.audit(c, p, did, action.upper(), revision, reason)
        return await self.workspace(p, row.capability, did)

    async def effective(self, p, capability):
        row = await self.active_row(p, capability)
        if not row:
            return None
        bundle = await self.load(row)
        compiled = self.validate(p, bundle)
        if not compiled.definition or any(d.severity == "error" for d in compiled.diagnostics):
            raise PermissionError("Active workflow no longer satisfies project policy")
        return {"bundle_hash": row.blob_hash, "revision": row.revision, "compilation": compiled.model_dump(mode="json")}

    async def list_drafts(self, p, capability):
        self.capability(p, capability)
        async with self.engine.connect() as c:
            rows = (await c.execute(select(bundles).where(self.scope(bundles, p), bundles.c.capability == capability).order_by(bundles.c.updated_at.desc()).limit(100))).mappings().all()
        return [dict(r) for r in rows]
