"""Connector templates and project connector instances management API.

Provides versioned lifecycle management, typed candidate validation,
isolated live testing, and enablement gates.
"""

from __future__ import annotations

import hashlib
import json
import asyncio
import time
from typing import Any, Dict, List, Literal, Optional, Set
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.api.dependencies import Principal, require_roles
from app.api.routes.parameters import invoke, parameter_templates
from app.identity.principals import Role
from app.configuration.models import ConnectorTemplate
from app.configuration.connector_governance import (
    ALIASES, GovernanceChanges, project_template, read_policies, save_policy,
)
from app.configuration.connection_records import apply_environment_connection
from app.configuration.connector_catalog import refresh_published_templates
from app.connectors.candidate_testing import (
    compute_candidate_hash,
    validate_candidate_configuration,
    execute_candidate_test,
    _validate_secret_fields,
    _CANDIDATE_TEST_SEMAPHORE,
    _NATIVE_AUTH_TYPES,
)
from app.connectors.providers.jira import JiraConnector
from app.connectors.jql import JqlQuery, build_jql, field_contract
from app.connectors.providers.registry import resolve_project_connector
from app.connectors.providers.secrets import connection_secret_references

router = APIRouter(prefix="/api/v1", tags=["connectors"])

ADMIN_ROLES = {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}


async def _refresh_effective_template_catalog(request: Request) -> None:
    """Propagate a lifecycle change to every in-process consumer."""
    platform = await refresh_published_templates(
        request.app.state.platform,
        request.app.state.platform_admin,
    )
    request.app.state.platform = platform
    runner = getattr(request.app.state, "runner", None)
    if runner is not None:
        runner.platform = platform
    workspace = getattr(request.app.state, "harness_workspace", None)
    if workspace is not None:
        workspace.platform = platform
        workspace.registry = platform.registry
        workspace.profiles = platform.profiles


# -----------------------------------------------------------------------------
# PYDANTIC PAYLOAD SCHEMAS
# -----------------------------------------------------------------------------

class TemplateSavePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    version: str = Field(min_length=1, max_length=32)
    status: Literal["draft", "published", "deprecated", "retired"] = "draft"
    definition: Dict[str, Any]


class EnvironmentBindingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_env_id: str = Field(min_length=1, max_length=64)
    tool_env_id: Optional[str] = Field(default=None, max_length=64)
    external_resource: str = Field(min_length=1, max_length=256)
    credential_binding_id: Optional[str] = Field(default=None, max_length=128)
    connection_id: Optional[str] = Field(default=None, max_length=64)
    narrowing_filters_json: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["active", "inactive"] = "active"


class EnvironmentConnectionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_-]{1,64}$")
    connection_name: str = Field(min_length=1, max_length=128)
    environment_name: str = Field(min_length=1, max_length=64)
    enabled: Literal[False] = False
    routing_mode: Literal["direct", "mcp", "hybrid"] = "direct"
    auth_profile_id: Optional[str] = Field(default=None, max_length=64)
    target: Dict[str, Any] = Field(default_factory=dict)
    credentials: Dict[str, Any] = Field(default_factory=dict)
    mcp_configuration: Dict[str, Any] = Field(default_factory=dict)
    resource_scope: List[str] = Field(default_factory=list)
    status: Literal["draft"] = "draft"
    test_status: Literal["not_tested"] = "not_tested"
    last_tested_at: None = None


    @model_validator(mode="after")
    def validate_connection_input(self):
        errors: list[str] = []
        _validate_secret_fields(self.model_dump(), errors)
        if errors:
            raise ValueError("; ".join(errors))
        if set(self.target) - {"endpoint", "port"}:
            raise ValueError("Connection target accepts only endpoint and port")
        if len(self.resource_scope) > 1000 or len(set(self.resource_scope)) != len(self.resource_scope):
            raise ValueError("Resource allowlist must contain at most 1000 unique entries")
        if any(not value.strip() or len(value) > 256 for value in self.resource_scope):
            raise ValueError("Resource identifiers must contain 1–256 characters")
        return self


class ProjectConnectorInstancePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instance_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    template_id: str = Field(min_length=1, max_length=64)
    template_version: str = Field(default="1.0.0", max_length=32)
    system_name: Optional[str] = Field(default=None, max_length=128)
    environment_dependent: Optional[bool] = None
    environment_dependency: Optional[Literal["dependent", "independent"]] = None
    tool_environment: Optional[str] = Field(default=None, max_length=128)
    status: Literal["draft", "enabled", "disabled", "archived"] = "draft"
    expected_revision: int = Field(ge=0)
    definition: Dict[str, Any] = Field(default_factory=dict)
    definition_json: Optional[Dict[str, Any]] = None
    bindings: List[EnvironmentBindingPayload] = Field(default_factory=list, max_length=64)
    environment_connections: List[EnvironmentConnectionPayload] = Field(default_factory=list, max_length=64)


class CandidateValidatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate: Dict[str, Any]


class CandidateTestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate: Dict[str, Any]
    operation: Literal["test_connection", "test_scoped_read", "test_all_environments"] = "test_connection"


def _normalise_template(record: Any) -> Dict[str, Any]:
    """Return one template shape for persisted and YAML catalog records."""
    if isinstance(record, dict):
        definition = record.get("definition_json")
        metadata = {key: value for key, value in record.items() if key != "definition_json"}
        # Persisted identity/status/version metadata is authoritative; a draft
        # definition must not shadow it when it is expanded for validation.
        return {**(definition if isinstance(definition, dict) else {}), **metadata}
    return record.model_dump(mode="json")


async def _find_template(request: Request, template_id: str, version: str | None = None) -> Dict[str, Any] | None:
    store = request.app.state.platform_admin
    record = await store.get_connector_template(template_id, version)
    if record:
        return await _govern_template(request, _normalise_template(record))
    platform_templates = getattr(request.app.state.platform, "connector_templates", ())
    for item in platform_templates:
        data = _normalise_template(item)
        if (data.get("system_name") == template_id or data.get("type") == template_id) and (
            version is None or data.get("version", "1.0.0") == version
        ):
            return await _govern_template(request, data)
    return None


async def _govern_template(request, template):
    policies = await read_policies(request.app.state.parameters.engine, request.app.state.settings.tenant_id)
    return project_template(template, policies)


