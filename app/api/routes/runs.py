"""Runs API routes; application services own execution."""

import asyncio
from typing import Annotated

from fastapi import Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.identity.principals import Role
from app.runtime.run_contract import RunRequest, RunResponse, TERMINAL_STATUSES
from app.schemas.evidence import EvidenceBundle

from app.api.dependencies import Principal, require_roles
from app.api.schemas import RunExecutionRequest
from fastapi import APIRouter

router = APIRouter()


@router.post("/api/v1/runs", response_model=RunResponse)
async def execute_run(
    req: RunExecutionRequest,
    request: Request,
    principal: Principal,
    idempotency_key: Annotated[str | None, Header(max_length=128)] = None,
):
    try:
        return await request.app.state.runner.execute(
            principal,
            RunRequest(
                text=req.prompt,
                chat_id=req.chat_id,
                incident_id=req.incident_id,
                attachment_ids=tuple(req.attachment_ids),
            ),
            req.capability,
            idempotency_key,
        )
    except PermissionError:
        raise HTTPException(403, "Run or attachment access denied") from None
    except OverflowError:
        raise HTTPException(
            429, "Investigation capacity reached", headers={"Retry-After": "5"}
        ) from None
    except ValueError:
        raise HTTPException(
            409,
            "Request conflicts with configuration, attachment limits, or an existing idempotency key",
        ) from None


@router.get("/api/v1/runs", response_model=list[RunResponse])
async def list_runs(
    request: Request,
    principal: Principal,
    limit: int = Query(50, ge=1, le=100),
    before: float | None = None,
):
    return await request.app.state.store.list_runs(principal, limit, before)


@router.get("/api/v1/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: str, request: Request, principal: Principal):
    result = await request.app.state.store.get_run(run_id, principal)
    if result is None:
        raise HTTPException(404, "Run not found")
    return result


@router.post("/api/v1/runs/{run_id}/cancel", response_model=RunResponse)
async def cancel_run(run_id: str, request: Request, principal: Principal):
    require_roles(
        principal,
        {
            Role.PLATFORM_ADMIN,
            Role.TENANT_ADMIN,
            Role.PROJECT_OWNER,
            Role.PROJECT_MANAGER,
            Role.PROJECT_ANALYST,
            Role.OPERATOR,
        },
    )
    result = await request.app.state.runner.cancel(run_id, principal)
    if result is None:
        raise HTTPException(404, "Run not found")
    return result


@router.get("/api/v1/runs/{run_id}/events")
async def run_events(
    run_id: str,
    request: Request,
    principal: Principal,
    last_event_id: Annotated[int | None, Header()] = None,
):
    if await request.app.state.store.get_run(run_id, principal) is None:
        raise HTTPException(404, "Run not found")

    async def events():
        revision = last_event_id if last_event_id is not None else -1
        while not await request.is_disconnected():
            current = await request.app.state.store.get_run(run_id, principal)
            if current is None:
                return
            if current.revision > revision:
                yield f"id: {current.revision}\nevent: progress\ndata: {current.model_dump_json()}\n\n"
                revision = current.revision
            if current.status in TERMINAL_STATUSES:
                return
            await asyncio.sleep(request.app.state.settings.progress_poll_seconds)

    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/api/v1/runs/{run_id}/evidence", response_model=list[EvidenceBundle])
async def run_evidence(run_id: str, request: Request, principal: Principal):
    if await request.app.state.store.get_run(run_id, principal) is None:
        raise HTTPException(404, "Run not found")
    return await request.app.state.store.list_by_run(run_id, principal)


@router.get("/api/v1/evidence/{evidence_id}", response_model=EvidenceBundle)
async def get_evidence(evidence_id: str, request: Request, principal: Principal):
    result = await request.app.state.store.get(evidence_id, principal)
    if result is None:
        raise HTTPException(404, "Evidence not found")
    return result
