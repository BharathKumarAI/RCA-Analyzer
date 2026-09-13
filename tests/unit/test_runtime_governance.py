"""Harness boundaries exercised with real SQLite persistence and native ADK inputs."""

import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest
import pytest_asyncio
from google.adk.models.llm_request import LlmRequest
from google.genai import types
from fastapi.testclient import TestClient

from app.identity.principals import Role, UserPrincipal
from app.persistence.run_events import RunEventStore
from app.persistence.store import InvestigationStore
from app.policy.engine import PolicyEngine
from app.runtime.context import ContextLimitExceeded, evidence_context, fit_evidence, request_size
from app.runtime.governance import RunGovernance
from app.runtime.run_contract import InvestigationResult, RunContract, RunRequest
from app.fast_api_app import create_app
from tests.support import connectors, model_factory, settings_for


@pytest_asyncio.fixture
async def governance(tmp_path):
    store = InvestigationStore(f"sqlite+aiosqlite:///{tmp_path / 'runs.db'}")
    await store.initialize()
    principal = UserPrincipal(subject="analyst", username="analyst", tenant_id="tenant",
                              project_id="project", roles=(Role.PROJECT_ANALYST,))
    chat = await store.create_chat(principal)
    contract = RunContract(
        tenant_id=principal.tenant_id, project_id=principal.project_id, principal=principal,
        request=RunRequest(text="Investigate", chat_id=chat["chat_id"]),
        capability="incident_triage", capability_version="1", capability_hash="sha256:cap",
        policy_hash="sha256:policy", model_profile="standard", model_config_json="{}",
        data_scope="tenant:tenant/project:project", mode="live",
    )
    await store.create_run(contract, None, "request", 9999999999)
    settings = SimpleNamespace(max_evidence_items=2, max_evidence_chars=12000, max_context_chars=4000)
    gov = RunGovernance(contract, SimpleNamespace(allowed_actions=("itsm.get_ticket",)),
                        PolicyEngine(), store, settings, 20)
    gov.run_events = RunEventStore(store.engine)
    await gov.run_events.initialize()
    yield gov
    await store.aclose()


@pytest.mark.asyncio
async def test_parallel_capture_enforces_persisted_limit(governance):
    gov = governance
    results = await asyncio.gather(*(
        gov.capture("itsm", "get_ticket", {"attempt": n}, {"attempt": n}) for n in range(12)
    ), return_exceptions=True)
    assert sum(isinstance(r, dict) for r in results) == 2
    assert sum(isinstance(r, PermissionError) for r in results) == 10
    assert len(await gov.store.list_by_run(gov.contract.run_id, gov.contract.principal)) == 2
    assert gov._pending_evidence == 0


@pytest.mark.asyncio
async def test_success_event_references_saved_evidence(governance):
    gov = governance
    tool = SimpleNamespace(name="get_ticket")
    ctx = SimpleNamespace(function_call_id="call-1", state={})
    await gov.before_tool(tool, {}, ctx)
    result = await gov.after_tool(tool, {}, ctx, {"status": "Open"})
    events = await gov.run_events.list(gov.contract.run_id, gov.contract.principal)
    assert [e["kind"] for e in events] == ["tool_started", "tool_completed"]
    assert events[-1]["details"]["call_id"] == "call-1"
    assert events[-1]["details"]["result"]["evidence_id"] == result["evidence_id"]
    assert await gov.store.get(result["evidence_id"], gov.contract.principal)
    assert not gov.tool_started


@pytest.mark.asyncio
async def test_error_then_after_callback_has_only_one_terminal_event(governance):
    gov = governance
    tool = SimpleNamespace(name="get_ticket")
    ctx = SimpleNamespace(function_call_id="call-1", state={})
    await gov.before_tool(tool, {}, ctx)
    response = await gov.on_tool_error(tool, {}, ctx, ValueError("password=private"))
    await gov.after_tool(tool, {}, ctx, response)
    events = await gov.run_events.list(gov.contract.run_id, gov.contract.principal)
    assert [e["kind"] for e in events] == ["tool_started", "tool_failed"]
    assert events[-1]["details"]["call_id"] == "call-1"
    assert events[-1]["details"]["duration_ms"] >= 0
    assert "private" not in str(events)
    assert not gov.evidence and not gov.tool_started


@pytest.mark.asyncio
async def test_failed_save_releases_capacity_and_never_reports_success(governance):
    gov = governance
    tool = SimpleNamespace(name="get_ticket")
    ctx = SimpleNamespace(function_call_id="call-1", state={})
    await gov.before_tool(tool, {}, ctx)
    await gov.store.update_run(gov.contract.run_id, gov.contract.principal, status="CANCELLED")
    with pytest.raises(PermissionError):
        await gov.after_tool(tool, {}, ctx, {"status": "Open"})
    events = await gov.run_events.list(gov.contract.run_id, gov.contract.principal)
    assert events[-1]["kind"] == "tool_failed"
    assert gov._pending_evidence == 0
    assert not gov.evidence and not gov.tool_started


