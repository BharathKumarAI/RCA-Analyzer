"""Authenticated Harness Studio source, validation, and review API."""
import asyncio
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import Principal
from app.configuration.harness_bundles import BundleInput, Workspace, MAX_BUNDLE_BYTES, import_archive, export_archive
from app.configuration.harness_workspace import HarnessConflict

router = APIRouter(prefix="/api/v1/harness", tags=["harness-workspace"])


class DraftWrite(BundleInput):
    expected_revision: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    draft_id: str | None = None


class ReviewWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    reason: str = Field(min_length=1, max_length=2000)


async def guarded(operation):
    try:
        return await operation
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except LookupError:
        raise HTTPException(404, "Workspace or draft not found") from None
    except HarnessConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/workspace", response_model=Workspace)
async def workspace(request: Request, principal: Principal, capability: str = "incident_triage", draft_id: str | None = None):
    return await guarded(request.app.state.harness_workspace.workspace(principal, capability, draft_id))


@router.post("/validate", response_model=Workspace)
async def validate(body: BundleInput, request: Request, principal: Principal):
    return await guarded(request.app.state.harness_workspace.workspace(principal, body.capability, bundle=body))


@router.put("/draft", response_model=Workspace)
async def save_draft(body: DraftWrite, request: Request, principal: Principal):
    return await guarded(request.app.state.harness_workspace.save(principal,
        BundleInput(files=body.files, capability=body.capability), body.expected_revision, body.draft_id))


@router.get("/drafts")
async def drafts(request: Request, principal: Principal, capability: str = "incident_triage"):
    return await guarded(request.app.state.harness_workspace.list_drafts(principal, capability))


@router.post("/drafts/{draft_id}/{action}", response_model=Workspace)
async def review(draft_id: str, action: Literal["submit", "approve", "reject", "revoke"], body: ReviewWrite,
                 request: Request, principal: Principal):
    return await guarded(request.app.state.harness_workspace.transition(principal, draft_id, action, body.expected_revision, body.reason))


@router.post("/import", response_model=Workspace)
async def import_bundle(request: Request, principal: Principal, file: UploadFile = File(...), capability: str = Form(...)):
    async def operation():
        service = request.app.state.harness_workspace
        current = await service.workspace(principal, capability)
        data = await file.read(MAX_BUNDLE_BYTES + 1)
        files = await asyncio.to_thread(import_archive, data, file.filename or "root_agent.yaml")
        return await service.save(principal, BundleInput(files=files, capability=capability), current.revision)
    try:
        return await guarded(operation())
    finally:
        await file.close()


@router.get("/export")
async def export_bundle(request: Request, principal: Principal, capability: str = "incident_triage", draft_id: str | None = None):
    current = await guarded(request.app.state.harness_workspace.workspace(principal, capability, draft_id))
    data = await asyncio.to_thread(export_archive, current.files, current.diagnostics)
    return Response(data, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="adk-harness.zip"'})
