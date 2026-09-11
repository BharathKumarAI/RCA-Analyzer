"""Apply immutable PostgreSQL migrations under one transaction and advisory lock."""

import argparse
import asyncio
import hashlib
import os
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


async def migrate(url):
    engine = create_async_engine(url, pool_pre_ping=True)
    if engine.dialect.name != "postgresql":
        await engine.dispose()
        raise ValueError("Migrations require PostgreSQL")
    try:
        async with engine.begin() as c:
            await c.execute(text("SELECT pg_advisory_xact_lock(726320260911)"))
            await c.execute(text("CREATE SCHEMA IF NOT EXISTS platform"))
            await c.execute(
                text("""CREATE TABLE IF NOT EXISTS platform.schema_migrations (
                version integer PRIMARY KEY, checksum varchar(64) NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now())""")
            )
            files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"))
            known = {int(p.name.split("_")[0]) for p in files}
            applied = dict(
                (
                    await c.execute(
                        text("SELECT version, checksum FROM platform.schema_migrations")
                    )
                ).all()
            )
            if set(applied) - known:
                raise ValueError("Database is newer than this application")
            for path in files:
                version = int(path.name.split("_")[0])
                source = path.read_text()
                checksum = hashlib.sha256(source.encode()).hexdigest()
                if version in applied:
                    if checksum != applied[version]:
                        raise ValueError("Applied migration checksum changed")
                    continue
                # Explicit separator supports PostgreSQL function bodies safely.
                for statement in source.split("\n-- statement\n"):
                    if statement.strip():
                        await c.exec_driver_sql(statement)
                await c.execute(
                    text(
                        "INSERT INTO platform.schema_migrations(version, checksum) VALUES (:v, :c)"
                    ),
                    {"v": version, "c": checksum},
                )
                print(f"Applied migration {version}")
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    from dotenv import load_dotenv

    load_dotenv()
    url = os.environ.get("RCA_MIGRATION_DATABASE_URL") or os.environ.get(
        "RCA_DATABASE_URL"
    )
    if not url:
        raise SystemExit("Set RCA_MIGRATION_DATABASE_URL or RCA_DATABASE_URL")
    asyncio.run(migrate(url))


if __name__ == "__main__":
    main()
