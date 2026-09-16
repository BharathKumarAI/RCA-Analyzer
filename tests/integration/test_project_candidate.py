"""Candidate tests use native ADK and local verification-only model/providers."""

import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.application import create_app
from app.configuration.models import EnvironmentConfig, ProjectLayer
from app.persistence.store import runs
from tests.integration.test_knowledge_lifecycle import approve, draft, review
from tests.support import connectors, model_factory, settings_for


def test_candidate_trial_is_isolated_idempotent_and_required_before_apply(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("owner")
        before = client.get("/api/v1/project/setup", headers=headers).json()
        candidate = {"yaml": "prompts:\n  triage: Cite the recorded ticket evidence.\n", "expected_project_revision": before["project_revision"]}
        assert client.post("/api/v1/project/setup", headers=headers, json=candidate).status_code == 409
        body = candidate | {"run": {"capability": "incident_triage", "prompt": "Investigate SAMSON-101", "incident_id": "SAMSON-101"}}
        assert client.post("/api/v1/project/test", headers=token("viewer"), json=body).status_code == 403
        registry = client.app.state.runner.registry
        tested = client.post("/api/v1/project/test", headers=headers | {"Idempotency-Key": "candidate-once"}, json=body)
        assert tested.status_code == 200, tested.text
        result = tested.json()
        assert result["receipt"]["passed"], result
        run_id = result["run"]["run_id"]
        assert client.app.state.runner.registry is registry
        assert not client.app.state.runner.tasks and not client.app.state.runner._run_connectors
        assert client.app.state.runner.run_limiter._value == client.app.state.runner._run_limit
        assert client.get("/api/v1/project/setup", headers=headers).json()["project_revision"] == before["project_revision"]
        duplicate = client.post("/api/v1/project/test", headers=headers | {"Idempotency-Key": "candidate-once"}, json=body)
        assert duplicate.json()["run"]["run_id"] == run_id

        async def snapshot():
            async with client.app.state.store.engine.connect() as connection:
                value = await connection.scalar(select(runs.c.contract_json).where(runs.c.run_id == run_id))
            return json.loads(json.loads(value)["model_config_json"])

        frozen = client.portal.call(snapshot)
        assert frozen["prompts"]["triage"] == "Cite the recorded ticket evidence."
        assert frozen["project_candidate"]["candidate_hash"] == result["receipt"]["candidate_hash"]
        apply = candidate | {"candidate_run_id": run_id}
        assert client.post("/api/v1/project/setup", headers=token("admin"), json=apply).status_code == 409
        assert client.post("/api/v1/project/setup", headers=headers, json=apply | {"yaml": "prompts:\n  triage: Different content\n"}).status_code == 409
        saved = client.post("/api/v1/project/setup", headers=headers, json=apply)
        assert saved.status_code == 200, saved.text
        assert saved.json()["project_layer"]["prompts"]["triage"] == "Cite the recorded ticket evidence."
        assert client.post("/api/v1/project/setup", headers=headers, json=apply).status_code == 409


def test_candidate_dependencies_and_simulation_cannot_satisfy_apply_gate(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("owner")
        candidate = {"yaml": "preferences:\n  presentation: table\n"}
        partial = client.post("/api/v1/project/test", headers=headers, json=candidate | {"run": {
            "capability": "attachment_review", "prompt": "Review available evidence",
        }})
        assert partial.status_code == 200 and partial.json()["run"]["status"] == "PARTIAL", partial.text
        assert not partial.json()["receipt"]["passed"]
        assert client.post("/api/v1/project/setup", headers=headers, json=candidate | {"candidate_run_id": partial.json()["run"]["run_id"]}).status_code == 409
        body = candidate | {"run": {"capability": "incident_triage", "prompt": "Investigate SAMSON-101", "incident_id": "SAMSON-101"}}
        tested = client.post("/api/v1/project/test", headers=headers, json=body)
        assert tested.status_code == 200 and tested.json()["receipt"]["passed"], tested.text
        changed = client.post("/api/v1/knowledge", headers=headers, json={"title": "New guidance", "content": "Source guidance must be reviewed."})
        assert changed.status_code == 201, changed.text
        apply = candidate | {"candidate_run_id": tested.json()["run"]["run_id"]}
        stale = client.post("/api/v1/project/setup", headers=headers, json=apply)
        assert stale.status_code == 409 and "dependencies changed" in stale.text
        client.app.state.runner.settings = client.app.state.runner.settings.model_copy(update={"mode": "demo"})
        simulated = client.post("/api/v1/project/test", headers=headers, json=body)
        assert simulated.status_code == 200, simulated.text
        assert simulated.json()["run"]["status"] == "SIMULATED" and not simulated.json()["receipt"]["passed"]
        assert client.post("/api/v1/project/setup", headers=headers, json=candidate | {"candidate_run_id": simulated.json()["run"]["run_id"]}).status_code == 409


def test_candidate_admission_checks_all_required_scopes_and_allows_safety_disable(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        principal = settings.principals["owner"]
        layers = client.app.state.registry.inheritance
        project = layers.project(principal) or ProjectLayer(tenant_id=principal.tenant_id, project_id=principal.project_id)
        layers.projects[(principal.tenant_id, principal.project_id)] = project.model_copy(update={"environments": (EnvironmentConfig(id="production", name="Production"),)})
        required = approve(client, token, draft(client, token, associations={
            "capability_ids": ["attachment_review"], "environment_ids": ["production"], "required": True,
        }))
        headers = token("owner")
        body = {"yaml": "preferences:\n  presentation: table\n", "run": {
            "capability": "incident_triage", "prompt": "Investigate SAMSON-101", "incident_id": "SAMSON-101",
        }}
        removed = client.post("/api/v1/project/test", headers=headers, json=body)
        assert removed.status_code == 409 and "environment being removed" in removed.text
        assert review(client, token, required, "revoke", "admin").status_code == 200
        body["yaml"] += "environments:\n  - id: production\n    name: Production\n"
        unavailable = client.post("/api/v1/project/test", headers=headers, json=body)
        assert unavailable.status_code == 409 and "Required knowledge" in unavailable.text, unavailable.text
        path = "/api/v1/project/availability/capabilities/attachment_review"
        disabled = client.put(path, headers=headers, json={"enabled": False, "expected_enabled": True})
        assert disabled.status_code == 200, disabled.text
        enabled = client.put(path, headers=headers, json={"enabled": True, "expected_enabled": False})
        assert enabled.status_code == 409 and "Required knowledge" in enabled.text
