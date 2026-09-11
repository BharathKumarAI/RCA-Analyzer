"""MLflow receives ADK spans through the shared OTLP exporter, not active_run()."""


def record_run_metrics(span, *, status: str, latency_ms: float, evidence_count: int):
    span.set_attribute("rca.status", status)
    span.set_attribute("rca.latency_ms", latency_ms)
    span.set_attribute("rca.evidence_count", evidence_count)