@pytest.mark.asyncio
async def test_cancel_closes_each_pending_call_once(governance):
    gov = governance
    for call_id in ("call-1", "call-2"):
        await gov.before_tool(SimpleNamespace(name="get_ticket"), {},
                              SimpleNamespace(function_call_id=call_id, state={}))
    await asyncio.gather(gov.finish_pending_tools(cancelled=True),
                         gov.finish_pending_tools(cancelled=True))
    await gov.finish_pending_tools(cancelled=True)
    events = await gov.run_events.list(gov.contract.run_id, gov.contract.principal)
    ended = [e for e in events if e["kind"] == "tool_cancelled"]
    assert {e["details"]["call_id"] for e in ended} == {"call-1", "call-2"}
    assert len(ended) == 2 and not gov.tool_started


def test_context_retains_sources_and_is_independent_of_completion_order():
    evidence = [
        {"evidence_id": "ev_a", "source": "attachments", "data": {"text": "文" * 8000}},
        {"evidence_id": "ev_b", "source": "itsm", "data": {"status": "Open"}},
        {"evidence_id": "ev_c", "source": "log_search", "data": {"text": "error" * 8000}},
    ]
    context = evidence_context(evidence, [], 1400)
    assert len(context) <= 1400
    assert context == evidence_context(list(reversed(evidence)), [], 1400)
    parsed = json.loads(context)
    assert {i["source"] for i in parsed["evidence"]} == {i["source"] for i in evidence}
    assert parsed["truncated"]


def test_full_request_budget_counts_schema_history_and_system_instructions():
    request = LlmRequest(
        contents=[types.Content(role="user", parts=[types.Part(text="User history " * 50)])],
        config=types.GenerateContentConfig(
            system_instruction="Required rules. Evidence: MARKER", response_schema=InvestigationResult,
            tools=[types.Tool(function_declarations=[types.FunctionDeclaration(name="read", description="Read evidence")])],
        ),
    )
    original = request.config.system_instruction
    contexts = {"MARKER": [{"evidence_id": "ev_a", "source": "itsm", "data": {"text": "x" * 8000}}]}
    fitted, projections = fit_evidence(request, contexts, [], 3000)
    assert request_size(fitted) <= 3000
    assert fitted.config.system_instruction.startswith("Required rules.")
    assert fitted.contents == request.contents
    assert request.config.system_instruction == original
    assert projections[0]["truncated"]
    with pytest.raises(ContextLimitExceeded):
        fit_evidence(request, contexts, [], 100)


@pytest.mark.asyncio
async def test_chat_context_is_bounded_owner_scoped_and_not_new_evidence(governance):
    gov = governance
    result = InvestigationResult(outcome="INSUFFICIENT_EVIDENCE", summary="Earlier investigation needs more evidence.")
    await gov.store.update_run(gov.contract.run_id, gov.contract.principal, status="PARTIAL", result=result)
    next_contract = gov.contract.model_copy(update={"created_at": gov.contract.created_at + 100})
    notes = await gov.store.chat_context(next_contract, 1000)
    assert len(notes) == 1 and notes[0]["run_id"] == gov.contract.run_id
    assert notes[0]["historical"] and "evidence_ids" not in notes[0]
    assert len(json.dumps(notes, ensure_ascii=False)) <= 1000
    assert await gov.store.chat_context(next_contract.model_copy(update={"capability_hash": "changed"}), 1000) == []
    assert await gov.store.chat_context(next_contract.model_copy(update={
        "model_config_json": json.dumps({"disabled_connectors": ["itsm"]})
    }), 1000) == []
    for changed in ({"subject": "other"}, {"tenant_id": "other"}, {"project_id": "other"}):
        with pytest.raises(PermissionError):
            await gov.store.chat_context(next_contract.model_copy(update={
                "principal": gov.contract.principal.model_copy(update=changed)
            }), 1000)


def test_native_followup_freezes_history_and_keeps_citations_in_current_run(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings.model_copy(update={"mode": "live"}),
                               connectors=connectors(), model_factory=model_factory)) as client:
        chat_id = client.post("/api/v1/chats", headers=token()).json()["chat_id"]
        first = client.post("/api/v1/runs", headers=token(), json={
            "prompt": "Investigate timeouts", "incident_id": "SAMSON-101", "chat_id": chat_id,
        }).json()
        second = client.post("/api/v1/runs", headers=token(), json={
            "prompt": "Check those errors again", "incident_id": "SAMSON-101", "chat_id": chat_id,
        }).json()
        assert first["status"] == second["status"] == "SUCCEEDED"
        evidence = client.get(f"/api/v1/runs/{second['run_id']}/evidence", headers=token()).json()
        assert set(second["result"]["findings"][0]["evidence_ids"]) <= {e["evidence_id"] for e in evidence}
    with sqlite3.connect(tmp_path / "runs.db") as db:
        raw = db.execute("SELECT contract_json FROM runs WHERE run_id = ?", (second["run_id"],)).fetchone()[0]
    history = json.loads(json.loads(raw)["model_config_json"])["chat_history"]
    assert [note["run_id"] for note in history] == [first["run_id"]]


def test_native_context_overflow_reports_specific_failure(tmp_path):
    settings, token = settings_for(tmp_path)
    settings = settings.model_copy(update={"mode": "live", "max_context_chars": 1000})
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        run = client.post("/api/v1/runs", headers=token(), json={"prompt": "Investigate"}).json()
    assert run["status"] == "FAILED"
    assert run["stage"] == "context_limit"
