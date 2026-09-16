"""Configuration saves must work as a restricted role, with history immutable."""

from contextlib import asynccontextmanager
import os
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.configuration.database_bundle import (
    _store_bundle,
    active,
    bundles,
    update_bundle_file,
)
from app.runtime.run_contract import content_hash
from scripts.migrate import migrate


@pytest.mark.asyncio
async def test_configuration_save_with_minimum_database_privileges():
    admin_url = os.getenv("RCA_POSTGRES_TEST_URL")
    if not admin_url:
        pytest.skip("Set RCA_POSTGRES_TEST_URL to a local database/role-creator URL")
    name = "rca_priv_test_" + uuid.uuid4().hex
    role = name + "_app"
    owner = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    target = make_url(admin_url).set(database=name)
    engine = create_async_engine(target)
    try:
        async with owner.connect() as c:
            await c.exec_driver_sql(f'CREATE DATABASE "{name}"')
            await c.exec_driver_sql(f'CREATE ROLE "{role}" NOLOGIN')
        await migrate(target.render_as_string(hide_password=False))
        settings = SimpleNamespace(tenant_id="test", project_id="test")
        files = {"config/test.yaml": "enabled: false\n"}
        first_hash = content_hash(files)
        await _store_bundle(engine, settings, files, first_hash, None)
        async with engine.begin() as c:
            await c.exec_driver_sql(f'GRANT USAGE ON SCHEMA platform TO "{role}"')
            # Apply the actual upgrade policy to an isolated role and database.
            source = Path("migrations/history/005_configuration_save_privileges.sql").read_text()
            await c.exec_driver_sql(source.replace("rca_app", role))

        @asynccontextmanager
        async def restricted_connection():
            async with engine.begin() as c:
                await c.exec_driver_sql(f'SET LOCAL ROLE "{role}"')
                yield c

        restricted = SimpleNamespace(
            begin=restricted_connection, connect=restricted_connection
        )
        next_hash = await update_bundle_file(
            restricted, settings, "config/test.yaml", "enabled: true\n"
        )
        assert next_hash != first_hash
        async with restricted.connect() as c:
            assert await c.scalar(select(active.c.content_hash)) == next_hash
            versions = (await c.execute(select(bundles.c.files))).scalars().all()
            assert len(versions) == 2
            assert files in versions
        with pytest.raises(ValueError, match="Active configuration changed"):
            await _store_bundle(restricted, settings, files, first_hash, first_hash)
        # Even no-op mutations must be rejected, independently of API authorization.
        for statement in (
            "UPDATE platform.configuration_bundles SET files=files",
            "DELETE FROM platform.configuration_bundles WHERE false",
            "DELETE FROM platform.active_configuration WHERE false",
            "UPDATE platform.active_configuration SET project_id=project_id",
            "INSERT INTO platform.active_configuration (tenant_id,project_id,content_hash) "
            "SELECT tenant_id,project_id,content_hash FROM platform.active_configuration WHERE false",
        ):
            with pytest.raises(DBAPIError, match="permission denied"):
                async with restricted.begin() as c:
                    await c.exec_driver_sql(statement)
    finally:
        await engine.dispose()
        async with owner.connect() as c:
            await c.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            await c.exec_driver_sql(f'DROP ROLE IF EXISTS "{role}"')
        await owner.dispose()
