"""Authorized, bounded platform-level metrics across tenant projects."""

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
import json

from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import JSONB

from app.configuration.projects import project_catalog
from app.persistence.run_events import run_events
from app.persistence.store import runs
from app.persistence.telemetry import (
    call_cost,
    durations,
    number,
    Measurements,
    TERMINAL_MODEL_EVENTS,
)
from app.persistence.triage import triage_tickets
from app.runtime.run_contract import TERMINAL_STATUSES

PLATFORM_RUN_LIMIT = 5000
PLATFORM_EVENT_LIMIT = 50000


async def platform_metrics(engine, principal, start, end, *, mode: str = "live"):
    start_at = datetime.combine(start, time.min, timezone.utc).timestamp()
    end_at = datetime.combine(end + timedelta(days=1), time.min, timezone.utc).timestamp()
    if end < start or (end - start).days > 365:
        raise ValueError("Choose an inclusive date range of 1 to 366 days")

    def contract_field(name):
        if engine.dialect.name == "postgresql":
            return cast(runs.c.contract_json, JSONB)[name].astext
        return func.json_extract(runs.c.contract_json, "$." + name)

    # Scoped strictly to tenant_id across all projects
    run_scope = (
        runs.c.tenant_id == principal.tenant_id,
        runs.c.created_at >= start_at,
        runs.c.created_at < end_at,
        contract_field("mode") == mode,
    )

    async with engine.connect() as connection:
        # 1. Tenant project catalog (with graceful fallback if table not yet initialized)
        project_names = {}
        try:
            catalog_rows = (
                await connection.execute(
                    select(project_catalog.c.project_id, project_catalog.c.name).where(
                        project_catalog.c.tenant_id == principal.tenant_id
                    )
                )
            ).mappings().all()
            project_names = {row["project_id"]: row["name"] for row in catalog_rows}
        except Exception:
            project_names = {}

        # 2. Count matching runs and fetch up to limit
        matched_runs = await connection.scalar(select(func.count()).select_from(runs).where(*run_scope)) or 0
        run_rows = (
            await connection.execute(
                select(runs).where(*run_scope).order_by(runs.c.created_at.desc(), runs.c.run_id).limit(PLATFORM_RUN_LIMIT)
            )
        ).mappings().all()

        records = {}
        for row in run_rows:
            contract = json.loads(row["contract_json"])
            records[row["run_id"]] = dict(row) | {
                "capability": contract.get("capability", "unknown"),
                "snapshot": json.loads(contract.get("model_config_json", "{}")),
            }

        # 3. Fetch events
        events = []
        if records:
            event_query = select(run_events).where(
                run_events.c.tenant_id == principal.tenant_id,
                run_events.c.run_id.in_(records),
            )
            events = (
                await connection.execute(
                    event_query.order_by(run_events.c.timestamp.desc(), run_events.c.sequence.desc()).limit(
                        PLATFORM_EVENT_LIMIT + 1
                    )
                )
            ).mappings().all()

        # 4. Active tickets per project (with graceful fallback)
        active_tickets_by_proj = {}
        try:
            active_tickets_rows = (
                await connection.execute(
                    select(triage_tickets.c.project_id, func.count().label("active_count"))
                    .where(
                        triage_tickets.c.tenant_id == principal.tenant_id,
                        triage_tickets.c.work_state != "RESOLVED",
                    )
                    .group_by(triage_tickets.c.project_id)
                )
            ).mappings().all()
            active_tickets_by_proj = {row["project_id"]: row["active_count"] for row in active_tickets_rows}
        except Exception:
            active_tickets_by_proj = {}

    event_truncated = len(events) > PLATFORM_EVENT_LIMIT
    events = events[:PLATFORM_EVENT_LIMIT]

    # Aggregate by project and tenant total
    tenant_total = Measurements()
    project_measurements = defaultdict(Measurements)

    for row in records.values():
        tenant_total.add_run(row)
        project_measurements[row["project_id"]].add_run(row)

    terminal_ids, observed_starts = set(), {}
    node_calls = defaultdict(list)

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
        rates = row["snapshot"].get("model_pricing", {}).get("rates", {})
        call = {**details, "kind": kind, "cost": call_cost(details.get("usage_counts"), rates.get(details.get("model")))}
        tenant_total.add_call(row, call)
        project_measurements[row["project_id"]].add_call(row, call)

    unfinished = 0
    for key, (row, details) in observed_starts.items():
        if key not in terminal_ids:
            unfinished += 1
            call = {**details, "kind": "model_unfinished", "cost": None}
            tenant_total.add_call(row, call)
            project_measurements[row["project_id"]].add_call(row, call)

    complete = not event_truncated and matched_runs <= PLATFORM_RUN_LIMIT
    tenant_summary = tenant_total.result(complete=complete)
    tenant_summary["unfinished_model_calls"] = unfinished

    legacy_runs = [row for row in records.values() if not row["snapshot"].get("model_telemetry_version")]
    if unfinished or legacy_runs or event_truncated or matched_runs > PLATFORM_RUN_LIMIT:
        tenant_summary["estimated_cost_usd"] = None

    # Compute raw percentiles across ALL runs in tenant (not averaged!)
    terminal_all = [row for row in records.values() if row["status"] in TERMINAL_STATUSES]
    all_latencies = [max(0, (row["updated_at"] - row["created_at"]) * 1000) for row in terminal_all]
    overall_latency = durations(all_latencies)

    # Build project comparison rows
    all_project_ids = sorted(set(list(project_names.keys()) + list(project_measurements.keys())))
    comparison_rows = []
    for pid in all_project_ids:
        m = project_measurements[pid].result(complete=complete)
        comparison_rows.append(
            {
                "project_id": pid,
                "project_name": project_names.get(pid, pid),
                "runs": m["runs"],
                "succeeded_runs": m["succeeded_runs"],
                "failed_runs": m["failed_runs"],
                "total_tokens": m["total_tokens"],
                "estimated_cost_usd": m["estimated_cost_usd"],
                "mean_duration_ms": m["run_latency"]["mean_duration_ms"],
                "p95_duration_ms": m["run_latency"]["p95_duration_ms"],
                "active_tickets": active_tickets_by_proj.get(pid, 0),
            }
        )

    # Tool stats
    tool_results = []
    for name, calls in sorted(node_calls.items()):
        if not name.startswith("tool:"):
            continue
        tool_results.append(
            {
                "name": name,
                "calls": len(calls),
                "errors": sum(c["kind"] in {"failed", "tool_failed"} for c in calls),
                "cancelled": sum(c["kind"] in {"cancelled", "tool_cancelled"} for c in calls),
                **durations([c["duration_ms"] for c in calls if number(c.get("duration_ms")) is not None]),
            }
        )

    return {
        "filters": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "mode": mode,
        },
        "totals": {
            **tenant_summary,
            "overall_run_latency": overall_latency,
        },
        "projects": comparison_rows,
        "tools": tool_results,
        "coverage": {
            "matched_runs": matched_runs,
            "analyzed_runs": len(records),
            "events_analyzed": len(events),
            "run_limit": PLATFORM_RUN_LIMIT,
            "event_limit": PLATFORM_EVENT_LIMIT,
            "truncated": event_truncated or matched_runs > PLATFORM_RUN_LIMIT,
            "legacy_runs": len(legacy_runs),
            "unfinished_model_calls": unfinished,
            "notes": [
                "Cross-project totals strictly enforce tenant boundary.",
                "Platform run percentiles are computed from raw observation events, never averaged across projects.",
                "Costs reflect frozen model rates captured at run execution.",
                "Runtime tool reliability reflects authentic tool execution events from active runs.",
            ],
        },
    }
