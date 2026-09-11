"""Deployment job: migrate, import templates, and provision a restricted API role."""

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.settings import Settings
from app.persistence.lineage import ingestion_context
from scripts.migrate import migrate
from scripts.seed_database import seed


def upgrade_tracking(url):
    """Use native MLflow migrations without putting a credential URL in process args."""
    from mlflow.db import upgrade

    tracking_url = make_url(url).set(
        drivername="postgresql+psycopg", query={"options": "-csearch_path=mlflow"}
    )
    upgrade.main(
        args=[tracking_url.render_as_string(hide_password=False)], standalone_mode=False
    )


async def deploy():
    url = os.environ.get("RCA_MIGRATION_DATABASE_URL") or os.environ["RCA_DATABASE_URL"]
    password = os.environ.get("RCA_APP_DATABASE_PASSWORD")
    if not password or len(password) < 24:
        raise ValueError(
            "RCA_APP_DATABASE_PASSWORD must contain at least 24 characters"
        )
    await migrate(url)
    await asyncio.to_thread(upgrade_tracking, url)
    settings = Settings.from_env().model_copy(update={"database_configuration": False})
    settings = settings.model_copy(
        update={"database_url": settings.database_url.__class__(url)}
    )
    with ingestion_context("template-import"):
        await seed(settings, os.environ.get("RCA_PROJECT_NAME"))
    engine = create_async_engine(url, hide_parameters=True)
    try:
        async with engine.begin() as c:
            await c.execute(text("SELECT pg_advisory_xact_lock(726320260913)"))
            if not await c.scalar(
                text("SELECT 1 FROM pg_roles WHERE rolname = 'rca_app'")
            ):
                await c.exec_driver_sql("CREATE ROLE rca_app LOGIN")
            # DDL does not accept bind parameters. Quote string literals using the
            # dialect compiler, never interpolate an unescaped credential.
            from sqlalchemy import literal

            quoted = str(
                literal(password).compile(
                    dialect=engine.dialect, compile_kwargs={"literal_binds": True}
                )
            )
            await c.exec_driver_sql(
                "ALTER ROLE rca_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD "
                + quoted
            )
            database = engine.dialect.identifier_preparer.quote_identifier(
                make_url(url).database
            )
            await c.exec_driver_sql(f"GRANT CONNECT ON DATABASE {database} TO rca_app")
            for schema in (
                "runtime",
                "governance",
                "optimization",
                "platform",
                "project",
                "adk",
                "mlflow",
            ):
                await c.exec_driver_sql(f"GRANT USAGE ON SCHEMA {schema} TO rca_app")
                await c.exec_driver_sql(
                    f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {schema} TO rca_app"
                )
                await c.exec_driver_sql(
                    f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO rca_app"
                )
            for table in (
                "platform.schema_migrations",
                "platform.configuration_bundles",
                "platform.active_configuration",
                "project.projects",
            ):
                await c.exec_driver_sql(
                    f"REVOKE INSERT, UPDATE, DELETE ON {table} FROM rca_app"
                )
            for table in (
                "governance.parameter_audit",
                "governance.agent_config_audit",
            ):
                await c.exec_driver_sql(
                    f"REVOKE UPDATE, DELETE ON {table} FROM rca_app"
                )
        print(
            "Database deployment complete; rca_app has data access without schema ownership"
        )
    finally:
        await engine.dispose()


def main():
    from dotenv import load_dotenv

    load_dotenv()
    # The deployment job reads templates even when the runtime uses the database.
    os.environ["RCA_DATABASE_CONFIGURATION"] = "false"
    asyncio.run(deploy())


if __name__ == "__main__":
    main()
