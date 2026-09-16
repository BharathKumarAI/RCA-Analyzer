"""PRISM Live Triage Board & Ticket Investigation Workspace API.

Provides operational control plane endpoints for SLA-driven queue management,
contextual tool execution, evidence/finding governance, and assignment journeys.
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
from typing import Annotated, Any, Dict, List, Literal, Optional
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.api.dependencies import Principal
from app.api.routes.runs import execute_run
from app.api.schemas import RunExecutionRequest
from app.persistence.store import runs
from app.persistence.telemetry import telemetry
from app.runtime.run_contract import InvestigationResult, RunContract, content_hash
from sqlalchemy import select
from app.persistence.triage import TriageStore
from app.runtime.sla_engine import compute_ticket_sla_state, rank_focus_queue, resolve_sla_targets

router = APIRouter(prefix="/api/v1/triage", tags=["triage-board"])


async def get_triage_store(request: Request) -> TriageStore:
    """Retrieve or lazily initialize TriageStore on application state."""
    store = getattr(request.app.state, "triage_store", None)
    if store is None:
        db_engine = request.app.state.store.engine
        store = TriageStore(db_engine)
        await store.initialize()
        request.app.state.triage_store = store
    ticket_id = request.path_params.get("ticket_id") if hasattr(request, "path_params") else None
    principal = getattr(getattr(request, "state", None), "principal", None)
    if ticket_id and principal and not await store.get_ticket(principal.tenant_id, principal.project_id, ticket_id):
        raise HTTPException(404, "Ticket not found")
    return store


# Request / Response Schemas
class QueryRevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_query: str = Field(min_length=1, max_length=12000)
    parameters: Optional[Dict[str, Any]] = None


class ToolExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parameters: Optional[Dict[str, Any]] = None


RCAMethod = Literal["five_whys", "fishbone", "kepner_tregoe", "fmea", "fault_tree", "auto_ensemble"]


class RCAAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: RCAMethod


class RCAAnalysis(BaseModel):
    run_id: str
    status: Literal["SUCCEEDED", "PARTIAL"]
    result: InvestigationResult
    created_at: float


class RCAAnalysisResponse(RCAAnalysis):
    method: RCAMethod


class RCAWorkspaceResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ticket_id: str
    incident_title: str
    available_methods: list[RCAMethod]
    analyses: dict[RCAMethod, RCAAnalysis]


class PromoteEvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=3, max_length=512)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class StatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(pattern=r"^(ACCEPTED|REJECTED)$")


class FindingStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(pattern=r"^(CONFIRMED|REJECTED|PROPOSED)$")


class EscalateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_team: str = Field(min_length=2, max_length=128)
    reason: str = Field(default="Triage investigation complete; transferring to application team.", max_length=512)


class ReturnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_team: str = Field(min_length=2, max_length=128)
    reason: str = Field(default="Additional telemetry and log analysis requested.", max_length=512)


@router.get("/live-board")
async def get_live_board(
    request: Request,
    principal: Principal,
    work_state: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    """Retrieve Live Triage Board control plane data."""
    store = await get_triage_store(request)

    all_tickets = await store.list_tickets(principal.tenant_id, principal.project_id)
    all_stays = await store.get_all_queue_stays_for_project(principal.tenant_id, principal.project_id)

    # Group stays by ticket_id
    stays_by_ticket: Dict[str, List[Dict[str, Any]]] = {}
    for s in all_stays:
        stays_by_ticket.setdefault(s["ticket_id"], []).append(s)

    now = time.time()
    sla_targets = await resolve_sla_targets(request.app.state.parameters, principal)
    # Compute SLA state for every ticket
    enriched_tickets: List[Dict[str, Any]] = []
    bucket_counts: Dict[str, int] = {
        "ALL": len(all_tickets),
        "NEW": 0,
        "IN_TRIAGE": 0,
        "RETURNED": 0,
        "FOLLOW_UP": 0,
        "APP_TEAM": 0,
        "WAITING": 0,
        "RESOLVED": 0,
    }

    urgency_counts = {
        "breached": 0,
        "at_risk": 0,
        "action_required": 0,
        "healthy": 0,
        "unknown": 0,
    }

    for t in all_tickets:
        state = t.get("work_state", "NEW")
        if state in bucket_counts:
            bucket_counts[state] += 1

        t_stays = stays_by_ticket.get(t["ticket_id"], [])
        sla = compute_ticket_sla_state(t, t_stays, now=now, sla_targets=sla_targets)

        if sla["risk_state"] == "BREACHED":
            urgency_counts["breached"] += 1
        elif sla["risk_state"] == "AT_RISK":
            urgency_counts["at_risk"] += 1
        elif sla["risk_state"] == "HEALTHY":
            urgency_counts["healthy"] += 1
        else:
            urgency_counts["unknown"] += 1

        if not t.get("assignee") and state in ("NEW", "RETURNED", "FOLLOW_UP"):
            urgency_counts["action_required"] += 1

        # Determine primary action label
        if not t.get("assignee"):
            action = "Start Triage" if state != "RETURNED" else "Resume"
        elif state == "FOLLOW_UP":
            action = "Review Update"
        elif state == "IN_TRIAGE":
            action = "Continue"
        else:
            action = "View"

        enriched_tickets.append({
            "ticket": t,
            "sla": sla,
            "primary_action": action,
        })

    # Filter for Focus Queue
    filtered = enriched_tickets
    if work_state and work_state != "ALL":
        filtered = [item for item in filtered if item["ticket"]["work_state"] == work_state]
    if search:
        s = search.lower()
        filtered = [
            item for item in filtered
            if s in item["ticket"]["ticket_id"].lower()
            or s in item["ticket"]["summary"].lower()
            or s in (item["ticket"].get("service") or "").lower()
        ]

    # Rank Focus Queue deterministically per Section 5
    ranked_queue = rank_focus_queue(filtered)

    assigned = defaultdict(list)
    for ticket in all_tickets:
        if ticket.get("assignee") and ticket["work_state"] != "RESOLVED":
            assigned[ticket["assignee"]].append(ticket["ticket_id"])
    active_analysts = [
        {"name": name, "role": "Assigned analyst", "active_tickets": len(ids),
         "current_ticket": ids[0] if len(ids) == 1 else None, "status": "ASSIGNED"}
        for name, ids in sorted(assigned.items())
    ]
    # No live health measurement is inferred from a saved connection or assignment.
    connectors_health = []
    today = datetime.now(timezone.utc).date()
    measured = await telemetry(request.app.state.store.engine, principal, today - timedelta(days=29), today)
    sre = measured["sre_metrics"]
    def percent(value):
        return f"{value:.1%}" if value is not None else None
    duration = sre["mttt"].get("mean_duration_ms")
    performance_metrics = {
        "mttt": f"{duration / 60000:.1f}m" if duration is not None else None,
        "mttt_trend": None,
        "auto_triage_success_rate": percent(sre["auto_triage"]["success_rate"]),
        "auto_triage_success_trend": None,
        "analyst_validation_rate": percent(sre["analyst_validation"]["agreement_rate"]),
        "analyst_validation_trend": None,
        "rca_accuracy_rate": None,
        "rca_accuracy_trend": None,
    }

    return {
        "urgency_strip": urgency_counts,
        "work_buckets": bucket_counts,
        "focus_queue": ranked_queue,
        "team_capacity": active_analysts,
        "connectors_health": connectors_health,
        "performance_metrics": performance_metrics,
        "total_tickets": len(all_tickets),
        "timestamp": now,
    }


@router.get("/tickets/{ticket_id}")
async def get_ticket_workspace(
    ticket_id: str,
    request: Request,
    principal: Principal,
):
    """Get complete investigation workspace for a specific ticket."""
    store = await get_triage_store(request)

    ticket = await store.get_ticket(principal.tenant_id, principal.project_id, ticket_id)
    if not ticket:
        raise HTTPException(404, f"Ticket '{ticket_id}' not found")

    stays = await store.get_queue_stays(principal.tenant_id, principal.project_id, ticket_id)
    sla = compute_ticket_sla_state(ticket, stays, sla_targets=await resolve_sla_targets(request.app.state.parameters, principal))
    inv = await store.get_investigation(principal.tenant_id, principal.project_id, ticket_id)

    if not inv:
        raise HTTPException(404, f"Investigation workspace for '{ticket_id}' not found")

    proposals = await store.get_tool_proposals(principal.tenant_id, principal.project_id, inv["investigation_id"])
    evidence = await store.get_evidence(principal.tenant_id, principal.project_id, inv["investigation_id"])
    findings = await store.get_findings(principal.tenant_id, principal.project_id, inv["investigation_id"])
    actions = await store.get_governed_actions(principal.tenant_id, principal.project_id, inv["investigation_id"])
    events = await store.get_events(principal.tenant_id, principal.project_id, ticket_id=ticket_id, limit=30)

    related_tickets = []
    if ticket.get("service"):
        related_tickets = [
            {"ticket_id": row["ticket_id"], "summary": row["summary"], "similarity": None,
             "root_cause": None, "resolution": None, "resolved_at": None, "resolved_by": None}
            for row in await store.list_tickets(principal.tenant_id, principal.project_id)
            if row["ticket_id"] != ticket_id and row.get("service") == ticket["service"]
        ][:10]

    return {
        "ticket": ticket,
        "sla": sla,
        "queue_stays": stays,
        "investigation": inv,
        "tool_proposals": proposals,
        "evidence": evidence,
        "findings": findings,
        "governed_actions": actions,
        "events": events,
        "related_tickets": related_tickets,
    }


@router.post("/tickets/{ticket_id}/acknowledge")
async def acknowledge_ticket(
    ticket_id: str,
    request: Request,
    principal: Principal,
):
    """Analyst acknowledges and takes operational ownership of a ticket."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    return await store.acknowledge_ticket(principal.tenant_id, principal.project_id, ticket_id, actor_name)


