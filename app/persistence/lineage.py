"""Trusted request/job lineage carried into PostgreSQL transactions."""

from contextlib import contextmanager
from contextvars import ContextVar
import uuid

from sqlalchemy import event, text

_context = ContextVar("rca_etl_context", default=None)


@contextmanager
def ingestion_context(source, *, batch_id=None, actor=None):
    """Track the trusted writer, source, and batch for a request or job."""
    values = {
        "source": source,
        "actor": actor if actor is not None else f"job:{source}",
        "batch": batch_id or str(uuid.uuid4()),
    }
    if any(
        not isinstance(value, str) or not value.strip() or len(value) > 1024 for value in values.values()
    ):
        raise ValueError("Invalid ingestion context")
    token = _context.set(values)
    try:
        yield values["batch"]
    finally:
        _context.reset(token)


def track_transactions(engine):
    if engine.dialect.name != "postgresql":
        return engine

    @event.listens_for(engine.sync_engine, "begin")
    def set_lineage(connection):
        values = _context.get()
        if values is not None:
            connection.execute(
                text("""SELECT
                set_config('rca.etl_source', :source, true),
                set_config('rca.etl_batch', :batch, true),
                set_config('rca.etl_actor', :actor, true)
            """),
                values,
            )

    return engine
