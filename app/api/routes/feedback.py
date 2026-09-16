"""User feedback is a quality signal; it never approves configuration changes."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.persistence.store import runs

from app.api.dependencies import Principal
from app.policy.redaction import redact
from app.persistence.feedback import read_feedback, save_feedback
from app.runtime.run_contract import TERMINAL_STATUSES

router = APIRouter(prefix="/api/v1/runs", tags=["feedback"])


class FeedbackInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: Literal["helpful", "needs_work"]
    note: str = Field(default="", max_length=2000)
    expected_revision: int = Field(default=0, ge=0)


async def require_run(request, principal, run_id):
    engine = request.app.state.store.engine
    async with engine.connect() as connection:
        owned = await connection.scalar(select(runs.c.run_id).where(
            runs.c.run_id == run_id, runs.c.tenant_id == principal.tenant_id,
            runs.c.project_id == principal.project_id, runs.c.subject == principal.subject,
        ))
    if not owned:
        raise HTTPException(404, "Investigation not found")
    run = await request.app.state.store.get_run(run_id, principal)
    if run is None:
        raise HTTPException(404, "Investigation not found")
    return run


@router.get("/{run_id}/feedback")
async def get_feedback(run_id: str, request: Request, principal: Principal):
    await require_run(request, principal, run_id)
    return await read_feedback(request.app.state.store.engine, principal, run_id)


@router.put("/{run_id}/feedback")
async def put_feedback(run_id: str, payload: FeedbackInput, request: Request, principal: Principal):
    run = await require_run(request, principal, run_id)
    if run.status not in TERMINAL_STATUSES:
        raise HTTPException(409, "Wait until the investigation finishes before reviewing it")
    try:
        # Feedback can quote evidence or credentials; retain the same redaction boundary.
        note = redact(payload.note.strip(), max_text=2000)
        return await save_feedback(request.app.state.store.engine, principal, run_id, payload, note)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
