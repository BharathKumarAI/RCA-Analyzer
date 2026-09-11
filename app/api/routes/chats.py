"""Owner-only chat history and original artifact downloads."""

from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.api.dependencies import Principal

router = APIRouter()


@router.post("/api/v1/chats", status_code=201)
async def create_chat(request: Request, principal: Principal):
    return await request.app.state.store.create_chat(principal)


@router.get("/api/v1/chats")
async def list_chats(
    request: Request,
    principal: Principal,
    limit: int = Query(50, ge=1, le=100),
    before: float | None = None,
):
    return await request.app.state.store.list_chats(principal, limit, before)


async def require_chat(request, chat_id, principal):
    try:
        return await request.app.state.store.require_chat(chat_id, principal)
    except PermissionError:
        raise HTTPException(404, "Chat not found") from None


@router.get("/api/v1/chats/{chat_id}")
async def get_chat(chat_id: str, request: Request, principal: Principal):
    return await require_chat(request, chat_id, principal)


@router.get("/api/v1/chats/{chat_id}/runs")
async def chat_runs(
    chat_id: str,
    request: Request,
    principal: Principal,
    limit: int = Query(50, ge=1, le=100),
    before: float | None = None,
):
    await require_chat(request, chat_id, principal)
    return await request.app.state.store.list_chat_runs(
        chat_id, principal, limit, before
    )


@router.get("/api/v1/chats/{chat_id}/artifacts")
async def chat_artifacts(
    chat_id: str,
    request: Request,
    principal: Principal,
    limit: int = Query(50, ge=1, le=100),
    before: float | None = None,
):
    await require_chat(request, chat_id, principal)
    return await request.app.state.chat_artifacts.list(
        chat_id, principal, limit, before
    )


@router.get("/api/v1/chats/{chat_id}/artifacts/{artifact_id}/download")
async def download_artifact(
    chat_id: str, artifact_id: str, request: Request, principal: Principal
):
    try:
        record, data = await request.app.state.chat_artifacts.download(
            chat_id, artifact_id, principal
        )
    except PermissionError:
        raise HTTPException(404, "Artifact not found") from None
    except (ValueError, OSError):
        raise HTTPException(
            503, "Artifact storage unavailable or integrity check failed"
        ) from None
    return Response(
        data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''"
            + quote(record["filename"], safe=""),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


@router.get("/api/v1/chats/{chat_id}/created/{run_id}/download")
async def download_created(
    chat_id: str, run_id: str, request: Request, principal: Principal
):
    try:
        _, data = await request.app.state.chat_artifacts.download_output(
            chat_id, run_id, principal
        )
    except PermissionError:
        raise HTTPException(404, "Created artifact not found or not ready") from None
    except (ValueError, OSError):
        raise HTTPException(503, "Created artifact storage unavailable") from None
    return Response(
        data,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{run_id}.json"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )
