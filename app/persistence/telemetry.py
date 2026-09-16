"""Measured, bounded project analytics from persisted runs and native model events."""

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
import json
import math
import statistics

from sqlalchemy import and_, cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB

from app.persistence.feedback import feedback
from app.persistence.run_events import run_events
from app.persistence.store import runs
from app.persistence.triage import (
    investigation_findings,
    triage_queue_stays,
    triage_tickets,
)
from app.runtime.run_contract import TERMINAL_STATUSES
from app.runtime.sla_engine import compute_ticket_sla_state

RUN_LIMIT = 1000
EVENT_LIMIT = 20000
TERMINAL_MODEL_EVENTS = {"model_completed", "model_failed", "model_cancelled"}
TOKEN_FIELDS = {"input_tokens": "input_count", "output_tokens": "output_count",
                "thinking_tokens": "thinking_count", "total_tokens": "total_count",
                "cached_input_tokens": "cached_input_count"}

def metrics_window(start=None, end=None, window=None):
    """Explicit dates select whole UTC days; presets select exact rolling time."""
    now = datetime.now(timezone.utc)
    days = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}[window or "30d"]
    if start is not None or end is not None:
        finish = end or now.date()
        try:
            return start or finish - timedelta(days=days - 1), finish
        except OverflowError:
            raise ValueError("Date range is outside supported bounds") from None
    return now - timedelta(days=days), now


def time_bounds(start, end):
    """Normalize calendar dates or aware timestamps to a half-open UTC range."""
    try:
        begin = start if isinstance(start, datetime) else datetime.combine(start, time.min, timezone.utc)
        finish = end if isinstance(end, datetime) else datetime.combine(end + timedelta(days=1), time.min, timezone.utc)
    except OverflowError:
        raise ValueError("Date range is outside supported bounds") from None
    if begin.tzinfo is None or finish.tzinfo is None:
        raise ValueError("Metric timestamps must include a timezone")
    begin, finish = begin.astimezone(timezone.utc), finish.astimezone(timezone.utc)
    if not timedelta(0) < finish - begin <= timedelta(days=366):
        raise ValueError("Choose a time range greater than zero and no more than 366 days")
    return begin.timestamp(), finish.timestamp()


def number(value):
    return value if type(value) in {float, int} and 0 <= value <= 2**63 - 1 and math.isfinite(value) else None


def retained_trace_gaps(events):
    """Detect pruned per-run traces even below the aggregate event-read limit."""
    first = {}
    for event in events:
        run_id, sequence = event["run_id"], event["sequence"]
        first[run_id] = min(first.get(run_id, sequence), sequence)
    return sum(sequence > 1 for sequence in first.values())


def durations(values):
    return {"mean_duration_ms": round(statistics.mean(values), 2) if values else None,
            "p95_duration_ms": round(sorted(values)[max(0, math.ceil(len(values) * .95) - 1)], 2) if values else None}


def call_cost(usage, rate):
    """A token estimate in USD; output rate includes separately reported thinking."""
    if not rate or not isinstance(usage, dict):
        return None
    prompt, output = number(usage.get("input_count")), number(usage.get("output_count"))
    incoming, outgoing = number(rate.get("input_per_million")), number(rate.get("output_per_million"))
    if None in (prompt, output, incoming, outgoing):
        return None
    cached = number(usage.get("cached_input_count"))
    cached_rate = number(rate.get("cached_input_per_million"))
    if cached is not None and cached > prompt:
        return None
    if cached and cached_rate is None:
        return None
    # Missing cache metadata does not claim a hit; input-priced estimates are
    # conservative and distinguished from provider invoices in the API notes.
    cached = cached or 0
    thinking = number(usage.get("thinking_count")) or 0
    return ((prompt - cached) * incoming + cached * (cached_rate or 0) + (output + thinking) * outgoing) / 1000000


