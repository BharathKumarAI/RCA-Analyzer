"""Connector templates and project connector instances management API.

Provides versioned lifecycle management, typed candidate validation,
isolated live testing, and enablement gates.
"""

from __future__ import annotations

import hashlib
import json
import asyncio
from typing import Any, Dict, List, Literal, Optional, Set
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.api.dependencies import Principal, require_roles
from app.identity.principals import Role
from app.configuration.models import ConnectorTemplate
from app.connectors.candidate_testing import (
    compute_candidate_hash,
    validate_candidate_configuration,
    execute_candidate_test,
    _validate_secret_fields,
    _CANDIDATE_TEST_SEMAPHORE,
)
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.registry import resolve_project_connector

router = APIRouter(prefix="/api/v1", tags=["connectors"])

ADMIN_ROLES = {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}


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
    narrowing_filters_json: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["active", "inactive"] = "active"


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
    bindings: List[EnvironmentBindingPayload] = Field(default_factory=list)


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
        return _normalise_template(record)
    platform_templates = getattr(request.app.state.platform, "connector_templates", ())
    for item in platform_templates:
        data = _normalise_template(item)
        if (data.get("system_name") == template_id or data.get("type") == template_id) and (
            version is None or data.get("version", "1.0.0") == version
        ):
            return data
    return None


def _allowed_secret_references(request: Request, template: Dict[str, Any]) -> Set[str]:
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


def _sanitize_instance_for_project(
    instance: Dict[str, Any], template: Dict[str, Any] | None, principal: Principal
) -> Dict[str, Any]:
    """Strip platform_only parameter fields from project-scoped responses for non-platform admins."""
    if Role.PLATFORM_ADMIN in principal.roles or not template:
        return instance
    param_fields = template.get("parameter_fields") or []
    platform_only_vars = {
        pf.get("variable_name") if isinstance(pf, dict) else getattr(pf, "variable_name", None)
        for pf in param_fields
        if _field_governance_tier(pf) == "platform_only"
    } - {None}
    if not platform_only_vars:
        return instance
    copied = dict(instance)
    def_json = dict(copied.get("definition_json") or {})
    for k in platform_only_vars:
        def_json.pop(k, None)
    copied["definition_json"] = def_json
    return copied


def _project_candidate(payload: ProjectConnectorInstancePayload, template: Dict[str, Any]) -> Dict[str, Any]:
    raw_def = {**(payload.definition or {}), **(payload.definition_json or {})}
    # Project-owned identity and environment controls cannot be shadowed by
    # arbitrary keys nested in the connector-specific definition.
    for key in ("template_id", "template_version", "system_name", "environment_dependency",
                "environment_dependent", "tool_environment", "bindings"):
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
    return result


def _validate_template_definition(template_id: str, version: str, definition: Dict[str, Any]) -> Dict[str, Any]:
    """Validate a published template with the same typed contract as YAML."""
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


# -----------------------------------------------------------------------------
# PLATFORM CONNECTOR TEMPLATES
# -----------------------------------------------------------------------------

@router.get("/connectors/templates")
async def list_templates(request: Request, principal: Principal, status: Optional[str] = None):
    """List platform connector templates."""
    store = request.app.state.platform_admin
    db_templates = await store.list_connector_templates(status)
    result = []
    db_keys = set()
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
    return result


@router.get("/connectors/templates/{template_id}")
async def get_template(
    template_id: str, request: Request, principal: Principal, version: Optional[str] = None
):
    """Retrieve a single platform connector template by ID."""
    template = await _find_template(request, template_id, version)
    if template:
        return template

    raise HTTPException(404, f"Connector template '{template_id}' not found")


