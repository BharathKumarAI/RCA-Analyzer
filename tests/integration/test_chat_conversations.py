"""The chat entry uses persisted, owner-scoped questions and native ADK runs."""

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, model_factory, settings_for


def test_chat_keeps_questions_citations_and_owner_isolation(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("viewer")
        conversation = client.post("/api/v1/chats", headers=headers).json()
        chat_id = conversation["chat_id"]
        questions = [
            "Review SAMSON-101. What happened to checkout? Keep it short.",
            "What should the team verify before changing the service?",
        ]
        for question in questions:
            result = client.post("/api/v1/runs?stream=true", headers=headers, json={
                "capability": "incident_triage", "chat_id": chat_id, "prompt": question,
            })
            assert result.status_code == 200, result.text
            assert "event: run\n" in result.text and "event: complete\n" in result.text
        history = client.get(f"/api/v1/chats/{chat_id}/runs", headers=headers).json()
        assert [run["prompt"] for run in history] == list(reversed(questions))
        for run in history:
            assert run["status"] == "SUCCEEDED"
            evidence = client.get(f"/api/v1/runs/{run['run_id']}/evidence", headers=headers).json()
            actual = {item["evidence_id"] for item in evidence}
            assert actual
            assert all(set(finding["evidence_ids"]).issubset(actual) for finding in run["result"]["findings"])
        listed = client.get("/api/v1/chats", headers=headers).json()
        assert listed[0]["title"] == questions[-1]
        assert client.get("/api/v1/chats", headers=token("admin")).json() == []
        assert client.get(f"/api/v1/chats/{chat_id}/runs", headers=token("admin")).status_code == 404
        assert client.get(f"/api/v1/chats/{chat_id}/runs").status_code == 401
    # Reopening the application preserves the conversation and original question.
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        assert client.get("/api/v1/chats", headers=token("viewer")).json()[0]["chat_id"] == chat_id
