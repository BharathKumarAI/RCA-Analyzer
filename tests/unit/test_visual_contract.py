"""Data-only visual contracts reject executable shapes and unsupported citations."""

import copy
import json

import pytest
from google.genai import _transformers
from google.genai._api_client import BaseApiClient
from pydantic import ValidationError

from app.runtime.run_contract import InvestigationResult


def visual_samples(evidence_id="ev_saved"):
    cited = {"basis": "observed", "evidence_ids": [evidence_id]}
    return [
        {"kind": "chart", "id": "errors", "title": "Error observations", "chart_type": "line", "x_label": "Window", "y_label": "Errors", "unit": "count",
         "points": [{"label": "First", "value": 0, **cited}, {"label": "Second", "value": None, **cited}]},
        {"kind": "table", "id": "details", "title": "Details", "columns": [{"id": "host", "label": "Host", "data_type": "text"}, {"id": "count", "label": "Errors", "data_type": "number", "unit": "count"}], "rows": [{"cells": ["api", None], **cited}]},
        {"kind": "code", "id": "code", "title": "Saved excerpt", "language": "python", "code": "  print('<script>')\n", **cited},
        {"kind": "graph", "id": "dependencies", "title": "Recorded relationships", "nodes": [{"id": "api", "label": "API", "node_type": "service", **cited}, {"id": "db", "label": "Database", "node_type": "database", **cited}], "edges": [{"id": "edge", "source": "api", "target": "db", "label": "queries", **cited}]},
    ]


def result(visuals):
    return InvestigationResult(outcome="FINDINGS", summary="Saved sources", findings=[{"summary": "Observation", "evidence_ids": ["ev_saved"]}], visuals=visuals)


def test_roundtrip_preserves_unknown_zero_code_and_provenance():
    saved = result(visual_samples())
    saved.validate_evidence({"ev_saved"})
    restored = InvestigationResult.model_validate_json(saved.model_dump_json())
    assert restored.visuals[0].points[0].value == 0
    assert restored.visuals[0].points[1].value is None
    assert restored.visuals[1].rows[0].cells[1] is None
    assert restored.visuals[2].code == "  print('<script>')\n"
    assert restored.visuals[3].nodes[0].status == "unknown"
    assert InvestigationResult(outcome="INSUFFICIENT_EVIDENCE", summary="No data").visuals == []


def test_visual_citations_are_scoped_for_every_data_kind():
    for visual in visual_samples("ev_from_other_run"):
        with pytest.raises(ValueError, match="unknown evidence"):
            result([visual]).validate_evidence({"ev_saved"})
    graph = visual_samples()[3]
    graph["edges"][0]["evidence_ids"] = ["ev_other"]
    with pytest.raises(ValueError, match="unknown evidence"):
        result([graph]).validate_evidence({"ev_saved"})


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True, "13"])
def test_chart_rejects_non_numeric_or_non_finite_measurements(value):
    visual = visual_samples()[0]
    visual["points"][0]["value"] = value
    with pytest.raises(ValidationError):
        result([visual])


def test_graph_reference_and_duplicate_limits():
    for change in [
        lambda graph: graph["edges"][0].update(target="missing"),
        lambda graph: graph["nodes"].append(copy.deepcopy(graph["nodes"][0])),
        lambda graph: graph["edges"].append(copy.deepcopy(graph["edges"][0])),
        lambda graph: graph.update(kind="blast_radius"),
        lambda graph: graph.update(focus_node_ids=["missing"]),
    ]:
        graph = visual_samples()[3]
        change(graph)
        with pytest.raises(ValidationError):
            result([graph])
    graph.update(focus_node_ids=["api"], kind="blast_radius")
    assert result([graph]).visuals[0].focus_node_ids == ["api"]
    graph["kind"] = "service_map"
    assert result([graph]).visuals[0].kind == "service_map"


def test_table_types_units_and_dimensions_are_enforced():
    for change in [
        lambda table: table["columns"][1].pop("unit"),
        lambda table: table["rows"][0].update(cells=["api"]),
        lambda table: table["rows"][0].update(cells=["api", "42"]),
        lambda table: table["rows"][0].update(cells=["api", True]),
        lambda table: table["columns"][1].update(id="host"),
    ]:
        table = visual_samples()[1]
        change(table)
        with pytest.raises(ValidationError):
            result([table])


def test_no_execution_fields_and_bounded_result_size():
    visual = visual_samples()[2]
    for field in ["html", "javascript", "onClick", "src", "url"]:
        with pytest.raises(ValidationError):
            result([{**visual, field: "https://example.test/executable"}])
    with pytest.raises(ValidationError):
        result([{**visual, "language": "html"}])
    with pytest.raises(ValidationError):
        result([visual, visual])
    with pytest.raises(ValidationError):
        result([{**visual, "id": f"code-{i}"} for i in range(7)])
    with pytest.raises(ValidationError, match="64 KiB"):
        result([{**visual, "id": f"code-{i}", "code": "文" * 8000} for i in range(3)])


def test_mermaid_is_bounded_cited_source_and_not_an_executable_shape():
    visual = {**visual_samples()[2], "language": "mermaid", "code": "flowchart LR\n  API --> Database\n"}
    saved = result([visual])
    saved.validate_evidence({"ev_saved"})
    assert InvestigationResult.model_validate_json(saved.model_dump_json()).visuals[0].code == visual["code"]
    with pytest.raises(ValueError, match="unknown evidence"):
        saved.validate_evidence({"ev_another_run"})
    with pytest.raises(ValidationError):
        result([{**visual, "code": "x" * 8001}])
    with pytest.raises(ValidationError):
        result([{**visual, "onClick": "execute"}])


def test_schema_compiles_with_installed_google_sdk():
    schema = InvestigationResult.model_json_schema()
    assert "anyOf" in schema["properties"]["visuals"]["items"]
    transformed = _transformers.t_schema(BaseApiClient(api_key="test-only"), InvestigationResult)
    assert transformed.properties["visuals"].max_items == 6
    assert "ChartVisual" in json.dumps(schema)
