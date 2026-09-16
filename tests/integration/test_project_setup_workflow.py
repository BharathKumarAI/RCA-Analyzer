"""Draft setup and runtime application use actual scoped stores and revision guards."""
import tempfile

import yaml
from starlette.testclient import TestClient

from app.api.application import create_app
from tests.support import candidate_receipt, model_factory, settings_for


def test_setup_draft_validation_and_stale_application():
    with tempfile.TemporaryDirectory() as directory:
        settings, token = settings_for(directory, mode="live")
        with TestClient(create_app(settings, model_factory=model_factory)) as client:
            headers = token("admin")
            setup = client.get("/api/v1/project/setup", headers=headers).json()
            initial_revision = setup["project_revision"]
            document = {"metadata": {"id": settings.project_id, "name": ""}}
            save = client.put("/api/v1/project/editor", headers=headers,
                              json={"document": document, "expected_version": 0})
            assert save.status_code == 200
            assert client.get("/api/v1/project/setup", headers=headers).json()["project_revision"] == initial_revision
            candidate = {"yaml": yaml.safe_dump({"prompts": {"triage": "Review the incident evidence."}}),
                         "expected_project_revision": initial_revision, "expected_editor_version": 1}
            assert client.post("/api/v1/project/validate", headers=headers, json=candidate).status_code == 422
            assert client.post("/api/v1/project/setup", headers=headers, json=candidate).status_code == 422
            assert client.put("/api/v1/project/editor", headers=headers,
                              json={"document": {"metadata": {"id": "another-project"}}, "expected_version": 1}).status_code == 422
            assert client.put("/api/v1/project/editor", headers=headers,
                              json={"document": {"metadata": {"timezone": "invalid/zone"}}, "expected_version": 1}).status_code == 422
            users = client.get("/api/v1/users", headers=headers).json()
            owner = next(user for user in users if user["status"] == "active")
            document = {"metadata": {"id": settings.project_id, "name": "Incident response", "objective": "Investigate incidents", "timezone": "UTC", "responsibility": ["Root Cause Analysis"]},
                        "projectScope": {"members": {"owners": [{"id": owner["id"]}]}}}
            assert client.put("/api/v1/project/editor", headers=headers,
                              json={"document": document, "expected_version": 1}).status_code == 200
            assert client.post("/api/v1/project/setup", headers=headers, json=candidate).status_code == 409
            candidate["expected_editor_version"] = 2
            validation = client.post("/api/v1/project/validate", headers=headers, json=candidate)
            assert validation.status_code == 200, validation.text
            assert validation.json()["valid"], validation.text
            candidate["candidate_run_id"] = candidate_receipt(client, headers, candidate)
            applied = client.post("/api/v1/project/setup", headers=headers, json=candidate)
            assert applied.status_code == 200, applied.text
            assert applied.json()["project_revision"] != initial_revision
            assert applied.json()["project_layer"]["prompts"]["triage"] == "Review the incident evidence."
            assert client.post("/api/v1/project/setup", headers=headers, json=candidate).status_code == 409
            assert client.get("/api/v1/project/editor", headers=headers).json()["document"] == document
            assert client.post("/api/v1/project/setup", headers=token("viewer"), json=candidate).status_code == 403
