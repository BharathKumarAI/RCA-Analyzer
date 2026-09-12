"""Bounded, tenant-scoped execution trace persistence."""

import asyncio
import json
import time

from collections import defaultdict

from sqlalchemy import (
    Column,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    and_,
    delete,
    insert,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncEngine

from app.identity.principals import UserPrincipal
from app.persistence.store import runs
from app.policy.redaction import redact


metadata = MetaData(schema="runtime")
run_events = Table(
    "harness_run_events",
    metadata,
    Column("run_id", String(128), primary_key=True),
    Column("sequence", Integer, primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("node_id", String(256), nullable=False),
    Column("kind", String(64), nullable=False),
    Column("timestamp", Float, nullable=False),
    Column("details_json", String, nullable=False),
)

MAX_EVENTS_PER_RUN = 2000
MAX_DETAILS_BYTES = 32 * 1024
MAX_DETAIL_TEXT = 4096


class RunEventStore:
    """Persist and read bounded run traces using the run's existing DB scope."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self._run_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def initialize(self):
        """Create the SQLite table; PostgreSQL is migration-managed."""
        if self.engine.dialect.name == "sqlite":
            async with self.engine.begin() as connection:
                await connection.run_sync(metadata.create_all)
        else:
            async with self.engine.connect() as connection:
                await connection.execute(select(run_events).limit(0))

    @staticmethod
    def _scope(table, principal: UserPrincipal):
        return and_(
            table.c.tenant_id == principal.tenant_id,
            table.c.project_id == principal.project_id,
        )

    @staticmethod
    def _encoded_details(details) -> str:
        bounded = redact(details, max_text=MAX_DETAIL_TEXT)
        encoded = json.dumps(bounded, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) <= MAX_DETAILS_BYTES:
            return encoded
        return json.dumps(
            {"truncated": True, "reason": "Event details exceeded the storage limit"},
            separators=(",", ":"),
        )

    async def append(
        self,
        run_id: str,
        principal: UserPrincipal,
        node_id: str,
        kind: str,
        details,
    ) -> dict:
        if not isinstance(node_id, str) or not node_id or len(node_id) > 256:
            raise ValueError("Invalid run event node ID")
        if not isinstance(kind, str) or not kind or len(kind) > 64:
            raise ValueError("Invalid run event kind")
        details_json = self._encoded_details(details)
        now = time.time()
        # ponytail: one per-run process lock plus a DB row update; replace the
        # in-process lock only if multiple writers make this a measured bottleneck.
        async with self._run_locks[run_id]:
            async with self.engine.begin() as connection:
                locked = await connection.execute(
                    update(runs)
                    .where(
                        runs.c.run_id == run_id,
                        self._scope(runs, principal),
                    )
                    .values(updated_at=runs.c.updated_at)
                )
                if locked.rowcount != 1:
                    raise PermissionError("Run not found")

                latest = (
                    await connection.execute(
                        select(run_events.c.sequence)
                        .where(run_events.c.run_id == run_id)
                        .order_by(run_events.c.sequence.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                sequence = (latest or 0) + 1
                await connection.execute(
                    insert(run_events).values(
                        run_id=run_id,
                        sequence=sequence,
                        tenant_id=principal.tenant_id,
                        project_id=principal.project_id,
                        node_id=node_id,
                        kind=kind,
                        timestamp=now,
                        details_json=details_json,
                    )
                )
                old_sequences = (
                    await connection.execute(
                        select(run_events.c.sequence)
                        .where(run_events.c.run_id == run_id)
                        .order_by(run_events.c.sequence.desc())
                        .offset(MAX_EVENTS_PER_RUN)
                    )
                ).scalars().all()
                if old_sequences:
                    await connection.execute(
                        delete(run_events).where(
                            run_events.c.run_id == run_id,
                            run_events.c.sequence.in_(old_sequences),
                        )
                    )
        return {
            "sequence": sequence,
            "node_id": node_id,
            "kind": kind,
            "timestamp": now,
            "details": json.loads(details_json),
        }

    async def list(
        self,
        run_id: str,
        principal: UserPrincipal,
        after: int = 0,
    ) -> list[dict]:
        if after < 0:
            raise ValueError("Invalid event cursor")
        async with self.engine.connect() as connection:
            rows = (
                await connection.execute(
                    select(run_events)
                    .where(
                        run_events.c.run_id == run_id,
                        self._scope(run_events, principal),
                        run_events.c.sequence > after,
                    )
                    .order_by(run_events.c.sequence.asc())
                    .limit(MAX_EVENTS_PER_RUN)
                )
            ).all()
        return [
            {
                "sequence": row.sequence,
                "node_id": row.node_id,
                "kind": row.kind,
                "timestamp": row.timestamp,
                "details": json.loads(row.details_json),
            }
            for row in rows
        ]


EventStore = RunEventStore
