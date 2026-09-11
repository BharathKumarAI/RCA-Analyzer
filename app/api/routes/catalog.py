import asyncio
from dataclasses import asdict
import os
from pathlib import Path
import resource
import sys
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.capabilities.resolver import CapabilityResolver
from app.identity.principals import UserPrincipal
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
        else:
            try:
                projects_root.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
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

    mlflow_uri = (
        request.app.state.settings.optimization_tracking_uri.get_secret_value()
    )
    mlflow_status = "connected" if mlflow_uri else "unconfigured"

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
            "status": (
                "healthy"
                if storage_writable or projects_root.exists()
                else "degraded"
            ),
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
            "tracking_uri": mlflow_uri,
            "experiment_store": "sqlite_local",
            "offline_eval_contracts": ["Quality", "Safety", "Latency", "Cost"],
        },
        "connectors": {
            "mode": request.app.state.settings.mode,
            "results": conn_result,
            "disabled": sorted(disabled),
        },
    }