@router.post("/connectors/templates")
async def save_template(payload: TemplateSavePayload, request: Request, principal: Principal):
    """Save a draft connector template (PLATFORM_ADMIN only)."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    store = request.app.state.platform_admin
    definition = payload.definition
    if payload.status == "published":
        definition = _validate_template_definition(payload.template_id, payload.version, definition)
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
        _validate_template_definition(
            template_id,
            version,
            record.get("definition_json") if isinstance(record.get("definition_json"), dict) else {},
        )
        return await store.publish_connector_template(template_id, version, principal.subject)
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
        return await store.deprecate_connector_template(template_id, version, principal.subject)
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
    if not template.get("is_enabled_by_policy", True) or template.get("type") == "oracle":
        raise HTTPException(403, "Database querying and Oracle execution are blocked by policy.")

    # Validate candidate settings against template (drafts can be saved incomplete)
    candidate = _project_candidate(payload, template)

    # Enforce template governance allowlist for non-PLATFORM_ADMIN callers
    if Role.PLATFORM_ADMIN not in principal.roles:
        param_fields = template.get("parameter_fields") or []
        for pf in param_fields:
            var_name = pf.get("variable_name") if isinstance(pf, dict) else getattr(pf, "variable_name", None)
            if not var_name or var_name in {"system_name", "environment_dependency", "tool_environment"}:
                continue
            tier = _field_governance_tier(pf)
            if tier in ("platform_only", "project_locked"):
                incoming_val = candidate.get(var_name)
                default_val = pf.get("default_value") if isinstance(pf, dict) else getattr(pf, "default_value", None)
                if incoming_val is not None and incoming_val != default_val:
                    raise HTTPException(
                        403,
                        detail=f"Field '{var_name}' is locked by platform policy ({tier}) and cannot be modified by project roles."
                    )
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

    bindings_dict = [b.model_dump() for b in payload.bindings]
    _validate_project_environment_bindings(request, principal, bindings_dict)

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
                **{key: value for key, value in candidate.items() if key not in {"template_id", "template_version", "system_name", "environment_dependency", "tool_environment", "bindings"}},
            },
            expected_revision=payload.expected_revision,
            author=principal.subject,
            bindings=bindings_dict,
        )
        return saved
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


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

    # Policy gate
    if instance.get("template_id") == "oracle" or instance.get("system_name") == "oracle":
        raise HTTPException(403, "Oracle connector execution is blocked by policy.")

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
        if len(active_environment_ids) > 1 or not all(active_environment_ids):
            raise HTTPException(422, "Cannot enable connector: independent connector bindings are ambiguous.")
        environment_ids = active_environment_ids or [persisted.get("environment_id") or "default"]
    else:
        environment_ids = [persisted.get("environment_id") or "default"]

    for environment_id in environment_ids:
        candidate = _candidate_for_environment(persisted, environment_id)
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
        return await store.set_project_connector_instance_enabled(
            principal.tenant_id, principal.project_id, instance_id, enabled=True,
            author=principal.subject, expected_revision=instance["revision"],
        )
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
    return await store.set_project_connector_instance_enabled(
        principal.tenant_id, principal.project_id, instance_id, enabled=False, author=principal.subject
    )


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
    project_id: str,
    instance_id: str,
    request: Request,
    principal: Principal,
    environment_id: Optional[str] = Query(default=None, max_length=64),
):
    """Discover Jira custom fields from one enabled saved project instance.

    Discovery is an informational read and is intentionally independent from
    the candidate-test result used by the enablement gate.
    """
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
            allowed_secret_references=_allowed_secret_references(request, template),
            allowed_hosts=_allowed_endpoint_hosts(request),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if not isinstance(provider, JiraConnector):
        await provider.aclose()
        raise HTTPException(409, "Saved instance does not resolve to the Jira provider.")
    try:
        limiter = getattr(request.app.state, "integration_probe_limiter", _CANDIDATE_TEST_SEMAPHORE)
        async with limiter:
            fields = await asyncio.wait_for(
                provider.discover_fields(),
                timeout=float(candidate.get("timeout_seconds", 30)),
            )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Jira field discovery timed out") from None
    except Exception:
        raise HTTPException(502, "Jira field discovery failed") from None
    finally:
        await provider.aclose()
    return {
        "instance_id": instance_id,
        "template_id": instance["template_id"],
        "template_version": instance.get("template_version", "1.0.0"),
        "fields": fields,
    }


# -----------------------------------------------------------------------------
# CANDIDATE VALIDATION & TESTING ENGINE
# -----------------------------------------------------------------------------

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
    for candidate in candidates:
        result = await execute_candidate_test(
            candidate,
            template,
            "test_connection" if payload.operation == "test_all_environments" else payload.operation,
            allowed_secret_references=_allowed_secret_references(request, template),
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

    if len(results) == 1:
        return results[0]
    return {
        "overall_result": "PASSED" if all(item["overall_result"] == "PASSED" for item in results) else "FAILED",
        "results": results,
        "candidate_hashes": [item["candidate_hash"] for item in results],
    }
