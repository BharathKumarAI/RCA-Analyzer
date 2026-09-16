"""Local project knowledge uses bounded parsing and independent revision review."""

import asyncio
import json
import logging
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.api.dependencies import Principal, require_roles
from app.configuration.knowledge import ADMIN_ROLES, Hash, KnowledgeAssociations, KnowledgeConflict, KnowledgeInput, KnowledgeReview
from app.inputs.files import parse_files

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])


class UploadMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    title: str = Field(min_length=1, max_length=256)
    category: str = Field(default="Runbooks", min_length=1, max_length=128)
    tags: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=32)
    associations: KnowledgeAssociations | None = None
    doc_id: str | None = Field(default=None, min_length=1, max_length=128)
    expected_hash: Hash | None = None

    @model_validator(mode="after")
    def replacement_hash(self):
        if bool(self.doc_id) != bool(self.expected_hash):
            raise ValueError("Replacing a file requires its document ID and current content hash")
        return self


class UploadError(BaseModel):
    code: Literal["invalid_file", "conflict", "not_found", "forbidden", "deadline", "unavailable"]
    message: str


class UploadOutcome(BaseModel):
    index: int
    filename: str
    status: Literal["created", "duplicate", "failed"]
    document: dict[str, Any] | None = None
    matched_revision: int | None = None
    matched_content_hash: str | None = None
    duplicate_historical: bool | None = None
    error: UploadError | None = None


class BatchUploadResponse(BaseModel):
    outcomes: list[UploadOutcome]


async def persist_file(request, principal, metadata, parsed, raw):
    limits = request.app.state.file_limits
    payload = KnowledgeInput(**metadata.model_dump(exclude={"doc_id", "expected_hash"}),
                             content=parsed.text, media_type="text/plain", structure=None)
    original_hash = await request.app.state.knowledge.blobs.put(raw)
    return await request.app.state.knowledge.save_upload(
        principal, payload, doc_id=metadata.doc_id, expected_hash=metadata.expected_hash,
        max_text_chars=limits.max_text_chars,
        upload={"filename": parsed.filename, "sha256": parsed.sha256, "size_bytes": len(raw),
                "media_type": parsed.media_type, "warnings": list(parsed.warnings), "original_retained": True,
                "original_blob_hash": original_hash,
                "processing_status": "extracted_with_warnings" if parsed.warnings else "extracted"},
    )


@router.get("/scopes")
async def knowledge_scopes(request: Request, principal: Principal):
    return await request.app.state.knowledge.scope_catalog(principal)


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
    associations: Annotated[str | None, Form(max_length=16000)] = None,
    doc_id: Annotated[str | None, Form(max_length=128)] = None,
    expected_hash: Annotated[str | None, Form(max_length=128)] = None,
):
    require_roles(principal, ADMIN_ROLES)
    try:
        metadata = UploadMetadata(title=title, category=category or "Runbooks", tags=json.loads(tags),
                                  associations=json.loads(associations) if associations is not None else None,
                                  doc_id=doc_id, expected_hash=expected_hash)
        limits = request.app.state.file_limits
        raw = await file.read(limits.max_file_bytes + 1)
        if len(raw) > min(limits.max_file_bytes, request.app.state.settings.max_upload_batch_bytes):
            raise HTTPException(413, "File exceeds the configured size limit")
        parsed = (await parse_files([(file.filename or "", raw)], limits))[0]
        return await knowledge_result(persist_file(request, principal, metadata, parsed, raw))
    except (ValueError, ValidationError):
        raise HTTPException(422, "File validation or extraction failed; check the supported format and text limits") from None
    finally:
        await file.close()


@router.post("/upload/batch", response_model=BatchUploadResponse, response_model_exclude_none=True)
async def upload_knowledge_batch(
    request: Request, principal: Principal, files: list[UploadFile],
    metadata: Annotated[str, Form(min_length=2, max_length=65536)],
):
    require_roles(principal, ADMIN_ROLES)
    limits = request.app.state.file_limits
    try:
        if not files or len(files) > limits.max_files:
            raise HTTPException(422, "File count exceeds the configured limit")
        try:
            entries = json.loads(metadata)
            if not isinstance(entries, list) or len(entries) != len(files):
                raise ValueError("Metadata count does not match files")
        except ValueError:
            raise HTTPException(422, "Provide one metadata entry per file, in the same order") from None
        payloads, total = [], 0
        for file in files:
            raw = await file.read(limits.max_file_bytes + 1)
            total += len(raw)
            if len(raw) > limits.max_file_bytes or total > request.app.state.settings.max_upload_batch_bytes:
                raise HTTPException(413, "Files exceed the configured size limit")
            payloads.append((file.filename or "", raw))
        semaphore = asyncio.Semaphore(limits.concurrency)
        outcomes = [None] * len(files)

        async def one(index, filename, raw):
            error = None
            try:
                async with semaphore:
                    entry = UploadMetadata.model_validate(entries[index])
                    parsed = (await parse_files([(filename, raw)], limits))[0]
                    document = await persist_file(request, principal, entry, parsed, raw)
                match = document.get("upload_match")
                outcomes[index] = UploadOutcome(index=index, filename=filename, status="duplicate" if match else "created",
                    document=document, matched_revision=match["revision"] if match else None,
                    matched_content_hash=match["content_hash"] if match else None,
                    duplicate_historical=match["revision"] != match["current_revision"] if match else None)
                return
            except KnowledgeConflict:
                error = UploadError(code="conflict", message="The document changed or its saved identity could not be verified. Reload before retrying.")
            except PermissionError:
                error = UploadError(code="forbidden", message="This document cannot be changed with your current access.")
            except LookupError:
                error = UploadError(code="not_found", message="The document is unavailable in this project.")
            except (ValueError, ValidationError):
                error = UploadError(code="invalid_file", message="Check the metadata, supported format and extraction limits; usable text is required.")
            except Exception as exc:
                logging.getLogger(__name__).warning("Knowledge upload failed: %s", type(exc).__name__)
                error = UploadError(code="unavailable", message="The upload could not be saved. Retry this file.")
            outcomes[index] = UploadOutcome(index=index, filename=filename[:256], status="failed", error=error)

        try:
            async with asyncio.timeout(min(request.app.state.settings.run_timeout_seconds, 120)):
                await asyncio.gather(*(one(index, name, raw) for index, (name, raw) in enumerate(payloads)))
        except TimeoutError:
            pass  # Completed commits remain visible; retries are deduplicated.
        return BatchUploadResponse(outcomes=[outcome or UploadOutcome(index=index,
            filename=payloads[index][0][:256], status="failed", error=UploadError(code="deadline",
                message="Processing deadline reached. Retry this file; completed uploads are deduplicated."))
            for index, outcome in enumerate(outcomes)])
    finally:
        await asyncio.gather(*(file.close() for file in files))


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
