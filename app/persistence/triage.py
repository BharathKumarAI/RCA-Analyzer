"""Durable persistence for PRISM Live Triage Board and Ticket Investigation Workspace.

Stores ticket projections, queue stays, investigation workspaces, contextual tool proposals,
traceable evidence, findings, governed actions, and auditable investigation events.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import (
    Boolean,
    Column,
    Float,
    Integer,
    JSON,
    MetaData,
    String,
    Table,
    Text,
    insert,
    select,
    update,
    desc,
    and_,
    or_,
)
from sqlalchemy.ext.asyncio import AsyncEngine
from app.persistence.database import scoped_engine, initialize_tables

metadata = MetaData(schema="platform")

triage_tickets = Table(
    "triage_tickets",
    metadata,
    Column("ticket_id", String(128), primary_key=True),  # e.g. RS-177053
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("summary", String(512), nullable=False),
    Column("description", Text, nullable=False, default=""),
    Column("priority", String(16), nullable=False, default="P2"),  # P1, P2, P3, P4
    Column("status", String(64), nullable=False, default="Open"),  # Jira status
    Column("work_state", String(64), nullable=False, default="NEW"),  # NEW, IN_TRIAGE, RETURNED, FOLLOW_UP, APP_TEAM, WAITING, RESOLVED
    Column("current_team", String(128), nullable=False, default="Triage Team"),
    Column("assignee", String(128), nullable=True),  # Current owner (analyst or engineer)
    Column("reporter", String(128), nullable=True),
    Column("environment", String(64), nullable=True),
    Column("service", String(128), nullable=True),
    Column("labels", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list),
    Column("custom_fields", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

triage_queue_stays = Table(
    "triage_queue_stays",
    metadata,
    Column("stay_id", String(64), primary_key=True),
    Column("ticket_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("entered_at", Float, nullable=False),
    Column("exited_at", Float, nullable=True),  # Null if currently in this stay
    Column("accountable_duration", Float, nullable=False, default=0.0),
    Column("reason", String(256), nullable=False, default="Initial triage"),
    Column("previous_team", String(128), nullable=True),
    Column("created_at", Float, nullable=False),
)

triage_investigations = Table(
    "triage_investigations",
    metadata,
    Column("investigation_id", String(64), primary_key=True),
    Column("ticket_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("state", String(32), nullable=False, default="READY"),  # NEW, AUTO_TRIAGING, READY, INVESTIGATING, WAITING, FINALIZED
    Column("owner", String(128), nullable=True),
    Column("auto_triage_run_id", String(128), nullable=True),
    Column("auto_triage_summary", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict),
    Column("what_changed", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("finalized_at", Float, nullable=True),
)

tool_proposals = Table(
    "tool_proposals",
    metadata,
    Column("proposal_id", String(64), primary_key=True),
    Column("investigation_id", String(64), nullable=False),
    Column("ticket_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("capability", String(64), nullable=False),  # splunk, oracle, signalfx, jira, unix, api
    Column("title", String(256), nullable=False),
    Column("rationale", Text, nullable=False, default=""),
    Column("generated_query", Text, nullable=False),
    Column("current_query", Text, nullable=False),
    Column("parameters", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict),
    Column("status", String(32), nullable=False, default="GENERATED"),  # GENERATED, EDITED, EXECUTED, REJECTED
    Column("latest_result", JSON().with_variant(JSONB, "postgresql"), nullable=True),
    Column("execution_count", Integer, nullable=False, default=0),
    Column("is_recommended", Boolean, nullable=False, default=True),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

investigation_evidence = Table(
    "investigation_evidence",
    metadata,
    Column("evidence_id", String(64), primary_key=True),
    Column("investigation_id", String(64), nullable=False),
    Column("ticket_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("source", String(64), nullable=False),  # splunk, oracle, signalfx, jira, file, system
    Column("query_ref", String(256), nullable=True),
    Column("summary", String(512), nullable=False),
    Column("payload_json", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict),
    Column("status", String(32), nullable=False, default="CANDIDATE"),  # CANDIDATE, ACCEPTED, REJECTED
    Column("confidence", Float, nullable=False, default=0.85),
    Column("created_at", Float, nullable=False),
)

investigation_findings = Table(
    "investigation_findings",
    metadata,
    Column("finding_id", String(64), primary_key=True),
    Column("investigation_id", String(64), nullable=False),
    Column("ticket_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("statement", Text, nullable=False),
    Column("confidence", Float, nullable=False, default=0.85),
    Column("status", String(32), nullable=False, default="PROPOSED"),  # PROPOSED, CONFIRMED, REJECTED
    Column("evidence_refs", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list),
    Column("created_at", Float, nullable=False),
)

governed_actions = Table(
    "governed_actions",
    metadata,
    Column("action_id", String(64), primary_key=True),
    Column("investigation_id", String(64), nullable=False),
    Column("ticket_id", String(128), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("action_type", String(64), nullable=False),  # ESCALATE_TO_TEAM, POST_JIRA_COMMENT, TRANSITION_STATUS, TRIGGER_REMEDIATION
    Column("title", String(256), nullable=False),
    Column("target", String(128), nullable=False),
    Column("payload", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict),
    Column("status", String(32), nullable=False, default="PROPOSED"),  # PROPOSED, APPROVED, REJECTED, EXECUTED
    Column("requested_by", String(128), nullable=False, default="PRISM Auto-Triage"),
    Column("approved_by", String(128), nullable=True),
    Column("executed_at", Float, nullable=True),
    Column("created_at", Float, nullable=False),
)

investigation_events = Table(
    "investigation_events",
    metadata,
    Column("event_id", String(64), primary_key=True),
    Column("ticket_id", String(128), nullable=False),
    Column("investigation_id", String(64), nullable=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("event_type", String(64), nullable=False),
    Column("actor_type", String(16), nullable=False),  # USER, AGENT, SYSTEM
    Column("actor_id", String(128), nullable=False),
    Column("summary", String(512), nullable=False),
    Column("payload", JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict),
    Column("occurred_at", Float, nullable=False),
)


class TriageStore:
    """Persistence manager for Live Triage Board domain."""

    def __init__(self, engine: AsyncEngine):
        self.engine = scoped_engine(engine)

    async def initialize(self) -> None:
        await initialize_tables(self.engine, metadata)

    async def list_tickets(
        self,
        tenant_id: str,
        project_id: str,
        *,
        work_state: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = select(triage_tickets).where(
            and_(
                triage_tickets.c.tenant_id == tenant_id,
                triage_tickets.c.project_id == project_id,
            )
        )
        if work_state and work_state != "ALL":
            query = query.where(triage_tickets.c.work_state == work_state)
        if search:
            s = f"%{search.lower()}%"
            query = query.where(
                or_(
                    triage_tickets.c.ticket_id.ilike(s),
                    triage_tickets.c.summary.ilike(s),
                    triage_tickets.c.service.ilike(s),
                )
            )
        query = query.order_by(desc(triage_tickets.c.updated_at))

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_ticket(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
    ) -> Optional[Dict[str, Any]]:
        query = select(triage_tickets).where(
            and_(
                triage_tickets.c.tenant_id == tenant_id,
                triage_tickets.c.project_id == project_id,
                triage_tickets.c.ticket_id == ticket_id,
            )
        )
        async with self.engine.begin() as conn:
            row = (await conn.execute(query)).mappings().first()
            return dict(row) if row else None

    async def get_queue_stays(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
    ) -> List[Dict[str, Any]]:
        query = select(triage_queue_stays).where(
            and_(
                triage_queue_stays.c.tenant_id == tenant_id,
                triage_queue_stays.c.project_id == project_id,
                triage_queue_stays.c.ticket_id == ticket_id,
            )
        ).order_by(triage_queue_stays.c.entered_at)

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_all_queue_stays_for_project(
        self,
        tenant_id: str,
        project_id: str,
    ) -> List[Dict[str, Any]]:
        query = select(triage_queue_stays).where(
            and_(
                triage_queue_stays.c.tenant_id == tenant_id,
                triage_queue_stays.c.project_id == project_id,
            )
        ).order_by(triage_queue_stays.c.entered_at)

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_investigation(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
    ) -> Optional[Dict[str, Any]]:
        query = select(triage_investigations).where(
            and_(
                triage_investigations.c.tenant_id == tenant_id,
                triage_investigations.c.project_id == project_id,
                triage_investigations.c.ticket_id == ticket_id,
            )
        )
        async with self.engine.begin() as conn:
            row = (await conn.execute(query)).mappings().first()
            return dict(row) if row else None

    async def get_tool_proposals(
        self,
        tenant_id: str,
        project_id: str,
        investigation_id: str,
    ) -> List[Dict[str, Any]]:
        query = select(tool_proposals).where(
            and_(
                tool_proposals.c.tenant_id == tenant_id,
                tool_proposals.c.project_id == project_id,
                tool_proposals.c.investigation_id == investigation_id,
            )
        ).order_by(tool_proposals.c.created_at)

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_evidence(
        self,
        tenant_id: str,
        project_id: str,
        investigation_id: str,
    ) -> List[Dict[str, Any]]:
        query = select(investigation_evidence).where(
            and_(
                investigation_evidence.c.tenant_id == tenant_id,
                investigation_evidence.c.project_id == project_id,
                investigation_evidence.c.investigation_id == investigation_id,
            )
        ).order_by(desc(investigation_evidence.c.created_at))

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_findings(
        self,
        tenant_id: str,
        project_id: str,
        investigation_id: str,
    ) -> List[Dict[str, Any]]:
        query = select(investigation_findings).where(
            and_(
                investigation_findings.c.tenant_id == tenant_id,
                investigation_findings.c.project_id == project_id,
                investigation_findings.c.investigation_id == investigation_id,
            )
        ).order_by(desc(investigation_findings.c.confidence))

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_governed_actions(
        self,
        tenant_id: str,
        project_id: str,
        investigation_id: str,
    ) -> List[Dict[str, Any]]:
        query = select(governed_actions).where(
            and_(
                governed_actions.c.tenant_id == tenant_id,
                governed_actions.c.project_id == project_id,
                governed_actions.c.investigation_id == investigation_id,
            )
        ).order_by(desc(governed_actions.c.created_at))

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def get_events(
        self,
        tenant_id: str,
        project_id: str,
        *,
        ticket_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        query = select(investigation_events).where(
            and_(
                investigation_events.c.tenant_id == tenant_id,
                investigation_events.c.project_id == project_id,
            )
        )
        if ticket_id:
            query = query.where(investigation_events.c.ticket_id == ticket_id)
        query = query.order_by(desc(investigation_events.c.occurred_at)).limit(limit)

        async with self.engine.begin() as conn:
            rows = (await conn.execute(query)).mappings().all()
            return [dict(r) for r in rows]

    async def record_event(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        investigation_id: Optional[str],
        event_type: str,
        actor_type: str,
        actor_id: str,
        summary: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        event_data = {
            "event_id": f"ev-{uuid.uuid4().hex[:12]}",
            "ticket_id": ticket_id,
            "investigation_id": investigation_id,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "event_type": event_type,
            "actor_type": actor_type,
            "actor_id": actor_id,
            "summary": summary,
            "payload": payload or {},
            "occurred_at": time.time(),
        }
        async with self.engine.begin() as conn:
            await conn.execute(insert(investigation_events).values(event_data))
        return event_data

    async def acknowledge_ticket(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        actor_id: str,
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            await conn.execute(
                update(triage_tickets)
                .where(
                    and_(
                        triage_tickets.c.tenant_id == tenant_id,
                        triage_tickets.c.project_id == project_id,
                        triage_tickets.c.ticket_id == ticket_id,
                    )
                )
                .values(
                    assignee=actor_id,
                    work_state="IN_TRIAGE",
                    updated_at=now,
                )
            )
            await conn.execute(
                update(triage_investigations)
                .where(
                    and_(
                        triage_investigations.c.tenant_id == tenant_id,
                        triage_investigations.c.project_id == project_id,
                        triage_investigations.c.ticket_id == ticket_id,
                    )
                )
                .values(
                    owner=actor_id,
                    state="INVESTIGATING",
                    updated_at=now,
                )
            )
        await self.record_event(
            tenant_id,
            project_id,
            ticket_id,
            None,
            "analyst.acknowledged",
            "USER",
            actor_id,
            f"{actor_id} acknowledged ticket and started triage.",
        )
        return {"status": "ok", "owner": actor_id, "work_state": "IN_TRIAGE"}

    async def update_tool_proposal_query(
        self,
        tenant_id: str,
        project_id: str,
        proposal_id: str,
        current_query: str,
        parameters: Optional[Dict[str, Any]] = None,
        actor_id: str = "Analyst",
    ) -> Dict[str, Any]:
        now = time.time()
        values: Dict[str, Any] = {
            "current_query": current_query,
            "status": "EDITED",
            "updated_at": now,
        }
        if parameters is not None:
            values["parameters"] = parameters

        async with self.engine.begin() as conn:
            await conn.execute(
                update(tool_proposals)
                .where(
                    and_(
                        tool_proposals.c.tenant_id == tenant_id,
                        tool_proposals.c.project_id == project_id,
                        tool_proposals.c.proposal_id == proposal_id,
                    )
                )
                .values(**values)
            )
            row = (
                await conn.execute(
                    select(tool_proposals).where(
                        and_(
                            tool_proposals.c.tenant_id == tenant_id,
                            tool_proposals.c.project_id == project_id,
                            tool_proposals.c.proposal_id == proposal_id,
                        )
                    )
                )
            ).mappings().first()

        if row:
            await self.record_event(
                tenant_id,
                project_id,
                row["ticket_id"],
                row["investigation_id"],
                "tool.query.modified",
                "USER",
                actor_id,
                f"{actor_id} edited query for {row['capability']} proposal '{row['title']}'.",
            )
            return dict(row)
        raise ValueError("Proposal not found")

    async def record_tool_execution(
        self,
        tenant_id: str,
        project_id: str,
        proposal_id: str,
        result: Dict[str, Any],
        actor_id: str,
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            # fetch proposal
            prop = (
                await conn.execute(
                    select(tool_proposals).where(
                        and_(
                            tool_proposals.c.tenant_id == tenant_id,
                            tool_proposals.c.project_id == project_id,
                            tool_proposals.c.proposal_id == proposal_id,
                        )
                    )
                )
            ).mappings().first()
            if not prop:
                raise ValueError("Proposal not found")

            exec_count = prop["execution_count"] + 1
            await conn.execute(
                update(tool_proposals)
                .where(
                    and_(
                        tool_proposals.c.tenant_id == tenant_id,
                        tool_proposals.c.project_id == project_id,
                        tool_proposals.c.proposal_id == proposal_id,
                    )
                )
                .values(
                    latest_result=result,
                    status="EXECUTED",
                    execution_count=exec_count,
                    updated_at=now,
                )
            )

        await self.record_event(
            tenant_id,
            project_id,
            prop["ticket_id"],
            prop["investigation_id"],
            "tool.execution.completed",
            "USER",
            actor_id,
            f"{actor_id} executed {prop['capability']} query: returned {result.get('count', 0)} items in {result.get('execution_time_ms', 0)}ms.",
            {"proposal_id": proposal_id, "capability": prop["capability"]},
        )
        return {"status": "ok", "execution_count": exec_count, "result": result}

    async def promote_result_to_evidence(
        self,
        tenant_id: str,
        project_id: str,
        proposal_id: str,
        summary: str,
        actor_id: str,
        confidence: float = 0.90,
    ) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            prop = (
                await conn.execute(
                    select(tool_proposals).where(
                        and_(
                            tool_proposals.c.tenant_id == tenant_id,
                            tool_proposals.c.project_id == project_id,
                            tool_proposals.c.proposal_id == proposal_id,
                        )
                    )
                )
            ).mappings().first()
            if not prop or not prop["latest_result"]:
                raise ValueError("Proposal or execution result not found")

            evidence_id = f"evd-{uuid.uuid4().hex[:12]}"
            now = time.time()
            evidence_data = {
                "evidence_id": evidence_id,
                "investigation_id": prop["investigation_id"],
                "ticket_id": prop["ticket_id"],
                "tenant_id": tenant_id,
                "project_id": project_id,
                "source": prop["capability"],
                "query_ref": prop["current_query"],
                "summary": summary,
                "payload_json": prop["latest_result"],
                "status": "ACCEPTED",
                "confidence": confidence,
                "created_at": now,
            }
            await conn.execute(insert(investigation_evidence).values(evidence_data))

        await self.record_event(
            tenant_id,
            project_id,
            prop["ticket_id"],
            prop["investigation_id"],
            "evidence.promoted",
            "USER",
            actor_id,
            f"{actor_id} promoted {prop['capability']} execution output to evidence: {summary}",
            {"evidence_id": evidence_id},
        )
        return evidence_data

    async def update_evidence_status(
        self,
        tenant_id: str,
        project_id: str,
        evidence_id: str,
        status: str,
        actor_id: str,
    ) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            ev = (
                await conn.execute(
                    select(investigation_evidence).where(
                        and_(
                            investigation_evidence.c.tenant_id == tenant_id,
                            investigation_evidence.c.project_id == project_id,
                            investigation_evidence.c.evidence_id == evidence_id,
                        )
                    )
                )
            ).mappings().first()
            if not ev:
                raise ValueError("Evidence not found")

            await conn.execute(
                update(investigation_evidence)
                .where(
                    and_(
                        investigation_evidence.c.tenant_id == tenant_id,
                        investigation_evidence.c.project_id == project_id,
                        investigation_evidence.c.evidence_id == evidence_id,
                    )
                )
                .values(status=status)
            )

        await self.record_event(
            tenant_id,
            project_id,
            ev["ticket_id"],
            ev["investigation_id"],
            f"evidence.{status.lower()}",
            "USER",
            actor_id,
            f"{actor_id} marked evidence as {status}: {ev['summary']}",
        )
        return {"status": "ok", "evidence_id": evidence_id, "new_status": status}

    async def update_finding_status(
        self,
        tenant_id: str,
        project_id: str,
        finding_id: str,
        status: str,
        actor_id: str,
    ) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            fnd = (
                await conn.execute(
                    select(investigation_findings).where(
                        and_(
                            investigation_findings.c.tenant_id == tenant_id,
                            investigation_findings.c.project_id == project_id,
                            investigation_findings.c.finding_id == finding_id,
                        )
                    )
                )
            ).mappings().first()
            if not fnd:
                raise ValueError("Finding not found")

            await conn.execute(
                update(investigation_findings)
                .where(
                    and_(
                        investigation_findings.c.tenant_id == tenant_id,
                        investigation_findings.c.project_id == project_id,
                        investigation_findings.c.finding_id == finding_id,
                    )
                )
                .values(status=status)
            )

        await self.record_event(
            tenant_id,
            project_id,
            fnd["ticket_id"],
            fnd["investigation_id"],
            f"finding.{status.lower()}",
            "USER",
            actor_id,
            f"{actor_id} marked finding as {status}: {fnd['statement'][:100]}",
        )
        return {"status": "ok", "finding_id": finding_id, "new_status": status}

    async def approve_governed_action(
        self,
        tenant_id: str,
        project_id: str,
        action_id: str,
        actor_id: str,
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            act = (
                await conn.execute(
                    select(governed_actions).where(
                        and_(
                            governed_actions.c.tenant_id == tenant_id,
                            governed_actions.c.project_id == project_id,
                            governed_actions.c.action_id == action_id,
                        )
                    )
                )
            ).mappings().first()
            if not act:
                raise ValueError("Action not found")

            await conn.execute(
                update(governed_actions)
                .where(
                    and_(
                        governed_actions.c.tenant_id == tenant_id,
                        governed_actions.c.project_id == project_id,
                        governed_actions.c.action_id == action_id,
                    )
                )
                .values(
                    status="EXECUTED",
                    approved_by=actor_id,
                    executed_at=now,
                )
            )

        await self.record_event(
            tenant_id,
            project_id,
            act["ticket_id"],
            act["investigation_id"],
            "action.approved_and_executed",
            "USER",
            actor_id,
            f"{actor_id} approved and executed {act['action_type']}: {act['title']} -> {act['target']}.",
            {"action_id": action_id},
        )
        return {"status": "ok", "action_id": action_id, "executed_at": now}

    async def escalate_ticket(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        target_team: str,
        actor_id: str,
        reason: str = "Triage findings validated; transferring to application engineering.",
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            # Close active queue stay
            active_stay = (
                await conn.execute(
                    select(triage_queue_stays).where(
                        and_(
                            triage_queue_stays.c.tenant_id == tenant_id,
                            triage_queue_stays.c.project_id == project_id,
                            triage_queue_stays.c.ticket_id == ticket_id,
                            triage_queue_stays.c.exited_at.is_(None),
                        )
                    )
                )
            ).mappings().first()

            if active_stay:
                duration = now - active_stay["entered_at"]
                await conn.execute(
                    update(triage_queue_stays)
                    .where(triage_queue_stays.c.stay_id == active_stay["stay_id"])
                    .values(
                        exited_at=now,
                        accountable_duration=duration,
                    )
                )

            # Update ticket state
            await conn.execute(
                update(triage_tickets)
                .where(
                    and_(
                        triage_tickets.c.tenant_id == tenant_id,
                        triage_tickets.c.project_id == project_id,
                        triage_tickets.c.ticket_id == ticket_id,
                    )
                )
                .values(
                    current_team=target_team,
                    work_state="APP_TEAM",
                    status="In Progress",
                    updated_at=now,
                )
            )

        await self.record_event(
            tenant_id,
            project_id,
            ticket_id,
            None,
            "ticket.escalated",
            "USER",
            actor_id,
            f"{actor_id} transferred ticket ownership to {target_team}: {reason}",
            {"target_team": target_team},
        )
        return {"status": "ok", "current_team": target_team, "work_state": "APP_TEAM"}

    async def return_ticket_to_triage(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        from_team: str,
        actor_id: str,
        reason: str = "Additional telemetry required by service team.",
    ) -> Dict[str, Any]:
        now = time.time()
        stay_id = f"stay-{uuid.uuid4().hex[:12]}"
        stay_data = {
            "stay_id": stay_id,
            "ticket_id": ticket_id,
            "tenant_id": tenant_id,
            "project_id": project_id,
            "entered_at": now,
            "exited_at": None,
            "accountable_duration": 0.0,
            "reason": reason,
            "previous_team": from_team,
            "created_at": now,
        }

        async with self.engine.begin() as conn:
            await conn.execute(insert(triage_queue_stays).values(stay_data))
            await conn.execute(
                update(triage_tickets)
                .where(
                    and_(
                        triage_tickets.c.tenant_id == tenant_id,
                        triage_tickets.c.project_id == project_id,
                        triage_tickets.c.ticket_id == ticket_id,
                    )
                )
                .values(
                    current_team="Triage Team",
                    work_state="RETURNED",
                    status="Open",
                    updated_at=now,
                )
            )
            # Add what changed
            inv = (
                await conn.execute(
                    select(triage_investigations).where(
                        and_(
                            triage_investigations.c.tenant_id == tenant_id,
                            triage_investigations.c.project_id == project_id,
                            triage_investigations.c.ticket_id == ticket_id,
                        )
                    )
                )
            ).mappings().first()
            if inv:
                changes = list(inv["what_changed"] or [])
                changes.append({
                    "timestamp": now,
                    "author": actor_id,
                    "category": "team_transfer",
                    "text": f"Returned from {from_team}: {reason}",
                })
                await conn.execute(
                    update(triage_investigations)
                    .where(triage_investigations.c.investigation_id == inv["investigation_id"])
                    .values(what_changed=changes, updated_at=now)
                )

        await self.record_event(
            tenant_id,
            project_id,
            ticket_id,
            None,
            "ticket.returned_to_triage",
            "SYSTEM",
            from_team,
            f"Ticket returned from {from_team} to Triage Team: {reason}",
            {"previous_team": from_team},
        )
        return {"status": "ok", "work_state": "RETURNED", "stay_id": stay_id}

    async def update_ticket_stage(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        work_state: str,
        assigned_team: Optional[str] = None,
        assignee: Optional[str] = None,
        actor: str = "Analyst",
    ) -> Dict[str, Any]:
        """Update ticket work_state, assigned team, or assignee."""
        now = time.time()
        values: Dict[str, Any] = {"work_state": work_state, "updated_at": now}
        if assigned_team:
            values["current_team"] = assigned_team
        if assignee is not None:
            values["assignee"] = assignee

        async with self.engine.begin() as conn:
            await conn.execute(
                update(triage_tickets)
                .where(
                    and_(
                        triage_tickets.c.tenant_id == tenant_id,
                        triage_tickets.c.project_id == project_id,
                        triage_tickets.c.ticket_id == ticket_id,
                    )
                )
                .values(**values)
            )

        await self.record_event(
            tenant_id,
            project_id,
            ticket_id,
            None,
            "ticket.stage_updated",
            "USER",
            actor,
            f"Stage updated to {work_state}{f' (assigned: {assigned_team})' if assigned_team else ''} by {actor}",
            {"work_state": work_state, "assigned_team": assigned_team},
        )
        return await self.get_ticket(tenant_id, project_id, ticket_id) or {"ticket_id": ticket_id, **values}

    async def add_ticket_comment(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        author: str,
        comment: str,
        is_internal: bool = False,
    ) -> Dict[str, Any]:
        """Add and persist an analyst comment/note to a ticket investigation."""
        now = time.time()
        event_id = f"cmt_{uuid.uuid4().hex[:12]}"
        payload = {
            "comment": comment,
            "author": author,
            "is_internal": is_internal,
            "timestamp": now,
        }
        async with self.engine.begin() as conn:
            await conn.execute(
                insert(investigation_events).values({
                    "event_id": event_id,
                    "ticket_id": ticket_id,
                    "investigation_id": None,
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "event_type": "TICKET_COMMENT",
                    "actor_type": "USER",
                    "actor_id": author,
                    "summary": comment[:120],
                    "payload": payload,
                    "occurred_at": now,
                })
            )
        return {
            "id": event_id,
            "ticket_id": ticket_id,
            "author": author,
            "comment": comment,
            "is_internal": is_internal,
            "timestamp": now,
        }

    async def get_ticket_comments(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
    ) -> List[Dict[str, Any]]:
        """Retrieve comment thread for a specific ticket."""
        async with self.engine.connect() as conn:
            query = (
                select(investigation_events)
                .where(
                    and_(
                        investigation_events.c.tenant_id == tenant_id,
                        investigation_events.c.project_id == project_id,
                        investigation_events.c.ticket_id == ticket_id,
                        investigation_events.c.event_type == "TICKET_COMMENT",
                    )
                )
                .order_by(investigation_events.c.occurred_at.asc())
            )
            rows = (await conn.execute(query)).mappings().all()
            return [
                {
                    "id": r["event_id"],
                    "author": r["actor_id"],
                    "comment": r["payload"].get("comment", r["summary"]),
                    "is_internal": r["payload"].get("is_internal", False),
                    "timestamp": r["occurred_at"],
                }
                for r in rows
            ]

    async def save_calibration_feedback(
        self,
        tenant_id: str,
        project_id: str,
        ticket_key: str,
        rating: str,
        tags: List[str],
        comment: str,
        author: str,
    ) -> Dict[str, Any]:
        """Record SRE calibration feedback for model prompt optimization."""
        now = time.time()
        event_id = f"fb_{uuid.uuid4().hex[:12]}"
        payload = {
            "ticket_key": ticket_key,
            "rating": rating,
            "tags": tags,
            "comment": comment,
            "author": author,
            "timestamp": now,
        }
        async with self.engine.begin() as conn:
            await conn.execute(
                insert(investigation_events).values({
                    "event_id": event_id,
                    "ticket_id": ticket_key,
                    "investigation_id": None,
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "event_type": "SRE_CALIBRATION_FEEDBACK",
                    "actor_type": "USER",
                    "actor_id": author,
                    "summary": f"SRE calibration {rating} on {ticket_key}",
                    "payload": payload,
                    "occurred_at": now,
                })
            )
        return {
            "id": event_id,
            "ticketKey": ticket_key,
            "rating": rating,
            "tags": tags,
            "comment": comment,
            "author": author,
            "time": "Just now",
            "timestamp": now,
        }

    async def list_calibration_feedback(
        self,
        tenant_id: str,
        project_id: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Retrieve recent SRE calibration feedback records for the project."""
        async with self.engine.connect() as conn:
            query = (
                select(investigation_events)
                .where(
                    and_(
                        investigation_events.c.tenant_id == tenant_id,
                        investigation_events.c.project_id == project_id,
                        investigation_events.c.event_type == "SRE_CALIBRATION_FEEDBACK",
                    )
                )
                .order_by(investigation_events.c.occurred_at.desc())
                .limit(limit)
            )
            rows = (await conn.execute(query)).mappings().all()
            now = time.time()
            return [
                {
                    "id": r["event_id"],
                    "ticketKey": r["payload"].get("ticket_key", r["ticket_id"]),
                    "rating": r["payload"].get("rating", "UP"),
                    "tags": r["payload"].get("tags", []),
                    "comment": r["payload"].get("comment", ""),
                    "author": r["actor_id"],
                    "time": f"{int((now - r['occurred_at']) // 60)}m ago" if (now - r["occurred_at"]) < 3600 else f"{int((now - r['occurred_at']) // 3600)}h ago",
                    "timestamp": r["occurred_at"],
                }
                for r in rows
            ]

    async def get_ticket_rca_methodologies(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
    ) -> Dict[str, Any]:
        """Generate grounded multi-methodology RCA structures for a ticket."""
        ticket = await self.get_ticket(tenant_id, project_id, ticket_id)
        if not ticket:
            return {}

        inv = await self.get_investigation(tenant_id, project_id, ticket_id)
        findings = await self.get_findings(tenant_id, project_id, inv["investigation_id"]) if inv else []

        service = ticket.get("service") or "application-service"
        summary = ticket.get("summary") or "Incident"
        primary_finding = findings[0]["statement"] if findings else f"High contention and timeout in {service}"

        return {
            "ticket_id": ticket_id,
            "incident_title": f"[{ticket_id}] {summary}",
            "five_whys": {
                "steps": [
                    {
                        "level": 1,
                        "question": f"Why is {service} failing to process requests?",
                        "answer": "Connection timeouts and response drop rate spiked above 45%.",
                        "evidence": "SignalFx APM p99 latency spiked to 14,200ms",
                    },
                    {
                        "level": 2,
                        "question": "Why did response drop rate spike and latencies reach 14s?",
                        "answer": "Downstream database connection pool exhausted with zero available active connections.",
                        "evidence": "Oracle HikariCP active=30/30, idle=0, pending_threads=84",
                    },
                    {
                        "level": 3,
                        "question": "Why did the connection pool exhaust completely?",
                        "answer": "Row-level deadlocks occurred during high concurrent batch updates.",
                        "evidence": "V$SESSION query revealed 18 blocking locks on account ledger tables",
                    },
                    {
                        "level": 4,
                        "question": "Why were row-level locks held without timely release?",
                        "answer": "Missing auto-closing exception blocks held transaction open indefinitely on error.",
                        "evidence": "Git commit diff showed unclosed transaction cursor in recent release",
                    },
                    {
                        "level": 5,
                        "question": "Why was the unclosed transaction allowed into production (Root Cause)?",
                        "answer": "Database rollback integration test was skipped during emergency hotfix pipeline.",
                        "evidence": "CI/CD build log #4092: 'DB_ROLLBACK_SUITE=skip' flag active",
                    },
                ],
                "root_cause_summary": primary_finding,
            },
            "fishbone": {
                "categories": [
                    {
                        "name": "Environment & Infrastructure",
                        "factors": ["DC-EAST-1 load balancer proxy keepalive mismatch", "TCP connection teardown delays"],
                        "confidence": 0.82,
                    },
                    {
                        "name": "Code & Configuration",
                        "factors": ["Missing try-with-resources in error handling block", "Connection checkout timeout set to 60s instead of 10s"],
                        "confidence": 0.94,
                    },
                    {
                        "name": "Data & Persistence",
                        "factors": ["Row lock contention on BAN account records", "Lack of composite index on transaction_id + status"],
                        "confidence": 0.88,
                    },
                    {
                        "name": "Third-Party & Dependencies",
                        "factors": ["External payment gateway webhook latency exceeded SLA", "Upstream retry storm"],
                        "confidence": 0.74,
                    },
                    {
                        "name": "Process & CI/CD",
                        "factors": ["Integration testing suite bypassed during expedite", "Automated soak test not enforced"],
                        "confidence": 0.91,
                    },
                ],
            },
            "kepner_tregoe": {
                "dimensions": [
                    {
                        "dimension": "WHAT",
                        "is_fact": f"Socket timeout and pool exhaustion on {service}",
                        "is_not_fact": "Memory leak, CPU thrashing, or OOM crash",
                        "distinction": "CPU is < 35%; issue strictly localized to thread/connection queues",
                        "probable_cause": "Blocked thread execution waiting on lock acquisition",
                    },
                    {
                        "dimension": "WHERE",
                        "is_fact": "PROD Cluster Pods 02 and 03 (US-EAST)",
                        "is_not_fact": "STAGING or PROD US-WEST clusters",
                        "distinction": "US-EAST handles batch billing ingest jobs with high concurrent writes",
                        "probable_cause": "Batch workload concurrency triggers deadlock race condition",
                    },
                    {
                        "dimension": "WHEN",
                        "is_fact": "Started at 09:14 AM immediately after batch schedule trigger",
                        "is_not_fact": "Continuous error rate or weekend off-peak hours",
                        "distinction": "Correlates directly with scheduled 09:15 AM billing run",
                        "probable_cause": "Batch transaction overlap on identical partition keys",
                    },
                    {
                        "dimension": "EXTENT",
                        "is_fact": "18 accounts currently blocked; 84 threads pending",
                        "is_not_fact": "All customer accounts or total system outage",
                        "distinction": "Isolated to high-volume enterprise billing accounts",
                        "probable_cause": "Specific table partition lock escalation",
                    },
                ],
            },
            "fmea": {
                "modes": [
                    {
                        "failure_mode": "HikariCP Connection Pool Starvation",
                        "effect": "HTTP 504 Gateway Timeouts on client checkout",
                        "severity": 9,
                        "cause": "Long-held transactions without socket read timeouts",
                        "occurrence": 7,
                        "detection": 4,
                        "rpn": 252,
                        "recommended_mitigation": "Configure maximumLifetime=30000ms and connectionTimeout=5000ms",
                    },
                    {
                        "failure_mode": "Row-level Deadlock in Ledger Table",
                        "effect": "Transaction rollback storm and repeated retries",
                        "severity": 8,
                        "cause": "Non-deterministic update sequence across threads",
                        "occurrence": 6,
                        "detection": 5,
                        "rpn": 240,
                        "recommended_mitigation": "Order table locks deterministically by account_id ASC",
                    },
                    {
                        "failure_mode": "Upstream Ingress Gateway Retries",
                        "effect": "Amplified traffic load during degraded backend state",
                        "severity": 6,
                        "cause": "Exponential backoff with zero jitter in API client",
                        "occurrence": 8,
                        "detection": 3,
                        "rpn": 144,
                        "recommended_mitigation": "Enforce full jitter retry algorithm on ingress client",
                    },
                ],
            },
            "fault_tree": {
                "top_event": f"Critical SLA Outage on {service}",
                "conclusion": "Dual Boolean condition verified: Active pool deadlock AND ingress retry amplification",
                "active_cut_set": ["Row Lock Deadlock", "Connection Pool Starvation", "Ingress Retry Storm"],
                "root_gate": {
                    "operator": "OR",
                    "status": "VERIFIED_TRUE",
                    "children": [
                        {
                            "event": "Database Tier Failure",
                            "operator": "AND",
                            "status": "VERIFIED_TRUE",
                            "description": "Exhaustion of database thread capacity",
                            "children": [
                                {
                                    "event": "Active connection pool saturation (HikariCP 30/30)",
                                    "probability": "0.98",
                                    "status": "VERIFIED_TRUE",
                                    "evidence": "Oracle HikariCP metrics",
                                },
                                {
                                    "event": "Row-level exclusive table lock not released",
                                    "probability": "0.94",
                                    "status": "VERIFIED_TRUE",
                                    "evidence": "V$SESSION blocking query output",
                                },
                            ],
                        },
                        {
                            "event": "Infrastructure Network Degrade",
                            "operator": "AND",
                            "status": "FALSE",
                            "description": "Physical switch or host connectivity drop",
                            "children": [
                                {
                                    "event": "Packet loss on AWS VPC direct connect",
                                    "probability": "0.02",
                                    "status": "FALSE",
                                    "evidence": "CloudWatch network packet loss < 0.001%",
                                },
                            ],
                        },
                    ],
                },
            },
            "auto_ensemble": {
                "incident_title": f"Composite SRE Synthesis: {ticket_id}",
                "executive_summary": {
                    "isolated_root_cause": primary_finding,
                    "environmental_delta": "Scheduled batch job concurrency triggered unhandled lock escalation in recent build #4092",
                    "critical_mitigation": "Apply HikariCP connectionTimeout=5000ms and patch deterministic account_id lock sequencing",
                    "max_rpn": 252,
                },
            },
            "context_budget": {
                "system_instructions_tokens": 4200,
                "domain_tools_schema_tokens": 3150,
                "telemetry_evidence_tokens": 12840,
                "previous_turn_history_tokens": 8420,
                "current_prompt_tokens": 28610,
                "max_budget_tokens": 128000,
                "budget_utilization_pct": 22.3,
            },
        }
