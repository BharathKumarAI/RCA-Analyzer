import shutil
from pathlib import Path
import tempfile

from starlette.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_platform_configuration_editors_are_scoped_and_persistent():
    with tempfile.TemporaryDirectory() as tmp:
        settings, token = settings_for(tmp)
        config_dir = Path(tmp) / "config"
        shutil.copytree(settings.config_dir, config_dir)
        settings = settings.model_copy(update={"config_dir": config_dir})
        with TestClient(create_app(settings, connectors=connectors())) as client:
            viewer = client.get("/api/v1/platform/configuration/file-processing", headers=token("viewer"))
            assert viewer.status_code == 403
            response = client.get("/api/v1/platform/configuration/file-processing", headers=token("admin"))
            assert response.status_code == 200
            assert response.json()["activation"] == "next_upload"
            assert response.json()["fields"]["max_files"]["type"] == "integer"

            saved = client.put(
                "/api/v1/platform/configuration/file-processing",
                headers=token("admin"),
                json={"values": {**response.json()["values"], "max_files": 7}, "expected_hash": response.json()["content_hash"]},
            )
            assert saved.status_code == 200
            assert saved.json()["active_values"]["max_files"] == 7

            stale = client.put(
                "/api/v1/platform/configuration/file-processing",
                headers=token("admin"),
                json={"values": response.json()["values"], "expected_hash": response.json()["content_hash"]},
            )
            assert stale.status_code == 409

            invalid = client.put(
                "/api/v1/platform/configuration/file-processing",
                headers=token("admin"),
                json={"values": {**saved.json()["values"], "max_files": 0}, "expected_hash": saved.json()["content_hash"]},
            )
            assert invalid.status_code == 422

            optimization = client.get("/api/v1/platform/configuration/optimization", headers=token("admin"))
            assert optimization.status_code == 200
            assert optimization.json()["activation"] == "restart"
