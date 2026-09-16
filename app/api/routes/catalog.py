import asyncio
import hashlib
from dataclasses import asdict
import os
from pathlib import Path
import re
import resource
import tempfile
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
import yaml

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.capabilities.resolver import CapabilityResolver
from app.tools.catalog import TOOL_ACTIONS
from app.connectors.providers.registry import NATIVE_FACTORIES
from app.configuration.models import ProjectLayer
from app.configuration.models import CatalogSkill
from app.configuration.harness_bundles import BUILTINS
from app.configuration.project_templates import project_template_context
from app.configuration.connector_catalog import refresh_published_templates
from app.configuration.yaml_data import load_yaml_data
from app.connectors.health import CheckStatus, ConnectorHealth
from app.connectors.providers.project_storage import project_prefix
from app.configuration.database_bundle import update_bundle_file
from app.models.profiles import ModelProfiles, StageModel
from app.runtime.run_contract import content_hash
from app.identity.principals import Role, UserPrincipal
from app.observability.otel import telemetry_status
from app.persistence.platform_admin import DEFAULT_PERMISSIONS, DEFAULT_SYSTEM_ROLES
from app.api.dependencies import Principal, require_roles
from app.api.schemas import ReviewRequest
from app.configuration.knowledge import KnowledgeInput as KnowledgeCreatePayload
from app.configuration.knowledge import KnowledgeUpdate as KnowledgeUpdatePayload
from app.api.routes.knowledge_uploads import knowledge_result
from app.configuration.model_pricing import ModelRate, read_pricing
from app.persistence.telemetry import telemetry

router = APIRouter()

# All configuration exposed by the admin console is scoped to the authenticated
# deployment tenant/project.  Keep the write boundary in the route layer so a
# read-only principal cannot mutate state by calling the API directly.
MANAGEMENT_ROLES = {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}


class ProjectConfigPayload(BaseModel):
    yaml: str
    expected_project_revision: str | None = None
    expected_editor_version: int | None = Field(default=None, ge=0)


class SystemConnectionTestPayload(BaseModel):
    target: Literal["all", "database", "memory", "storage", "mlflow", "connectors"] = "all"


class UserCreatePayload(BaseModel):
    id: str
    name: str
    email: str | None = None
    roles: list[str] = ["GENERIC_USER"]
    status: str = "active"


class UserUpdatePayload(BaseModel):
    name: str
    email: str | None = None
    roles: list[str] = ["GENERIC_USER"]
    status: str = "active"


class RoleCreatePayload(BaseModel):
    id: str
    name: str
    description: str
    permissions: list[str] = []
    status: str = "active"


class RoleUpdatePayload(BaseModel):
    name: str
    description: str
    permissions: list[str] = []
    status: str = "active"


class BillingUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    tier: str = "Standard"
    monthly_spend_budget: float = Field(default=500.0, ge=0, le=1000000000)
    monthly_token_budget: int = Field(default=50000000, ge=0, le=1000000000000)
    max_concurrent_investigations: int = 4
    rate_limit_rpm: int = 60
    rate_limit_tpm: int = 250000
    alert_threshold_percent: int = 80
    webhook_url: str | None = ""
    pricing_matrix: dict[str, ModelRate] = Field(default_factory=dict, max_length=128)


class PolicyUpdatePayload(BaseModel):
    redaction_patterns: list[dict[str, Any]] = []
    guardrails: dict[str, Any] = {}
    skill_guardrails: dict[str, Any] = {}


class FileLimitsUpdatePayload(BaseModel):
    max_file_bytes: int = 10485760
    max_files: int = 10
    max_text_chars: int = 50000
    max_pdf_pages: int = 20
    max_rows: int = 2000
    max_cells: int = 20000
    parser_timeout_seconds: int = 30
    concurrency: int = 4
    allowed_extensions: list[str] = [".txt", ".log", ".json", ".csv"]
    retention_days: int = 90
    auto_prune_enabled: bool = True


class RuntimeStageUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    thinking_level: str | None = None
    thinking_budget: int | None = None
    output_limit: int = 4096
    temperature: float = 0.2
    enabled: bool = True
    expected_hash: str


class AlertCreatePayload(BaseModel):
    severity: str = "warning"
    source: str = "operator"
    component: str = "platform"
    title: str
    summary: str
    message: str


class AlertStatusUpdatePayload(BaseModel):
    status: str
    resolution_note: str | None = None


class AlertConfigUpdatePayload(BaseModel):
    mttr_warning_minutes: int = 45
    tool_failure_rate_percent: int = 15
    probe_latency_warning_ms: int = 2500


class PlatformSettingsUpdatePayload(BaseModel):
    run_timeout_seconds: int = Field(default=120, ge=1, le=900)
    max_concurrent_runs: int = Field(default=4, ge=1, le=64)
    max_llm_calls: int = Field(default=12, ge=1, le=100)
    max_input_chars: int = Field(default=16000, ge=100, le=16000)
    max_context_chars: int = Field(default=64000, ge=1000, le=256000)
    retention_days: int = Field(default=90, ge=1, le=2555)
    allowed_extensions: list[str] = [".txt", ".log", ".json", ".csv", ".pdf"]
    mode: str = "live"


_PROJECT_SETUP_SAMPLE_YAML = """# ==============================================================================
# RCA assist - Project Configuration Template
# ==============================================================================
# Governed by platform policy (platform.yaml).
# Delegated sections: skills, capabilities, disabled_connectors, limits, workflow, prompts, preferences, environments.
# Rules enabled on the platform level define what can be overridden for each project.
# ==============================================================================

tenant_id: {tenant_id}
project_id: {project_id}

allow_user_preferences:
  - presentation
  - detail

allow_user_overrides:
  - incident-triage
  - log-correlation

preferences:
  presentation: summary
  detail: standard

disabled_connectors: []

capabilities:
  incident_triage:
    enabled: true
    model_profile: balanced-investigation
    allowed_roles:
      - PLATFORM_ADMIN
      - PROJECT_OWNER
      - PROJECT_MANAGER
      - PROJECT_ANALYST
    allowed_actions:
      - itsm.get_ticket
      - log_search.query_range

  log_correlation:
    enabled: true
    model_profile: balanced-investigation
    allowed_roles:
      - PLATFORM_ADMIN
      - PROJECT_OWNER
      - PROJECT_ANALYST
    allowed_actions:
      - log_search.query_range

limits:
  max_llm_calls: 12
  max_tool_calls: 4
  max_context_chars: 64000
  max_evidence_items: 100
  max_evidence_chars: 12000
  run_timeout_seconds: 120.0

workflow:
  planning: true
  attachments: true
  specialists: true
  parallel_evidence: true

prompts:
  orchestrator: >
    Classify the request into one or more supported types: triage, root_cause_analysis,
    tool_data_request, metrics, sanity_check, project_knowledge, generic_answer,
    follow_up, or rerun. Select only the agents, tools, and connectors needed for the
    classified types. Plan bounded read-only work and identify missing data. Select
    summary, table, timeline, dashboard, or report presentation.
  triage: >
    You are the incident triage stage. Retrieve the requested ticket using get_ticket
    when an incident ID is present. Extract the time anchor, observed impact, affected
    components and provisional hypotheses. Cite returned evidence IDs. If the request
    has no ticket ID, state that the ticket source is unavailable; do not invent one.
  logs: >
    You are the log investigator. Use query_range with a short literal search term
    and a bounded time window. Prefer the explicit incident time from triage. Do not
    assume current logs describe a historic incident. If no usable time is known,
    use the configured default lookback and call out that limitation. Cite evidence IDs.
  extraction: >
    Summarize the supplied attachment observations, timestamps, tables, and relevant
    anomalies. Preserve evidence IDs and distinguish source facts from speculation.
    Documents and OCR text may be incomplete. Report any extraction limitations.
  router: >
    Choose only project specialists relevant to the current incident from the approved
    agent tools. If none is relevant, say so without calling any. Delegate a narrowly
    scoped question and summarize their contributions, retaining actual evidence IDs.
  synthesis: >
    Produce an InvestigationResult JSON object. Ground every finding exclusively in
    the supplied evidence; cite actual evidence IDs. Separate correlation from proven
    causation. If evidence cannot establish a cause, use INSUFFICIENT_EVIDENCE and
    explain what is missing. Do not force a single root cause. Include contradictions
    and uncertainty. Recommended actions are proposals only.

skills:
  incident-triage:
    enabled: true
    instruction: >
      Resolve the incident anchor, determine severity, and identify the owning team.
      Ground all claims in captured ITSM evidence.
    actions:
      - itsm.get_ticket

  log-correlation:
    enabled: true
    instruction: >
      Correlate application and system logs around the incident time anchor.
      Identify stack traces, error rate spikes, and correlated services.
    actions:
      - log_search.query_range

environments: []
"""


def _alert_severity(status: CheckStatus) -> str:
    if status in {
        CheckStatus.UNHEALTHY,
        CheckStatus.AUTHENTICATION_ERROR,
        CheckStatus.AUTHORIZATION_ERROR,
        CheckStatus.SCHEMA_MISMATCH,
    }:
        return "critical"
    if status in {CheckStatus.DEGRADED, CheckStatus.RATE_LIMITED}:
        return "warning"
    return "info"


def _read_reference_file(
    candidate_paths: list[Path],
    projects_root: Path,
    tenant_id: str = "YOUR_TENANT_ID",
    project_id: str = "YOUR_PROJECT_ID",
) -> tuple[dict[str, Any], dict[str, Any]]:
    base = projects_root.resolve()
    for path in candidate_paths:
        if not path or not path.is_file():
            continue
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if not str(resolved).startswith(str(base) + os.sep) and not str(
            resolved
        ).endswith("references/sample.yaml"):
            continue
        try:
            return {
                "path": (
                    str(resolved.relative_to(base))
                    if str(resolved).startswith(str(base) + os.sep)
                    else "sample.yaml"
                ),
                "exists": True,
                "status": "read",
            }, {"content": resolved.read_text(encoding="utf-8")}
        except OSError:
            continue
    return {
        "path": "sample.yaml",
        "exists": False,
        "status": "template",
    }, {
        "content": _PROJECT_SETUP_SAMPLE_YAML.format(
            tenant_id=tenant_id, project_id=project_id
        )
    }


def _project_file_candidates(
    projects_root: Path, tenant_id: str, project_id: str
) -> list[Path]:
    root = projects_root / project_prefix(tenant_id, project_id)
    repo_root = Path(__file__).resolve().parents[3]
    return [
        root / "configuration" / "project.yaml",
        root / "configuration" / "project.yaml.example",
        *sorted(
            projects_root.glob(
                f"{project_prefix(tenant_id, project_id)}/configuration/project.yaml"
            )
        ),
        *sorted(
            projects_root.glob(
                f"{project_prefix(tenant_id, project_id)}/configuration/project.yaml.example"
            )
        ),
        projects_root / "sample.yaml",
        projects_root / "project.yaml.example",
        repo_root / "blob_local" / "projects" / "sample.yaml",
        repo_root / "blob_local" / "projects" / "project.yaml.example",
        repo_root / "references" / "sample.yaml",
    ]


async def _save_project_file(request: Request, principal: Principal, content: str, *, expected_bundle_hash=None, expected_editor_version=None) -> Path:
    """Write the active materialization and persist it when DB configuration is enabled."""
    projects_root = Path(request.app.state.settings.projects_root)
    target_file = (
        projects_root
        / project_prefix(principal.tenant_id, principal.project_id)
        / "configuration"
        / "project.yaml"
    )
    if len(content.encode("utf-8")) > 65536:
        raise ValueError("Project configuration exceeds 64 KiB")
    if request.app.state.settings.database_configuration:
        await update_bundle_file(
            request.app.state.store.engine,
            request.app.state.settings,
            f"projects/{project_prefix(principal.tenant_id, principal.project_id)}/configuration/project.yaml",
            content,
            expected_bundle_hash=expected_bundle_hash,
            expected_editor_version=expected_editor_version,
        )
    def materialize():
        target_file.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=target_file.parent, prefix=".project-")
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(content)
            os.replace(temporary, target_file)
        finally:
            Path(temporary).unlink(missing_ok=True)
    if expected_editor_version is not None and not request.app.state.settings.database_configuration:
        from app.configuration.projects import apply_project_details
        async with request.app.state.store.engine.begin() as connection:
            await apply_project_details(connection, request.app.state.settings, expected_editor_version)
            materialize()
    else:
        materialize()
    return target_file


