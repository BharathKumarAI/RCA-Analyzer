import asyncio
import hashlib
from dataclasses import asdict
import os
from pathlib import Path
import resource
import sys
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.capabilities.resolver import CapabilityResolver
from app.identity.principals import Role, UserPrincipal
from app.observability.otel import telemetry_status
from app.api.dependencies import Principal

router = APIRouter()


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
    connectors = await request.app.state.runner.health({"itsm", "log_search"} - disabled)
    expected = {"itsm", "log_search"} - disabled
    unhealthy = set(connectors) != expected or any(
        item.overall.value != "HEALTHY" for item in connectors.values()
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
    """Expose only implemented tools and their current probe status."""
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    health = await request.app.state.runner.health({"itsm", "log_search"} - disabled)
    definitions = {
        "itsm": ("itsm.get_ticket", "Ticketing", "Read-only Jira ticket lookup"),
        "log_search": ("log_search.query_range", "Observability", "Bounded read-only Splunk log search"),
    }
    result = []
    for connector, (action, category, description) in definitions.items():
        probe = health.get(connector)
        result.append({
            "id": action,
            "name": action,
            "system_name": connector,
            "category": category,
            "description": description,
            "status": "disabled" if connector in disabled else (
                "connected"
                if request.app.state.settings.mode == "live" and probe and probe.overall.value == "HEALTHY"
                else "planned" if request.app.state.settings.mode == "demo" and probe else "degraded"
            ),
            "enabled": connector not in disabled and probe is not None,
            "type": "connector",
            "scope_level": "platform_default",
            "project_can_override": True,
            "inherit_platform_defaults": True,
            "latency_ms": probe.latency_ms if probe else None,
            "last_ping": probe.last_probed_at if probe else None,
            "calls_today": None,
            "error_rate": None,
            "health": probe.model_dump(mode="json") if probe else None,
        })
    return result


@router.get("/api/v1/skills")
async def skills(request: Request, principal: Principal):
    """Expose the loaded, immutable platform skill catalog and effective rules."""
    registry = request.app.state.registry
    rules = registry.inheritance.rules
    result = []
    for skill_id, source in sorted(registry.skill_contents.items()):
        rule = rules.get(skill_id)
        result.append({
            "id": skill_id,
            "name": skill_id,
            "status": "configured",
            "size_bytes": len(source.encode()),
            "sha256": hashlib.sha256(source.encode()).hexdigest(),
            "source": "platform",
            "immutable": bool(rule.immutable) if rule else False,
            "allowed_actions": list(rule.actions) if rule else [],
            "project_override": bool(rule.project_override) if rule else False,
            "user_override": bool(rule.user_override) if rule else False,
        })
    return result


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
async def capabilities(request: Request, principal: Principal):
    registry = request.app.state.registry
    resolver = CapabilityResolver(registry)
    return [
        resolved.capability.model_dump(mode="json")
        for cap in registry.list_all()
        if (
            resolved := resolver.resolve(cap.id, principal, check_health=False)
        ).is_authorized
    ]


@router.get("/api/v1/connectors/health")
async def connector_health(request: Request, principal: Principal):
    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    available = {"itsm", "log_search"} - disabled
    result = await request.app.state.runner.health(available)
    return {
        "disabled": sorted(disabled),
        "mode": request.app.state.settings.mode,
        "connectors": result,
        "unconfigured": sorted(available - set(result)),
    }


@router.get("/api/v1/system/diagnostics")
async def system_diagnostics(request: Request, principal: Principal):
    t0 = time.monotonic()
    db_ok = False
    try:
        await request.app.state.store.ping()
        db_ok = True
    except Exception:
        db_ok = False
    db_latency_ms = round((time.monotonic() - t0) * 1000, 2)

    projects_root = Path(request.app.state.settings.projects_root)
    if not projects_root.exists():
        fallback = Path("blob_local/projects").resolve()
        if fallback.exists():
            projects_root = fallback
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
        s = os.statvfs(str(check_path.resolve()))
        disk_free_gb = round((s.f_bavail * s.f_frsize) / (1024**3), 2)
        disk_total_gb = round((s.f_blocks * s.f_frsize) / (1024**3), 2)
    except Exception:
        disk_free_gb = 0.0
        disk_total_gb = 0.0

    mlflow_uri = request.app.state.settings.optimization_tracking_uri.get_secret_value()
    mlflow_status = "configured" if mlflow_uri else "unconfigured"

    project = request.app.state.registry.inheritance.project(principal)
    disabled = set(project.disabled_connectors) if project else set()
    available = {"itsm", "log_search"} - disabled
    conn_result = await request.app.state.runner.health(available)

    return {
        "timestamp": time.time(),
        "database": {
            "status": "healthy" if db_ok else "unreachable",
            "latency_ms": db_latency_ms,
            "dialect": request.app.state.store.engine.dialect.name,
            "schema_version": 3,
            "schemas": [
                "runtime",
                "governance",
                "optimization",
                "platform",
                "project",
                "adk",
            ],
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
