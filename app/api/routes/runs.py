"""Runs API routes; application services own execution."""

import asyncio
import json
from typing import Annotated

from fastapi import Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.identity.principals import Role
from app.persistence.store import runs
from app.runtime.run_contract import RunRequest, RunResponse, TERMINAL_STATUSES
from app.schemas.evidence import EvidenceBundle

from app.api.dependencies import Principal, require_roles
from app.api.schemas import RunExecutionRequest
from fastapi import APIRouter

router = APIRouter()


def _event_store(request: Request):
    return getattr(request.app.state, "run_events", None) or getattr(
        request.app.state, "run_event_store", None
    )


def _sse(event: str, data, event_id: int | None = None) -> str:
    prefix = f"id: {event_id}\n" if event_id is not None else ""
    payload = data if isinstance(data, str) else json.dumps(data, separators=(",", ":"))
    return f"{prefix}event: {event}\ndata: {payload}\n\n"


@router.post("/api/v1/runs", response_model=RunResponse)
async def execute_run(
    req: RunExecutionRequest,
    request: Request,
    principal: Principal,
    idempotency_key: Annotated[str | None, Header(max_length=128)] = None,
    stream: bool = Query(False),
):
    if stream:
        return await _stream_run(request, principal, req, idempotency_key)
    try:
        return await request.app.state.runner.execute(
            principal,
            RunRequest(
                text=req.prompt,
                chat_id=req.chat_id,
                incident_id=req.incident_id,
                attachment_ids=tuple(req.attachment_ids),
                connector_selections=req.connector_selections,
                environment_id=req.environment_id,
                knowledge_document_ids=tuple(req.knowledge_document_ids),
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


async def _stream_run(request: Request, principal: Principal, req: RunExecutionRequest, idempotency_key: str | None):
    """Run in the request task and stream only records that have been persisted."""
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=4)
    run_id_ref: dict[str, str] = {}

    async def on_created(created, *_args, **_kwargs):
        run_id = (
            created
            if isinstance(created, str)
            else created.get("run_id")
            if isinstance(created, dict)
            else getattr(created, "run_id", None)
        )
        if run_id:
            run_id_ref["run_id"] = run_id
            try:
                queue.put_nowait({"event": "run", "data": {"run_id": run_id}})
            except asyncio.QueueFull:
                pass

    async def execute():
        return await request.app.state.runner.execute(
            principal,
            RunRequest(
                text=req.prompt,
                chat_id=req.chat_id,
                incident_id=req.incident_id,
                attachment_ids=tuple(req.attachment_ids),
                connector_selections=req.connector_selections,
                environment_id=req.environment_id,
                knowledge_document_ids=tuple(req.knowledge_document_ids),
            ),
            req.capability,
            idempotency_key,
            on_created=on_created,
        )

    async def events():
        task = asyncio.create_task(execute())
        progress_revision = -1
        trace_sequence = 0
        emitted_run = False
        try:
            while True:
                ready_item = None
                if not task.done() and queue.empty():
                    queue_task = asyncio.create_task(queue.get())
                    try:
                        await asyncio.wait(
                            {queue_task, task},
                            timeout=request.app.state.settings.progress_poll_seconds,
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                    finally:
                        if not queue_task.done():
                            queue_task.cancel()
                            await asyncio.gather(queue_task, return_exceptions=True)
                        elif queue_task.done():
                            ready_item = queue_task.result()

                if ready_item is not None:
                    if ready_item["event"] == "run":
                        emitted_run = True
                    yield _sse(ready_item["event"], ready_item["data"])
                while not queue.empty():
                    item = queue.get_nowait()
                    if item["event"] == "run":
                        emitted_run = True
                    yield _sse(item["event"], item["data"])

                if task.done() and not run_id_ref.get("run_id"):
                    try:
                        completed = task.result()
                    except Exception as exc:
                        detail = (
                            "Run or attachment access denied"
                            if isinstance(exc, PermissionError)
                            else "Investigation could not be started"
                        )
                        yield _sse("error", {"detail": detail})
                        return
                    run_id = getattr(completed, "run_id", None)
                    if not run_id:
                        yield _sse("error", {"detail": "Run did not produce an ID"})
                        return
                    run_id_ref["run_id"] = run_id
                    if not emitted_run:
                        yield _sse("run", {"run_id": run_id})
                        emitted_run = True

                run_id = run_id_ref.get("run_id")
                if run_id:
                    current = await request.app.state.store.get_run(run_id, principal)
                    if current is None:
                        yield _sse("error", {"detail": "Run not found"})
                        return
                    if current.revision > progress_revision:
                        yield _sse("progress", current.model_dump_json(), current.revision)
                        progress_revision = current.revision
                    event_store = _event_store(request)
                    if event_store is not None:
                        for trace_event in await event_store.list(
                            run_id, principal, after=trace_sequence
                        ):
                            yield _sse("trace", trace_event, trace_event["sequence"])
                            trace_sequence = trace_event["sequence"]
                    if current.status in TERMINAL_STATUSES and task.done():
                        yield _sse("complete", current.model_dump_json(), current.revision)
                        return

                if task.done():
                    try:
                        task.result()
                    except Exception as exc:
                        detail = (
                            "Run or attachment access denied"
                            if isinstance(exc, PermissionError)
                            else "Investigation could not complete"
                        )
                        yield _sse("error", {"detail": detail})
                        return
                    if run_id_ref.get("run_id"):
                        await asyncio.sleep(request.app.state.settings.progress_poll_seconds)
                    else:
                        return
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(events(), media_type="text/event-stream")


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
            Role.PROJECT_OWNER,
            Role.PROJECT_MANAGER,
            Role.PROJECT_ANALYST,
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
                yield _sse("progress", current.model_dump_json(), current.revision)
                revision = current.revision
            if current.status in TERMINAL_STATUSES:
                return
            await asyncio.sleep(request.app.state.settings.progress_poll_seconds)

    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/api/v1/runs/{run_id}/trace")
async def run_trace(run_id: str, request: Request, principal: Principal):
    if await request.app.state.store.get_run(run_id, principal) is None:
        raise HTTPException(404, "Run not found")
    event_store = _event_store(request)
    if event_store is None:
        raise HTTPException(503, "Run trace storage is unavailable")
    graph = None
    async with request.app.state.store.engine.connect() as connection:
        row = (
            await connection.execute(
                select(runs.c.contract_json).where(
                    runs.c.run_id == run_id,
                    runs.c.tenant_id == principal.tenant_id,
                    runs.c.project_id == principal.project_id,
                )
            )
        ).first()
    if row is not None:
        try:
            snapshot = json.loads(json.loads(row.contract_json)["model_config_json"])
            graph = snapshot.get("resolved_graph")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            graph = None
    events = await event_store.list(run_id, principal)
    response = {"graph": graph, "events": events}
    if events and events[0]["sequence"] > 1:
        response["truncated"] = True
    return response


@router.get("/api/v1/runs/{run_id}/trace/events")
async def run_trace_events(
    run_id: str,
    request: Request,
    principal: Principal,
    last_event_id: Annotated[int | None, Header()] = None,
):
    if await request.app.state.store.get_run(run_id, principal) is None:
        raise HTTPException(404, "Run not found")
    event_store = _event_store(request)
    if event_store is None:
        raise HTTPException(503, "Run trace storage is unavailable")

    async def events():
        sequence = last_event_id if last_event_id is not None else 0
        while not await request.is_disconnected():
            current = await request.app.state.store.get_run(run_id, principal)
            if current is None:
                return
            found = await event_store.list(run_id, principal, after=sequence)
            for item in found:
                yield _sse("trace", item, item["sequence"])
                sequence = item["sequence"]
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
