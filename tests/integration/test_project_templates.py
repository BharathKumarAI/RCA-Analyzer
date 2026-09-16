"""Template API -> persisted project -> Harness -> native ADK run contract."""
import json
import sqlite3

import yaml
from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import candidate_receipt, connectors, model_factory, settings_for


def test_template_application_harness_execution_conflicts_and_restart(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    template_path = "/api/v1/project-templates/investigation/1.0.0"
    body = {"name": "Investigation", "status": "published", "expected_revision": 0,
            "definition": {"harness": {}, "workflow": {"planning": False},
                           "limits": {"max_llm_calls": 12}}}
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("admin")
        assert client.put(template_path, headers=token("owner"), json=body).status_code == 403
        invalid = body | {"definition": body["definition"] | {"tenant_id": "another"}}
        assert client.put(template_path, headers=headers, json=invalid).status_code == 422
        saved = client.put(template_path, headers=headers, json=body)
        assert saved.status_code == 200, saved.text
        template = saved.json()
        unbound_workspace = client.get("/api/v1/harness/workspace", headers=headers).json()
        catalog = next(n for n in unbound_workspace["graph"]["nodes"] if n["id"] == "project-template")
        assert catalog["details"]["templates"][0]["checksum"] == template["checksum"]
        assert client.put(template_path, headers=headers, json=body).status_code == 409
        state = client.get("/api/v1/project-templates/binding", headers=headers).json()
        payload = {"expected_template_revision": template["revision"],
                   "expected_template_checksum": template["checksum"],
                   "expected_project_revision": state["project_revision"],
                   "expected_harness_revision": state["harness_revision"]}
        applied = client.post(template_path + "/apply", headers=token("owner"), json=payload)
        assert applied.status_code == 200, applied.text
        assert applied.json()["status"] == "SYNCED"
        assert client.post(template_path + "/apply", headers=headers, json=payload).status_code == 409
        setup = client.get("/api/v1/project/setup", headers=headers).json()
        assert setup["project_template"]["status"] == "SYNCED"
        assert setup["runtime"]["workflow"]["planning"] is False
        workspace = client.get("/api/v1/harness/workspace", headers=headers).json()
        projection = next(n for n in workspace["graph"]["nodes"] if n["id"] == "project-template")
        assert projection["details"]["binding"]["template_checksum"] == template["checksum"]
        assert "request_orchestrator" not in {n["id"] for n in workspace["graph"]["nodes"]}
        assert any(e["target"] == "project-template" for e in workspace["graph"]["edges"])
        forged = dict(setup["project_layer"])
        forged["project_template"] = forged["project_template"] | {"applied_by": "forged"}
        assert client.post("/api/v1/project/setup", headers=headers,
                           json={"yaml": yaml.safe_dump(forged)}).status_code == 422
        run = client.post("/api/v1/runs", headers=token("analyst"),
                          json={"prompt": "Investigate INC-1", "incident_id": "INC-1"})
        assert run.status_code == 200, run.text
        assert run.json()["status"] == "SUCCEEDED", run.text
        with sqlite3.connect(tmp_path / "runs.db") as db:
            stored = db.execute("SELECT contract_json FROM runs WHERE run_id=?", (run.json()["run_id"],)).fetchone()
        snapshot = json.loads(json.loads(stored[0])["model_config_json"])
        assert snapshot["project_template"]["template_checksum"] == template["checksum"]
        assert snapshot["workflow"]["planning"] is False
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("admin")
        assert client.get("/api/v1/project-templates/binding", headers=headers).json()["status"] == "SYNCED"
        candidate = {"yaml": "workflow:\n  planning: true\n"}
        candidate["candidate_run_id"] = candidate_receipt(client, headers, candidate)
        edit = client.post("/api/v1/project/setup", headers=headers, json=candidate)
        assert edit.status_code == 200, edit.text
        assert edit.json()["project_template"]["status"] == "DRIFTED"
        upgraded = client.put("/api/v1/project-templates/investigation/2.0.0", headers=headers,
            json=body | {"definition": {"harness": {}, "workflow": {"planning": True}}}).json()
        current = client.get("/api/v1/project-templates/binding", headers=headers).json()
        updated = client.post("/api/v1/project-templates/investigation/2.0.0/apply", headers=headers,
            json={"expected_template_revision": upgraded["revision"],
                  "expected_template_checksum": upgraded["checksum"],
                  "expected_project_revision": current["project_revision"],
                  "expected_harness_revision": current["harness_revision"]})
        assert updated.status_code == 200, updated.text
        assert updated.json()["status"] == "SYNCED"
        assert updated.json()["binding"]["template_version"] == "2.0.0"


def test_shared_controls_rebuild_native_clients_and_harness_matches(tmp_path, monkeypatch):
    from app.identity.principals import Role, UserPrincipal
    for name, value in {
        "JIRA_BASE_URL": "https://jira.example.test", "JIRA_PROJECT_KEY": "TEST",
        "JIRA_USER_EMAIL": "service@example.test", "JIRA_API_TOKEN": "test-token",
        "SPLUNK_HOST": "https://splunk.example.test", "SPLUNK_INDEX": "test",
        "SPLUNK_TOKEN": "test-token",
    }.items():
        monkeypatch.setenv(name, value)
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings)) as client:
        headers = token("admin")
        initial = client.app.state.runner.connectors["log_search"]
        parameters = client.get("/api/v1/parameters?view=template", headers=headers).json()
        row = next(r for r in parameters if r["tool"] == "log_search" and r["variable_name"] == "max_results")
        saved = client.put("/api/v1/parameters/log_search/template", headers=headers,
                          json={"changes": {"max_results": {"value": 23, "expected_revision": row["revision"]}}})
        assert saved.status_code == 200, saved.text
        principal = UserPrincipal(subject="admin", username="admin", tenant_id=settings.tenant_id,
                                  project_id=settings.project_id, roles=(Role.PLATFORM_ADMIN,))
        providers, created = client.portal.call(client.app.state.runner._connectors_for_run,
                                                principal, {"log_search"}, {"log_search"})
        try:
            assert providers["log_search"].max_results == 23
            assert providers["log_search"] is not initial
            assert initial.max_results != 23
            assert providers["log_search"].index == initial.index
            workspace = client.get("/api/v1/harness/workspace", headers=headers).json()
            node = next(n for n in workspace["graph"]["nodes"] if n["id"] == "parameter:log_search.max_results")
            assert node["details"]["effective_value"] == 23
            assert node["details"]["execution_consumers"]
            assert any(e["target"] == node["id"] for e in workspace["graph"]["edges"])
            secret_nodes = [n for n in workspace["graph"]["nodes"] if n["kind"] == "parameter"
                            and n["details"]["value_type"] == "secret_ref"]
            assert secret_nodes
            assert all(n["details"]["effective_value"] is None for n in secret_nodes)
        finally:
            for provider in created:
                client.portal.call(provider.aclose)


def test_harness_masks_sensitive_parameter_values():
    from app.configuration.harness_workspace import HarnessWorkspaceService
    row = {"value_type": "string", "project_visible": True}
    for sensitivity in ("masked", "secret_reference"):
        assert HarnessWorkspaceService._safe_parameter_value(
            row, "protected", [{"sensitivity": sensitivity}],
        ) == (None, True)