async def _save_model_profiles(request: Request, content: str) -> None:
    """Persist model profiles to the active source of truth and materialize it."""
    settings = request.app.state.settings
    if settings.database_configuration:
        await update_bundle_file(
            request.app.state.store.engine,
            settings,
            "config/model_profiles.yaml",
            content,
        )
    target = Path(settings.config_dir) / "model_profiles.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _default_connector_action(connector_id: str) -> str:
    if connector_id == "itsm":
        return "itsm.get_ticket"
    if connector_id == "log_search":
        return "log_search.query_range"
    return next((action for action in TOOL_ACTIONS.values() if action.startswith(connector_id + ".")), f"{connector_id}.probe")


def _connector_templates_by_system(request: Request) -> dict[str, Any]:
    return {
        template.system_name: template
        for template in request.app.state.platform.connector_templates
    }


async def _connector_template_catalog(request: Request) -> tuple[tuple[Any, ...], tuple[Any, ...]]:
    """Return inventory and executable templates from the lifecycle source."""
    platform = await refresh_published_templates(request.app.state.platform, request.app.state.platform_admin)
    inventory = platform.connector_templates
    return inventory, tuple(item for item in inventory if item.availability == "published")


def _all_connectors(request: Request, templates=None) -> tuple[set[str], dict[str, Any]]:
    template_by_system = (
        _connector_templates_by_system(request)
        if templates is None
        else {template.system_name: template for template in templates}
    )
    all_connectors = set(request.app.state.runner.connectors) | set(
        template_by_system.keys()
    )
    return all_connectors, template_by_system


