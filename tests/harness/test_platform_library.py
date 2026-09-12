"""Cross-scope platform library contracts used by the runtime."""

import shutil

import pytest
import yaml
from fastapi.testclient import TestClient

from app.capabilities.registry import CapabilityRegistry
from app.capabilities.resolver import CapabilityResolver
from app.configuration.harness import HarnessCatalog
from app.configuration.models import HarnessSelection
from app.settings import CONTENT_ROOT, Settings
from tests.unit.test_policy_capabilities import principal
from tests.harness.test_architecture_flow import configured_app


@pytest.fixture
def bundle(tmp_path):
    root = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, root)
    return root


def project_layer(root, project_id, **values):
    path = root / "layers" / "projects" / f"{project_id}.yaml"
    path.write_text(
        yaml.safe_dump({"tenant_id": "tenant-a", "project_id": project_id, **values}),
        encoding="utf-8",
    )


def resolve(registry, project_id):
    return CapabilityResolver(registry).resolve(
        "incident_triage",
        principal(tenant="tenant-a", project=project_id),
        check_health=False,
    )


def test_two_projects_are_inherited_independently_and_survive_reload(bundle):
    project_layer(
        bundle,
        "payments",
        skills={"incident-triage": {"instruction": "Payments guidance"}},
        capabilities={"incident_triage": {"model_profile": "fast-investigation"}},
    )
    project_layer(
        bundle,
        "search",
        skills={"incident-triage": {"enabled": False}},
        limits={"max_llm_calls": 2},
    )

    first = CapabilityRegistry(str(bundle / "capabilities"))
    payments = resolve(first, "payments")
    search = resolve(first, "search")
    assert payments.skill_contents["incident-triage"] == "Payments guidance"
    assert payments.model_profile == "fast-investigation"
    assert "incident-triage" not in search.skill_contents
    assert "log-correlation" in search.skill_contents
    assert search.allowed_skills == ["log-correlation"]
    assert resolve(first, "unconfigured").skill_contents["incident-triage"] != "Payments guidance"

    reloaded = CapabilityRegistry(str(bundle / "capabilities"))
    assert resolve(reloaded, "payments").skill_contents["incident-triage"] == "Payments guidance"
    assert "incident-triage" not in resolve(reloaded, "search").skill_contents


def test_project_ceiling_flows_into_runtime_and_connector_dependency(bundle):
    project_layer(
        bundle,
        "payments",
        disabled_connectors=["itsm"],
        limits={"max_llm_calls": 2, "max_context_chars": 2000},
        prompts={"synthesis": "Project prompt"},
    )
    registry = CapabilityRegistry(str(bundle / "capabilities"))
    capability = resolve(registry, "payments")
    assert not capability.is_authorized
    assert "disabled" in capability.rejection_reason.lower()

    settings = Settings(max_llm_calls=12, max_context_chars=4000)
    runtime = registry.inheritance.runtime(
        principal(tenant="tenant-a", project="payments"), settings, {"synthesis": "Platform prompt"}
    )
    assert runtime["settings"].max_llm_calls == 2
    assert runtime["settings"].max_context_chars == 2000
    assert runtime["prompts"]["synthesis"] == "Project prompt"
    assert runtime["disabled_connectors"] == ("itsm",)


@pytest.mark.parametrize(
    "values",
    [
        {"skills": {"missing-skill": {"instruction": "x"}}},
        {
            "capabilities": {
                "incident_triage": {"allowed_actions": ["database.query_readonly"]}
            }
        },
        {"capabilities": {"missing_capability": {"enabled": True}}},
    ],
)
def test_project_cannot_write_unauthorized_or_broken_dependency_references(bundle, values):
    project_layer(bundle, "payments", **values)
    with pytest.raises(ValueError):
        CapabilityRegistry(str(bundle / "capabilities"))


def test_plugin_selection_is_runtime_scoped_and_failed_edit_keeps_old_catalog(bundle, tmp_path):
    registry = CapabilityRegistry(str(bundle / "capabilities"))
    source = bundle / "config" / "harness.yaml"
    catalog = HarnessCatalog(source).bind(registry)
    selected = HarnessSelection(plugins=("ticket-investigation",))
    agents, plugins = catalog.resolve(selected)
    assert {plugin.id for plugin in plugins} == {"ticket-investigation"}
    assert {agent.definition.id for agent in agents} == {"ticket_evidence_reviewer"}

    disabled = HarnessSelection(
        plugins=("ticket-investigation",), disabled_plugins=("ticket-investigation",)
    )
    disabled_agents, disabled_plugins = catalog.resolve(disabled)
    assert disabled_plugins == []
    assert {agent.definition.id for agent in disabled_agents} == set()

    old_revision = catalog.revision
    invalid = catalog.document.model_copy(
        update={"plugins": catalog.document.plugins + (catalog.document.plugins[0],)}
    )
    with pytest.raises(ValueError, match="Duplicate"):
        catalog.replace(invalid, old_revision)
    assert catalog.revision == old_revision

    persisted = HarnessCatalog(tmp_path / "harness.yaml").bind(registry)
    persisted.replace(catalog.document, persisted.revision)
    persisted.save()
    reloaded = HarnessCatalog(tmp_path / "harness.yaml").bind(registry)
    assert reloaded.revision == catalog.revision
    assert {a.definition.id for a in reloaded.resolve(selected)[0]} == {
        "ticket_evidence_reviewer"
    }


def test_harness_project_api_enforces_role_and_revision(tmp_path):
    app, token = configured_app(
        tmp_path,
        {"harness": {"plugins": ["ticket-investigation"]}},
    )
    policy_path = tmp_path / "platform" / "layers" / "platform.yaml"
    policy = yaml.safe_load(policy_path.read_text())
    policy["project_sections"] = [*policy["project_sections"], "harness"]
    policy_path.write_text(yaml.safe_dump(policy), encoding="utf-8")
    with TestClient(app) as client:
        current = client.get("/api/v1/harness", headers=token())
        assert current.status_code == 200
        body = current.json()
        assert body["selection"]["plugins"] == ["ticket-investigation"]
        assert body["effective_plugins"] == ["ticket-investigation"]
        assert body["project_revision"].startswith("sha256:")

        stale = client.put(
            "/api/v1/harness/project",
            headers=token("owner"),
            json={
                "selection": {},
                "expected_revision": "sha256:" + "0" * 64,
                "expected_project_revision": body["project_revision"],
            },
        )
        assert stale.status_code == 409

        forbidden = client.put(
            "/api/v1/harness/project",
            headers=token(),
            json={
                "selection": {},
                "expected_revision": body["revision"],
                "expected_project_revision": body["project_revision"],
            },
        )
        assert forbidden.status_code == 403
