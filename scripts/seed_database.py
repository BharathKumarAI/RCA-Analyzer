"""Import templates once, or update the active bundle with an expected hash."""

import argparse
import asyncio
import os

from sqlalchemy import insert, select, text

from app.configuration.database_bundle import seed_bundle
from app.configuration.parameters import (
    ParameterDefinition,
    ParameterStore,
    RUNTIME_FIELDS,
    projects,
)
from app.identity.principals import Role, UserPrincipal
from app.persistence.store import InvestigationStore
from app.settings import Settings
from app.persistence.lineage import ingestion_context


async def seed(settings, project_name, expected_bundle_hash=None):
    if not settings.tenant_id or not settings.project_id:
        raise ValueError("Deployment tenant and project are required")
    store = InvestigationStore(settings.database_url.get_secret_value())
    try:
        await store.initialize()
        parameters = ParameterStore(store.engine)
        await parameters.initialize()
        # Serialize initial import across deployment jobs (not API request paths).
        async with store.engine.connect() as lock:
            if store.engine.dialect.name == "postgresql":
                await lock.execute(text("SELECT pg_advisory_lock(726320260912)"))
            try:
                async with store.engine.begin() as c:
                    if not await c.scalar(
                        select(projects.c.project_id).where(
                            projects.c.tenant_id == settings.tenant_id,
                            projects.c.project_id == settings.project_id,
                        )
                    ):
                        await c.execute(
                            insert(projects).values(
                                tenant_id=settings.tenant_id,
                                project_id=settings.project_id,
                                project_name=project_name or settings.project_id,
                            )
                        )
                principal = UserPrincipal(
                    subject="deployment-seed",
                    username="deployment-seed",
                    tenant_id=settings.tenant_id,
                    project_id=settings.project_id,
                    roles=(Role.PLATFORM_ADMIN,),
                )
                existing = await parameters.resolve(
                    settings.tenant_id, settings.project_id
                )
                keys = {(row["tool"], row["variable_name"]) for row in existing}
                for name in sorted(RUNTIME_FIELDS):
                    if ("runtime", name) in keys:
                        continue
                    value = getattr(settings, name)
                    kind = {
                        bool: "boolean",
                        int: "integer",
                        float: "number",
                        str: "string",
                    }[type(value)]
                    await parameters.define(
                        principal,
                        "runtime",
                        name,
                        ParameterDefinition(
                            value_type=kind,
                            description=name.replace("_", " ").capitalize(),
                            default_value=value,
                            allow_project_override=True,
                        ),
                    )
                for tool, name, reference in [
                    ("jira", "api_token", "env://JIRA_API_TOKEN"),
                    ("splunk", "token", "env://SPLUNK_TOKEN"),
                ]:
                    if (tool, name) not in keys:
                        await parameters.define(
                            principal,
                            tool,
                            name,
                            ParameterDefinition(
                                value_type="secret_ref",
                                description=f"{tool} credential reference",
                                default_value=reference,
                            ),
                        )
                digest = await seed_bundle(store.engine, settings, expected_bundle_hash)
                print(
                    f"Active configuration: {digest}; existing parameter values preserved"
                )
            finally:
                if store.engine.dialect.name == "postgresql":
                    await lock.execute(text("SELECT pg_advisory_unlock(726320260912)"))
    finally:
        await store.aclose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-name")
    parser.add_argument(
        "--expected-bundle-hash",
        help="Replace the active template bundle only if its current hash matches",
    )
    args = parser.parse_args()
    from dotenv import load_dotenv

    load_dotenv()
    os.environ["RCA_DATABASE_CONFIGURATION"] = "false"
    settings = Settings.from_env()
    if os.getenv("RCA_MIGRATION_DATABASE_URL"):
        settings = settings.model_copy(
            update={
                "database_url": settings.database_url.__class__(
                    os.environ["RCA_MIGRATION_DATABASE_URL"]
                )
            }
        )
    with ingestion_context("template-import"):
        asyncio.run(
            seed(settings, args.project_name, args.expected_bundle_hash)
        )


if __name__ == "__main__":
    main()