def _template_parameter_payload(
    template, rows, *, visible_only: bool = False
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    fields = {field.variable_name: field for field in template.parameter_fields}
    result = []
    bindings = {}
    for row in rows:
        if row.get("tool") != template.system_name:
            continue
        if visible_only and not row.get("project_visible", True):
            continue
        name = row["variable_name"]
        field = fields.get(name)
        item = {
            key: value
            for key, value in row.items()
            if key not in {"tenant_id", "project_id", "override_value", "override_revision"}
        }
        if row.get("value_type") == "secret_ref" or (field and field.sensitivity in {"masked", "secret_reference"}):
            item.update(default_value=None, effective_value=None, redacted=True)
        if field is not None:
            item.update({
                "label": field.label or name,
                "template_editable": field.template_editable,
                "runtime_binding": field.runtime_binding,
                "minimum": field.minimum,
                "maximum": field.maximum,
                "max_length": field.max_length,
            })
            if field.runtime_binding:
                bindings[name] = field.runtime_binding
        result.append(item)
    return result, bindings


def _template_payload(template, rows, *, visible_only: bool = False) -> dict[str, Any]:
    parameters, bindings = _template_parameter_payload(
        template, rows, visible_only=visible_only
    )
    return {
        **template.model_dump(mode="json"),
        "template_source": "platform.connector_templates",
        "template_version": template.version,
        "effective_parameters": parameters,
        "runtime_bindings": bindings,
    }


async def _agent_bindings(request: Request, principal: Principal, capability: str) -> list[dict[str, Any]]:
    """Project approved specialist definitions into the capability catalog."""
    service = getattr(request.app.state, "configurations", None)
    if service is None:
        return []
    approved = await service.approved(principal, capability)
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    available = set(request.app.state.runner.connectors) - disabled
    resolved = CapabilityResolver(request.app.state.registry).resolve(
        capability, principal, check_health=False
    )
    if not request.app.state.registry.get(capability):
        return []
    # Use the same effective contract as execution so project action/role
    # reductions are reflected in the catalog.
    definition = resolved.capability
    runtime = request.app.state.registry.inheritance.runtime(
        principal,
        request.app.state.settings,
        request.app.state.platform.prompts,
    )
    specialists_enabled = runtime["workflow"].specialists
    triage_stage_enabled = request.app.state.runner.profiles.resolve(
        definition.model_profile
    )["triage"].enabled
    declared_connectors = set(definition.requires.connectors) | set(
        definition.optional.connectors
    )
    bindings = []
    for draft in approved:
        tools = list(draft.definition.tools)
        connectors = sorted({tool.split(".", 1)[0] for tool in tools if "." in tool})
        profile_stages = request.app.state.runner.profiles.resolve(
            draft.definition.model_profile
        )
        stage_config = profile_stages.get(draft.definition.stage_model) or request.app.state.runner.profiles.stages.get(
            draft.definition.stage_model
        )
        connectors_configured = all(connector in available for connector in connectors)
        tools_allowed = set(tools).issubset(definition.allowed_actions)
        bindings.append(
            {
                "id": draft.definition.id,
                "name": draft.definition.name,
                "stage_model": draft.definition.stage_model,
                "model_profile": draft.definition.model_profile,
                "tools": tools,
                "connectors": connectors,
                "enabled": (
                    resolved.is_authorized
                    and specialists_enabled
                    and triage_stage_enabled
                    and stage_config is not None
                    and stage_config.enabled
                    and connectors_configured
                    and set(connectors).issubset(declared_connectors)
                    and tools_allowed
                ),
                "connectors_configured": connectors_configured,
                "status": draft.status,
            }
        )
    return bindings


def _connector_not_configured_health(
    connector_id: str, mode: str, template: bool = False
) -> ConnectorHealth:
    status = (
        CheckStatus.DEGRADED
        if template
        else CheckStatus.UNHEALTHY
    )
    message = (
        "Connector is defined by platform templates and waiting for runtime initialization."
        if template
        else "Connector is referenced without a template or live provider."
    )
    if mode == "demo":
        message = (
            "Connector metadata is present but probing is unavailable in demo mode."
            if template
            else message
        )
    return ConnectorHealth(
        connector_id=connector_id,
        overall=status,
        latency_ms=0,
        connectivity=CheckStatus.DEGRADED if template else CheckStatus.UNHEALTHY,
        authentication=CheckStatus.DEGRADED if template else CheckStatus.UNHEALTHY,
        authorization=CheckStatus.DEGRADED if template else CheckStatus.UNHEALTHY,
        rate_limit_status=CheckStatus.HEALTHY,
        schema_compatibility=CheckStatus.HEALTHY,
        message=message,
    )


async def _collect_system_diagnostics(request: Request, principal: Principal) -> dict:
    t0 = time.monotonic()
    db_ok = False
    try:
        await request.app.state.store.ping()
        db_ok = True
    except Exception:
        db_ok = False
    db_latency_ms = round((time.monotonic() - t0) * 1000, 2)

    projects_root = Path(request.app.state.settings.projects_root)
    storage_writable = (
        os.access(projects_root, os.W_OK) if projects_root.exists() else False
    )

    usage = resource.getrusage(resource.RUSAGE_SELF)
    is_mac = sys.platform == "darwin"
    rss_mb = round(
        usage.ru_maxrss / (1024 * 1024) if is_mac else usage.ru_maxrss / 1024, 2
    )

    try:
        check_path = projects_root if projects_root.exists() else Path.cwd()
        stat_info = os.statvfs(str(check_path.resolve()))
        disk_free_gb = round(
            (stat_info.f_bavail * stat_info.f_frsize) / (1024**3), 2
        )
        disk_total_gb = round((stat_info.f_blocks * stat_info.f_frsize) / (1024**3), 2)
    except Exception:
        disk_free_gb = 0.0
        disk_total_gb = 0.0

    mlflow_uri = request.app.state.settings.optimization_tracking_uri.get_secret_value()
    mlflow_status = "configured" if mlflow_uri else "unconfigured"

    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    available = set(request.app.state.runner.connectors) - disabled
    conn_result = await request.app.state.runner.health(available)

    return {
        "timestamp": time.time(),
        "database": {
            "status": "healthy" if db_ok else "unreachable",
            "latency_ms": db_latency_ms,
            "dialect": request.app.state.store.engine.dialect.name,
            "schema_version": None,
            "schemas": [],
        },
        "storage": {
            "status": "healthy" if storage_writable else "degraded",
            "path": str(projects_root),
            "writable": storage_writable,
            "disk_free_gb": disk_free_gb,
            "disk_total_gb": disk_total_gb,
            "cas_layout": "sha256",
        },
        "memory": {
            "status": "healthy",
            "rss_mb": rss_mb,
            "active_tasks": len(asyncio.all_tasks()),
        },
        "mlflow": {
            "status": mlflow_status,
            # Tracking URIs can embed credentials; diagnostics never returns them.
            "tracking_uri": "configured" if mlflow_uri else None,
            "experiment_store": "configured" if mlflow_uri else "unconfigured",
            "offline_eval_contracts": ["Quality", "Safety", "Latency", "Cost"],
        },
        "connectors": {
            "mode": request.app.state.settings.mode,
            "results": conn_result,
            "disabled": sorted(disabled),
        },
    }


async def _execute_connection_test(request: Request, principal: Principal, target: str) -> dict:
    results: dict[str, Any] = {}

    if target in ("database", "all"):
        t0 = time.monotonic()
        try:
            await request.app.state.store.ping()
            latency_ms = round((time.monotonic() - t0) * 1000, 2)
            dialect = request.app.state.store.engine.dialect.name
            results["database"] = {
                "target": "database",
                "status": "connected",
                "latency_ms": latency_ms,
                "message": f"Successfully pinged database ({dialect}) in {latency_ms} ms",
                "details": {"dialect": dialect},
            }
        except Exception as exc:
            results["database"] = {
                "target": "database",
                "status": "error",
                "latency_ms": round((time.monotonic() - t0) * 1000, 2),
                "message": f"Database probe failed: {exc}",
                "details": {"error": str(exc)},
            }

    if target in ("memory", "all"):
        t0 = time.monotonic()
        usage = resource.getrusage(resource.RUSAGE_SELF)
        is_mac = sys.platform == "darwin"
        rss_mb = round(
            usage.ru_maxrss / (1024 * 1024) if is_mac else usage.ru_maxrss / 1024, 2
        )
        active_tasks = len(asyncio.all_tasks())
        latency_ms = round((time.monotonic() - t0) * 1000, 2)
        status = "warning" if rss_mb > 2048 else "healthy"
        results["memory"] = {
            "target": "memory",
            "status": status,
            "latency_ms": latency_ms,
            "message": f"Process peak memory: {rss_mb} MB RSS, {active_tasks} active async tasks",
            "details": {
                "rss_mb": rss_mb,
                "active_tasks": active_tasks,
                "platform": sys.platform,
            },
        }

    if target in ("storage", "all"):
        t0 = time.monotonic()
        projects_root = Path(request.app.state.settings.projects_root)
        probe_file = projects_root / f".probe_{int(time.time() * 1000)}.tmp"
        probe_ok = False
        try:
            projects_root.mkdir(parents=True, exist_ok=True)
            probe_bytes = b"rca_analyzer_storage_probe_verification"
            probe_file.write_bytes(probe_bytes)
            if probe_file.read_bytes() == probe_bytes:
                probe_ok = True
            probe_file.unlink(missing_ok=True)
        except Exception:
            probe_ok = False

        disk_free_gb = 0.0
        disk_total_gb = 0.0
        try:
            stat_info = os.statvfs(str(projects_root.resolve()))
            disk_free_gb = round((stat_info.f_bavail * stat_info.f_frsize) / (1024**3), 2)
            disk_total_gb = round((stat_info.f_blocks * stat_info.f_frsize) / (1024**3), 2)
        except Exception:
            pass

        latency_ms = round((time.monotonic() - t0) * 1000, 2)
        results["storage"] = {
            "target": "storage",
            "status": "connected" if probe_ok else "error",
            "latency_ms": latency_ms,
            "message": f"Storage probe verified write/read ({disk_free_gb} GB free)" if probe_ok else "Storage path write failed",
            "details": {
                "path": str(projects_root),
                "writable": probe_ok,
                "disk_free_gb": disk_free_gb,
                "disk_total_gb": disk_total_gb,
                "cas_layout": "sha256",
            },
        }

    if target in ("mlflow", "all"):
        t0 = time.monotonic()
        mlflow_uri = request.app.state.settings.optimization_tracking_uri.get_secret_value()
        if not mlflow_uri:
            results["mlflow"] = {
                "target": "mlflow",
                "status": "unconfigured",
                "latency_ms": 0.0,
                "message": "MLflow tracking URI is not configured in RCA_OPTIMIZATION_TRACKING_URI",
                "details": {"tracking_uri": None, "experiment_count": 0},
            }
        else:
            try:
                import mlflow
                mlflow.set_tracking_uri(mlflow_uri)
                exps = mlflow.search_experiments(max_results=5)
                latency_ms = round((time.monotonic() - t0) * 1000, 2)
                results["mlflow"] = {
                    "target": "mlflow",
                    "status": "connected",
                    "latency_ms": latency_ms,
                    "message": f"Connected to MLflow tracking store ({len(exps)} experiments available)",
                    "details": {
                        "tracking_uri": "configured",
                        "experiments": [e.name for e in exps[:5]],
                        "experiment_count": len(exps),
                        "offline_eval_contracts": ["Quality", "Safety", "Latency", "Cost"],
                    },
                }
            except Exception as exc:
                results["mlflow"] = {
                    "target": "mlflow",
                    "status": "error",
                    "latency_ms": round((time.monotonic() - t0) * 1000, 2),
                    "message": f"MLflow probe failed: {str(exc)[:100]}",
                    "details": {"error": str(exc)},
                }

    if target in ("connectors", "all"):
        t0 = time.monotonic()
        project = request.app.state.registry.inheritance.project(principal)
        disabled = set(project.disabled_connectors) if project else set()
        available = set(request.app.state.runner.connectors) - disabled
        conn_result = await request.app.state.runner.health(available)
        latency_ms = round((time.monotonic() - t0) * 1000, 2)
        results["connectors"] = {
            "target": "connectors",
            "status": "connected",
            "latency_ms": latency_ms,
            "message": f"Probed {len(available)} registered connector(s) in {latency_ms} ms",
            "details": {
                "results": {k: v.model_dump(mode="json") if hasattr(v, "model_dump") else v for k, v in conn_result.items()},
                "disabled": sorted(disabled),
                "mode": request.app.state.settings.mode,
            },
        }

    return {"timestamp": time.time(), "results": results}


@router.get("/health")
async def health():
    return {"status": "alive"}


@router.get("/ready")
async def ready(request: Request):
    try:
        async with asyncio.timeout(request.app.state.settings.health_timeout_seconds):
            await request.app.state.store.ping()
        healthy = request.app.state.settings.auth_configured
    except Exception:
        healthy = False
    return JSONResponse(
        {"ready": healthy, "mode": request.app.state.settings.mode,
         "live_execution": request.app.state.settings.mode == "live"},
        status_code=200 if healthy else 503,
    )


@router.get("/api/v1/me", response_model=UserPrincipal)
async def me(principal: Principal):
    from app.policy.access import project_access
    return principal if project_access(principal) else principal.model_copy(update={"tenant_id": "", "project_id": ""})


@router.get("/api/v1/access")
async def access(principal: Principal):
    from app.policy.access import PROJECT_ADMIN_ROLES, project_access
    project = project_access(principal)
    return {
        "project_access": project,
        "can_triage": project,
        "can_manage_project": bool(set(principal.roles) & PROJECT_ADMIN_ROLES),
        "can_use_playground": bool(principal.roles),
        "external_writes": False,
    }


@router.get("/api/v1/health")
async def health_summary(request: Request, principal: Principal):
    """Project-scoped health summary backed by the run store and live probes."""
    counts = await request.app.state.store.run_counts(principal)
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    template_by_system = _connector_templates_by_system(request)
    all_connectors = set(request.app.state.runner.connectors) | set(
        template_by_system.keys()
    )
    expected = all_connectors - disabled
    configured = await request.app.state.runner.health(expected)
    connectors = {
        name: configured.get(name)
        if configured.get(name) is not None
        else _connector_not_configured_health(
            connector_id=name,
            mode=request.app.state.settings.mode,
            template=name in template_by_system,
        )
        for name in expected
    }
    # Demo mode intentionally has no runtime providers for planned template
    # connectors. Keep those per-connector records degraded for visibility, but
    # do not report the whole demo deployment as unhealthy because of them.
    unhealthy = any(
        item.overall.value != "HEALTHY"
        and not (
            request.app.state.settings.mode == "demo"
            and name in template_by_system
            and name not in configured
            and item.overall == CheckStatus.DEGRADED
        )
        for name, item in connectors.items()
    )
    return {
        "status": "degraded" if unhealthy else "healthy",
        "tenant_id": principal.tenant_id,
        "project_id": principal.project_id,
        "mode": request.app.state.settings.mode,
        "active_runs": counts["active"],
        "total_runs": counts["total"],
        "connectors": {name: value.model_dump(mode="json") for name, value in connectors.items()},
    }


@router.get("/api/v1/tools")
async def tools(request: Request, principal: Principal):
    """Expose the saved catalog separately from active runtime probe status."""
    inventory, published = await _connector_template_catalog(request)
    parameter_rows = await request.app.state.parameters.resolve(
        principal.tenant_id, principal.project_id,
        published,
        request.app.state.platform.connector_options,
    )
    saved_values = {}
    for row in parameter_rows:
        saved_values.setdefault(row["tool"], {})[row["variable_name"]] = row["effective_value"]
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    all_connectors, templates_by_system = _all_connectors(request, inventory)
    templates = templates_by_system.keys()
    available = (set(request.app.state.runner.connectors) - disabled) | {
        connector for connector in all_connectors if connector in templates and connector not in disabled
    }
    health = await request.app.state.runner.health(available)
    result = []
    for connector in sorted(all_connectors):
        template = templates_by_system.get(connector)
        probe = health.get(connector)
        if probe is None and template is not None:
            probe = _connector_not_configured_health(
                connector_id=connector,
                mode=request.app.state.settings.mode,
                template=True,
            )
        action = _default_connector_action(connector)
        category = template.category if template else "Connector"
        description = template.description if template else "Connector is configured via deployment templates."
        last_ping = (
            datetime.fromtimestamp(probe.last_probed_at, tz=timezone.utc).isoformat()
            if probe is not None
            else "unknown"
        )
        result.append({
        "id": action,
        "name": template.name if template else action,
        "system_name": connector,
        "supported_transports": ["native", "mcp"],
        "runtime_transport": request.app.state.platform.connector_options.get(connector, {}).get("transport", "native"),
        "actions": [value for value in TOOL_ACTIONS.values() if value.startswith(connector + ".")],
        "category": category,
        "description": description,
        "type": "connector"
        if not template or template.integration_kind == "native"
        else template.integration_kind,
        "integration_kind": template.integration_kind if template else "native",
            "status": (
                "disabled"
                if connector in disabled
                else (
                    "connected"
                    if probe is not None
                    and request.app.state.settings.mode == "live"
                    and probe.overall == CheckStatus.HEALTHY
                    else "not_configured"
                    if any(action.startswith(connector + ".") for action in TOOL_ACTIONS.values())
                    else "planned"
                    if template is not None
                    else "degraded"
                )
            ),
            "project_enabled": connector not in disabled,
            "enabled": connector not in disabled
            and request.app.state.platform.connector_options.get(connector, {}).get("enabled", False),
            "scope_level": template.default_scope if template else "platform_default",
            "project_can_override": template.can_override if template else True,
            "inherit_platform_defaults": template.default_scope != "project_only" if template else True,
            "rate_limit": template.default_rate_limit if template else "unlimited",
            "last_ping": last_ping,
            "latency_ms": probe.latency_ms if probe else None,
            "calls_today": None,
            "error_rate": None,
            "endpoint": template.default_endpoint if template else None,
            "ui_base_url": template.default_ui_base_url if template else None,
            "service_user": template.default_service_user if template else None,
            "protocol": template.protocol if template else None,
            "auth_method": template.auth_method if template else None,
            "secret_reference": template.default_secret if template else None,
            "timeout_seconds": template.default_timeout_seconds if template else None,
            "retry_attempts": template.default_retry_attempts if template else None,
            "retry_backoff_seconds": template.default_retry_backoff if template else None,
            "max_response_bytes": saved_values.get(connector, {}).get("max_response_bytes"),
            "verify_ssl": True,
            "token_header_format": None,
            "custom_config": template.default_config if template else {},
            "mcp_config": template.default_mcp,
            "a2a_config": template.default_a2a,
            "health": probe.model_dump(mode="json") if probe else None,
            "probe_available": connector in request.app.state.runner.connectors and connector not in disabled,
        })
        if template:
            projection = _template_payload(template, parameter_rows, visible_only=Role.PLATFORM_ADMIN not in principal.roles)
            result[-1].update({key: projection[key] for key in (
                "template_source", "template_version", "effective_parameters", "runtime_bindings",
            )})
        saved = saved_values.get(connector, {})
        for field in ("endpoint", "ui_base_url", "service_user", "timeout_seconds",
                      "retry_attempts", "retry_backoff_seconds", "rate_limit"):
            if field in saved:
                result[-1][field] = saved[field]
        result[-1]["custom_config"] = {
            key: saved.get(key, value)
            for key, value in result[-1]["custom_config"].items()
        }
    for registration in await request.app.state.integrations.list(principal):
        definition = registration["definition"]
        result.append({
            "id": f"integration:{registration['id']}",
            "system_name": registration["id"],
            "name": definition["name"],
            "category": "MCP" if definition["kind"] == "mcp" else "A2A",
            "description": definition["description"] or "Saved connection configuration; runtime execution is not enabled.",
            "type": definition["kind"], "integration_kind": definition["kind"],
            "status": "planned", "enabled": False,
            "scope_level": registration["scope_level"],
            "project_can_override": (registration["platform_definition"] or definition)["allow_project_override"],
            "inherit_platform_defaults": registration["scope_level"] == "platform_default",
            "endpoint": definition["endpoint"], "protocol": definition["transport"],
            "auth_method": definition["auth_method"],
            "secret_reference": definition["secret_reference"],
            "timeout_seconds": definition["timeout_seconds"],
            "rate_limit": "Not active", "last_ping": "Not probed",
            "registration": registration,
        })
    return result


@router.get("/api/v1/tools/templates")
async def connector_templates(request: Request, principal: Principal):
    """Expose connector templates used for governance UI workflows."""
    inventory, published = await _connector_template_catalog(request)
    rows = await request.app.state.parameters.resolve(principal.tenant_id, principal.project_id,
        published, request.app.state.platform.connector_options)
    return [_template_payload(template, rows, visible_only=Role.PLATFORM_ADMIN not in principal.roles)
            for template in inventory]



SKILL_STAGE_MAP = {
    "incident-triage": "triage",
    "log-correlation": "logs",
    "database-rca": "database",
}


def _parse_skill_content(text: str) -> tuple[dict[str, Any], str]:
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end >= 0:
            fm_text = text[4:end]
            body = text[end + 5 :].strip()
            try:
                fm_data = load_yaml_data(fm_text)
                if isinstance(fm_data, dict):
                    return fm_data, body
            except Exception:
                pass
    return {}, text.strip()


class SkillSavePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instruction: str
    enabled: bool = True
    actions: list[str] | None = None
    expected_hash: str | None = None


def _skill_effective_hash(source, override):
    return content_hash({"platform": source, "project": override})


def _skill_lock(request):
    if not hasattr(request.app.state, "skill_write_lock"):
        request.app.state.skill_write_lock = asyncio.Lock()
    return request.app.state.skill_write_lock


async def _skill_project_data(request, principal):
    """Read the authoritative project document before checking an edit version."""
    settings = request.app.state.settings
    relative = f"projects/{project_prefix(principal.tenant_id, principal.project_id)}/configuration/project.yaml"
    bundle_hash = None
    if settings.database_configuration:
        from sqlalchemy import select
        from app.configuration.database_bundle import active, bundles
        async with request.app.state.store.engine.connect() as connection:
            row = (await connection.execute(select(bundles.c.files, bundles.c.content_hash).join(active,
                (bundles.c.tenant_id == active.c.tenant_id) & (bundles.c.project_id == active.c.project_id)
                & (bundles.c.content_hash == active.c.content_hash)).where(
                    active.c.tenant_id == principal.tenant_id, active.c.project_id == principal.project_id))).first()
        if row is None or content_hash(row.files) != row.content_hash:
            raise HTTPException(409, "Active configuration is unavailable or changed. Reload before saving.")
        source, bundle_hash = row.files.get(relative), row.content_hash
    else:
        path = Path(settings.projects_root) / relative.removeprefix("projects/")
        source = path.read_text() if path.is_file() else None
    try:
        data = load_yaml_data(source) if source else {}
        if not isinstance(data, dict):
            raise ValueError("Project configuration must be a mapping")
        data.update(tenant_id=principal.tenant_id, project_id=principal.project_id)
        ProjectLayer.model_validate(data)
    except (ValueError, yaml.YAMLError):
        raise HTTPException(422, "Existing project configuration is invalid") from None
    return data, bundle_hash


def _check_skill_version(request, skill_id, data, expected_hash):
    registry = request.app.state.registry
    if skill_id not in registry.skill_contents:
        raise HTTPException(404, "Skill is not registered in the platform catalog")
    layer = ProjectLayer.model_validate(data)
    override = layer.skills.get(skill_id)
    current = _skill_effective_hash(registry.skill_contents[skill_id],
                                   override.model_dump(mode="json") if override else None)
    if expected_hash is not None and expected_hash != current:
        raise HTTPException(409, "Skill changed. Reload before saving.")


@router.get("/api/v1/skills")
async def skills(request: Request, principal: Principal):
    """Expose the loaded platform and project skills with full content, rules, and customization status."""
    registry = request.app.state.registry
    rules = registry.inheritance.rules
    project = registry.inheritance.project(principal)
    project_skills = project.skills if project else {}

    result = []
    for skill_id, source in sorted(registry.skill_contents.items()):
        rule = rules.get(skill_id)
        frontmatter, instruction_body = _parse_skill_content(source)
        override = project_skills.get(skill_id)
        record = next((item for item in getattr(request.app.state, "skill_records", ())
                       if item.definition.id == skill_id), None)

        result.append(
            {
                "id": skill_id,
                "name": frontmatter.get("name") or skill_id,
                "status": record.status if record else "configured",
                "size_bytes": len(source.encode("utf-8")),
                "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
                "effective_hash": _skill_effective_hash(source, override.model_dump(mode="json") if override else None),
                "capabilities": list(record.definition.capabilities) if record else
                [cap.id for cap in registry.list_all() if skill_id in cap.skills],
                "managed_in_database": any(item.id == skill_id for item in registry.managed_skills),
                "source": "platform",
                "stage": "workflow" if any(item.id == skill_id for item in registry.managed_skills)
                else SKILL_STAGE_MAP.get(skill_id, "synthesis"),
                "immutable": bool(rule.immutable) if rule else False,
                "allowed_actions": list(rule.actions) if rule else [],
                "project_override": bool(rule.project_override) if rule else False,
                "user_override": bool(rule.user_override) if rule else False,
                "content": source,
                "frontmatter": frontmatter,
                "instruction_body": instruction_body,
                "is_overridden_in_project": override is not None,
                "project_instruction": override.instruction if override else None,
                "project_enabled": override.enabled if override else True,
                "project_actions": list(override.actions)
                if (override and override.actions is not None)
                else None,
                **({key: getattr(record, key) for key in (
                    "content_hash", "author_subject", "reviewer_subject", "review_reason", "created_at", "reviewed_at"
                )} if record else {}),
                **({"review_history": [review.model_dump(mode="json") for review in record.review_history]} if record else {}),
            }
        )
    return result


@router.post("/api/v1/skills", status_code=201)
async def create_platform_skill(payload: CatalogSkill, request: Request, principal: Principal):
    """Submit an instruction skill for independent review before capability activation."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    from app.configuration.skill_catalog import create_skill, refresh_skill_catalog, SkillConflict

    registry = request.app.state.registry
    if payload.id in registry.skill_contents:
        raise HTTPException(409, "Skill already exists. Choose a different ID.")
    for capability_id in payload.capabilities:
        resolved = CapabilityResolver(registry).resolve(capability_id, principal, check_health=False)
        if not resolved.is_authorized or set(payload.actions) - set(resolved.capability.allowed_actions):
            raise HTTPException(422, "Select available capabilities and actions permitted by every selected capability.")
    try:
        await create_skill(request.app.state.store.engine, principal, payload, registry)
    except SkillConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    await refresh_skill_catalog(request)
    return next(item for item in await skills(request, principal) if item["id"] == payload.id)


@router.post("/api/v1/skills/{skill_id}/{action}")
async def review_platform_skill(skill_id: str, action: Literal["approve", "reject", "revoke"],
                                body: ReviewRequest, request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if not body.reason.strip():
        raise HTTPException(422, "A review reason is required")
    from app.configuration.skill_catalog import review_skill, refresh_skill_catalog, SkillConflict
    try:
        await review_skill(request.app.state.store.engine, principal, skill_id, action,
                           body.expected_hash, body.reason.strip(), request.app.state.registry)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except SkillConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    await refresh_skill_catalog(request)
    return next(item for item in await skills(request, principal) if item["id"] == skill_id)


@router.post("/api/v1/skills/{skill_id}")
async def save_project_skill(
    skill_id: str,
    payload: SkillSavePayload,
    request: Request,
    principal: Principal,
):
    async with _skill_lock(request):
        return await _save_project_skill(skill_id, payload, request, principal)


async def _save_project_skill(skill_id, payload, request, principal):
    """Save a policy-validated project instruction override without claiming model execution."""
    if not {
        Role.PLATFORM_ADMIN,
        Role.PROJECT_OWNER,
    }.intersection(principal.roles):
        raise HTTPException(
            403,
            "Only PLATFORM_ADMIN or PROJECT_OWNER can modify project skill overrides",
        )

    registry = request.app.state.registry
    if skill_id not in registry.skill_contents:
        raise HTTPException(
            404, f"Skill '{skill_id}' is not registered in the platform catalog"
        )

    if any(item.id == skill_id for item in registry.managed_skills) and skill_id not in registry.active_skill_ids:
        raise HTTPException(409, "Only approved skills can be customized for a project")

    rule = registry.inheritance.rules.get(skill_id)
    if not rule or rule.immutable:
        raise HTTPException(
            403,
            f"Skill '{skill_id}' is marked immutable in platform policy and cannot be overridden by projects",
        )
    if not rule.project_override:
        raise HTTPException(
            403,
            f"Skill '{skill_id}' does not allow project overrides in platform policy",
        )

    if payload.actions is not None:
        unauth_actions = set(payload.actions) - set(rule.actions)
        if unauth_actions:
            raise HTTPException(
                422,
                f"Skill '{skill_id}' requests actions not permitted by platform policy: {sorted(unauth_actions)} (allowed: {sorted(rule.actions)})",
            )

    instruction_text = payload.instruction.strip()
    if not instruction_text:
        raise HTTPException(422, "Skill instruction content cannot be empty")
    if len(instruction_text) > 16000:
        raise HTTPException(
            422, "Skill instruction exceeds maximum limit of 16,000 characters"
        )

    project_data, bundle_hash = await _skill_project_data(request, principal)
    _check_skill_version(request, skill_id, project_data, payload.expected_hash)

    if "skills" not in project_data or not isinstance(project_data["skills"], dict):
        project_data["skills"] = {}

    override_entry: dict[str, Any] = {
        "enabled": payload.enabled,
        "instruction": instruction_text,
    }
    if payload.actions is not None:
        override_entry["actions"] = payload.actions
    project_data["skills"][skill_id] = override_entry

    try:
        validated_layer = ProjectLayer.model_validate(project_data)
    except Exception as exc:
        raise HTTPException(422, f"Project skill configuration is invalid: {exc}") from exc

    try:
        await _save_project_file(request, principal, yaml.safe_dump(project_data, sort_keys=False),
                                 expected_bundle_hash=bundle_hash)
    except ValueError:
        raise HTTPException(409, "Configuration changed. Reload before saving.") from None
    registry.inheritance.projects[(principal.tenant_id, principal.project_id)] = validated_layer

    return {
        "saved": True,
        "skill_id": skill_id,
        "stage": "workflow" if any(item.id == skill_id for item in registry.managed_skills)
        else SKILL_STAGE_MAP.get(skill_id, "synthesis"),
        "project_id": principal.project_id,
        "tenant_id": principal.tenant_id,
        "is_overridden_in_project": True,
        "project_instruction": instruction_text,
        "project_enabled": payload.enabled,
        "effective_hash": _skill_effective_hash(registry.skill_contents[skill_id],
            validated_layer.skills[skill_id].model_dump(mode="json")),
        "validation": {
            "status": "PASSED",
            "checks": ["Instruction size", "Platform override policy", "Permitted tool actions", "Project configuration schema"],
            "model_execution": "NOT_RUN",
            "quality_evaluation": "NOT_RUN",
        },
    }


@router.delete("/api/v1/skills/{skill_id}")
async def reset_project_skill(
    skill_id: str, request: Request, principal: Principal, expected_hash: str | None = None
):
    """Reset a project instruction override using the current database revision."""
    require_roles(principal, {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER})
    async with _skill_lock(request):
        data, bundle_hash = await _skill_project_data(request, principal)
        _check_skill_version(request, skill_id, data, expected_hash)
        if skill_id in data.get("skills", {}):
            del data["skills"][skill_id]
            validated = ProjectLayer.model_validate(data)
            try:
                await _save_project_file(request, principal, yaml.safe_dump(data, sort_keys=False),
                                         expected_bundle_hash=bundle_hash)
            except ValueError:
                raise HTTPException(409, "Configuration changed. Reload before saving.") from None
            request.app.state.registry.inheritance.projects[
                (principal.tenant_id, principal.project_id)
            ] = validated
    return {"reset": True, "skill_id": skill_id, "status": "reverted_to_platform_baseline"}


ROLE_TIER_MAP = {
    "PLATFORM_ADMIN": "Administrative",
    "PROJECT_OWNER": "Governance",
    "PROJECT_MANAGER": "Management",
    "PROJECT_ANALYST": "Operational",
    "PROJECT_VIEWER": "Read-Only",
    "GENERIC_USER": "General",
}


@router.get("/api/v1/permissions")
async def list_permissions(principal: Principal):
    """Return platform-defined capability permissions."""
    return DEFAULT_PERMISSIONS


@router.get("/api/v1/roles")
async def roles(request: Request, principal: Principal):
    """Return server-defined and custom roles for the RBAC reference view."""
    if hasattr(request.app.state, "platform_admin"):
        raw_roles = await request.app.state.platform_admin.list_roles(principal.tenant_id)
        return [{
            **r,
            "id": r.get("id") or r.get("role_id"),
            "role_id": r.get("role_id") or r.get("id"),
            "tier": r.get("tier") or ROLE_TIER_MAP.get(r.get("role_id") or r.get("id"), "Operational"),
        } for r in raw_roles]
    return [{
        **r,
        "id": r["role_id"],
        "role_id": r["role_id"],
        "tier": ROLE_TIER_MAP.get(r["role_id"], "Operational"),
        "status": "active",
    } for r in DEFAULT_SYSTEM_ROLES]


@router.post("/api/v1/roles")
async def create_role(payload: RoleCreatePayload, request: Request, principal: Principal):
    """Create a new role with specific capability permissions."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.upsert_role(
        principal.tenant_id, payload.id, payload.name, payload.description, payload.permissions, payload.status
    )


