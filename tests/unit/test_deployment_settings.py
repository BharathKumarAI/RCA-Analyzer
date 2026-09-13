import pytest
import json
import shutil
from starlette.testclient import TestClient

from app.configuration import deployment_settings as ds
from app.api.application import create_app
from tests.support import connectors, settings_for


def test_deployment_settings_round_trip_and_conflict(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "DEPLOYMENT_SETTINGS_PATH", tmp_path / "deployment.yaml")
    monkeypatch.setattr(ds, "DEPLOYMENT_AUDIT_PATH", tmp_path / "deployment.audit")
    initial = ds.DeploymentSettings(mode="live", database_configuration=True, database_url_ref="env://RCA_DB")
    monkeypatch.setenv("RCA_DB", "postgresql+asyncpg://db")
    digest = ds.deployment_hash(ds.DeploymentSettings())
    saved = ds.save_deployment_settings(initial, "admin", digest)
    assert ds.load_deployment_settings().mode == "live"
    assert saved == ds.deployment_hash(initial)
    with pytest.raises(ValueError, match="changed"):
        ds.save_deployment_settings(initial, "admin", digest)
    assert "postgresql" not in (tmp_path / "deployment.audit").read_text()


def test_rejects_raw_credentials_and_missing_reference():
    with pytest.raises(ValueError):
        ds.DeploymentSettings(database_url_ref="postgresql://secret@host")
    with pytest.raises(ValueError):
        ds.DeploymentSettings(config_blob_uri="gs://bucket/path?token=secret")
    with pytest.raises(ValueError, match="unavailable"):
        ds.DeploymentSettings(database_url_ref="env://MISSING_DEPLOYMENT_REF").resolved()


def test_api_round_trip_schema_auth_and_startup_overlay(tmp_path, monkeypatch):
    deployment_file = tmp_path / "deployment.yaml"
    audit_file = tmp_path / "deployment.audit"
    monkeypatch.setattr(ds, "DEPLOYMENT_SETTINGS_PATH", deployment_file)
    monkeypatch.setattr(ds, "DEPLOYMENT_AUDIT_PATH", audit_file)
    settings, token = settings_for(tmp_path)
    config_dir = tmp_path / "config"
    shutil.copytree(settings.config_dir, config_dir)
    content_root = tmp_path / "platform"
    projects_root = tmp_path / "projects"
    app = create_app(settings.model_copy(update={"config_dir": config_dir}), connectors=connectors())
    with TestClient(app) as client:
        viewer = client.get("/api/v1/deployment/settings", headers=token("viewer"))
        assert viewer.status_code == 403
        current = client.get("/api/v1/deployment/settings", headers=token("admin"))
        assert current.status_code == 200
        body = current.json()
        assert "properties" in body["schema"]
        values = dict(body)
        values.pop("content_hash", None)
        values.pop("schema", None)
        values.pop("identity", None)
        values.pop("immutable_fields", None)
        values.pop("applies_after_restart", None)
        values.update({"mode": "demo", "database_configuration": False, "content_root": str(content_root), "config_dir": str(config_dir), "projects_root": str(projects_root)})
        saved = client.put("/api/v1/deployment/settings", headers=token("admin"), json={"values": values, "expected_hash": body["content_hash"]})
        # The endpoint uses flat fields, so retry with its declared write shape if needed.
        if saved.status_code == 422:
            saved = client.put("/api/v1/deployment/settings", headers=token("admin"), json={**values, "expected_hash": body["content_hash"]})
        assert saved.status_code == 200
        stale = client.put("/api/v1/deployment/settings", headers=token("admin"), json={**values, "expected_hash": body["content_hash"]})
        assert stale.status_code == 409

    monkeypatch.setenv("RCA_CONFIG_DIR", str(config_dir))
    monkeypatch.setenv("RCA_CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RCA_TENANT_ID", "acme")
    monkeypatch.setenv("RCA_PROJECT_ID", "payments")
    monkeypatch.setenv("RCA_AUTH_ISSUER", settings.auth_issuer)
    monkeypatch.setenv("RCA_AUTH_AUDIENCE", settings.auth_audience)
    monkeypatch.setenv("RCA_AUTH_PUBLIC_KEY", settings.auth_public_key)
    monkeypatch.setenv("RCA_PRINCIPALS_JSON", json.dumps({}))
    restarted = settings.__class__.from_env()
    assert restarted.mode == "demo"
    assert restarted.database_configuration is False
    assert restarted.content_root == content_root
    assert restarted.config_dir == config_dir
    assert restarted.projects_root == projects_root
