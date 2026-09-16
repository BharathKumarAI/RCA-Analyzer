"""Local project knowledge uses bounded parsing and independent revision review."""

import json
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError

from app.api.dependencies import Principal, require_roles
from app.configuration.knowledge import ADMIN_ROLES, KnowledgeConflict, KnowledgeInput, KnowledgeReview
from app.inputs.files import parse_files

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])


async def knowledge_result(operation):
    try:
        return await operation
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except LookupError:
        raise HTTPException(404, "Knowledge document not found") from None
    except KnowledgeConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except (ValueError, ValidationError):
        raise HTTPException(422, "Knowledge content or file is invalid; check the configured size and format limits") from None


@router.post("/upload", status_code=201)
async def upload_knowledge(
    request: Request,
    principal: Principal,
    file: UploadFile,
    title: Annotated[str, Form(min_length=1, max_length=256)],
    category: Annotated[str, Form(max_length=128)] = "Runbooks",
    tags: Annotated[str, Form(max_length=4096)] = "[]",
    doc_id: Annotated[str | None, Form(max_length=128)] = None,
    expected_hash: Annotated[str | None, Form(max_length=128)] = None,
):
    require_roles(principal, ADMIN_ROLES)
    if doc_id and not expected_hash:
        raise HTTPException(422, "Reload the document before replacing its file")
    try:
        limits = request.app.state.file_limits
        raw = await file.read(limits.max_file_bytes + 1)
        if len(raw) > limits.max_file_bytes:
            raise HTTPException(413, "File exceeds the configured size limit")
        parsed = (await parse_files([(file.filename or "", raw)], limits))[0]
        payload = KnowledgeInput(title=title, category=category or "Runbooks", tags=json.loads(tags),
                                 content=parsed.text, media_type="text/plain")
        original_hash = await request.app.state.knowledge.blobs.put(raw)
        return await knowledge_result(request.app.state.knowledge.save(
            principal, payload, doc_id=doc_id, expected_hash=expected_hash, max_text_chars=limits.max_text_chars,
            upload={"filename": parsed.filename, "sha256": parsed.sha256, "size_bytes": len(raw),
                    "warnings": list(parsed.warnings), "original_retained": True,
                    "original_blob_hash": original_hash,
                    "processing_status": "extracted_with_warnings" if parsed.warnings else "extracted"},
        ))
    except (ValueError, ValidationError):
        raise HTTPException(422, "File validation or extraction failed; check the supported format and text limits") from None
    finally:
        await file.close()


@router.post("/{doc_id}/{action}")
async def review_knowledge(
    doc_id: str, action: Literal["submit", "approve", "reject", "revoke"],
    payload: KnowledgeReview, request: Request, principal: Principal,
):
    return await knowledge_result(request.app.state.knowledge.review(principal, doc_id, action, payload))


@router.get("/{doc_id}/download")
async def download_knowledge(doc_id: str, request: Request, principal: Principal):
    raw, filename = await knowledge_result(request.app.state.knowledge.original(principal, doc_id))
    return Response(raw, media_type="application/octet-stream", headers={
        "Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename, safe=""),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    })


@router.get("/{doc_id}/history")
async def knowledge_history(doc_id: str, request: Request, principal: Principal):
    return await knowledge_result(request.app.state.knowledge.history(principal, doc_id))