@router.post("/tool-proposals/{proposal_id}/revision")
async def update_proposal_query(
    proposal_id: str,
    body: QueryRevisionRequest,
    request: Request,
    principal: Principal,
):
    """Save an edited query proposal without overwriting original proposal."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    try:
        return await store.update_tool_proposal_query(
            principal.tenant_id,
            principal.project_id,
            proposal_id,
            body.current_query,
            body.parameters,
            actor_name,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None


@router.post("/tool-proposals/{proposal_id}/execute")
async def execute_tool_proposal(
    proposal_id: str,
    request: Request,
    principal: Principal,
    body: Optional[ToolExecutionRequest] = None,
):
    """Execute query proposal against connector and record auditable results."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"

    proposal = await store.get_tool_proposal(principal.tenant_id, principal.project_id, proposal_id)
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    if (body and body.parameters) or set(proposal.get("parameters") or {}) - {"connector_selections"}:
        raise HTTPException(422, "Raw connector parameters are unsupported; use the governed investigation settings")
    if not request.app.state.registry.get(proposal["capability"]):
        raise HTTPException(409, "This legacy proposal has no investigation capability; start a governed run instead")
    try:
        invocation = RunExecutionRequest(capability=proposal["capability"], incident_id=proposal["ticket_id"],
            prompt=proposal["current_query"], connector_selections=(proposal.get("parameters") or {}).get("connector_selections", {}))
    except ValidationError:
        raise HTTPException(422, "The saved proposal has invalid investigation settings; revise it before execution") from None
    key = "triage:" + content_hash({"proposal_id": proposal_id, "request": invocation.model_dump(mode="json")})
    run = await execute_run(invocation, request, principal, key, False)
    if run.status not in {"SUCCEEDED", "PARTIAL"} or run.mode != "live":
        raise HTTPException(409, {"message": "Investigation did not produce a live result", "run_id": run.run_id, "status": run.status})
    evidence = await request.app.state.store.list_by_run(run.run_id, principal)
    result = {"run_id": run.run_id, "status": run.status, "count": len(evidence),
              "execution_time_ms": max(0, (run.updated_at - run.created_at) * 1000),
              "interpretation": run.result.summary if run.result else run.reason,
              "items": [item.model_dump(mode="json") for item in evidence], "executed_at": run.updated_at}
    try:
        return await store.record_tool_execution(principal.tenant_id, principal.project_id, proposal_id, result, actor_name,
                                                expected_query=proposal["current_query"],
                                                expected_parameters=proposal.get("parameters") or {})
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/tool-proposals/{proposal_id}/promote-evidence")
async def promote_tool_evidence(
    proposal_id: str,
    body: PromoteEvidenceRequest,
    request: Request,
    principal: Principal,
):
    """Promote executed tool result into formal evidence."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    try:
        return await store.promote_result_to_evidence(
            principal.tenant_id,
            principal.project_id,
            proposal_id,
            body.summary,
            actor_name,
            body.confidence,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/evidence/{evidence_id}/status")
async def update_evidence_status(
    evidence_id: str,
    body: StatusUpdateRequest,
    request: Request,
    principal: Principal,
):
    """Accept or reject candidate evidence."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    try:
        return await store.update_evidence_status(
            principal.tenant_id,
            principal.project_id,
            evidence_id,
            body.status,
            actor_name,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None


@router.post("/findings/{finding_id}/status")
async def update_finding_status(
    finding_id: str,
    body: FindingStatusRequest,
    request: Request,
    principal: Principal,
):
    """Confirm or reject an RCA finding."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    try:
        return await store.update_finding_status(
            principal.tenant_id,
            principal.project_id,
            finding_id,
            body.status,
            actor_name,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None


@router.post("/actions/{action_id}/approve")
async def approve_action(
    action_id: str,
    request: Request,
    principal: Principal,
):
    """Record local approval only; external source mutations are forbidden."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Lead"
    try:
        return await store.approve_governed_action(
            principal.tenant_id,
            principal.project_id,
            action_id,
            actor_name,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None


@router.post("/tickets/{ticket_id}/escalate")
async def escalate_ticket(
    ticket_id: str,
    body: EscalateRequest,
    request: Request,
    principal: Principal,
):
    """Transfer ticket to resolver team, closing current triage queue stay."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    return await store.escalate_ticket(
        principal.tenant_id,
        principal.project_id,
        ticket_id,
        body.target_team,
        actor_name,
        body.reason,
    )


@router.post("/tickets/{ticket_id}/return")
async def return_ticket(
    ticket_id: str,
    body: ReturnRequest,
    request: Request,
    principal: Principal,
):
    """Record a local return to triage; source-system state is unchanged."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Resolver Engineer"
    return await store.return_ticket_to_triage(
        principal.tenant_id,
        principal.project_id,
        ticket_id,
        body.from_team,
        actor_name,
        body.reason,
    )


@router.get("/team-activity")
async def get_team_activity(
    request: Request,
    principal: Principal,
    limit: int = Query(30, ge=1, le=100),
):
    """Stream of recent team activity and agent events."""
    store = await get_triage_store(request)
    return await store.get_events(principal.tenant_id, principal.project_id, limit=limit)


class StageUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    work_state: str = Field(pattern=r"^(NEW|IN_TRIAGE|RETURNED|FOLLOW_UP|APP_TEAM|WAITING|RESOLVED)$")
    assigned_team: Optional[str] = Field(default=None, max_length=128)
    assignee: Optional[str] = Field(default=None, max_length=128)


class TicketCommentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    comment: str = Field(min_length=1, max_length=4000)
    is_internal: bool = False


class CalibrationFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticket_key: str = Field(min_length=2, max_length=64)
    rating: str = Field(pattern=r"^(UP|DOWN)$")
    tags: List[str] = Field(default_factory=list, max_length=20)
    comment: str = Field(min_length=1, max_length=4000)


@router.patch("/tickets/{ticket_id}/stage")
async def update_stage(
    ticket_id: str,
    body: StageUpdateRequest,
    request: Request,
    principal: Principal,
):
    """Fast stage transition and team assignment for ticket."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    return await store.update_ticket_stage(
        principal.tenant_id,
        principal.project_id,
        ticket_id,
        body.work_state,
        body.assigned_team,
        body.assignee,
        actor=actor_name,
    )


@router.post("/tickets/{ticket_id}/comments")
async def add_comment(
    ticket_id: str,
    body: TicketCommentRequest,
    request: Request,
    principal: Principal,
):
    """Add and persist an analyst comment or note to a ticket investigation."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    return await store.add_ticket_comment(
        principal.tenant_id,
        principal.project_id,
        ticket_id,
        actor_name,
        body.comment,
        body.is_internal,
    )


@router.get("/tickets/{ticket_id}/comments")
async def get_comments(
    ticket_id: str,
    request: Request,
    principal: Principal,
):
    """Retrieve full comment thread for a ticket."""
    store = await get_triage_store(request)
    return await store.get_ticket_comments(
        principal.tenant_id,
        principal.project_id,
        ticket_id,
    )


@router.post("/feedback")
async def record_feedback(
    body: CalibrationFeedbackRequest,
    request: Request,
    principal: Principal,
):
    """Record SRE model calibration feedback."""
    store = await get_triage_store(request)
    actor_name = principal.subject or "Triage Analyst"
    if not await store.get_ticket(principal.tenant_id, principal.project_id, body.ticket_key):
        raise HTTPException(404, "Ticket not found")
    return await store.save_calibration_feedback(
        principal.tenant_id,
        principal.project_id,
        body.ticket_key,
        body.rating,
        body.tags,
        body.comment,
        actor_name,
    )


@router.get("/feedback")
async def get_feedback_list(
    request: Request,
    principal: Principal,
    limit: int = Query(50, ge=1, le=100),
):
    """Retrieve recent SRE calibration feedback records."""
    store = await get_triage_store(request)
    return await store.list_calibration_feedback(
        principal.tenant_id,
        principal.project_id,
        limit=limit,
    )


@router.get("/tickets/{ticket_id}/rca", response_model=RCAWorkspaceResponse)
async def get_ticket_rca(
    ticket_id: str,
    request: Request,
    principal: Principal,
):
    """Retrieve multi-methodology RCA investigation data for ticket."""
    store = await get_triage_store(request)
    rca = await store.get_ticket_rca_methodologies(
        principal.tenant_id,
        principal.project_id,
        ticket_id,
    )
    if not rca:
        raise HTTPException(404, f"RCA data for ticket '{ticket_id}' not found")
    return rca


@router.post("/tickets/{ticket_id}/rca", response_model=RCAAnalysisResponse)
async def analyze_ticket_rca(
    ticket_id: str,
    body: RCAAnalysisRequest,
    request: Request,
    principal: Principal,
    idempotency_key: Annotated[str | None, Header(min_length=1, max_length=128)] = None,
):
    """Run a chosen methodology through the authenticated native investigation harness."""
    store = await get_triage_store(request)
    investigation = await store.get_investigation(principal.tenant_id, principal.project_id, ticket_id)
    source_id = (investigation or {}).get("auto_triage_run_id")
    if not source_id:
        raise HTTPException(409, "Add a completed live investigation to this ticket before analyzing it")
    # The imported investigation is shared with the project. Only its capability
    # and opaque connector selectors are reused; its owner's chat and prompt are private.
    async with request.app.state.store.engine.connect() as connection:
        source = (await connection.execute(select(runs.c.contract_json, runs.c.status).where(
            runs.c.run_id == source_id, runs.c.tenant_id == principal.tenant_id,
            runs.c.project_id == principal.project_id))).mappings().first()
    if not source or source["status"] not in {"SUCCEEDED", "PARTIAL"}:
        raise HTTPException(409, "The ticket's recorded live investigation is unavailable")
    try:
        contract = RunContract.model_validate_json(source["contract_json"])
    except (ValidationError, TypeError):
        raise HTTPException(409, "The recorded investigation has no usable execution contract") from None
    if contract.mode != "live":
        raise HTTPException(409, "The ticket's recorded live investigation is unavailable")
    if (contract.tenant_id, contract.project_id) != (principal.tenant_id, principal.project_id):
        raise HTTPException(409, "The recorded investigation is outside this project")
    directions = {
        "five_whys": "Use ordered findings for successive causal why steps; stop where the evidence cannot establish the next cause.",
        "fishbone": "Group supported contributing factors by category and distinguish hypotheses from observed causes.",
        "kepner_tregoe": "Compare observed IS and IS NOT facts and distinguish verified differences from missing comparisons.",
        "fmea": "Describe supported failure modes, causes and effects. Do not assign severity, occurrence, detection or RPN scores without measured evidence and an explicit scale.",
        "fault_tree": "Describe the top event and evidence-supported necessary or sufficient conditions, identifying unverified branches.",
        "auto_ensemble": "Compare applicable causal methods, reconcile supported conclusions and explain any disagreements or evidence gaps.",
    }
    try:
        invocation = RunExecutionRequest(
            capability=contract.capability, incident_id=ticket_id,
            connector_selections=contract.request.connector_selections,
            prompt=f"Analyze ticket {ticket_id} using {body.method.replace('_', ' ')}. {directions[body.method]} "
                   "Collect fresh authorized evidence and cite its evidence IDs in findings. Clearly separate facts, hypotheses and uncertainties. "
                   "Do not invent causal certainty, numeric scores, probabilities or unavailable measurements. Recommend read-only next steps.",
        )
    except ValidationError:
        raise HTTPException(409, "The recorded ticket cannot form a valid investigation request") from None
    key = "triage-rca:" + content_hash(idempotency_key) if idempotency_key is not None else None
    run = await execute_run(invocation, request, principal, key, False)
    if run.mode != "live" or run.status not in {"SUCCEEDED", "PARTIAL"} or run.result is None:
        raise HTTPException(409, {"message": "The methodology investigation did not produce a live result",
                                  "run_id": run.run_id, "status": run.status})
    try:
        return await store.record_methodology_analysis(
            principal.tenant_id, principal.project_id, ticket_id, body.method, run, principal.subject)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None



@router.post("/runs/{run_id}/import")
async def import_investigation_run(run_id: str, request: Request, principal: Principal):
    """Share a persisted live investigation with the current project's triage workspace."""
    run = await request.app.state.store.get_run(run_id, principal)
    if not run:
        raise HTTPException(404, "Run not found")
    if run.mode != "live" or run.status not in {"SUCCEEDED", "PARTIAL"}:
        raise HTTPException(409, "Only completed live investigations can be added to triage")
    async with request.app.state.store.engine.connect() as connection:
        contract_json = await connection.scalar(select(runs.c.contract_json).where(
            runs.c.run_id == run_id, runs.c.tenant_id == principal.tenant_id, runs.c.project_id == principal.project_id))
    contract = RunContract.model_validate_json(contract_json)
    bundles = await request.app.state.store.list_by_run(run_id, principal)
    tickets = [json.loads(item.content_json) for item in bundles
               if item.source.connector in {"itsm", "jira"} and item.source.system in {"get_ticket", "itsm.get_ticket"}]
    ticket = next((item for item in tickets if isinstance(item, dict) and item.get("key")
                   and (not contract.request.incident_id or item["key"] == contract.request.incident_id)), None)
    if ticket is None:
        raise HTTPException(409, "The run needs recorded ticket evidence before it can be added to triage")
    store = await get_triage_store(request)
    try:
        return await store.import_run(principal, run, ticket, bundles, contract.request.connector_selections)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
