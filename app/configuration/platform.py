"""Load and validate the platform bundle once for the application lifetime."""

from dataclasses import dataclass

from app.capabilities.registry import CapabilityRegistry
from app.configuration.yaml_data import load_yaml_data
from app.inputs.files import FileLimits
from app.models.profiles import ModelProfiles
from app.optimization.models import OptimizationConfig
from app.tools.catalog import ALLOWED_ACTIONS
from app.configuration.models import ConnectorTemplate

STAGES = {"triage", "logs", "extraction", "synthesis", "router", "orchestrator"}


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
    def load(cls, settings, registry=None):
        def read(name):
            return load_yaml_data((settings.config_dir / name).read_text())

        def template_rows():
            path = settings.config_dir / "connector_templates.yaml"
            if not path.exists():
                return []
            rows = read("connector_templates.yaml")
            if not isinstance(rows, list):
                raise ValueError("connector_templates.yaml must define a list")
            return [ConnectorTemplate.model_validate(row) for row in rows]

        registry = registry or CapabilityRegistry(
            str(settings.content_root / "capabilities"), settings.projects_root
        )
        profiles = ModelProfiles.model_validate(read("model_profiles.yaml"))
        prompts = read("prompts.yaml")
        if (
            not isinstance(prompts, dict)
            or set(prompts) != STAGES
            or not all(
                isinstance(text, str) and text.strip() for text in prompts.values()
            )
        ):
            raise ValueError(
                "prompts.yaml must define all six nonempty stage instructions"
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
