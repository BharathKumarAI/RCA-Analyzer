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
            workspace = client.get("/api/v1/harness/workspace", headers=token("admin"))
            assert workspace.status_code == 200
            attachments = next(item for item in workspace.json()["catalog"] if item["id"] == "context:attachments")
            assert attachments["details"]["max_files"] == 7

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

            stages = client.get("/api/v1/runtime/stages", headers=token("admin")).json()
            triage = next(stage for stage in stages if stage["stage_id"] == "triage")
            saved_stage = client.put(
                "/api/v1/runtime/stages/triage", headers=token("admin"),
                json={key: triage[key] for key in (
                    "model", "thinking_level", "thinking_budget", "temperature", "enabled",
                )} | {"output_limit": 3072, "expected_hash": triage["content_hash"]},
            )
            assert saved_stage.status_code == 200
            setup = client.get("/api/v1/project/setup", headers=token("admin")).json()
            for stage in setup["stage_definitions"]:
                for binding in stage["bindings"]:
                    if binding["stage_id"] == "triage":
                        assert binding["max_output_tokens"] == 3072
            refreshed = client.get("/api/v1/harness/workspace", headers=token("admin")).json()
            models = [node for node in refreshed["graph"]["nodes"] if node["kind"] == "model"]
            assert models
            assert all(node["details"]["stages"]["triage"]["max_output_tokens"] == 3072 for node in models)
