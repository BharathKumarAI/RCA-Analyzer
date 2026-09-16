"""Minimal explicit triage records for isolated tests; never imported by the app."""

import time
from sqlalchemy import insert
from app.persistence.triage import triage_tickets, triage_queue_stays, triage_investigations, tool_proposals


async def create_triage_case(engine, tenant_id, project_id):
    now = time.time()
    scope = {"tenant_id": tenant_id, "project_id": project_id, "ticket_id": "TEST-1"}
    async with engine.begin() as connection:
        await connection.execute(insert(triage_tickets).values(
            **scope, summary="Test incident", priority="P1", created_at=now, updated_at=now,
        ))
        await connection.execute(insert(triage_queue_stays).values(
            **scope, stay_id="test-stay", entered_at=now, created_at=now,
        ))
        await connection.execute(insert(triage_investigations).values(
            **scope, investigation_id="test-investigation", created_at=now, updated_at=now,
        ))
        await connection.execute(insert(tool_proposals).values(
            **scope, investigation_id="test-investigation", proposal_id="test-proposal",
            capability="splunk", title="Test query", generated_query="index=test", current_query="index=test",
            created_at=now, updated_at=now,
        ))
