"""Telemetry exports operational metadata without model/connector payloads."""

import unittest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace import Status, StatusCode
from app.observability.otel import MetadataOnlyProcessor


class Collector:
    def __init__(self):
        self.spans = []

    def on_end(self, span):
        self.spans.append(span)

    def shutdown(self):
        pass


class TelemetryTests(unittest.TestCase):
    def test_payloads_errors_and_resource_secrets_are_removed(self):
        collector = Collector()
        provider = TracerProvider(
            resource=Resource({"service.name": "rca", "secret": "private"})
        )
        provider.add_span_processor(MetadataOnlyProcessor(collector))
        with provider.get_tracer("test").start_as_current_span(
            "rca.investigation"
        ) as span:
            span.set_attribute("rca.run_id", "run-test")
            span.set_attribute("gen_ai.prompt", "private ticket")
            span.add_event("exception", {"exception.message": "secret"})
            span.set_status(Status(StatusCode.ERROR, "secret"))
        exported = collector.spans[0]
        self.assertEqual(dict(exported.attributes), {"rca.run_id": "run-test"})
        self.assertEqual(dict(exported.resource.attributes), {"service.name": "rca"})
        self.assertFalse(exported.events)
        self.assertIsNone(exported.status.description)
        provider.shutdown()
