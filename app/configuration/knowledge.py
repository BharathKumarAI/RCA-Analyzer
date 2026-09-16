"""Reviewed project knowledge reuses the existing catalog, audit and blob store."""

import json
import re
import time
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, case, insert, or_, select, update

from app.configuration.parameters import audit
from app.connectors.providers.blob import ConfigurationBlobStore
from app.identity.principals import Role
from app.persistence.platform_admin import platform_knowledge as documents
from app.policy.redaction import redact
from app.runtime.run_contract import content_hash

ADMIN_ROLES = {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}
Hash = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]


class KnowledgeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    title: str = Field(min_length=1, max_length=256)
    category: str = Field(default="Runbooks", min_length=1, max_length=128)
    tags: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=32)
    content: str = Field(min_length=1, max_length=1000000)
    media_type: Literal["text/plain", "text/markdown"] = "text/markdown"
    status: Literal["draft"] = "draft"

    @field_validator("title", "category", "content")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Content cannot be blank")
        return value.strip()


class KnowledgeUpdate(KnowledgeInput):
    expected_hash: Hash


class KnowledgeReview(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    expected_hash: Hash
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("A review reason is required")
        return value.strip()


class KnowledgeConflict(ValueError):
    pass


def _snapshot(row):
    return {key: row[key] for key in (
        "doc_id", "tenant_id", "project_id", "revision", "title", "category", "tags",
        "content", "media_type", "upload", "author_subject",
    )}


class KnowledgeService:
    def __init__(self, engine, settings):
        self.engine = engine
        self.settings = settings
        # Provider bound matches the parser's hard safety ceiling; each upload
        # still obeys the lower active file-processing configuration.
        self.blobs = ConfigurationBlobStore(settings.artifact_uri("knowledge"), 64 * 1024 * 1024, binary=True)

    @staticmethod
    def scope(principal):
        return and_(documents.c.tenant_id == principal.tenant_id,
                    documents.c.project_id == principal.project_id)

    @staticmethod
    def require_admin(principal):
        if not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("Project owner or platform administrator access is required")

    @staticmethod
    def view(row, principal):
        result = dict(row)
        result["id"] = row["doc_id"]
        # Legacy records must be saved to establish author and immutable revision.
        if not result.get("content_hash"):
            result["status"] = "draft"
            result["content_hash"] = content_hash(_snapshot(result))
        admin = bool(set(principal.roles) & ADMIN_ROLES)
        result["can_edit"] = admin
        result["can_review"] = admin and bool(row["author_subject"]) and row["author_subject"] != principal.subject
        result["needs_revision"] = not bool(row["content_hash"])
        return result

    async def row(self, principal, doc_id):
        async with self.engine.connect() as connection:
            row = (await connection.execute(select(documents).where(
                self.scope(principal), documents.c.doc_id == doc_id))).mappings().first()
        if row is None:
            raise LookupError("Knowledge document not found")
        return dict(row)

    async def list(self, principal):
        statement = select(documents).where(self.scope(principal))
        if not set(principal.roles) & ADMIN_ROLES:
            statement = statement.where(documents.c.status == "approved", documents.c.content_hash.is_not(None))
        async with self.engine.connect() as connection:
            rows = (await connection.execute(statement.order_by(
                documents.c.updated_at.desc(), documents.c.doc_id).limit(500))).mappings().all()
        return [self.view(row, principal) for row in rows]

    async def _audit(self, connection, principal, row, action, reason=None):
        await connection.execute(insert(audit).values(
            tenant_id=principal.tenant_id, project_id=principal.project_id,
            tool="knowledge", variable_name=row["doc_id"], actor_subject=principal.subject,
            action=action, revision=row["revision"], created_at=time.time(),
            details={"content_hash": row["content_hash"], "reason": reason,
                     "author_subject": row["author_subject"], "title": row["title"]},
        ))

    async def save(self, principal, payload, *, max_text_chars, doc_id=None, expected_hash=None, upload=None):
        self.require_admin(principal)
        if len(payload.content) > max_text_chars:
            raise ValueError("Knowledge content exceeds the configured extracted-text limit")
        previous = await self.row(principal, doc_id) if doc_id else None
        if previous and self.view(previous, principal)["content_hash"] != expected_hash:
            raise KnowledgeConflict("Document changed. Reload before saving.")
        now = time.time()
        row = {
            "doc_id": doc_id or "kb_" + uuid.uuid4().hex,
            "tenant_id": principal.tenant_id, "project_id": principal.project_id,
            "revision": (previous["revision"] if previous else 0) + 1,
            "title": redact(payload.title), "category": redact(payload.category),
            "tags": list(dict.fromkeys(redact(payload.tags))), "content": redact(payload.content, max_text=max_text_chars),
            "media_type": payload.media_type,
            "upload": upload if upload is not None else previous["upload"] if previous else None,
            "author_subject": principal.subject, "reviewer_subject": None,
            "reviewed_at": None, "review_reason": None, "status": "draft",
            "created_at": previous["created_at"] if previous else now, "updated_at": now,
        }
        row["size_bytes"] = len(row["content"].encode("utf-8"))
        serialized = json.dumps(_snapshot(row), sort_keys=True, ensure_ascii=False).encode()
        row["content_hash"] = await self.blobs.put(serialized)
        async with self.engine.begin() as connection:
            if previous:
                changed = await connection.execute(update(documents).where(
                    self.scope(principal), documents.c.doc_id == doc_id,
                    documents.c.revision == previous["revision"], documents.c.status == previous["status"],
                    documents.c.updated_at == previous["updated_at"],
                ).values(**row))
                if changed.rowcount != 1:
                    raise KnowledgeConflict("Document changed. Reload before saving.")
            else:
                await connection.execute(insert(documents).values(**row))
            await self._audit(connection, principal, row, "draft")
        return self.view(row, principal)

    async def verify(self, row):
        if not row["content_hash"]:
            raise KnowledgeConflict("Save this document as a new draft before submitting it.")
        stored = json.loads(await self.blobs.get(row["content_hash"]))
        if stored != _snapshot(row):
            raise KnowledgeConflict("Document integrity check failed. Save a reviewed replacement.")

    async def review(self, principal, doc_id, action, payload):
        self.require_admin(principal)
        row = await self.row(principal, doc_id)
        if row["content_hash"] != payload.expected_hash:
            raise KnowledgeConflict("Document changed. Reload the exact revision before review.")
        await self.verify(row)
        expected = {"submit": {"draft", "rejected"}, "approve": {"pending"},
                    "reject": {"pending"}, "revoke": {"approved"}}
        if action not in expected or row["status"] not in expected[action]:
            raise KnowledgeConflict("This document is not in a state that permits that action.")
        if action in {"approve", "reject"} and row["author_subject"] == principal.subject:
            raise PermissionError("A different project owner or platform administrator must review this revision.")
        status = {"submit": "pending", "approve": "approved", "reject": "rejected", "revoke": "revoked"}[action]
        values = {"status": status, "updated_at": time.time(), "review_reason": payload.reason,
                  "reviewer_subject": principal.subject if action != "submit" else None,
                  "reviewed_at": time.time() if action != "submit" else None}
        async with self.engine.begin() as connection:
            changed = await connection.execute(update(documents).where(
                self.scope(principal), documents.c.doc_id == doc_id,
                documents.c.content_hash == payload.expected_hash, documents.c.status == row["status"],
                documents.c.updated_at == row["updated_at"],
            ).values(**values))
            if changed.rowcount != 1:
                raise KnowledgeConflict("Document changed. Reload before review.")
            await self._audit(connection, principal, row, action, payload.reason)
        return self.view(row | values, principal)

    async def original(self, principal, doc_id):
        row = await self.row(principal, doc_id)
        if row["status"] != "approved" and not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("This document has not been approved for project use")
        upload = row.get("upload") or {}
        if not upload.get("original_blob_hash"):
            raise LookupError("An original file is not retained for this document")
        return await self.blobs.get(upload["original_blob_hash"]), upload["filename"]

    async def history(self, principal, doc_id):
        row = await self.row(principal, doc_id)
        if row["status"] != "approved" and not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("This document has not been approved for project use")
        async with self.engine.connect() as connection:
            rows = (await connection.execute(select(audit).where(
                audit.c.tenant_id == principal.tenant_id, audit.c.project_id == principal.project_id,
                audit.c.tool == "knowledge", audit.c.variable_name == doc_id,
            ).order_by(audit.c.event_id.desc()).limit(100))).mappings().all()
        return [dict(item) for item in rows]

    async def relevant(self, principal, query, *, max_items, max_chars):
        """Bounded literal keyword relevance; only independently approved snapshots qualify."""
        terms = list(dict.fromkeys(re.findall(r"[^\W_]{3,64}", query.casefold())))[:12]
        terms = [term for term in terms if term not in {
            "the", "and", "for", "that", "this", "with", "what", "how", "why", "please", "from", "are", "was", "can", "our",
        }]
        if not terms or max_items < 1 or max_chars < 128:
            return []
        matches = [documents.c.content.ilike("%" + term + "%") | documents.c.title.ilike("%" + term + "%") for term in terms]
        score = sum(case((documents.c.title.ilike("%" + term + "%"), 3), else_=0)
                    + case((documents.c.content.ilike("%" + term + "%"), 1), else_=0) for term in terms)
        statement = select(documents).where(
            self.scope(principal), documents.c.status == "approved", documents.c.content_hash.is_not(None),
            documents.c.reviewer_subject.is_not(None), documents.c.author_subject != documents.c.reviewer_subject,
            or_(*matches),
        ).order_by(score.desc(), documents.c.updated_at.desc(), documents.c.doc_id).limit(min(max_items, 3))
        async with self.engine.connect() as connection:
            rows = (await connection.execute(statement)).mappings().all()
        selected = []
        for row in rows:
            await self.verify(row)
            text = row["content"]
            remaining = max_chars - sum(len(item["excerpt"]) for item in selected)
            if remaining < 128:
                break
            size = min(remaining, max_chars // max(1, len(rows)))
            position = min((text.casefold().find(term) for term in terms if term in text.casefold()), default=0)
            start = max(0, position - size // 4)
            selected.append({
                "doc_id": row["doc_id"], "title": row["title"], "revision": row["revision"],
                "content_hash": row["content_hash"], "reviewer_subject": row["reviewer_subject"],
                "reviewed_at": row["reviewed_at"], "excerpt": text[start:start + size],
                "excerpt_start": start, "truncated": start > 0 or len(text) > size,
                "source_kind": "approved_project_reference",
            })
        return selected