@router.put("/api/v1/roles/{role_id}")
async def update_role(role_id: str, payload: RoleUpdatePayload, request: Request, principal: Principal):
    """Update description and permissions for a role."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.upsert_role(
        principal.tenant_id, role_id, payload.name, payload.description, payload.permissions, payload.status
    )


@router.delete("/api/v1/roles/{role_id}", status_code=204)
async def delete_role(role_id: str, request: Request, principal: Principal):
    """Delete a custom role definition."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    try:
        deleted = await request.app.state.platform_admin.delete_role(principal.tenant_id, role_id)
        if not deleted:
            raise HTTPException(404, "Role not found")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/api/v1/policy")
async def get_policy(request: Request, principal: Principal):
    """Return the effective declarative policy merged with dynamic redaction rules & guardrails."""
    base = request.app.state.registry.inheritance.policy.model_dump(mode="json")
    if hasattr(request.app.state, "platform_admin"):
        custom = await request.app.state.platform_admin.get_policy(principal.tenant_id, principal.project_id)
        base["redaction_patterns"] = custom.get("redaction_patterns", [])
        base["guardrails"] = {**base.get("guardrails", {}), **custom.get("guardrails", {})}
        base["skills"] = {**base.get("skills", {}), **custom.get("skill_guardrails", {})}
    return base


