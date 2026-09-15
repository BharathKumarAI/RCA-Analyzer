"""Concrete migration script to activate modular connector templates bundle.

Safe bundle upgrade:
- Reads current active bundle content hash from active_configuration.
- Loads new files from blob_local/platform including connector_templates/*.yaml.
- Stores new bundle and updates active_configuration with expected_bundle_hash.
- Retains previous bundle row in configuration_bundles for rollback.
- Asserts that parameter_definitions, parameter_overrides, and project_connectors records survive.
"""

import asyncio
from dotenv import load_dotenv
from sqlalchemy import func, select

from app.configuration.database_bundle import active, bundles, metadata, seed_bundle
from app.configuration.parameters import definitions, overrides
from app.persistence.platform_admin import project_connector_instances_table
from app.persistence.store import InvestigationStore, initialize_tables
from app.settings import Settings


async def migrate_bundle():
    load_dotenv(".env")
    settings = Settings()
    if not settings.database_url:
        print("No database URL configured; skipping database bundle migration.")
        return

    store = InvestigationStore(settings.database_url.get_secret_value())
    await store.initialize()
    await initialize_tables(store.engine, metadata)

    async with store.engine.connect() as conn:
        scope = (
            active.c.tenant_id == settings.tenant_id,
            active.c.project_id == settings.project_id,
        )
        current_hash = await conn.scalar(select(active.c.content_hash).where(*scope))
        print(f"Current active bundle hash: {current_hash}")

        # Count existing operational data before migration
        pre_def_count = await conn.scalar(select(func.count()).select_from(definitions))
        pre_ovr_count = await conn.scalar(select(func.count()).select_from(overrides))
        pre_conn_count = await conn.scalar(select(func.count()).select_from(project_connector_instances_table))
        print(f"Pre-migration records: {pre_def_count} parameter definitions, {pre_ovr_count} overrides, {pre_conn_count} project connectors")

    new_hash = await seed_bundle(store.engine, settings, expected_bundle_hash=current_hash)
    print(f"New active bundle hash activated: {new_hash}")

    async with store.engine.connect() as conn:
        # Verify active hash
        active_hash = await conn.scalar(select(active.c.content_hash).where(*scope))
        assert active_hash == new_hash, f"Active hash mismatch: {active_hash} != {new_hash}"

        # Verify previous bundle is preserved in configuration_bundles for rollback
        if current_hash:
            prev_row = (await conn.execute(
                select(bundles).where(
                    bundles.c.tenant_id == settings.tenant_id,
                    bundles.c.project_id == settings.project_id,
                    bundles.c.content_hash == current_hash,
                )
            )).first()
            assert prev_row is not None, "Previous bundle was not preserved for rollback!"
            print(f"Verified: previous bundle {current_hash} is safely preserved in configuration_bundles.")

        # Verify operational records survived intact
        post_def_count = await conn.scalar(select(func.count()).select_from(definitions))
        post_ovr_count = await conn.scalar(select(func.count()).select_from(overrides))
        post_conn_count = await conn.scalar(select(func.count()).select_from(project_connector_instances_table))
        assert post_def_count >= pre_def_count, "Parameter definitions were unexpectedly lost!"
        assert post_ovr_count == pre_ovr_count, "Parameter overrides count changed!"
        assert post_conn_count == pre_conn_count, "Project connector instances count changed!"
        print(f"Post-migration records: {post_def_count} parameter definitions, {post_ovr_count} overrides, {post_conn_count} project connectors survived intact.")

    await store.aclose()
    print("Bundle migration completed successfully!")


if __name__ == "__main__":
    asyncio.run(migrate_bundle())
