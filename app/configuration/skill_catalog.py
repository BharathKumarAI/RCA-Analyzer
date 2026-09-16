"""Database-owned instruction skills sharing the existing capability permission ceiling."""

import asyncio
from dataclasses import replace
from contextlib import asynccontextmanager
import os
from pathlib import Path
import tempfile
import time

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from app.configuration.models import CatalogSkillRecord, CatalogSkillReview
from app.configuration.parameters import audit, system_configurations
from app.runtime.run_contract import content_hash


async def _refresh_project_materialization(state):
    if not state.settings.database_configuration:
        return None
    from app.configuration.database_bundle import active, bundles
    from app.connectors.providers.project_storage import project_prefix

    settings = state.settings
    async with state.store.engine.connect() as connection:
        revision = await connection.scalar(select(active.c.content_hash).where(
            active.c.tenant_id == settings.tenant_id, active.c.project_id == settings.project_id))
        if revision is None:
            raise ValueError("Active project configuration is unavailable")
        if revision == getattr(state, "skill_project_bundle_hash", None):
            return None
        files = await connection.scalar(select(bundles.c.files).where(
            bundles.c.tenant_id == settings.tenant_id, bundles.c.project_id == settings.project_id,
            bundles.c.content_hash == revision))
    if files is None or content_hash(files) != revision:
        raise ValueError("Active project configuration failed integrity verification")
    relative = f"{project_prefix(settings.tenant_id, settings.project_id)}/configuration/project.yaml"
    source = files.get("projects/" + relative)
    target = Path(settings.projects_root) / relative
    if source is not None:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=".project-")
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(source)
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    else:
        target.unlink(missing_ok=True)
    return revision


class SkillConflict(ValueError):
    pass


async def _read_records(connection, tenant_id):
    values = await connection.scalars(select(system_configurations.c.content_json).where(
        system_configurations.c.tenant_id == tenant_id,
        system_configurations.c.config_type == "skill",
    ).order_by(system_configurations.c.config_key))
    records = tuple(CatalogSkillRecord.model_validate(value) for value in values)
    if any(record.content_hash != content_hash(record.definition.model_dump(mode="json")) for record in records):
        raise ValueError("Skill content failed integrity verification")
    return records


async def read_skills(engine, tenant_id):
    async with engine.connect() as connection:
        return await _read_records(connection, tenant_id)


@asynccontextmanager
async def _catalog_transaction(engine, principal):
    """Serialize all catalog validations and writes across workers using a DB revision."""
    try:
        async with engine.begin() as connection:
            key = (system_configurations.c.tenant_id == principal.tenant_id,
                   system_configurations.c.config_type == "skill_catalog",
                   system_configurations.c.config_key == "catalog_revision")
            revision = await connection.scalar(select(system_configurations.c.revision).where(*key))
            if revision is None:
                await connection.execute(insert(system_configurations).values(
                    tenant_id=principal.tenant_id, config_type="skill_catalog", config_key="catalog_revision",
                    content_json={}, revision=1, updated_at=time.time()))
            else:
                changed = await connection.execute(update(system_configurations).where(
                    *key, system_configurations.c.revision == revision).values(
                        revision=revision + 1, updated_at=time.time()))
                if changed.rowcount != 1:
                    raise SkillConflict("Skill catalog changed. Reload before saving.")
            # The write lock remains held through validation and publication.
            yield connection, await _read_records(connection, principal.tenant_id)
    except IntegrityError:
        raise SkillConflict("Skill already exists or the catalog changed. Reload before saving.") from None
    except OperationalError as exc:
        if "locked" in str(exc.orig).lower() or "busy" in str(exc.orig).lower():
            raise SkillConflict("Skill catalog is being updated. Reload before saving.") from None
        raise


def validate_records(registry, records):
    from app.capabilities.registry import CapabilityRegistry
    return CapabilityRegistry(str(registry.manifests_dir), registry.projects_root,
        managed_skills=[record.definition for record in records],
        active_skill_ids=[record.definition.id for record in records if record.status == "APPROVED"])


async def _audit(connection, principal, skill_id, action, revision):
    await connection.execute(insert(audit).values(
        tenant_id=principal.tenant_id, project_id=principal.project_id,
        tool="skills", variable_name=skill_id, actor_subject=principal.subject,
        action=action, revision=revision, created_at=time.time()))


