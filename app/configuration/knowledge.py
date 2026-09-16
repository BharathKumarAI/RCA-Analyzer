"""Reviewed project knowledge reuses the existing catalog, audit and blob store."""

from __future__ import annotations

import json
import math
import re
import time
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import and_, case, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.configuration.parameters import ParameterConflict, ParameterOverride, ParameterStore, audit, definitions
from app.configuration.knowledge_structure import KnowledgeCaptureSource, KnowledgeStructure
from app.configuration.okf import OKFPolicy, concept_links, eligibility, metadata_data
from app.connectors.providers.blob import ConfigurationBlobStore
from app.identity.principals import Role
from app.persistence.platform_admin import knowledge_captures, knowledge_source_states, knowledge_uploads, platform_knowledge as documents
from app.policy.redaction import redact
from app.runtime.run_contract import content_hash

ADMIN_ROLES = {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}
Hash = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]


class KnowledgeAssociations(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    environment_ids: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(default_factory=list, max_length=50)
    capability_ids: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(default_factory=list, max_length=50)
    connector_instance_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=50)
    required: bool = False

    @model_validator(mode="after")
    def required_capability(self):
        if self.required and not self.capability_ids:
            raise ValueError("Required knowledge must identify its capabilities")
        for name in ("environment_ids", "capability_ids", "connector_instance_ids"):
            if len(getattr(self, name)) != len(set(getattr(self, name))):
                raise ValueError("Knowledge associations must be unique")
        return self


def matches_associations(row, capability=None, environment_ids=(), instance_ids=()):
    scope = row.get("associations") or {}
    return all(not scope.get(key) or bool(set(scope[key]) & set(selected)) for key, selected in (
        ("capability_ids", [capability] if capability else []),
        ("environment_ids", environment_ids), ("connector_instance_ids", instance_ids),
    ))


class KnowledgeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    title: str = Field(min_length=1, max_length=256)
    category: str = Field(default="Runbooks", min_length=1, max_length=128)
    tags: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=32)
    content: str = Field(default="", max_length=1000000)
    structure: KnowledgeStructure | None = None
    okf_metadata: dict[str, Any] | None = None
    associations: KnowledgeAssociations | None = None
    media_type: Literal["text/plain", "text/markdown"] = "text/markdown"
    status: Literal["draft"] = "draft"

    @field_validator("title", "category")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Content cannot be blank")
        return value.strip()

    @model_validator(mode="after")
    def valid_content(self):
        if self.structure is not None:
            self.content = self.structure.markdown()
            self.media_type = "text/markdown"
        if self.okf_metadata is not None:
            self.okf_metadata = metadata_data(self.okf_metadata)
            if not isinstance(self.okf_metadata.get("type"), str) or not self.okf_metadata["type"].strip():
                raise ValueError("OKF metadata requires a type")
        elif not self.content.strip():
            raise ValueError("Content cannot be blank")
        return self


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


class KnowledgeSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    lookback_months: int = Field(ge=1, le=24, strict=True)
    expected_revision: int | None = Field(default=None, ge=0)
    expected_definition_revision: int = Field(ge=1)


def _snapshot(row):
    snapshot = {key: row[key] for key in (
        "doc_id", "tenant_id", "project_id", "revision", "title", "category", "tags",
        "content", "media_type", "upload", "author_subject",
    )}
    # Preserve the byte shape of existing immutable revisions and their hashes.
    if row.get("okf") is not None:
        snapshot.update({key: row[key] for key in ("okf", "okf_bundle_id", "okf_concept_path")})
    if row.get("associations") is not None:
        snapshot["associations"] = row["associations"]
    for key in ("structure", "capture"):
        if row.get(key) is not None:
            snapshot[key] = row[key]
    return snapshot


