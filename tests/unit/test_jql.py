"""Typed JQL generation keeps literals and project restrictions intact."""

import json

import pytest
from pydantic import ValidationError

from app.connectors.jql import JqlQuery, build_jql, field_contract


FIELDS = [
    {"id": "status", "name": "Status", "searchable": True, "orderable": True, "schema": {"type": "status"}},
    {"id": "summary", "name": "Summary", "searchable": True, "schema": {"type": "string"}},
    {"id": "created", "name": "Created", "searchable": True, "orderable": True, "schema": {"type": "datetime"}},
    {"id": "customfield_123", "name": "Estimate", "searchable": True, "schema": {"type": "number"}},
]

for field in FIELDS:
    field["operators"] = ["=", "!=", "IN", "NOT IN", "~", "!~", ">", ">=", "<", "<=", "IS EMPTY", "IS NOT EMPTY"]


def test_typed_query_keeps_any_filters_inside_project_scope():
    query = JqlQuery.model_validate({"match": "any", "filters": [
        {"field": "status", "operator": "IN", "value": ["Open", "In Progress"]},
        {"field": "customfield_123", "operator": ">=", "value": 5},
        {"field": "created", "operator": ">=", "value": "-7d"},
    ], "order_by": [{"field": "created", "direction": "DESC"}]})
    assert build_jql("PRIVATE", query, FIELDS) == (
        'project = "PRIVATE" AND ("status" IN ("Open", "In Progress") OR cf[123] >= 5 OR "created" >= "-7d") ORDER BY "created" DESC'
    )
    assert build_jql("PRIVATE", JqlQuery(), FIELDS) == 'project = "PRIVATE"'


def test_quoted_value_cannot_become_a_jql_clause():
    value = 'Open" OR project = "OTHER" OR status = "Open'
    query = JqlQuery.model_validate({"filters": [{"field": "status", "operator": "=", "value": value}]})
    assert build_jql("PRIVATE", query, FIELDS) == f'project = "PRIVATE" AND ("status" = {json.dumps(value)})'
    query = JqlQuery.model_validate({"filters": [{"field": "summary", "operator": "~", "value": "error"}]})
    assert build_jql("PRIVATE", query, FIELDS) == 'project = "PRIVATE" AND ("summary" ~ "\\"error\\"")'


@pytest.mark.parametrize("condition", [
    {"field": "project", "operator": "=", "value": "OTHER"},
    {"field": "customfield_999", "operator": "=", "value": "Missing"},
    {"field": "summary", "operator": "=", "value": "Invalid operator"},
    {"field": "customfield_123", "operator": ">", "value": "five"},
    {"field": "created", "operator": ">", "value": "2026-02-30"},
    {"field": "status", "operator": "IN", "value": "Open"},
    {"field": "status", "operator": "IS EMPTY", "value": "Open"},
    {"field": "status", "operator": "=", "value": "bad\nvalue"},
])
def test_rejects_unsupported_fields_operators_and_values(condition):
    with pytest.raises(ValueError):
        build_jql("PRIVATE", JqlQuery.model_validate({"filters": [condition]}), FIELDS)


def test_rejects_scope_injection_and_limits_query_size():
    with pytest.raises(ValidationError):
        JqlQuery.model_validate({"project_id": "OTHER", "filters": []})
    with pytest.raises(ValidationError):
        JqlQuery.model_validate({"filters": [{"field": "status", "operator": "IN", "value": []}]})
    query = JqlQuery.model_validate({"filters": [{"field": "status", "operator": "IN", "value": ["x" * 512] * 10}]})
    with pytest.raises(ValueError, match="4096"):
        build_jql("PRIVATE", query, FIELDS)
    assert field_contract({**FIELDS[0], "searchable": False}) is None
