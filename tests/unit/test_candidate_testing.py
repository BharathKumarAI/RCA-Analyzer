"""Candidate tests enforce project scope and exercise real provider operations."""

import httpx2
import pytest

from app.connectors.candidate_testing import (
    compute_candidate_hash,
    execute_candidate_test,
    validate_candidate_configuration,
)
from app.connectors.providers.jira import JiraConnector
from app.configuration.platform import PlatformConfiguration
from app.settings import Settings


def _template(connector_type: str) -> dict:
    template = next(
        item for item in PlatformConfiguration.load(Settings()).connector_templates
        if item.type == connector_type
    )
    return template.model_dump(mode="json")


def test_candidate_scope_does_not_fall_back_to_provider_environment(monkeypatch):
    monkeypatch.setenv("CONFLUENCE_SCOPE", "global-space")
    monkeypatch.setenv("CONFLUENCE_TOKEN", "deployment-token")
    candidate = {
        "template_id": "confluence",
        "template_version": "1.0.0",
        "system_name": "docs",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
    }

    valid, errors = validate_candidate_configuration(candidate, _template("confluence"))

    assert valid is False
    assert any("resource scope is required" in error for error in errors)


def test_candidate_identity_must_match_validated_template():
    candidate = {
        "template_id": "log_search",
        "template_version": "1.0.0",
        "system_name": "docs",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
        "scope": "docs",
    }

    valid, errors = validate_candidate_configuration(candidate, _template("confluence"))

    assert valid is False
    assert "Candidate template_id does not match the selected template." in errors


def test_candidate_mcp_route_cannot_fall_back_to_native_testing():
    candidate = {
        "template_id": "confluence",
        "template_version": "1.0.0",
        "system_name": "docs",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "access_mode": "MCP",
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
        "scope": "docs",
    }

    valid, errors = validate_candidate_configuration(candidate, _template("confluence"))

    assert valid is False
    assert any("approved MCP test route" in error for error in errors)


def test_candidate_rejects_conflicting_access_route_fields():
    candidate = {
        "template_id": "confluence",
        "template_version": "1.0.0",
        "system_name": "docs",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "access_mode": "Direct",
        "transport": "MCP",
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
        "scope": "docs",
    }

    valid, errors = validate_candidate_configuration(candidate, _template("confluence"))

    assert valid is False
    assert any("access_mode and transport" in error for error in errors)


def test_candidate_rejects_credentials_hidden_by_selected_auth_profile():
    candidate = {
        "template_id": "itsm",
        "template_version": "1.0.0",
        "system_name": "jira",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "endpoint": "https://jira.example",
        "auth_type": "basic_api_token",
        "credentials": {
            "account_identifier": "bot@example.test",
            "api_token_secret_ref": "env://JIRA_API_TOKEN",
            "domain": "jira.example",
        },
        "project_key": "PAY",
    }

    valid, errors = validate_candidate_configuration(candidate, _template("itsm"))

    assert valid is False
    assert any("inactive for the selected auth profile" in error for error in errors)
    assert all("jira.example" not in error for error in errors)


def test_candidate_rejects_wrong_project_types_and_boolean_numbers():
    candidate = {
        "template_id": "confluence",
        "template_version": "1.0.0",
        "system_name": 123,
        "environment_dependency": True,
        "tool_environment": 456,
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
        "scope": "docs",
        "timeout_seconds": True,
        "max_results": True,
    }

    valid, errors = validate_candidate_configuration(candidate, _template("confluence"))

    assert valid is False
    assert any("System Name is mandatory" in error for error in errors)
    assert any("Invalid environment dependency" in error for error in errors)
    assert any("Tool Environment is mandatory" in error for error in errors)
    assert any("timeout_seconds" in error for error in errors)
    assert any("max_results" in error for error in errors)


def test_candidate_rejects_unhashable_identity_legacy_environment_and_nonfinite_timeout():
    candidate = {
        "template_id": ["confluence"],
        "template_version": "1.0.0",
        "system_name": "docs",
        "environment_dependent": "false",
        "tool_environment": "Shared",
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
        "scope": "docs",
        "timeout_seconds": float("nan"),
    }

    valid, errors = validate_candidate_configuration(candidate, _template("confluence"))

    assert valid is False
    assert "Candidate template_id does not match the selected template." in errors
    assert any("Invalid environment dependency" in error for error in errors)
    assert any("timeout_seconds" in error for error in errors)


@pytest.mark.asyncio
async def test_execute_candidate_test_handles_malformed_credentials():
    candidate = {
        "template_id": "confluence",
        "template_version": "1.0.0",
        "system_name": "docs",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "endpoint": "https://confluence.example",
        "auth_type": "bearer_token",
        "credentials": None,
        "scope": "docs",
    }

    result = await execute_candidate_test(candidate, _template("confluence"))

    assert result["overall_result"] == "FAILED"
    assert "credentials must be a mapping" in result["error_message"]


def test_candidate_hash_covers_provider_parameters():
    base = {
        "template_id": "itsm",
        "template_version": "1.0.0",
        "system_name": "jira",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "endpoint": "https://jira.example",
        "auth_type": "basic_api_token",
        "credentials": {"api_token_secret_ref": "env://JIRA_API_TOKEN"},
        "project_key": "PAY",
    }

    first = compute_candidate_hash({**base, "custom_field_mapping": {"customfield_1": "Queue"}})
    second = compute_candidate_hash({**base, "custom_field_mapping": {"customfield_1": "Team"}})

    assert first != second


@pytest.mark.asyncio
async def test_scoped_read_does_not_count_health_as_a_success(monkeypatch):
    requested_paths = []

    async def handler(request):
        requested_paths.append(request.url.path)
        if request.url.path in ("/rest/api/2/project/PAY", "/rest/api/3/project/PAY"):
            return httpx2.Response(200, json={"key": "PAY"})
        return httpx2.Response(404, json={"error": "missing"})

    def controlled_jira(**kwargs):
        client = httpx2.AsyncClient(
            base_url=kwargs["base_url"],
            transport=httpx2.MockTransport(handler),
        )
        return JiraConnector(client=client, allow_insecure=True, **kwargs)

    monkeypatch.setattr("app.connectors.candidate_testing.JiraConnector", controlled_jira)
    monkeypatch.setenv("JIRA_API_TOKEN", "deployment-token")
    candidate = {
        "template_id": "itsm",
        "template_version": "1.0.0",
        "system_name": "jira",
        "environment_dependency": "independent",
        "tool_environment": "Shared",
        "endpoint": "http://jira.example",
        "auth_type": "basic_api_token",
        "credentials": {
            "account_identifier": "bot@example.test",
            "api_token_secret_ref": "env://JIRA_API_TOKEN",
        },
        "project_key": "PAY",
        "ticket_id": "PAY-1",
        "timeout_seconds": 5,
        "max_results": 10,
    }

    result = await execute_candidate_test(
        candidate,
        _template("itsm"),
        "test_scoped_read",
        allowed_secret_references={"env://JIRA_API_TOKEN"},
    )

    assert result["overall_result"] == "FAILED"
    assert result["stage_results"]["scoped_read"]["status"] == "NOT_RUN"
    assert any(p in requested_paths for p in ("/rest/api/3/issue/PAY-1", "/rest/api/2/issue/PAY-1"))
    assert not any("/project/PAY" in p for p in requested_paths)