@router.put("/api/v1/policy")
async def update_policy(payload: PolicyUpdatePayload, request: Request, principal: Principal):
    """Update and persist redaction patterns and guardrails."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.update_policy(
        principal.tenant_id, principal.project_id, payload.model_dump()
    )


@router.get("/api/v1/users")
async def list_users(request: Request, principal: Principal):
    """List deployment memberships combined with dynamically persisted users."""
    members = [p for p in request.app.state.settings.principals.values()
               if p.tenant_id == principal.tenant_id and p.project_id == principal.project_id]
    users_dict = {
        p.subject: {
            "id": p.subject,
            "name": p.username,
            "email": p.username if "@" in p.username else None,
            "roles": [role.value for role in p.roles],
            "status": "active",
            "tenant_id": p.tenant_id,
            "project_id": p.project_id,
            "groups": list(p.groups),
            "authn_method": p.authn_method,
        } for p in members
    }
    if hasattr(request.app.state, "platform_admin"):
        stored = await request.app.state.platform_admin.list_users(principal.tenant_id, principal.project_id)
        for u in stored:
            users_dict[u["subject"]] = {
                "id": u["subject"],
                "name": u["name"],
                "email": u.get("email"),
                "roles": u["roles"],
                "status": u["status"],
                "tenant_id": principal.tenant_id,
                "project_id": principal.project_id,
                "groups": u.get("groups", []),
                "authn_method": u.get("authn_method", "workforce_identity"),
            }
    return list(users_dict.values())


def _validate_user_change(roles: list[str], status: str, actor: Principal, subject: str) -> None:
    try:
        assigned = {Role(role) for role in roles}
    except ValueError:
        raise HTTPException(422, "Unknown project role") from None
    if status not in {"active", "inactive"}:
        raise HTTPException(422, "User status must be active or inactive")
    if Role.PLATFORM_ADMIN not in actor.roles and Role.PLATFORM_ADMIN in assigned:
        raise HTTPException(403, "Only PLATFORM_ADMIN can assign PLATFORM_ADMIN")
    if subject == actor.subject and (status != "active" or not assigned.intersection(MANAGEMENT_ROLES)):
        raise HTTPException(400, "You cannot remove your own management access")


async def _reject_owner_admin_target(request: Request, actor: Principal, subject: str) -> None:
    if Role.PLATFORM_ADMIN in actor.roles:
        return
    stored = await request.app.state.platform_admin.get_user(actor.tenant_id, actor.project_id, subject)
    fallback = request.app.state.settings.principals.get(subject)
    target_roles = stored.get("roles", []) if stored else [role.value for role in fallback.roles] if fallback else []
    if Role.PLATFORM_ADMIN.value in target_roles:
        raise HTTPException(403, "Only PLATFORM_ADMIN can modify a platform administrator")


@router.post("/api/v1/users")
async def create_user(payload: UserCreatePayload, request: Request, principal: Principal):
    """Register a new user membership in this project scope."""
    require_roles(principal, MANAGEMENT_ROLES)
    await _reject_owner_admin_target(request, principal, payload.id)
    _validate_user_change(payload.roles, payload.status, principal, subject=payload.id)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.upsert_user(
        principal.tenant_id, principal.project_id, payload.id, payload.name, payload.email, payload.roles, payload.status
    )


@router.put("/api/v1/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdatePayload, request: Request, principal: Principal):
    """Update assigned roles, name, email, or status for a user."""
    require_roles(principal, MANAGEMENT_ROLES)
    await _reject_owner_admin_target(request, principal, user_id)
    _validate_user_change(payload.roles, payload.status, principal, subject=user_id)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.upsert_user(
        principal.tenant_id, principal.project_id, user_id, payload.name, payload.email, payload.roles, payload.status
    )


@router.delete("/api/v1/users/{user_id}", status_code=204)
async def delete_user(user_id: str, request: Request, principal: Principal):
    """Remove user membership."""
    require_roles(principal, MANAGEMENT_ROLES)
    if user_id == principal.subject:
        raise HTTPException(400, "You cannot remove your own project membership")
    await _reject_owner_admin_target(request, principal, user_id)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    store = request.app.state.platform_admin
    stored = await store.get_user(principal.tenant_id, principal.project_id, user_id)
    fallback = request.app.state.settings.principals.get(user_id)
    if stored is None and (fallback is None or fallback.tenant_id != principal.tenant_id or fallback.project_id != principal.project_id):
        raise HTTPException(404, "User not found")
    if stored is not None:
        await store.delete_user(principal.tenant_id, principal.project_id, user_id)
    else:
        # Keep a server-side revocation row so bootstrap membership cannot return.
        await store.upsert_user(principal.tenant_id, principal.project_id, user_id,
                                fallback.username, None, [role.value for role in fallback.roles], "inactive")



@router.get("/api/v1/audit")
async def audit(request: Request, principal: Principal, limit: int = 100):
    """Return persisted agent configuration governance events for this project."""
    limit = max(1, min(limit, 100))
    rows = await request.app.state.configurations.list_audit(principal, limit)
    return [{
        "id": str(row["event_id"]),
        "timestamp": datetime.fromtimestamp(row["created_at"], timezone.utc).isoformat(),
        "actor": row["actor_subject"],
        "action": row["event"],
        "resource": row["draft_id"],
        "outcome": "SUCCESS" if row["event"] in {"SUBMITTED", "APPROVED"} else "DENIED" if row["event"] == "REJECTED" else "FLAGGED",
        "details": row["reason"],
    } for row in rows]


@router.get("/api/v1/billing")
async def get_billing(request: Request, principal: Principal):
    """Month-to-date measured usage; unknown model charges remain unknown."""
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    config = await request.app.state.platform_admin.get_billing(principal.tenant_id, principal.project_id)
    today = datetime.now(timezone.utc).date()
    measured = await telemetry(request.app.state.store.engine, principal, today.replace(day=1), today)
    usage = measured["summary"]
    prices = await read_pricing(request.app.state.store.engine, principal)
    spend = usage["estimated_cost_usd"]
    budget = config.get("monthly_spend_budget")
    return {
        **config,
        "pricing_matrix": prices["rates"], "pricing_revision": prices["revision"],
        "usage": {
            **usage, "total_runs": usage["runs"], "completed_runs": usage["succeeded_runs"],
            "total_evidence_collected": usage["evidence_items"],
            "measured_tokens_processed": usage["total_tokens"],
            "month_to_date_spend_usd": spend,
            "budget_consumed_percent": round(spend / budget * 100, 1) if spend is not None and budget and budget > 0 else None,
        }, "coverage": measured["coverage"],
    }


@router.put("/api/v1/billing")
async def update_billing(payload: BillingUpdatePayload, request: Request, principal: Principal):
    """Save planning values; model prices use their dedicated independent review."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    if "pricing_matrix" in payload.model_fields_set:
        raise HTTPException(422, "Submit model prices through the reviewed model-pricing endpoint")
    return await request.app.state.platform_admin.update_billing(
        principal.tenant_id, principal.project_id, payload.model_dump(exclude={"pricing_matrix"})
    )


@router.get("/api/v1/persistence/limits")
async def get_persistence_limits(request: Request, principal: Principal):
    """Get file processing limits, concurrency, and retention configuration."""
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.get_file_limits(principal.tenant_id, principal.project_id)


@router.put("/api/v1/persistence/limits")
async def update_persistence_limits(payload: FileLimitsUpdatePayload, request: Request, principal: Principal):
    """Update file processing limits and retention days."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.update_file_limits(
        principal.tenant_id, principal.project_id, payload.model_dump()
    )


@router.post("/api/v1/persistence/cleanup")
async def execute_persistence_cleanup(request: Request, principal: Principal):
    """Trigger on-demand retention purge for expired attachments, runs, and artifacts."""
    require_roles(principal, MANAGEMENT_ROLES)
    store = request.app.state.store
    settings = request.app.state.settings
    retention_days = settings.retention_days
    retention_seconds = retention_days * 86400
    now = time.time()
    cutoff = now - retention_seconds
    scope = (principal.tenant_id, principal.project_id)

    from sqlalchemy import select, and_
    from app.runtime.run_contract import TERMINAL_STATUSES, RunContract, content_hash
    from app.persistence.database import session_service
    from app.persistence.store import runs, attachments

    # 1. Query candidate expired records to compute confirmed sizes and counts
    async with store.engine.connect() as connection:
        expired_runs = (
            await connection.execute(
                select(runs).where(
                    runs.c.status.in_(TERMINAL_STATUSES),
                    runs.c.tenant_id == principal.tenant_id,
                    runs.c.project_id == principal.project_id,
                    runs.c.updated_at < cutoff,
                )
            )
        ).all()
        expired_attachments = (
            await connection.execute(
                select(attachments).where(
                    attachments.c.expires_at <= now,
                    and_(
                        attachments.c.tenant_id == principal.tenant_id,
                        attachments.c.project_id == principal.project_id,
                    ),
                )
            )
        ).all()

    purged_attachments = len(expired_attachments)

    # 2. Cleanup expired chat artifacts from storage
    artifact_store = request.app.state.chat_artifacts
    artifact_count = await artifact_store.cleanup(apply=True)

    # 3. Clean up run outputs and ADK sessions for expired runs
    sessions = None
    sessions = session_service(settings.session_database_url.get_secret_value())
    try:
        for run in expired_runs:
            await artifact_store.cleanup_output(
                store._response(run),
                RunContract.model_validate_json(run.contract_json).principal,
            )
            await sessions.delete_session(
                app_name="app",
                user_id=content_hash([run.tenant_id, run.project_id, run.subject]),
                session_id=run.run_id,
            )
    finally:
        await sessions.close()

    # 4. Confirmed deletion of expired runs and attachments (including CAS blobs)
    deleted_records = await store.delete_expired(
        retention_seconds,
        scope=scope,
    )
    purged_runs = len(expired_runs)

    return {
        "status": "success",
        "purged_attachments": purged_attachments,
        "purged_runs": purged_runs,
        "purged_artifacts": artifact_count,
        "deleted_records": deleted_records,
        "freed_bytes": None,
        "retention_cutoff_utc": datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
        "timestamp": datetime.fromtimestamp(now, timezone.utc).isoformat(),
        "message": (
            f"Retention cleanup completed for records older than {retention_days} days. "
            f"Purged {purged_runs} runs, {purged_attachments} attachments, and {artifact_count} raw artifacts. "
            "Physical storage bytes freed are not measured."
        ),
    }


@router.get("/api/v1/knowledge")
async def knowledge(request: Request, principal: Principal):
    """Project knowledge has its own review lifecycle; chat attachments stay in chat."""
    return await knowledge_result(request.app.state.knowledge.list(principal))


@router.post("/api/v1/knowledge", status_code=201)
async def create_knowledge(payload: KnowledgeCreatePayload, request: Request, principal: Principal):
    """Save a draft; separate independent review is required before runtime use."""
    require_roles(principal, MANAGEMENT_ROLES)
    return await knowledge_result(request.app.state.knowledge.save(
        principal, payload, max_text_chars=request.app.state.file_limits.max_text_chars))


@router.put("/api/v1/knowledge/{doc_id}")
async def update_knowledge(doc_id: str, payload: KnowledgeUpdatePayload, request: Request, principal: Principal):
    """Create a new draft revision without carrying approval across a content change."""
    require_roles(principal, MANAGEMENT_ROLES)
    return await knowledge_result(request.app.state.knowledge.save(
        principal, payload, doc_id=doc_id, expected_hash=payload.expected_hash,
        max_text_chars=request.app.state.file_limits.max_text_chars))


@router.delete("/api/v1/knowledge/{doc_id}", status_code=204)
async def delete_knowledge(doc_id: str, request: Request, principal: Principal):
    """Reviewed knowledge retains its revision history; use explicit revocation."""
    require_roles(principal, MANAGEMENT_ROLES)
    raise HTTPException(405, "Knowledge revisions are retained. Revoke an approved document to remove it from future investigations.")


@router.get("/api/v1/runtime/stages")
async def get_runtime_stages(request: Request, principal: Principal):
    """Return the authoritative declarative model stage configuration."""
    stages = request.app.state.platform.profiles.stages
    return [
        {
            "stage_id": stage_id,
            "name": stage_id.replace("_", " ").title(),
            "model": stage.model,
            "thinking_level": stage.thinking_level,
            "thinking_budget": stage.thinking_budget,
            "output_limit": stage.max_output_tokens,
            "temperature": stage.temperature,
            "enabled": stage.enabled,
            "content_hash": content_hash(stage.model_dump(mode="json")),
            "editable_fields": ["model", "thinking_level", "thinking_budget", "output_limit", "temperature", "enabled"],
            "immutable_fields": ["name", "tools", "instruction", "tool_limit"],
        }
        for stage_id, stage in stages.items()
    ]


@router.put("/api/v1/runtime/stages/{stage_id}")
async def update_runtime_stage(stage_id: str, payload: RuntimeStageUpdatePayload, request: Request, principal: Principal):
    """Update the declarative model stage and activate it for new runs."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "runtime_profiles_lock"):
        request.app.state.runtime_profiles_lock = asyncio.Lock()
    async with request.app.state.runtime_profiles_lock:
        current = request.app.state.platform.profiles.stages.get(stage_id)
        if current is None:
            raise HTTPException(404, "Unknown runtime stage")
        current_hash = content_hash(current.model_dump(mode="json"))
        if payload.expected_hash != current_hash:
            raise HTTPException(409, "Runtime stage changed; reload its hash before retrying")
        if payload.thinking_level and payload.thinking_budget is not None:
            raise HTTPException(422, "Use thinking_level or thinking_budget, not both")
        try:
            updated = StageModel(
                model=payload.model,
                enabled=payload.enabled,
                temperature=payload.temperature,
                max_output_tokens=payload.output_limit,
                thinking_level=payload.thinking_level or None,
                thinking_budget=payload.thinking_budget if not payload.thinking_level else None,
            )
            profiles = dict(request.app.state.platform.profiles.stages)
            profiles[stage_id] = updated
            # Re-validate the complete graph so a required stage (especially
            # synthesis) cannot be disabled by bypassing ModelProfiles validators.
            candidate = ModelProfiles.model_validate(
                request.app.state.platform.profiles.model_copy(update={"stages": profiles}).model_dump(mode="json")
            )
            content = yaml.safe_dump(candidate.model_dump(mode="json"), sort_keys=False)
            await _save_model_profiles(request, content)
        except ValueError as exc:
            if "changed" in str(exc).lower():
                raise HTTPException(409, str(exc)) from exc
            raise HTTPException(422, str(exc)) from exc
        request.app.state.platform.profiles.stages[stage_id] = updated
    return {
        "stage_id": stage_id,
        "name": stage_id.replace("_", " ").title(),
        "model": updated.model,
        "thinking_level": updated.thinking_level,
        "thinking_budget": updated.thinking_budget,
        "output_limit": updated.max_output_tokens,
        "temperature": updated.temperature,
        "enabled": updated.enabled,
        "content_hash": content_hash(updated.model_dump(mode="json")),
        "editable_fields": ["model", "thinking_level", "thinking_budget", "output_limit", "temperature", "enabled"],
        "immutable_fields": ["name", "tools", "instruction", "tool_limit"],
    }


