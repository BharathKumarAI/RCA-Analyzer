"""Versioned configuration data; repository YAML is a deployment template."""

import json
from pathlib import Path, PurePosixPath
import re
import tempfile
import time

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import (
    Column,
    Float,
    JSON,
    MetaData,
    String,
    Table,
    insert,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError
from app.configuration.parameters import ParameterStore
from app.configuration.platform import PlatformConfiguration
from app.connectors.providers.registry import ConnectorOptions, CONNECTOR_IDS
from app.optimization.content import read_platform
from app.persistence.database import initialize_tables
from app.runtime.run_contract import content_hash

metadata = MetaData(schema="platform")
bundles = Table(
    "configuration_bundles",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("content_hash", String(128), primary_key=True),
    Column("files", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("created_at", Float, nullable=False),
)
active = Table(
    "active_configuration",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("content_hash", String(128), nullable=False),
)


def validate_files(files):
    if not isinstance(files, dict) or not files or len(files) > 1000:
        raise ValueError("Invalid configuration bundle")
    for name, value in files.items():
        if not isinstance(name, str) or not isinstance(value, str):
            raise ValueError("Invalid configuration entry")
        path = PurePosixPath(name)
        if path.is_absolute() or any(
            part in {"", ".", ".."} for part in name.split("/")
        ):
            raise ValueError("Invalid configuration path")
        if not re.fullmatch(r"[a-zA-Z0-9_.%/-]+", name):
            raise ValueError("Invalid configuration entry")
        if path.parts[0] not in {
            "config",
            "capabilities",
            "skills",
            "layers",
            "projects",
        }:
            raise ValueError("Configuration bundle cannot contain executable code")
        if path.suffix not in {".yaml", ".md"}:
            raise ValueError("Only declarative configuration files are supported")
    if len(json.dumps(files).encode()) > 8 * 1024 * 1024:
        raise ValueError("Configuration bundle exceeds 8 MiB")


async def seed_bundle(engine, settings, expected_bundle_hash=None):
    """Import once, or explicitly replace the scoped active version by expected hash."""
    platform = PlatformConfiguration.load(settings)
    if not isinstance(platform.connector_options, dict) or set(
        platform.connector_options
    ) - CONNECTOR_IDS or not {"itsm", "log_search"} <= set(platform.connector_options):
        raise ValueError("connectors.yaml must define itsm and log_search")
    for options in platform.connector_options.values():
        ConnectorOptions.model_validate(options)
    _, _, files = read_platform(settings, platform.registry)
    files = {k: v for k, v in files.items() if not k.startswith("policy/")}
    validate_files(files)
    digest = content_hash(files)
    try:
        return await _store_bundle(
            engine, settings, files, digest, expected_bundle_hash
        )
    except IntegrityError:
        raise ValueError(
            "Active configuration changed; reload its hash before retrying"
        ) from None


async def _store_bundle(engine, settings, files, digest, expected_bundle_hash):
    async with engine.begin() as c:
        scope = (
            active.c.tenant_id == settings.tenant_id,
            active.c.project_id == settings.project_id,
        )
        existing = await c.scalar(
            select(active.c.content_hash).where(*scope).with_for_update()
        )
        if expected_bundle_hash is not None and existing != expected_bundle_hash:
            raise ValueError(
                "Active configuration changed; reload its hash before retrying"
            )
        if existing and expected_bundle_hash is None:
            return existing
        snapshot = (
            await c.execute(
                select(bundles).where(
                    bundles.c.tenant_id == settings.tenant_id,
                    bundles.c.project_id == settings.project_id,
                    bundles.c.content_hash == digest,
                )
            )
        ).first()
        if snapshot is not None:
            if snapshot.files != files or content_hash(snapshot.files) != digest:
                raise ValueError(
                    "Existing configuration bundle failed integrity verification"
                )
        else:
            await c.execute(
                insert(bundles).values(
                    tenant_id=settings.tenant_id,
                    project_id=settings.project_id,
                    content_hash=digest,
                    files=files,
                    created_at=time.time(),
                )
            )
        if existing:
            result = await c.execute(
                update(active)
                .where(*scope, active.c.content_hash == expected_bundle_hash)
                .values(content_hash=digest)
            )
            if result.rowcount != 1:
                raise ValueError(
                    "Active configuration changed; reload its hash before retrying"
                )
        else:
            await c.execute(
                insert(active).values(
                    tenant_id=settings.tenant_id,
                    project_id=settings.project_id,
                    content_hash=digest,
                )
            )
    return digest


async def load_bundle(engine, settings, cleanup):
    await initialize_tables(engine, metadata)
    async with engine.connect() as c:
        row = (
            await c.execute(
                select(bundles)
                .join(
                    active,
                    (
                        (bundles.c.tenant_id == active.c.tenant_id)
                        & (bundles.c.project_id == active.c.project_id)
                        & (bundles.c.content_hash == active.c.content_hash)
                    ),
                )
                .where(
                    active.c.tenant_id == settings.tenant_id,
                    active.c.project_id == settings.project_id,
                )
            )
        ).first()
    if row is None:
        raise ValueError(
            "Seed project configuration before enabling database configuration"
        )
    validate_files(row.files)
    if content_hash(row.files) != row.content_hash:
        raise ValueError("Configuration bundle failed integrity verification")
    # Existing validators consume local YAML. This disposable materialization is
    # a cache of database data, never a second editable source of truth.
    directory = Path(
        cleanup.enter_context(tempfile.TemporaryDirectory(prefix="rca-config-"))
    )
    for name, value in row.files.items():
        path = (
            directory / name
            if name.startswith("projects/")
            else directory / "platform" / name
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")
    return settings.model_copy(
        update={
            "content_root": directory / "platform",
            "config_dir": directory / "platform/config",
            "projects_root": directory / "projects",
            "projects_blob_uri": settings.projects_blob_uri
            or str(settings.projects_root.resolve()),
        }
    )


async def update_bundle_file(engine, settings, relative_path: str, content: str):
    """Persist one declarative project file and atomically activate its bundle."""
    if not isinstance(relative_path, str) or not (
        relative_path.startswith("projects/") or relative_path.startswith("config/")
    ):
        raise ValueError("Only declarative project or platform configuration files can be updated")
    if not isinstance(content, str):
        raise ValueError("Configuration content must be text")
    async with engine.connect() as c:
        row = (
            await c.execute(
                select(bundles.c.files, bundles.c.content_hash)
                .join(
                    active,
                    (bundles.c.tenant_id == active.c.tenant_id)
                    & (bundles.c.project_id == active.c.project_id)
                    & (bundles.c.content_hash == active.c.content_hash),
                )
                .where(
                    active.c.tenant_id == settings.tenant_id,
                    active.c.project_id == settings.project_id,
                )
            )
        ).first()
    if row is None:
        raise ValueError("Seed project configuration before saving project files")
    validate_files(row.files)
    if content_hash(row.files) != row.content_hash:
        raise ValueError("Configuration bundle failed integrity verification")
    files = dict(row.files)
    files[relative_path] = content
    validate_files(files)
    digest = content_hash(files)
    return await _store_bundle(engine, settings, files, digest, row.content_hash)


async def load_effective_settings(engine, settings, cleanup):
    """Shared database configuration resolution for API and maintenance jobs."""
    store = ParameterStore(engine)
    platform = PlatformConfiguration.load(settings)
    await store.seed_connector_template_definitions(
        settings.tenant_id,
        platform.connector_templates,
        platform.connector_options,
    )
    if not settings.database_configuration:
        return settings, []
    import os
    from app.configuration.parameters import RUNTIME_FIELDS
    from app.settings import Settings

    configured = await load_bundle(engine, settings, cleanup)
    rows = await store.resolve(
        configured.tenant_id,
        configured.project_id,
        platform.connector_templates,
        platform.connector_options,
    )
    runtime = {
        row["variable_name"]: row["effective_value"]
        for row in rows
        if row["tool"] == "runtime"
    }
    if set(runtime) != RUNTIME_FIELDS:
        raise ValueError(
            "Database runtime parameters are incomplete; run the template import"
        )
    runtime.update(
        {
            name: os.environ["RCA_" + name.upper()]
            for name in runtime
            if "RCA_" + name.upper() in os.environ
        }
    )
    configured = Settings.model_validate(configured.model_dump() | runtime)
    configured.validate_runtime()
    return configured, rows