@router.put("/connectors/templates/{template_id}/field-governance")
async def save_field_governance(template_id: str, payload: GovernanceChanges, request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    template = await _find_template(request, template_id)
    if template is None:
        raise HTTPException(404, "Connector template not found")
    return await invoke(save_policy(request.app.state.parameters, principal, template, payload))


def _allowed_secret_references(request: Request, template: Dict[str, Any], candidate: Dict[str, Any] | None = None) -> Set[str]:
    """Build the deployment-owned secret reference allowlist.

    Project payloads may select an existing deployment binding, but may not
    turn an arbitrary environment variable name into a credential lookup.
    """
    refs: Set[str] = set()
    default_secret = template.get("default_secret")
    if isinstance(default_secret, str):
        refs.add(default_secret)
    adapter = template.get("provider_adapter_id") or template.get("type")
    options = getattr(request.app.state.platform, "connector_options", {})
    option = options.get(adapter, {}) if isinstance(options, dict) else {}
    secrets = option.get("secrets", {}) if isinstance(option, dict) else getattr(option, "secrets", {})
    if isinstance(secrets, dict):
        refs.update(value for value in secrets.values() if isinstance(value, str))
    if candidate:
        endpoint = candidate.get("endpoint") or ""
        from app.connectors.providers.registry import connection_route
        try:
            hybrid = any(isinstance(candidate.get(key), str) and candidate[key].strip().lower() == "hybrid"
                         for key in ("access_mode", "transport", "routing_mode"))
            if hybrid:
                refs = connection_secret_references(request.app.state.settings.integration_secret_references, endpoint, refs)
            if connection_route(candidate, adapter) == "mcp":
                endpoint = candidate["mcp_configuration"]["endpoint"]
            elif hybrid:
                refs = connection_secret_references(request.app.state.settings.integration_secret_references,
                                                     candidate["mcp_configuration"]["endpoint"], refs)
            refs = connection_secret_references(request.app.state.settings.integration_secret_references, endpoint, refs)
        except ValueError:
            raise HTTPException(422, "Connection route or deployment credential registry is invalid") from None
    return refs


def _allowed_endpoint_hosts(request: Request) -> Set[str] | None:
    configured = getattr(request.app.state.settings, "integration_allowed_hosts", "")
    hosts = {value.strip().lower() for value in configured.split(",") if value.strip()}
    # An empty allowlist is retained as None in demo mode so structural tests
    # can run without silently turning them into live network access.
    if not hosts and getattr(request.app.state.settings, "mode", "demo") == "demo":
        return None
    return hosts


def _deployment_connector_enabled(request: Request, template: Dict[str, Any]) -> bool:
    """Require the native/MCP adapter to be enabled by deployment config."""
    adapter = template.get("provider_adapter_id") or template.get("type")
    options = getattr(request.app.state.platform, "connector_options", {})
    option = options.get(adapter) if isinstance(options, dict) else None
    if option is None:
        return False
    return bool(option.get("enabled")) if isinstance(option, dict) else bool(getattr(option, "enabled", False))


def _field_governance_tier(field: Dict[str, Any] | Any) -> str:
    """Derive the 3-tier governance classification from a template parameter field."""
    visible = getattr(field, "visible_in_project", None) if not isinstance(field, dict) else field.get("visible_in_project")
    if visible is False:
        return "platform_only"
    allow_override = getattr(field, "allow_project_override", None) if not isinstance(field, dict) else field.get("allow_project_override")
    ownership = getattr(field, "ownership", None) if not isinstance(field, dict) else field.get("ownership")
    if allow_override is False or ownership == "platform_locked":
        return "project_locked"
    return "project_editable"


def _safe_connection(connection: Dict[str, Any], principal: Principal) -> Dict[str, Any]:
    if Role.PLATFORM_ADMIN in principal.roles:
        return connection
    return {key: connection[key] for key in (
        "connection_id", "connection_name", "environment_name", "enabled", "status",
        "test_status", "last_tested_at",
    ) if key in connection}


def _sanitize_instance_for_project(
    instance: Dict[str, Any], template: Dict[str, Any] | None, principal: Principal
) -> Dict[str, Any]:
    """Strip platform_only parameter fields from project-scoped responses for non-platform admins."""
    if Role.PLATFORM_ADMIN in principal.roles:
        return instance
    instance = dict(instance)
    instance["environment_connections"] = [_safe_connection(c, principal) for c in instance.get("environment_connections", [])]
    instance["definition_json"] = {key: value for key, value in (instance.get("definition_json") or {}).items()
                                   if key not in {"endpoint", "credentials", "auth_type", "mcp_configuration"}}
    instance["bindings"] = [{key: value for key, value in b.items() if key != "credential_binding_id"}
                            for b in instance.get("bindings", [])]
    param_fields = (template or {}).get("parameter_fields") or []
    platform_only_vars = {
        pf.get("variable_name") if isinstance(pf, dict) else getattr(pf, "variable_name", None)
        for pf in param_fields
        if _field_governance_tier(pf) == "platform_only"
    } - {None}
    if not platform_only_vars:
        return instance
    copied = dict(instance)
    def_json = dict(copied.get("definition_json") or {})
    for name in platform_only_vars:
        for k in (name, *ALIASES.get(name, ())):
            def_json.pop(k, None)
            copied.pop(k, None)
            if isinstance(def_json.get("parameters"), dict):
                def_json["parameters"] = {key: value for key, value in def_json["parameters"].items() if key != k}
    copied["definition_json"] = def_json
    return copied


def _sanitize_template_for_project(template: Dict[str, Any], principal: Principal) -> Dict[str, Any]:
    """Apply field visibility to catalog defaults as well as instance values."""
    if Role.PLATFORM_ADMIN in principal.roles:
        return template
    declared_fields = template.get("parameter_fields")
    fields = [
        field for field in (declared_fields if isinstance(declared_fields, (list, tuple)) else [])
        if isinstance(field, dict) and isinstance(field.get("variable_name"), str)
    ]
    hidden = {
        field["variable_name"] for field in fields
        if _field_governance_tier(field) == "platform_only"
    }
    result = dict(template)
    for key in ("default_secret", "default_endpoint", "default_service_user"):
        result.pop(key, None)
    result["parameter_fields"] = [field for field in fields if field["variable_name"] not in hidden]
    for key in hidden:
        result.pop(key, None)
        result.pop(f"default_{key}", None)
    if isinstance(template.get("default_config"), dict):
        result["default_config"] = {
            key: value for key, value in template["default_config"].items() if key not in hidden
        }
    return result


def _template_response(template: Dict[str, Any], principal: Principal) -> Dict[str, Any]:
    """Keep a published profile's lifecycle separate from installed native support."""
    result = _sanitize_template_for_project(template, principal)
    adapter = template.get("provider_adapter_id") or template.get("type")
    supported = _NATIVE_AUTH_TYPES.get(adapter, set()) if isinstance(adapter, str) else set()
    from app.connectors.runtime_support import connector_runtime_support

    if adapter == "itsm":
        result["known_limitations"] = [
            item.replace("/rest/api/2/", "/rest/api/3/")
            for item in result.get("known_limitations", [])
        ]
    profiles = template.get("auth_profiles")
    return {
        **result,
        "native_auth_profile_ids": [
            profile["id"] for profile in (profiles if isinstance(profiles, (list, tuple)) else [])
            if isinstance(profile, dict) and profile.get("status") == "active"
            and isinstance(profile.get("id"), str) and profile["id"] in supported
        ],
        "runtime_support": connector_runtime_support(adapter),
        "implemented_access_modes": ["direct", "mcp", "hybrid"] if supported else [],
    }


def _project_candidate(payload: ProjectConnectorInstancePayload, template: Dict[str, Any]) -> Dict[str, Any]:
    raw_def = {**(payload.definition or {}), **(payload.definition_json or {})}
    # Project-owned identity and environment controls cannot be shadowed by
    # arbitrary keys nested in the connector-specific definition.
    for key in ("template_id", "template_version", "system_name", "environment_dependency",
                "environment_dependent", "tool_environment", "bindings", "environment_connections"):
        raw_def.pop(key, None)
    system_name = (payload.system_name or template.get("name") or template.get("system_name") or payload.template_id).strip()
    environment_dependency = payload.environment_dependency
    if environment_dependency is None and payload.environment_dependent is not None:
        environment_dependency = "dependent" if payload.environment_dependent else "independent"
    return {
        "template_id": payload.template_id,
        "template_version": payload.template_version,
        "system_name": system_name,
        "environment_dependency": environment_dependency,
        "tool_environment": (payload.tool_environment or "").strip(),
        "bindings": [binding.model_dump() for binding in payload.bindings],
        "environment_connections": [conn.model_dump() for conn in payload.environment_connections],
        **raw_def,
    }


def _instance_candidate(instance: Dict[str, Any]) -> Dict[str, Any]:
    """Rebuild the candidate from persisted identity, definition and bindings."""
    definition = dict(instance.get("definition_json") or {})
    return {
        **definition,
        "instance_id": instance["instance_id"],
        "template_id": instance["template_id"],
        "template_version": instance.get("template_version", "1.0.0"),
        "system_name": instance["system_name"],
        "environment_dependency": definition.get("environment_dependency")
        or instance.get("environment_dependency"),
        "tool_environment": definition.get("tool_environment")
        or instance.get("tool_environment"),
        "bindings": instance.get("bindings", []),
        "environment_connections": instance.get("environment_connections", []),
    }


def _active_project_environment_ids(request: Request, principal: Principal) -> Set[str]:
    """Return environment IDs currently enabled in the authenticated project."""
    project = request.app.state.registry.inheritance.project(principal)
    if project is None:
        return set()
    return {
        environment.id
        for environment in project.environments
        if environment.enabled
    }


def _validate_project_environment_bindings(
    request: Request,
    principal: Principal,
    bindings: List[Dict[str, Any]],
) -> None:
    """Reject connector mappings to environments outside the project policy."""
    malformed = [
        binding
        for binding in bindings
        if not isinstance(binding, dict)
        or not isinstance(binding.get("project_env_id"), str)
        or not binding.get("project_env_id", "").strip()
    ]
    if malformed:
        raise HTTPException(422, "Connector bindings must include a project environment ID.")
    referenced = {
        binding.get("project_env_id")
        for binding in bindings
    }
    allowed = _active_project_environment_ids(request, principal)
    if referenced - allowed:
        invalid = ", ".join(sorted(referenced - allowed))
        raise HTTPException(
            422,
            f"Connector bindings must reference active environments in this project: {invalid}",
        )


def _candidate_for_environment(candidate: Dict[str, Any], environment_id: str | None) -> Dict[str, Any]:
    """Apply one persisted binding so provider scope cannot come from globals."""
    result = dict(candidate)
    bindings = [binding for binding in candidate.get("bindings", []) if isinstance(binding, dict)]
    dependency = candidate.get("environment_dependency")
    if candidate.get("environment_connections") and not bindings:
        raise HTTPException(422, "Environment connections require an explicit project binding.")
    if not bindings and dependency != "dependent":
        return result
    if not bindings:
        raise HTTPException(422, "Environment-dependent connector has no environment bindings.")
    active = [binding for binding in bindings if binding.get("status", "active") == "active"]
    if environment_id is None:
        if len(active) != 1:
            raise HTTPException(422, "An environment must be selected when bindings are ambiguous.")
        binding = active[0]
        environment_id = binding.get("project_env_id")
    matches = [binding for binding in active if binding.get("project_env_id") == environment_id]
    if len(matches) != 1:
        raise HTTPException(422, "No unique active environment binding exists for the requested environment.")
    binding = matches[0]
    external_resource = binding.get("external_resource")
    if not external_resource:
        raise HTTPException(422, "Environment binding is missing its external resource.")
    requested_resource = candidate.get("external_resource")
    if requested_resource and requested_resource != external_resource:
        raise HTTPException(422, "Candidate scope does not match the saved environment binding.")
    result["environment_id"] = environment_id
    result["external_resource"] = external_resource
    result["tool_environment"] = binding.get("tool_env_id") or binding.get("tool_environment") or result.get("tool_environment")

    conn_id = binding.get("connection_id")
    connections = candidate.get("environment_connections") or []
    if conn_id:
        matches = [c for c in connections if c.get("connection_id") == conn_id]
        if len(matches) != 1:
            raise HTTPException(422, "Selected environment connection does not exist.")
        try:
            result = apply_environment_connection(result, matches[0])
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    elif connections:
        raise HTTPException(422, "Environment binding requires an explicit connection ID.")

    return result



def _validate_template_definition(template_id: str, version: str, definition: Dict[str, Any]) -> Dict[str, Any]:
    """Validate a published template with the same typed contract as YAML."""
    if definition.get("system_name", template_id) != template_id:
        raise HTTPException(422, "Template system_name must match template_id")
    values = {
        **definition,
        "type": definition.get("type", template_id),
        "system_name": definition.get("system_name", template_id),
        "version": version,
        "availability": "published",
    }
    try:
        return ConnectorTemplate.model_validate(values).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(422, "Published connector template does not satisfy the typed connector contract") from exc


async def _validate_shared_template_contract(request, principal, template_id, version, definition):
    proposed = ConnectorTemplate.model_validate(definition)
    current = await parameter_templates(request)
    merged = tuple(item for item in current if (item.system_name, item.version) != (template_id, version)) + (proposed,)
    await invoke(request.app.state.parameters.template_defaults(
        principal.tenant_id, merged, request.app.state.platform.connector_options,
    ))


# -----------------------------------------------------------------------------
# PLATFORM CONNECTOR TEMPLATES
# -----------------------------------------------------------------------------

@router.get("/connectors/templates")
async def list_templates(request: Request, principal: Principal, status: Optional[str] = None):
    """List platform connector templates."""
    store = request.app.state.platform_admin
    # Resolve lifecycle records before applying the response filter. A draft or
    # retired database row must hide the bundled version with the same identity;
    # otherwise a status-filtered request can resurrect an older YAML template.
    all_db_templates = await store.list_connector_templates()
    db_templates = [
        item for item in all_db_templates
        if status is None or item.get("status") == status
    ]
    result = []
    db_keys = {
        (item["template_id"], item["version"])
        for item in all_db_templates
    }
    for item in db_templates:
        definition = item.get("definition_json") if isinstance(item.get("definition_json"), dict) else {}
        db_keys.add((item["template_id"], item["version"]))
        result.append({
            **definition,
            "template_id": item["template_id"],
            "version": item["version"],
            "status": item["status"],
            "checksum": item["checksum"],
            "created_at": item["created_at"],
            "updated_at": item["updated_at"],
            "created_by": item["created_by"],
            "updated_by": item["updated_by"],
        })

    # Include untouched bundle templates alongside persisted custom/template
    # lifecycle rows. A single DB row must not hide the rest of the catalog.
    platform_templates = getattr(request.app.state.platform, "connector_templates", ())
    for tmpl in platform_templates:
        dumped = tmpl.model_dump(mode="json")
        template_id = tmpl.system_name
        version = getattr(tmpl, "version", "1.0.0")
        template_status = getattr(tmpl, "availability", "published")
        if (template_id, version) in db_keys or (status and template_status != status):
            continue
        dumped_json = json.dumps(dumped, sort_keys=True)
        checksum = hashlib.sha256(dumped_json.encode()).hexdigest()
        result.append({
            "template_id": template_id,
            "version": version,
            "status": template_status,
            "checksum": checksum,
            "created_at": None,
            "updated_at": None,
            "created_by": "system",
            "updated_by": "system",
            **dumped,
        })
    policies = await read_policies(request.app.state.parameters.engine, principal.tenant_id)
    result = [project_template(template, policies) for template in result]
    if Role.PLATFORM_ADMIN in principal.roles:
        defaults = await invoke(request.app.state.parameters.template_defaults(
            principal.tenant_id, await parameter_templates(request),
            request.app.state.platform.connector_options,
        ))
        for template in result:
            template["shared_parameters"] = [
                row for row in defaults if row["tool"] == template.get("system_name")
                and row["variable_name"] in {field["variable_name"] for field in template.get("parameter_fields", []) if field.get("template_editable")}
                and template.get("status", template.get("availability")) == "published"
            ]
    return [_template_response(template, principal) for template in result]


@router.get("/connectors/templates/{template_id}")
async def get_template(
    template_id: str, request: Request, principal: Principal, version: Optional[str] = None
):
    """Retrieve a single platform connector template by ID."""
    template = await _find_template(request, template_id, version)
    if template:
        if Role.PLATFORM_ADMIN in principal.roles:
            defaults = await invoke(request.app.state.parameters.template_defaults(
                principal.tenant_id, await parameter_templates(request),
                request.app.state.platform.connector_options,
            ))
            template["shared_parameters"] = [
                row for row in defaults if row["tool"] == template.get("system_name")
                and row["variable_name"] in {field["variable_name"] for field in template.get("parameter_fields", []) if field.get("template_editable")}
                and template.get("status", template.get("availability")) == "published"
            ]
        return _template_response(template, principal)

    raise HTTPException(404, f"Connector template '{template_id}' not found")


@router.post("/connectors/templates")
async def save_template(payload: TemplateSavePayload, request: Request, principal: Principal):
    """Save a draft connector template (PLATFORM_ADMIN only)."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    store = request.app.state.platform_admin
    definition = payload.definition
    if payload.status == "published":
        definition = _validate_template_definition(payload.template_id, payload.version, definition)
        await _validate_shared_template_contract(request, principal, payload.template_id, payload.version, definition)
    dumped_json = json.dumps(definition, sort_keys=True)
    checksum = hashlib.sha256(dumped_json.encode()).hexdigest()
    try:
        saved = await store.save_connector_template(
            template_id=payload.template_id,
            version=payload.version,
            status=payload.status,
            definition_json=definition,
            checksum=checksum,
            author=principal.subject,
        )
        await _refresh_effective_template_catalog(request)
        return saved
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/connectors/templates/{template_id}/publish")
async def publish_template(
    template_id: str, request: Request, principal: Principal, version: str = "1.0.0"
):
    """Publish a draft connector template (PLATFORM_ADMIN only)."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    store = request.app.state.platform_admin
    try:
        record = await store.get_connector_template(template_id, version)
        if not record:
            raise ValueError(f"Template {template_id}@{version} not found")
        definition = _validate_template_definition(
            template_id,
            version,
            record.get("definition_json") if isinstance(record.get("definition_json"), dict) else {},
        )
        await _validate_shared_template_contract(request, principal, template_id, version, definition)
        result = await store.publish_connector_template(template_id, version, principal.subject)
        await _refresh_effective_template_catalog(request)
        return result
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None


@router.post("/connectors/templates/{template_id}/deprecate")
async def deprecate_template(
    template_id: str, request: Request, principal: Principal, version: str = "1.0.0"
):
    """Deprecate a published connector template (PLATFORM_ADMIN only)."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    store = request.app.state.platform_admin
    try:
        result = await store.deprecate_connector_template(template_id, version, principal.subject)
        await _refresh_effective_template_catalog(request)
        return result
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None


# -----------------------------------------------------------------------------
# PROJECT CONNECTOR INSTANCES
# -----------------------------------------------------------------------------

@router.get("/projects/{project_id}/connectors")
async def list_project_connectors(project_id: str, request: Request, principal: Principal):
    """List connector instances for the current authenticated project."""
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot access out-of-scope project connectors")
    store = request.app.state.platform_admin
    instances = await store.list_project_connector_instances(principal.tenant_id, principal.project_id)
    if Role.PLATFORM_ADMIN in principal.roles:
        return instances
    sanitized: List[Dict[str, Any]] = []
    for inst in instances:
        tmpl = await _find_template(request, inst["template_id"], inst.get("template_version"))
        sanitized.append(_sanitize_instance_for_project(inst, tmpl, principal))
    return sanitized


@router.get("/projects/{project_id}/connectors/{instance_id}")
async def get_project_connector(
    project_id: str, instance_id: str, request: Request, principal: Principal
):
    """Retrieve a single connector instance with its environment bindings."""
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot access out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    tmpl = await _find_template(request, instance["template_id"], instance.get("template_version"))
    return _sanitize_instance_for_project(instance, tmpl, principal)


@router.post("/projects/{project_id}/connectors")
async def save_project_connector(
    project_id: str, payload: ProjectConnectorInstancePayload, request: Request, principal: Principal
):
    """Create or update a project connector instance with concurrency and scope validation."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")

    store = request.app.state.platform_admin

    template = await _find_template(request, payload.template_id, payload.template_version)
    if not template or template.get("status", template.get("availability", "published")) != "published":
        raise HTTPException(400, f"Referenced template '{payload.template_id}' is not published or recognized.")
    if payload.status == "archived":
        raise HTTPException(409, "Archived connector instances cannot be saved; use the archive action.")
    if payload.status != "draft" and not _deployment_connector_enabled(request, template):
        raise HTTPException(409, "Connector adapter is disabled by deployment configuration.")

    # Policy gate
    if not template.get("is_enabled_by_policy", True):
        raise HTTPException(403, "Connector execution is blocked by policy.")

    # Validate candidate settings against template (drafts can be saved incomplete)
    candidate = _project_candidate(payload, template)
    if Role.PLATFORM_ADMIN not in principal.roles:
        protected = {"endpoint", "credentials", "auth_type", "mcp_configuration", "access_mode", "transport", "routing_mode"}
        if protected & (set(payload.definition) | set(payload.definition_json or {})):
            raise HTTPException(403, "Connection identities and routes are platform-managed; select an approved connection binding.")
        existing = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, payload.instance_id)
        if existing:
            candidate.update({key: value for key, value in (existing.get("definition_json") or {}).items() if key in protected})

    # Compare locked fields with the persisted instance; omissions preserve platform values.
    if Role.PLATFORM_ADMIN not in principal.roles:
        previous = _instance_candidate(existing) if existing else {}
        supplied = {**payload.definition, **(payload.definition_json or {})}
        supplied.update({k: candidate[k] for k in payload.model_fields_set if k in candidate})
        previous_nested = previous.get("parameters") or {}
        nested = supplied.get("parameters", {})
        if not isinstance(nested, dict):
            raise HTTPException(422, "Connector parameters must be an object")
        for pf in template.get("parameter_fields", []):
            name = pf["variable_name"]
            if _field_governance_tier(pf) == "project_editable":
                continue
            for key in (name, *ALIASES.get(name, ())):
                inherited = previous.get(key, previous_nested.get(key, [] if key in {"bindings", "environment_connections", "environment_mappings"} else pf.get("default_value")))
                for values in (supplied, nested):
                    if key in values and values[key] != inherited:
                        raise HTTPException(403, f"Field '{name}' is managed by the platform")
                if key in previous:
                    candidate[key] = previous[key]
                elif key in previous_nested:
                    candidate["parameters"] = {**(candidate.get("parameters") or {}), key: inherited}
                elif key in candidate and key not in supplied:
                    candidate[key] = inherited
    if not candidate.get("system_name"):
        raise HTTPException(409, "A platform administrator must configure the locked connection name before saving")
    secret_errors: list[str] = []
    credentials = candidate.get("credentials")
    if credentials is not None:
        if not isinstance(credentials, dict):
            secret_errors.append("credentials must be a mapping of credential fields.")
        else:
            _validate_secret_fields(candidate, secret_errors)
    if secret_errors:
        raise HTTPException(422, detail="Connector instance contains invalid credential input: " + "; ".join(secret_errors))
    env_dep = candidate["environment_dependency"]
    if payload.status != "draft" and env_dep is None:
        raise HTTPException(422, "Environment Dependent/Independent is mandatory.")
    if payload.status != "draft" and not candidate["tool_environment"]:
        raise HTTPException(422, "Tool Environment is mandatory.")
    if payload.status != "draft":
        valid, errors = validate_candidate_configuration(candidate, template)
        if not valid:
            raise HTTPException(422, detail=f"Connector instance configuration invalid: {'; '.join(errors)}")

    bindings_dict = candidate.get("bindings", [])
    _validate_project_environment_bindings(request, principal, bindings_dict)

    if payload.environment_connections:
        require_roles(principal, {Role.PLATFORM_ADMIN})
    connections_dict = [c.model_dump() for c in payload.environment_connections] if payload.environment_connections else None

    try:
        saved = await store.save_project_connector_instance(
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            instance_id=payload.instance_id,
            template_id=payload.template_id,
            template_version=payload.template_version,
            system_name=candidate["system_name"],
            definition_json={
                "environment_dependency": env_dep,
                "tool_environment": candidate["tool_environment"],
                **{key: value for key, value in candidate.items() if key not in {"template_id", "template_version", "system_name", "environment_dependency", "tool_environment", "bindings", "environment_connections"}},
            },
            expected_revision=payload.expected_revision,
            author=principal.subject,
            bindings=bindings_dict,
            environment_connections=connections_dict,
        )
        return _sanitize_instance_for_project(saved, template, principal)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("/projects/{project_id}/connectors/{instance_id}/connections")