@router.get("/api/v1/platform/settings")
async def get_platform_settings(request: Request, principal: Principal):
    """Get global platform runtime settings."""
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    stored = await request.app.state.platform_admin.get_platform_settings(principal.tenant_id, principal.project_id, create=False)
    current = request.app.state.settings
    for key in ("run_timeout_seconds", "max_concurrent_runs", "max_llm_calls", "max_input_chars", "max_context_chars", "retention_days"):
        stored[key] = getattr(current, key)
    stored["mode"] = current.mode
    stored["allowed_extensions"] = sorted(request.app.state.file_limits.allowed_extensions)
    return stored


@router.put("/api/v1/platform/settings")
async def update_platform_settings(payload: PlatformSettingsUpdatePayload, request: Request, principal: Principal):
    """Update global platform execution settings."""
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    if payload.mode != request.app.state.settings.mode:
        raise HTTPException(409, "Runtime mode is deployment-owned and requires a restart")
    from app.settings import Settings
    runner = request.app.state.runner
    async with runner.runtime_settings_lock:
        current = request.app.state.settings
        if payload.max_concurrent_runs != runner._run_limit and runner.run_limiter._value != runner._run_limit:
            raise HTTPException(409, "Concurrency can only change while investigations are idle")
        updated_settings = Settings.model_validate(
            current.model_dump() | {
                "run_timeout_seconds": payload.run_timeout_seconds,
                "max_concurrent_runs": payload.max_concurrent_runs,
                "max_llm_calls": payload.max_llm_calls,
                "max_input_chars": payload.max_input_chars,
                "max_context_chars": payload.max_context_chars,
                "retention_days": payload.retention_days,
            }
        )
        updated_settings.validate_runtime()
        await request.app.state.parameters.set_runtime_values(
            principal,
            {name: getattr(payload, name) for name in (
                "run_timeout_seconds", "max_concurrent_runs", "max_llm_calls",
                "max_input_chars", "max_context_chars", "retention_days",
            )},
        )
        updated = await request.app.state.platform_admin.update_platform_settings(
            principal.tenant_id, principal.project_id, payload.model_dump()
        )
        from app.api.routes.parameters import refresh_runtime
        await refresh_runtime(request, principal)
        updated["allowed_extensions"] = sorted(request.app.state.file_limits.allowed_extensions)
    return updated


@router.get("/api/v1/config")
async def configuration(request: Request, principal: Principal):
    runtime = request.app.state.registry.inheritance.runtime(
        principal,
        request.app.state.settings,
        request.app.state.platform.prompts,
    )
    configured = runtime["settings"]
    return {
        "configuration_hash": request.app.state.registry.content_hash,
        "workflow": runtime["workflow"].model_dump(mode="json"),
        "preferences": runtime["preferences"].model_dump(mode="json"),
        "disabled_connectors": list(runtime["disabled_connectors"]),
        "max_tool_calls": runtime["max_tool_calls"],
        "mode": configured.mode,
        "execution": configured.model_dump(
            mode="json",
            exclude={
                "auth_public_key",
                "principals",
                "database_url",
                "session_database_url",
                "auth_issuer",
                "auth_audience",
                "optimization_tracking_uri",
                "optimization_blob_uri",
                "config_dir",
                "content_root",
                "projects_root",
                "projects_blob_uri",
                "config_blob_uri",
            },
        ),
        "model_profiles": request.app.state.runner.profiles.model_dump(mode="json"),
        "file_limits": {
            **asdict(request.app.state.file_limits),
            "allowed_extensions": sorted(
                request.app.state.file_limits.allowed_extensions
            ),
        },
        "optimization": request.app.state.optimizations.config.model_dump(mode="json"),
        "telemetry": telemetry_status(),
    }


@router.get("/api/v1/capabilities")
async def capabilities(request: Request, principal: Principal, all: bool = False):
    registry = request.app.state.registry
    resolver = CapabilityResolver(registry)
    results = []
    for cap in registry.list_all():
        resolved = resolver.resolve(cap.id, principal, check_health=False)
        if not all and not resolved.is_authorized:
            continue
        item = resolved.capability.model_dump(mode="json")
        project = registry.inheritance.project(principal)
        item["project_enabled"] = not project or cap.id not in project.capabilities or project.capabilities[cap.id].enabled
        item["is_authorized"] = resolved.is_authorized
        item["runtime_supported"] = set(resolved.capability.requires.connectors).issubset(
            set(NATIVE_FACTORIES) | set(request.app.state.runner.connectors)
        )
        item["rejection_reason"] = resolved.rejection_reason
        item["allowed_skills"] = list(resolved.allowed_skills)
        item["required_connectors"] = list(resolved.required_connectors)
        item["optional_connectors"] = list(resolved.optional_connectors)
        item["agent_bindings"] = await _agent_bindings(request, principal, cap.id)
        results.append(item)
    return results
    
@router.get("/api/v1/connectors/health")
async def connector_health(request: Request, principal: Principal):
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    all_connectors, templates_by_system = _all_connectors(request)
    available = (set(request.app.state.runner.connectors) - disabled) | {
        connector for connector in all_connectors if connector in templates_by_system
    }
    result = await request.app.state.runner.health(available - disabled)
    normalized: dict[str, ConnectorHealth] = {}
    for connector in sorted(all_connectors):
        template = templates_by_system.get(connector)
        if connector in disabled:
            normalized[connector] = ConnectorHealth(
                connector_id=connector,
                overall=CheckStatus.AUTHORIZATION_ERROR,
                latency_ms=0,
                connectivity=CheckStatus.AUTHORIZATION_ERROR,
                authentication=CheckStatus.AUTHORIZATION_ERROR,
                authorization=CheckStatus.AUTHORIZATION_ERROR,
                message="Connector disabled for authenticated scope",
            )
            continue
        if connector in result:
            normalized[connector] = result[connector]
            continue
        normalized[connector] = _connector_not_configured_health(
            connector_id=connector,
            mode=request.app.state.settings.mode,
            template=template is not None,
        )
    return {
        "disabled": sorted(disabled),
        "mode": request.app.state.settings.mode,
        "connectors": {name: row.model_dump(mode="json") for name, row in normalized.items()},
        "unconfigured": sorted(set(templates_by_system) - set(result) - disabled),
    }


@router.get("/api/v1/connectors/{connector_id}/health")
async def connector_health_check(
    connector_id: str, request: Request, principal: Principal
):
    connector_id = connector_id.strip().lower()
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    all_connectors, templates_by_system = _all_connectors(request)
    template = templates_by_system.get(connector_id)

    if connector_id not in all_connectors:
        raise HTTPException(404, "Connector not found")
    if connector_id in disabled:
        return ConnectorHealth(
            connector_id=connector_id,
            overall=CheckStatus.AUTHORIZATION_ERROR,
            latency_ms=0,
            message="Connector disabled for authenticated scope",
        ).model_dump(mode="json")

    if connector_id not in request.app.state.runner.connectors:
        return _connector_not_configured_health(
            connector_id=connector_id,
            mode=request.app.state.settings.mode,
            template=template is not None,
        ).model_dump(mode="json")

    result = await request.app.state.runner.health({connector_id})
    if connector_id not in result:
        raise HTTPException(502, "Connector probe did not return status")

    return result[connector_id].model_dump(mode="json")



@router.get("/api/v1/system/diagnostics")
async def system_diagnostics(request: Request, principal: Principal):
    return await _collect_system_diagnostics(request, principal)


@router.post("/api/v1/system/test-connection")
async def test_system_connection(
    payload: SystemConnectionTestPayload,
    request: Request,
    principal: Principal,
):
    return await _execute_connection_test(request, principal, payload.target)


