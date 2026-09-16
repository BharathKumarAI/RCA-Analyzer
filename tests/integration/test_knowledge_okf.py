import asyncio
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.application import create_app
from app.configuration.knowledge import KnowledgeConflict, _snapshot
from app.configuration.knowledge_okf import OKFService
from app.configuration.okf import OKFPolicy, byte_hash, parse_bundle
from app.persistence.platform_admin import knowledge_okf_bundles
from tests.integration.test_knowledge_lifecycle import approve, draft, review
from tests.support import connectors, model_factory, settings_for
from tests.unit.test_okf_format import archive

BASE = "/api/v1/knowledge/okf"


def preview(client, token, raw, filename="guide.md", bundle_id=None, actor="owner"):
    response = client.post(BASE + "/preview", headers=token(actor), data={"bundle_id": bundle_id} if bundle_id else {},
                           files={"file": (filename, raw, "application/octet-stream")})
    assert response.status_code == 200, response.text
    return response.json()


def import_preview(client, token, raw, plan, filename="guide.md", **changes):
    data = {"preview_hash": plan["preview_hash"],
            "expected_hashes": json.dumps({item["path"]: item["current_hash"] for item in plan["concepts"] if item["current_hash"]})}
    if plan["bundle_id"]:
        data["bundle_id"] = plan["bundle_id"]
    return client.post(BASE + "/import", headers=token("owner"), data=data | changes,
                       files={"file": (filename, raw, "application/octet-stream")})


