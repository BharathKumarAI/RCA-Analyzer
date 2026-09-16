"""Authenticated local OKF preview/import and revision-checked export."""

import json
from collections import Counter
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import Principal, require_roles
from app.api.routes.knowledge_uploads import knowledge_result
from app.configuration.knowledge import ADMIN_ROLES, Hash
from app.configuration.knowledge_okf import OKFService
from app.configuration.okf import OKFDiagnostic, OKFPreview, byte_hash
from app.runtime.run_contract import content_hash

router = APIRouter(prefix="/api/v1/knowledge/okf", tags=["knowledge"])
BundleId = Annotated[str, Field(pattern=r"^okf_[a-f0-9]{32}$")]


class OKFBundle(BaseModel):
    bundle_id: str
    name: str
    revision: int
    content_hash: str
    concept_count: int
    updated_at: float


class OKFImportedDocument(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    title: str
    revision: int
    content_hash: str
    status: Literal["draft"]
    okf_bundle_id: str
    okf_concept_path: str
    okf: dict[str, Any]


class OKFImportResponse(BaseModel):
    bundle_id: str
    documents: list[OKFImportedDocument]
    diagnostics: list[OKFDiagnostic]


class OKFExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    bundle_id: BundleId | None = None
    document_ids: list[Annotated[str, Field(min_length=1, max_length=128)]] | None = Field(default=None, min_length=1, max_length=256)
    expected_hashes: dict[str, Hash] = Field(max_length=256)
    include_drafts: bool = False
    format: Literal["zip", "markdown"] = "zip"


async def upload_bytes(request, principal, file):
    require_roles(principal, ADMIN_ROLES)
    try:
        policy = await request.app.state.knowledge.policy(principal)
        maximum = min(policy.max_expanded_bytes, request.app.state.file_limits.max_file_bytes)
        raw = await file.read(maximum + 1)
        if len(raw) > maximum:
            raise HTTPException(413, "OKF upload exceeds the configured byte limit")
        return file.filename or "concept.md", raw
    finally:
        await file.close()


@router.get("/bundles", response_model=list[OKFBundle])
async def list_okf_bundles(request: Request, principal: Principal):
    return await knowledge_result(OKFService(request.app.state.knowledge).list_bundles(principal))


@router.post("/preview", response_model=OKFPreview)
async def preview_okf(request: Request, principal: Principal, file: UploadFile,
                      bundle_id: Annotated[str | None, Form(pattern=r"^okf_[a-f0-9]{32}$")] = None):
    filename, raw = await upload_bytes(request, principal, file)
    return await knowledge_result(OKFService(request.app.state.knowledge).preview(principal, filename, raw, bundle_id))


@router.post("/import", response_model=OKFImportResponse, status_code=201)
async def import_okf(request: Request, principal: Principal, file: UploadFile,
                     preview_hash: Annotated[str, Form(pattern=r"^sha256:[a-f0-9]{64}$")],
                     bundle_id: Annotated[str | None, Form(pattern=r"^okf_[a-f0-9]{32}$")] = None,
                     expected_hashes: Annotated[str, Form(max_length=65536)] = "{}"):
    filename, raw = await upload_bytes(request, principal, file)
    try:
        expected = json.loads(expected_hashes)
        if not isinstance(expected, dict) or len(expected) > 256 or any(not isinstance(key, str) or not isinstance(value, str) for key, value in expected.items()):
            raise ValueError("Invalid hash mapping")
    except (ValueError, TypeError):
        raise HTTPException(422, "Expected hashes must be a JSON mapping of concept paths to current hashes") from None
    return await knowledge_result(OKFService(request.app.state.knowledge).import_bundle(
        principal, filename, raw, bundle_id=bundle_id, preview_hash=preview_hash, expected_hashes=expected,
        max_text_chars=request.app.state.file_limits.max_text_chars))


@router.post("/export")
async def export_okf(payload: OKFExportRequest, request: Request, principal: Principal):
    raw, filename, media_type, diagnostics, revisions = await knowledge_result(
        OKFService(request.app.state.knowledge).export_bundle(principal, **payload.model_dump()))
    return Response(raw, media_type=media_type, headers={
        "Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename, safe=""),
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "X-Content-SHA256": byte_hash(raw), "X-OKF-Source-Hash": content_hash(revisions),
        "X-OKF-Diagnostics": json.dumps(dict(Counter(item.code for item in diagnostics))),
    })