class Measurements:
    def __init__(self):
        self.run_rows = {}
        self.calls = []

    def add_run(self, run):
        self.run_rows[run["run_id"]] = run

    def add_call(self, run, call):
        self.add_run(run)
        self.calls.append(call)

    def result(self, complete=True):
        counts = {name: 0 for name in TOKEN_FIELDS}
        reported_fields = {name: 0 for name in TOKEN_FIELDS}
        reported = priced = hits = misses = unknown_cache = 0
        known_cost = 0
        latencies = []
        for call in self.calls:
            usage = call.get("usage_counts")
            if isinstance(usage, dict) and any(number(usage.get(field)) is not None for field in TOKEN_FIELDS.values()):
                reported += 1
                for name, field in TOKEN_FIELDS.items():
                    value = number(usage.get(field))
                    if value is not None:
                        counts[name] += value
                        reported_fields[name] += 1
            if call.get("cost") is not None:
                priced += 1
                known_cost += call["cost"]
            cached = number((usage or {}).get("cached_input_count"))
            if cached is None:
                unknown_cache += 1
            elif cached > 0:
                hits += 1
            else:
                misses += 1
            duration = number(call.get("duration_ms"))
            if duration is not None:
                latencies.append(duration)
        terminal = [row for row in self.run_rows.values() if row["status"] in TERMINAL_STATUSES]
        run_latencies = [max(0, (row["updated_at"] - row["created_at"]) * 1000) for row in terminal]
        return {
            "runs": len(self.run_rows),
            "succeeded_runs": sum(row["status"] == "SUCCEEDED" for row in self.run_rows.values()),
            "failed_runs": sum(row["status"] in {"FAILED", "BLOCKED"} for row in self.run_rows.values()),
            "partial_runs": sum(row["status"] == "PARTIAL" for row in self.run_rows.values()),
            "cancelled_runs": sum(row["status"] == "CANCELLED" for row in self.run_rows.values()),
            "active_runs": sum(row["status"] == "RUNNING" for row in self.run_rows.values()),
            "evidence_items": sum(row["evidence_count"] for row in self.run_rows.values()),
            "run_latency": durations(run_latencies), "model_latency": durations(latencies),
            "model_calls": len(self.calls),
            "completed_model_calls": sum(call["kind"] == "model_completed" for call in self.calls),
            "failed_model_calls": sum(call["kind"] == "model_failed" for call in self.calls),
            "cancelled_model_calls": sum(call["kind"] == "model_cancelled" for call in self.calls),
            **counts, "reported_token_fields": reported_fields,
            "usage_reported_calls": reported, "usage_unknown_calls": len(self.calls) - reported,
            "priced_calls": priced, "unpriced_calls": len(self.calls) - priced,
            "known_cost_usd": round(known_cost, 8),
            "estimated_cost_usd": round(known_cost, 8) if complete and priced == len(self.calls)
                and all(row["snapshot"].get("model_telemetry_version") for row in self.run_rows.values()) else None,
            "cache_hits": hits, "cache_misses": misses, "cache_unknown_calls": unknown_cache,
            "cache_hit_rate": hits / (hits + misses) if hits + misses else None,
        }


