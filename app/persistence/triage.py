"""Durable persistence for PRISM Live Triage Board and Ticket Investigation Workspace.

Stores ticket projections, queue stays, investigation workspaces, contextual tool proposals,
traceable evidence, findings, governed actions, and auditable investigation events.
"""

from __future__ import annotations

import time
from datetime import datetime
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
    func,
    or_,
)
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.exc import IntegrityError
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

    async def _transition_queue(self, connection, tenant_id, project_id, ticket_id, work_state, now,
                                reason="Local workspace stage transition", previous_team=None):
        await connection.execute(select(triage_tickets.c.ticket_id).where(
            triage_tickets.c.tenant_id == tenant_id, triage_tickets.c.project_id == project_id,
            triage_tickets.c.ticket_id == ticket_id).with_for_update())
        active = (await connection.execute(select(triage_queue_stays).where(
            triage_queue_stays.c.tenant_id == tenant_id, triage_queue_stays.c.project_id == project_id,
            triage_queue_stays.c.ticket_id == ticket_id, triage_queue_stays.c.exited_at.is_(None)))).mappings().all()
        if work_state in {"APP_TEAM", "WAITING", "RESOLVED"}:
            for stay in active:
                await connection.execute(update(triage_queue_stays).where(
                    triage_queue_stays.c.stay_id == stay["stay_id"]).values(
                    exited_at=now, accountable_duration=max(0, now - stay["entered_at"])))
            return None
        if active:
            return active[0]["stay_id"]
        stay_id = "stay-" + uuid.uuid4().hex
        await connection.execute(insert(triage_queue_stays).values(
            tenant_id=tenant_id, project_id=project_id, ticket_id=ticket_id, stay_id=stay_id,
            entered_at=now, created_at=now, reason=reason, previous_team=previous_team))
        return stay_id

    async def acknowledge_ticket(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        actor_id: str,
    ) -> Dict[str, Any]:
        if not await self.get_ticket(tenant_id, project_id, ticket_id):
            raise ValueError("Ticket not found")
        now = time.time()
        async with self.engine.begin() as conn:
            await self._transition_queue(conn, tenant_id, project_id, ticket_id, "IN_TRIAGE", now)
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
            "latest_result": None,
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
        *, expected_query: str | None = None,
        expected_parameters: Dict[str, Any] | None = None,
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
                    ).with_for_update()
                )
            ).mappings().first()
            if not prop:
                raise ValueError("Proposal not found")

            if ((expected_query is not None and prop["current_query"] != expected_query)
                    or (expected_parameters is not None and (prop["parameters"] or {}) != expected_parameters)):
                raise ValueError("Proposal changed during execution; the recorded run remains available")
            if (prop["latest_result"] or {}).get("run_id") == result.get("run_id") and result.get("run_id"):
                return {"status": "ok", "execution_count": prop["execution_count"], "result": prop["latest_result"]}
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
        confidence: float = 0.0,
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
                    ).with_for_update()
                )
            ).mappings().first()
            if not prop or not prop["latest_result"] or not prop["latest_result"].get("run_id") or not prop["latest_result"].get("items"):
                raise ValueError("Proposal or execution result not found")

            evidence_id = "evd-" + uuid.uuid5(uuid.NAMESPACE_URL,
                str((tenant_id, project_id, proposal_id, prop["latest_result"]["run_id"]))).hex
            existing = (await conn.execute(select(investigation_evidence).where(
                investigation_evidence.c.tenant_id == tenant_id, investigation_evidence.c.project_id == project_id,
                investigation_evidence.c.evidence_id == evidence_id))).mappings().first()
            if existing:
                return dict(existing)
            now = time.time()
            evidence_data = {
                "evidence_id": evidence_id,
                "investigation_id": prop["investigation_id"],
                "ticket_id": prop["ticket_id"],
                "tenant_id": tenant_id,
                "project_id": project_id,
                "source": prop["capability"],
                "query_ref": prop["latest_result"]["run_id"],
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
                    status="APPROVED",
                    approved_by=actor_id,
                    executed_at=None,
                )
            )

        await self.record_event(
            tenant_id,
            project_id,
            act["ticket_id"],
            act["investigation_id"],
            "action.approved",
            "USER",
            actor_id,
            f"{actor_id} recorded local approval for {act['action_type']}: {act['title']} -> {act['target']}.",
            {"action_id": action_id},
        )
        return {"status": "ok", "action_id": action_id, "executed_at": None}

    async def escalate_ticket(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
        target_team: str,
        actor_id: str,
        reason: str = "Triage findings validated; transferring to application engineering.",
    ) -> Dict[str, Any]:
        if not await self.get_ticket(tenant_id, project_id, ticket_id):
            raise ValueError("Ticket not found")
        now = time.time()
        async with self.engine.begin() as conn:
            await self._transition_queue(conn, tenant_id, project_id, ticket_id, "APP_TEAM", now)

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
        if not await self.get_ticket(tenant_id, project_id, ticket_id):
            raise ValueError("Ticket not found")
        now = time.time()
        async with self.engine.begin() as conn:
            stay_id = await self._transition_queue(conn, tenant_id, project_id, ticket_id, "RETURNED", now,
                                                  reason=reason, previous_team=from_team)
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
            "USER",
            actor_id,
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
        if not await self.get_ticket(tenant_id, project_id, ticket_id):
            raise ValueError("Ticket not found")
        now = time.time()
        values: Dict[str, Any] = {"work_state": work_state, "updated_at": now}
        if assigned_team:
            values["current_team"] = assigned_team
        if assignee is not None:
            values["assignee"] = assignee

        async with self.engine.begin() as conn:
            await self._transition_queue(conn, tenant_id, project_id, ticket_id, work_state, now)
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
        return await self.get_ticket(tenant_id, project_id, ticket_id)

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
        if not await self.get_ticket(tenant_id, project_id, ticket_id):
            raise ValueError("Ticket not found")
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
            # Bind feedback to the source version at submission, even if the ticket is
            # subsequently refreshed from another run.
            ticket = (await conn.execute(select(triage_tickets).where(
                triage_tickets.c.tenant_id == tenant_id,
                triage_tickets.c.project_id == project_id,
                triage_tickets.c.ticket_id == ticket_key,
            ).with_for_update())).mappings().first()
            if ticket is None:
                raise ValueError("Ticket not found")
            investigation_id = await conn.scalar(select(triage_investigations.c.investigation_id).where(
                triage_investigations.c.tenant_id == tenant_id,
                triage_investigations.c.project_id == project_id,
                triage_investigations.c.ticket_id == ticket_key,
            ).order_by(triage_investigations.c.created_at.desc()).limit(1))
            payload["source_run_id"] = (ticket["custom_fields"] or {}).get("source_run_id")
            payload["investigation_id"] = investigation_id
            await conn.execute(
                insert(investigation_events).values({
                    "event_id": event_id,
                    "ticket_id": ticket_key,
                    "investigation_id": investigation_id,
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
            "source_run_id": payload["source_run_id"],
            "investigation_id": investigation_id,
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
                    "source_run_id": r["payload"].get("source_run_id"),
                    "investigation_id": r["investigation_id"],
                }
                for r in rows
            ]

    async def get_ticket_rca_methodologies(
        self,
        tenant_id: str,
        project_id: str,
        ticket_id: str,
    ) -> Dict[str, Any]:
        """Return persisted methodology results and compatible empty legacy structures."""
        ticket = await self.get_ticket(tenant_id, project_id, ticket_id)
        if not ticket:
            return {}

        inv = await self.get_investigation(tenant_id, project_id, ticket_id)
        findings = await self.get_findings(tenant_id, project_id, inv["investigation_id"]) if inv else []

        latest = select(
            investigation_events.c.payload, investigation_events.c.occurred_at,
            func.row_number().over(
                partition_by=investigation_events.c.payload["method"].as_string(),
                order_by=(investigation_events.c.occurred_at.desc(), investigation_events.c.event_id.desc()),
            ).label("position"),
        ).where(
            investigation_events.c.tenant_id == tenant_id, investigation_events.c.project_id == project_id,
            investigation_events.c.ticket_id == ticket_id,
            investigation_events.c.event_type == "investigation.methodology",
        ).subquery()
        async with self.engine.connect() as connection:
            rows = (await connection.execute(select(latest.c.payload, latest.c.occurred_at).where(
                latest.c.position == 1))).mappings().all()
        analyses = {row["payload"]["method"]: {
            "run_id": row["payload"]["run_id"], "status": row["payload"]["status"],
            "result": row["payload"]["result"], "created_at": row["occurred_at"],
        } for row in rows}
        return {
            "ticket_id": ticket_id, "incident_title": ticket["summary"],
            "available_methods": sorted(analyses), "analyses": analyses,
            "five_whys": {"steps": [], "root_cause_summary": None},
            "fishbone": {"categories": []}, "kepner_tregoe": {"dimensions": []},
            "fmea": {"modes": []}, "fault_tree": {"top_event": None, "conclusion": None, "active_cut_set": [], "root_gate": None},
            "auto_ensemble": {"incident_title": ticket["summary"], "executive_summary": {
                "isolated_root_cause": None, "environmental_delta": None,
                "critical_mitigation": None, "max_rpn": None}},
            "context_budget": None,
            "findings": findings,
        }

    async def record_methodology_analysis(self, tenant_id, project_id, ticket_id, method, run, actor_id):
        """Publish a completed native result to the ticket once, using its run identity."""
        payload = {"method": method, "run_id": run.run_id, "status": run.status,
                   "result": run.result.model_dump(mode="json")}
        event_id = "method-" + run.run_id
        async with self.engine.begin() as connection:
            ticket = await connection.scalar(select(triage_tickets.c.ticket_id).where(
                triage_tickets.c.tenant_id == tenant_id, triage_tickets.c.project_id == project_id,
                triage_tickets.c.ticket_id == ticket_id).with_for_update())
            if ticket is None:
                raise ValueError("Ticket not found")
            existing = (await connection.execute(select(investigation_events).where(
                investigation_events.c.tenant_id == tenant_id, investigation_events.c.project_id == project_id,
                investigation_events.c.event_id == event_id))).mappings().first()
            if existing:
                if existing["ticket_id"] != ticket_id or existing["payload"]["method"] != method:
                    raise ValueError("The recorded run already belongs to another methodology")
                return {**existing["payload"], "created_at": existing["occurred_at"]}
            investigation_id = await connection.scalar(select(triage_investigations.c.investigation_id).where(
                triage_investigations.c.tenant_id == tenant_id, triage_investigations.c.project_id == project_id,
                triage_investigations.c.ticket_id == ticket_id))
            await connection.execute(insert(investigation_events).values(
                tenant_id=tenant_id, project_id=project_id, ticket_id=ticket_id,
                investigation_id=investigation_id, event_id=event_id,
                event_type="investigation.methodology", actor_type="USER", actor_id=actor_id,
                summary=f"Recorded {method.replace('_', ' ')} investigation", payload=payload, occurred_at=run.created_at))
        return {**payload, "created_at": run.created_at}

    async def get_tool_proposal(self, tenant_id, project_id, proposal_id):
        async with self.engine.connect() as connection:
            row = (await connection.execute(select(tool_proposals).where(
                tool_proposals.c.tenant_id == tenant_id, tool_proposals.c.project_id == project_id,
                tool_proposals.c.proposal_id == proposal_id))).mappings().first()
        return dict(row) if row else None

    async def import_run(self, principal, run, ticket, bundles, connector_selections=None):
        """Atomically project authentic run evidence; repeat imports do not duplicate records."""
        tenant, project, ticket_id = principal.tenant_id, principal.project_id, str(ticket["key"])
        if len(ticket_id) > 128 or not str(ticket.get("summary") or "").strip():
            raise ValueError("Recorded ticket has no valid identity or summary")
        now = time.time()
        def timestamp(value):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return parsed.timestamp() if parsed.tzinfo else None
            except (TypeError, ValueError, AttributeError, OverflowError):
                return None
        source_fields = {
            "summary": str(ticket["summary"])[:512], "description": str(ticket.get("description") or ""),
            "priority": str(ticket.get("priority") or "UNKNOWN")[:16], "status": str(ticket.get("status") or "Unknown")[:64],
            "reporter": str(ticket["reporter"])[:128] if ticket.get("reporter") else None,
            "environment": str(ticket["environment"])[:64] if ticket.get("environment") else None,
            "labels": ticket.get("labels") or [],
        }
        source_metadata = {
            "source_run_id": run.run_id, "source_run_created_at": run.created_at,
            "source_created_at": timestamp(ticket.get("created")),
            "source_resolved_at": timestamp(ticket.get("resolved")),
        }
        scope = {"tenant_id": tenant, "project_id": project, "ticket_id": ticket_id}
        async with self.engine.begin() as connection:
            # Serializes concurrent imports and local transitions on an existing ticket.
            row = (await connection.execute(select(triage_tickets).where(
                triage_tickets.c.tenant_id == tenant, triage_tickets.c.project_id == project,
                triage_tickets.c.ticket_id == ticket_id).with_for_update())).mappings().first()
            if row is None:
                created = False
                try:
                    async with connection.begin_nested():
                        await connection.execute(insert(triage_tickets).values(**scope,
                            **source_fields, custom_fields=source_metadata,
                            assignee=str(ticket["assignee"])[:128] if ticket.get("assignee") else None,
                            created_at=source_metadata["source_created_at"] if source_metadata["source_created_at"] is not None else now,
                            updated_at=now))
                        created = True
                except IntegrityError:
                    row = (await connection.execute(select(triage_tickets).where(
                        triage_tickets.c.tenant_id == tenant, triage_tickets.c.project_id == project,
                        triage_tickets.c.ticket_id == ticket_id).with_for_update())).mappings().first()
                    if row is None:
                        raise
                if created:
                    await connection.execute(insert(triage_queue_stays).values(**scope,
                        stay_id="stay-" + uuid.uuid4().hex, entered_at=now, created_at=now,
                        reason="Added from recorded investigation"))
            inv = (await connection.execute(select(triage_investigations).where(
                triage_investigations.c.tenant_id == tenant, triage_investigations.c.project_id == project,
                triage_investigations.c.ticket_id == ticket_id))).mappings().first()
            investigation_id = inv["investigation_id"] if inv else "inv-" + uuid.uuid4().hex
            if inv is None:
                await connection.execute(insert(triage_investigations).values(**scope,
                    investigation_id=investigation_id, auto_triage_run_id=run.run_id,
                    auto_triage_summary=run.result.model_dump(mode="json") if run.result else {},
                    created_at=now, updated_at=now))
            imported = await connection.scalar(select(investigation_events.c.event_id).where(
                investigation_events.c.tenant_id == tenant, investigation_events.c.project_id == project,
                investigation_events.c.event_id == "import-" + run.run_id))
            if imported:
                return {"ticket_id": ticket_id, "investigation_id": investigation_id, "run_id": run.run_id}
            newest = row is None or run.created_at >= ((row["custom_fields"] or {}).get("source_run_created_at") or 0)
            if row is not None and newest:
                await connection.execute(update(triage_tickets).where(
                    triage_tickets.c.tenant_id == tenant, triage_tickets.c.project_id == project,
                    triage_tickets.c.ticket_id == ticket_id).values(
                    **source_fields, custom_fields={**(row["custom_fields"] or {}), **source_metadata}, updated_at=now))
            for bundle in bundles:
                await connection.execute(insert(investigation_evidence).values(**scope,
                    investigation_id=investigation_id, evidence_id=bundle.evidence_id,
                    source=bundle.source.connector, query_ref=bundle.run_id,
                    summary=f"Recorded {bundle.source.system} evidence", payload_json=bundle.model_dump(mode="json"),
                    confidence=0, status="CANDIDATE", created_at=now))
            for index, finding in enumerate(run.result.findings if run.result else []):
                await connection.execute(insert(investigation_findings).values(**scope,
                    investigation_id=investigation_id, finding_id=f"fnd-{run.run_id}-{index}",
                    statement=finding.summary, confidence=0, status="PROPOSED",
                    evidence_refs=finding.evidence_ids, created_at=now))
            for index, question in enumerate(run.result.follow_up_questions if run.result else []):
                await connection.execute(insert(tool_proposals).values(**scope,
                    investigation_id=investigation_id, proposal_id=f"prop-{run.run_id}-{index}",
                    capability=run.capability, title="Follow-up investigation", rationale="Saved follow-up question from the recorded investigation",
                    generated_query=question, current_query=question,
                    parameters={"connector_selections": {name: selection.model_dump(mode="json")
                        for name, selection in (connector_selections or {}).items()}}, created_at=now, updated_at=now))
            if inv and newest:
                await connection.execute(update(triage_investigations).where(
                    triage_investigations.c.investigation_id == investigation_id).values(
                    auto_triage_run_id=run.run_id, auto_triage_summary=run.result.model_dump(mode="json") if run.result else {}, updated_at=now))
            await connection.execute(insert(investigation_events).values(**scope,
                event_id="import-" + run.run_id, investigation_id=investigation_id,
                event_type="investigation.imported", actor_type="USER", actor_id=principal.subject,
                summary="Recorded investigation added to project triage", payload={"run_id": run.run_id}, occurred_at=now))
        return {"ticket_id": ticket_id, "investigation_id": investigation_id, "run_id": run.run_id}