async def create_skill(engine, principal, skill, registry):
    record = CatalogSkillRecord(definition=skill, status="PENDING",
        content_hash=content_hash(skill.model_dump(mode="json")), author_subject=principal.subject,
        project_id=principal.project_id, created_at=time.time())
    async with _catalog_transaction(engine, principal) as (connection, records):
        if skill.id in registry.skill_contents or any(item.definition.id == skill.id for item in records):
            raise SkillConflict("Skill already exists. Choose a different ID.")
        validate_records(registry, (*records, record))
        await connection.execute(insert(system_configurations).values(
            tenant_id=principal.tenant_id, config_type="skill", config_key=skill.id,
            content_json=record.model_dump(mode="json"), revision=1, updated_at=record.created_at))
        await _audit(connection, principal, skill.id, "submit", 1)
    return record


async def review_skill(engine, principal, skill_id, action, expected_hash, reason, registry):
    async with _catalog_transaction(engine, principal) as (connection, records):
        record = next((item for item in records if item.definition.id == skill_id), None)
        if record is None:
            raise LookupError("Skill review record not found")
        if record.project_id != principal.project_id:
            raise PermissionError("Skill review requires the author's project scope")
        if action in {"approve", "reject"} and record.author_subject == principal.subject:
            raise PermissionError("A different administrator must review this skill")
        required = "APPROVED" if action == "revoke" else "PENDING"
        if record.content_hash != expected_hash or record.status != required:
            raise SkillConflict("Skill content or review state changed. Reload before reviewing.")
        updated = record.model_copy(update={
            "status": {"approve": "APPROVED", "reject": "REJECTED", "revoke": "REVOKED"}[action],
            "reviewer_subject": principal.subject, "reviewed_at": time.time(), "review_reason": reason,
            "review_history": (*record.review_history, CatalogSkillReview(action=action,
                reviewer_subject=principal.subject, reviewed_at=time.time(), reason=reason,
                content_hash=record.content_hash)),
        })
        candidates = tuple(updated if item.definition.id == skill_id else item for item in records)
        validate_records(registry, candidates)
        await connection.execute(update(system_configurations).where(
            system_configurations.c.tenant_id == principal.tenant_id,
            system_configurations.c.config_type == "skill", system_configurations.c.config_key == skill_id,
        ).values(content_json=updated.model_dump(mode="json"),
                 revision=system_configurations.c.revision + 1, updated_at=updated.reviewed_at))
        await _audit(connection, principal, skill_id, action, 3 if action == "revoke" else 2)
    return updated


async def refresh_skill_catalog(request):
    """Refresh each worker at an authenticated request boundary, before resolution."""
    state = request.app.state
    if not hasattr(state, "skill_catalog_lock"):
        state.skill_catalog_lock = asyncio.Lock()
    async with state.skill_catalog_lock:
        project_revision = await _refresh_project_materialization(state)
        records = await read_skills(state.store.engine, state.settings.tenant_id)
        managed = tuple(record.definition for record in records)
        active_ids = frozenset(record.definition.id for record in records if record.status == "APPROVED")
        state.skill_records = records
        if (managed == state.registry.managed_skills and active_ids == state.registry.active_skill_ids
                and project_revision is None):
            return
        from app.capabilities.registry import CapabilityRegistry
        from app.optimization.content import read_platform

        registry = CapabilityRegistry(str(state.settings.content_root / "capabilities"),
                                      state.settings.projects_root, managed_skills=managed, active_skill_ids=active_ids)
        platform = replace(state.platform, registry=registry)
        state.registry, state.platform, state.harness = registry, platform, registry.harness
        state.configurations.registry = registry
        state.runner.registry, state.runner.platform = registry, platform
        state.runner.harness = registry.harness
        state.harness_workspace.registry, state.harness_workspace.platform = registry, platform
        state.optimizations.registry = registry
        (state.optimizations.base_bundle, state.optimizations.platform_hash,
         state.optimizations.files) = read_platform(state.settings, registry)
        if project_revision is not None:
            state.skill_project_bundle_hash = project_revision
