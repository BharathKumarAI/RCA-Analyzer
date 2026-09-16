"""Owned chat artifact catalog; original bytes live in project blob storage."""

import hashlib
import json
from dataclasses import asdict
import re
import time
from pathlib import Path

from sqlalchemy import (
    Column,
    Float,
    Integer,
    String,
    Table,
    delete,
    insert,
    select,
    update,
)

from app.connectors.providers.blob import ConfigurationBlobStore
from app.persistence.store import metadata
from app.policy.redaction import redact
from app.runtime.run_contract import TERMINAL_STATUSES

artifacts = Table(
    "chat_artifacts",
    metadata,
    Column("artifact_id", String(128), primary_key=True),
    Column("chat_id", String(128), nullable=False, index=True),
    Column("attachment_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False),
    Column("filename", String, nullable=False),
    Column("media_type", String(256), nullable=False),
    Column("sha256", String(64), nullable=False),
    Column("processed_hash", String(128), nullable=False),
    Column("processed_expires_at", Float, nullable=False),
    Column("size_bytes", Integer, nullable=False),
    Column("status", String(16), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("expires_at", Float, nullable=False),
)


class ChatArtifactStore:
    def __init__(self, store, settings, max_bytes):
        self.store = store
        self.settings = settings
        self.max_bytes = max_bytes
        store.attachment_blob_uri = settings.artifact_uri("chats")
        store.attachment_scope = (settings.tenant_id, settings.project_id)

    def _blobs(self, chat_id, artifact_id, stage="raw"):
        if stage not in {"raw", "processed"}:
            raise ValueError("Invalid upload stage")
        if not re.fullmatch(r"chat_[0-9a-f]{32}", chat_id) or not re.fullmatch(
            r"artifact_[0-9a-f]{32}", artifact_id
        ):
            raise ValueError("Invalid artifact namespace")
        uri = f"{self.settings.artifact_uri('chats').rstrip('/')}/{chat_id}/uploads/{stage}/{artifact_id}"
        if not uri.startswith("gs://") and Path(uri).resolve() != Path(uri).absolute():
            raise ValueError("Artifact paths cannot follow symlinks")
        return ConfigurationBlobStore(
            uri,
            max(self.max_bytes, 8 * 1024 * 1024)
            if stage == "processed"
            else self.max_bytes,
            binary=True,
            suffix=".json" if stage == "processed" else None,
        )

    def _scope(self):
        return (
            artifacts.c.tenant_id == self.settings.tenant_id,
            artifacts.c.project_id == self.settings.project_id,
        )

    @staticmethod
    def _public(row):
        return {
            k: row[k]
            for k in (
                "artifact_id",
                "chat_id",
                "attachment_id",
                "filename",
                "media_type",
                "sha256",
                "size_bytes",
                "created_at",
                "expires_at",
            )
        }

    async def save(self, chat_id, attachment_id, parsed, data, principal):
        await self.store.require_chat(chat_id, principal)
        if (principal.tenant_id, principal.project_id) != (
            self.settings.tenant_id,
            self.settings.project_id,
        ):
            raise PermissionError("Artifact outside deployment scope")
        if not data or len(data) > self.max_bytes:
            raise ValueError("Artifact exceeds configured size")
        if not re.fullmatch(r"att_[0-9a-f]{32}", attachment_id):
            raise ValueError("Invalid attachment ID")
        processed = json.dumps(
            asdict(parsed), ensure_ascii=False, sort_keys=True
        ).encode()
        now = time.time()
        record = dict(
            artifact_id="artifact_" + attachment_id.removeprefix("att_"),
            chat_id=chat_id,
            attachment_id=attachment_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            subject=principal.subject,
            filename=parsed.filename,
            media_type=parsed.media_type,
            sha256=hashlib.sha256(data).hexdigest(),
            processed_hash="sha256:" + hashlib.sha256(processed).hexdigest(),
            processed_expires_at=now + self.settings.attachment_ttl_seconds,
            size_bytes=len(data),
            status="PENDING",
            created_at=now,
            expires_at=now + self.settings.retention_days * 86400,
        )
        # Catalog first: interrupted writes remain discoverable by manual cleanup.
        async with self.store.engine.begin() as c:
            await c.execute(insert(artifacts).values(**record))
        await self._blobs(chat_id, record["artifact_id"]).put(data)
        await self._blobs(chat_id, record["artifact_id"], "processed").put(processed)
        async with self.store.engine.begin() as c:
            await c.execute(
                update(artifacts)
                .where(artifacts.c.artifact_id == record["artifact_id"])
                .values(status="READY")
            )
        return self._public(record)

    async def list(self, chat_id, principal, limit=50, before=None):
        await self.store.require_chat(chat_id, principal)
        q = select(artifacts).where(
            *self._scope(),
            artifacts.c.subject == principal.subject,
            artifacts.c.chat_id == chat_id,
            artifacts.c.status == "READY",
            artifacts.c.expires_at > time.time(),
        )
        if before is not None:
            q = q.where(artifacts.c.created_at < before)
        async with self.store.engine.connect() as c:
            rows = (
                (
                    await c.execute(
                        q.order_by(artifacts.c.created_at.desc()).limit(limit)
                    )
                )
                .mappings()
                .all()
            )
        return [self._public(row) for row in rows]

    async def _owned_record(self, chat_id, artifact_id, principal):
        await self.store.require_chat(chat_id, principal)
        async with self.store.engine.connect() as c:
            row = (
                (
                    await c.execute(
                        select(artifacts).where(
                            *self._scope(),
                            artifacts.c.subject == principal.subject,
                            artifacts.c.chat_id == chat_id,
                            artifacts.c.artifact_id == artifact_id,
                            artifacts.c.status == "READY",
                            artifacts.c.expires_at > time.time(),
                        )
                    )
                )
                .mappings()
                .first()
            )
        if row is None:
            raise PermissionError("Artifact not found")
        return row

    async def download(self, chat_id, artifact_id, principal):
        row = await self._owned_record(chat_id, artifact_id, principal)
        data = await self._blobs(chat_id, artifact_id).get("sha256:" + row["sha256"])
        return self._public(row), data

    async def preview(self, chat_id, artifact_id, principal):
        row = await self._owned_record(chat_id, artifact_id, principal)
        if row["processed_expires_at"] <= time.time():
            raise TimeoutError("Processed attachment expired")
        data = await self._blobs(chat_id, artifact_id, "processed").get(row["processed_hash"])
        parsed = json.loads(data)
        if not isinstance(parsed, dict) or not isinstance(parsed.get("text"), str):
            raise ValueError("Invalid processed artifact")
        warnings = parsed.get("warnings", [])
        if not isinstance(warnings, list) or any(not isinstance(item, str) for item in warnings):
            raise ValueError("Invalid processed artifact warnings")
        limit = min(20000, self.settings.max_evidence_chars)
        text = redact(parsed["text"], max_text=limit + 1)
        return {"filename": row["filename"], "media_type": row["media_type"],
                "text": text[:limit], "truncated": len(text) > limit,
                "warnings": redact(warnings, max_text=1000)}

    def _output_blobs(self, chat_id, run_id, status):
        if not re.fullmatch(r"chat_[0-9a-f]{32}", chat_id) or not re.fullmatch(
            r"run_[0-9a-f]{32}", run_id
        ):
            raise ValueError("Invalid created artifact namespace")
        stage = (
            "simulated"
            if status == "SIMULATED"
            else "completed"
            if status in {"SUCCEEDED", "PARTIAL"}
            else "failed"
        )
        uri = f"{self.settings.artifact_uri('chats').rstrip('/')}/{chat_id}/created/{stage}/{run_id}"
        if not uri.startswith("gs://") and Path(uri).resolve() != Path(uri).absolute():
            raise ValueError("Created artifact paths cannot follow symlinks")
        return ConfigurationBlobStore(
            uri, 32 * 1024 * 1024, binary=True, suffix=".json"
        )

    async def save_output(self, response, principal):
        if not response.chat_id or response.status not in TERMINAL_STATUSES:
            return None
        await self.store.require_chat(response.chat_id, principal)
        if response.updated_at + self.settings.retention_days * 86400 <= time.time():
            raise PermissionError("Created artifact expired")
        evidence = await self.store.list_by_run(response.run_id, principal)
        data = json.dumps(
            {
                "run": response.model_dump(mode="json"),
                "evidence": [
                    item.model_dump(mode="json")
                    for item in sorted(evidence, key=lambda item: item.evidence_id)
                ],
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
        digest = await self._output_blobs(
            response.chat_id, response.run_id, response.status
        ).put(data)
        return {
            "run_id": response.run_id,
            "chat_id": response.chat_id,
            "status": response.status,
            "sha256": digest,
            "size_bytes": len(data),
        }, data

    async def download_output(self, chat_id, run_id, principal):
        await self.store.require_chat(chat_id, principal)
        response = await self.store.get_run(run_id, principal)
        if response is None or response.chat_id != chat_id:
            raise PermissionError("Created artifact not found")
        output = await self.save_output(response, principal)
        if output is None:
            raise PermissionError("Created artifact not ready")
        return output

    async def cleanup(self, apply=False):
        async with self.store.engine.connect() as c:
            rows = (
                (
                    await c.execute(
                        select(artifacts).where(
                            *self._scope(),
                            (artifacts.c.expires_at <= time.time())
                            | (artifacts.c.processed_expires_at <= time.time()),
                        )
                    )
                )
                .mappings()
                .all()
            )
        expired_count = sum(row["expires_at"] <= time.time() for row in rows)
        if apply:
            for row in rows:
                if (
                    row["processed_expires_at"] <= time.time()
                    or row["expires_at"] <= time.time()
                ):
                    await self._blobs(
                        row["chat_id"], row["artifact_id"], "processed"
                    ).delete(row["processed_hash"])
                if row["expires_at"] <= time.time():
                    # Delete unique objects before their catalog row; failed removals can be retried.
                    await self._blobs(row["chat_id"], row["artifact_id"]).delete(
                        "sha256:" + row["sha256"]
                    )
                    async with self.store.engine.begin() as c:
                        await c.execute(
                            delete(artifacts).where(
                                artifacts.c.artifact_id == row["artifact_id"],
                                *self._scope(),
                            )
                        )
        return expired_count

    async def cleanup_output(self, response, principal):
        if not response.chat_id:
            return
        evidence = await self.store.list_by_run(response.run_id, principal)
        data = json.dumps(
            {
                "run": response.model_dump(mode="json"),
                "evidence": [
                    item.model_dump(mode="json")
                    for item in sorted(evidence, key=lambda item: item.evidence_id)
                ],
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
        await self._output_blobs(
            response.chat_id, response.run_id, response.status
        ).delete("sha256:" + hashlib.sha256(data).hexdigest())
