"""Connection registration endpoints; authority and scope come from authentication."""

from typing import Literal
from app.configuration.mcp_import import MAX_IMPORT_BYTES, parse_mcp_json, parse_mcp_command
from fastapi import APIRouter, HTTPException, Path, Query, Request

from app.api.dependencies import Principal
from app.configuration.integrations import IntegrationConflict, IntegrationWrite
from app.configuration.integrations import IntegrationDefinition
from app.connectors.providers.integration_probe import probe_integration

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


@router.get("")
async def list_integrations(request: Request, principal: Principal):
    return await request.app.state.integrations.list(principal)


@router.post("/mcp/preview")
async def preview_mcp_import(request: Request, principal: Principal):
    try:
        request.app.state.integrations.authorize(principal, "project")
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_IMPORT_BYTES:
            raise HTTPException(413, "MCP JSON must be smaller than 64 KiB")
    try:
        parser = parse_mcp_command if request.headers.get("content-type", "").split(";", 1)[0] == "text/plain" else parse_mcp_json
        connections = parser(content.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        # Unicode errors can include pasted input; parser messages are already safe.
        detail = "Use UTF-8 JSON" if isinstance(error, UnicodeError) else str(error)
        raise HTTPException(422, detail) from None
    return {"connections": connections}


@router.post("/{integration_id}/test")
async def test_integration(
    request: Request, principal: Principal,
    integration_id: str = Path(pattern=r"^[a-z][a-z0-9_-]{0,63}$"),
):
    try:
        request.app.state.integrations.authorize(principal, "project")
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    rows = await request.app.state.integrations.list(principal)
    registration = next((row for row in rows if row["id"] == integration_id), None)
    if registration is None:
        raise HTTPException(404, "Integration not found")
    if request.app.state.integration_probe_limiter.locked():
        raise HTTPException(429, "Connection-test capacity is busy; try again shortly")
    async with request.app.state.integration_probe_limiter:
        result = await probe_integration(
            IntegrationDefinition.model_validate(registration["definition"]), request.app.state.settings,
        )
    current = await request.app.state.integrations.list(principal)
    if not any(row["id"] == integration_id and row["revision"] == registration["revision"] for row in current):
        raise HTTPException(409, "Configuration changed during the test; reload and test again")
    return {**result, "revision": registration["revision"]}


@router.put("/{scope}/{integration_id}")
async def save_integration(
    scope: Literal["platform", "project"], body: IntegrationWrite,
    request: Request, principal: Principal,
    integration_id: str = Path(pattern=r"^[a-z][a-z0-9_-]{0,63}$"),
):
    if integration_id in {"itsm", "log_search"} | {t.system_name for t in request.app.state.platform.connector_templates}:
        raise HTTPException(409, "Use a unique ID; this ID belongs to a deployment template")
    try:
        await request.app.state.integrations.save(principal, scope, integration_id, body)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except IntegrationConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return await request.app.state.integrations.list(principal)


@router.delete("/project/{integration_id}", status_code=204)
async def reset_project_integration(
    request: Request, principal: Principal,
    integration_id: str = Path(pattern=r"^[a-z][a-z0-9_-]{0,63}$"),
    expected_revision: str = Query(min_length=1, max_length=32),
):
    try:
        await request.app.state.integrations.reset(principal, integration_id, expected_revision)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except IntegrationConflict as exc:
        raise HTTPException(409, str(exc)) from None
