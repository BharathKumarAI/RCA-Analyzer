"""SRE and Platform Metrics endpoints, separating project telemetry and authorized platform totals."""

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.dependencies import Principal, require_roles
from app.configuration.service import ADMIN_ROLES
from app.persistence.platform_metrics import platform_metrics
from app.persistence.telemetry import telemetry

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
    finish = end or datetime.now(timezone.utc).date()
    if start:
        begin = start
    elif window == "24h":
        begin = finish - timedelta(days=1)
    elif window == "7d":
        begin = finish - timedelta(days=6)
    elif window == "90d":
        begin = finish - timedelta(days=89)
    else:
        # Default 30 days
        begin = finish - timedelta(days=29)

    try:
        return await telemetry(
            request.app.state.store.engine,
            principal,
            begin,
            finish,
            capability=capability,
            stage=stage,
            mode=mode,
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
    require_roles(principal, ADMIN_ROLES)

    finish = end or datetime.now(timezone.utc).date()
    if start:
        begin = start
    elif window == "24h":
        begin = finish - timedelta(days=1)
    elif window == "7d":
        begin = finish - timedelta(days=6)
    elif window == "90d":
        begin = finish - timedelta(days=89)
    else:
        begin = finish - timedelta(days=29)

    try:
        return await platform_metrics(
            request.app.state.store.engine,
            principal,
            begin,
            finish,
            mode=mode,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
