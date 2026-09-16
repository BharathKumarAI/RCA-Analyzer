"""Unit tests for PRISM SLA engine and Live Triage Board persistence."""

import pytest
from types import SimpleNamespace
from sqlalchemy.ext.asyncio import create_async_engine

from app.runtime.sla_engine import (
    compute_ticket_sla_state,
    rank_focus_queue,
    format_duration,
)
from app.persistence.triage import TriageStore
from tests.triage_support import create_triage_case

SLA_TARGETS = {"P1": 1800.0, "P2": 7200.0, "P3": 28800.0, "P4": 86400.0}


def test_format_duration():
    assert format_duration(60) == "1m"
    assert format_duration(3600) == "1h"
    assert format_duration(3660) == "1h 1m"
    assert format_duration(-720) == "-12m"
    assert format_duration(-4320) == "-1h 12m"


def test_sla_calculation_breached():
    now = 100000.0
    ticket = {
        "ticket_id": "RS-177053",
        "priority": "P1",  # Target: 1800s (30m)
        "work_state": "NEW",
        "created_at": now - 5000.0,
        "assignee": None,
    }
    # One active stay of 4320s (1h 12m)
    stays = [
        {"stay_id": "s1", "ticket_id": "RS-177053", "entered_at": now - 4320.0, "exited_at": None, "accountable_duration": 0.0}
    ]
    sla = compute_ticket_sla_state(ticket, stays, now=now, sla_targets=SLA_TARGETS)
    assert sla["priority"] == "P1"
    assert sla["sla_target_seconds"] == 1800.0
    assert sla["sla_consumed_seconds"] == 4320.0
    assert sla["sla_remaining_seconds"] == -2520.0  # Breached by 42m
    assert sla["risk_state"] == "BREACHED"
    assert "breached by 42m" in sla["explanation"]
    assert "unassigned; action required" in sla["explanation"]


def test_sla_calculation_returned_ticket():
    now = 100000.0
    ticket = {
        "ticket_id": "RS-176248",
        "priority": "P1",
        "work_state": "RETURNED",
        "created_at": now - 6000.0,
        "assignee": None,
    }
    stays = [
        # Stay 1: 1200s
        {"stay_id": "s1", "ticket_id": "RS-176248", "entered_at": now - 5000.0, "exited_at": now - 3800.0, "accountable_duration": 1200.0},
        # Stay 2 (Active): 540s (9m) ago, returned from Core NetOps
        {"stay_id": "s2", "ticket_id": "RS-176248", "entered_at": now - 540.0, "exited_at": None, "accountable_duration": 0.0, "previous_team": "Core NetOps"},
    ]
    sla = compute_ticket_sla_state(ticket, stays, now=now, sla_targets=SLA_TARGETS)
    assert sla["is_returned"] is True
    assert sla["sla_consumed_seconds"] == 1740.0  # 1200 + 540
    assert sla["sla_remaining_seconds"] == 60.0    # 1800 - 1740 = 60s remaining
    assert sla["risk_state"] == "AT_RISK"
    assert "returned to triage from Core NetOps" in sla["explanation"]
    assert "SLA risk: 1m remaining" in sla["explanation"]


def test_deterministic_focus_ranking():
    now = 100000.0
    # Ticket 1: Breached P1
    t1 = {"ticket_id": "T1", "priority": "P1", "work_state": "NEW", "assignee": None}
    sla1 = compute_ticket_sla_state(t1, [{"entered_at": now - 4000.0, "exited_at": None}], now=now, sla_targets=SLA_TARGETS)

    # Ticket 2: At-risk P1 (1m remaining)
    t2 = {"ticket_id": "T2", "priority": "P1", "work_state": "RETURNED", "assignee": None}
    sla2 = compute_ticket_sla_state(t2, [{"entered_at": now - 1740.0, "exited_at": None}], now=now, sla_targets=SLA_TARGETS)

    # Ticket 3: Healthy P2 (1h 30m remaining)
    t3 = {"ticket_id": "T3", "priority": "P2", "work_state": "IN_TRIAGE", "assignee": "Mike R."}
    sla3 = compute_ticket_sla_state(t3, [{"entered_at": now - 1800.0, "exited_at": None}], now=now, sla_targets=SLA_TARGETS)

    ranked = rank_focus_queue([
        {"ticket": t3, "sla": sla3},
        {"ticket": t1, "sla": sla1},
        {"ticket": t2, "sla": sla2},
    ])

    order = [item["ticket"]["ticket_id"] for item in ranked]
    assert order == ["T1", "T2", "T3"], f"Expected T1 (breached), T2 (at-risk), T3 (healthy), got {order}"