async def list_project_connector_connections(
    project_id: str, instance_id: str, request: Request, principal: Principal
):
    """List repeatable environment connections for a connector instance."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot access out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    rows = await store.list_environment_connections(principal.tenant_id, principal.project_id, instance_id)
    return [_safe_connection(row, principal) for row in rows]


@router.post("/projects/{project_id}/connectors/{instance_id}/connections")
async def save_project_connector_connection(
    project_id: str, instance_id: str, payload: EnvironmentConnectionPayload, request: Request, principal: Principal
):
    """Save or update an environment connection record."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    template = await _find_template(request, instance["template_id"], instance.get("template_version", "1.0.0"))
    if not template:
        raise HTTPException(404, "Connector template not found")

    conn_dict = payload.model_dump()
    saved = await store.save_environment_connection(
        principal.tenant_id, principal.project_id, instance_id, conn_dict
    )
    return saved


@router.delete("/projects/{project_id}/connectors/{instance_id}/connections/{connection_id}")
async def delete_project_connector_connection(
    project_id: str, instance_id: str, connection_id: str, request: Request, principal: Principal
):
    """Delete an environment connection record."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    success = await store.delete_environment_connection(
        principal.tenant_id, principal.project_id, instance_id, connection_id
    )
    if not success:
        raise HTTPException(404, f"Environment connection '{connection_id}' not found")
    return {"status": "deleted", "connection_id": connection_id}


@router.post("/projects/{project_id}/connectors/{instance_id}/connections/{connection_id}/test")
async def test_project_connector_connection(
    project_id: str, instance_id: str, connection_id: str, request: Request, principal: Principal,
    environment_id: Optional[str] = Query(default=None, max_length=64),
):
    """Test a specific environment connection independently."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot access out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    template = await _find_template(request, instance["template_id"], instance.get("template_version", "1.0.0"))
    if not template or template.get("status", template.get("availability", "published")) != "published":
        raise HTTPException(409, "The connector template version is no longer available.")
    if not _deployment_connector_enabled(request, template):
        raise HTTPException(409, "Connector adapter is disabled by deployment configuration.")

    connection = await store.get_environment_connection(principal.tenant_id, principal.project_id, instance_id, connection_id)
    if not connection:
        raise HTTPException(404, f"Environment connection '{connection_id}' not found")

    bindings = [b for b in instance.get("bindings", [])
                if b.get("connection_id") == connection_id and b.get("status", "active") == "active"
                and (environment_id is None or b.get("project_env_id") == environment_id)]
    if len(bindings) != 1:
        raise HTTPException(422, "Testing requires one explicit active project binding for this connection.")
    _validate_project_environment_bindings(request, principal, bindings)
    candidate = _candidate_for_environment(_instance_candidate(instance), bindings[0]["project_env_id"])

    result = await execute_candidate_test(
        candidate,
        template,
        "test_connection",
        allowed_secret_references=_allowed_secret_references(request, template, candidate),
        allowed_endpoint_hosts=_allowed_endpoint_hosts(request),
    )
    test_status = "passed" if result.get("overall_result") == "PASSED" else "failed"
    await store.save_candidate_test_result(
        candidate_hash=result["candidate_hash"],
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        instance_id=instance_id,
        template_id=instance["template_id"],
        template_version=instance.get("template_version", "1.0.0"),
        environment_id=candidate["environment_id"],
        operation="test_connection",
        overall_result=result["overall_result"],
        stage_results=result["stage_results"],
        latency_ms=result["latency_ms"],
        evidence_summary=result.get("evidence_summary", ""),
        error_message=result.get("error_message", ""),
    )
    try:
        await store.update_environment_connection_test_status(
            principal.tenant_id, principal.project_id, instance_id, connection_id, test_status,
            expected_updated_at=connection["updated_at"],
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return {
        **result,
        "connection_id": connection_id,
        "test_status": test_status,
    }


@router.post("/projects/{project_id}/connectors/{instance_id}/connections/{connection_id}/disable")
async def disable_project_connector_connection(
    project_id: str, instance_id: str, connection_id: str, request: Request, principal: Principal
):
    """Disable a saved connection without changing its target or credentials."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    connection = await store.get_environment_connection(principal.tenant_id, principal.project_id, instance_id, connection_id)
    if not connection:
        raise HTTPException(404, f"Environment connection '{connection_id}' not found")
    return await store.set_environment_connection_enabled(
        principal.tenant_id, principal.project_id, instance_id, connection_id, False
    )


@router.post("/projects/{project_id}/connectors/{instance_id}/connections/{connection_id}/enable")
async def enable_project_connector_connection(
    project_id: str, instance_id: str, connection_id: str, request: Request, principal: Principal
):
    """Enable an environment connection, requiring a passing test within 15 minutes."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    connection = await store.get_environment_connection(principal.tenant_id, principal.project_id, instance_id, connection_id)
    if not connection:
        raise HTTPException(404, f"Environment connection '{connection_id}' not found")

    if connection.get("test_status") != "passed":
        raise HTTPException(
            412,
            f"Environment connection '{connection_id}' has not passed a live connection test.",
        )
    last_tested = connection.get("last_tested_at") or 0
    if time.time() - last_tested > 900.0:
        raise HTTPException(
            412,
            f"Environment connection '{connection_id}' test has expired (> 15 minutes old). Re-test before enabling.",
        )
    template = await _find_template(request, instance["template_id"], instance.get("template_version", "1.0.0"))
    if not template or template.get("status", template.get("availability")) != "published" or not _deployment_connector_enabled(request, template):
        raise HTTPException(409, "Connector template or deployment adapter is no longer available.")
    if not template.get("is_enabled_by_policy", True):
        raise HTTPException(403, "Connector execution is blocked by release policy.")
    try:
        updated = await store.set_environment_connection_enabled(
            principal.tenant_id, principal.project_id, instance_id, connection_id, True
        )
    except ValueError as exc:
        raise HTTPException(412, str(exc)) from None
    return updated



@router.post("/projects/{project_id}/connectors/{instance_id}/enable")
async def enable_project_connector(
    project_id: str, instance_id: str, request: Request, principal: Principal
):
    """Enable a connector instance. Gated on valid candidate configuration and a fresh passing test."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")

    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not instance:
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    if instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")

    # 1. Retrieve the immutable template definition for validation.
    template_found = await _find_template(
        request, instance["template_id"], instance.get("template_version", "1.0.0")
    )
    if not template_found or template_found.get("status", template_found.get("availability", "published")) != "published":
        raise HTTPException(409, "The connector template version is no longer available.")
    if not _deployment_connector_enabled(request, template_found):
        raise HTTPException(409, "Connector adapter is disabled by deployment configuration.")

    # 2. Strictly validate the persisted definition and every required
    # environment binding. A passing result for one environment cannot activate
    # a different environment's resource.
    persisted = _instance_candidate(instance)
    dependency = persisted.get("environment_dependency")
    bindings = [binding for binding in persisted.get("bindings", []) if isinstance(binding, dict)]
    _validate_project_environment_bindings(request, principal, bindings)
    if dependency == "dependent":
        environment_ids = [
            binding.get("project_env_id")
            for binding in bindings
            if binding.get("status", "active") == "active"
        ]
        if not environment_ids or len(environment_ids) != len(set(environment_ids)):
            raise HTTPException(422, "Cannot enable connector: active environment bindings must be unique and non-empty.")
    elif bindings:
        active_environment_ids = [
            binding.get("project_env_id")
            for binding in bindings
            if binding.get("status", "active") == "active"
        ]
        if len(active_environment_ids) != len(set(active_environment_ids)) or not all(active_environment_ids):
            raise HTTPException(422, "Cannot enable connector: independent connector bindings are ambiguous.")
        environment_ids = active_environment_ids or [persisted.get("environment_id") or "default"]
    else:
        environment_ids = [persisted.get("environment_id") or "default"]

    for environment_id in environment_ids:
        candidate = _candidate_for_environment(persisted, environment_id)
        if candidate.get("connection_id"):
            connection = next(c for c in instance["environment_connections"] if c["connection_id"] == candidate["connection_id"])
            if connection.get("enabled") is not True or connection.get("status") != "active" or connection.get("test_status") != "passed":
                raise HTTPException(412, "Each assigned environment connection must be validated and enabled first.")
        valid, errors = validate_candidate_configuration(candidate, template_found)
        if not valid:
            raise HTTPException(422, detail=f"Cannot enable connector: {'; '.join(errors)}")
        candidate_hash = compute_candidate_hash(candidate)
        has_passed = await store.has_valid_passing_candidate_test(
            candidate_hash=candidate_hash,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            max_age_seconds=900.0,
            template_id=instance["template_id"],
            template_version=instance.get("template_version", "1.0.0"),
            instance_id=instance_id,
            environment_id=candidate.get("environment_id") or "default",
        )
        if not has_passed:
            raise HTTPException(
                412,
                detail=(
                    "Enablement gate failed: the saved connector configuration must pass "
                    f"a live test for environment '{environment_id}' within the last 15 minutes."
                ),
            )

    try:
        saved = await store.set_project_connector_instance_enabled(
            principal.tenant_id, principal.project_id, instance_id, enabled=True,
            author=principal.subject, expected_revision=instance["revision"],
        )
        return _sanitize_instance_for_project(saved, template_found, principal)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/projects/{project_id}/connectors/{instance_id}/disable")
async def disable_project_connector(
    project_id: str, instance_id: str, request: Request, principal: Principal
):
    """Disable a connector instance."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")

    store = request.app.state.platform_admin
    saved = await store.set_project_connector_instance_enabled(
        principal.tenant_id, principal.project_id, instance_id, enabled=False, author=principal.subject
    )
    template = await _find_template(request, saved["template_id"], saved.get("template_version", "1.0.0"))
    return _sanitize_instance_for_project(saved, template, principal)


