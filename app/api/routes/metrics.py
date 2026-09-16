"""SRE and Platform Metrics endpoints, separating project telemetry and authorized platform totals."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.dependencies import Principal, require_roles
from app.identity.principals import Role
from app.persistence.platform_metrics import platform_metrics
from app.persistence.telemetry import metrics_window, telemetry
from app.runtime.sla_engine import resolve_sla_targets

router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])


@router.get("")
async def get_project_metrics(
    request: Request,
    principal: Principal,
    start: date | None = None,
    end: date | None = None,
    window: Literal["24h", "7d", "30d", "90d"] | None = None,
    capability: str | None = Query(default=None, min_length=1, max_length=128),
    stage: str | None = Query(default=None, min_length=1, max_length=128),
    mode: Literal["live", "demo"] = "live",
):
    try:
        begin, finish = metrics_window(start, end, window)
        sla_targets = await resolve_sla_targets(request.app.state.parameters, principal)
        return await telemetry(
            request.app.state.store.engine,
            principal,
            begin,
            finish,
            capability=capability,
            stage=stage,
            mode=mode,
            sla_targets=sla_targets,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/platform")
async def get_platform_metrics(
    request: Request,
    principal: Principal,
    start: date | None = None,
    end: date | None = None,
    window: Literal["24h", "7d", "30d", "90d"] | None = None,
    mode: Literal["live", "demo"] = "live",
):
    # Server-enforced platform administrator authorization
    require_roles(principal, {Role.PLATFORM_ADMIN})

    try:
        begin, finish = metrics_window(start, end, window)
        return await platform_metrics(
            request.app.state.store.engine,
            principal,
            begin,
            finish,
            mode=mode,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