@pytest.mark.asyncio
async def test_triage_store_flow():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    store = TriageStore(engine)
    await store.initialize()

    # Seed data
    await create_triage_case(store.engine, "tenant-test", "proj-test")

    # List tickets
    tickets = await store.list_tickets("tenant-test", "proj-test")
    assert len(tickets) == 1

    # Get specific ticket
    t = await store.get_ticket("tenant-test", "proj-test", "TEST-1")
    assert t is not None
    assert t["summary"] == "Test incident"

    # Get stays
    stays = await store.get_queue_stays("tenant-test", "proj-test", "TEST-1")
    assert len(stays) >= 1

    # Get investigation
    inv = await store.get_investigation("tenant-test", "proj-test", "TEST-1")
    assert inv is not None

    # Get tool proposals
    props = await store.get_tool_proposals("tenant-test", "proj-test", inv["investigation_id"])
    assert len(props) == 1

    # Edit proposal
    p0 = props[0]
    updated = await store.update_tool_proposal_query(
        "tenant-test",
        "proj-test",
        p0["proposal_id"],
        "index=billing error | head 10",
        actor_id="Sarah J.",
    )
    assert updated["current_query"] == "index=billing error | head 10"
    assert updated["status"] == "EDITED"

    # Acknowledge
    ack = await store.acknowledge_ticket("tenant-test", "proj-test", "TEST-1", "Sarah J.")
    assert ack["owner"] == "Sarah J."

    # Escalate
    esc = await store.escalate_ticket("tenant-test", "proj-test", "TEST-1", "Billing Platform", "Sarah J.")
    assert esc["current_team"] == "Billing Platform"
    assert esc["work_state"] == "APP_TEAM"

    # Return
    ret = await store.return_ticket_to_triage("tenant-test", "proj-test", "TEST-1", "Billing Platform", "Devin C.")
    assert ret["work_state"] == "RETURNED"

    await engine.dispose()


def test_missing_sla_policy_is_unknown():
    state = compute_ticket_sla_state({"ticket_id": "TEST-1", "priority": "P1"}, [], now=1000)
    assert state["risk_state"] == "UNKNOWN"
    assert state["sla_target_seconds"] is None
    assert state["sla_remaining_seconds"] is None


@pytest.mark.asyncio
async def test_triage_queue_transitions_pause_resume_and_do_not_duplicate():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    store = TriageStore(engine)
    await store.initialize()
    await create_triage_case(store.engine, "tenant", "project")
    await store.update_ticket_stage("tenant", "project", "TEST-1", "WAITING")
    assert all(stay["exited_at"] is not None for stay in await store.get_queue_stays("tenant", "project", "TEST-1"))
    await store.return_ticket_to_triage("tenant", "project", "TEST-1", "Service team", "analyst")
    await store.return_ticket_to_triage("tenant", "project", "TEST-1", "Service team", "analyst")
    stays = await store.get_queue_stays("tenant", "project", "TEST-1")
    assert len(stays) == 2
    assert sum(stay["exited_at"] is None for stay in stays) == 1
    await store.update_ticket_stage("tenant", "project", "TEST-1", "RESOLVED")
    assert all(stay["exited_at"] is not None for stay in await store.get_queue_stays("tenant", "project", "TEST-1"))
    with pytest.raises(ValueError, match="Ticket not found"):
        await store.acknowledge_ticket("tenant", "other-project", "TEST-1", "analyst")
    await engine.dispose()


