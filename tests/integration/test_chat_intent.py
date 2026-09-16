"""Natural requests use approved metadata, preserve history, and enter real ADK runs."""

import asyncio
import sqlite3

from sqlalchemy import update

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.persistence.chat_messages import list_messages, messages, save_exchange
from app.persistence.store import InvestigationStore
from app.runtime.intent import IntentResolution
from tests.integration.test_skill_catalog import approve, reviewed_settings, skill_input
from tests.integration.test_knowledge_lifecycle import approve as approve_knowledge, draft
from tests.support import connectors, model_factory, settings_for


def chat(client, token, actor="viewer"):
    response = client.post("/api/v1/chats", headers=token(actor))
    assert response.status_code == 201, response.text
    return response.json()["chat_id"]


def resolve(client, token, chat_id, prompt, actor="viewer", **extra):
    response = client.post("/api/v1/chat/resolve", headers=token(actor),
                           json={"chat_id": chat_id, "prompt": prompt, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_natural_questions_select_narrow_catalog_workflows_and_native_execution(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        chat_id = chat(client, token)
        for prompt, expected in (
            ("Review ticket SAMSON-101", "ticket_review"),
            ("Run RCA on ticket SAMSON-101", "ticket_review"),
            ("Update me on ticket SAMSON-101", "ticket_review"),
            ("Create a summary of ticket SAMSON-101", "ticket_review"),
            ("Build the timeline for SAMSON-101", "incident_timeline"),
            ("Find error spikes in Splunk logs", "log_correlation"),
        ):
            result = resolve(client, token, chat_id, prompt)
            assert result["status"] == "ready" and result["capability"] == expected, result
            assert result["exchange_id"] is None
        prompt = "Review ticket SAMSON-101"
        selected = resolve(client, token, chat_id, prompt)
        run = client.post("/api/v1/runs?stream=true", headers=token("viewer"), json={
            "chat_id": chat_id, "prompt": prompt, "capability": selected["capability"],
        })
        assert run.status_code == 200 and "event: complete" in run.text, run.text
        history = client.get(f"/api/v1/chats/{chat_id}/runs", headers=token("viewer")).json()
        assert history[0]["status"] == "SUCCEEDED"
        assert history[0]["evidence_count"] > 0
        follow_up = resolve(client, token, chat_id, "What should the team verify next?")
        assert follow_up["reason_code"] == "conversation_follow_up"
        assert follow_up["capability"] == "ticket_review"
        different_source = resolve(client, token, chat_id, "Now find errors in Splunk logs")
        assert different_source["capability"] == "log_correlation"
        assert client.get(f"/api/v1/chats/{chat_id}/messages", headers=token("viewer")).json() == []


def test_clarifications_persist_without_fake_runs_and_are_owned_paginated_redacted(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        chat_id = chat(client, token)
        first = resolve(client, token, chat_id, "Hello password=private-value")
        assert first["status"] == "clarification" and first["capability"] is None
        assert first["choices"] and first["message_id"]
        assert all(choice["prompt"] == "Hello password=[REDACTED]" for choice in first["choices"])
        assert [choice["capability"] for choice in first["choices"]] == [
            "incident_triage", "ticket_review", "log_correlation", "attachment_review"]
        second = resolve(client, token, chat_id, "Please delete the ticket SAMSON-101")
        assert second["status"] == "unsupported" and second["choices"] == []
        url = f"/api/v1/chats/{chat_id}/messages"
        messages = client.get(url, headers=token("viewer")).json()
        assert [item["role"] for item in messages] == ["user", "assistant", "user", "assistant"]
        assert messages[1]["id"] == first["message_id"]
        assert "private-value" not in str(messages) and "[REDACTED]" in messages[0]["content"]
        latest = client.get(url, headers=token("viewer"), params={"limit": 2}).json()
        assert latest == messages[2:]
        assert client.get(url, headers=token("viewer"), params={"before": latest[0]["sequence"]}).json() == messages[:2]
        assert client.get(url, headers=token("viewer"), params={"limit": 101}).status_code == 422
        assert client.get(url, headers=token("admin")).status_code == 404
        assert client.post("/api/v1/chat/resolve", headers=token("admin"), json={"chat_id": chat_id, "prompt": "Hello"}).status_code == 404
        assert client.get(f"/api/v1/chats/{chat_id}/runs", headers=token("viewer")).json() == []
        listed = client.get("/api/v1/chats", headers=token("viewer")).json()
        assert listed[0]["title"] == "Please delete the ticket SAMSON-101"
    with TestClient(create_app(settings)) as client:
        assert client.get(url, headers=token("viewer")).json() == messages
    with sqlite3.connect(tmp_path / "runs.db") as database:
        assert database.execute("SELECT count(*) FROM runs").fetchone()[0] == 0


def test_owned_upload_references_survive_clarification_and_cannot_cross_conversations(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        uploaded = client.post("/api/v1/files", headers=token("viewer"),
                               files={"files": ("incident.txt", b"Timeout observed")}).json()
        chat_id = uploaded["chat_id"]
        ids = [uploaded["attachments"][0]["attachment_id"]]
        local = resolve(client, token, chat_id, "Summarize the attached file", attachment_ids=ids)
        assert local["capability"] == "attachment_review" and local["attachment_ids"] == ids
        assert resolve(client, token, chat_id, "Summarize the logs in this file", attachment_ids=ids)["capability"] == "attachment_review"
        result = resolve(client, token, chat_id, "Inspect the Jira incident", attachment_ids=ids)
        assert result["status"] == "clarification" and result["reason_code"] == "incident_reference_required"
        saved = client.get(f"/api/v1/chats/{chat_id}/messages", headers=token("viewer")).json()
        assert all(item["attachment_ids"] == ids for item in saved)
        other = chat(client, token)
        rejected = client.post("/api/v1/chat/resolve", headers=token("viewer"), json={
            "chat_id": other, "prompt": "Summarize", "attachment_ids": ids,
        })
        assert rejected.status_code == 403
        assert client.get(f"/api/v1/chats/{other}/messages", headers=token("viewer")).json() == []


def test_only_reviewed_skill_metadata_can_extend_intent_selection(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        chat_id = chat(client, token)
        question = "Explain merchant reconciliation"
        created = client.post("/api/v1/skills", headers=token("admin"), json=skill_input(
            id="merchant-reconciliation", name="Merchant---reconciliation", description="Explain merchant reconciliation evidence.",
            capabilities=["attachment_review"], actions=[],
        )).json()
        assert resolve(client, token, chat_id, question)["status"] == "clarification"
        assert approve(client, token, created).status_code == 200
        result = resolve(client, token, chat_id, question)
        assert result["status"] == "ready" and result["capability"] == "attachment_review", result
        revoked = client.post("/api/v1/skills/merchant-reconciliation/revoke", headers=token("reviewer"), json={
            "expected_hash": created["content_hash"], "reason": "Guidance is no longer applicable.",
        })
        assert revoked.status_code == 200, revoked.text
        assert resolve(client, token, chat_id, question)["status"] == "clarification"


def test_approved_knowledge_can_answer_without_external_sources(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, model_factory=model_factory)) as client:
        chat_id = chat(client, token)
        document = draft(client, token)
        question = "What does the checkout timeout runbook recommend?"
        assert resolve(client, token, chat_id, question)["reason_code"] != "approved_project_knowledge"
        approve_knowledge(client, token, document)
        selected = resolve(client, token, chat_id, question)
        assert selected["reason_code"] == "approved_project_knowledge"
        result = client.post("/api/v1/runs", headers=token("viewer"), json={
            "chat_id": chat_id, "prompt": question, "capability": selected["capability"],
        })
        assert result.status_code == 200 and result.json()["status"] == "SUCCEEDED", result.text
        evidence = client.get(f"/api/v1/runs/{result.json()['run_id']}/evidence", headers=token("viewer")).json()
        assert len(evidence) == 1 and evidence[0]["source"]["connector"] == "knowledge"
        ordinary = resolve(client, token, chat_id, "What should I do about checkout timeouts?")
        assert ordinary["reason_code"] == "approved_project_knowledge"


def test_explicit_knowledge_selects_its_authorized_local_capability(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, model_factory=model_factory)) as client:
        registry = client.app.state.registry
        capability = registry.get("attachment_review").model_copy(update={"id": "scoped_guidance"})
        registry._capabilities[capability.id] = capability
        document = approve_knowledge(client, token, draft(client, token, associations={"capability_ids": [capability.id]}))
        chat_id = chat(client, token)
        result = resolve(client, token, chat_id, "Explain this guidance", knowledge_document_ids=[document["id"]])
        assert result["capability"] == capability.id
        assert result["reason_code"] == "approved_project_knowledge"
        rejected = client.post("/api/v1/chat/resolve", headers=token("viewer"), json={
            "chat_id": chat_id, "prompt": "Explain this guidance", "knowledge_document_ids": ["unavailable"],
        })
        assert rejected.status_code == 403


def test_missing_connection_uses_real_blocked_run_and_no_invented_answer(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, model_factory=model_factory)) as client:
        chat_id = chat(client, token)
        prompt = "Review ticket SAMSON-101"
        selected = resolve(client, token, chat_id, prompt)
        assert selected["status"] == "ready"
        result = client.post("/api/v1/runs", headers=token("viewer"), json={
            "chat_id": chat_id, "prompt": prompt, "capability": selected["capability"],
        })
        assert result.status_code == 200 and result.json()["status"] == "BLOCKED", result.text
        assert result.json()["evidence_count"] == 0
        assert not result.json()["result"]


def test_retention_cleanup_removes_only_selected_project_conversation_turns(tmp_path):
    settings, _ = settings_for(tmp_path)

    async def exercise():
        store = InvestigationStore(settings.database_url.get_secret_value())
        await store.initialize()
        try:
            principals = [settings.principals["viewer"], settings.principals["viewer"].model_copy(update={"project_id": "other"})]
            chats = []
            for principal in principals:
                conversation = await store.create_chat(principal)
                chats.append(conversation["chat_id"])
                await save_exchange(store, principal, conversation["chat_id"], "What can I inspect?",
                    IntentResolution(status="clarification", message="Choose evidence to inspect.", reason_code="intent_unclear", catalog_hash="sha256:" + "0" * 64))
            async with store.engine.begin() as connection:
                await connection.execute(update(messages).values(created_at=0))
            assert await store.delete_expired(86400, scope=("acme", "payments")) == 2
            assert await list_messages(store, principals[0], chats[0]) == []
            assert len(await list_messages(store, principals[1], chats[1])) == 2
        finally:
            await store.aclose()

    asyncio.run(exercise())
