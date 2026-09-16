"""Versioned, owner-scoped feedback on completed investigations."""

import time

from sqlalchemy import Column, Float, ForeignKey, Integer, String, Table, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.persistence.store import metadata, runs

feedback = Table(
    "run_feedback", metadata,
    Column("run_id", String(128), ForeignKey(runs.c.run_id, ondelete="CASCADE"), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False),
    Column("rating", String(32), nullable=False),
    Column("note", String, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)


def scope(principal):
    return (feedback.c.tenant_id == principal.tenant_id,
            feedback.c.project_id == principal.project_id, feedback.c.subject == principal.subject)


async def read_feedback(engine, principal, run_id):
    async with engine.connect() as connection:
        row = (await connection.execute(select(feedback).where(
            *scope(principal), feedback.c.run_id == run_id))).mappings().first()
    return dict(row) if row else None


async def save_feedback(engine, principal, run_id, payload, note):
    now = time.time()
    values = {"rating": payload.rating, "note": note, "updated_at": now,
              "revision": payload.expected_revision + 1}
    try:
        async with engine.begin() as connection:
            if payload.expected_revision:
                result = await connection.execute(update(feedback).where(
                    *scope(principal), feedback.c.run_id == run_id,
                    feedback.c.revision == payload.expected_revision).values(**values))
                if result.rowcount != 1:
                    raise ValueError("Feedback changed in another session. Reload it before saving.")
            else:
                await connection.execute(insert(feedback).values(**values, run_id=run_id,
                    tenant_id=principal.tenant_id, project_id=principal.project_id,
                    subject=principal.subject, created_at=now))
    except IntegrityError:
        raise ValueError("Feedback already exists or the investigation is no longer available. Reload before saving.") from None
    return await read_feedback(engine, principal, run_id)
