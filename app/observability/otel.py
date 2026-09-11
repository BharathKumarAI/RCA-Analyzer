"""One OTLP pipeline exporting metadata-only ADK spans to MLflow/collectors."""

import os
import logging
from urllib.parse import unquote

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SpanExporter,
    SpanExportResult,
)
from opentelemetry.trace import Status

logger = logging.getLogger(__name__)
SAFE_ATTRIBUTES = frozenset(
    {
        "gen_ai.system",
        "gen_ai.request.model",
        "gen_ai.response.model",
        "gen_ai.usage.input_tokens",
        "gen_ai.usage.output_tokens",
        "rca.run_id",
        "rca.capability",
        "rca.status",
        "rca.evidence_count",
        "rca.latency_ms",
    }
)
_provider = None
_exporter = None


class ObservedExporter(SpanExporter):
    def __init__(self, delegate):
        self.delegate = delegate
        self.failures = 0

    def export(self, spans):
        try:
            result = self.delegate.export(spans)
        except Exception:
            result = SpanExportResult.FAILURE
        if result == SpanExportResult.FAILURE:
            self.failures += 1
            logger.warning("Telemetry export failed; failure_count=%d", self.failures)
        return result

    def shutdown(self):
        self.delegate.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.delegate.force_flush(timeout_millis)


class MetadataOnlyProcessor(SpanProcessor):
    """Remove payloads and exception events before anything enters the export queue."""

    def __init__(self, delegate):
        self.delegate = delegate

    def on_start(self, span, parent_context=None):
        pass

    def on_end(self, span):
        safe = ReadableSpan(
            name=span.name,
            context=span.context,
            parent=span.parent,
            kind=span.kind,
            start_time=span.start_time,
            end_time=span.end_time,
            status=Status(span.status.status_code),
            attributes={
                k: v for k, v in (span.attributes or {}).items() if k in SAFE_ATTRIBUTES
            },
            events=(),
            links=(),
            resource=Resource(
                {
                    "service.name": span.resource.attributes.get(
                        "service.name", "rca-analyzer"
                    )
                }
            ),
            instrumentation_scope=span.instrumentation_scope,
        )
        self.delegate.on_end(safe)

    def shutdown(self):
        self.delegate.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.delegate.force_flush(timeout_millis)


def setup_telemetry():
    global _provider, _exporter
    if _provider is not None:
        return _provider
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    if not endpoint:
        base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        if not base:
            return None
        endpoint = base.rstrip("/") + "/v1/traces"
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

    headers = {}
    for pair in os.getenv("OTEL_EXPORTER_OTLP_HEADERS", "").split(","):
        key, separator, value = pair.partition("=")
        if separator:
            headers[key.strip()] = unquote(value.strip())
    experiment_id = os.getenv("MLFLOW_EXPERIMENT_ID")
    if experiment_id:
        headers["x-mlflow-experiment-id"] = experiment_id
    _exporter = ObservedExporter(
        OTLPSpanExporter(endpoint=endpoint, headers=headers, timeout=5)
    )
    _provider = TracerProvider(
        resource=Resource.create(
            {"service.name": os.getenv("OTEL_SERVICE_NAME", "rca-analyzer")}
        )
    )
    _provider.add_span_processor(MetadataOnlyProcessor(BatchSpanProcessor(_exporter)))
    trace.set_tracer_provider(_provider)
    return _provider


def telemetry_status():
    return {
        "enabled": _provider is not None,
        "export_failures": _exporter.failures if _exporter else 0,
    }


def get_tracer():
    return trace.get_tracer("rca.analyzer")
