"""Topic selection is bounded and metadata requests cannot create broker topics."""

from types import SimpleNamespace

import pytest
from aiokafka.errors import IncompatibleBrokerVersion
from aiokafka.protocol.metadata import MetadataRequest_v3, MetadataRequest_v4

from app.configuration.platform import PlatformConfiguration
from app.connectors.candidate_testing import execute_candidate_test, validate_candidate_configuration
from app.connectors.kafka_topics import KafkaTopicSelection, authorized_topics, select_topics
from app.connectors.providers.infrastructure import KafkaConnector, ReadOnlyMetadataRequest
from app.connectors.providers.registry import resolve_connector_provider
from app.settings import Settings


def selection(**changes):
    return KafkaTopicSelection.model_validate({"mode": "filters", "include": [{"operator": "starts_with", "value": "pay."}],
                                              "exclude": [{"operator": "contains", "value": "secret"}], **changes})


def test_names_are_intersected_with_saved_scope_without_empty_fallback():
    assert select_topics(["pay.prod", "pay.secret", "other"], selection()) == ["pay.prod"]
    assert select_topics(["other"], selection()) == []
    assert select_topics(["PAY.prod"], selection()) == []
    with pytest.raises(ValueError, match="narrow"):
        select_topics(["pay.a", "pay.b"], selection(max_matched_topics=1))
    with pytest.raises(ValueError, match="outside"):
        select_topics(["pay.a"], KafkaTopicSelection(mode="explicit", topics=["outside"]))
    assert authorized_topics({"topic": "pay.a", "resource_scope": ["outside"]}) == ["pay.a"]
    with pytest.raises(ValueError, match="saved"):
        authorized_topics({"connection_id": "forged", "resource_scope": ["outside"]})


@pytest.mark.parametrize("body", [
    {"mode": "explicit", "topics": []}, {"mode": "filters", "include": []},
    {"mode": "filters", "include": [{"operator": "glob", "value": "[a-z]*"}]},
    {"mode": "filters", "include": [{"operator": "contains", "value": "*"}]},
    {"mode": "explicit", "topics": ["."]}, {"mode": "explicit", "topics": ["a", "a"]},
])
def test_invalid_or_ambiguous_selection_fails(body):
    with pytest.raises(ValueError):
        KafkaTopicSelection.model_validate(body)


def test_metadata_protocol_explicitly_disallows_topic_creation():
    request = ReadOnlyMetadataRequest(["pay.prod"])
    assert request.build(MetadataRequest_v4).allow_auto_topic_creation is False
    with pytest.raises(IncompatibleBrokerVersion):
        request.build(MetadataRequest_v3)


@pytest.mark.asyncio
async def test_native_metadata_fanout_bounds_partial_zero_and_cleanup(monkeypatch):
    requests, closed = [], []
    failed = set()

    class Admin:
        def __init__(self, **kwargs):
            assert kwargs["security_protocol"] == "SASL_SSL" and kwargs["sasl_mechanism"] == "SCRAM-SHA-512"

        async def start(self):
            pass

        async def _send_request(self, request):
            wire = request.build(MetadataRequest_v4)
            assert wire.allow_auto_topic_creation is False
            requests.append(wire.topics)
            return SimpleNamespace(to_object=lambda: {"topics": [
                {"topic": name, "error_code": 29 if name in failed else 0, "partitions": [{"partition": i} for i in range(3)]}
                for name in wire.topics]})

        async def close(self):
            closed.append(True)

    monkeypatch.setattr("app.connectors.providers.infrastructure.AIOKafkaAdminClient", Admin)
    provider = KafkaConnector(bootstrap_servers="broker:9093", topic="pay.a", username="reader", password="fixture",
                              allowed_topics=["pay.a", "pay.b", "pay.secret"], topic_selection=selection().model_dump(), max_results=4)
    result = await provider.read_evidence()
    assert requests == [["pay.a", "pay.b"]]
    assert [len(row["partitions"]) for row in result["topics"]] == [3, 1]
    assert result["possibly_truncated"] and not result["partial"] and len(closed) == 1
    failed.add("pay.b")
    assert (await provider.read_evidence())["partial"] is True
    assert (await provider.probe_health()).overall.value == "DEGRADED"
    provider.topic_selection = selection(include=[{"operator": "equals", "value": "not-in-scope"}])
    before = len(requests)
    result = await provider.read_evidence()
    assert result["selected_topics"] == [] and result["topics"] == [] and not result["partial"]
    assert len(requests) == before and len(closed) == 4


@pytest.mark.asyncio
async def test_saved_scope_and_partial_read_cannot_pass_activation(monkeypatch):
    monkeypatch.setenv("KAFKA_PASSWORD", "fixture")
    candidate = {"template_id": "kafka", "template_version": "1.0.0", "system_name": "Kafka", "environment_dependency": "independent",
                 "tool_environment": "Shared", "endpoint": "broker.example:9093", "external_resource": "pay.a",
                 "auth_type": "sasl_scram_tls", "credentials": {"username": "reader", "password_secret_ref": "env://KAFKA_PASSWORD"},
                 "kafka_topic_selection": {"mode": "explicit", "topics": ["pay.a"]}}
    template = next(row.model_dump(mode="json") for row in PlatformConfiguration.load(Settings()).connector_templates if row.type == "kafka")
    assert validate_candidate_configuration(candidate, template) == (True, [])
    provider = resolve_connector_provider("kafka", instance_definition=candidate)
    assert provider.allowed_topics == ["pay.a"]
    forged = {**candidate, "resource_scope": ["pay.a", "outside"], "kafka_topic_selection": {"mode": "explicit", "topics": ["outside"]}}
    assert validate_candidate_configuration(forged, template)[0] is False
    with pytest.raises(ValueError, match="outside"):
        resolve_connector_provider("kafka", instance_definition=forged)

    async def partial(_self):
        return {"partial": True, "topics": [{"topic": "pay.a", "status": "unavailable"}]}

    monkeypatch.setattr(KafkaConnector, "read_evidence", partial)
    result = await execute_candidate_test(candidate, template, "test_scoped_read")
    assert result["overall_result"] == "PARTIAL" and result["stage_results"]["scoped_read"]["status"] == "PARTIAL"