@router.delete("/projects/{project_id}/connectors/{instance_id}")
async def delete_project_connector(
    project_id: str, instance_id: str, request: Request, principal: Principal
):
    """Archive / soft-delete a connector instance."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot modify out-of-scope project connectors")

    store = request.app.state.platform_admin
    success = await store.delete_project_connector_instance(principal.tenant_id, principal.project_id, instance_id)
    if not success:
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    return {"status": "archived", "instance_id": instance_id}


@router.get("/projects/{project_id}/connectors/{instance_id}/fields")
async def discover_project_connector_fields(
    project_id: str, instance_id: str, request: Request, principal: Principal,
    environment_id: Optional[str] = Query(default=None, max_length=64),
    include_schema: bool = False,
):
    return await _project_jira_metadata(project_id, instance_id, request, principal, environment_id, include_schema)


@router.post("/projects/{project_id}/connectors/{instance_id}/jql/preview")
async def preview_project_connector_jql(
    project_id: str, instance_id: str, body: JqlQuery, request: Request, principal: Principal,
    environment_id: Optional[str] = Query(default=None, max_length=64),
):
    return await _project_jira_metadata(project_id, instance_id, request, principal, environment_id, True, body)


async def _project_jira_metadata(project_id, instance_id, request, principal, environment_id, include_schema=False, query=None):
    """Resolve and validate one saved instance before reading real Jira metadata."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot access out-of-scope project connectors")
    store = request.app.state.platform_admin
    instance = await store.get_project_connector_instance(
        principal.tenant_id, principal.project_id, instance_id
    )
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    if instance.get("status") not in {"draft", "enabled"}:
        raise HTTPException(409, "Connector field discovery requires a saved draft or enabled instance.")
    template = await _find_template(
        request, instance.get("template_id"), instance.get("template_version", "1.0.0")
    )
    if not template or template.get("status", template.get("availability", "published")) != "published":
        raise HTTPException(409, "The connector template version is no longer available.")
    if not _deployment_connector_enabled(request, template):
        raise HTTPException(409, "Connector adapter is disabled by deployment configuration.")
    if instance.get("template_id") != "itsm" and template.get("provider_adapter_id") != "itsm":
        raise HTTPException(409, "Field discovery is currently supported only for Jira instances.")

    definition = instance.get("definition_json") or {}
    dependency = definition.get("environment_dependency") or instance.get("environment_dependency")
    active_bindings = [
        binding for binding in instance.get("bindings", [])
        if isinstance(binding, dict) and binding.get("status", "active") == "active"
    ]
    _validate_project_environment_bindings(
        request,
        principal,
        [binding for binding in instance.get("bindings", []) if isinstance(binding, dict)],
    )
    if dependency == "dependent":
        if environment_id is None:
            if len(active_bindings) != 1:
                raise HTTPException(409, "Field discovery requires an explicit environment binding.")
            environment_id = active_bindings[0].get("project_env_id")
        elif not any(binding.get("project_env_id") == environment_id for binding in active_bindings):
            raise HTTPException(422, "Requested environment is not an active saved binding.")
    elif environment_id is not None and not any(
        binding.get("project_env_id") == environment_id for binding in active_bindings
    ):
        raise HTTPException(422, "Requested environment is not an active saved binding.")
    candidate = _instance_candidate(instance)
    try:
        candidate = _candidate_for_environment(candidate, environment_id)
    except HTTPException:
        raise
    valid, errors = validate_candidate_configuration(candidate, template)
    if not valid:
        raise HTTPException(422, detail="Saved connector configuration invalid: " + "; ".join(errors))
    # Drafts can be inspected after full validation without being activated.
    resolvable = dict(instance)
    resolvable["status"] = "enabled"
    resolvable["enabled"] = True
    try:
        provider = resolve_project_connector(
            resolvable,
            environment_id=environment_id,
            deployment_tenant_id=principal.tenant_id,
            deployment_project_id=principal.project_id,
            allowed_secret_references=_allowed_secret_references(request, template, candidate),
            allowed_hosts=_allowed_endpoint_hosts(request),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if not isinstance(provider, JiraConnector):
        await provider.aclose()
        raise HTTPException(409, "Saved instance does not resolve to the Jira provider.")
    try:
        limiter = getattr(request.app.state, "integration_probe_limiter", _CANDIDATE_TEST_SEMAPHORE)
        async with limiter, asyncio.timeout(float(candidate.get("timeout_seconds", 30))):
            fields = await provider.discover_fields(include_schema=include_schema)
            if query is not None:
                generated_jql = build_jql(provider.project_key, query, fields)
                await provider.validate_jql(generated_jql)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except asyncio.TimeoutError:
        raise HTTPException(504, "Jira metadata or query validation timed out") from None
    except Exception:
        raise HTTPException(502, "Jira metadata or query validation failed") from None
    finally:
        await provider.aclose()
    result = {
        "instance_id": instance_id,
        "instance_revision": instance.get("revision"),
        "template_id": instance["template_id"],
        "template_version": instance.get("template_version", "1.0.0"),
        "fields": fields,
    }
    if include_schema:
        result["query_fields"] = [item for field in fields if (item := field_contract(field)) is not None]
    if query is not None:
        result["jql"] = generated_jql
        result["execution_enabled"] = False
        result["validation"] = "jira_strict"
    return result


# -----------------------------------------------------------------------------
# CANDIDATE VALIDATION & TESTING ENGINE
# -----------------------------------------------------------------------------

@router.post("/projects/{project_id}/connectors/{instance_id}/test")
async def test_saved_connector(
    project_id: str, instance_id: str, request: Request, principal: Principal,
    environment_id: Optional[str] = Query(default=None, max_length=64),
):
    """Project administrators test assigned identities without receiving credentials."""
    require_roles(principal, ADMIN_ROLES)
    if principal.project_id != project_id:
        raise HTTPException(403, "Caller cannot access out-of-scope project connectors")
    instance = await request.app.state.platform_admin.get_project_connector_instance(
        principal.tenant_id, principal.project_id, instance_id,
    )
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, "Connector instance not found")
    candidate = _instance_candidate(instance)
    if environment_id:
        candidate["environment_id"] = environment_id
    return await test_candidate(CandidateTestPayload(candidate=candidate), request, principal)


