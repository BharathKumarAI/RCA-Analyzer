"""Remove expired records and their ADK sessions using configured retention."""

from contextlib import AsyncExitStack
from app.configuration.database_bundle import load_effective_settings
from app.persistence.lineage import ingestion_context
import argparse
import asyncio
import json
import time
from sqlalchemy import select
from app.persistence.database import session_service
from app.persistence.store import InvestigationStore, runs
from app.runtime.run_contract import TERMINAL_STATUSES, content_hash, RunContract
from app.settings import Settings
from app.persistence.chat_artifacts import ChatArtifactStore
from app.inputs.files import FileLimits


async def cleanup(apply=False):
    settings = Settings.from_env()
    if not settings.tenant_id or not settings.project_id:
        raise ValueError("Configure tenant/project before artifact cleanup")
    store = InvestigationStore(settings.database_url.get_secret_value())
    sessions = None
    cleanup_stack = AsyncExitStack()
    try:
        settings, _ = await load_effective_settings(
            store.engine, settings, cleanup_stack
        )
        sessions = session_service(settings.session_database_url.get_secret_value())
        await store.initialize()
        async with store.engine.connect() as connection:
            expired = (
                await connection.execute(
                    select(runs).where(
                        runs.c.status.in_(TERMINAL_STATUSES),
                        runs.c.tenant_id == settings.tenant_id,
                        runs.c.project_id == settings.project_id,
                        runs.c.updated_at
                        < time.time() - settings.retention_days * 86400,
                    )
                )
            ).all()
        artifact_store = ChatArtifactStore(store, settings, FileLimits().max_file_bytes)
        artifact_count = await artifact_store.cleanup(apply=apply)
        if not apply:
            print(
                json.dumps(
                    {
                        "expired_terminal_runs": len(expired),
                        "expired_raw_artifacts": artifact_count,
                        "retention_days": settings.retention_days,
                        "applied": False,
                    }
                )
            )
            return
        for run in expired:
            await artifact_store.cleanup_output(
                store._response(run),
                RunContract.model_validate_json(run.contract_json).principal,
            )
            await sessions.delete_session(
                app_name="app",
                user_id=content_hash([run.tenant_id, run.project_id, run.subject]),
                session_id=run.run_id,
            )
        deleted = await store.delete_expired(
            settings.retention_days * 86400,
            scope=(settings.tenant_id, settings.project_id),
        )
        print(
            json.dumps(
                {
                    "deleted_runs_and_attachments": deleted,
                    "deleted_raw_artifacts": artifact_count,
                    "applied": True,
                }
            )
        )
    finally:
        if sessions:
            await sessions.close()
        await cleanup_stack.aclose()
        await store.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete expired data; default only reports candidate runs",
    )
    from dotenv import load_dotenv

    load_dotenv()
    with ingestion_context("maintenance"):
        asyncio.run(cleanup(parser.parse_args().apply))
