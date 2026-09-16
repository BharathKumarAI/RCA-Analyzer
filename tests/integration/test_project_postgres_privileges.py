"""Workspace creation and conversation persistence under actual PostgreSQL grants."""

from contextlib import asynccontextmanager
import os
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import select, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.configuration.database_bundle import active, bundles, update_bundle_file
from app.configuration.projects import ProjectCreate, ProjectStore, project_catalog
from app.persistence.chat_messages import list_messages, save_exchange
from app.persistence.platform_admin import project_editor_drafts
from app.persistence.store import InvestigationStore
from app.runtime.intent import IntentResolution
from scripts.migrate import migrate
from tests.support import settings_for


@pytest.mark.asyncio
async def test_project_creation_and_chat_messages_with_restricted_database_role(tmp_path):
    admin_url = os.getenv("RCA_POSTGRES_TEST_URL")
    if not admin_url:
        pytest.skip("Set RCA_POSTGRES_TEST_URL to a local database/role-creator URL")
    name = "rca_project_test_" + uuid.uuid4().hex
    role = name + "_app"
    owner = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    target = make_url(admin_url).set(database=name)
    engine = create_async_engine(target)
    try:
        async with owner.connect() as connection:
            await connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
            await connection.exec_driver_sql(f'CREATE ROLE "{role}" NOLOGIN')
        await migrate(target.render_as_string(hide_password=False))
        async with engine.begin() as connection:
            await connection.exec_driver_sql(f'GRANT USAGE ON SCHEMA platform, project, governance, runtime TO "{role}"')
            # Existing deployment privileges used by project creation, excluding
            # the new project/pointer grants being tested below.
            await connection.exec_driver_sql(f'GRANT SELECT, INSERT, UPDATE ON platform.platform_users, platform.project_editor_drafts TO "{role}"')
            await connection.exec_driver_sql(f'GRANT SELECT, INSERT ON governance.parameter_audit TO "{role}"')
            await connection.exec_driver_sql(f'GRANT USAGE, SELECT ON SEQUENCE governance.parameter_audit_event_id_seq TO "{role}"')
            await connection.exec_driver_sql(f'GRANT SELECT, INSERT ON runtime.chats TO "{role}"')
            for migration in ("005_configuration_save_privileges.sql", "025_chat_messages.sql", "026_project_workspaces.sql"):
                for statement in Path("migrations", "history", migration).read_text().split("\n-- statement\n"):
                    if "DO $$ BEGIN" in statement:
                        await connection.exec_driver_sql(statement.replace("rca_app", role))

        @asynccontextmanager
        async def restricted_connection():
            async with engine.begin() as connection:
                await connection.exec_driver_sql(f'SET LOCAL ROLE "{role}"')
                yield connection

        restricted = SimpleNamespace(begin=restricted_connection, connect=restricted_connection)
        settings, _ = settings_for(tmp_path)
        project_store = ProjectStore(restricted, settings)
        created = await project_store.create(settings.principals["admin"],
            ProjectCreate(project_id="support", name="Support"), SimpleNamespace(settings=settings))
        assert created["project_id"] == "support"
        principal = await project_store.select("admin", "support")
        assert principal.project_id == "support"
        async with restricted.connect() as connection:
            digest = await connection.scalar(select(active.c.content_hash).where(active.c.project_id == "support"))
            assert await connection.scalar(select(bundles.c.content_hash).where(bundles.c.content_hash == digest)) == digest
        async with restricted.begin() as connection:
            await connection.execute(update(project_editor_drafts).where(project_editor_drafts.c.project_id == "support")
                .values(version=2, document={"metadata": {"name": "Customer response", "objective": "Review customer issues",
                    "timezone": "America/Chicago"}}))
        selected_settings = settings.model_copy(update={"project_id": "support"})
        changed = await update_bundle_file(restricted, selected_settings, "config/test.yaml", "enabled: true\n",
            expected_bundle_hash=digest, expected_editor_version=2)
        assert changed != digest
        async with restricted.connect() as connection:
            assert await connection.scalar(select(project_catalog.c.name).where(project_catalog.c.project_id == "support")) == "Customer response"
        with pytest.raises(ValueError, match="draft changed"):
            await update_bundle_file(restricted, selected_settings, "config/test.yaml", "enabled: false\n",
                expected_bundle_hash=changed, expected_editor_version=1)
        async with restricted.connect() as connection:
            assert await connection.scalar(select(active.c.content_hash).where(active.c.project_id == "support")) == changed
        # Exercise the real chat store methods using the same restricted
        # connection, including the SERIAL sequence for conversation messages.
        store = object.__new__(InvestigationStore)
        store.engine = restricted
        chat = await store.create_chat(principal)
        await save_exchange(store, principal, chat["chat_id"], "What should I investigate?", IntentResolution(
            status="clarification", message="Describe the incident.", reason_code="unclear_request", catalog_hash="test"))
        messages = await list_messages(store, principal, chat["chat_id"])
        assert [message["role"] for message in messages] == ["user", "assistant"]
        assert messages[1]["sequence"] > messages[0]["sequence"]
        # New scope insertion does not authorize rewriting existing scope keys
        # or removing previous configurations, even for no-op SQL statements.
        for statement in (
            "UPDATE platform.active_configuration SET project_id=project_id",
            "UPDATE project.projects SET project_id=project_id",
            "DELETE FROM project.projects WHERE false",
            "UPDATE platform.configuration_bundles SET files=files",
            "DELETE FROM platform.configuration_bundles WHERE false",
        ):
            with pytest.raises(DBAPIError, match="permission denied"):
                async with restricted.begin() as connection:
                    await connection.exec_driver_sql(statement)
    finally:
        await engine.dispose()
        async with owner.connect() as connection:
            await connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            await connection.exec_driver_sql(f'DROP ROLE IF EXISTS "{role}"')
        await owner.dispose()
