"""Platform/project/user configuration is delegated, bounded and scope-specific."""

import os
import shutil
from unittest.mock import patch

import pytest
import yaml

from app.capabilities.registry import CapabilityRegistry
from app.capabilities.resolver import CapabilityResolver
from app.configuration.platform import PlatformConfiguration
from app.settings import CONTENT_ROOT, Settings
from tests.unit.test_policy_capabilities import principal


@pytest.fixture
def bundle(tmp_path):
    root = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, root)
    return root


def write_project(root, **values):
    (root / "layers/projects/project.yaml").write_text(
        yaml.safe_dump(
            {
                "tenant_id": "t1",
                "project_id": "p1",
                **values,
            }
        )
    )


def registry(root):
    return CapabilityRegistry(str(root / "capabilities"))


def test_project_ceiling_model_selection_and_user_preferences(bundle):
    write_project(
        bundle,
        capabilities={
            "incident_triage": {
                "model_profile": "fast-investigation",
                "allowed_actions": ["itsm.get_ticket"],
            }
        },
        limits={"max_llm_calls": 3, "max_tool_calls": 2, "max_context_chars": 256000},
        workflow={"parallel_evidence": True, "planning": False},
        prompts={"synthesis": "Project synthesis"},
        preferences={"presentation": "table", "detail": "concise"},
        allow_user_preferences=["presentation"],
    )
    (bundle / "layers/users/user.yaml").write_text(
        yaml.safe_dump(
            {
                "tenant_id": "t1",
                "project_id": "p1",
                "subject": "s1",
                "preferences": {"presentation": "timeline"},
            }
        )
    )
    loaded = registry(bundle)
    result = CapabilityResolver(loaded).resolve(
        "incident_triage", principal(), check_health=False
    )
    assert result.capability.allowed_actions == ("itsm.get_ticket",)
    assert result.model_profile == "fast-investigation"
    settings = Settings(parallel_evidence=False, max_context_chars=4000)
    runtime = loaded.inheritance.runtime(
        principal(), settings, {"synthesis": "Platform"}
    )
    assert runtime["settings"].max_llm_calls == 3
    assert runtime["settings"].max_context_chars == 4000
    assert settings.max_llm_calls == 12
    assert not runtime["workflow"].parallel_evidence
    assert not runtime["workflow"].planning
    assert runtime["prompts"]["synthesis"] == "Project synthesis"
    assert runtime["preferences"].presentation == "timeline"
    assert runtime["preferences"].detail == "concise"
    other = loaded.inheritance.runtime(
        principal(tenant="other"), settings, {"synthesis": "Platform"}
    )
    assert other["settings"].max_llm_calls == 12
    assert other["preferences"].presentation == "summary"


@pytest.mark.parametrize(
    "values",
    [
        {"capabilities": {"unknown": {}}},
        {"capabilities": {"log_correlation": {"allowed_actions": ["itsm.get_ticket"]}}},
        {"capabilities": {"incident_triage": {"model_profile": "unapproved-model"}}},
        {"capabilities": {"incident_triage": {"allowed_roles": ["GENERIC_USER"]}}},
        {"auth_public_key": "cannot-override"},
        {"limits": {"max_parallel_models": 99}},
        {"disabled_connectors": ["personal-calendar"]},
    ],
)
def test_project_cannot_expand_platform_authority(bundle, values):
    write_project(bundle, **values)
    with pytest.raises(ValueError):
        registry(bundle)


def test_platform_can_withhold_project_sections(bundle):
    path = bundle / "layers/platform.yaml"
    data = yaml.safe_load(path.read_text())
    data["project_sections"] = ["skills"]
    path.write_text(yaml.safe_dump(data))
    write_project(bundle, workflow={"planning": False})
    with pytest.raises(ValueError, match="not delegated"):
        registry(bundle)


def test_disabled_connectors_and_empty_roles_deny_capabilities(bundle):
    write_project(
        bundle,
        disabled_connectors=["itsm"],
        capabilities={
            "log_correlation": {"allowed_roles": []},
            "database_rca": {"enabled": True},
        },
    )
    resolver = CapabilityResolver(registry(bundle))
    for name in ("incident_triage", "log_correlation", "database_rca"):
        assert not resolver.resolve(name, principal(), check_health=False).is_authorized


@pytest.mark.parametrize(
    "field,value",
    [("capabilities", {}), ("limits", {}), ("preferences", {"detail": "detailed"})],
)
def test_user_cannot_modify_project_authority(bundle, field, value):
    write_project(bundle, allow_user_preferences=["presentation"])
    (bundle / "layers/users/user.yaml").write_text(
        yaml.safe_dump(
            {
                "tenant_id": "t1",
                "project_id": "p1",
                "subject": "s1",
                field: value,
            }
        )
    )
    with pytest.raises(ValueError):
        registry(bundle)


def test_model_catalog_and_runtime_secret_boundaries(bundle):
    path = bundle / "layers/platform.yaml"
    data = yaml.safe_load(path.read_text())
    data["model_profiles"].append("unknown")
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ValueError, match="unknown model profile"):
        PlatformConfiguration.load(Settings(content_root=bundle))
    path = bundle / "config/runtime.yaml"
    data = yaml.safe_load(path.read_text())
    data["tenant_id"] = "request-controlled"
    path.write_text(yaml.safe_dump(data))
    with patch.dict(os.environ, {"RCA_CONTENT_ROOT": str(bundle)}, clear=True):
        with pytest.raises(ValueError, match="deployment environment"):
            Settings.from_env()


def test_old_layer_layout_requires_explicit_migration(bundle):
    (bundle / "layers").rename(bundle / "skill_layers")
    with pytest.raises(ValueError, match="Migrate"):
        registry(bundle)