class KnowledgeService:
    def __init__(self, engine, settings):
        self.engine = engine
        self.settings = settings
        self.scope_catalog = None
        # Provider bound matches the parser's hard safety ceiling; each upload
        # still obeys the lower active file-processing configuration.
        self.blobs = ConfigurationBlobStore(settings.artifact_uri("knowledge"), 64 * 1024 * 1024, binary=True)

    async def initialize(self):
        """Seed real consumers once; normal parameter APIs own subsequent edits."""
        async with self.engine.begin() as connection:
            defaults = {"okf_" + name: value for name, value in OKFPolicy().model_dump().items()}
            defaults["capture_lookback_months"] = 3
            for variable, value in defaults.items():
                if await connection.scalar(select(definitions.c.variable_name).where(
                    definitions.c.tenant_id == self.settings.tenant_id,
                    definitions.c.tool == "knowledge", definitions.c.variable_name == variable,
                )):
                    continue
                await connection.execute(insert(definitions).values(
                    tenant_id=self.settings.tenant_id, tool="knowledge", variable_name=variable,
                    value_type="boolean" if isinstance(value, bool) else "integer",
                    description=("Initial knowledge capture lookback in calendar months" if variable == "capture_lookback_months"
                                 else f"Open Knowledge Format: {variable.removeprefix('okf_').replace('_', ' ')}"),
                    default_value=value, allow_project_override=True, enabled=True,
                    category="operational", subcategory="knowledge", scope="project", icon="book",
                    revision=1, updated_at=time.time(),
                ))

    async def policy(self, principal):
        rows = await ParameterStore(self.engine).resolve(principal.tenant_id, principal.project_id)
        values = {row["variable_name"].removeprefix("okf_"): row["effective_value"] for row in rows
                  if row["tool"] == "knowledge" and row["variable_name"].startswith("okf_")}
        return OKFPolicy.model_validate(values)

    async def capture_settings(self, principal):
        rows = await ParameterStore(self.engine).resolve(principal.tenant_id, principal.project_id)
        row = next((row for row in rows if row["tool"] == "knowledge" and row["variable_name"] == "capture_lookback_months" and row["enabled"]), None)
        if row is None:
            raise ValueError("Knowledge capture lookback is not configured")
        return {"lookback_months": row["effective_value"], "revision": row["override_revision"], "definition_revision": row["revision"]}

    async def save_capture_settings(self, principal, payload):
        self.require_admin(principal)
        try:
            await ParameterStore(self.engine).set_override(principal, "knowledge", "capture_lookback_months", ParameterOverride(
                value=payload.lookback_months, expected_revision=payload.expected_revision or 0,
                expected_definition_revision=payload.expected_definition_revision))
        except ParameterConflict as exc:
            raise KnowledgeConflict(str(exc)) from None
        return await self.capture_settings(principal)

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
        policy = await self.policy(principal)
        capture_admissions = await self.capture_admissions(principal, rows)
        result = []
        for row in rows:
            admission = eligibility(row.get("okf"), policy, time.time())
            capture_admission = capture_admissions[row["doc_id"]]
            if not set(principal.roles) & ADMIN_ROLES and not (admission["eligible"] and capture_admission["eligible"]):
                continue
            result.append(self.view(row, principal) | {"okf_eligibility": admission, "capture_eligibility": capture_admission})
        return result

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
        row = await self.prepare(principal, payload, max_text_chars=max_text_chars, previous=previous, upload=upload)
        async with self.engine.begin() as connection:
            await self.write(connection, principal, row, previous)
        return self.view(row, principal)

    async def upload_match(self, principal, source_sha256):
        """Return the current identity while disclosing the exact older match."""
        self.require_admin(principal)
        async with self.engine.connect() as connection:
            match = (await connection.execute(select(knowledge_uploads).where(
                knowledge_uploads.c.tenant_id == principal.tenant_id,
                knowledge_uploads.c.project_id == principal.project_id,
                knowledge_uploads.c.source_sha256 == source_sha256,
            ))).mappings().first()
        if not match:
            return None
        row = await self.row(principal, match["doc_id"])
        await self.verify(row)
        frozen = json.loads(await self.blobs.get(match["content_hash"]))
        if any(frozen.get(key) != match[key] for key in ("tenant_id", "project_id", "doc_id", "revision")) or (
            (frozen.get("upload") or {}).get("sha256") != source_sha256
        ):
            raise KnowledgeConflict("The saved upload identity failed its integrity check")
        return self.view(row, principal) | {"upload_match": {
            "revision": match["revision"], "content_hash": match["content_hash"],
            "current_revision": row["revision"],
        }}

    async def save_upload(self, principal, payload, *, max_text_chars, upload, doc_id=None, expected_hash=None):
        self.require_admin(principal)
        previous = await self.row(principal, doc_id) if doc_id else None
        if previous and self.view(previous, principal)["content_hash"] != expected_hash:
            raise KnowledgeConflict("Document changed. Reload before replacing its file.")
        source_sha256 = upload["sha256"]
        if not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
            raise ValueError("Invalid source hash")
        match = await self.upload_match(principal, source_sha256)
        if match:
            return match
        row = await self.prepare(principal, payload, max_text_chars=max_text_chars, previous=previous, upload=upload)
        try:
            async with self.engine.begin() as connection:
                await self.write(connection, principal, row, previous)
                await connection.execute(insert(knowledge_uploads).values(
                    tenant_id=principal.tenant_id, project_id=principal.project_id,
                    source_sha256=source_sha256, doc_id=row["doc_id"], revision=row["revision"],
                    content_hash=row["content_hash"], created_at=time.time(),
                ))
        except IntegrityError:
            # A concurrent identical upload wins once. The draft and audit insert
            # above roll back with this transaction, so no orphan becomes visible.
            match = await self.upload_match(principal, source_sha256)
            if not match:
                raise KnowledgeConflict("The upload changed concurrently. Retry the file.") from None
            return match
        return self.view(row, principal)

    async def prepare(self, principal, payload, *, max_text_chars, previous=None, upload=None, okf=None,
                      bundle_id=None, concept_path=None, capture=None):
        """Build one immutable draft; batch import commits all prepared rows together."""
        self.require_admin(principal)
        if len(payload.content) > max_text_chars:
            raise ValueError("Knowledge content exceeds the configured extracted-text limit")
        structure = payload.structure
        if structure is None and previous and previous.get("structure") and "structure" not in payload.model_fields_set and upload is None:
            if payload.content != previous["content"]:
                raise KnowledgeConflict("Edit the structured blocks or explicitly convert this document to plain text.")
            structure = KnowledgeStructure.model_validate(previous["structure"])
        if structure is not None:
            structure = KnowledgeStructure.model_validate(redact(structure.model_dump(), max_text=16000))
        text = structure.markdown() if structure else redact(payload.content, max_text=max_text_chars)
        if len(text) > max_text_chars:
            raise ValueError("Knowledge content exceeds the configured extracted-text limit")
        associations = payload.associations.model_dump() if payload.associations is not None else (previous or {}).get("associations")
        lineage = capture if capture is not None else (previous or {}).get("capture")
        if lineage and lineage["source"]["kind"] == "document":
            original = await self.row(principal, lineage["source"]["id"])
            for key in ("environment_ids", "capability_ids", "connector_instance_ids"):
                boundary = (original.get("associations") or {}).get(key, [])
                selected = (associations or {}).get(key, [])
                if boundary and (not selected or not set(selected).issubset(boundary)):
                    raise ValueError("Derived knowledge cannot widen the original document's applicability")
        if associations and any(associations.get(key) for key in ("environment_ids", "capability_ids", "connector_instance_ids")):
            if self.scope_catalog is None:
                raise ValueError("Knowledge association catalog is unavailable")
            catalog = await self.scope_catalog(principal)
            for key in ("environment_ids", "capability_ids", "connector_instance_ids"):
                if set(associations.get(key, [])) - {item["id"] for item in catalog[key]}:
                    raise ValueError("Knowledge references an unavailable project association")
        previous_okf = (previous or {}).get("okf")
        envelope = dict(okf or previous_okf) if okf or previous_okf else None
        if payload.okf_metadata is not None and envelope is None:
            raise ValueError("Create portable concepts through OKF import before editing their metadata")
        if envelope is not None:
            if payload.okf_metadata is not None:
                policy = await self.policy(principal)
                envelope["metadata"] = redact(metadata_data(payload.okf_metadata, maximum=policy.max_metadata_bytes), max_text=policy.max_file_bytes)
            if previous and okf is None:
                envelope["metadata"] = {**envelope["metadata"], "title": redact(payload.title), "tags": redact(payload.tags)}
                async with self.engine.connect() as connection:
                    paths = set((await connection.execute(select(documents.c.okf_concept_path).where(
                        self.scope(principal), documents.c.okf_bundle_id == previous["okf_bundle_id"],
                    ).limit(256))).scalars())
                envelope["links"] = concept_links(previous["okf_concept_path"], payload.content, envelope["metadata"], paths)[0]
            envelope["envelope_hash"] = content_hash({key: value for key, value in envelope.items() if key != "envelope_hash"})
        now = time.time()
        row = {
            "doc_id": previous["doc_id"] if previous else "kb_" + uuid.uuid4().hex,
            "tenant_id": principal.tenant_id, "project_id": principal.project_id,
            "revision": (previous["revision"] if previous else 0) + 1,
            "title": redact(payload.title), "category": redact(payload.category),
            "tags": list(dict.fromkeys(redact(payload.tags))), "content": text,
            "structure": structure.model_dump() if structure else None,
            "capture": capture if capture is not None else (previous or {}).get("capture"),
            "media_type": payload.media_type,
            "upload": upload if upload is not None else previous["upload"] if previous else None,
            "okf": envelope,
            "okf_bundle_id": bundle_id or (previous or {}).get("okf_bundle_id"),
            "okf_concept_path": concept_path or (previous or {}).get("okf_concept_path"),
            "associations": associations,
            "required_associations": (previous or {}).get("required_associations"),
            "author_subject": principal.subject, "reviewer_subject": None,
            "reviewed_at": None, "review_reason": None, "status": "draft",
            "created_at": previous["created_at"] if previous else now, "updated_at": now,
        }
        row["size_bytes"] = len(row["content"].encode("utf-8"))
        serialized = json.dumps(_snapshot(row), sort_keys=True, ensure_ascii=False).encode()
        row["content_hash"] = await self.blobs.put(serialized)
        return row

    async def ingest_capture(self, principal, *, source, title, structure, max_text_chars, associations=None):
        """An observed source version creates one draft; retries never overwrite human edits."""
        self.require_admin(principal)
        source = KnowledgeCaptureSource.model_validate(source).model_dump()
        if len(json.dumps(source["metadata"]).encode()) > 32768:
            raise ValueError("Capture metadata exceeds its limit")
        source["metadata"] = redact(source["metadata"], max_text=16000)
        modified = source["metadata"].get("modified_at")
        observed_at = source["metadata"].get("observed_at")
        if source["kind"] in {"jira_ticket", "confluence"}:
            if not isinstance(observed_at, (int, float)) or isinstance(observed_at, bool) or not math.isfinite(observed_at) or observed_at <= 0:
                raise ValueError("External capture requires its request-start observation timestamp")
        else:
            observed_at = time.time()
        if source["kind"] == "document":
            parent = await self.row(principal, source["id"])
            if parent.get("capture") or parent["status"] != "approved" or parent["content_hash"] != source["content_hash"]:
                raise KnowledgeConflict("Capture requires the current approved original document")
            if not parent["reviewer_subject"] or parent["reviewer_subject"] == parent["author_subject"] or not eligibility(parent.get("okf"), await self.policy(principal), time.time())["eligible"]:
                raise KnowledgeConflict("Source document is not eligible")
            await self.verify(parent)
            modified = parent["updated_at"]
            associations = KnowledgeAssociations.model_validate(parent["associations"]) if parent.get("associations") else None
        if not isinstance(modified, (float, int)) or isinstance(modified, bool) or not math.isfinite(modified) or modified <= 0:
            raise ValueError("Capture requires the recorded source modification timestamp")
        key = content_hash({"tenant": principal.tenant_id, "project": principal.project_id,
                            "kind": source["kind"], "id": source["id"], "hash": source["content_hash"]})

        async def existing():
            async with self.engine.begin() as connection:
                receipt = (await connection.execute(select(knowledge_captures).where(knowledge_captures.c.capture_key == key))).mappings().first()
                if not receipt:
                    return None
                await connection.execute(update(knowledge_captures).where(knowledge_captures.c.capture_key == key).values(
                    # Keep source version and observation paired. An older cached
                    # version must not lend freshness to a newer source version.
                    last_seen_at=case((knowledge_captures.c.source_modified_at < modified, observed_at),
                        (and_(knowledge_captures.c.source_modified_at == modified, knowledge_captures.c.last_seen_at < observed_at), observed_at),
                        else_=knowledge_captures.c.last_seen_at),
                    source_modified_at=case((knowledge_captures.c.source_modified_at < modified, modified), else_=knowledge_captures.c.source_modified_at)))
            row = await self.row(principal, receipt["doc_id"])
            await self.verify(row)
            return self.view(row, principal) | {"capture_outcome": "unchanged"}

        found = await existing()
        if found:
            return found
        structure = KnowledgeStructure.model_validate(structure)
        payload = KnowledgeInput(title=title, category="Knowledge", structure=structure, associations=associations)
        now = time.time()
        row = await self.prepare(principal, payload, max_text_chars=max_text_chars, capture={"source": source, "captured_at": now})
        try:
            async with self.engine.begin() as connection:
                await self.write(connection, principal, row, None)
                await connection.execute(insert(knowledge_captures).values(capture_key=key, tenant_id=principal.tenant_id,
                    project_id=principal.project_id, source_kind=source["kind"], source_id=source["id"], source_hash=source["content_hash"],
                    source_modified_at=modified, doc_id=row["doc_id"], created_at=now, last_seen_at=observed_at))
        except IntegrityError:
            found = await existing()
            if found:
                return found
            raise KnowledgeConflict("Capture changed concurrently; retry this source") from None
        return self.view(row, principal) | {"capture_outcome": "created"}

    async def mark_source_unavailable(self, principal, kind, source_id, observed_at, *, modified_at=None):
        """Retire observed unavailable sources without deleting history or racing newer reads."""
        self.require_admin(principal)
        if not isinstance(observed_at, (int, float)) or isinstance(observed_at, bool) or not math.isfinite(observed_at) or observed_at <= 0:
            raise ValueError("An observation timestamp is required")
        if modified_at is not None and (not isinstance(modified_at, (int, float)) or isinstance(modified_at, bool) or not math.isfinite(modified_at) or modified_at <= 0):
            raise ValueError("Invalid source modification timestamp")
        if kind not in {"jira_ticket", "confluence"} or not isinstance(source_id, str) or not 1 <= len(source_id) <= 512:
            raise ValueError("Invalid external source identity")
        from sqlalchemy.dialects.postgresql import insert as postgres_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        insert_state = sqlite_insert if self.engine.dialect.name == "sqlite" else postgres_insert
        source_key = content_hash([principal.tenant_id, principal.project_id, kind, source_id])
        statement = insert_state(knowledge_source_states).values(source_key=source_key, tenant_id=principal.tenant_id,
            project_id=principal.project_id, source_kind=kind, source_id=source_id,
            unavailable_at=observed_at, source_modified_at=modified_at)
        statement = statement.on_conflict_do_update(index_elements=[knowledge_source_states.c.source_key], set_={
            "unavailable_at": case((knowledge_source_states.c.unavailable_at < observed_at, observed_at), else_=knowledge_source_states.c.unavailable_at),
            "source_modified_at": case((knowledge_source_states.c.source_modified_at.is_(None), modified_at),
                (knowledge_source_states.c.source_modified_at < modified_at, modified_at), else_=knowledge_source_states.c.source_modified_at) if modified_at is not None else knowledge_source_states.c.source_modified_at,
        })
        async with self.engine.begin() as connection:
            # Persist the fence even before the first captured version exists.
            await connection.execute(statement)
            await connection.execute(update(knowledge_captures).where(
                knowledge_captures.c.tenant_id == principal.tenant_id, knowledge_captures.c.project_id == principal.project_id,
                knowledge_captures.c.source_kind == kind, knowledge_captures.c.source_id == source_id,
                knowledge_captures.c.last_seen_at <= observed_at,
            ).values(unavailable_at=case((knowledge_captures.c.unavailable_at > observed_at, knowledge_captures.c.unavailable_at), else_=observed_at)))

    async def capture_admissions(self, principal, rows):
        """Current source lineage gates new use; historical run evidence remains immutable."""
        result = {row["doc_id"]: {"eligible": True, "reasons": []} for row in rows}
        captured = [row for row in rows if row.get("capture")]
        if not captured:
            return result
        policy = await self.policy(principal)
        source_ids = {row["capture"]["source"]["id"] for row in captured}
        ranked = select(knowledge_captures, func.row_number().over(
            partition_by=[knowledge_captures.c.source_kind, knowledge_captures.c.source_id],
            order_by=[knowledge_captures.c.source_modified_at.desc(), knowledge_captures.c.last_seen_at.desc(), knowledge_captures.c.created_at.desc()]).label("position")).where(
                knowledge_captures.c.tenant_id == principal.tenant_id, knowledge_captures.c.project_id == principal.project_id,
                knowledge_captures.c.source_id.in_(source_ids)).subquery()
        async with self.engine.connect() as connection:
            latest = {(row["source_kind"], row["source_id"]): row for row in (await connection.execute(select(ranked).where(ranked.c.position == 1))).mappings()}
            source_states = {(row["source_kind"], row["source_id"]): row for row in (await connection.execute(select(knowledge_source_states).where(
                knowledge_source_states.c.tenant_id == principal.tenant_id, knowledge_source_states.c.project_id == principal.project_id,
                knowledge_source_states.c.source_id.in_(source_ids)))).mappings()}
            originals = {row["doc_id"]: row for row in (await connection.execute(select(documents).where(self.scope(principal), documents.c.doc_id.in_(source_ids)))).mappings()}
        for row in captured:
            source = row["capture"]["source"]
            reasons = result[row["doc_id"]]["reasons"]
            observed = latest.get((source["kind"], source["id"]))
            if not observed or observed["source_hash"] != source["content_hash"]:
                reasons.append("A newer source version was observed or capture provenance is unavailable")
            source_state = source_states.get((source["kind"], source["id"]))
            if observed and source_state and (observed["last_seen_at"] <= source_state["unavailable_at"]
                    or (source_state["source_modified_at"] is not None and observed["source_modified_at"] <= source_state["source_modified_at"])):
                reasons.append("A later unavailable or reopened source observation supersedes this capture")
            if observed and observed.get("unavailable_at") and observed["last_seen_at"] <= observed["unavailable_at"]:
                reasons.append("The source is no longer available or the ticket has reopened")
            if source["kind"] == "document":
                parent = originals.get(source["id"])
                if (not parent or parent.get("capture") or parent["status"] != "approved" or parent["content_hash"] != source["content_hash"]
                        or not parent["reviewer_subject"] or parent["author_subject"] == parent["reviewer_subject"]
                        or not eligibility(parent.get("okf"), policy, time.time())["eligible"]):
                    reasons.append("The original project document changed or is no longer approved and eligible")
                else:
                    try:
                        await self.verify(parent)
                    except (KnowledgeConflict, LookupError, ValueError):
                        reasons.append("The original project document failed its integrity check")
            if source["kind"] == "feedback":
                from app.optimization.improvement import candidates
                from app.optimization.knowledge_capture import feedback_capture_hash
                async with self.engine.connect() as connection:
                    candidate = (await connection.execute(select(candidates).where(candidates.c.tenant_id == principal.tenant_id,
                        candidates.c.project_id == principal.project_id, candidates.c.candidate_id == source["id"]))).mappings().first()
                if not candidate or candidate["status"] != "VERIFIED" or feedback_capture_hash(candidate) != source["content_hash"]:
                    reasons.append("The verified feedback outcome changed or is unavailable")
            result[row["doc_id"]]["eligible"] = not reasons
        return result

    async def write(self, connection, principal, row, previous):
        if previous:
            changed = await connection.execute(update(documents).where(
                self.scope(principal), documents.c.doc_id == row["doc_id"],
                documents.c.revision == previous["revision"], documents.c.status == previous["status"],
                documents.c.updated_at == previous["updated_at"],
            ).values(**row))
            if changed.rowcount != 1:
                raise KnowledgeConflict("Document changed. Reload before saving.")
        else:
            await connection.execute(insert(documents).values(**row))
        await self._audit(connection, principal, row, "draft")

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
        if action == "approve" and not (await self.capture_admissions(principal, [row]))[row["doc_id"]]["eligible"]:
            raise KnowledgeConflict("The captured source changed or is unavailable. Refresh it before approval.")
        status = {"submit": "pending", "approve": "approved", "reject": "rejected", "revoke": "revoked"}[action]
        values = {"status": status, "updated_at": time.time(), "review_reason": payload.reason,
                  "reviewer_subject": principal.subject if action != "submit" else None,
                  "reviewed_at": time.time() if action != "submit" else None}
        if action == "approve":
            values["required_associations"] = row.get("associations") if (row.get("associations") or {}).get("required") else None
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
        if upload.get("processing_status") == "okf_import" and not set(principal.roles) & ADMIN_ROLES:
            raise PermissionError("Original OKF bundles may contain unapproved or unredacted material; administrator access is required")
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

    async def required_readiness(self, principal, capability, *, environment_ids=(), instance_ids=(), all_associations=False):
        async with self.engine.connect() as connection:
            rows = (await connection.execute(select(documents).where(self.scope(principal),
                documents.c.required_associations["required"].as_boolean().is_(True)).limit(501))).mappings().all()
        if len(rows) > 500:
            raise KnowledgeConflict("Knowledge catalog exceeds its review limit")
        policy = await self.policy(principal)
        capture_admissions = await self.capture_admissions(principal, rows)
        errors = []
        for row in rows:
            association = row.get("required_associations") or {}
            if not association.get("required") or capability not in association.get("capability_ids", []):
                continue
            if not all_associations and not matches_associations({"associations": association}, capability, environment_ids, instance_ids):
                continue
            if (row["status"] != "approved" or not row["content_hash"] or not row["reviewer_subject"]
                    or row["author_subject"] == row["reviewer_subject"] or not eligibility(row.get("okf"), policy, time.time())["eligible"]
                    or not capture_admissions[row["doc_id"]]["eligible"]):
                errors.append(f"Required knowledge '{row['title']}' ({row['doc_id']}) needs an eligible approved revision")
            else:
                await self.verify(row)
        return errors

    async def relevant(self, principal, query, *, max_items, max_chars, capability=None, environment_ids=(), instance_ids=(), document_ids=()):
        """Bounded literal keyword relevance; only independently approved snapshots qualify."""
        terms = list(dict.fromkeys(re.findall(r"[^\W_]{3,64}", query.casefold())))[:12]
        terms = [term for term in terms if term not in {
            "the", "and", "for", "that", "this", "with", "what", "how", "why", "please", "from", "are", "was", "can", "our",
        }]
        if len(document_ids) > 3 or len(set(document_ids)) != len(document_ids):
            raise ValueError("Select up to three distinct knowledge documents")
        errors = await self.required_readiness(principal, capability, environment_ids=environment_ids, instance_ids=instance_ids)
        if errors:
            raise KnowledgeConflict("; ".join(errors))
        score = sum(case((documents.c.title.ilike("%" + term + "%"), 3), else_=0)
                    + case((documents.c.content.ilike("%" + term + "%"), 1), else_=0) for term in terms)
        statement = select(documents).where(
            self.scope(principal), documents.c.status == "approved", documents.c.content_hash.is_not(None),
            documents.c.reviewer_subject.is_not(None), documents.c.author_subject != documents.c.reviewer_subject,
        )
        # Keep selection and required guidance ahead of bounded keyword candidates;
        # retained historical capture revisions must not disable a growing library.
        priority = case((documents.c.doc_id.in_(document_ids), 2),
                        (documents.c.associations["required"].as_boolean().is_(True), 1), else_=0)
        order = [priority.desc(), *([score.desc()] if terms else []), documents.c.updated_at.desc(), documents.c.doc_id]
        statement = statement.order_by(*order).limit(500)
        async with self.engine.connect() as connection:
            rows = (await connection.execute(statement)).mappings().all()
        policy = await self.policy(principal)
        capture_admissions = await self.capture_admissions(principal, rows)
        rows = [row for row in rows if eligibility(row.get("okf"), policy, time.time())["eligible"]
                and capture_admissions[row["doc_id"]]["eligible"]
                and matches_associations(row, capability, environment_ids, instance_ids)]
        if set(document_ids) - {row["doc_id"] for row in rows}:
            raise PermissionError("Selected knowledge is unavailable in this capability and environment")
        required = [row for row in rows if (row.get("associations") or {}).get("required")]
        picked_ids = set(document_ids) | {row["doc_id"] for row in required}
        if len(picked_ids) > min(max_items, 3) or (picked_ids and max_chars < 128 * len(picked_ids)):
            raise KnowledgeConflict("Selected and required knowledge exceeds this run's evidence budget")
        rows = [row for row in rows if row["doc_id"] in picked_ids] + [row for row in rows if row["doc_id"] not in picked_ids
                and any(term in (row["title"] + " " + row["content"]).casefold() for term in terms)]
        rows = rows[:min(max(0, max_items), 3)] if max_chars >= 128 else []
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
                **({"structure": {"topic": row["structure"]["topic"], "block_titles": [block["title"] for block in row["structure"]["blocks"]]}} if row.get("structure") else {}),
                **({"capture": row["capture"]} if row.get("capture") else {}),
                **({"okf": {"bundle_id": row["okf_bundle_id"], "concept_path": row["okf_concept_path"],
                            "envelope_hash": row["okf"]["envelope_hash"], "metadata": row["okf"]["metadata"],
                            "eligibility": eligibility(row["okf"], policy, time.time())}} if row.get("okf") else {}),
            })
        return selected

    async def frozen_corpus(self, principal, *, document_ids: list[str] | None = None, max_documents=50):
        """Freeze verified eligible rows for authorized, isolated evaluation replay."""
        if not 1 <= max_documents <= 256 or (document_ids is not None and len(document_ids) > max_documents):
            raise ValueError("Knowledge corpus exceeds its document limit")
        statement = select(documents).where(self.scope(principal), documents.c.status == "approved",
            documents.c.content_hash.is_not(None), documents.c.reviewer_subject.is_not(None),
            documents.c.author_subject != documents.c.reviewer_subject)
        if document_ids is not None:
            statement = statement.where(documents.c.doc_id.in_(document_ids))
        async with self.engine.connect() as connection:
            rows = (await connection.execute(statement.order_by(documents.c.doc_id).limit(501))).mappings().all()
        policy = await self.policy(principal)
        capture_admissions = await self.capture_admissions(principal, rows)
        rows = [dict(row) for row in rows if eligibility(row.get("okf"), policy, time.time())["eligible"] and capture_admissions[row["doc_id"]]["eligible"]]
        if len(rows) > max_documents or (document_ids is not None and set(document_ids) != {row["doc_id"] for row in rows}):
            raise KnowledgeConflict("Knowledge corpus is unavailable, ineligible, or exceeds the document limit")
        for row in rows:
            await self.verify(row)
        if len(json.dumps(rows, ensure_ascii=False).encode()) > 8 * 1024 * 1024:
            raise ValueError("Knowledge corpus exceeds the 8 MiB replay bound")
        return rows
