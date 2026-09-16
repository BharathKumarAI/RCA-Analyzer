"""Real local parsing, transactional identities and scoped per-file upload outcomes."""

import asyncio
import hashlib
import json
import sqlite3
from dataclasses import replace

from fastapi.testclient import TestClient
from sqlalchemy import insert, select
import pytest

from app.api.application import create_app
from app.configuration.knowledge import KnowledgeInput
from app.persistence.platform_admin import knowledge_uploads, platform_knowledge
from tests.integration.test_knowledge_lifecycle import approve, review
from tests.support import connectors, settings_for


def upload(client, token, data=b"Inspect actual checkout evidence.", **metadata):
    response = client.post("/api/v1/knowledge/upload", headers=token("owner"),
        data={"title": "Checkout"} | metadata, files={"file": ("guide.txt", data, "text/plain")})
    assert response.status_code == 201, response.text
    return response.json()


def batch(client, headers, files, metadata=None):
    return client.post("/api/v1/knowledge/upload/batch", headers=headers,
        data={"metadata": json.dumps(metadata or [{"title": name} for name, _ in files])},
        files=[("files", (name, data, "application/octet-stream")) for name, data in files])


def test_batch_real_parsing_mixed_outcomes_retry_and_historical_identity(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        files = [("guide.txt", b"Inspect checkout timeout evidence."),
                 ("other.md", b"Compare real database session waits."),
                 ("unsafe.exe", b"executable"), ("empty.txt", b"")]
        response = batch(client, token("owner"), files)
        assert response.status_code == 200, response.text
        outcomes = response.json()["outcomes"]
        assert [item["status"] for item in outcomes] == ["created", "created", "failed", "failed"]
        assert [item["index"] for item in outcomes] == [0, 1, 2, 3]
        first = outcomes[0]["document"]
        assert first["status"] == "draft" and first["upload"]["media_type"] == "text/plain"
        assert len(client.get("/api/v1/knowledge", headers=token("owner")).json()) == 2
        repeated = batch(client, token("owner"), files).json()["outcomes"]
        assert [item["status"] for item in repeated] == ["duplicate", "duplicate", "failed", "failed"]
        assert repeated[0]["document"]["id"] == first["id"]
        assert repeated[0]["matched_content_hash"] == first["content_hash"]
        assert repeated[0]["duplicate_historical"] is False
        first = approve(client, token, first)
        same = upload(client, token, files[0][1], title="Ignored replacement title")
        assert same["id"] == first["id"] and same["status"] == "approved"
        assert same["title"] == first["title"] and same["revision"] == 1
        changed = upload(client, token, b"New checkout guidance verified against evidence.",
            doc_id=first["id"], expected_hash=first["content_hash"])
        assert changed["revision"] == 2 and changed["status"] == "draft"
        historical = batch(client, token("owner"), files[:1]).json()["outcomes"][0]
        assert historical["status"] == "duplicate" and historical["duplicate_historical"] is True
        assert historical["matched_revision"] == 1 and historical["matched_content_hash"] == first["content_hash"]
        assert historical["document"]["content"] == changed["content"]
        assert historical["document"]["content_hash"] == changed["content_hash"]
        assert historical["document"]["status"] == "draft"
        changed = approve(client, token, changed)
        assert review(client, token, changed, "revoke", "admin").status_code == 200
        assert upload(client, token, files[0][1])["status"] == "revoked"
        original = asyncio.run(client.app.state.knowledge.blobs.get(first["content_hash"]))
        assert json.loads(original)["content"] == first["content"]
    with sqlite3.connect(tmp_path / "runs.db") as db:
        assert db.execute("SELECT count(*) FROM platform_knowledge").fetchone()[0] == 2
        assert db.execute("SELECT count(*) FROM knowledge_uploads").fetchone()[0] == 3


def test_batch_denies_before_parsing_and_checks_all_size_bounds_before_writes(tmp_path, monkeypatch):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        async def forbidden_parser(*args, **kwargs):
            pytest.fail("Unpermitted uploads must not reach the parser")

        monkeypatch.setattr("app.api.routes.knowledge_uploads.parse_files", forbidden_parser)
        files = [("guide.txt", b"text")]
        for headers, status in (({}, 401), (token("viewer"), 403), (token("analyst"), 403),
                                (token("owner") | {"X-RCA-Project": "foreign"}, 403)):
            assert batch(client, headers, files).status_code == status
        client.app.state.file_limits = replace(client.app.state.file_limits, max_files=1, max_file_bytes=4)
        assert batch(client, token("owner"), files * 2).status_code == 422
        assert batch(client, token("owner"), [("large.txt", b"12345")]).status_code == 413
        assert batch(client, token("owner"), files, [{"title": "A"}, {"title": "B"}]).status_code == 422
        client.app.state.file_limits = replace(client.app.state.file_limits, max_files=2)
        client.app.state.settings = client.app.state.settings.model_copy(update={"max_upload_batch_bytes": 5})
        assert batch(client, token("owner"), files * 2).status_code == 413
        assert client.get("/api/v1/knowledge", headers=token("owner")).json() == []


def test_batch_scope_invalid_metadata_and_stale_replacements_are_per_file(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        first = upload(client, token)
        files = [("valid.txt", b"New valid guidance."), ("stale.txt", b"Replacement content."),
                 ("foreign.txt", b"Foreign content."), ("role.txt", b"Not trusted."),
                 ("scope.txt", b"Scope content.")]
        metadata = [{"title": "Valid"}, {"title": "Stale", "doc_id": first["id"], "expected_hash": "sha256:" + "0" * 64},
            {"title": "Foreign", "doc_id": "outside", "expected_hash": first["content_hash"]},
            {"title": "Untrusted", "status": "approved"},
            {"title": "Wrong scope", "associations": {"environment_ids": ["foreign"]}}]
        response = batch(client, token("owner"), files, metadata)
        assert response.status_code == 200, response.text
        outcomes = response.json()["outcomes"]
        assert [item["status"] for item in outcomes] == ["created", "failed", "failed", "failed", "failed"]
        assert [item["error"]["code"] for item in outcomes[1:]] == ["conflict", "not_found", "invalid_file", "invalid_file"]
        assert len(client.get("/api/v1/knowledge", headers=token("owner")).json()) == 2


def test_concurrent_identical_uploads_commit_one_draft_and_scope_is_independent(tmp_path, monkeypatch):
    settings, _ = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service = client.app.state.knowledge
        principal = settings.principals["owner"]
        raw = b"Concurrent actual document."
        source = hashlib.sha256(raw).hexdigest()
        upload_metadata = {"sha256": source, "filename": "guide.txt", "original_retained": True}
        payload = KnowledgeInput(title="Concurrent", content=raw.decode())
        real_prepare = service.prepare
        count = 0

        async def run():
            both_prepared = asyncio.Event()

            async def synchronized(*args, **kwargs):
                nonlocal count
                row = await real_prepare(*args, **kwargs)
                count += 1
                if count == 2:
                    both_prepared.set()
                await both_prepared.wait()
                return row

            monkeypatch.setattr(service, "prepare", synchronized)
            results = await asyncio.gather(*(service.save_upload(principal, payload, max_text_chars=1000,
                upload=upload_metadata) for _ in range(2)))
            assert len({item["id"] for item in results}) == 1
            assert sum("upload_match" in item for item in results) == 1
            monkeypatch.setattr(service, "prepare", real_prepare)
            other = principal.model_copy(update={"project_id": "separate"})
            separate = await service.save_upload(other, payload, max_text_chars=1000, upload=upload_metadata)
            assert separate["id"] != results[0]["id"]
            async with service.engine.connect() as connection:
                rows = (await connection.execute(select(platform_knowledge))).mappings().all()
                identities = (await connection.execute(select(knowledge_uploads))).mappings().all()
            assert len(rows) == len(identities) == 2

        asyncio.run(run())
    with sqlite3.connect(tmp_path / "runs.db") as db:
        assert db.execute("SELECT count(*) FROM parameter_audit WHERE tool='knowledge'").fetchone()[0] == 2


def test_upload_identity_and_audit_roll_back_together(tmp_path, monkeypatch):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service = client.app.state.knowledge
        real_write = service.write

        async def invalid_identity(connection, principal, row, previous):
            await real_write(connection, principal, row, previous)
            await connection.execute(insert(knowledge_uploads).values(tenant_id=principal.tenant_id,
                project_id=principal.project_id, source_sha256=row["upload"]["sha256"], doc_id=row["doc_id"],
                revision=row["revision"], content_hash=row["content_hash"], created_at=0))

        monkeypatch.setattr(service, "write", invalid_identity)
        failed = batch(client, token("owner"), [("guide.txt", b"Transaction rollback evidence.")])
        assert failed.status_code == 200
        assert failed.json()["outcomes"][0]["error"]["code"] == "conflict"
        assert client.get("/api/v1/knowledge", headers=token("owner")).json() == []
    with sqlite3.connect(tmp_path / "runs.db") as db:
        assert db.execute("SELECT count(*) FROM knowledge_uploads").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM parameter_audit WHERE tool='knowledge'").fetchone()[0] == 0


def test_batch_deadline_leaves_retryable_outcomes_without_partial_identity(tmp_path, monkeypatch):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        client.app.state.settings = settings.model_copy(update={"run_timeout_seconds": 0.02})

        async def waiting_parser(*args, **kwargs):
            await asyncio.Event().wait()

        monkeypatch.setattr("app.api.routes.knowledge_uploads.parse_files", waiting_parser)
        result = batch(client, token("owner"), [("guide.txt", b"Deadline input.")])
        assert result.status_code == 200, result.text
        assert result.json()["outcomes"][0]["error"]["code"] == "deadline"
        assert client.get("/api/v1/knowledge", headers=token("owner")).json() == []


def test_duplicate_match_verifies_current_and_historical_hashes(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        first = upload(client, token, b"Original source content.")
        with sqlite3.connect(tmp_path / "runs.db") as db:
            db.execute("UPDATE platform_knowledge SET content='tampered' WHERE doc_id=?", (first["id"],))
        response = batch(client, token("owner"), [("guide.txt", b"Original source content.")])
        assert response.status_code == 200 and response.json()["outcomes"][0]["error"]["code"] == "conflict"
        with sqlite3.connect(tmp_path / "runs.db") as db:
            db.execute("UPDATE platform_knowledge SET content=? WHERE doc_id=?", (first["content"], first["id"]))
            db.execute("UPDATE knowledge_uploads SET revision=99")
        response = batch(client, token("owner"), [("guide.txt", b"Original source content.")])
        assert response.status_code == 200 and response.json()["outcomes"][0]["error"]["code"] == "conflict"