@router.get("/api/v1/alerts")
async def alerts(request: Request, principal: Principal):
    runtime = request.app.state.registry.inheritance.runtime(
        principal,
        request.app.state.settings,
        request.app.state.platform.prompts,
    )
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    available = set(request.app.state.runner.connectors) - disabled
    connector_health = await request.app.state.runner.health(available)
    counts = await request.app.state.store.run_counts(principal)

    by_status = counts["by_status"]
    generated_at = time.time()
    items = []

    for name, status in sorted(connector_health.items()):
        if status.overall == CheckStatus.HEALTHY:
            continue
        items.append({
            "id": f"connector:{name}",
            "severity": _alert_severity(status.overall),
            "source": "connector",
            "component": name,
            "title": f"Connector probe degraded for {name}",
            "summary": f"Connector reports {status.overall.value}",
            "message": status.message,
            "created_at": generated_at,
            "metadata": {
                "latency_ms": status.latency_ms,
                "connectivity": status.connectivity.value,
                "authentication": status.authentication.value,
                "authorization": status.authorization.value,
            },
            "status": "open",
        })

    if disabled:
        items.append({
            "id": "scope:connectors-disabled",
            "severity": "warning",
            "source": "scope",
            "component": "connectors",
            "title": "Connector scope disabled",
            "summary": "Project configuration disables one or more connectors",
            "message": f"Disabled connector list: {', '.join(sorted(disabled))}",
            "created_at": generated_at,
            "status": "open",
        })

    failed_runs = by_status.get("FAILED", 0)
    blocked_runs = by_status.get("BLOCKED", 0)
    if failed_runs:
        items.append({
            "id": "runs:failed",
            "severity": "critical" if failed_runs >= 5 else "warning",
            "source": "run",
            "component": "investigations",
            "title": "Investigation failures detected",
            "summary": f"{failed_runs} failed run(s) in this scope",
            "message": "Consider reviewing run diagnostics and incident prompts before accepting auto-generated findings.",
            "created_at": generated_at,
            "metadata": {"failed_runs": failed_runs},
            "status": "open",
        })
    if blocked_runs:
        items.append({
            "id": "runs:blocked",
            "severity": "critical",
            "source": "run",
            "component": "investigations",
            "title": "Investigation blocks detected",
            "summary": f"{blocked_runs} blocked run(s) in this scope",
            "message": "Blocked runs may indicate policy, governance, or connector failures.",
            "created_at": generated_at,
            "metadata": {"blocked_runs": blocked_runs},
            "status": "open",
        })

    max_concurrent_runs = runtime["settings"].max_concurrent_runs
    if max_concurrent_runs and counts["active"] > max_concurrent_runs:
        items.append({
            "id": "runs:concurrency-spike",
            "severity": "warning",
            "source": "run",
            "component": "planner",
            "title": "Run concurrency saturation",
            "summary": f"{counts['active']} active runs exceeds configured limit",
            "message": "Active runs are above the configured limit and may increase completion times.",
            "created_at": generated_at,
            "metadata": {
                "active_runs": counts["active"],
                "max_concurrent_runs": max_concurrent_runs,
            },
            "status": "open",
        })

    # Merge persisted operator alerts
    if hasattr(request.app.state, "platform_admin"):
        try:
            persisted = await request.app.state.platform_admin.list_alerts(principal.tenant_id, principal.project_id)
            persisted_map = {a["alert_id"]: a for a in persisted}
            # Update status of system alerts if status was updated
            for item in items:
                if item["id"] in persisted_map:
                    item["status"] = persisted_map[item["id"]].get("status", item["status"])
                    item["resolution_note"] = persisted_map[item["id"]].get("resolution_note")

            # Add operator alerts
            for a in persisted:
                if not any(i["id"] == a["alert_id"] for i in items):
                    items.append({
                        "id": a["alert_id"],
                        "severity": a["severity"],
                        "source": a["source"],
                        "component": a["component"],
                        "title": a["title"],
                        "summary": a["summary"],
                        "message": a["message"],
                        "created_at": a["created_at"],
                        "status": a["status"],
                        "resolution_note": a.get("resolution_note"),
                    })
        except Exception:
            pass

    severity_counts = {"critical": 0, "warning": 0, "info": 0}
    for item in items:
        severity = item.get("severity")
        if severity in severity_counts:
            severity_counts[severity] += 1

    items = sorted(items, key=lambda item: item["created_at"], reverse=True)

    return {
        "generated_at": generated_at,
        "items": items,
        "summary": {
            "total": len(items),
            "critical": severity_counts["critical"],
            "warning": severity_counts["warning"],
            "info": severity_counts["info"],
        },
    }


@router.post("/api/v1/alerts")
async def create_alert(payload: AlertCreatePayload, request: Request, principal: Principal):
    """Broadcast an operational alert or notification."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.create_alert(
        principal.tenant_id, principal.project_id, payload.severity, payload.source, payload.component, payload.title, payload.summary, payload.message
    )


@router.patch("/api/v1/alerts/{alert_id}")
async def update_alert_status(alert_id: str, payload: AlertStatusUpdatePayload, request: Request, principal: Principal):
    """Acknowledge or resolve an operational alert."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.update_alert_status(
        principal.tenant_id, principal.project_id, alert_id, payload.status, payload.resolution_note
    )


@router.get("/api/v1/alerts/config")
async def get_alert_config(request: Request, principal: Principal):
    """Get alert threshold configuration."""
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.get_alert_config(principal.tenant_id, principal.project_id)


@router.put("/api/v1/alerts/config")
async def update_alert_config(payload: AlertConfigUpdatePayload, request: Request, principal: Principal):
    """Update operational alert thresholds."""
    require_roles(principal, MANAGEMENT_ROLES)
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    return await request.app.state.platform_admin.update_alert_config(
        principal.tenant_id, principal.project_id, payload.model_dump()
    )


@router.get("/api/v1/notifications")
async def notifications(request: Request, principal: Principal):
    generated_at = time.time()
    runs = await request.app.state.store.list_runs(principal, limit=25)
    audit_rows = await request.app.state.configurations.list_audit(principal, limit=20)
    notifications = []

    for run in runs:
        if run.status not in {"FAILED", "BLOCKED", "SIMULATED"}:
            continue
        notifications.append({
            "id": f"run:{run.run_id}",
            "kind": "run",
            "severity": "critical" if run.status in {"FAILED", "BLOCKED"} else "warning",
            "title": f"Run {run.run_id} status changed to {run.status}",
            "message": f"Capability {run.capability} finished with terminal status {run.status}.",
            "created_at": float(run.created_at),
            "metadata": {
                "run_id": run.run_id,
                "status": run.status,
                "capability": run.capability,
                "reason": run.result.summary if run.result else run.reason,
            },
        })

    for row in audit_rows:
        action = row["event"]
        created_at = datetime.fromtimestamp(row["created_at"], timezone.utc).isoformat()
        notifications.append({
            "id": f"audit:{row['event_id']}",
            "kind": "governance",
            "severity": "warning" if action == "REJECTED" else "info",
            "title": f"Agent configuration event: {action}",
            "message": f"{row['actor_subject']} {action.lower()} {row['draft_id']}",
            "created_at": row["created_at"],
            "created_at_iso": created_at,
            "metadata": {
                "actor": row["actor_subject"],
                "resource": row["draft_id"],
                "reason": row["reason"],
                "event": row["event"],
            },
        })

    read_ids = set()
    if hasattr(request.app.state, "platform_admin"):
        try:
            read_ids = await request.app.state.platform_admin.get_read_notification_ids(
                principal.tenant_id, principal.project_id, principal.subject
            )
        except Exception:
            pass

    for note in notifications:
        note["read"] = note["id"] in read_ids

    notifications.sort(key=lambda note: note["created_at"], reverse=True)
    unread_count = sum(1 for note in notifications if not note.get("read"))

    return {
        "generated_at": generated_at,
        "items": notifications[:40],
        "unread_count": unread_count,
    }


class NotificationReadPayload(BaseModel):
    notification_ids: list[str] | None = None
    all: bool = False


@router.post("/api/v1/notifications/read")
async def mark_notifications_read(
    payload: NotificationReadPayload, request: Request, principal: Principal
):
    if not hasattr(request.app.state, "platform_admin"):
        raise HTTPException(500, "Platform admin store not initialized")
    ids_to_mark = payload.notification_ids or []
    if payload.all:
        current_data = await notifications(request, principal)
        ids_to_mark = [n["id"] for n in current_data["items"]]
    marked = await request.app.state.platform_admin.mark_notifications_read(
        principal.tenant_id, principal.project_id, principal.subject, ids_to_mark
    )
    return {"marked": marked, "status": "success"}


def _validate_project_yaml(
    yaml_text: str, request: Request, principal: Principal
) -> tuple[bool, list[str], list[str], dict[str, Any] | None]:
    errors = []
    warnings = []
    if not yaml_text or not yaml_text.strip():
        return False, ["Configuration YAML content cannot be empty"], [], None
    try:
        data = load_yaml_data(yaml_text)
    except Exception as exc:
        return False, [f"YAML syntax error: {exc}"], [], None
    if not isinstance(data, dict):
        return False, ["Project configuration must be a YAML dictionary mapping"], [], None

    current = request.app.state.registry.inheritance.project(principal)
    provenance = current.project_template.model_dump(mode="json") if current and current.project_template else None
    if data.get("project_template") is not None and data["project_template"] != provenance:
        return False, ["Project template provenance is server-owned"], [], None
    if provenance is not None:
        data["project_template"] = provenance

    # Scope validation
    conf_tenant = data.get("tenant_id")
    conf_project = data.get("project_id")
    if conf_tenant and conf_tenant != principal.tenant_id:
        errors.append(
            f"tenant_id '{conf_tenant}' does not match authenticated tenant '{principal.tenant_id}'"
        )
    if conf_project and conf_project != principal.project_id:
        errors.append(
            f"project_id '{conf_project}' does not match authenticated project '{principal.project_id}'"
        )

    policy = request.app.state.registry.inheritance.policy
    allowed_sections = set(policy.project_sections) | {
        "skills",
        "tenant_id",
        "project_id",
        "allow_user_overrides",
        "allow_user_preferences",
        "project_template",
    }

    # Strict platform-level delegation check
    extra_sections = set(data.keys()) - allowed_sections
    if extra_sections:
        errors.append(
            f"Sections {sorted(extra_sections)} are not delegated by platform policy (permitted sections: {sorted(policy.project_sections)})"
        )

    # Check skills against platform rules
    skills = data.get("skills", {})
    if isinstance(skills, dict):
        for name, override in skills.items():
            rule = policy.skills.get(name)
            if not rule:
                errors.append(f"Skill '{name}' is not registered in platform policy")
                continue
            if rule.immutable:
                errors.append(
                    f"Skill '{name}' is marked immutable at platform level and cannot be overridden by projects"
                )
            elif not rule.project_override:
                errors.append(
                    f"Skill '{name}' does not allow project-level overrides in platform policy"
                )
            if isinstance(override, dict):
                actions = override.get("actions")
                if actions:
                    unauthorized = set(actions) - set(rule.actions)
                    if unauthorized:
                        errors.append(
                            f"Skill '{name}' requests actions not permitted by platform: {sorted(unauthorized)} (allowed: {sorted(rule.actions)})"
                        )

    # Check capabilities against platform definitions
    capabilities = data.get("capabilities", {})
    if isinstance(capabilities, dict):
        platform_caps = {
            cap.id: cap for cap in request.app.state.registry.list_all()
        }
        for cap_id, cap_override in capabilities.items():
            cap = platform_caps.get(cap_id)
            if not cap:
                errors.append(
                    f"Capability '{cap_id}' is not a registered platform capability"
                )
                continue
            if isinstance(cap_override, dict):
                actions = cap_override.get("allowed_actions")
                if actions:
                    unauth_actions = set(actions) - set(
                        cap.permissions.allowed_actions
                    )
                    if unauth_actions:
                        errors.append(
                            f"Capability '{cap_id}' grants actions not permitted by platform: {sorted(unauth_actions)}"
                        )
                roles = cap_override.get("allowed_roles")
                if roles and cap.permissions.allowed_roles:
                    unauth_roles = set(roles) - set(
                        r.value for r in cap.permissions.allowed_roles
                    )
                    if unauth_roles:
                        errors.append(
                            f"Capability '{cap_id}' grants roles not permitted by platform: {sorted(unauth_roles)}"
                        )
                model_profile = cap_override.get("model_profile")
                if model_profile and model_profile not in policy.model_profiles:
                    errors.append(
                        f"Capability '{cap_id}' requests model profile '{model_profile}' not in platform profiles {list(policy.model_profiles)}"
                    )

    # Check user preferences
    user_prefs = data.get("allow_user_preferences", [])
    if isinstance(user_prefs, list):
        unauth_prefs = set(user_prefs) - set(policy.user_preferences)
        if unauth_prefs:
            errors.append(
                f"User preferences {sorted(unauth_prefs)} are not permitted by platform policy (allowed: {list(policy.user_preferences)})"
            )

    # Check user overrides
    user_overrides = data.get("allow_user_overrides", [])
    if isinstance(user_overrides, list):
        for name in user_overrides:
            rule = policy.skills.get(name)
            if not rule or rule.immutable or not rule.user_override:
                errors.append(
                    f"Skill '{name}' cannot be delegated for user overrides per platform policy"
                )

    # Check environments
    environments = data.get("environments")
    if environments is not None:
        if not isinstance(environments, list):
            errors.append("Field 'environments' must be a list of environment configurations")
        else:
            seen_ids = set()
            for idx, env in enumerate(environments):
                if not isinstance(env, dict):
                    errors.append(f"Environment at index {idx} must be an object")
                    continue
                env_id = env.get("id")
                if not env_id or not isinstance(env_id, str):
                    errors.append(f"Environment at index {idx} missing required string 'id'")
                elif not re.fullmatch(r"^[A-Za-z0-9_.-]+$", env_id):
                    errors.append(
                        f"Environment '{env_id}' contains invalid characters (must match ^[A-Za-z0-9_.-]+$)"
                    )
                elif env_id in seen_ids:
                    errors.append(f"Duplicate environment id '{env_id}' at index {idx}")
                else:
                    seen_ids.add(env_id)
                if not env.get("name"):
                    errors.append(f"Environment '{env_id or idx}' missing required 'name'")

    if not errors:
        try:
            validated_dict = dict(data)
            validated_dict["tenant_id"] = principal.tenant_id
            validated_dict["project_id"] = principal.project_id
            layer = ProjectLayer.model_validate(validated_dict)
            request.app.state.registry.harness.validate_selection(layer.harness)
            return True, [], warnings, layer.model_dump(mode="json")
        except Exception as exc:
            errors.append(f"Project layer schema error: {exc}")

    return len(errors) == 0, errors, warnings, None


