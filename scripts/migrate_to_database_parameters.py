"""Idempotent migration script: migrate application configurations and parameters to database tables."""

import argparse
import asyncio
import time
from typing import Any

from sqlalchemy import select, insert, update
from sqlalchemy.ext.asyncio import create_async_engine

from app.configuration.models import ConnectorTemplate
from app.configuration.parameters import (
    RUNTIME_FIELDS,
    definitions,
    system_configurations,
)
from app.configuration.platform import _normalize_legacy_connector_template
from app.configuration.yaml_data import load_yaml_data
from app.persistence.database import scoped_engine
from app.settings import Settings


async def migrate_to_database(settings: Settings, tenant_id: str) -> None:
    database_url = settings.database_url.get_secret_value()
    raw_engine = create_async_engine(database_url)
    engine = scoped_engine(raw_engine)

    try:
        async with engine.begin() as conn:
            # 1. Migrate system configurations to platform.system_configurations table
            config_files = {
                ("profiles", "model_profiles"): "model_profiles.yaml",
                ("prompts", "prompts"): "prompts.yaml",
                ("file_limits", "file_processing"): "file_processing.yaml",
                ("connectors", "connectors"): "connectors.yaml",
                ("optimization", "optimization"): "optimization.yaml",
            }

            for (cfg_type, cfg_key), filename in config_files.items():
                file_path = settings.config_dir / filename
                if not file_path.exists():
                    continue
                content = load_yaml_data(file_path.read_text())
                existing = (
                    await conn.execute(
                        select(system_configurations).where(
                            system_configurations.c.tenant_id == tenant_id,
                            system_configurations.c.config_type == cfg_type,
                            system_configurations.c.config_key == cfg_key,
                        )
                    )
                ).first()

                now = time.time()
                if existing:
                    await conn.execute(
                        update(system_configurations)
                        .where(
                            system_configurations.c.tenant_id == tenant_id,
                            system_configurations.c.config_type == cfg_type,
                            system_configurations.c.config_key == cfg_key,
                        )
                        .values(content_json=content, updated_at=now)
                    )
                else:
                    await conn.execute(
                        insert(system_configurations).values(
                            tenant_id=tenant_id,
                            config_type=cfg_type,
                            config_key=cfg_key,
                            content_json=content,
                            revision=1,
                            updated_at=now,
                        )
                    )

            # 2. Migrate connector template parameters into platform.parameter_definitions
            templates: list[ConnectorTemplate] = []
            dir_path = settings.config_dir / "connector_templates"
            yaml_files = sorted(dir_path.glob("*.yaml")) if dir_path.is_dir() else []
            if yaml_files:
                for f in yaml_files:
                    try:
                        doc = load_yaml_data(f.read_text())
                        templates.append(
                            ConnectorTemplate.model_validate(
                                _normalize_legacy_connector_template(doc)
                            )
                        )
                    except Exception as err:
                        print(f"Skipping invalid template file {f.name}: {err}")
            elif (settings.config_dir / "connector_templates.yaml").exists():
                docs = load_yaml_data((settings.config_dir / "connector_templates.yaml").read_text())
                if isinstance(docs, list):
                    for doc in docs:
                        templates.append(
                            ConnectorTemplate.model_validate(
                                _normalize_legacy_connector_template(doc)
                            )
                        )

            for tpl in templates:
                tool = tpl.system_name
                for field in tpl.parameter_fields:
                    var_name = field.variable_name
                    existing_def = (
                        await conn.execute(
                            select(definitions).where(
                                definitions.c.tenant_id == tenant_id,
                                definitions.c.tool == tool,
                                definitions.c.variable_name == var_name,
                            )
                        )
                    ).first()

                    now = time.time()
                    values: dict[str, Any] = {
                        "value_type": field.value_type,
                        "description": field.description,
                        "default_value": field.default_value,
                        "allow_project_override": field.allow_project_override,
                        "enabled": True,
                        "category": field.category or "operational",
                        "subcategory": field.subcategory,
                        "allowed_values": field.allowed_values,
                        "scope": "project" if field.allow_project_override else "platform",
                        "icon": field.icon or "settings",
                        "label": field.label or var_name,
                        "section": getattr(field, "section", None),
                        "display_order": getattr(field, "display_order", None),
                        "is_required": getattr(field, "is_required", False),
                        "ownership": getattr(field, "ownership", "runtime"),
                        "validation_rules": getattr(field, "validation_rules", None),
                        "runtime_binding": getattr(field, "runtime_binding", None),
                        "updated_at": now,
                    }

                    if existing_def:
                        await conn.execute(
                            update(definitions)
                            .where(
                                definitions.c.tenant_id == tenant_id,
                                definitions.c.tool == tool,
                                definitions.c.variable_name == var_name,
                            )
                            .values(**values)
                        )
                    else:
                        await conn.execute(
                            insert(definitions).values(
                                tenant_id=tenant_id,
                                tool=tool,
                                variable_name=var_name,
                                revision=1,
                                **values,
                            )
                        )

            # 3. Migrate runtime fields into platform.parameter_definitions
            for name in sorted(RUNTIME_FIELDS):
                existing_def = (
                    await conn.execute(
                        select(definitions).where(
                            definitions.c.tenant_id == tenant_id,
                            definitions.c.tool == "runtime",
                            definitions.c.variable_name == name,
                        )
                    )
                ).first()
                if not existing_def:
                    val = getattr(settings, name, None)
                    if val is not None:
                        val_type = "boolean" if isinstance(val, bool) else (
                            "integer" if isinstance(val, int) else (
                                "number" if isinstance(val, float) else "string"
                            )
                        )
                        await conn.execute(
                            insert(definitions).values(
                                tenant_id=tenant_id,
                                tool="runtime",
                                variable_name=name,
                                value_type=val_type,
                                description=f"Runtime setting: {name}",
                                default_value=val,
                                allow_project_override=True,
                                enabled=True,
                                category="runtime",
                                subcategory="operation",
                                allowed_values=None,
                                scope="project",
                                icon="settings",
                                label=name.replace("_", " ").title(),
                                revision=1,
                                updated_at=time.time(),
                            )
                        )

        print(f"Successfully migrated configurations and parameter definitions for tenant {tenant_id} to database tables.")
    finally:
        await raw_engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", help="Tenant ID to migrate")
    args = parser.parse_args()

    settings = Settings.from_env()
    tenant = args.tenant_id or settings.tenant_id or "default"
    asyncio.run(migrate_to_database(settings, tenant))


if __name__ == "__main__":
    main()
