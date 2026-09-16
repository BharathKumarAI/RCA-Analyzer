"""Project-scoped measurements and explicit platform model pricing."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.dependencies import Principal
from app.configuration.model_pricing import PricingUpdate, read_pricing, save_pricing, review_pricing
from app.configuration.knowledge import KnowledgeReview
from app.persistence.telemetry import metrics_window, telemetry
from app.runtime.sla_engine import resolve_sla_targets

router = APIRouter(prefix="/api/v1/telemetry", tags=["telemetry"])


@router.get("")
async def get_telemetry(request: Request, principal: Principal,
    start: date | None = None, end: date | None = None,
    window: Literal["24h", "7d", "30d", "90d"] | None = None,
    capability: str | None = Query(default=None, min_length=1, max_length=128),
    stage: str | None = Query(default=None, min_length=1, max_length=128),
    mode: Literal["live", "demo"] = "live",
):
    try:
        begin, finish = metrics_window(start, end, window)
        sla_targets = await resolve_sla_targets(request.app.state.parameters, principal)
        return await telemetry(request.app.state.store.engine, principal, begin, finish,
                               capability=capability, stage=stage, mode=mode, sla_targets=sla_targets)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/pricing")
async def get_model_pricing(request: Request, principal: Principal):
    return await read_pricing(request.app.state.store.engine, principal)


@router.put("/pricing")
async def update_model_pricing(payload: PricingUpdate, request: Request, principal: Principal):
    try:
        return await save_pricing(request.app.state.store.engine, principal, payload)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/pricing/{action}")
async def review_model_pricing(action: Literal["approve", "reject", "revoke"], payload: KnowledgeReview,
                              request: Request, principal: Principal):
    try:
        return await review_pricing(request.app.state.store.engine, principal, action, payload)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
