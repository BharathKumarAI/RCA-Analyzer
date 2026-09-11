"""Project artifacts, configuration and replay remain physically scope-separated."""

import asyncio
import shutil
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.capabilities.registry import CapabilityRegistry
from app.connectors.providers.blob import ConfigurationBlobStore
from app.connectors.providers.project_storage import project_prefix, scope_key
from app.fast_api_app import create_app
from app.optimization.content import read_platform, materialize
from app.settings import CONTENT_ROOT, Settings
from scripts.init_project import initialize_project, LAYOUT
from tests.support import settings_for
from tests.harness.test_approved_execution import SOURCE


def test_scope_paths_are_injective_and_cannot_escape(tmp_path):
    names = ["Payments", "payments", "../payments", "a/b", "a%2Fb", "東京"]
    assert len({scope_key(name) for name in names}) == len(names)
    for name in names:
        settings = Settings(
            tenant_id="../tenant", project_id=name, projects_root=tmp_path
        )
        path = Path(settings.artifact_uri("agent-configurations"))
        assert path.is_relative_to(tmp_path)
        assert len(path.relative_to(tmp_path).parts) == 6
    with pytest.raises(ValueError):
        scope_key("")


def test_initializer_is_idempotent_and_preserves_operator_edits(tmp_path):
    path = initialize_project(tmp_path, "acme", "payments", "analyst")
    assert all((path / relative / "README.md").is_file() for relative in LAYOUT)
    source = path / "configuration/project.yaml"
    data = yaml.safe_load(source.read_text())
    data["workflow"] = {"planning": False}
    source.write_text(yaml.safe_dump(data))
    saved = source.read_bytes()
    assert initialize_project(tmp_path, "acme", "payments", "analyst") == path
    assert source.read_bytes() == saved
    assert (path / "configuration/users" / f"{scope_key('analyst')}.yaml").is_file()


def test_default_local_and_gcs_artifact_locations_and_legacy_override(tmp_path):
    settings = Settings(tenant_id="acme", project_id="payments", projects_root=tmp_path)
    suffix = (
        project_prefix("acme", "payments")
        + "/artifacts/framework/optimizations/objects"
    )
    assert settings.artifact_uri("optimizations") == str(tmp_path / suffix)
    remote = settings.model_copy(
        update={"projects_blob_uri": "gs://example/rca/projects"}
    )
    assert remote.artifact_uri("optimizations") == "gs://example/rca/projects/" + suffix
    legacy = settings.model_copy(update={"config_blob_uri": str(tmp_path / "legacy")})
    assert legacy.artifact_uri("agent-configurations") == str(tmp_path / "legacy")


def test_identical_artifact_hashes_do_not_share_project_objects(tmp_path):
    async def exercise():
        a = Settings(tenant_id="acme", project_id="one", projects_root=tmp_path)
        b = Settings(tenant_id="acme", project_id="two", projects_root=tmp_path)
        first = ConfigurationBlobStore(a.artifact_uri("agent-configurations"))
        second = ConfigurationBlobStore(b.artifact_uri("agent-configurations"))
        digest = await first.put(b"id: example\n")
        with pytest.raises(FileNotFoundError):
            await second.get(digest)
        assert await second.put(b"id: example\n") == digest
        assert first._root != second._root
        assert await first.get(digest) == await second.get(digest)

    asyncio.run(exercise())


def test_project_configuration_and_replay_load_outside_platform(tmp_path):
    platform = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, platform)
    projects = tmp_path / "project-configs"
    project = initialize_project(projects, "acme", "payments")
    path = project / "configuration/project.yaml"
    data = yaml.safe_load(path.read_text())
    data["preferences"] = {"presentation": "table"}
    path.write_text(yaml.safe_dump(data))
    settings = Settings(content_root=platform, projects_root=projects)
    registry = CapabilityRegistry(str(platform / "capabilities"), projects)
    assert (
        registry.inheritance.projects[("acme", "payments")].preferences.presentation
        == "table"
    )
    bundle, _, files = read_platform(settings, registry)
    replay = tmp_path / "replay/platform"
    materialize(replay, files, bundle)
    replay_registry = CapabilityRegistry(str(replay / "capabilities"))
    assert replay_registry.content_hash == registry.content_hash
    assert (
        replay_registry.inheritance.projects[
            ("acme", "payments")
        ].preferences.presentation
        == "table"
    )
    assert not (replay / "layers/projects/project.yaml").exists()


def test_wrong_directory_scope_and_duplicate_legacy_scope_are_rejected(tmp_path):
    platform = tmp_path / "platform"
    shutil.copytree(CONTENT_ROOT, platform)
    projects = tmp_path / "projects"
    project = initialize_project(projects, "acme", "payments")
    path = project / "configuration/project.yaml"
    correct = path.read_text()
    path.write_text("tenant_id: another\nproject_id: payments\n")
    with pytest.raises(ValueError, match="scope does not match"):
        CapabilityRegistry(str(platform / "capabilities"), projects)
    path.write_text(correct)
    (platform / "layers/projects/legacy.yaml").write_text(correct)
    with pytest.raises(ValueError, match="Duplicate"):
        CapabilityRegistry(str(platform / "capabilities"), projects)


def test_project_symlinks_are_not_followed(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    root = tmp_path / "projects"
    scope = root / project_prefix("acme", "payments")
    scope.parent.mkdir(parents=True)
    scope.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symlinks"):
        initialize_project(root, "acme", "payments")
    with pytest.raises(ValueError, match="symlinks"):
        Settings(
            tenant_id="acme", project_id="payments", projects_root=root
        ).artifact_uri("optimizations")
    assert list(outside.iterdir()) == []


def test_api_writes_agent_blob_into_its_project_folder(tmp_path):
    settings, token = settings_for(tmp_path)
    settings = settings.model_copy(
        update={"config_blob_uri": None, "optimization_blob_uri": None}
    )
    project = initialize_project(
        settings.projects_root, settings.tenant_id, settings.project_id
    )
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/agent-configurations",
            headers=token("owner"),
            json={"yaml": SOURCE},
        )
        assert response.status_code == 201, response.text
        digest = response.json()["content_hash"][7:]
        assert (
            project / "artifacts/framework/objects/agents" / f"{digest}.yaml"
        ).is_file()
        assert (
            client.app.state.optimizations.blobs._root
            == project / "artifacts/framework/optimizations/objects"
        )
        assert response.json()["status"] == "PENDING"
