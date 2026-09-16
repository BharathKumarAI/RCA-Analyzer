"""Authenticated topic previews reuse persisted connections and never widen scope."""

from pathlib import Path
from types import SimpleNamespace

from aiokafka.protocol.metadata import MetadataRequest_v4
from starlette.testclient import TestClient

from app.api.application import create_app
from app.connectors.providers.project_storage import project_prefix
from tests.support import connectors, settings_for


def test_kafka_topic_preview_real_provider_path_and_saved_scope(tmp_path, monkeypatch):
    monkeypatch.setenv("KAFKA_PASSWORD", "fixture-password")
    metadata_reads = []

    class Admin:
        def __init__(self, **kwargs):
            assert kwargs["bootstrap_servers"] == "broker.example:9093"
            assert kwargs["sasl_plain_username"] == "reader"

        async def start(self):
            pass

        async def _send_request(self, request):
            wire = request.build(MetadataRequest_v4)
            assert wire.allow_auto_topic_creation is False
            metadata_reads.append(wire.topics)
            return SimpleNamespace(to_object=lambda: {"topics": [{"topic": name, "error_code": 0,
                "partitions": [{"partition": 0, "leader": 1}]} for name in wire.topics]})

        async def close(self):
            pass

    monkeypatch.setattr("app.connectors.providers.infrastructure.AIOKafkaAdminClient", Admin)
    config = Path(tmp_path) / "projects" / project_prefix("acme", "payments") / "configuration"
    config.mkdir(parents=True)
    (config / "project.yaml").write_text("tenant_id: acme\nproject_id: payments\nenvironments:\n  - id: production\n    enabled: true\n")
    settings, token = settings_for(tmp_path)
    settings = settings.model_copy(update={"integration_allowed_hosts": "broker.example"})
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        app.state.platform.connector_options["kafka"]["enabled"] = True
        admin = token("admin")
        saved = client.post("/api/v1/projects/payments/connectors", headers=admin, json={
            "instance_id": "kafka_prod", "template_id": "kafka", "system_name": "Production messages",
            "expected_revision": 0,
            "environment_dependency": "dependent", "tool_environment": "Production",
            "definition": {"kafka_topic_selection": {"mode": "explicit", "topics": ["pay.a", "pay.b"]}},
            "bindings": [{"project_env_id": "production", "tool_env_id": "prod", "external_resource": "pay.a", "connection_id": "broker"}],
            "environment_connections": [{"connection_id": "broker", "connection_name": "Approved broker", "environment_name": "prod",
                "target": {"endpoint": "broker.example:9093"}, "auth_profile_id": "sasl_scram_tls",
                "credentials": {"username": "reader", "password_secret_ref": "env://KAFKA_PASSWORD"},
                "resource_scope": ["pay.a", "pay.b", "pay.private"]}],
        })
        assert saved.status_code == 200, saved.text
        path = "/api/v1/projects/payments/connectors/kafka_prod"
        tested = client.post(path + "/connections/broker/test", headers=admin)
        assert tested.status_code == 200 and tested.json()["overall_result"] == "PASSED", tested.text
        assert client.post(path + "/connections/broker/enable", headers=admin).status_code == 200
        scope = client.get(path + "/kafka/topics", headers=token("owner"))
        assert scope.status_code == 200, scope.text
        assert scope.json()["authorized_topics"] == ["pay.a", "pay.b", "pay.private"]
        assert scope.json()["discovery_performed"] is False
        selection = {"mode": "filters", "include": [{"operator": "glob", "value": "pay.*"}],
                     "exclude": [{"operator": "equals", "value": "pay.private"}]}
        preview = client.post(path + "/kafka/topics/preview", headers=token("owner"), json=selection)
        assert preview.status_code == 200, preview.text
        assert preview.json()["selected_topics"] == ["pay.a", "pay.b"]
        assert preview.json()["topics"][0]["partitions"] == [{"partition": 0, "leader": 1}]
        assert metadata_reads[-1] == ["pay.a", "pay.b"]
        assert preview.json()["environment_id"] == "production" and not preview.json()["partial"]
        count = len(metadata_reads)
        assert client.post(path + "/kafka/topics/preview", headers=token("owner"), json={"mode": "explicit", "topics": ["outside"]}).status_code == 422
        assert client.post(path + "/kafka/topics/preview?environment_id=foreign", headers=admin, json=selection).status_code == 422
        assert client.post(path.replace("payments", "foreign") + "/kafka/topics/preview", headers=admin, json=selection).status_code == 403
        assert client.post(path + "/kafka/topics/preview", headers=token("viewer"), json=selection).status_code == 403
        assert client.post(path + "/kafka/topics/preview", json=selection).status_code == 401
        assert len(metadata_reads) == count
        still_draft = client.get(path, headers=admin).json()
        assert still_draft["revision"] == 1 and still_draft["status"] == "draft"
