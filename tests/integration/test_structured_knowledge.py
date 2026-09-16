"""Structured articles retain reviewed source lineage in the real knowledge harness."""

import asyncio
import json

from fastapi.testclient import TestClient
import pytest

from app.api.application import create_app
from tests.integration.test_knowledge_lifecycle import approve, draft, review
from tests.support import connectors, model_factory, settings_for


def article():
    return {
        "topic": "Checkout timeouts",
        "summary": "A reusable diagnostic procedure; it does not establish the current cause.",
        "blocks": [
            {"kind": "symptom", "title": "Observed symptom", "content": "Checkout requests exceed their deadline."},
            {"kind": "diagnostic", "title": "Read-only checks", "content": "Inspect pool saturation and cite current incident observations."},
            {"kind": "validation", "title": "Verify the result", "content": "Compare affected customer journeys before assigning a cause."},
        ],
    }


def test_structured_form_uses_canonical_content_and_rejects_forged_capture(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        payload = {"title": "Checkout topic", "content": "", "structure": article()}
        assert client.post("/api/v1/knowledge", json=payload).status_code == 401
        assert client.post("/api/v1/knowledge", headers=token("viewer"), json=payload).status_code == 403
        created = client.post("/api/v1/knowledge", headers=token("owner"), json=payload)
        assert created.status_code == 201, created.text
        item = created.json()
        assert item["structure"] == article()
        assert item["status"] == "draft"
        for block in article()["blocks"]:
            assert block["title"] in item["content"] and block["content"] in item["content"]
        assert review(client, token, item, "submit").status_code == 200
        assert review(client, token, item, "approve", "owner").status_code == 403
        assert review(client, token, item, "approve", "admin").status_code == 200

        changed_structure = article()
        changed_structure["blocks"][1]["content"] = "Inspect bounded connection-pool metrics."
        updated = client.put(f"/api/v1/knowledge/{item['id']}", headers=token("owner"), json={
            **payload, "structure": changed_structure, "expected_hash": item["content_hash"],
        })
        assert updated.status_code == 200, updated.text
        assert updated.json()["status"] == "draft" and updated.json()["revision"] == 2
        assert updated.json()["content_hash"] != item["content_hash"]
        assert "Inspect bounded connection-pool metrics." in updated.json()["content"]
        assert client.put(f"/api/v1/knowledge/{item['id']}", headers=token("owner"), json={
            **payload, "expected_hash": item["content_hash"],
        }).status_code == 409
        assert client.get("/api/v1/knowledge", headers=token("viewer")).json() == []

        for forbidden in ({"capture": {"source": {"kind": "document", "id": item["id"]}}},
                          {"tenant_id": "other-tenant"}, {"status": "approved"}):
            assert client.post("/api/v1/knowledge", headers=token("owner"), json=payload | forbidden).status_code == 422
        for invalid in ({**article(), "blocks": []}, {**article(), "topic": " "},
                        {**article(), "blocks": [{"kind": "diagnostic", "title": "Check", "content": "x" * 16001}]}):
            assert client.post("/api/v1/knowledge", headers=token("owner"), json=payload | {"structure": invalid}).status_code == 422


@pytest.mark.parametrize("source_change", ["edit", "revoke"])
def test_derived_capture_deduplicates_and_source_changes_remove_future_use(tmp_path, source_change):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        service = client.app.state.knowledge
        principal = settings.principals["owner"]
        source = approve(client, token, draft(client, token, associations={"capability_ids": ["attachment_review"]}))
        capture_source = {"kind": "document", "id": source["id"], "content_hash": source["content_hash"], "metadata": {}}

        def capture(source_ref=capture_source, actor=principal):
            return asyncio.run(service.ingest_capture(actor, source=source_ref, structure=article(),
                title="Reusable checkout knowledge", max_text_chars=32000,
                associations={"capability_ids": ["incident_triage"]}))

        captured = capture()
        assert captured["capture_outcome"] == "created" and captured["status"] == "draft"
        assert captured["associations"]["capability_ids"] == ["attachment_review"], "Capture cannot widen original source applicability"
        duplicate = capture()
        assert duplicate["capture_outcome"] == "unchanged" and duplicate["id"] == captured["id"]
        assert duplicate["content_hash"] == captured["content_hash"]
        with pytest.raises((ValueError, PermissionError, LookupError)):
            capture({**capture_source, "content_hash": "sha256:" + "0" * 64})
        with pytest.raises((ValueError, PermissionError, LookupError)):
            capture(actor=principal.model_copy(update={"project_id": "other-project"}))
        with pytest.raises(PermissionError):
            capture(actor=settings.principals["viewer"])
        edited = client.put(f"/api/v1/knowledge/{captured['id']}", headers=token("owner"), json={
            "title": captured["title"], "structure": article() | {"summary": "Human-reviewed diagnostic context."},
            "expected_hash": captured["content_hash"],
        })
        assert edited.status_code == 200, edited.text
        captured = capture()
        assert captured["capture_outcome"] == "unchanged" and captured["content_hash"] == edited.json()["content_hash"]
        assert captured["structure"]["summary"] == "Human-reviewed diagnostic context."
        captured = approve(client, token, captured)
        with pytest.raises(ValueError):
            capture({**capture_source, "id": captured["id"], "content_hash": captured["content_hash"]})
        assert any(item["id"] == captured["id"] for item in client.get("/api/v1/knowledge", headers=token("viewer")).json())
        assert asyncio.run(service.frozen_corpus(principal, document_ids=[captured["id"]]))
        export_payload = {"document_ids": [captured["id"]], "expected_hashes": {captured["id"]: captured["content_hash"]}, "format": "markdown"}
        exported = client.post("/api/v1/knowledge/okf/export", headers=token("viewer"), json=export_payload)
        assert exported.status_code == 200, exported.text
        run = client.post("/api/v1/runs", headers=token("viewer"), json={
            "capability": "attachment_review", "prompt": "Explain the reusable checkout guidance.",
            "knowledge_document_ids": [captured["id"]],
        })
        assert run.status_code == 200 and run.json()["status"] == "SUCCEEDED", run.text
        evidence_url = f"/api/v1/runs/{run.json()['run_id']}/evidence"
        evidence = client.get(evidence_url, headers=token("viewer")).json()
        captured_evidence = next(item for item in evidence if json.loads(item["query_json"]).get("doc_id") == captured["id"])
        assert json.loads(captured_evidence["query_json"])["content_hash"] == captured["content_hash"]

        if source_change == "edit":
            changed = client.put(f"/api/v1/knowledge/{source['id']}", headers=token("owner"), json={
                "title": source["title"], "content": "Corrected checkout guidance.", "expected_hash": source["content_hash"],
            })
            assert changed.status_code == 200, changed.text
        else:
            assert review(client, token, source, "revoke", "admin").status_code == 200
        assert all(item["id"] != captured["id"] for item in client.get("/api/v1/knowledge", headers=token("viewer")).json())
        with pytest.raises(PermissionError):
            asyncio.run(service.relevant(principal, "checkout", max_items=3, max_chars=1000,
                capability="attachment_review", document_ids=[captured["id"]]))
        with pytest.raises(ValueError):
            asyncio.run(service.frozen_corpus(principal, document_ids=[captured["id"]]))
        assert client.post("/api/v1/knowledge/okf/export", headers=token("viewer"), json=export_payload).status_code in {403, 409}
        assert client.get(evidence_url, headers=token("viewer")).json() == evidence

        if source_change == "edit":
            new_source = approve(client, token, changed.json())
            newer = capture({**capture_source, "content_hash": new_source["content_hash"]})
            assert newer["capture_outcome"] == "created" and newer["status"] == "draft"
            assert newer["id"] != captured["id"], "Source updates must not overwrite a reviewed derived article"