@router.post("/connectors/validate")
async def validate_candidate(payload: CandidateValidatePayload, request: Request, principal: Principal):
    """Validate candidate configuration schema, bounds, and conditional auth fields."""
    template_id = payload.candidate.get("template_id")
    template_version = payload.candidate.get("template_version", "1.0.0")

    template = await _find_template(request, template_id, template_version)
    if not template:
        raise HTTPException(400, f"Referenced template '{template_id}' not found")

    candidate = payload.candidate
    binding_errors: list[str] = []
    try:
        _validate_project_environment_bindings(
            request,
            principal,
            candidate.get("bindings", []) or [],
        )
    except HTTPException as exc:
        binding_errors.append(str(exc.detail))
    try:
        candidate = _candidate_for_environment(candidate, candidate.get("environment_id"))
    except HTTPException as exc:
        binding_errors.append(str(exc.detail))
    valid, errors = validate_candidate_configuration(candidate, template)
    errors = binding_errors + errors
    if binding_errors:
        valid = False
    if not _deployment_connector_enabled(request, template):
        valid = False
        errors.append("Connector adapter is disabled by deployment configuration.")
    candidate_hash = compute_candidate_hash(candidate)
    return {
        "valid": valid,
        "errors": errors,
        "candidate_hash": candidate_hash,
    }