@router.get("/api/v1/project/setup")
async def project_setup(request: Request, principal: Principal):
    inventory, published = await _connector_template_catalog(request)
    runtime = request.app.state.registry.inheritance.runtime(
        principal,
        request.app.state.settings,
        request.app.state.platform.prompts,
    )
    configured = runtime["settings"]
    project = request.app.state.registry.inheritance.project(principal)
    sample_reference, sample_payload = _read_reference_file(
        [
            *(
                _project_file_candidates(
                    request.app.state.settings.projects_root,
                    principal.tenant_id,
                    principal.project_id,
                )
            ),
        ],
        Path(request.app.state.settings.projects_root),
        principal.tenant_id,
        principal.project_id,
    )
    disabled = set(project.disabled_connectors) if project else set()
    all_connectors, templates_by_system = _all_connectors(request, inventory)
    enabled = all_connectors - disabled
    health_rows = await request.app.state.runner.health(enabled)
    project_health = {
        name: (
            health_rows[name]
            if name in health_rows
            else _connector_not_configured_health(
                connector_id=name,
                mode=request.app.state.settings.mode,
                template=name in templates_by_system,
            )
        )
        for name in sorted(enabled)
    }

    policy = request.app.state.registry.inheritance.policy
    rules = request.app.state.registry.inheritance.rules
    available_capabilities = []
    for cap in request.app.state.registry.list_all():
        item = cap.model_dump(mode="json")
        item["required_connectors"] = list(cap.requires.connectors)
        item["optional_connectors"] = list(cap.optional.connectors)
        item["agent_bindings"] = await _agent_bindings(request, principal, cap.id)
        available_capabilities.append(item)
    available_skills = [
        {
            "id": skill_id,
            "name": skill_id,
            "immutable": bool(rules[skill_id].immutable) if skill_id in rules else False,
            "project_override": bool(rules[skill_id].project_override) if skill_id in rules else False,
            "user_override": bool(rules[skill_id].user_override) if skill_id in rules else False,
            "actions": list(rules[skill_id].actions) if skill_id in rules else [],
        }
        for skill_id in sorted(request.app.state.registry.skill_contents.keys())
    ]
    parameters = await request.app.state.parameters.resolve(
        principal.tenant_id,
        principal.project_id,
        published,
        request.app.state.platform.connector_options,
    )
    connector_fields = [
        {
            "tool": row["tool"],
            "variable_name": row["variable_name"],
            "value_type": row["value_type"],
            "description": row["description"],
            "default_value": row["default_value"],
            "effective_value": row["effective_value"],
            "revision": row["revision"],
            "override_revision": row.get("override_revision"),
            "allow_project_override": row["allow_project_override"],
            "enabled": row.get("enabled", True),
            "category": row.get("category"),
            "subcategory": row.get("subcategory"),
            "allowed_values": row.get("allowed_values"),
            "effective_state": row.get("effective_state", "SET"),
            "project_visible": row.get("project_visible", True),
            "source": row["source"],
        }
        for row in parameters
        if row.get("tool") in all_connectors and row.get("project_visible", True)
    ]
    # Share the builtin-to-stage mapping used by Harness compilation and agents.
    profiles = request.app.state.platform.profiles
    bindings = []
    for definition in request.app.state.registry.list_all():
        resolved = CapabilityResolver(request.app.state.registry).resolve(
            definition.id, principal, check_health=False,
        )
        if resolved.is_authorized:
            bindings.append(resolved.capability)
    stage_definitions = []
    for stage in dict.fromkeys(BUILTINS.values()):
        model_stage = "triage" if stage in {"orchestrator", "router"} else stage
        configured_bindings = []
        for capability in bindings:
            profile = profiles.profiles[capability.model_profile]
            stage_id = getattr(profile, model_stage)
            configured_bindings.append({
                "capability": capability.id,
                "binding_scope": "capability_default",
                "harness_workspace_api": f"/api/v1/harness/workspace?capability={capability.id}",
                "model_profile": capability.model_profile,
                "stage_id": stage_id,
                **profiles.stages[stage_id].model_dump(mode="json"),
            })
        stage_definitions.append({
            "id": stage,
            "name": stage.replace("_", " ").title(),
            "description": f"Configured {stage} agent stage",
            "default_model": configured_bindings[0]["model_profile"] if configured_bindings else None,
            "agent_ids": [name for name, value in BUILTINS.items() if value == stage],
            "bindings": configured_bindings,
            "source": "config/model_profiles.yaml",
            "content_hash": content_hash(configured_bindings),
        })

    managed_templates = await request.app.state.project_templates.list(principal.tenant_id)
    selectable_templates = [{k: v for k, v in item.items() if k != "tenant_id"}
                            for item in managed_templates if item["status"] == "published"]
    bound = next((item for item in managed_templates if project and project.project_template
                  and item["template_id"] == project.project_template.template_id
                  and item["version"] == project.project_template.template_version), None)
    template_document = bound["definition"] if bound else {"harness": {}}

    from app.api.routes.harness import _project_revision
    return {
        "project_revision": _project_revision(project),
        "generated_at": time.time(),
        "scope": {
            "tenant_id": principal.tenant_id,
            "project_id": principal.project_id,
            "subject": principal.subject,
            "mode": request.app.state.settings.mode,
            "auth_configured": request.app.state.settings.auth_configured,
        },
        "runtime": {
            "settings": configured.model_dump(mode="json"),
            "max_tool_calls": runtime["max_tool_calls"],
            "workflow": runtime["workflow"].model_dump(mode="json"),
            "preferences": runtime["preferences"].model_dump(mode="json"),
            "disabled_connectors": list(runtime["disabled_connectors"]),
            "prompts": runtime["prompts"],
            "environments": [
                env.model_dump(mode="json")
                for env in runtime.get("environments", ())
            ],
        },
        "policy": policy.model_dump(mode="json"),
        "platform_policy": {
            "project_sections": list(policy.project_sections),
            "model_profiles": list(policy.model_profiles),
            "user_preferences": list(policy.user_preferences),
            "skills": {
                name: rule.model_dump(mode="json")
                for name, rule in policy.skills.items()
            },
        },
        "available_capabilities": available_capabilities,
        "available_skills": available_skills,
        "stage_definitions": stage_definitions,
        "project_template": await project_template_context(
            request.app.state.project_templates, principal, project, request.app.state.harness.revision,
        ),
        "project_templates": selectable_templates,
        "template_yaml": yaml.safe_dump(template_document, sort_keys=False),
        "project_layer": project.model_dump(mode="json") if project else None,
        "template_snapshot": [
            _template_payload(template, parameters, visible_only=True)
            for template in published
        ],
        "connector_fields": connector_fields,
        "project_file": {
            **sample_reference,
            **sample_payload,
        },
        "connector_health": {
            name: probe.model_dump(mode="json")
            for name, probe in project_health.items()
        },
    }


async def _project_environment_dependency_errors(request, principal, validated):
    if validated is None:
        return []
    active = {env["id"] for env in validated.get("environments", []) if env.get("enabled", True)}
    instances = await request.app.state.platform_admin.list_project_connector_instances(principal.tenant_id, principal.project_id)
    errors = []
    for instance in instances:
        if not instance.get("enabled"):
            continue
        missing = {binding["project_env_id"] for binding in instance.get("bindings", [])
                   if binding.get("project_env_id") not in active}
        if missing:
            errors.append(f"Setup: connector {instance['instance_id']} still references environments {', '.join(sorted(missing))}; remap or disable it first")
    return errors


@router.post("/api/v1/project/validate")
async def validate_project_setup(
    payload: ProjectConfigPayload, request: Request, principal: Principal
):
    if payload.expected_editor_version is not None:
        from app.api.routes.project_editor import validate_setup_draft
        require_roles(principal, {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER})
        await validate_setup_draft(request, principal, payload.expected_editor_version)
    valid, errors, warnings, validated = _validate_project_yaml(
        payload.yaml, request, principal
    )
    errors.extend(await _project_environment_dependency_errors(request, principal, validated))
    valid = valid and not errors
    return {
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "effective_configuration": validated,
    }


@router.post("/api/v1/project/setup")
async def save_project_setup(
    payload: ProjectConfigPayload, request: Request, principal: Principal
):
    if not {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}.intersection(
        principal.roles
    ):
        raise HTTPException(
            403,
            "Only PLATFORM_ADMIN or PROJECT_OWNER can modify project configuration",
        )
    from app.api.routes.harness import _lock, _project_revision
    async with _lock(request):
        project = request.app.state.registry.inheritance.project(principal)
        if (payload.expected_project_revision is not None
                and payload.expected_project_revision != _project_revision(project)):
            raise HTTPException(409, "Project settings changed; reload and review before applying")
        if payload.expected_editor_version is not None:
            from app.api.routes.project_editor import validate_setup_draft
            await validate_setup_draft(request, principal, payload.expected_editor_version)
        valid, errors, warnings, validated = _validate_project_yaml(
            payload.yaml, request, principal
        )
        errors.extend(await _project_environment_dependency_errors(request, principal, validated))
        valid = valid and not errors
        if not valid:
            raise HTTPException(
                422,
                detail=f"Project configuration failed platform policy validation: {'; '.join(errors)}",
            )
        persisted = load_yaml_data(payload.yaml) | {
            "tenant_id": principal.tenant_id, "project_id": principal.project_id,
        }
        if validated.get("project_template"):
            persisted["project_template"] = validated["project_template"]
        try:
            await _save_project_file(request, principal, yaml.safe_dump(persisted, sort_keys=False),
                expected_editor_version=payload.expected_editor_version)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        request.app.state.registry.inheritance.projects[
            (principal.tenant_id, principal.project_id)
        ] = ProjectLayer.model_validate(persisted)
    return await project_setup(request, principal)


class ProjectAvailabilityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool
    expected_enabled: StrictBool


@router.put("/api/v1/project/availability/{kind}/{resource_id}")
async def set_project_availability(
    kind: Literal["connectors", "capabilities", "skills"], resource_id: str,
    payload: ProjectAvailabilityPayload, request: Request, principal: Principal,
):
    """Persist the narrowing policy used by capability resolution and preflight."""
    if not {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}.intersection(principal.roles):
        raise HTTPException(403, "Only PLATFORM_ADMIN or PROJECT_OWNER can modify project configuration")
    if not hasattr(request.app.state, "availability_lock"):
        request.app.state.availability_lock = asyncio.Lock()
    async with request.app.state.availability_lock:
        registry = request.app.state.registry
        if kind == "connectors":
            known = _all_connectors(request)[0]
        elif kind == "capabilities":
            known = {cap.id for cap in registry.list_all()}
        else:
            known = set(registry.skill_contents.keys())
        if resource_id not in known:
            raise HTTPException(404, "Unknown project resource")
        if kind == "skills":
            rule = registry.inheritance.rules.get(resource_id)
            if rule and rule.immutable:
                raise HTTPException(403, f"Skill '{resource_id}' is marked immutable in platform policy and cannot be altered by projects")
        project = registry.inheritance.project(principal)
        content = project.model_dump(mode="json", exclude_unset=True) if project else {
            "tenant_id": principal.tenant_id, "project_id": principal.project_id,
        }
        if kind == "connectors":
            disabled = set(content.get("disabled_connectors", []))
            current = resource_id not in disabled
            if payload.enabled:
                disabled.discard(resource_id)
            else:
                disabled.add(resource_id)
            content["disabled_connectors"] = sorted(disabled)
        elif kind == "capabilities":
            override = content.setdefault("capabilities", {}).setdefault(resource_id, {})
            current = override.get("enabled", True)
            override["enabled"] = payload.enabled
        else:
            override = content.setdefault("skills", {}).setdefault(resource_id, {})
            current = override.get("enabled", True)
            override["enabled"] = payload.enabled
        if current != payload.expected_enabled:
            raise HTTPException(409, "Availability changed. Refresh before trying again.")
        await save_project_setup(ProjectConfigPayload(yaml=yaml.safe_dump(content)), request, principal)
        return {"id": resource_id, "project_enabled": payload.enabled}
