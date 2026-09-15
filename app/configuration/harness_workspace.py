"""Scoped immutable bundle revisions and independent workflow review."""
from collections import defaultdict
import time
import uuid

import yaml
from sqlalchemy import Column, Float, MetaData, String, Table, and_, insert, select, update

from app.capabilities.resolver import CapabilityResolver
from app.configuration.connector_catalog import published_parameter_templates
from app.configuration.harness_bundles import (
    BUILTINS, BundleInput, Workspace, Permissions, GraphNode, GraphEdge, canonical,
    compile_bundle, compatibility, enriched_graph,
)
from app.configuration.service import AUTHOR_ROLES, ADMIN_ROLES
from app.configuration.harness_catalog import workspace_catalog
from app.configuration.parameters import _normalize_parameter_name
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
    def __init__(
        self,
        engine,
        blob_store,
        platform,
        settings,
        configurations,
        *,
        parameter_store=None,
        connector_instance_store=None,
    ):
        self.engine, self.blob_store = engine, blob_store
        self.platform, self.settings, self.configurations = platform, settings, configurations
        self.parameter_store = parameter_store
        self.connector_instance_store = connector_instance_store
        self.registry, self.profiles = platform.registry, platform.profiles

    # These are the bindings that have a concrete consumer in the current
    # native providers. A declared binding alone is intentionally insufficient
    # to claim that a field executes: this keeps planned adapters and fields
    # such as project.attachment_processing visible without overstating them.
    _CONSUMED_RUNTIME_BINDINGS = frozenset({
        "connector.timeout_seconds",
        "connector.max_response_bytes",
        "connector.max_results",
        "connector.max_window_seconds",
        "jira.custom_field_mapping",
        "project.attachment_processing",
        "kafka.topic",
        "unix.host",
        "unix.port",
        "unix.username",
        "unix.private_key_ref",
        "unix.known_hosts_ref",
        "unix.log_path",
    })

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

    async def connector_context(self, p):
        """Read the same published templates and parameter rows used at runtime."""
        templates = tuple(getattr(self.platform, "connector_templates", ()) or ())
        store = self.connector_instance_store
        if store is not None and hasattr(store, "list_connector_templates"):
            templates = await published_parameter_templates(templates, store, parameter_store=self.parameter_store, tenant=p.tenant_id)
        rows = []
        if self.parameter_store is not None:
            rows = await self.parameter_store.resolve(
                p.tenant_id,
                p.project_id,
                templates,
                getattr(self.platform, "connector_options", {}),
            )
        instances = []
        if store is not None and hasattr(store, "list_project_connector_instances"):
            instances = await store.list_project_connector_instances(
                p.tenant_id, p.project_id
            )
        return templates, rows, instances

    @staticmethod
    def _field_projection(field):
        """Expose field contract metadata without copying credential material."""
        values = {
            "variable_name": field.variable_name,
            "label": field.label or field.variable_name,
            "description": field.description,
            "value_type": field.value_type,
            "category": field.category,
            "subcategory": field.subcategory,
            "allowed_values": list(field.allowed_values)
            if field.allowed_values is not None
            else None,
            "allow_project_override": field.allow_project_override,
            "visible_in_project": field.visible_in_project,
            "required": field.required,
            "required_when": field.required_when,
            "nullable": field.nullable,
            "disableable": field.disableable,
            "default_source": field.default_source,
            "ui_control": field.ui_control,
            "ui_metadata": field.ui_metadata,
            "unit": field.unit,
            "ownership": field.ownership,
            "sensitivity": field.sensitivity,
            "runtime_binding": field.runtime_binding,
            "template_editable": field.template_editable,
            "minimum": field.minimum,
            "maximum": field.maximum,
            "max_length": field.max_length,
            "visibility_condition": field.visibility_condition,
        }
        return {key: value for key, value in values.items() if value is not None}

    @staticmethod
    def _safe_parameter_value(row, value, declarations):
        """Never put secret references or hidden platform values in Harness JSON."""
        sensitive = row.get("value_type") == "secret_ref" or any(
            item.get("sensitivity") in {"masked", "secret_reference"}
            or item.get("ownership") == "secret_reference"
            for item in declarations
        )
        visible = bool(row.get("project_visible", True)) and (
            not declarations or all(item.get("visible_in_project", True) for item in declarations)
        )
        if sensitive or not visible:
            return None, True
        return value, False

    def _add_connector_parameter_projections(
        self, graph, templates, parameter_rows, instances
    ):
        """Project template, effective parameter, and execution consumer lineage.

        Harness is a read model here. It deliberately does not turn a declared
        template binding into an execution claim: only bindings known to have a
        provider consumer are marked ``runtime_bound``.
        """
        # The source is the resolved published catalog. It may come from the
        # bundled platform configuration or a persisted immutable version.
        template_source = "platform.connector_templates"
        declarations = defaultdict(list)
        template_nodes = {}

        for template in templates:
            template_key = (template.system_name, template.version)
            template_node_id = f"connector-template:{template.system_name}@{template.version}"
            template_nodes[template_key] = template_node_id
            field_projections = []
            declared_names = set()
            for field in template.parameter_fields:
                projection = self._field_projection(field)
                declared_names.add(field.variable_name)
                declarations[(template.system_name, field.variable_name)].append(
                    {
                        **projection,
                        "template_id": template.system_name,
                        "template_version": template.version,
                        "declaration": "parameter_field",
                    }
                )
                field_projections.append(projection)
            for raw_name in template.default_config:
                if not isinstance(raw_name, str):
                    continue
                name = _normalize_parameter_name(raw_name)
                if name in declared_names:
                    continue
                declarations[(template.system_name, name)].append(
                    {
                        "variable_name": name,
                        "label": name,
                        "description": f"Connector default config: {raw_name}",
                        "value_type": "configuration",
                        "visible_in_project": True,
                        "runtime_binding": None,
                        "template_id": template.system_name,
                        "template_version": template.version,
                        "declaration": "default_config",
                    }
                )

            # These base controls are synthesized by ParameterStore for every
            # connector. Keep their visibility contract in the Harness read
            # model too, otherwise hidden protocol/auth values could appear as
            # effective values merely because they have no parameter-field row.
            base_visibility = {
                "endpoint": True,
                "ui_base_url": True,
                "protocol": False,
                "auth_method": False,
                "service_user": False,
                "timeout_seconds": True,
                "retry_attempts": True,
                "retry_backoff_seconds": True,
                "rate_limit": True,
            }
            for name, visible in base_visibility.items():
                declarations.setdefault((template.system_name, name), []).append(
                    {
                        "variable_name": name,
                        "label": name,
                        "description": f"Connector base setting: {name}",
                        "value_type": "configuration",
                        "visible_in_project": visible,
                        "runtime_binding": None,
                        "template_id": template.system_name,
                        "template_version": template.version,
                        "declaration": "connector_base",
                    }
                )

            template_instances = [
                {
                    "instance_id": item.get("instance_id"),
                    "system_name": item.get("system_name"),
                    "status": item.get("status"),
                    "enabled": item.get("enabled"),
                    "revision": item.get("revision"),
                    "bindings": [
                        {
                            key: binding.get(key)
                            for key in (
                                "project_env_id",
                                "tool_env_id",
                                "external_resource",
                                "status",
                            )
                            if binding.get(key) is not None
                        }
                        for binding in item.get("bindings", [])
                        if isinstance(binding, dict)
                    ],
                }
                for item in instances
                if item.get("template_id") == template.system_name
                and item.get("template_version", template.version) == template.version
            ]
            graph.nodes.append(
                GraphNode(
                    id=template_node_id,
                    kind="connector_template",
                    label=template.name,
                    source=template_source,
                    enabled=bool(template.platform_enabled and template.is_enabled_by_policy),
                    reason=(
                        "Published connector template resolved from the platform catalog"
                        if template.platform_enabled and template.is_enabled_by_policy
                        else "Disabled by platform connector policy"
                    ),
                    details={
                        "template_id": template.system_name,
                        "template_version": template.version,
                        "status": template.availability,
                        "provider_adapter_id": template.provider_adapter_id,
                        "integration_kind": template.integration_kind,
                        "protocol": template.protocol,
                        "supported_operations": list(template.supported_operations),
                        "known_limitations": list(template.known_limitations),
                        "project_form": template.project_form,
                        "fields": field_projections,
                        "instances": template_instances,
                        "provenance": {
                            "source": template_source,
                            "catalog_resolver": "app/configuration/connector_catalog.py",
                            "lifecycle": "published",
                        },
                    },
                )
            )

        tool_actions = defaultdict(list)
        tool_refs = defaultdict(list)
        agent_refs = defaultdict(list)
        node_ids = {node.id for node in graph.nodes}
        agent_ids = {
            node.id for node in graph.nodes if node.kind in {"agent", "builtin"}
        }
        agent_enabled = {
            node.id: node.enabled
            for node in graph.nodes
            if node.kind in {"agent", "builtin"}
        }
        connector_enabled = {
            node.id: node.enabled
            for node in graph.nodes
            if node.kind == "connector"
        }
        for node in graph.nodes:
            if node.kind != "tool":
                continue
            action = node.details.get("effective_value") or node.label
            if not isinstance(action, str) or "." not in action:
                continue
            connector = action.split(".", 1)[0]
            connector_node = "connector:" + connector
            if not node.enabled or connector_enabled.get(connector_node, True) is False:
                continue
            tool_actions[connector].append(action)
            tool_refs[connector].append(node.id)
            for edge in graph.edges:
                if (
                    edge.target == node.id
                    and edge.source in agent_ids
                    and agent_enabled.get(edge.source, True)
                ):
                    agent_refs[connector].append(edge.source)

        def add_edge(source, target, kind):
            if not any(
                edge.source == source and edge.target == target and edge.kind == kind
                for edge in graph.edges
            ):
                graph.edges.append(GraphEdge(source=source, target=target, kind=kind))

        def instance_values(tool, name, declaration_items):
            result = []
            for template_key, template_node_id in template_nodes.items():
                if template_key[0] != tool:
                    continue
                for item in instances:
                    if (
                        item.get("template_id") != template_key[0]
                        or item.get("template_version", template_key[1]) != template_key[1]
                    ):
                        continue
                    definition = item.get("definition_json") or {}
                    nested = definition.get("parameters") or {}
                    if not isinstance(definition, dict) or not isinstance(nested, dict):
                        continue
                    value = definition.get(name, nested.get(name))
                    if value is None:
                        continue
                    safe, redacted = self._safe_parameter_value(
                        {"value_type": "string", "project_visible": True},
                        value,
                        declaration_items,
                    )
                    result.append(
                        {
                            "instance_id": item.get("instance_id"),
                            "revision": item.get("revision"),
                            "status": item.get("status"),
                            "enabled": item.get("enabled"),
                            "value": safe,
                            "redacted": redacted,
                            "source": "project_connector_instance",
                            "template_id": template_key[0],
                            "template_version": template_key[1],
                            "template_node": template_node_id,
                        }
                    )
            return result

        seen_parameters = set()
        for row in parameter_rows:
            tool = row.get("tool")
            name = row.get("variable_name")
            if not isinstance(tool, str) or not isinstance(name, str):
                continue
            key = (tool, name)
            if key in seen_parameters:
                continue
            seen_parameters.add(key)
            declared = declarations.get(key, [])
            binding = next(
                (
                    item.get("runtime_binding")
                    for item in declared
                    if item.get("runtime_binding")
                ),
                None,
            )
            actions = sorted(set(tool_actions.get(tool, ())))
            tool_consumers = sorted(set(tool_refs.get(tool, ())))
            agent_consumers = sorted(set(agent_refs.get(tool, ())))
            if tool == "runtime":
                execution_status = "runtime_control"
                execution_consumers = ["governance"] if "governance" in node_ids else []
            elif not binding:
                execution_status = "configuration_only"
                execution_consumers = []
            elif binding not in self._CONSUMED_RUNTIME_BINDINGS or not actions:
                execution_status = "declared_unconsumed"
                execution_consumers = []
            else:
                execution_status = "runtime_bound"
                execution_consumers = [*tool_consumers, *agent_consumers]

            if not row.get("enabled", True):
                execution_status = "disabled"
                execution_consumers = []

            template_keys = sorted(
                {
                    (item.get("template_id"), item.get("template_version"))
                    for item in declared
                    if item.get("template_id")
                }
            )
            template_available = any(
                graph_node.enabled
                for template_key in template_keys
                if (graph_node := next(
                    (
                        node
                        for node in graph.nodes
                        if node.id == template_nodes.get(template_key)
                    ),
                    None,
                )) is not None
            )
            if template_keys and not template_available:
                execution_status = "disabled"
                execution_consumers = []

            effective_value, effective_redacted = self._safe_parameter_value(
                row, row.get("effective_value"), declared
            )
            default_value, default_redacted = self._safe_parameter_value(
                row, row.get("default_value"), declared
            )
            parent = (
                template_nodes.get(template_keys[0])
                if template_keys
                else "governance"
                if tool == "runtime"
                else None
            )
            parameter_id = f"parameter:{tool}.{name}"
            consumers = [
                *[
                    {"id": value, "kind": "tool", "relationship": "configuration"}
                    for value in tool_consumers
                ],
                *[
                    {"id": value, "kind": "agent", "relationship": "configuration"}
                    for value in agent_consumers
                ],
            ]
            if tool == "runtime" and "governance" in node_ids:
                consumers.append(
                    {
                        "id": "governance",
                        "kind": "policy",
                        "relationship": "runtime_control",
                    }
                )
            details = {
                "tool": tool,
                "variable_name": name,
                "label": next(
                    (item.get("label") for item in declared if item.get("label")),
                    name,
                ),
                "value_type": row.get("value_type"),
                "description": row.get("description"),
                "category": row.get("category"),
                "subcategory": row.get("subcategory"),
                "allowed_values": row.get("allowed_values"),
                "effective_value": effective_value,
                "default_value": default_value,
                "redacted": effective_redacted or default_redacted,
                "effective_state": row.get("effective_state"),
                "enabled": row.get("enabled", True),
                "project_visible": not (effective_redacted or default_redacted),
                "scope": row.get("scope"),
                "allow_project_override": row.get("allow_project_override"),
                "runtime_binding": binding,
                "execution_status": execution_status,
                "execution_consumers": execution_consumers,
                "consumer_resolution": (
                    "enforced by runner execution pipeline during ticket triage"
                    if binding == "project.attachment_processing"
                    else "workflow graph dependency; connector readiness is checked at run preflight"
                    if execution_status == "runtime_bound"
                    else "No executing provider consumer is currently registered"
                    if execution_status == "declared_unconsumed"
                    else "Saved configuration is not an agent execution binding"
                    if execution_status == "configuration_only"
                    else "Runtime value is consumed by run governance"
                    if execution_status == "runtime_control"
                    else "Parameter is unavailable in the effective template or definition"
                ),
                "consumers": consumers,
                "template_refs": [
                    {"template_id": item[0], "template_version": item[1]}
                    for item in template_keys
                ],
                "instance_provenance": instance_values(tool, name, declared),
                "provenance": {
                    "source": "project.parameter_overrides"
                    if row.get("source") == "project"
                    else "platform.parameter_definitions",
                    "parameter_revision": row.get("revision"),
                    "override_revision": row.get("override_revision"),
                    "effective_source": row.get("source"),
                    "template_source": template_source if template_keys else None,
                },
            }
            if tool == "runtime":
                active_value = getattr(self.settings, name, None)
                details.update(
                    {
                        "active_value": active_value,
                        "restart_required": active_value != row.get("effective_value"),
                        "activation": (
                            "disabled"
                            if not row.get("enabled", True)
                            else "active"
                            if active_value == row.get("effective_value")
                            else "pending_activation"
                        ),
                    }
                )
            graph.nodes.append(
                GraphNode(
                    id=parameter_id,
                    kind="parameter",
                    label=details["label"],
                    parent=parent,
                    source="app/configuration/parameters.py",
                    enabled=bool(row.get("enabled", True)),
                    reason=(
                        "Supported runtime binding; connector availability is checked at run preflight"
                        if execution_status == "runtime_bound"
                        else "Declared template binding has no current executing consumer"
                        if execution_status == "declared_unconsumed"
                        else "Saved configuration is surfaced for provenance; it is not an agent execution binding"
                        if execution_status == "configuration_only"
                        else "Runtime control consumed by run governance"
                        if execution_status == "runtime_control"
                        else "Parameter is disabled by its source definition"
                    ),
                    details=details,
                )
            )
            if parent:
                add_edge(parent, parameter_id, "defines")
            edge_kind = "runtime_binding" if execution_status == "runtime_bound" else "configuration"
            for consumer in consumers:
                add_edge(consumer["id"], parameter_id, edge_kind)

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
        templates, parameter_rows, instances = await self.connector_context(p)
        self._add_connector_parameter_projections(
            graph, templates, parameter_rows, instances
        )
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
        if getattr(self, "project_templates", None) is not None:
            from app.configuration.project_templates import project_template_context
            context = await project_template_context(
                self.project_templates, p, project, self.registry.harness.revision,
            )
            graph.nodes.append(GraphNode(id="project-template", kind="project_template",
                label="Project template", source="platform.project_templates", details=context))
            if compilation.definition:
                graph.edges.append(GraphEdge(source=compilation.definition.root,
                    target="project-template", kind="configuration"))
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
