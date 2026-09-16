"""Restore the consolidated DDL and compare it with real migrated PostgreSQL."""

import asyncio
import os
import re
from pathlib import Path
import subprocess
import uuid

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from scripts.deploy_database import upgrade_tracking
from scripts.export_database_ddl import export_ddl
from scripts.migrate import migrate


def normalize_array_casts(sql):
    # PostgreSQL reparses a varchar-array cast as per-element text casts on
    # restore. Normalize only literal arrays; retain every constraint/value.
    literal = r"'(?:[^']|'')*'::character varying"
    return re.sub(
        rf"\(ARRAY\[({literal}(?:, {literal})*)\]\)::text\[\]",
        lambda match: "ARRAY[" + re.sub(literal, lambda item: "(" + item[0] + ")::text", match[1]) + "]",
        sql,
    )


@pytest.mark.asyncio
async def test_consolidated_ddl_restores_migrated_structure():
    url = os.getenv("RCA_POSTGRES_TEST_URL")
    if not url:
        pytest.skip("Set RCA_POSTGRES_TEST_URL to a disposable database-creator URL")
    owner = create_async_engine(url, isolation_level="AUTOCOMMIT")
    names = ["rca_ddl_" + uuid.uuid4().hex for _ in range(2)]
    urls = [make_url(url).set(database=name) for name in names]
    try:
        async with owner.connect() as connection:
            for name in names:
                await connection.exec_driver_sql(f'CREATE DATABASE "{name}" TEMPLATE template0 ENCODING \'UTF8\'')
        source = urls[0].render_as_string(hide_password=False)
        await migrate(source)
        await migrate(source)
        await asyncio.to_thread(upgrade_tracking, source)
        actual = await asyncio.to_thread(export_ddl, source)
        assert actual == Path("migrations/schema.sql").read_text(), "Regenerate the schema reference after DDL changes"
        env = dict(os.environ)
        if urls[1].password is not None:
            env["PGPASSWORD"] = urls[1].password
        restored = await asyncio.to_thread(
            subprocess.run,
            ["psql", "-X", "--set", "ON_ERROR_STOP=1", "--dbname",
             urls[1].set(drivername="postgresql", password=None).render_as_string(hide_password=False)],
            input=actual, text=True, capture_output=True, env=env,
        )
        assert restored.returncode == 0, "Consolidated schema restore failed"
        restored_sql = await asyncio.to_thread(export_ddl, urls[1].render_as_string(hide_password=False))
        assert normalize_array_casts(restored_sql) == normalize_array_casts(actual)
        restored_engine = create_async_engine(urls[1])
        async with restored_engine.connect() as connection:
            result = await connection.exec_driver_sql("SELECT count(*) FROM platform.triage_tickets")
            assert result.scalar_one() == 0
            result = await connection.exec_driver_sql("SELECT count(*) FROM platform.schema_migrations")
            assert result.scalar_one() == 0
        await restored_engine.dispose()
    finally:
        async with owner.connect() as connection:
            for name in names:
                await connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await owner.dispose()
