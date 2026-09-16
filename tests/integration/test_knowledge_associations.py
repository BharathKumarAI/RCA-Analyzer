"""Reviewed scope and required references survive edits and revocation."""

import asyncio
import json

from fastapi.testclient import TestClient
import pytest

from app.api.application import create_app
from app.configuration.models import EnvironmentConfig, ProjectLayer
from tests.integration.test_knowledge_lifecycle import approve, draft, review
from tests.support import connectors, model_factory, settings_for


def test_knowledge_scope_selection_required_revision_and_api_contract(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        principal = settings.principals["owner"]
        layers = client.app.state.registry.inheritance
        project = layers.project(principal) or ProjectLayer(tenant_id=principal.tenant_id, project_id=principal.project_id)
        layers.projects[(principal.tenant_id, principal.project_id)] = project.model_copy(update={
            "environments": (EnvironmentConfig(id="production"), EnvironmentConfig(id="staging")),
        })
        scopes = client.get("/api/v1/knowledge/scopes", headers=token("owner")).json()
        assert {item["id"] for item in scopes["environment_ids"]} == {"production", "staging"}
        bad = client.post("/api/v1/knowledge", headers=token("owner"), json={
            "title": "Unknown scope", "content": "Never accepted.", "associations": {"environment_ids": ["another-project"]},
        })
        assert bad.status_code == 422
        association = {"capability_ids": ["attachment_review"], "environment_ids": ["production"], "required": True}
        item = draft(client, token, associations=association)
        service = client.app.state.knowledge
        assert asyncio.run(service.required_readiness(principal, "attachment_review", environment_ids=["production"])) == []
        item = approve(client, token, item)
        assert item["required_associations"]["required"] is True
        assert asyncio.run(service.relevant(principal, "checkout", max_items=3, max_chars=1000, capability="attachment_review", environment_ids=["staging"])) == []
        with pytest.raises(PermissionError):
            asyncio.run(service.relevant(principal, "checkout", max_items=3, max_chars=1000, capability="attachment_review", environment_ids=["staging"], document_ids=[item["id"]]))
        # An explicit selection is used even when its title/content has no query keywords.
        run = client.post("/api/v1/runs", headers=token("viewer"), json={
            "capability": "attachment_review", "prompt": "Explain the guidance", "environment_id": "production", "knowledge_document_ids": [item["id"]],
        })
        assert run.status_code == 200, run.text
        assert run.json()["status"] == "SUCCEEDED", run.text
        evidence = client.get(f"/api/v1/runs/{run.json()['run_id']}/evidence", headers=token("viewer")).json()
        assert json.loads(evidence[0]["query_json"])["content_hash"] == item["content_hash"]
        changed = client.put(f"/api/v1/knowledge/{item['id']}", headers=token("owner"), json={
            "title": item["title"], "content": "Updated guidance", "expected_hash": item["content_hash"], "associations": {},
        })
        assert changed.status_code == 200, changed.text
        updated = changed.json()
        assert updated["required_associations"] == item["required_associations"]
        assert asyncio.run(service.required_readiness(principal, "attachment_review", environment_ids=["production"]))
        blocked = client.post("/api/v1/runs", headers=token("viewer"), json={
            "capability": "attachment_review", "prompt": "Review guidance", "environment_id": "production",
        })
        assert blocked.status_code == 409
        # Only independently approving removal of the requirement releases the capability.
        approved = approve(client, token, updated)
        assert approved["required_associations"] is None
        assert review(client, token, approved, "revoke", "admin").status_code == 200
        assert asyncio.run(service.required_readiness(principal, "attachment_review", environment_ids=["production"])) == []