def test_sla_parameter_rejects_invalid_targets():
    from app.configuration.parameters import ParameterStore
    for value in ({"P1": 0}, {"P1": True}, {"P1": float("inf")}, {"P1": "3600"}, []):
        with pytest.raises(ValueError, match="SLA targets"):
            ParameterStore.runtime_value("triage", "sla_targets_seconds", value)
    ParameterStore.runtime_value("triage", "sla_targets_seconds", {"P1": 3600})


@pytest.mark.asyncio
async def test_proposal_edits_invalidate_results_and_parameter_changes_reject_inflight_completion():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    store = TriageStore(engine)
    await store.initialize()
    await create_triage_case(store.engine, "tenant", "project")
    query = "Inspect recorded service evidence. " * 20
    await store.update_tool_proposal_query("tenant", "project", "test-proposal", query,
                                           parameters={"connector_selections": {}})
    result = {"run_id": "run-test", "items": [{"evidence_id": "ev-recorded"}]}
    with pytest.raises(ValueError, match="changed during execution"):
        await store.record_tool_execution("tenant", "project", "test-proposal", result, "analyst",
                                          expected_query=query, expected_parameters={"connector_selections": {"itsm": {"instance_id": "old"}}})
    await store.record_tool_execution("tenant", "project", "test-proposal", result, "analyst",
                                      expected_query=query, expected_parameters={"connector_selections": {}})
    first = await store.promote_result_to_evidence("tenant", "project", "test-proposal", "Recorded evidence", "analyst")
    second = await store.promote_result_to_evidence("tenant", "project", "test-proposal", "Recorded evidence", "analyst")
    assert first == second and first["query_ref"] == "run-test"
    edited = await store.update_tool_proposal_query("tenant", "project", "test-proposal", "Changed investigation")
    assert edited["latest_result"] is None
    with pytest.raises(ValueError, match="execution result not found"):
        await store.promote_result_to_evidence("tenant", "project", "test-proposal", "Stale evidence", "analyst")
    await engine.dispose()


@pytest.mark.asyncio
async def test_import_preserves_source_timestamps_and_local_state_without_reverting_to_older_runs():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    store = TriageStore(engine)
    await store.initialize()
    principal = SimpleNamespace(tenant_id="tenant", project_id="project", subject="analyst")
    ticket = {"key": "PAY-1", "summary": "Initial observation", "created": "2026-01-01T00:00:00Z",
              "resolved": None, "assignee": "Source owner"}
    await store.import_run(principal, SimpleNamespace(run_id="run-first", created_at=10, result=None), ticket, [])
    await store.update_ticket_stage("tenant", "project", "PAY-1", "WAITING", assignee="Local owner")
    newer = {**ticket, "summary": "Newest observation", "resolved": "2026-01-01T02:00:00+00:00", "assignee": "Changed source owner"}
    await store.import_run(principal, SimpleNamespace(run_id="run-newest", created_at=30, result=None), newer, [])
    await store.import_run(principal, SimpleNamespace(run_id="run-middle", created_at=20, result=None), ticket, [])
    saved = await store.get_ticket("tenant", "project", "PAY-1")
    assert (saved["summary"], saved["work_state"], saved["assignee"]) == ("Newest observation", "WAITING", "Local owner")
    assert saved["custom_fields"]["source_run_id"] == "run-newest"
    assert saved["custom_fields"]["source_resolved_at"] - saved["custom_fields"]["source_created_at"] == 7200
    inv = await store.get_investigation("tenant", "project", "PAY-1")
    assert inv["auto_triage_run_id"] == "run-newest"
    invalid = {"key": "PAY-2", "summary": "No measured source times", "created": "2026-01-01T00:00:00", "resolved": "invalid"}
    await store.import_run(principal, SimpleNamespace(run_id="run-invalid-time", created_at=40, result=None), invalid, [])
    saved = await store.get_ticket("tenant", "project", "PAY-2")
    assert saved["custom_fields"]["source_created_at"] is None
    assert saved["custom_fields"]["source_resolved_at"] is None
    await engine.dispose()
