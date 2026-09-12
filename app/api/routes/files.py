"""Files API routes; application services own execution."""

import asyncio
from dataclasses import asdict

from fastapi import HTTPException, Request, UploadFile, Form

from app.identity.principals import Role
from app.inputs.files import parse_files

from app.api.dependencies import Principal, require_roles
from fastapi import APIRouter

router = APIRouter()


@router.post("/api/v1/files", status_code=201)
async def upload_files(
    request: Request,
    principal: Principal,
    files: list[UploadFile],
    chat_id: str | None = Form(default=None, pattern=r"^chat_[0-9a-f]{32}$"),
):
    require_roles(
        principal,
        {
            Role.PLATFORM_ADMIN,
            Role.PROJECT_OWNER,
            Role.PROJECT_MANAGER,
            Role.PROJECT_ANALYST,
        },
    )
    if chat_id:
        try:
            await request.app.state.store.require_chat(chat_id, principal)
        except PermissionError:
            raise HTTPException(404, "Chat not found") from None
    limits = request.app.state.file_limits
    if not files or len(files) > limits.max_files:
        raise HTTPException(422, "File count exceeds configured limit")
    payloads, total = [], 0
    try:
        for upload in files:
            data = await upload.read(limits.max_file_bytes + 1)
            total += len(data)
            if (
                len(data) > limits.max_file_bytes
                or total > request.app.state.settings.max_upload_batch_bytes
            ):
                raise HTTPException(413, "Files exceed configured size limit")
            payloads.append((upload.filename or "", data))
        parsed = await parse_files(payloads, limits)
        if any(not file.text.strip() for file in parsed):
            raise HTTPException(
                422,
                "A file contains no extractable text; check format, OCR availability, or scanned PDF support",
            )
        if chat_id is None:
            chat_id = (await request.app.state.store.create_chat(principal))["chat_id"]
        result = []
        for file, (_, raw) in zip(parsed, payloads, strict=True):
            aid = await request.app.state.store.save_attachment(
                asdict(file) | {"chat_id": chat_id},
                principal,
                request.app.state.settings.attachment_ttl_seconds,
            )
            artifact = await request.app.state.chat_artifacts.save(
                chat_id, aid, file, raw, principal
            )
            result.append(
                {
                    "attachment_id": aid,
                    "artifact_id": artifact["artifact_id"],
                    "sha256": artifact["sha256"],
                    "size_bytes": artifact["size_bytes"],
                    "expires_at": artifact["expires_at"],
                    "filename": file.filename,
                    "media_type": file.media_type,
                    "characters": len(file.text),
                    "warnings": file.warnings,
                }
            )
        return {"chat_id": chat_id, "attachments": result}
    except ValueError:
        raise HTTPException(422, "File validation or extraction failed") from None
    finally:
        await asyncio.gather(*(file.close() for file in files))
