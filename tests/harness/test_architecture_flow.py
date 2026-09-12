"""Resolved architecture controls the public API and native ADK execution."""

import json
import shutil
import sqlite3

import pytest
import yaml
from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from app.settings import CONTENT_ROOT
from tests.support import connectors, model_factory, settings_for


def configured_app(tmp_path, project, user=None, factory=model_factory, providers=None):
    bundle = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, bundle)
    (bundle / "layers/projects/project.yaml").write_text(
        yaml.safe_dump(
            {
                "tenant_id": "acme",
                "project_id": "payments",
                **project,
            }
        )
    )
    if user:
        (bundle / "layers/users/analyst.yaml").write_text(
            yaml.safe_dump(
                {
                    "tenant_id": "acme",
                    "project_id": "payments",
                    "subject": "analyst",
                    **user,
                }
            )
        )
    settings, token = settings_for(tmp_path, mode="live")
    settings = settings.model_copy(
        update={"content_root": bundle, "config_dir": bundle / "config"}
    )
    return create_app(
        settings,
        connectors=providers if providers is not None else connectors(),
        model_factory=factory,
    ), token


def snapshot(directory, run_id):
    with sqlite3.connect(directory / "runs.db") as db:
        row = db.execute(
            "SELECT contract_json FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        contract = json.loads(row[0])
        return contract, json.loads(contract["model_config_json"])


def test_effective_discovery_native_execution_and_snapshot_agree(tmp_path):
    stages, instructions, probes = [], [], []
    providers = connectors()
    original_probe = providers["log_search"].probe_health

    async def probe():
        probes.append("log_search")
        return await original_probe()

    providers["log_search"].probe_health = probe

    def factory(stage, config):
        stages.append((stage, config.model))
        delegate = model_factory(stage, config)
        # Capture instructions passed to the model, without testing subjective output quality.
        original = delegate.generate_content_async

        async def capture(request, stream=False):
            instructions.append(str(request.config.system_instruction))
            async for result in original(request, stream=stream):
                yield result

        object.__setattr__(delegate, "generate_content_async", capture)
        return delegate

    app, token = configured_app(
        tmp_path,
        {
            "disabled_connectors": ["log_search"],
            "capabilities": {
                "incident_triage": {"model_profile": "fast-investigation"}
            },
            "workflow": {
                "planning": False,
                "specialists": False,
                "parallel_evidence": False,
            },
            "limits": {
                "max_llm_calls": 4,
                "max_tool_calls": 1,
                "run_timeout_seconds": 30,
            },
            "preferences": {"detail": "concise"},
            "allow_user_preferences": ["presentation"],
        },
        {"preferences": {"presentation": "timeline"}},
        factory,
        providers,
    )
    with TestClient(app) as client:
        assert app.state.runner.platform is app.state.platform
        assert app.state.runner.profiles is app.state.configurations.profiles
        assert app.state.optimizations.registry is app.state.registry
        config = client.get("/api/v1/config", headers=token()).json()
        assert config["execution"]["max_llm_calls"] == 4
        assert config["preferences"] == {
            "detail": "concise",
            "presentation": "timeline",
        }
        assert (
            client.get("/api/v1/config", headers=token("owner")).json()["preferences"][
                "presentation"
            ]
            == "summary"
        )
        capabilities = client.get("/api/v1/capabilities", headers=token()).json()
        assert {cap["id"] for cap in capabilities} == {
            "attachment_review",
            "incident_timeline",
            "incident_triage",
            "ticket_review",
            "confluence_review", "signalfx_review", "qtest_review", "gitlab_review",
            "oracle_review", "kafka_review", "unix_review", "kubernetes_review",
        }
        triage_capability = next(
            cap for cap in capabilities if cap["id"] == "incident_triage"
        )
        assert triage_capability["permissions"]["allowed_actions"] == [
            "itsm.get_ticket"
        ]
        assert triage_capability["model_profile"] == "fast-investigation"
        health = client.get("/api/v1/connectors/health", headers=token()).json()
        assert health["disabled"] == ["log_search"]
        response = client.post(
            "/api/v1/runs",
            headers=token(),
            json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "SUCCEEDED", result
        assert result["evidence_count"] == 1
        assert stages == [
            ("triage", "gemini-3.5-flash-lite"),
            ("synthesis", "gemini-3.5-flash-lite"),
        ]
        assert any(
            '"presentation": "timeline"' in text and '"detail": "concise"' in text
            for text in instructions
        )
        assert probes == []
    contract, resolved = snapshot(tmp_path, result["run_id"])
    assert contract["model_profile"] == "fast-investigation"
    assert resolved["tool_call_limit"] == 1
    assert resolved["limits"]["max_llm_calls"] == 4
    assert resolved["limits"]["run_timeout_seconds"] == 30
    assert resolved["preferences"]["presentation"] == "timeline"
    assert not resolved["workflow"]["planning"]
    assert (
        resolved["allowed_actions"]
        == triage_capability["permissions"]["allowed_actions"]
    )


def test_attachment_restriction_precedes_multipart_parsing_and_run_lookup(tmp_path):
    app, token = configured_app(tmp_path, {"workflow": {"attachments": False}})
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/files",
            headers={**token(), "Content-Type": "multipart/form-data"},
            content=b"malformed multipart",
        )
        assert response.status_code == 403
        response = client.post(
            "/api/v1/runs",
            headers=token(),
            json={"prompt": "Investigate", "attachment_ids": ["not-owned"]},
        )
        assert response.status_code == 403


def test_project_model_budget_is_enforced(tmp_path):
    stages = []

    def factory(stage, config):
        stages.append(stage)
        return model_factory(stage, config)

    app, token = configured_app(
        tmp_path, {"limits": {"max_llm_calls": 1}}, factory=factory
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/runs",
            headers=token(),
            json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "FAILED"
        assert response.json()["evidence_count"] == 0
        _, resolved = snapshot(tmp_path, response.json()["run_id"])
        assert resolved["max_llm_calls"] == 1


def test_startup_failure_closes_injected_providers(tmp_path):
    providers = connectors()
    closed = []
    for name, provider in providers.items():
        original = provider.aclose

        async def close(name=name, original=original):
            closed.append(name)
            await original()

        provider.aclose = close
    settings, _ = settings_for(tmp_path)
    settings = settings.model_copy(
        update={
            "database_url": settings.database_url.__class__("unsupported://database")
        }
    )
    with pytest.raises(Exception):
        with TestClient(create_app(settings, connectors=providers)):
            pass
    assert sorted(closed) == ["itsm", "log_search"]
