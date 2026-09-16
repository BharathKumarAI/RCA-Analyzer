"""Real PostgreSQL checks in a disposable database, never in application data."""

import asyncio
import os
import time
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.configuration.parameters import (
    ParameterDefinition,
    ParameterOverride,
    ParameterStore,
)
from app.configuration.integrations import (
    IntegrationConflict,
    IntegrationDefinition,
    IntegrationStore,
    IntegrationWrite,
)
from app.persistence.database import session_service
from app.persistence.lineage import ingestion_context
from app.persistence.store import InvestigationStore
from scripts.migrate import migrate
from scripts.deploy_database import upgrade_tracking
from scripts.seed_database import seed
from tests.support import settings_for
from tests.unit.test_store import make_contract


@pytest.mark.asyncio
async def test_postgres_migrations_parameters_lineage_and_native_sessions(tmp_path):
    admin_url = os.getenv("RCA_POSTGRES_TEST_URL")
    if not admin_url:
        pytest.skip(
            "Set RCA_POSTGRES_TEST_URL to a local PostgreSQL database-creator URL"
        )
    name = "rca_test_" + uuid.uuid4().hex
    owner = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    target = (
        make_url(admin_url).set(database=name).render_as_string(hide_password=False)
    )
    database = None
    sessions = None
    try:
        async with owner.connect() as c:
            await c.exec_driver_sql(f'CREATE DATABASE "{name}"')
        await migrate(target)
        await migrate(target)  # Checksummed migrations are repeatable without writes.
        await asyncio.to_thread(upgrade_tracking, target)
        tracking_uri = (
            make_url(target)
            .set(
                drivername="postgresql+psycopg",
                query={"options": "-csearch_path=mlflow"},
            )
            .render_as_string(hide_password=False)
        )

        def verify_tracking():
            from mlflow.tracking import MlflowClient

            client = MlflowClient(tracking_uri=tracking_uri)
            experiment = client.create_experiment(
                "PostgreSQL verification",
                artifact_location=(tmp_path / "tracking-artifacts").as_uri(),
            )
            run = client.create_run(experiment)
            client.log_metric(run.info.run_id, "validation", 1.0)
            client.set_terminated(run.info.run_id)
            assert client.get_run(run.info.run_id).data.metrics["validation"] == 1.0

        await asyncio.to_thread(verify_tracking)
        configured, token = settings_for(tmp_path)
        configured = configured.model_copy(
            update={
                "database_url": configured.database_url.__class__(target),
                "session_database_url": configured.session_database_url.__class__(
                    target
                ),
            }
        )
        with ingestion_context("template-import", batch_id="seed-test"):
            await seed(configured, "Test project")
        database = InvestigationStore(target)
        await database.initialize()
        store = ParameterStore(database.engine)
        await store.initialize()
        from app.identity.principals import Role, UserPrincipal

        principal = UserPrincipal(
            subject="etl-admin",
            username="Admin",
            tenant_id=configured.tenant_id,
            project_id=configured.project_id,
            roles=(Role.PLATFORM_ADMIN,),
        )

        # Registrations use the migrated PostgreSQL table, including the
        # deployment stamped lineage columns, and remain available to a fresh
        # store instance after writes from both scopes.
        integration_store = IntegrationStore(database.engine)
        await integration_store.initialize()
        integration_admin = principal
        integration_owner = principal.model_copy(
            update={"subject": "integration-owner", "roles": (Role.PROJECT_OWNER,)}
        )
        platform_definition = IntegrationDefinition(
            name="PostgreSQL MCP",
            kind="mcp",
            endpoint="https://mcp.postgres.example.test",
            description="PostgreSQL registration test",
            transport="streamable_http",
            timeout_seconds=20,
            allow_project_override=True,
        )
        with ingestion_context("api", batch_id="integration-create", actor="integration-admin"):
            await integration_store.save(
                integration_admin,
                "platform",
                "postgres-mcp",
                IntegrationWrite(definition=platform_definition),
            )
        platform_row = (await integration_store.list(integration_admin))[0]
        assert platform_row["scope_level"] == "platform_default"
        first_platform_revision = platform_row["revision"]

        edited_platform = platform_definition.model_copy(
            update={"endpoint": "https://mcp-edited.postgres.example.test"}
        )
        with ingestion_context("api", batch_id="integration-update", actor="integration-editor"):
            await integration_store.save(
                integration_admin,
                "platform",
                "postgres-mcp",
                IntegrationWrite(
                    definition=edited_platform,
                    expected_revision=first_platform_revision,
                ),
            )
        platform_row = (await integration_store.list(integration_admin))[0]
        platform_revision = platform_row["revision"]
        assert platform_revision != first_platform_revision
        assert platform_row["definition"]["endpoint"] == edited_platform.endpoint
        with pytest.raises(IntegrationConflict):
            await integration_store.save(
                integration_admin,
                "platform",
                "postgres-mcp",
                IntegrationWrite(
                    definition=platform_definition,
                    expected_revision=first_platform_revision,
                ),
            )

        project_definition = edited_platform.model_copy(
            update={"name": "Payments MCP", "endpoint": "https://payments-mcp.postgres.example.test",
                    "environment_dependency": "independent", "tool_environment": "Shared"}
        )
        with ingestion_context("api", batch_id="integration-project", actor="integration-owner"):
            await integration_store.save(
                integration_owner,
                "project",
                "postgres-mcp",
                IntegrationWrite(
                    definition=project_definition,
                    expected_platform_revision=platform_revision,
                ),
            )
        project_row = (await integration_store.list(integration_owner))[0]
        assert project_row["scope_level"] == "project_override"
        assert project_row["definition"]["endpoint"] == project_definition.endpoint

        # A separate SQLAlchemy store sees the same effective registration.
        fresh_engine = create_async_engine(target)
        try:
            fresh_integrations = IntegrationStore(fresh_engine)
            await fresh_integrations.initialize()
            persisted = (await fresh_integrations.list(integration_owner))[0]
            assert persisted["revision"] == project_row["revision"]
            assert persisted["platform_revision"] == platform_revision
            assert persisted["definition"]["name"] == "Payments MCP"
        finally:
            await fresh_engine.dispose()

        async with database.engine.connect() as c:
            lineage = (
                await c.execute(
                    text(
                        "SELECT created_by, edited_by, etl_src_system, etl_batch_id "
                        "FROM platform.integration_configurations "
                        "WHERE tenant_id='acme' AND project_id='' "
                        "AND integration_id='postgres-mcp'"
                    )
                )
            ).mappings().one()
            assert lineage["created_by"] == "integration-admin"
            assert lineage["edited_by"] == "integration-editor"
            assert lineage["etl_src_system"] == "api"
            assert lineage["etl_batch_id"] == "integration-update"

        with ingestion_context("api", batch_id="etl-test", actor="creator"):
            await store.define(
                principal,
                "test_tool",
                "batch_size",
                ParameterDefinition(
                    value_type="integer",
                    description="Batch size",
                    default_value=10,
                    allow_project_override=True,
                ),
            )
        async with database.engine.connect() as c:
            initial = (
                (
                    await c.execute(
                        text("""SELECT *
                FROM platform.parameter_definitions WHERE tool='test_tool'""")
                    )
                )
                .mappings()
                .one()
            )
            assert initial["created_by"] == "creator"
            assert initial["edited_by"] == "creator"
            assert initial["etl_src_system"] == "api"
            assert initial["etl_batch_id"] == "etl-test"
            assert initial["edited_time"].tzinfo is not None
            assert initial["created_time"] == initial["edited_time"]
            assert (
                await c.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.columns c "
                        "WHERE column_name IN ('created_time','created_by','edited_time','edited_by','etl_src_system','etl_batch_id') "
                        "AND table_schema IN ('platform','project','runtime','governance','optimization') "
                        "AND EXISTS (SELECT 1 FROM information_schema.triggers t "
                        "WHERE t.event_object_schema=c.table_schema AND t.event_object_table=c.table_name "
                        "AND t.trigger_name='stamp_etl_lineage')"
                    )
                )
                == 114
            )
        with ingestion_context("api", batch_id="etl-update", actor="editor"):
            await store.define(
                principal,
                "test_tool",
                "batch_size",
                ParameterDefinition(
                    value_type="integer",
                    description="Batch size",
                    default_value=20,
                    allow_project_override=True,
                    expected_revision=1,
                ),
            )
        async with database.engine.connect() as c:
            modified = (
                (
                    await c.execute(
                        text(
                            "SELECT * FROM platform.parameter_definitions WHERE tool='test_tool'"
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert modified["edited_time"] > initial["edited_time"]
            assert modified["created_time"] == initial["created_time"]
            assert modified["etl_batch_id"] == "etl-update"
            assert modified["created_by"] == "creator"
            assert modified["edited_by"] == "editor"
            assert modified["etl_src_system"] == "api"
        async with database.engine.begin() as c:
            await c.execute(text(
                "UPDATE platform.parameter_definitions SET created_by='spoofed', edited_by='spoofed', created_time='2000-01-01Z' WHERE tool='test_tool'"
            ))
            row = (await c.execute(text(
                "SELECT created_time, created_by, edited_by FROM platform.parameter_definitions WHERE tool='test_tool'"
            ))).one()
            assert row.created_by == "creator"
            assert row.created_time == initial["created_time"]
            assert row.edited_by == await c.scalar(text("SELECT current_user"))
            assert await c.scalar(text(
                "SELECT created_by FROM platform.configuration_bundles LIMIT 1"
            )) == "job:template-import"
        await store.set_override(
            principal,
            "test_tool",
            "batch_size",
            ParameterOverride(
                value=30,
                expected_revision=0,
                expected_definition_revision=2,
            ),
        )
        # PostgreSQL protects the policy even if an operator bypasses the API.
        with pytest.raises(DBAPIError):
            async with database.engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE platform.parameter_definitions SET allow_project_override=false WHERE tool='test_tool'"
                    )
                )
        with pytest.raises(DBAPIError):
            async with database.engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE project.parameter_overrides SET value='\"wrong-type\"'::jsonb WHERE tool='test_tool'"
                    )
                )
        await seed(configured, "Do not overwrite")
        resolved = await store.resolve(principal.tenant_id, principal.project_id)
        assert (
            next(r for r in resolved if r["tool"] == "test_tool")["effective_value"]
            == 30
        )
        contract = make_contract(principal)
        created, _ = await database.create_run(
            contract, "pg-test", "request", time.time() + 60
        )
        assert created.run_id == contract.run_id
        assert len(await database.list_runs(principal)) == 1
        sessions = session_service(target)
        await sessions.prepare_tables()
        session = await sessions.create_session(
            app_name="app", user_id="test-user", session_id="native-test"
        )
        from google.adk.events import Event
        from google.genai import types

        await sessions.append_event(
            session,
            Event(
                author="test",
                invocation_id="test-invocation",
                content=types.Content(
                    role="model", parts=[types.Part(text="stored event")]
                ),
            ),
        )
        loaded = await sessions.get_session(
            app_name="app", user_id="test-user", session_id="native-test"
        )
        assert loaded.events[0].content.parts[0].text == "stored event"
        async with database.engine.connect() as c:
            assert await c.scalar(text("SELECT count(*) FROM adk.events")) == 1
            assert (
                await c.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
                    )
                )
                == 0
            )

        # Exercise startup and authenticated API routing with database-backed config.
        def api_check():
            from fastapi.testclient import TestClient
            from app.api.application import create_app

            with TestClient(
                create_app(
                    configured.model_copy(update={"database_configuration": True})
                )
            ) as client:
                assert client.get("/health").status_code == 200
                uploaded = client.post(
                    "/api/v1/files",
                    headers=token(),
                    files={
                        "files": ("pg.txt", b"PostgreSQL blob content", "text/plain")
                    },
                )
                assert uploaded.status_code == 201

                assert client.get("/api/v1/parameters").status_code == 401
                catalog = client.get("/api/v1/parameters", headers=token())
                assert catalog.status_code == 200
                assert any(row["value_type"] == "secret_ref" for row in catalog.json())
                invalid = client.put(
                    "/api/v1/parameters/test_tool/batch_size/override",
                    headers=token("owner"),
                    json={
                        "value": 5,
                        "expected_revision": 1,
                        "expected_definition_revision": 2,
                        "tenant_id": "another",
                    },
                )
                assert invalid.status_code == 422
                denied = client.put(
                    "/api/v1/parameters/test_tool/batch_size/override",
                    headers=token("viewer"),
                    json={
                        "value": 5,
                        "expected_revision": 1,
                        "expected_definition_revision": 2,
                    },
                )
                assert denied.status_code == 403
                changed = client.put(
                    "/api/v1/parameters/test_tool/batch_size/override",
                    headers=token("owner"),
                    json={
                        "value": 40,
                        "expected_revision": 1,
                        "expected_definition_revision": 2,
                    },
                )
                assert changed.status_code == 200

                assert client.app.state.settings.projects_blob_uri == str(
                    configured.projects_root.resolve()
                )
                assert client.app.state.settings.content_root != configured.content_root

        await asyncio.to_thread(api_check)
        async with database.engine.connect() as c:
            actor = await c.scalar(
                text(
                    "SELECT actor_subject FROM governance.parameter_audit WHERE tool='test_tool' AND action='override' ORDER BY event_id DESC LIMIT 1"
                )
            )
            assert actor == "owner"
            assert await c.scalar(text(
                "SELECT edited_by FROM project.parameter_overrides WHERE tool='test_tool'"
            )) == "owner"
            assert await c.scalar(text(
                "SELECT created_by FROM runtime.attachments"
            )) == "analyst"
            payload = await c.scalar(
                text("SELECT payload_json FROM runtime.attachments")
            )
            assert "PostgreSQL blob content" not in payload
            assert '"processed_hash"' in payload

    finally:
        if sessions:
            await sessions.close()
        if database:
            await database.aclose()
        async with owner.connect() as c:
            await c.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await owner.dispose()
