"""Methodology analysis reuses native governed runs and shares only their real results."""

import json

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.api.application import create_app
from app.persistence.store import runs
from app.persistence.triage import investigation_events, triage_investigations
from tests.support import connectors, model_factory, settings_for


def test_methodology_runs_are_scoped_cited_persisted_and_idempotent(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        author = token("admin")
        analyst = token("analyst")
        chat_id = client.post("/api/v1/chats", headers=author).json()["chat_id"]
        source = client.post("/api/v1/runs", headers=author, json={
            "prompt": "Investigate SAMSON-101. PRIVATE-ORIGINAL-CONTEXT", "incident_id": "SAMSON-101",
            "capability": "incident_triage", "chat_id": chat_id})
        assert source.status_code == 200, source.text
        source_id = source.json()["run_id"]
        assert client.post(f"/api/v1/triage/runs/{source_id}/import", headers=author).status_code == 200
        endpoint = "/api/v1/triage/tickets/SAMSON-101/rca"
        assert client.get(endpoint, headers=analyst).json()["analyses"] == {}
        assert client.get(f"/api/v1/chats/{chat_id}/runs", headers=analyst).status_code == 404
        assert client.post(endpoint, headers=token("viewer"), json={"method": "five_whys"}).status_code == 403
        assert client.post(endpoint, json={"method": "five_whys"}).status_code == 401
        assert client.post(endpoint, headers=analyst, json={"method": "arbitrary"}).status_code == 422
        assert client.post("/api/v1/triage/tickets/OTHER-1/rca", headers=analyst,
                           json={"method": "five_whys"}).status_code == 404

        recorded = {}
        for method in ("five_whys", "fishbone", "kepner_tregoe", "fmea", "fault_tree", "auto_ensemble"):
            headers = analyst | {"Idempotency-Key": f"methodology-{method}"}
            response = client.post(endpoint, headers=headers, json={"method": method})
            assert response.status_code == 200, response.text
            analysis = response.json()
            recorded[method] = {key: value for key, value in analysis.items() if key != "method"}
            assert analysis["method"] == method and analysis["status"] == "SUCCEEDED"
            assert analysis["run_id"] != source_id
            evidence = client.get(f"/api/v1/runs/{analysis['run_id']}/evidence", headers=analyst).json()
            actual = {item["evidence_id"] for item in evidence}
            assert actual and all(set(finding["evidence_ids"]) <= actual for finding in analysis["result"]["findings"])
            assert client.post(endpoint, headers=headers, json={"method": method}).json() == analysis
        assert client.post(endpoint, headers=analyst | {"Idempotency-Key": "methodology-five_whys"},
                           json={"method": "fmea"}).status_code == 409
        workspace = client.get(endpoint, headers=analyst).json()
        assert workspace["analyses"] == recorded
        assert set(workspace["available_methods"]) == set(recorded)
        assert workspace["five_whys"]["steps"] == []  # Legacy structures never fabricate an alternate result.

        async def inspect_records():
            async with client.app.state.store.engine.connect() as connection:
                rows = (await connection.execute(select(investigation_events).where(
                    investigation_events.c.event_type == "investigation.methodology"))).mappings().all()
                contract = json.loads(await connection.scalar(select(runs.c.contract_json).where(
                    runs.c.run_id == recorded["five_whys"]["run_id"])))
            assert len(rows) == 6
            assert all(row["tenant_id"] == settings.tenant_id and row["project_id"] == settings.project_id for row in rows)
            assert contract["principal"]["subject"] == "analyst"
            assert contract["capability"] == "incident_triage"
            assert contract["request"]["chat_id"] is None
            assert contract["request"]["attachment_ids"] == []
            assert "PRIVATE-ORIGINAL-CONTEXT" not in contract["request"]["text"]
            assert "five whys" in contract["request"]["text"]
        client.portal.call(inspect_records)

        # A second real run replaces only the chosen method's latest projection.
        later = client.post(endpoint, headers=analyst, json={"method": "five_whys"})
        assert later.status_code == 200
        updated = client.get(endpoint, headers=analyst).json()["analyses"]
        assert updated["five_whys"]["run_id"] == later.json()["run_id"] != recorded["five_whys"]["run_id"]
        assert updated["fmea"] == recorded["fmea"]


def test_methodology_rejects_unavailable_sources_and_reports_blocked_run(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("admin")
        source = client.post("/api/v1/runs", headers=headers, json={
            "prompt": "Investigate SAMSON-101", "incident_id": "SAMSON-101", "capability": "incident_triage"})
        source_id = source.json()["run_id"]
        assert client.post(f"/api/v1/triage/runs/{source_id}/import", headers=headers).status_code == 200
        endpoint = "/api/v1/triage/tickets/SAMSON-101/rca"

        async def change_source(**values):
            async with client.app.state.store.engine.begin() as connection:
                await connection.execute(update(runs).where(runs.c.run_id == source_id).values(**values))

        async def saved_contract():
            async with client.app.state.store.engine.connect() as connection:
                return await connection.scalar(select(runs.c.contract_json).where(runs.c.run_id == source_id))

        original_contract = client.portal.call(saved_contract)

        async def change_source_id(value):
            async with client.app.state.store.engine.begin() as connection:
                await connection.execute(update(triage_investigations).where(
                    triage_investigations.c.ticket_id == "SAMSON-101").values(auto_triage_run_id=value))

        for source_id_value in (None, "run_missing"):
            client.portal.call(change_source_id, source_id_value)
            assert client.post(endpoint, headers=headers, json={"method": "five_whys"}).status_code == 409
        client.portal.call(change_source_id, source_id)
        for values in ({"status": "FAILED"}, {"status": "SUCCEEDED", "project_id": "other-project"},
                       {"project_id": settings.project_id, "contract_json": "{}"}):
            client.portal.call(lambda: change_source(**values))
            assert client.post(endpoint, headers=headers, json={"method": "five_whys"}).status_code == 409
        demo_contract = {**json.loads(original_contract), "mode": "demo"}
        client.portal.call(lambda: change_source(contract_json=json.dumps(demo_contract)))
        assert client.post(endpoint, headers=headers, json={"method": "five_whys"}).status_code == 409
        client.portal.call(lambda: change_source(contract_json=original_contract))
        client.app.state.runner.connectors = {}
        blocked = client.post(endpoint, headers=headers, json={"method": "five_whys"})
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["detail"]["status"] == "BLOCKED"
        assert blocked.json()["detail"]["run_id"] != source_id
        assert client.get(endpoint, headers=headers).json()["analyses"] == {}
