"""Offline native ADK run fixture verifies saved visual/citation/API boundaries."""

import json

import pytest
from fastapi.testclient import TestClient
from google.genai import types

from app.fast_api_app import create_app
from tests.support import FixtureModel, connectors, settings_for
from tests.unit.test_visual_contract import visual_samples


class VisualFixtureModel(FixtureModel):
    invalid_visual: bool = False

    async def generate_content_async(self, llm_request, stream=False):
        async for response in super().generate_content_async(llm_request, stream):
            if self.stage == "synthesis":
                value = json.loads(response.content.parts[0].text)
                evidence_id = value["findings"][0]["evidence_ids"][0]
                if self.invalid_visual:
                    evidence_id = "ev_" + "0" * 32
                value["visuals"] = visual_samples(evidence_id)
                value["visuals"].append({"kind": "code", "id": "sequence", "title": "Recorded evidence flow",
                    "language": "mermaid", "code": "flowchart LR\n  Ticket --> Evidence\n", "basis": "inferred", "evidence_ids": [evidence_id]})
                response.content.parts = [types.Part.from_text(text=json.dumps(value))]
            yield response


@pytest.mark.parametrize("invalid", [False, True])
def test_native_visual_results_are_persisted_only_with_current_evidence(tmp_path, invalid):
    settings, token = settings_for(tmp_path, mode="live")
    def factory(stage, config):
        return VisualFixtureModel(model=config.model, stage=stage, invalid_visual=invalid)
    with TestClient(create_app(settings, connectors=connectors(), model_factory=factory)) as client:
        response = client.post("/api/v1/runs", headers=token(), json={"prompt": "Show source measurements and relationships", "incident_id": "SAMSON-101"})
        assert response.status_code == 200, response.text
        run = response.json()
        if invalid:
            assert run["status"] == "FAILED", run
            assert run["result"] is None
            return
        assert run["status"] in {"SUCCEEDED", "PARTIAL"}, run
        saved = client.get(f"/api/v1/runs/{run['run_id']}", headers=token()).json()
        assert saved["result"]["visuals"] == run["result"]["visuals"]
        assert len(saved["result"]["visuals"]) == 5
        assert saved["result"]["visuals"][4]["language"] == "mermaid"
        assert saved["result"]["visuals"][4]["code"] == "flowchart LR\n  Ticket --> Evidence\n"
        assert saved["result"]["visuals"][0]["points"][1]["value"] is None
        evidence = client.get(f"/api/v1/runs/{run['run_id']}/evidence", headers=token()).json()
        ids = {item["evidence_id"] for item in evidence}
        assert set(saved["result"]["visuals"][0]["points"][0]["evidence_ids"]).issubset(ids)
