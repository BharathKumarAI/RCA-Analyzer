"""Resolve published connector contracts from bundled and persisted versions."""

from dataclasses import replace
from typing import Any

from app.configuration.models import ConnectorTemplate


async def published_parameter_templates(
    platform_templates, store=None, *, parameter_store=None, tenant=None
) -> tuple[ConnectorTemplate, ...]:
    """Return the published catalog with database lifecycle rows taking precedence.

    A persisted draft/deprecated/retired row still shadows the bundled entry at
    the same ``(template_id, version)``. This keeps status-filtered catalog
    responses and parameter/runtime resolution from resurrecting a YAML version.
    """
    catalog = await _template_inventory(platform_templates, store)
    templates = tuple(item for _, item in sorted(catalog.items()) if item.availability == "published")
    if parameter_store is not None:
        from app.configuration.connector_governance import governed_templates
        templates = await governed_templates(parameter_store.engine, tenant, templates)
    return templates


async def _template_inventory(platform_templates, store=None):
    """Overlay lifecycle rows while retaining the platform inventory.

    Runtime and parameter callers filter this inventory to published entries.
    Keeping deprecated platform entries in the in-process bundle preserves
    governance and catalog visibility without allowing them to execute.
    """
    catalog = {
        (item.system_name, item.version): item for item in platform_templates
    }
    if store is None:
        return catalog
    for record in await store.list_connector_templates():
        template_id = record.get("template_id")
        version = record.get("version")
        if not isinstance(template_id, str) or not isinstance(version, str):
            raise ValueError("Persisted connector template identity is invalid")
        key = (template_id, version)
        catalog.pop(key, None)
        status = record.get("status")
        if status == "draft":
            continue
        definition = dict(record.get("definition_json") or {})
        # Database identity and lifecycle status are authoritative even if an
        # old definition contains stale aliases.
        definition.update(
            system_name=template_id,
            version=version,
            availability=status,
        )
        try:
            catalog[key] = ConnectorTemplate.model_validate(definition)
        except Exception:
            if status == "published":
                raise
            # A deprecated record may refer to an older, pre-schema definition;
            # it remains hidden from runtime until it is repaired or retired.
            continue
    return catalog


async def refresh_published_templates(platform, store) -> Any:
    """Refresh an immutable platform bundle's effective template inventory."""
    return replace(
        platform,
        connector_templates=tuple(
            item for _, item in sorted(
                (await _template_inventory(platform.connector_templates, store)).items()
            )
        ),
    )
