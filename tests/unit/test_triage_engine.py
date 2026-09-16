"""Unit tests for PRISM SLA engine and Live Triage Board persistence."""

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.runtime.sla_engine import (
    compute_ticket_sla_state,
    rank_focus_queue,
    format_duration,
)
from app.persistence.triage import TriageStore
from tests.triage_support import create_triage_case


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
    sla = compute_ticket_sla_state(ticket, stays, now=now)
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
    sla = compute_ticket_sla_state(ticket, stays, now=now)
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
    sla1 = compute_ticket_sla_state(t1, [{"entered_at": now - 4000.0, "exited_at": None}], now=now)

    # Ticket 2: At-risk P1 (1m remaining)
    t2 = {"ticket_id": "T2", "priority": "P1", "work_state": "RETURNED", "assignee": None}
    sla2 = compute_ticket_sla_state(t2, [{"entered_at": now - 1740.0, "exited_at": None}], now=now)

    # Ticket 3: Healthy P2 (1h 30m remaining)
    t3 = {"ticket_id": "T3", "priority": "P2", "work_state": "IN_TRIAGE", "assignee": "Mike R."}
    sla3 = compute_ticket_sla_state(t3, [{"entered_at": now - 1800.0, "exited_at": None}], now=now)

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
