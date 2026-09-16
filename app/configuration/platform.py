"""Load and validate the platform bundle once for the application lifetime."""

from dataclasses import dataclass
from typing import Any

from app.capabilities.registry import CapabilityRegistry
from app.configuration.yaml_data import load_yaml_data
from app.inputs.files import FileLimits
from app.models.profiles import ModelProfiles
from app.optimization.models import OptimizationConfig
from app.tools.catalog import ALLOWED_ACTIONS
from app.configuration.models import ConnectorTemplate, CatalogSkillRecord

STAGES = {"triage", "logs", "evidence", "extraction", "synthesis", "router", "orchestrator"}


def _normalize_legacy_connector_template(row: dict) -> dict:
    """Add project identity metadata while reading pre-schema catalog bundles.

    Older bundles contain operational connector defaults but no project-instance
    fields. Keep those values intact and synthesize only the three required form
    fields in memory. Publication still validates the complete typed contract.
    """
    existing_fields = row.get("parameter_fields")
    existing_names = {
        field.get("variable_name")
        for field in existing_fields
        if isinstance(field, dict)
    } if isinstance(existing_fields, list) else set()
    if "availability" in row and {
        "system_name",
        "environment_dependency",
        "tool_environment",
    } <= existing_names:
        return row
    normalized = dict(row)
    display_name = normalized.get("name") or normalized.get("system_name")
    if not isinstance(display_name, str) or not display_name.strip():
        raise ValueError("Legacy connector templates require a display name")
    existing = normalized.get("parameter_fields")
    fields = list(existing) if isinstance(existing, list) else []
    names = {field.get("variable_name") for field in fields if isinstance(field, dict)}
    core = (
        {
            "variable_name": "system_name",
            "label": "System Name",
            "description": "Project-defined connector instance name.",
            "value_type": "string",
            "default_value": display_name,
            "required": True,
            "allow_project_override": True,
            "visible_in_project": True,
            "ownership": "project_only",
            "category": "operational",
            "icon": "tag",
        },
        {
            "variable_name": "environment_dependency",
            "label": "Environment Dependent/Independent",
            "description": "Whether this connector is mapped per project environment.",
            "value_type": "string",
            "default_value": "independent",
            "allowed_values": ["dependent", "independent"],
            "required": True,
            "allow_project_override": True,
            "visible_in_project": True,
            "ownership": "project_only",
            "category": "operational",
            "icon": "layers",
        },
        {
            "variable_name": "tool_environment",
            "label": "Tool Environment",
            "description": "Authorized external tool environment; Shared for independent connectors.",
            "value_type": "string",
            "default_value": "Shared",
            "required": True,
            "allow_project_override": True,
            "visible_in_project": True,
            "ownership": "project_only",
            "category": "operational",
            "icon": "globe",
        },
    )
    fields.extend(field for field in core if field["variable_name"] not in names)
    normalized["parameter_fields"] = fields
    return normalized


