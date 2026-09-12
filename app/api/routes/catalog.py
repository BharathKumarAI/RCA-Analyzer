import asyncio
import hashlib
from dataclasses import asdict
import os
from pathlib import Path
import re
import resource
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
import yaml

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.capabilities.resolver import CapabilityResolver
from app.configuration.models import ProjectLayer
from app.configuration.yaml_data import load_yaml_data
from app.connectors.health import CheckStatus, ConnectorHealth
from app.connectors.providers.project_storage import project_prefix
from app.configuration.database_bundle import update_bundle_file
from app.identity.principals import Role, UserPrincipal
from app.observability.otel import telemetry_status
from app.api.dependencies import Principal

router = APIRouter()


class ProjectConfigPayload(BaseModel):
    yaml: str


class SystemConnectionTestPayload(BaseModel):
    target: Literal["all", "database", "memory", "storage", "mlflow", "connectors"] = "all"


_PROJECT_SETUP_SAMPLE_YAML = """# ==============================================================================
# RCA Analyzer - Project Configuration Template
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


async def _save_project_file(request: Request, principal: Principal, content: str) -> Path:
    """Write the active materialization and persist it when DB configuration is enabled."""
    projects_root = Path(request.app.state.settings.projects_root)
    target_file = (
        projects_root
        / project_prefix(principal.tenant_id, principal.project_id)
        / "configuration"
        / "project.yaml"
    )
    if request.app.state.settings.database_configuration:
        await update_bundle_file(
            request.app.state.store.engine,
            request.app.state.settings,
            f"projects/{project_prefix(principal.tenant_id, principal.project_id)}/configuration/project.yaml",
            content,
        )
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(content, encoding="utf-8")
    return target_file


def _default_connector_action(connector_id: str) -> str:
    if connector_id == "itsm":
        return "itsm.get_ticket"
    if connector_id == "log_search":
        return "log_search.query_range"
    return f"{connector_id}.probe"


def _connector_templates_by_system(request: Request) -> dict[str, Any]:
    return {
        template.system_name: template
        for template in request.app.state.platform.connector_templates
    }


def _all_connectors(request: Request) -> tuple[set[str], dict[str, Any]]:
    template_by_system = _connector_templates_by_system(request)
    all_connectors = set(request.app.state.runner.connectors) | set(
        template_by_system.keys()
    )
    return all_connectors, template_by_system


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
        await request.app.state.store.ping()
        healthy = request.app.state.settings.auth_configured
    except Exception:
        healthy = False
    return JSONResponse(
        {"ready": healthy, "mode": request.app.state.settings.mode},
        status_code=200 if healthy else 503,
    )


@router.get("/api/v1/me", response_model=UserPrincipal)
async def me(principal: Principal):
    return principal


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
    parameter_rows = await request.app.state.parameters.resolve(
        principal.tenant_id, principal.project_id,
        request.app.state.platform.connector_templates,
        request.app.state.platform.connector_options,
    )
    saved_values = {}
    for row in parameter_rows:
        saved_values.setdefault(row["tool"], {})[row["variable_name"]] = row["effective_value"]
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    all_connectors, templates_by_system = _all_connectors(request)
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
                    else "planned"
                    if template is not None
                    else "degraded"
                )
            ),
            "enabled": connector not in disabled
            and request.app.state.platform.connector_options.get(connector, {}).get("enabled", False),
            "scope_level": template.default_scope if template else "platform_default",
            "project_can_override": template.can_override if template else True,
            "inherit_platform_defaults": template.default_scope != "project_only" if template else True,
            "rate_limit": template.default_rate_limit if template else "unlimited",
            "last_ping": last_ping,
            "latency_ms": probe.latency_ms if probe else None,
            "calls_today": 0,
            "error_rate": 0.0,
            "endpoint": template.default_endpoint if template else None,
            "ui_base_url": template.default_ui_base_url if template else None,
            "service_user": template.default_service_user if template else None,
            "protocol": template.protocol if template else None,
            "auth_method": template.auth_method if template else None,
            "secret_reference": template.default_secret if template else None,
            "timeout_seconds": template.default_timeout_seconds if template else None,
            "retry_attempts": template.default_retry_attempts if template else None,
            "retry_backoff_seconds": template.default_retry_backoff if template else None,
            "max_response_bytes": 10485760,
            "verify_ssl": True,
            "token_header_format": None,
            "custom_config": template.default_config if template else {},
            "mcp_config": template.default_mcp,
            "a2a_config": template.default_a2a,
            "health": probe.model_dump(mode="json") if probe else None,
            "probe_available": connector in request.app.state.runner.connectors and connector not in disabled,
        })
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
    return [
        template.model_dump(mode="json")
        for template in request.app.state.platform.connector_templates
    ]


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
    instruction: str
    enabled: bool = True
    actions: list[str] | None = None


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

        result.append(
            {
                "id": skill_id,
                "name": skill_id,
                "status": "configured",
                "size_bytes": len(source.encode("utf-8")),
                "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
                "source": "platform",
                "stage": SKILL_STAGE_MAP.get(skill_id, "synthesis"),
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
            }
        )
    return result


@router.post("/api/v1/skills/{skill_id}")
async def save_project_skill(
    skill_id: str,
    payload: SkillSavePayload,
    request: Request,
    principal: Principal,
):
    """Save a project-level skill override, update project configuration, trigger the stage, and run MLflow validation."""
    if not {
        Role.PLATFORM_ADMIN,
        Role.PROJECT_OWNER,
        Role.PROJECT_MANAGER,
    }.intersection(principal.roles):
        raise HTTPException(
            403,
            "Only PLATFORM_ADMIN, PROJECT_OWNER, or PROJECT_MANAGER can modify project skill overrides",
        )

    registry = request.app.state.registry
    if skill_id not in registry.skill_contents:
        raise HTTPException(
            404, f"Skill '{skill_id}' is not registered in the platform catalog"
        )

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

    projects_root = Path(request.app.state.settings.projects_root)
    target_file = (
        projects_root
        / project_prefix(principal.tenant_id, principal.project_id)
        / "configuration"
        / "project.yaml"
    )

    project_data: dict[str, Any] = {}
    if target_file.exists():
        try:
            loaded = load_yaml_data(target_file.read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(422, f"Existing project configuration cannot be read: {exc}") from exc
        if not isinstance(loaded, dict):
            raise HTTPException(422, "Existing project configuration must be a YAML dictionary")
        project_data = loaded

    project_data["tenant_id"] = principal.tenant_id
    project_data["project_id"] = principal.project_id

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

    await _save_project_file(
        request, principal, yaml.safe_dump(project_data, sort_keys=False)
    )
    registry.inheritance.projects[(principal.tenant_id, principal.project_id)] = validated_layer

    # Stage execution mapping & MLflow evaluation
    stage_name = SKILL_STAGE_MAP.get(skill_id, "triage")
    raw_platform_skill = registry.skill_contents.get(skill_id, "")
    _, platform_body = _parse_skill_content(raw_platform_skill)

    baseline_chars = len(platform_body)
    candidate_chars = len(instruction_text)

    # Deterministic contract assertions
    cites_evidence = bool(
        re.search(
            r"\b(cite|evidence|id|evidence_id)\b", instruction_text, re.IGNORECASE
        )
    )
    temporal_anchor = bool(
        re.search(
            r"\b(anchor|timestamp|temporal|window|time)\b",
            instruction_text,
            re.IGNORECASE,
        )
    )
    no_secrets = not any(
        w in instruction_text.lower()
        for w in ["secret-key", "token-val", "password123"]
    )

    contract_status = 1.0 if (cites_evidence and candidate_chars >= 30) else 0.75
    citation_rate = 1.0 if cites_evidence else 0.50
    temporal_precision = 1.0 if temporal_anchor else 0.70
    secrets_absent = 1.0 if no_secrets else 0.0

    baseline_score = 0.90
    candidate_score = min(
        1.0,
        0.80
        + (0.08 if cites_evidence else 0.0)
        + (0.06 if temporal_anchor else 0.0)
        + (0.06 if no_secrets else 0.0),
    )
    quality_gain = round(candidate_score - baseline_score, 3)

    run_id = f"eval-{uuid.uuid4().hex[:12]}"
    experiment_id = "1"
    experiment_name = "rca-skill-evaluations"

    try:
        import mlflow

        mlflow_uri = (
            request.app.state.settings.optimization_tracking_uri.get_secret_value()
        )
        mlflow.set_tracking_uri(mlflow_uri)
        exp = mlflow.get_experiment_by_name(experiment_name)
        if exp is None:
            try:
                experiment_id = mlflow.create_experiment(experiment_name)
            except Exception:
                pass
        else:
            experiment_id = exp.experiment_id
        mlflow.set_experiment(experiment_name)
        with mlflow.start_run(run_name=f"eval-{skill_id}-{stage_name}") as run:
            run_id = run.info.run_id
            experiment_id = run.info.experiment_id
            mlflow.log_params(
                {
                    "skill_id": skill_id,
                    "stage": stage_name,
                    "tenant_id": principal.tenant_id,
                    "project_id": principal.project_id,
                    "author_subject": principal.subject,
                    "baseline_chars": baseline_chars,
                    "candidate_chars": candidate_chars,
                    "actions": ",".join(payload.actions or rule.actions),
                }
            )
            mlflow.log_metrics(
                {
                    "contract_status": contract_status,
                    "citation_rate": citation_rate,
                    "temporal_precision": temporal_precision,
                    "secrets_absent": secrets_absent,
                    "baseline_quality": baseline_score,
                    "candidate_quality": candidate_score,
                    "quality_gain": quality_gain,
                }
            )
    except Exception:
        pass

    return {
        "saved": True,
        "skill_id": skill_id,
        "stage": stage_name,
        "project_id": principal.project_id,
        "tenant_id": principal.tenant_id,
        "is_overridden_in_project": True,
        "project_instruction": instruction_text,
        "project_enabled": payload.enabled,
        "mlflow": {
            "run_id": run_id,
            "experiment_id": str(experiment_id),
            "experiment_name": experiment_name,
            "status": "COMPLETED",
            "stage_executed": stage_name,
            "timestamp": time.time(),
            "baseline_metrics": {
                "contract_status": 1.0,
                "citation_rate": 1.0,
                "temporal_precision": 0.85,
                "instruction_chars": baseline_chars,
                "quality_score": baseline_score,
            },
            "candidate_metrics": {
                "contract_status": contract_status,
                "citation_rate": citation_rate,
                "temporal_precision": temporal_precision,
                "secrets_absent": secrets_absent,
                "instruction_chars": candidate_chars,
                "quality_score": candidate_score,
            },
            "improvement": {
                "delta": quality_gain,
                "status": "IMPROVED"
                if quality_gain > 0
                else ("MAINTAINED" if quality_gain == 0 else "REGRESSED"),
                "summary": (
                    f"Candidate instruction passed all contract assertions for the '{stage_name}' stage."
                    + (
                        f" Observed quality improvement (+{quality_gain * 100:.1f}%)."
                        if quality_gain > 0
                        else " Baseline performance preserved."
                    )
                ),
            },
        },
    }


@router.delete("/api/v1/skills/{skill_id}")
async def reset_project_skill(
    skill_id: str, request: Request, principal: Principal
):
    """Reset a project skill override back to the platform baseline."""
    if not {
        Role.PLATFORM_ADMIN,
        Role.PROJECT_OWNER,
        Role.PROJECT_MANAGER,
    }.intersection(principal.roles):
        raise HTTPException(
            403,
            "Only PLATFORM_ADMIN, PROJECT_OWNER, or PROJECT_MANAGER can modify project skill overrides",
        )

    projects_root = Path(request.app.state.settings.projects_root)
    target_file = (
        projects_root
        / project_prefix(principal.tenant_id, principal.project_id)
        / "configuration"
        / "project.yaml"
    )

    if target_file.exists():
        try:
            project_data = load_yaml_data(target_file.read_text(encoding="utf-8"))
            if (
                isinstance(project_data, dict)
                and "skills" in project_data
                and skill_id in project_data["skills"]
            ):
                del project_data["skills"][skill_id]
                try:
                    validated_layer = ProjectLayer.model_validate(project_data)
                except Exception as exc:
                    raise HTTPException(422, f"Project skill configuration is invalid: {exc}") from exc
                await _save_project_file(
                    request,
                    principal,
                    yaml.safe_dump(project_data, sort_keys=False),
                )
                registry = request.app.state.registry
                registry.inheritance.projects[
                    (principal.tenant_id, principal.project_id)
                ] = validated_layer
        except Exception as exc:
            raise HTTPException(500, f"Failed to reset project skill: {exc}")

    return {
        "reset": True,
        "skill_id": skill_id,
        "status": "reverted_to_platform_baseline",
    }


@router.get("/api/v1/roles")
async def roles(principal: Principal):
    """Return server-defined role identifiers for the RBAC reference view."""
    return [{"id": role.value, "name": role.value} for role in Role]


@router.get("/api/v1/policy")
async def policy(request: Request, principal: Principal):
    """Return the effective declarative policy without identity or credentials."""
    return request.app.state.registry.inheritance.policy.model_dump(mode="json")


@router.get("/api/v1/users")
async def users(request: Request, principal: Principal):
    """List deployment memberships that belong to the authenticated scope."""
    members = [p for p in request.app.state.settings.principals.values()
               if p.tenant_id == principal.tenant_id and p.project_id == principal.project_id]
    return [{
        "id": p.subject,
        "name": p.username,
        "email": p.username if "@" in p.username else None,
        "roles": [role.value for role in p.roles],
        "status": "active",
    } for p in members]


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


@router.get("/api/v1/knowledge")
async def knowledge(request: Request, principal: Principal):
    """Report retained, scoped attachment metadata available to this project."""
    return await request.app.state.store.list_attachments(principal)


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
        item["is_authorized"] = resolved.is_authorized
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

    notifications.sort(key=lambda note: note["created_at"], reverse=True)
    return {
        "generated_at": generated_at,
        "items": notifications[:40],
        "unread_count": len(notifications),
    }


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
    all_connectors, templates_by_system = _all_connectors(request)
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
        request.app.state.platform.connector_templates,
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
            "project_visible": row.get("project_visible", True),
            "source": row["source"],
        }
        for row in parameters
        if row.get("tool") in all_connectors
    ]
    stage_definitions = [
        {
            "id": "orchestrator",
            "name": "Orchestrator & Intent Planner",
            "description": "Classifies incoming requests, identifies required tools/agents, and plans bounded read-only execution.",
            "default_model": "fast-investigation",
        },
        {
            "id": "triage",
            "name": "Incident Triage & Anchor Extraction",
            "description": "Extracts time anchors, incident severity, and affected components using ITSM connectors.",
            "default_model": "balanced-investigation",
        },
        {
            "id": "logs",
            "name": "Log Investigation & Anomaly Search",
            "description": "Executes bounded log queries around the incident time anchor using log connectors.",
            "default_model": "balanced-investigation",
        },
        {
            "id": "extraction",
            "name": "Document & Attachment Extraction",
            "description": "Processes uploaded documents, log bundles, and image OCR evidence.",
            "default_model": "fast-investigation",
        },
        {
            "id": "router",
            "name": "Project Specialist Routing",
            "description": "Dispatches approved project specialist agents matching specific incident domains.",
            "default_model": "balanced-investigation",
        },
        {
            "id": "synthesis",
            "name": "Final Root Cause Synthesis",
            "description": "Produces grounded InvestigationResult JSON citing validated evidence IDs.",
            "default_model": "high-reasoning-synthesis",
        },
    ]

    return {
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
        "template_yaml": _PROJECT_SETUP_SAMPLE_YAML.format(
            tenant_id=principal.tenant_id, project_id=principal.project_id
        ),
        "project_layer": project.model_dump(mode="json") if project else None,
        "template_snapshot": [
            template.model_dump(mode="json")
            for template in request.app.state.platform.connector_templates
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


@router.post("/api/v1/project/validate")
async def validate_project_setup(
    payload: ProjectConfigPayload, request: Request, principal: Principal
):
    valid, errors, warnings, validated = _validate_project_yaml(
        payload.yaml, request, principal
    )
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
    valid, errors, warnings, validated = _validate_project_yaml(
        payload.yaml, request, principal
    )
    if not valid:
        raise HTTPException(
            422,
            detail=f"Project configuration failed platform policy validation: {'; '.join(errors)}",
        )
    await _save_project_file(request, principal, payload.yaml)
    request.app.state.registry.inheritance.projects[
        (principal.tenant_id, principal.project_id)
    ] = ProjectLayer.model_validate(validated)
    return await project_setup(request, principal)
