"""Deterministic SLA, Queue-Time, and Focus Queue Ordering Engine.

Implements Sections 4 and 5 of PRISM Live Triage Board Specification.
Calculates reproducible queue intervals, policy targets, SLA consumption,
risk states, and deterministic ranking order with explanatory summaries.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

# Default SLA Targets per Priority (in seconds)
DEFAULT_SLA_TARGETS: Dict[str, float] = {
    "P1": 1800.0,   # 30 minutes
    "P2": 7200.0,   # 2 hours
    "P3": 28800.0,  # 8 hours
    "P4": 86400.0,  # 24 hours
}

PRIORITY_RANK = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}


def format_duration(seconds: float) -> str:
    """Format duration into human readable string, e.g. '1h 12m', '45m', '9m', '-1h 12m'."""
    is_neg = seconds < 0
    s = abs(int(seconds))
    h = s // 3600
    m = (s % 3600) // 60
    parts = []
    if h > 0:
        parts.append(f"{h}h")
    if m > 0 or not parts:
        parts.append(f"{m}m")
    out = " ".join(parts)
    return f"-{out}" if is_neg else out


def compute_ticket_sla_state(
    ticket: Dict[str, Any],
    queue_stays: List[Dict[str, Any]],
    now: Optional[float] = None,
    sla_targets: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Compute exact queue time and SLA consumption for a single ticket."""
    current_time = now if now is not None else time.time()
    targets = sla_targets or DEFAULT_SLA_TARGETS

    priority = str(ticket.get("priority", "P2")).upper()
    sla_target = targets.get(priority, 7200.0)

    # Clocks
    ticket_created = float(ticket.get("created_at", current_time))
    ticket_age_s = max(0.0, current_time - ticket_created)

    cumulative_consumed = 0.0
    active_stay = None
    prior_stays = []

    for stay in queue_stays:
        exited = stay.get("exited_at")
        entered = float(stay.get("entered_at", current_time))
        if exited is None:
            active_stay = stay
            current_stay_duration = max(0.0, current_time - entered)
            cumulative_consumed += current_stay_duration
        else:
            prior_stays.append(stay)
            accountable = float(stay.get("accountable_duration", 0.0))
            if accountable <= 0.0:
                accountable = max(0.0, float(exited) - entered)
            cumulative_consumed += accountable

    current_stay_duration = (
        max(0.0, current_time - float(active_stay["entered_at"]))
        if active_stay
        else 0.0
    )

    sla_remaining = sla_target - cumulative_consumed
    sla_utilization = min(2.0, cumulative_consumed / sla_target) if sla_target > 0 else 1.0

    if sla_remaining <= 0:
        risk_state = "BREACHED"
    elif sla_remaining <= 0.25 * sla_target:
        risk_state = "AT_RISK"
    else:
        risk_state = "HEALTHY"

    is_returned = (
        ticket.get("work_state") == "RETURNED"
        or (active_stay and active_stay.get("previous_team") is not None)
    )
    return_age = current_stay_duration if is_returned else None

    # Generate one-line deterministic explanation
    explanation_parts = [priority]
    assignee = ticket.get("assignee")

    if is_returned:
        prev_team = active_stay.get("previous_team") if active_stay else "external team"
        explanation_parts.append(f"returned to triage from {prev_team} {format_duration(return_age or 0)} ago")
    elif active_stay:
        explanation_parts.append(f"in triage queue for {format_duration(current_stay_duration)}")

    consumed_fmt = format_duration(cumulative_consumed)
    target_fmt = format_duration(sla_target)

    if risk_state == "BREACHED":
        explanation_parts.append(f"breached by {format_duration(abs(sla_remaining))}; {consumed_fmt}/{target_fmt} consumed")
    elif risk_state == "AT_RISK":
        explanation_parts.append(f"SLA risk: {format_duration(sla_remaining)} remaining ({consumed_fmt}/{target_fmt} consumed)")
    else:
        explanation_parts.append(f"{format_duration(sla_remaining)} remaining ({consumed_fmt}/{target_fmt} consumed)")

    if not assignee:
        explanation_parts.append("unassigned; action required")
    else:
        explanation_parts.append(f"assigned to {assignee}")

    explanation = "; ".join(explanation_parts) + "."

    return {
        "ticket_id": ticket["ticket_id"],
        "priority": priority,
        "priority_rank": PRIORITY_RANK.get(priority, 99),
        "sla_target_seconds": sla_target,
        "sla_target_formatted": target_fmt,
        "sla_consumed_seconds": cumulative_consumed,
        "sla_consumed_formatted": consumed_fmt,
        "sla_remaining_seconds": sla_remaining,
        "sla_remaining_formatted": format_duration(sla_remaining),
        "sla_utilization": round(sla_utilization, 3),
        "risk_state": risk_state,
        "ticket_age_seconds": ticket_age_s,
        "ticket_age_formatted": format_duration(ticket_age_s),
        "current_stay_seconds": current_stay_duration,
        "current_stay_formatted": format_duration(current_stay_duration),
        "is_returned": is_returned,
        "return_age_seconds": return_age,
        "return_age_formatted": format_duration(return_age) if return_age is not None else None,
        "explanation": explanation,
        "active_stay": active_stay,
        "prior_stays_count": len(prior_stays),
    }


def rank_focus_queue(
    tickets_with_sla: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Rank tickets for the Focus Queue using deterministic rules from Section 5.

    1. Breached SLA first (sorted by most severely breached / lowest sla_remaining)
    2. Lowest positive SLA remaining / At-Risk threshold
    3. Jira priority (P1 > P2 > P3 > P4)
    4. Returned / unacknowledged obligation (unassigned before assigned)
    5. Longest wait / stay time
    """
    def sort_key(item: Dict[str, Any]):
        sla = item["sla"]
        # Rule 1: Breached SLA
        is_breached = 0 if sla["risk_state"] == "BREACHED" else 1
        # Rule 2: At-Risk SLA
        is_at_risk = 0 if sla["risk_state"] == "AT_RISK" else 1
        # SLA remaining seconds (for breached, more negative comes first)
        rem_sec = sla["sla_remaining_seconds"]
        # Rule 3: Priority rank (1, 2, 3, 4)
        prio_rank = sla["priority_rank"]
        # Rule 4: Returned or Unassigned
        ticket = item["ticket"]
        is_unassigned = 0 if not ticket.get("assignee") else 1
        is_returned = 0 if sla["is_returned"] else 1
        # Rule 5: Longest wait (invert for descending)
        stay_wait = -sla["current_stay_seconds"]

        return (
            is_breached,
            is_at_risk,
            rem_sec,
            prio_rank,
            is_unassigned,
            is_returned,
            stay_wait,
        )

    return sorted(tickets_with_sla, key=sort_key)