def test_okf_roundtrip_metadata_claims_review_and_real_native_evidence(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    raw = archive([
        ("index.md", "---\nokf_version: '0.2'\nproducer_extension: keep\nrca_export: {vendor: preserve}\n---\n# Original navigation"),
        ("log.md", "---\nproducer_log: keep\n---\n# Original history\n## 2026-09-15\nSource changes."),
        ("guides/timeout.md", "---\ntype: Playbook\ntitle: Checkout timeout\nverified: {by: 'human:claimed-reviewer', at: 2026-09-15T12:00:00Z}\ncustom: {future_schema: 7}\nsource_secret: protected\nsources: [{id: ops, resource: 'https://example.test/runbook'}]\n---\nFor checkout timeouts inspect pool saturation. [Related](limits.md) [Missing](/other.md).\nPassword=protected\n"),
        ("guides/limits.md", "---\ntype: Unknown Future Type\n---\nCheckout timeouts need current evidence. [Back](timeout.md)"),
    ])
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        plan = preview(client, token, raw, "guidance.zip")
        assert plan["source_hash"] == byte_hash(raw)
        assert plan["concepts"][1]["metadata"]["verified"][0]["by"] == "human:claimed-reviewer"
        assert "protected" not in json.dumps(plan["concepts"])
        assert any(item["code"] == "unresolved_link" for item in plan["diagnostics"])
        imported = import_preview(client, token, raw, plan, "guidance.zip")
        assert imported.status_code == 201, imported.text
        bundle = imported.json()
        docs = bundle["documents"]
        assert all(item["status"] == "draft" and item["reviewer_subject"] is None for item in docs)
        assert all(item["okf_bundle_id"] == bundle["bundle_id"] for item in docs)
        assert client.get(BASE + "/bundles", headers=token("owner")).json()[0]["concept_count"] == 2
        assert import_preview(client, token, raw, plan, "guidance.zip").status_code == 409
        for item in docs:
            assert client.get(f"/api/v1/knowledge/{item['id']}/download", headers=token("owner")).content == raw
            approve(client, token, item)
            assert client.get(f"/api/v1/knowledge/{item['id']}/download", headers=token("viewer")).status_code == 403
        exported = client.post(BASE + "/export", headers=token("viewer"), json={"bundle_id": bundle["bundle_id"],
            "expected_hashes": {item["id"]: item["content_hash"] for item in docs}})
        assert exported.status_code == 200, exported.text
        assert exported.headers["X-Content-SHA256"] == byte_hash(exported.content)
        parsed, navigation, _ = parse_bundle("roundtrip.zip", exported.content, OKFPolicy())
        assert {item.path for item in parsed} == {"guides/timeout.md", "guides/limits.md"}
        timeout = next(item for item in parsed if item.path.endswith("timeout.md"))
        assert timeout.metadata["custom"] == {"future_schema": 7}
        assert timeout.metadata["source_secret"] == "[REDACTED]"
        assert timeout.links[0]["resolved"] is True
        assert navigation[0].path == "guides/index.md" or navigation[0].path == "index.md"
        assert any(item.metadata.get("producer_extension") == "keep" for item in navigation)
        assert next(item for item in navigation if item.path == "index.md").metadata["rca_export"]["imported_claim"] == {"vendor": "preserve"}
        assert next(item for item in navigation if item.path == "log.md").metadata["producer_log"] == "keep"
        run = client.post("/api/v1/runs", headers=token("viewer"), json={"capability": "attachment_review", "prompt": "Inspect checkout timeout pool saturation"})
        assert run.status_code == 200 and run.json()["status"] == "SUCCEEDED", run.text
        evidence = client.get(f"/api/v1/runs/{run.json()['run_id']}/evidence", headers=token("viewer")).json()
        assert len(evidence) == 2
        assert any(json.loads(item["content_json"])["okf"]["bundle_id"] == bundle["bundle_id"] for item in evidence)
        corpus = asyncio.run(client.app.state.knowledge.frozen_corpus(settings.principals["owner"], document_ids=[item["id"] for item in docs]))
        assert len(corpus) == 2 and all(row["okf"]["envelope_hash"] for row in corpus)
        with pytest.raises(KnowledgeConflict):
            asyncio.run(client.app.state.knowledge.frozen_corpus(settings.principals["owner"], max_documents=1))


def test_okf_revision_conflicts_atomic_rollback_and_project_isolation(tmp_path, monkeypatch):
    settings, token = settings_for(tmp_path)
    raw = archive([("a.md", "---\ntype: Reference\n---\nCheckout timeout guidance."),
                   ("b.md", "---\ntype: Reference\n---\nCheckout timeout evidence.")])
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service = client.app.state.knowledge
        plan = preview(client, token, raw, "bundle.zip")
        original = service.write
        writes = 0

        async def fail_second(*args, **kwargs):
            nonlocal writes
            writes += 1
            if writes == 2:
                raise KnowledgeConflict("Concurrent revision changed")
            return await original(*args, **kwargs)

        monkeypatch.setattr(service, "write", fail_second)
        assert import_preview(client, token, raw, plan, "bundle.zip").status_code == 409
        assert client.get("/api/v1/knowledge", headers=token("owner")).json() == []
        assert client.get(BASE + "/bundles", headers=token("owner")).json() == []
        monkeypatch.setattr(service, "write", original)
        imported = import_preview(client, token, raw, plan, "bundle.zip").json()
        current = preview(client, token, raw, "bundle.zip", imported["bundle_id"])
        assert all(item["operation"] == "update" for item in current["concepts"])
        assert import_preview(client, token, raw, current, "bundle.zip", expected_hashes="{}").status_code == 409
        changed = raw + b"changed exact source bytes"
        assert import_preview(client, token, changed, current, "bundle.zip").status_code == 409
        item = imported["documents"][0]
        edited = client.put(f"/api/v1/knowledge/{item['id']}", headers=token("owner"), json={
            "title": item["title"], "content": "Edited checkout timeout guidance", "expected_hash": item["content_hash"],
            "okf_metadata": {"type": "Reference", "producer_extra": {"preserved": True}}})
        assert edited.status_code == 200, edited.text
        assert edited.json()["okf"]["metadata"]["producer_extra"]["preserved"]
        assert edited.json()["okf"]["envelope_hash"] != item["okf"]["envelope_hash"]
        assert import_preview(client, token, raw, current, "bundle.zip").status_code == 409
        assert review(client, token, item, "submit").status_code == 409
        other = settings.principals["owner"].model_copy(update={"project_id": "other-project"})
        with pytest.raises(LookupError):
            asyncio.run(OKFService(service).preview(other, "bundle.zip", raw, imported["bundle_id"]))
        with pytest.raises(LookupError):
            asyncio.run(OKFService(service).export_bundle(other, document_ids=[item["id"]], expected_hashes={item["id"]: item["content_hash"]}))
        refreshed = preview(client, token, raw, "bundle.zip", imported["bundle_id"])
        replaced = import_preview(client, token, raw, refreshed, "bundle.zip")
        assert replaced.status_code == 201, replaced.text
        assert {doc["id"] for doc in replaced.json()["documents"]} == {doc["id"] for doc in imported["documents"]}
        assert all(doc["status"] == "draft" for doc in replaced.json()["documents"])


def test_okf_current_freshness_permissions_config_and_legacy_hashes(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        for actor in (None, "viewer", "analyst"):
            denied = client.post(BASE + "/preview", headers=token(actor) if actor else {}, content=b"not even multipart")
            assert denied.status_code == (401 if actor is None else 403)
        assert client.get(BASE + "/bundles", headers=token("viewer")).status_code == 403
        legacy = approve(client, token, draft(client, token))
        row = asyncio.run(client.app.state.knowledge.row(settings.principals["owner"], legacy["id"]))
        assert "okf" not in _snapshot(row)
        asyncio.run(client.app.state.knowledge.verify(row))
        for source_metadata in ["status: deprecated", "status: draft", "stale_after: 2000-01-01T00:00:00Z", "stale_after: 2000-01-01"]:
            raw = ("---\ntype: Reference\ntitle: Checkout timeout\n" + source_metadata + "\n---\nCheckout timeout guidance.").encode()
            plan = preview(client, token, raw)
            item = import_preview(client, token, raw, plan).json()["documents"][0]
            assert client.post(BASE + "/export", headers=token("owner"), json={"document_ids": [item["id"]], "expected_hashes": {item["id"]: item["content_hash"]}}).status_code == 409
            allowed = client.post(BASE + "/export", headers=token("owner"), json={"document_ids": [item["id"]], "expected_hashes": {item["id"]: item["content_hash"]}, "include_drafts": True, "format": "markdown"})
            assert allowed.status_code == 200 and b"status: draft" in allowed.content
            assert client.post(BASE + "/export", headers=token("viewer"), json={"document_ids": [item["id"]], "expected_hashes": {item["id"]: item["content_hash"]}, "include_drafts": True}).status_code == 403
            approve(client, token, item)
            corpus = asyncio.run(client.app.state.knowledge.frozen_corpus(settings.principals["owner"]))
            assert (item["id"] in {doc["doc_id"] for doc in corpus}) == (source_metadata == "stale_after: 2000-01-01")
        with sqlite3.connect(tmp_path / "runs.db") as database:
            assert database.execute("SELECT COUNT(*) FROM parameter_definitions WHERE tool='knowledge' AND variable_name LIKE 'okf_%'").fetchone()[0] == 9
            database.execute("UPDATE parameter_definitions SET default_value='false' WHERE tool='knowledge' AND variable_name='okf_export_enabled'")
        assert client.post(BASE + "/export", headers=token("owner"), json={"document_ids": [legacy["id"]], "expected_hashes": {legacy["id"]: legacy["content_hash"]}}).status_code == 403


def test_okf_minimal_concept_and_tampered_envelope_fail_review(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        raw = b"---\ntype: Unknown\n---\n"
        item = import_preview(client, token, raw, preview(client, token, raw)).json()["documents"][0]
        assert item["content"] == ""
        with sqlite3.connect(tmp_path / "runs.db") as database:
            envelope = dict(item["okf"])
            envelope["metadata"]["verified"] = [{"by": "human:forged"}]
            database.execute("UPDATE platform_knowledge SET okf=? WHERE doc_id=?", (json.dumps(envelope), item["id"]))
        assert review(client, token, item, "submit").status_code == 409
        async def assert_bundle_count():
            async with client.app.state.store.engine.connect() as connection:
                return len((await connection.execute(select(knowledge_okf_bundles))).all())
        assert asyncio.run(assert_bundle_count()) == 1


def test_okf_concurrent_new_import_commits_only_one_bundle(tmp_path):
    settings, token = settings_for(tmp_path)
    raw = b"---\ntype: Reference\n---\nCheckout timeout guidance."
    with TestClient(create_app(settings, connectors=connectors())) as client:
        plan = preview(client, token, raw)
        service = OKFService(client.app.state.knowledge)
        async def race():
            return await asyncio.gather(*(service.import_bundle(settings.principals["owner"], "guide.md", raw,
                preview_hash=plan["preview_hash"], expected_hashes={}, max_text_chars=100000) for _ in range(2)), return_exceptions=True)
        results = asyncio.run(race())
        assert sum(isinstance(result, dict) for result in results) == 1
        assert sum(isinstance(result, KnowledgeConflict) for result in results) == 1
        assert len(client.get("/api/v1/knowledge", headers=token("owner")).json()) == 1
        assert len(client.get(BASE + "/bundles", headers=token("owner")).json()) == 1