@router.post("/connectors/test")
async def test_candidate(payload: CandidateTestPayload, request: Request, principal: Principal):
    """Run an isolated live test on candidate connector values and persist results."""
    require_roles(principal, ADMIN_ROLES)
    store = request.app.state.platform_admin
    template_id = payload.candidate.get("template_id")
    template_version = payload.candidate.get("template_version", "1.0.0")

    template = await _find_template(request, template_id, template_version)
    if not template:
        raise HTTPException(400, f"Referenced template '{template_id}' not found")
    if template.get("status", template.get("availability", "published")) != "published":
        raise HTTPException(409, "Candidate testing requires the exact published template version.")
    if not _deployment_connector_enabled(request, template):
        raise HTTPException(409, "Connector adapter is disabled by deployment configuration.")

    instance_id = payload.candidate.get("instance_id")
    if not isinstance(instance_id, str) or not instance_id:
        raise HTTPException(422, "Candidate testing requires the saved project connector instance_id.")
    instance = await store.get_project_connector_instance(
        principal.tenant_id, principal.project_id, instance_id
    )
    if not instance or instance.get("status") == "archived":
        raise HTTPException(404, f"Connector instance '{instance_id}' not found")
    if (
        instance.get("template_id") != template_id
        or instance.get("template_version", "1.0.0") != template_version
    ):
        raise HTTPException(409, "Candidate template version does not match the saved connector instance.")
    persisted = _instance_candidate(instance)
    _validate_project_environment_bindings(
        request,
        principal,
        [binding for binding in persisted.get("bindings", []) if isinstance(binding, dict)],
    )

    candidates = [payload.candidate]
    if payload.operation == "test_all_environments":
        bindings = payload.candidate.get("bindings") or payload.candidate.get("environment_mappings") or []
        if not bindings:
            raise HTTPException(422, "Test all environments requires at least one environment binding.")
        _validate_project_environment_bindings(request, principal, bindings)
        candidates = []
        for binding in bindings:
            candidate = dict(payload.candidate)
            candidate["environment_id"] = binding.get("project_env_id")
            candidate["external_resource"] = binding.get("external_resource") or candidate.get("external_resource")
            candidate["tool_environment"] = binding.get("tool_env_id") or candidate.get("tool_environment")
            candidates.append(candidate)

    checked_candidates = []
    for candidate in candidates:
        environment_id = candidate.get("environment_id")
        checked = _candidate_for_environment(persisted, environment_id)
        requested = _candidate_for_environment(candidate, environment_id)
        if compute_candidate_hash(requested) != compute_candidate_hash(checked):
            raise HTTPException(
                409,
                "Candidate configuration does not match the saved connector instance and environment binding.",
            )
        checked_candidates.append(requested)
    candidates = checked_candidates

    results = []
    connection_results: dict[str, list[bool]] = {}
    for candidate in candidates:
        result = await execute_candidate_test(
            candidate,
            template,
            "test_connection" if payload.operation == "test_all_environments" else payload.operation,
            allowed_secret_references=_allowed_secret_references(request, template, candidate),
            allowed_endpoint_hosts=_allowed_endpoint_hosts(request),
        )
        await store.save_candidate_test_result(
            candidate_hash=result["candidate_hash"],
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            instance_id=candidate.get("instance_id", "candidate"),
            template_id=template_id,
            template_version=template_version,
            environment_id=candidate.get("environment_id") or "default",
            operation=payload.operation,
            overall_result=result["overall_result"],
            stage_results=result["stage_results"],
            latency_ms=result["latency_ms"],
            evidence_summary=result.get("evidence_summary", ""),
            error_message=result.get("error_message", ""),
        )
        results.append(result)
        if candidate.get("connection_id"):
            connection_results.setdefault(candidate["connection_id"], []).append(result["overall_result"] == "PASSED")

    for connection_id, outcomes in connection_results.items():
        connection = next(c for c in instance["environment_connections"] if c["connection_id"] == connection_id)
        try:
            await store.update_environment_connection_test_status(
                principal.tenant_id, principal.project_id, instance_id, connection_id,
                "passed" if all(outcomes) else "failed", expected_updated_at=connection["updated_at"],
            )
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    if len(results) == 1:
        return results[0]
    return {
        "overall_result": "PASSED" if all(item["overall_result"] == "PASSED" for item in results) else "FAILED",
        "results": results,
        "candidate_hashes": [item["candidate_hash"] for item in results],
    }
