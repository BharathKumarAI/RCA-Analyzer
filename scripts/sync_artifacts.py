"""Rebuild framework stage views and generated chat exports from durable records."""

from contextlib import AsyncExitStack
from app.configuration.database_bundle import load_effective_settings
from app.persistence.lineage import ingestion_context
import argparse
import asyncio
import json
import time

from sqlalchemy import select

from app.configuration.platform import PlatformConfiguration
from app.configuration.service import AgentConfigurationService, drafts
from app.configuration.harness_bundles import export_archive
from app.configuration.harness_workspace import (
    HarnessWorkspaceService,
    activations as harness_activations,
    bundles as harness_bundles,
)
from app.connectors.providers.blob import ConfigurationBlobStore
from app.connectors.providers.framework_stages import FrameworkStageStore
from app.identity.principals import Role, UserPrincipal
from app.persistence.chat_artifacts import ChatArtifactStore
from app.persistence.store import InvestigationStore, runs
from app.runtime.run_contract import RunContract, TERMINAL_STATUSES
from app.settings import Settings


async def sync_artifacts(apply=False):
    settings = Settings.from_env()
    if not settings.tenant_id or not settings.project_id:
        raise ValueError("Configure tenant/project before synchronizing artifacts")
    store = InvestigationStore(settings.database_url.get_secret_value())
    cleanup_stack = AsyncExitStack()
    try:
        await store.initialize()
        settings, _ = await load_effective_settings(
            store.engine, settings, cleanup_stack
        )
        platform = PlatformConfiguration.load(settings)
        service = AgentConfigurationService(
            store.engine,
            ConfigurationBlobStore(
                settings.artifact_uri("agent-configurations"),
                settings.max_agent_yaml_bytes,
            ),
            platform.registry,
            platform.profiles,
            stage_store=FrameworkStageStore(settings),
        )
        await service.initialize()
        chat_artifacts = ChatArtifactStore(
            store, settings, platform.file_limits.max_file_bytes
        )
        async with store.engine.connect() as c:
            definitions = (
                await c.execute(
                    select(drafts).where(
                        drafts.c.tenant_id == settings.tenant_id,
                        drafts.c.project_id == settings.project_id,
                    )
                )
            ).all()
            completed = (
                await c.execute(
                    select(runs).where(
                        runs.c.tenant_id == settings.tenant_id,
                        runs.c.project_id == settings.project_id,
                        runs.c.status.in_(TERMINAL_STATUSES),
                        runs.c.updated_at
                        > time.time() - settings.retention_days * 86400,
                    )
                )
            ).all()
            approved_harness = (
                await c.execute(
                    select(harness_bundles)
                    .join(
                        harness_activations,
                        harness_bundles.c.draft_id == harness_activations.c.draft_id,
                    )
                    .where(
                        harness_bundles.c.tenant_id == settings.tenant_id,
                        harness_bundles.c.project_id == settings.project_id,
                        harness_bundles.c.status == "APPROVED",
                    )
                )
            ).all()
        chat_runs = [
            r
            for r in completed
            if json.loads(r.contract_json)["request"].get("chat_id")
        ]
        if apply:
            for row in definitions:
                principal = UserPrincipal(
                    subject=row.author_subject,
                    username=row.author_subject,
                    tenant_id=row.tenant_id,
                    project_id=row.project_id,
                    roles=(),
                )
                await service.sync_stage(row.draft_id, principal, strict=True)
            for row in chat_runs:
                await chat_artifacts.save_output(
                    store._response(row),
                    RunContract.model_validate_json(row.contract_json).principal,
                )
            # Harness Studio exports are derived on demand by the API. Rebuild
            # each active approved archive here for integrity checking without
            # introducing a second, undocumented export storage namespace.
            harness_workspace = HarnessWorkspaceService(
                store.engine,
                ConfigurationBlobStore(
                    settings.artifact_uri("agent-configurations") + "/harness",
                    1048576,
                    suffix=".json",
                ),
                platform,
                settings,
                service,
            )
            await harness_workspace.initialize()
            maintenance_principal = UserPrincipal(
                subject="service:sync-artifacts",
                username="service:sync-artifacts",
                tenant_id=settings.tenant_id,
                project_id=settings.project_id,
                roles=(Role.PLATFORM_ADMIN,),
            )
            for row in approved_harness:
                bundle = await harness_workspace.load(row)
                compilation = harness_workspace.validate(maintenance_principal, bundle)
                export_archive(bundle.files, compilation.diagnostics)
        print(
            json.dumps(
                {
                    "framework_stage_views": len(definitions),
                    "chat_created_outputs": len(chat_runs),
                    "harness_approved_bundles": len(approved_harness),
                    "harness_exports_rebuilt": len(approved_harness) if apply else 0,
                    "applied": apply,
                }
            )
        )
    finally:
        await cleanup_stack.aclose()
        await store.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write derived stage views and exports; default reports counts",
    )
    from dotenv import load_dotenv

    load_dotenv()
    with ingestion_context("maintenance"):
        asyncio.run(sync_artifacts(parser.parse_args().apply))
