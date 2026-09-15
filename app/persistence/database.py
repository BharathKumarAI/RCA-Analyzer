"""Schema routing and startup verification; PostgreSQL DDL is deployed separately."""

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

SCHEMA_VERSION = 21

SCHEMAS = ("runtime", "governance", "optimization", "platform", "project", "adk")


def scoped_engine(engine):
    if engine.dialect.name == "sqlite":
        return engine.execution_options(schema_translate_map={s: None for s in SCHEMAS})
    return engine


async def initialize_tables(engine, metadata):
    async with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            await connection.run_sync(metadata.create_all)
        else:
            # Fail before accepting traffic if deployment has not applied the DDL.
            for table in metadata.sorted_tables:
                await connection.execute(table.select().limit(0))
            version = await connection.scalar(
                text("SELECT max(version) FROM platform.schema_migrations")
            )
            if version != SCHEMA_VERSION:
                raise RuntimeError("Apply database migrations before starting the API")


def session_service(database_url):
    """Keep ADK's native service and schema consistent in API and maintenance jobs."""
    from google.adk.sessions import DatabaseSessionService

    parsed = make_url(database_url)
    options = {}
    if parsed.get_backend_name() == "postgresql":
        options = {
            "connect_args": {
                "server_settings": {"search_path": "adk", "timezone": "UTC"}
            }
        }
    elif parsed.get_backend_name() == "sqlite" and parsed.database not in {
        None,
        "",
        ":memory:",
    }:
        Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)
    return DatabaseSessionService(db_url=database_url, **options)
