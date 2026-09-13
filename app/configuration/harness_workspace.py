"""Scoped immutable bundle revisions and independent workflow review."""
import time
import uuid

import yaml
from sqlalchemy import Column, Float, MetaData, String, Table, and_, insert, select, update

from app.capabilities.resolver import CapabilityResolver
from app.configuration.harness_bundles import (
    BUILTINS, BundleInput, Workspace, Permissions, GraphNode, GraphEdge, canonical,
    compile_bundle, compatibility, enriched_graph,
)
from app.configuration.service import AUTHOR_ROLES, ADMIN_ROLES
from app.configuration.harness_catalog import workspace_catalog
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
    Column("blob_hash", String(128)),
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

    def require_delegated(self):
        if "harness" not in self.registry.inheritance.policy.project_sections:
            raise PermissionError("Harness customization is not delegated by the platform")

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
        can_edit = bool(set(p.roles) & AUTHOR_ROLES) and "harness" in self.registry.inheritance.policy.project_sections
        revision = row.revision if row else content_hash(source.model_dump(mode="json"))
        graph = enriched_graph(compilation, cap, self.profiles, can_edit)
        runtime = self.registry.inheritance.runtime(p, self.settings, self.platform.prompts)
        project = self.registry.inheritance.project(p)
        approved = await self.configurations.approved(p, cap.id)
        approved = self.registry.harness.filter_approved(
            approved, project.harness if project else None
        )
        self._add_approved_specialists(graph, cap, runtime, approved)
        exclusions = self.registry.harness.exclusions(project.harness if project else None)
        for node in graph.nodes:
            if node.kind == "skill":
                node.enabled = node.id.removeprefix("skill:") not in exclusions.get("skills", set())
                node.reason = "Excluded by project harness selection" if not node.enabled else "Resolved through the platform, project, and user skill hierarchy"
            if node.id == "file_investigator":
                node.reason = "Runs only when the request includes permitted local attachments"
            if node.kind == "connector":
                connector = node.id.removeprefix("connector:")
                node.enabled = connector not in runtime["disabled_connectors"]
                node.reason = "Disabled by project configuration" if not node.enabled else "Configured binding; connectivity is checked at run preflight"
            if node.kind == "model":
                profile = node.id.removeprefix("model:")
                if profile in self.profiles.profiles:
                    node.details["stages"] = {k: v.model_dump(mode="json") for k, v in self.profiles.resolve(profile).items()}
        return Workspace(files=source.files, graph=graph,
            catalog=workspace_catalog(self, p, source, graph, runtime, can_edit),
            diagnostics=compilation.diagnostics, compatibility=compatibility(), revision=revision,
            active_revision=active.revision if active else None, draft_id=row.draft_id if row else None,
            status=row.status if row else "PLATFORM", permissions=Permissions(edit=can_edit,
                review=bool(set(p.roles) & ADMIN_ROLES) and bool(row and row.author_subject != p.subject)
                and "harness" in self.registry.inheritance.policy.project_sections,
                revoke=bool(set(p.roles) & ADMIN_ROLES) and bool(row and row.status == "APPROVED")),
            capability=capability, capabilities=[c.id for c in self.registry.list_all()
                if CapabilityResolver(self.registry).resolve(c.id, p, check_health=False).is_authorized],
            author=row.author_subject if row else None)

    def _add_approved_specialists(self, graph, capability, runtime, approved):
        """Project approved, data-only specialists into the runtime graph.

        The execution path creates ``project_<id>`` LlmAgents under
        ``specialist_router``. This projection only reads persisted definitions
        and effective policy; submitted source is never imported or executed.
        """
        router = next(
            (node for node in graph.nodes if node.id == "specialist_router"), None
        )
        if router is None:
            return

        ids = {node.id for node in graph.nodes}
        edges = {(edge.source, edge.target, edge.kind) for edge in graph.edges}

        def add_node(node):
            if node.id not in ids:
                graph.nodes.append(node)
                ids.add(node.id)

        def add_edge(source, target, kind):
            edge = (source, target, kind)
            if edge not in edges:
                graph.edges.append(GraphEdge(source=source, target=target, kind=kind))
                edges.add(edge)

        workflow = runtime["workflow"]
        specialists_enabled = bool(workflow.specialists)
        try:
            triage_enabled = self.profiles.resolve(capability.model_profile)[
                "triage"
            ].enabled
        except (KeyError, TypeError):
            triage_enabled = False

        disabled_connectors = set(runtime.get("disabled_connectors", ()))
        action_set = set(capability.allowed_actions)
        for draft in approved:
            definition = draft.definition
            runtime_id = "project_" + definition.id
            profile_reason = None
            try:
                profile_stages = self.profiles.resolve(definition.model_profile)
                stage_config = (
                    profile_stages.get(definition.stage_model)
                    or self.profiles.stages.get(definition.stage_model)
                )
            except (KeyError, TypeError):
                stage_config = None
                profile_reason = "Model profile is unavailable"

            unauthorized = [
                action for action in definition.tools if action not in action_set
            ]
            disabled = [
                action
                for action in definition.tools
                if action.split(".", 1)[0] in disabled_connectors
            ]
            if not specialists_enabled:
                reason = "Disabled by project workflow settings"
            elif not triage_enabled:
                reason = "Disabled because the triage model stage is disabled"
            elif profile_reason:
                reason = profile_reason
            elif stage_config is None:
                reason = "Disabled because the specialist model stage is unavailable"
            elif not stage_config.enabled:
                reason = "Disabled because the specialist model stage is disabled"
            elif unauthorized:
                reason = (
                    "Unavailable because an action is outside the effective capability: "
                    + ", ".join(unauthorized)
                )
            elif disabled:
                reason = (
                    "Disabled by project connector settings: "
                    + ", ".join(disabled)
                )
            else:
                reason = (
                    "Approved and eligible; connector readiness is checked at run preflight"
                )
            enabled = not (
                not specialists_enabled
                or not triage_enabled
                or profile_reason
                or stage_config is None
                or not stage_config.enabled
                or unauthorized
                or disabled
            )

            details = definition.model_dump(mode="json")
            details.update(
                {
                    "definition_id": definition.id,
                    "runtime_name": runtime_id,
                    "draft_id": draft.draft_id,
                    "approval_api": "/api/v1/agent-configurations/"
                    + draft.draft_id,
                    "availability": {
                        "eligible": enabled,
                        "reason": reason,
                        "workflow_specialists_enabled": specialists_enabled,
                        "triage_stage_enabled": triage_enabled,
                        "stage_enabled": bool(stage_config and stage_config.enabled),
                        "tools_enabled": {
                            action: action in action_set and action not in disabled
                            for action in definition.tools
                        },
                    },
                }
            )
            add_node(
                GraphNode(
                    id=runtime_id,
                    kind="agent",
                    label=definition.name,
                    parent=router.id,
                    source="app/api/routes/agents.py",
                    enabled=enabled,
                    reason=reason,
                    editable=False,
                    details=details,
                )
            )
            add_edge(router.id, runtime_id, "delegation")

            model_id = "model:" + definition.model_profile
            add_node(
                GraphNode(
                    id=model_id,
                    kind="model",
                    label=definition.model_profile,
                    source="config/model_profiles.yaml",
                    details={"effective_value": definition.model_profile},
                )
            )
            add_edge(runtime_id, model_id, "dependency")
            for action in definition.tools:
                tool_id = "tool:" + action
                action_enabled = action in action_set and action not in disabled
                if action not in action_set:
                    action_reason = "Outside the effective capability"
                elif action in disabled:
                    action_reason = "Disabled by project connector settings"
                else:
                    action_reason = "Read-only server action"
                add_node(
                    GraphNode(
                        id=tool_id,
                        kind="tool",
                        label=action,
                        source="capabilities/" + capability.id + ".yaml",
                        enabled=action_enabled,
                        reason=action_reason,
                        details={"effective_value": action},
                    )
                )
                add_edge(runtime_id, tool_id, "dependency")
                connector = action.split(".", 1)[0]
                connector_id = "connector:" + connector
                add_node(
                    GraphNode(
                        id=connector_id,
                        kind="connector",
                        label=connector,
                        source="config/connectors.yaml",
                        enabled=connector not in disabled_connectors,
                        reason=(
                            "Disabled by project configuration"
                            if connector in disabled_connectors
                            else "Configured binding; connectivity is checked at run preflight"
                        ),
                        details={"scope": "server-owned", "access": "read-only"},
                    )
                )
                add_edge(tool_id, connector_id, "binding")

    async def save(self, p, bundle, expected_revision, draft_id=None):
        if not set(p.roles) & AUTHOR_ROLES:
            raise PermissionError("Author role required")
        self.require_delegated()
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
            await self.audit(c, p, did, "SAVE", revision, "Draft saved", digest)
        return await self.workspace(p, bundle.capability, did)

    async def audit(self, c, p, did, action, revision, reason, blob_hash):
        await c.execute(insert(bundle_audit).values(id=uuid.uuid4().hex, draft_id=did, tenant_id=p.tenant_id,
            project_id=p.project_id, actor=p.subject, action=action, revision=revision, blob_hash=blob_hash, timestamp=time.time(), reason=reason))

    async def transition(self, p, did, action, expected, reason):
        if not reason.strip():
            raise ValueError("A review reason is required")
        if action != "revoke":
            self.require_delegated()
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
            await self.audit(c, p, did, action.upper(), revision, reason, row.blob_hash)
        return await self.workspace(p, row.capability, did)

    async def effective(self, p, capability):
        row = await self.active_row(p, capability)
        if not row:
            return None
        self.require_delegated()
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