async def telemetry(engine, principal, start, end, *, capability=None, stage=None, mode="live", sla_targets=None):
    start_at, end_at = time_bounds(start, end)
    now_ts = datetime.now(timezone.utc).timestamp()
    def contract_field(name):
        if engine.dialect.name == "postgresql":
            return cast(runs.c.contract_json, JSONB)[name].astext
        return func.json_extract(runs.c.contract_json, "$." + name)
    scope = (runs.c.tenant_id == principal.tenant_id, runs.c.project_id == principal.project_id,
             runs.c.created_at >= start_at, runs.c.created_at < end_at, contract_field("mode") == mode)
    if capability:
        scope += (contract_field("capability") == capability,)
    async with engine.connect() as connection:
        matched = await connection.scalar(select(func.count()).select_from(runs).where(*scope))
        rows = (await connection.execute(select(runs).where(*scope).order_by(
            runs.c.created_at.desc(), runs.c.run_id).limit(RUN_LIMIT))).mappings().all()
        records = {}
        for row in rows:
            contract = json.loads(row["contract_json"])
            records[row["run_id"]] = dict(row) | {"capability": contract["capability"],
                "snapshot": json.loads(contract["model_config_json"])}
        event_query = select(run_events).where(
            run_events.c.tenant_id == principal.tenant_id, run_events.c.project_id == principal.project_id,
            run_events.c.run_id.in_(records),
        )
        events = (await connection.execute(event_query.order_by(
            run_events.c.timestamp.desc(), run_events.c.sequence.desc()).limit(EVENT_LIMIT + 1))).mappings().all() if records else []
        feedback_rows = (await connection.execute(select(feedback.c.rating).where(
            feedback.c.tenant_id == principal.tenant_id, feedback.c.project_id == principal.project_id,
            feedback.c.run_id.in_(records),
        ))).scalars().all() if records else []

        # Triage tables are initialized and verified during application startup.
        ticket_query = select(triage_tickets).where(
            triage_tickets.c.tenant_id == principal.tenant_id,
            triage_tickets.c.project_id == principal.project_id,
            triage_tickets.c.created_at >= start_at,
            triage_tickets.c.created_at < end_at,
        )
        ticket_rows = (await connection.execute(ticket_query)).mappings().all()

        active_tickets_query = select(triage_tickets).where(
            triage_tickets.c.tenant_id == principal.tenant_id,
            triage_tickets.c.project_id == principal.project_id,
            triage_tickets.c.work_state != "RESOLVED",
        )
        active_ticket_rows = (await connection.execute(active_tickets_query)).mappings().all()

        stays_query = select(triage_queue_stays).where(
            triage_queue_stays.c.tenant_id == principal.tenant_id,
            triage_queue_stays.c.project_id == principal.project_id,
            triage_queue_stays.c.ticket_id.in_(select(triage_tickets.c.ticket_id).where(
                triage_tickets.c.tenant_id == principal.tenant_id,
                triage_tickets.c.project_id == principal.project_id,
                or_(and_(triage_tickets.c.created_at >= start_at, triage_tickets.c.created_at < end_at),
                    triage_tickets.c.work_state != "RESOLVED"),
            )),
        ).order_by(triage_queue_stays.c.entered_at, triage_queue_stays.c.stay_id)
        stay_rows = (await connection.execute(stays_query)).mappings().all()

        findings_query = select(investigation_findings).where(
            investigation_findings.c.tenant_id == principal.tenant_id,
            investigation_findings.c.project_id == principal.project_id,
            investigation_findings.c.created_at >= start_at,
            investigation_findings.c.created_at < end_at,
        )
        finding_rows = (await connection.execute(findings_query)).mappings().all()
    event_truncated = len(events) > EVENT_LIMIT
    events = events[:EVENT_LIMIT]
    pruned_traces = retained_trace_gaps(events)
    event_truncated = event_truncated or bool(pruned_traces)
    total = Measurements()
    daily, stages, models, capabilities = (defaultdict(Measurements) for _ in range(4))
    daily_sre = defaultdict(lambda: {"tickets": 0, "resolved_tickets": 0})
    source_resolutions = {}
    for ticket in ticket_rows:
        fields = ticket.get("custom_fields") or {}
        if not isinstance(fields, dict):
            continue
        created, resolved = number(fields.get("source_created_at")), number(fields.get("source_resolved_at"))
        if created is not None and resolved is not None and created <= resolved <= now_ts:
            source_resolutions[ticket["ticket_id"]] = (created, resolved)
    for ticket in ticket_rows:
        c_day = datetime.fromtimestamp(ticket["created_at"], timezone.utc).date().isoformat()
        daily_sre[c_day]["tickets"] += 1
        resolution = source_resolutions.get(ticket["ticket_id"])
        if resolution and start_at <= resolution[1] < end_at:
            r_day = datetime.fromtimestamp(resolution[1], timezone.utc).date().isoformat()
            daily_sre[r_day]["resolved_tickets"] += 1
    for day in daily_sre:
        daily[day]  # Incident-only days still belong in the measured series.
    if not stage:
        for row in records.values():
            total.add_run(row)
            daily[datetime.fromtimestamp(row["created_at"], timezone.utc).date().isoformat()].add_run(row)
            capabilities[row["capability"]].add_run(row)
    terminal_ids, observed_starts = set(), {}
    node_calls = defaultdict(list)
    def add_call(row, call):
        day = datetime.fromtimestamp(row["created_at"], timezone.utc).date().isoformat()
        for group in (total, daily[day], stages[call.get("stage", "unknown")],
                      models[call.get("model", "unknown")], capabilities[row["capability"]]):
            group.add_call(row, call)
    for event in events:
        details = json.loads(event["details_json"])
        row = records[event["run_id"]]
        kind = event["kind"]
        if kind == "model_started":
            observed_starts[(event["run_id"], details.get("call_id"))] = (row, details)
        if kind not in TERMINAL_MODEL_EVENTS:
            if kind in {"completed", "failed", "cancelled", "tool_completed", "tool_failed", "tool_cancelled"}:
                node_calls[event["node_id"]].append({"kind": kind, **details})
            continue
        terminal_ids.add((event["run_id"], details.get("call_id")))
        if stage and details.get("stage") != stage:
            continue
        rates = row["snapshot"].get("model_pricing", {}).get("rates", {})
        call = {**details, "kind": kind, "cost": call_cost(details.get("usage_counts"), rates.get(details.get("model")))}
        add_call(row, call)
    unfinished = 0
    for key, (row, details) in observed_starts.items():
        if (not stage or details.get("stage") == stage) and key not in terminal_ids:
            unfinished += 1
            add_call(row, {**details, "kind": "model_unfinished", "cost": None})
    complete = not event_truncated and matched <= RUN_LIMIT
    def groups(values, key):
        return [{key: name, **group.result(complete=complete), **daily_sre.get(name, {})} if key == "date"
                else {key: name, **group.result(complete=complete)}
                for name, group in sorted(values.items())]
    def nodes(tool):
        result = []
        for name, calls in sorted(node_calls.items()):
            if name.startswith("tool:") != tool:
                continue
            result.append({"name": name, "calls": len(calls),
                "errors": sum(call["kind"] in {"failed", "tool_failed"} for call in calls),
                "cancelled": sum(call["kind"] in {"cancelled", "tool_cancelled"} for call in calls),
                **durations([call["duration_ms"] for call in calls if number(call.get("duration_ms")) is not None])})
        return result
    summary = total.result(complete=complete)
    summary["unfinished_model_calls"] = unfinished
    legacy_runs = [row for row in records.values() if not row["snapshot"].get("model_telemetry_version")]
    if unfinished or legacy_runs or event_truncated or matched > RUN_LIMIT:
        summary["estimated_cost_usd"] = None

    stays_by_ticket = defaultdict(list)
    for stay in stay_rows:
        stays_by_ticket[stay["ticket_id"]].append(dict(stay))
    # Local intake-to-first-queue-exit, independent of reason labels or later returns.
    initial_completed_stays = [
        stays_by_ticket[ticket["ticket_id"]][0] for ticket in ticket_rows
        if stays_by_ticket[ticket["ticket_id"]]
        and stays_by_ticket[ticket["ticket_id"]][0]["exited_at"] is not None
    ]
    mttt_durations = [
        (s["exited_at"] - s["entered_at"]) * 1000.0
        for s in initial_completed_stays
        if 0 <= s["entered_at"] <= s["exited_at"] <= now_ts
    ]
    mttt_result = durations(mttt_durations)

    # Source incident timestamps are the only basis for resolution latency.
    resolved_in_period = [t for t in ticket_rows if t["work_state"] == "RESOLVED"]
    mttr_durations = [
        (resolved - created) * 1000.0 for created, resolved in source_resolutions.values()
    ]
    mttr_result = durations(mttr_durations)

    # Calculate SLA Compliance & Ongoing Breaches
    evaluated_ticket_ids = set()
    sla_compliant_count = 0
    ongoing_breaches = 0
    total_evaluated_sla = 0
    active_sla_evaluated = 0

    all_eval_tickets = list(ticket_rows) + [t for t in active_ticket_rows if t["ticket_id"] not in {r["ticket_id"] for r in ticket_rows}]
    for t in all_eval_tickets:
        tid = t["ticket_id"]
        if tid in evaluated_ticket_ids:
            continue
        evaluated_ticket_ids.add(tid)
        stays = stays_by_ticket[tid]
        if not stays:
            continue
        sla = compute_ticket_sla_state(dict(t), stays, now=now_ts, sla_targets=sla_targets)
        if sla["risk_state"] == "UNKNOWN":
            continue
        if t["work_state"] == "RESOLVED":
            if sla["risk_state"] != "BREACHED":
                sla_compliant_count += 1
            total_evaluated_sla += 1
        else:
            active_sla_evaluated += 1
            if sla["risk_state"] == "BREACHED":
                ongoing_breaches += 1

    sla_compliance_rate = (
        round(sla_compliant_count / total_evaluated_sla, 4) if total_evaluated_sla > 0 else None
    )

    priorities = {"P1": 0, "P2": 0, "P3": 0, "P4": 0}
    for t in ticket_rows:
        p = t.get("priority", "P2")
        if p in priorities:
            priorities[p] += 1
        else:
            priorities["P2"] += 1

    confirmed_findings = sum(1 for f in finding_rows if f["status"] == "CONFIRMED")
    rejected_findings = sum(1 for f in finding_rows if f["status"] == "REJECTED")
    candidate_findings = sum(1 for f in finding_rows if f["status"] == "PROPOSED")
    total_reviewed_findings = confirmed_findings + rejected_findings
    analyst_agreement_rate = (
        round(confirmed_findings / total_reviewed_findings, 4) if total_reviewed_findings > 0 else None
    )

    auto_triage_runs = [
        r for r in records.values()
        if "triage" in r.get("capability", "").lower() or r.get("capability") == "root_cause_analysis"
    ]
    auto_triage_success_rate = (
        round(sum(r["status"] == "SUCCEEDED" for r in auto_triage_runs) / len(auto_triage_runs), 4)
        if auto_triage_runs else None
    )

    sre_metrics = {
        "mttt": mttt_result,
        "mttr": mttr_result,
        "tickets_total": len(ticket_rows),
        "tickets_resolved": len(resolved_in_period),
        "tickets_active": len(active_ticket_rows),
        "sla_compliance_rate": sla_compliance_rate,
        "ongoing_breaches": ongoing_breaches if sla_targets else None,
        "sla_evaluated_tickets": total_evaluated_sla,
        "sla_active_evaluated_tickets": active_sla_evaluated,
        "sla_configured": bool(sla_targets),
        "mttt_samples": len(mttt_durations),
        "mttr_samples": len(mttr_durations),
        "priority_breakdown": priorities,
        "analyst_validation": {
            "confirmed": confirmed_findings,
            "rejected": rejected_findings,
            "candidate": candidate_findings,
            "agreement_rate": analyst_agreement_rate,
        },
        "auto_triage": {
            "runs": len(auto_triage_runs),
            "succeeded": sum(r["status"] == "SUCCEEDED" for r in auto_triage_runs),
            "success_rate": auto_triage_success_rate,
        },
    }

    return {"filters": {"start": start.isoformat(), "end": end.isoformat(), "start_at": start_at,
            "end_at": end_at, "end_exclusive": True, "capability": capability, "stage": stage, "mode": mode},
        "summary": summary, "sre_metrics": sre_metrics, "daily": groups(daily, "date"), "by_stage": groups(stages, "stage"),
        "by_model": groups(models, "model"), "by_capability": groups(capabilities, "capability"),
        "agents": nodes(False), "tools": nodes(True),
        "feedback": {"reviewed_runs": len(feedback_rows), "helpful": feedback_rows.count("helpful"),
                     "needs_work": feedback_rows.count("needs_work"), "unreviewed_runs": len(records) - len(feedback_rows)},
        "coverage": {"matched_runs": matched, "analyzed_runs": len(records), "events_analyzed": len(events),
            "run_limit": RUN_LIMIT, "event_limit": EVENT_LIMIT, "truncated": event_truncated or matched > RUN_LIMIT,
            "legacy_runs": len(legacy_runs), "unfinished_model_calls": unfinished,
            "runs_with_truncated_trace": pruned_traces,
            "notes": ["Token totals include only provider-reported values; unknown usage is not zero usage.",
                      "Costs use administrator prices frozen at run creation; they are estimates, not provider invoices.",
                      "Cache hits and misses require an explicit provider cache-token count; no count means unknown.",
                      "Dates group runs by their UTC start day. Stage filters affect model usage; agent and tool timings cover the selected runs.",
                      "Feedback is the latest rating by each investigation author, scoped to the selected runs; it is not an accuracy score.",
                      "MTTT measures the first completed local queue interval per ticket; later returns and reason labels do not change that interval.",
                      "MTTR requires validated source creation and resolution timestamps; local edits and run completion do not establish incident resolution.",
                      "SLA uses full recorded queue consumption and the same configured targets as the triage board. Compliance covers locally resolved tickets; ongoing breaches cover current active tickets. Tickets without queue records are excluded.",
                      "Incident measures cover the date cohort and current backlog; capability, stage and model mode filters apply only to investigation runs.",
                      "Legacy runs have no per-call model telemetry and remain excluded from token and cost totals."]}}