@dataclass(frozen=True)
class PlatformConfiguration:
    registry: CapabilityRegistry
    profiles: ModelProfiles
    prompts: dict[str, str]
    file_limits: FileLimits
    connector_options: dict
    connector_templates: tuple[ConnectorTemplate, ...]
    optimization: OptimizationConfig

    @classmethod
    async def load_async(cls, engine, settings, tenant_id=None, registry=None):
        from sqlalchemy import select
        from app.configuration.parameters import system_configurations

        tenant = tenant_id or getattr(settings, "tenant_id", "default")
        db_configs: dict[str, Any] = {}
        try:
            async with engine.connect() as conn:
                rows = (
                    await conn.execute(
                        select(system_configurations).where(
                            system_configurations.c.tenant_id == tenant
                        )
                    )
                ).mappings().all()
                for r in rows:
                    if r["config_type"] == "skill":
                        db_configs.setdefault("skill_catalog", []).append(r["content_json"])
                        continue
                    db_configs[r["config_key"]] = r["content_json"]
        except Exception:
            db_configs = {}

        return cls._load_internal(settings, registry=registry, db_configs=db_configs)

    @classmethod
    def load(cls, settings, registry=None, db_configs=None):
        return cls._load_internal(settings, registry=registry, db_configs=db_configs)

    @classmethod
    def _load_internal(cls, settings, registry=None, db_configs=None):
        configs = db_configs or {}

        def read(name):
            key = name.removesuffix(".yaml")
            if key in configs:
                return configs[key]
            return load_yaml_data((settings.config_dir / name).read_text())

        def template_rows():
            dir_path = settings.config_dir / "connector_templates"
            yaml_files = sorted(dir_path.glob("*.yaml")) if dir_path.is_dir() else []
            if yaml_files:
                entries = []
                seen_templates: dict[tuple[str, str], str] = {}
                for file_path in yaml_files:
                    try:
                        doc = load_yaml_data(file_path.read_text())
                    except Exception as err:
                        raise ValueError(f"{file_path.name} failed YAML parsing: {err}") from err
                    if not isinstance(doc, dict):
                        raise ValueError(f"{file_path.name} must define a connector template object")
                    try:
                        template = ConnectorTemplate.model_validate(_normalize_legacy_connector_template(doc))
                    except Exception as err:
                        raise ValueError(f"{file_path.name} failed schema validation: {err}") from err
                    key = (template.system_name, template.version)
                    if key in seen_templates:
                        raise ValueError(
                            f"Duplicate connector template '{key[0]}:{key[1]}' defined in {file_path.name} (previously defined in {seen_templates[key]})"
                        )
                    seen_templates[key] = file_path.name
                    entries.append(template)
                return entries

            path = settings.config_dir / "connector_templates.yaml"
            if not path.exists():
                return []
            rows = read("connector_templates.yaml")
            if not isinstance(rows, list):
                raise ValueError("connector_templates.yaml must define a list")
            if not all(isinstance(row, dict) for row in rows):
                raise ValueError("connector_templates.yaml entries must be objects")
            return [
                ConnectorTemplate.model_validate(_normalize_legacy_connector_template(row))
                for row in rows
            ]

        skill_records = sorted((CatalogSkillRecord.model_validate(item) for item in configs.get("skill_catalog", [])),
                               key=lambda item: item.definition.id)
        registry = registry or CapabilityRegistry(
            str(settings.content_root / "capabilities"), settings.projects_root,
            managed_skills=[record.definition for record in skill_records],
            active_skill_ids=[record.definition.id for record in skill_records if record.status == "APPROVED"],
        )
        profiles = ModelProfiles.model_validate(read("model_profiles.yaml"))
        prompts = read("prompts.yaml")
        if (
            not isinstance(prompts, dict)
            or set(prompts) not in (STAGES, STAGES - {"evidence"})
            or not all(
                isinstance(text, str) and text.strip() for text in prompts.values()
            )
        ):
            raise ValueError(
                "prompts.yaml must define the six core nonempty stage instructions and optional evidence instruction"
            )
        for cap in registry.list_all():
            if cap.enabled and set(cap.allowed_actions) - ALLOWED_ACTIONS:
                raise ValueError(
                    "Enabled capability references an unimplemented tool action"
                )
            if cap.enabled:
                declared = set(cap.requires.connectors) | set(cap.optional.connectors)
                if {action.split(".", 1)[0] for action in cap.allowed_actions} - declared:
                    raise ValueError("Enabled capability action references an undeclared connector")
        referenced = {cap.model_profile for cap in registry.list_all()}
        referenced.update(registry.inheritance.policy.model_profiles)
        if referenced - profiles.profiles.keys():
            raise ValueError("Configuration references an unknown model profile")
        optimization = OptimizationConfig.model_validate(read("optimization.yaml"))
        for stage in (optimization.reflection_stage, optimization.judge_stage):
            if stage not in profiles.stages or not profiles.stages[stage].enabled:
                raise ValueError(
                    "Optimization requires enabled reflection and judge stages"
                )
        return cls(
            registry,
            profiles,
            prompts,
            FileLimits(**read("file_processing.yaml")),
            read("connectors.yaml"),
            tuple(template_rows()),
            optimization,
        )
