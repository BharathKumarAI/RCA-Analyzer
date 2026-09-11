"""The actual native ADK graph uses the resolved tool set and persists it."""

import json
import shutil
import sqlite3

from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from app.settings import CONTENT_ROOT
from tests.support import connectors, model_factory, settings_for
from tests.harness.test_approved_execution import SOURCE


def test_filtered_tools_apply_to_native_and_approved_agents(tmp_path):
    bundle = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, bundle)
    (bundle / "layers/projects/payments.yaml").write_text(
        "tenant_id: acme\nproject_id: payments\nskills:\n"
        "  log-correlation:\n    enabled: false\n"
    )
    settings, token = settings_for(tmp_path, mode="live")
    settings = settings.model_copy(
        update={"content_root": bundle, "config_dir": bundle / "config"}
    )
    stages = []

    def factory(stage, config):
        stages.append(stage)
        return model_factory(stage, config)

    with TestClient(
        create_app(settings, connectors=connectors(), model_factory=factory)
    ) as client:
        draft = client.post(
            "/api/v1/agent-configurations",
            headers=token("owner"),
            json={
                "yaml": SOURCE.replace("tools: []", "tools: [log_search.query_range]")
            },
        )
        assert draft.status_code == 201
        draft = draft.json()
        approval = client.post(
            f"/api/v1/agent-configurations/{draft['draft_id']}/approve",
            headers=token("admin"),
            json={"expected_hash": draft["content_hash"], "reason": "Reviewed"},
        )
        assert approval.status_code == 200
        response = client.post(
            "/api/v1/runs",
            headers=token(),
            json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "PARTIAL", result
        assert result["evidence_count"] == 1
        assert "logs" not in stages and "specialist" not in stages
        assert any("specialist" in text for text in result["result"]["uncertainties"])
    with sqlite3.connect(tmp_path / "runs.db") as db:
        columns = [row[1] for row in db.execute("PRAGMA table_info(runs)")]
        row = db.execute(
            "SELECT * FROM runs WHERE run_id = ?", (result["run_id"],)
        ).fetchone()
        record = dict(zip(columns, row))
        contract = json.loads(record["contract_json"])
        snapshot = json.loads(contract["model_config_json"])
        assert snapshot["allowed_actions"] == ["itsm.get_ticket"]
        assert snapshot["skill_resolution"]["log-correlation"]["enabled"] is False
