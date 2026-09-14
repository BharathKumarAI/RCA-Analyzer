"""Project policy visibility and previews use the actual runtime redactor."""

import tempfile

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.policy.redaction import redact
from tests.support import connectors, settings_for


def test_project_redaction_reports_enforcement_and_previews_without_echo():
    with tempfile.TemporaryDirectory() as directory:
        settings, token = settings_for(directory)
        with TestClient(create_app(settings, connectors=connectors())) as client:
            assert client.get("/api/v1/project/redaction").status_code == 401
            policy = client.get("/api/v1/project/redaction", headers=token("analyst"))
            assert policy.status_code == 200
            data = policy.json()
            assert data["project_id"] == settings.project_id
            assert data["enabled"] and not data["editable"]
            assert data["custom_rules_enforced"] is False
            text = "password=confidential user@example.org Bearer private-token"
            response = client.post("/api/v1/project/redaction/preview", headers=token("analyst"), json={"text": text})
            assert response.status_code == 200
            result = response.json()
            assert result["redacted_text"] == redact(text)
            assert result["policy_id"] == data["policy_id"]
            assert result["changed"] and not result["truncated"]
            assert "confidential" not in response.text
            assert client.post("/api/v1/project/redaction/preview", headers=token("analyst"), json={"text": "x", "project_id": "other"}).status_code == 422
            assert client.post("/api/v1/project/redaction/preview", headers=token("analyst"), json={"text": "x" * 32001}).status_code == 422


def test_project_deep_link_returns_shell_with_security_headers():
    with tempfile.TemporaryDirectory() as directory:
        settings, _ = settings_for(directory)
        with TestClient(create_app(settings, connectors=connectors())) as client:
            response = client.get("/p/project_1/configuration?environment=prod")
            assert response.status_code == 200
            assert "text/html" in response.headers["content-type"]
            assert response.headers["x-frame-options"] == "DENY"
