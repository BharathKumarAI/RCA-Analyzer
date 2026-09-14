"""Local project knowledge uploads reuse the bounded attachment parser."""

from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile

from app.api.dependencies import Principal, require_roles
from app.identity.principals import Role
from app.inputs.files import parse_files

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])


@router.post("/upload", status_code=201)
async def upload_knowledge(
    request: Request,
    principal: Principal,
    file: UploadFile,
    title: Annotated[str, Form(min_length=1, max_length=256)],
    category: Annotated[str, Form(max_length=128)] = "Runbooks",
):
    require_roles(principal, {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER})
    if not title.strip():
        raise HTTPException(422, "A knowledge title is required")
    try:
        limits = request.app.state.file_limits
        raw = await file.read(limits.max_file_bytes + 1)
        if len(raw) > limits.max_file_bytes:
            raise HTTPException(413, "File exceeds the configured size limit")
        parsed = (await parse_files([(file.filename or "", raw)], limits))[0]
        if not parsed.text.strip():
            raise HTTPException(422, "File contains no extractable text")
        record = await request.app.state.platform_admin.upsert_knowledge(
            principal.tenant_id, principal.project_id, None,
            title.strip(), category.strip() or "Runbooks", ["local-upload"],
            parsed.text, "text/plain", "active",
            upload={
                "filename": parsed.filename,
                "sha256": parsed.sha256,
                "size_bytes": len(raw),
                "warnings": list(parsed.warnings),
                "original_retained": False,
                "processing_status": "extracted_with_warnings" if parsed.warnings else "extracted",
            },
        )
        # Existing knowledge storage owns extracted content only. Do not imply
        # original-byte storage or immutable versioning that it does not provide.
        return record
    except ValueError:
        raise HTTPException(422, "File validation or extraction failed") from None
    finally:
        await file.close()
