"""Explicit template updates keep old snapshots and reject stale deployment reviews."""

import shutil

import pytest
from sqlalchemy import func, select, update

from app.configuration.database_bundle import (
    active,
    bundles,
    metadata,
    seed_bundle,
    update_bundle_file,
)
from app.connectors.providers.project_storage import project_prefix
from app.persistence.database import initialize_tables
from app.persistence.store import InvestigationStore
from app.settings import CONTENT_ROOT, Settings


@pytest.mark.asyncio
async def test_template_update_requires_current_hash_and_preserves_snapshots(tmp_path):
    root = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, root)
    settings = Settings(content_root=root, tenant_id="acme", project_id="first")
    database = InvestigationStore("sqlite+aiosqlite:///:memory:")
    await initialize_tables(database.engine, metadata)
    try:
        first = await seed_bundle(database.engine, settings)
        original = (root / "config/prompts.yaml").read_text()
        (root / "config/prompts.yaml").write_text(original + "\n# revised template\n")
        assert await seed_bundle(database.engine, settings) == first
        with pytest.raises(ValueError, match="Active configuration changed"):
            await seed_bundle(database.engine, settings, "stale-hash")
        second = await seed_bundle(database.engine, settings, first)
        assert second != first
        async with database.engine.connect() as c:
            assert await c.scalar(select(func.count()).select_from(bundles)) == 2
            assert await c.scalar(select(active.c.content_hash)) == second
            old = await c.scalar(
                select(bundles.c.files).where(bundles.c.content_hash == first)
            )
            assert old["config/prompts.yaml"] == original
        with pytest.raises(ValueError, match="Active configuration changed"):
            await seed_bundle(database.engine, settings, first)
        foreign = settings.model_copy(update={"project_id": "second"})
        with pytest.raises(ValueError, match="Active configuration changed"):
            await seed_bundle(database.engine, foreign, second)

        # Returning to an existing valid immutable snapshot is safe.
        (root / "config/prompts.yaml").write_text(original)
        assert await seed_bundle(database.engine, settings, second) == first
        async with database.engine.connect() as c:
            assert await c.scalar(select(func.count()).select_from(bundles)) == 2

        # An invalid proposed template must never become active.
        (root / "config/prompts.yaml").write_text("triage: incomplete\n")
        with pytest.raises(ValueError, match="prompts.yaml"):
            await seed_bundle(database.engine, settings, first)
        async with database.engine.connect() as c:
            assert await c.scalar(select(active.c.content_hash)) == first

        (root / "config/prompts.yaml").write_text(original)
        connector_path = root / "config/connectors.yaml"
        connectors = connector_path.read_text()
        connector_path.write_text("itsm: {}\n")
        with pytest.raises(ValueError, match="connectors.yaml"):
            await seed_bundle(database.engine, settings, first)
        connector_path.write_text(connectors)

        # A matching identifier does not make a corrupted stored snapshot reusable.
        (root / "config/prompts.yaml").write_text(original + "\n# revised template\n")
        async with database.engine.begin() as c:
            await c.execute(
                update(bundles)
                .where(bundles.c.content_hash == second)
                .values(files={"config/prompts.yaml": "corrupted"})
            )
        with pytest.raises(ValueError, match="integrity verification"):
            await seed_bundle(database.engine, settings, first)
        async with database.engine.connect() as c:
            assert await c.scalar(select(active.c.content_hash)) == first
    finally:
        await database.aclose()


@pytest.mark.asyncio
async def test_project_file_update_is_durable_in_active_bundle(tmp_path):
    settings = Settings(content_root=tmp_path / "platform", tenant_id="acme", project_id="first")
    shutil.copytree(CONTENT_ROOT, settings.content_root)
    database = InvestigationStore("sqlite+aiosqlite:///:memory:")
    await initialize_tables(database.engine, metadata)
    try:
        original = await seed_bundle(database.engine, settings)
        relative = f"projects/{project_prefix(settings.tenant_id, settings.project_id)}/configuration/project.yaml"
        content = "tenant_id: acme\nproject_id: first\nskills: {}\n"
        revised = await update_bundle_file(database.engine, settings, relative, content)
        assert revised != original
        async with database.engine.connect() as c:
            assert await c.scalar(select(active.c.content_hash)) == revised
            row = (
                await c.execute(
                    select(bundles.c.files).where(bundles.c.content_hash == revised)
                )
            ).first()
        assert row.files[relative] == content
    finally:
        await database.aclose()
