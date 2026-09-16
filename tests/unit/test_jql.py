"""Typed JQL generation keeps literals and project restrictions intact."""

import json

import pytest
from pydantic import ValidationError

from app.connectors.jql import (
    JqlAssignees, JqlQuery, JqlTestRequest, build_jql, field_contract,
    resolve_member_accounts, scope_jql_expression, validate_member_mapping,
)


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


def test_nested_conditions_and_members_keep_independent_scope_guards():
    fields = [*FIELDS, {"id": "assignee", "name": "Assignee", "searchable": True,
                       "schema": {"type": "user"}, "operators": ["IN"]}]
    query = JqlQuery.model_validate({"match": "any", "filters": [{"field": "status", "operator": "=", "value": "Open"}],
        "groups": [{"match": "all", "filters": [{"field": "created", "operator": ">", "value": "-1d"},
                                                   {"field": "customfield_123", "operator": ">", "value": 5}]}],
        "assignees": {"role_ids": ["PROJECT_ANALYST"]}})
    members = [{"subject": "a", "roles": ["PROJECT_ANALYST"], "status": "active"},
               {"subject": "inactive", "roles": ["PROJECT_ANALYST"], "status": "inactive"}]
    accounts = resolve_member_accounts(query.assignees, {"a": "jira:account-1"}, members)
    assert accounts == ["jira:account-1"]
    assert build_jql("PAY", query, fields, member_accounts=accounts) == (
        'project = "PAY" AND ("status" = "Open" OR ("created" > "-1d" AND cf[123] > 5)) AND ("assignee" IN ("jira:account-1"))')
    with pytest.raises(ValueError, match="nonempty"):
        build_jql("PAY", query, fields)
    with pytest.raises(ValueError, match="mapping"):
        resolve_member_accounts(query.assignees, {}, members)
    with pytest.raises(ValueError, match="active"):
        resolve_member_accounts(JqlAssignees(member_ids=["foreign"]), {}, members)
    with pytest.raises(ValueError, match="active"):
        validate_member_mapping({"inactive": "some-account"}, members)
    with pytest.raises(ValueError, match="no active"):
        resolve_member_accounts(JqlAssignees(role_ids=["PROJECT_OWNER"]), {}, members)


def test_group_and_search_admission_is_bounded():
    for value in ({"groups": [{}]}, {"assignees": {}}, {"groups": [{"filters": [{"field": "status", "operator": "=", "value": "x"}] * 30}]}):
        with pytest.raises(ValidationError):
            JqlQuery.model_validate(value)
    group = {"filters": [{"field": "status", "operator": "=", "value": "x"}]}
    for _ in range(5):
        group = {"groups": [group]}
    with pytest.raises(ValidationError, match="nested"):
        JqlQuery.model_validate(group)
    for body in ({}, {"query": {}, "custom_jql": "status = Open"}, {"query": {}, "max_results": 51}):
        with pytest.raises(ValidationError):
            JqlTestRequest.model_validate(body)


def test_custom_query_order_cannot_escape_project_guard():
    assert scope_jql_expression('status = Open OR project = OTHER ORDER BY created DESC', 'PAY') == (
        'project = "PAY" AND (status = Open OR project = OTHER) ORDER BY created DESC')
    assert scope_jql_expression('summary ~ "ORDER BY foo"', 'PAY') == 'project = "PAY" AND (summary ~ "ORDER BY foo")'
    for query in ('status = Open) OR project = OTHER', 'status = "Open', 'status = Open ORDER BY created) OR project=OTHER',
                  'ORDER BY created', 'status=Open ORDER BY created DESC, key, priority, status'):
        with pytest.raises(ValueError):
            scope_jql_expression(query, 'PAY')
