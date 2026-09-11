"""Inheritance is scoped and cannot weaken the platform permission ceiling."""

import shutil

import pytest
import yaml

from app.capabilities.registry import CapabilityRegistry
from app.capabilities.resolver import CapabilityResolver
from app.settings import CONTENT_ROOT
from tests.unit.test_policy_capabilities import principal


@pytest.fixture
def bundle(tmp_path):
    root = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, root)
    return root


def layer(root, tier, skills, **extra):
    data = {"tenant_id": "t1", "project_id": "p1", "skills": skills, **extra}
    path = root / "layers" / tier / "scope.yaml"
    path.write_text(yaml.safe_dump(data))
    return path


def resolve(root, who=None, optimized=None):
    registry = CapabilityRegistry(str(root / "capabilities"))
    return CapabilityResolver(registry).resolve(
        "incident_triage",
        who or principal(),
        check_health=False,
        platform_contents=optimized,
    )


def test_precedence_scope_and_hash(bundle):
    baseline = resolve(bundle)
    layer(
        bundle,
        "projects",
        {"incident-triage": {"instruction": "Project"}},
        allow_user_overrides=["incident-triage"],
    )
    project = resolve(bundle)
    layer(
        bundle, "users", {"incident-triage": {"instruction": "Personal"}}, subject="s1"
    )
    user = resolve(bundle)
    assert user.skill_contents["incident-triage"] == "Personal"
    assert user.skill_sources["incident-triage"]["tier"] == "user"
    assert len({baseline.content_hash, project.content_hash, user.content_hash}) == 3
    other = principal().model_copy(update={"subject": "other"})
    assert resolve(bundle, other).skill_contents["incident-triage"] == "Project"
    for who in (principal(tenant="other"), principal(project="other")):
        assert resolve(bundle, who).skill_contents == baseline.skill_contents


@pytest.mark.parametrize(
    "tier,skills,extra",
    [
        ("projects", {"database-rca": {"enabled": False}}, {}),
        ("projects", {"unknown": {"instruction": "x"}}, {}),
        ("projects", {"incident-triage": {"actions": ["log_search.query_range"]}}, {}),
        ("projects", {"incident-triage": {"api_key": "not-accepted"}}, {}),
        ("users", {"incident-triage": {"instruction": "x"}}, {"subject": "s1"}),
    ],
)
def test_invalid_overrides_fail_closed(bundle, tier, skills, extra):
    layer(bundle, tier, skills, **extra)
    with pytest.raises(ValueError):
        resolve(bundle)


def test_project_denials_survive_user_override(bundle):
    layer(
        bundle,
        "projects",
        {
            "incident-triage": {"actions": []},
            "log-correlation": {"enabled": False},
        },
        allow_user_overrides=["incident-triage", "log-correlation"],
    )
    layer(
        bundle,
        "users",
        {
            "incident-triage": {"actions": ["itsm.get_ticket"]},
            "log-correlation": {"enabled": True},
        },
        subject="s1",
    )
    result = resolve(bundle)
    assert result.capability.allowed_actions == ()
    assert result.allowed_skills == ["incident-triage"]


def test_duplicate_scope_and_symlink_rejected(bundle):
    path = layer(bundle, "projects", {})
    duplicate = path.with_name("duplicate.yaml")
    shutil.copyfile(path, duplicate)
    with pytest.raises(ValueError, match="Duplicate"):
        resolve(bundle)
    duplicate.unlink()
    duplicate.symlink_to(path)
    with pytest.raises(ValueError, match="regular local"):
        resolve(bundle)


def test_optimization_obeys_immutable_policy_and_user_precedence(bundle):
    baseline = resolve(bundle)
    optimized = dict(baseline.skill_contents, **{"incident-triage": "Optimized"})
    assert (
        resolve(bundle, optimized=optimized).skill_contents["incident-triage"]
        == "Optimized"
    )
    policy_path = bundle / "layers/platform.yaml"
    policy = yaml.safe_load(policy_path.read_text())
    policy["skills"]["incident-triage"]["immutable"] = True
    policy_path.write_text(yaml.safe_dump(policy))
    assert (
        resolve(bundle, optimized=optimized).skill_contents == baseline.skill_contents
    )


def test_legacy_bundle_keeps_tools_but_deduplicates_skills(bundle):
    shutil.rmtree(bundle / "layers")
    registry = CapabilityRegistry(str(bundle / "capabilities"))
    cap = registry.get("incident_triage")
    cap = cap.model_copy(update={"skills": cap.skills + cap.skills})
    effective, contents, _ = registry.inheritance.resolve(
        cap, principal(), registry.skill_contents
    )
    assert effective.allowed_actions == cap.allowed_actions
    assert len(contents) == 2


@pytest.mark.parametrize(
    "text",
    [
        "tenant_id: t1\ntenant_id: t2\nproject_id: p1\n",
        "tenant_id: &tenant t1\nproject_id: *tenant\n",
    ],
)
def test_ambiguous_yaml_is_rejected(bundle, text):
    (bundle / "layers/projects/ambiguous.yaml").write_text(text)
    with pytest.raises(ValueError):
        resolve(bundle)


def test_explicit_layers_override_optimization_text(bundle):
    optimized = dict(resolve(bundle).skill_contents, **{"incident-triage": "Optimized"})
    layer(
        bundle,
        "projects",
        {"incident-triage": {"instruction": "Project"}},
        allow_user_overrides=["incident-triage"],
    )
    assert (
        resolve(bundle, optimized=optimized).skill_contents["incident-triage"]
        == "Project"
    )
    layer(bundle, "users", {"incident-triage": {"instruction": "User"}}, subject="s1")
    assert (
        resolve(bundle, optimized=optimized).skill_contents["incident-triage"] == "User"
    )
