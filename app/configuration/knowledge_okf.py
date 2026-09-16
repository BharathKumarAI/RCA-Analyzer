"""Atomic OKF exchange through the existing knowledge review and blob stores."""

import asyncio
import io
import json
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import PurePosixPath

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from app.configuration.knowledge import KnowledgeConflict, KnowledgeInput
from app.configuration.okf import (OKFDiagnostic, OKFPreview, OKF_SPEC_COMMIT, byte_hash,
                                   concept_links, eligibility, markdown_bytes, parse_bundle)
from app.persistence.platform_admin import knowledge_okf_bundles as bundles, platform_knowledge as documents
from app.runtime.run_contract import content_hash


class OKFService:
    def __init__(self, knowledge):
        self.knowledge = knowledge
        self.engine = knowledge.engine

    @staticmethod
    def scope(principal):
        return (bundles.c.tenant_id == principal.tenant_id, bundles.c.project_id == principal.project_id)

    async def list_bundles(self, principal):
        self.knowledge.require_admin(principal)
        async with self.engine.connect() as connection:
            rows = (await connection.execute(select(bundles).where(*self.scope(principal)).order_by(
                bundles.c.updated_at.desc(), bundles.c.bundle_id).limit(500))).mappings().all()
        return [dict(row) for row in rows]

    async def bundle(self, principal, bundle_id):
        async with self.engine.connect() as connection:
            row = (await connection.execute(select(bundles).where(*self.scope(principal),
                bundles.c.bundle_id == bundle_id))).mappings().first()
        if row is None:
            raise LookupError("Knowledge bundle not found")
        return dict(row)

    async def _preview(self, principal, filename, raw, bundle_id=None):
        self.knowledge.require_admin(principal)
        bundle = await self.bundle(principal, bundle_id) if bundle_id else None
        policy = await self.knowledge.policy(principal)
        async with asyncio.timeout(30):
            concepts, navigation, diagnostics = await asyncio.to_thread(parse_bundle, filename, raw, policy)
        existing = {}
        if bundle:
            async with self.engine.connect() as connection:
                rows = (await connection.execute(select(documents).where(self.knowledge.scope(principal),
                    documents.c.okf_bundle_id == bundle_id).limit(policy.max_files + 1))).mappings().all()
            if len(rows) > policy.max_files:
                raise ValueError("Saved bundle exceeds the active concept limit")
            existing = {row["okf_concept_path"]: dict(row) for row in rows}
            for concept in concepts:
                previous = existing.get(concept.path)
                if previous:
                    await self.knowledge.verify(previous)
                    concept.doc_id = previous["doc_id"]
                    concept.current_hash = previous["content_hash"]
                    concept.operation = "update"
            if len(set(existing) | {concept.path for concept in concepts}) > policy.max_files:
                raise ValueError("Combined bundle exceeds the active concept limit")
            combined = set(existing) | {concept.path for concept in concepts}
            folded = {path.casefold() for path in combined}
            if len(folded) != len(combined) or any(path.startswith(other + "/") for path in folded for other in folded if path != other):
                raise ValueError("Imported paths collide with existing bundle identities")
        result = OKFPreview(bundle_id=bundle_id, name=bundle["name"] if bundle else PurePosixPath(filename).stem[:256],
            source_hash=byte_hash(raw), preview_hash="", concepts=concepts, navigation=navigation, diagnostics=diagnostics)
        result.preview_hash = content_hash({"preview": result.model_dump(), "policy": policy.model_dump(),
            "tenant_id": principal.tenant_id, "project_id": principal.project_id,
            "bundle_revision": bundle["revision"] if bundle else None,
            "baseline": {path: {key: row[key] for key in ("content_hash", "status", "updated_at")} for path, row in existing.items()}})
        return result, bundle, existing

    async def preview(self, principal, filename, raw, bundle_id=None):
        return (await self._preview(principal, filename, raw, bundle_id))[0]

    async def import_bundle(self, principal, filename, raw, *, preview_hash, expected_hashes,
                            bundle_id=None, max_text_chars):
        preview, previous_bundle, existing = await self._preview(principal, filename, raw, bundle_id)
        if preview.preview_hash != preview_hash:
            raise KnowledgeConflict("Preview changed. Preview these exact bytes and current revisions again before importing.")
        updates = {concept.path: concept.current_hash for concept in preview.concepts if concept.current_hash}
        if expected_hashes != updates:
            raise KnowledgeConflict("Expected hashes must match every concept being replaced and no other paths.")
        # Replaying an unchanged new-import preview cannot create another bundle.
        selected_id = bundle_id or "okf_" + uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(
            [principal.tenant_id, principal.project_id, principal.subject, preview_hash])).hex
        manifest = {"version": 1, "spec_commit": OKF_SPEC_COMMIT, "bundle_id": selected_id,
                    "source_hash": preview.source_hash, "navigation": [item.model_dump() for item in preview.navigation],
                    "concepts": {item.path: item.source_hash for item in preview.concepts}}
        manifest_hash = await self.knowledge.blobs.put(json.dumps(manifest, sort_keys=True, ensure_ascii=False).encode())
        original_hash = await self.knowledge.blobs.put(raw)
        rows = []
        for concept in preview.concepts:
            previous = existing.get(concept.path)
            payload = KnowledgeInput(title=concept.title, category=concept.type, tags=concept.metadata.get("tags", []),
                                     content=concept.content, okf_metadata=concept.metadata)
            envelope = {"version": 1, "spec_commit": OKF_SPEC_COMMIT, "metadata": concept.metadata,
                        "source_hash": concept.source_hash, "source_artifact_hash": preview.source_hash,
                        "bundle_manifest_hash": manifest_hash, "links": concept.links}
            row = await self.knowledge.prepare(principal, payload, max_text_chars=max_text_chars, previous=previous,
                okf=envelope, bundle_id=selected_id, concept_path=concept.path,
                upload={"filename": filename, "sha256": preview.source_hash.removeprefix("sha256:"),
                        "size_bytes": len(raw), "original_retained": True, "original_blob_hash": original_hash,
                        "processing_status": "okf_import", "warnings": [item.message for item in preview.diagnostics if item.path == concept.path]})
            rows.append((row, previous))
        now = time.time()
        values = {"bundle_id": selected_id, "tenant_id": principal.tenant_id, "project_id": principal.project_id,
                  "name": preview.name, "revision": previous_bundle["revision"] + 1 if previous_bundle else 1,
                  "content_hash": manifest_hash, "concept_count": len(set(existing) | {item.path for item in preview.concepts}),
                  "created_at": previous_bundle["created_at"] if previous_bundle else now, "updated_at": now}
        try:
            async with self.engine.begin() as connection:
                if previous_bundle:
                    changed = await connection.execute(update(bundles).where(*self.scope(principal),
                        bundles.c.bundle_id == selected_id, bundles.c.revision == previous_bundle["revision"],
                        bundles.c.content_hash == previous_bundle["content_hash"]).values(**values))
                    if changed.rowcount != 1:
                        raise KnowledgeConflict("Bundle changed during import. Preview the current bundle again.")
                else:
                    await connection.execute(insert(bundles).values(**values))
                for row, previous in rows:
                    await self.knowledge.write(connection, principal, row, previous)
        except IntegrityError as exc:
            raise KnowledgeConflict("Bundle concepts changed during import; no drafts were committed.") from exc
        return {"bundle_id": selected_id, "documents": [self.knowledge.view(row, principal) for row, _ in rows],
                "diagnostics": [item.model_dump() for item in preview.diagnostics]}

    async def export_bundle(self, principal, *, bundle_id=None, document_ids=None, expected_hashes,
                            include_drafts=False, format="zip"):
        policy = await self.knowledge.policy(principal)
        if not policy.export_enabled:
            raise PermissionError("Knowledge export is disabled by project policy")
        if include_drafts:
            self.knowledge.require_admin(principal)
        bundle = await self.bundle(principal, bundle_id) if bundle_id else None
        if not bundle and not document_ids:
            raise ValueError("Choose a bundle or explicit document revisions to export")
        statement = select(documents).where(self.knowledge.scope(principal))
        if bundle_id:
            statement = statement.where(documents.c.okf_bundle_id == bundle_id)
        if document_ids is not None:
            statement = statement.where(documents.c.doc_id.in_(document_ids))
        async with self.engine.connect() as connection:
            rows = [dict(row) for row in (await connection.execute(statement.order_by(documents.c.doc_id).limit(policy.max_files + 1))).mappings().all()]
        if len(rows) > policy.max_files:
            raise ValueError("Export exceeds the configured concept limit")
        if document_ids is not None and {row["doc_id"] for row in rows} != set(document_ids):
            raise LookupError("Knowledge document not found")
        capture_admissions = await self.knowledge.capture_admissions(principal, rows)
        def eligible(row):
            return (row["status"] == "approved" and row.get("reviewer_subject")
                    and row["author_subject"] != row["reviewer_subject"]
                    and capture_admissions[row["doc_id"]]["eligible"]
                    and eligibility(row.get("okf"), policy, time.time())["eligible"])
        selected = [row for row in rows if include_drafts or eligible(row)]
        if document_ids is not None and len(selected) != len(rows):
            raise KnowledgeConflict("Selected knowledge contains unapproved, stale, or deprecated revisions")
        if not selected:
            raise KnowledgeConflict("No eligible knowledge is available to export")
        if {row["doc_id"]: row["content_hash"] for row in selected} != expected_hashes:
            raise KnowledgeConflict("Export revisions changed. Reload and select their exact current hashes.")
        identities = {row.get("okf_bundle_id") for row in selected if row.get("okf_bundle_id")}
        if len(identities) > 1:
            raise ValueError("Export one imported bundle at a time to preserve its concept paths")
        files, diagnostics, source_revisions = {}, [], {}
        for row in selected:
            await self.knowledge.verify(row)
            path = row.get("okf_concept_path") or "documents/" + row["doc_id"] + ".md"
            if path in files:
                raise KnowledgeConflict("Export concept paths collide")
            envelope = row.get("okf") or {}
            metadata = dict(envelope.get("metadata") or {"type": row["category"], "title": row["title"], "tags": row["tags"]})
            if not eligible(row):
                # Local approval is never implied by exporting an administrative draft.
                source_revisions[row["doc_id"]] = {"source_status": metadata.get("status"), "local_status": row["status"]}
                metadata["status"] = "draft"
            files[path] = markdown_bytes(metadata, row["content"])
            source_revisions.setdefault(row["doc_id"], {}).update({"content_hash": row["content_hash"], "revision": row["revision"], "path": path})
        paths = set(files)
        for path, data in files.items():
            # Metadata links are read from the verified envelope, never fetched.
            row = next(row for row in selected if (row.get("okf_concept_path") or "documents/" + row["doc_id"] + ".md") == path)
            _, missing = concept_links(path, row["content"], (row.get("okf") or {}).get("metadata", {}), paths)
            diagnostics.extend(missing)
        if format == "markdown":
            if len(files) != 1:
                raise ValueError("Markdown export requires exactly one selected document")
            filename, raw = next(iter(files.items()))
            if len(raw) > policy.max_file_bytes:
                raise ValueError("Export exceeds the configured concept size limit")
            return raw, PurePosixPath(filename).name, "text/markdown; charset=utf-8", diagnostics, source_revisions
        navigation = {}
        # Navigation is regenerated from the selected revisions. Imported prose
        # and history are never used to leak unselected or unapproved documents.
        if bundle and len(selected) == bundle["concept_count"] and all((row.get("okf") or {}).get("bundle_manifest_hash") == bundle["content_hash"] for row in selected):
            manifest = json.loads(await self.knowledge.blobs.get(bundle["content_hash"]))
            navigation = {item["path"]: item.get("metadata", {}) for item in manifest.get("navigation", [])}
        directories = {""} | {str(parent) for path in files for parent in PurePosixPath(path).parents if str(parent) != "."}
        for directory in sorted(directories):
            index = f"{directory}/index.md" if directory else "index.md"
            metadata = dict(navigation.get(index) or {})
            if not directory:
                metadata.update({"okf_version": "0.2", "rca_export": {
                    **({"imported_claim": metadata["rca_export"]} if "rca_export" in metadata else {}),
                    "source_revisions": source_revisions, "include_drafts": include_drafts,
                    "transformations": ["redacted reviewed content", "navigation generated from selected documents"]}})
            body = "# Knowledge\n\n" + "\n".join(f"- [{PurePosixPath(path).stem}]({posix_relative(path, directory)})" for path in sorted(paths) if not directory or path.startswith(directory + "/")) + "\n"
            files[index] = markdown_bytes(metadata, body) if metadata else body.encode()
            log_path = f"{directory}/log.md" if directory else "log.md"
            if log_path in navigation:
                day = datetime.fromtimestamp(max(row["updated_at"] for row in selected), timezone.utc).date().isoformat()
                log = f"# Exported revisions\n\n## {day}\n" + "\n".join(f"* **Export**: [{PurePosixPath(path).stem}]({posix_relative(path, directory)})" for path in sorted(paths) if not directory or path.startswith(directory + "/")) + "\n"
                files[log_path] = markdown_bytes(navigation[log_path], log) if navigation[log_path] else log.encode()
        if len(files) > policy.max_files or sum(len(data) for data in files.values()) > policy.max_expanded_bytes or any(len(data) > policy.max_file_bytes for data in files.values()):
            raise ValueError("Export exceeds the configured bundle size limit")
        output = io.BytesIO()
        # Stored entries preserve our own expansion-ratio admission invariant,
        # including very repetitive but valid Markdown edited in the catalog.
        with zipfile.ZipFile(output, "w", zipfile.ZIP_STORED) as archive:
            for path, data in sorted(files.items()):
                info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = (0o100600 << 16)
                archive.writestr(info, data)
        if navigation:
            diagnostics.append(OKFDiagnostic(path="index.md", code="navigation_regenerated", message="Navigation lists the exported set; imported history and navigation prose are not included."))
        return output.getvalue(), "knowledge.zip", "application/zip", diagnostics, source_revisions


def posix_relative(path, directory):
    return path[len(directory) + 1:] if directory else path
