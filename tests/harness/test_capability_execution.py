"""New capability contracts select real source branches through authenticated runs."""

import pytest
from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from tests.support import connectors, model_factory, settings_for
from tests.harness.test_architecture_flow import configured_app


@pytest.mark.parametrize(
    "capability,expected_stages,evidence_count",
    [
        ("ticket_review", {"orchestrator", "triage", "synthesis"}, 1),
        ("incident_timeline", {"orchestrator", "triage", "logs", "synthesis"}, 2),
        ("attachment_review", {"orchestrator", "extraction", "synthesis"}, 1),
    ],
)
def test_capability_executes_only_its_sources(
    tmp_path, capability, expected_stages, evidence_count
):
    stages = []

    def factory(stage, config):
        stages.append(stage)
        return model_factory(stage, config)

    settings, token = settings_for(tmp_path, mode="live")
    app = create_app(settings, connectors=connectors(), model_factory=factory)
    with TestClient(app) as client:
        request = {
            "capability": capability,
            "prompt": "Review the supplied evidence",
            "incident_id": "SAMSON-101",
        }
        if capability == "attachment_review":
            upload = client.post(
                "/api/v1/files",
                headers=token(),
                files={
                    "files": (
                        "incident.txt",
                        b"2026-09-11T10:15:00Z timeout",
                        "text/plain",
                    )
                },
            )
            assert upload.status_code == 201, upload.text
            request["attachment_ids"] = [
                upload.json()["attachments"][0]["attachment_id"]
            ]
        response = client.post("/api/v1/runs", headers=token(), json=request)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "SUCCEEDED", result
        assert result["evidence_count"] == evidence_count
        assert set(stages) == expected_stages


@pytest.mark.parametrize(
    "capability,status,expected_stages",
    [
        ("ticket_review", "SUCCEEDED", {"orchestrator", "triage", "synthesis"}),
        ("incident_timeline", "SUCCEEDED", {"orchestrator", "triage", "synthesis"}),
        ("attachment_review", "PARTIAL", {"orchestrator", "synthesis"}),
    ],
)
def test_capabilities_handle_disabled_optional_source(
    tmp_path, capability, status, expected_stages
):
    stages = []

    def factory(stage, config):
        stages.append(stage)
        return model_factory(stage, config)

    app, token = configured_app(
        tmp_path, {"disabled_connectors": ["log_search"]}, factory=factory
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/runs",
            headers=token(),
            json={
                "capability": capability,
                "prompt": "Review evidence",
                "incident_id": "SAMSON-101",
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == status, response.json()
        assert set(stages) == expected_stages
        if capability == "attachment_review":
            assert response.json()["result"]["outcome"] == "INSUFFICIENT_EVIDENCE"
