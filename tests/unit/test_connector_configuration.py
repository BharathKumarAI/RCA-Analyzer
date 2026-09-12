"""Saved connector parameters reach live providers without accepting scope fields."""

from contextlib import AsyncExitStack

import pytest

from app.connectors.providers.registry import (
    build_connectors,
    configured_connector_values,
)


def row(tool, variable_name, value, *, revision=1, override_revision=None):
    return {
        "tool": tool,
        "variable_name": variable_name,
        "effective_value": value,
        "revision": revision,
        "override_revision": override_revision,
    }


def test_untouched_template_defaults_are_not_runtime_connector_values():
    defaults = [
        row("itsm", "endpoint", "https://sample.atlassian.net"),
        row("itsm", "service_user", "sample@example.test"),
        row("itsm", "timeout_seconds", 30),
        row("log_search", "endpoint", "https://sample.splunk.test"),
        row("log_search", "timeout_seconds", 30),
    ]
    assert configured_connector_values(defaults) == {}


def test_explicit_platform_edits_and_project_overrides_map_only_native_fields():
    values = configured_connector_values(
        [
            row("itsm", "endpoint", "https://jira.saved.test", revision=2),
            row("itsm", "service_user", "jira-saved@example.test", revision=2),
            row("itsm", "timeout_seconds", 17, revision=2),
            row("itsm", "max_response_bytes", 2_000_000, revision=2),
            row("log_search", "endpoint", "https://splunk.saved.test", revision=2),
            row("log_search", "service_user", "must-not-be-used", revision=2),
            row("log_search", "timeout_seconds", 23, revision=2),
            row("log_search", "max_response_bytes", 3_000_000, revision=2),
            row("log_search", "max_results", 250, revision=2),
            row("log_search", "max_window_seconds", 7_200, revision=2),
            # Project and index scope stay deployment-owned connector settings.
            row("itsm", "project_key", "FORGED", revision=99),
            row("log_search", "index", "forged-index", revision=99),
            row("log_search", "project", "forged-project", revision=99),
            row("project", "endpoint", "https://forged.test", revision=99),
        ]
    )
    assert values == {
        "itsm": {
            "base_url": "https://jira.saved.test",
            "user_email": "jira-saved@example.test",
            "timeout_s": 17,
            "max_response_bytes": 2_000_000,
        },
        "log_search": {
            "endpoint": "https://splunk.saved.test",
            "timeout_s": 23,
            "max_response_bytes": 3_000_000,
            "max_results": 250,
            "max_window_seconds": 7_200,
        },
    }

    project_values = configured_connector_values(
        [
            row("itsm", "endpoint", "https://jira.project.test", override_revision=1),
            row("itsm", "service_user", "jira-project@example.test", override_revision=1),
            row("itsm", "timeout_seconds", 19, override_revision=1),
            row("log_search", "endpoint", "https://splunk.project.test", override_revision=1),
            row("log_search", "timeout_seconds", 29, override_revision=1),
            row("log_search", "max_results", 75, override_revision=1),
            row("log_search", "max_window_seconds", 3_600, override_revision=1),
        ]
    )
    assert project_values == {
        "itsm": {
            "base_url": "https://jira.project.test",
            "user_email": "jira-project@example.test",
            "timeout_s": 19,
        },
        "log_search": {
            "endpoint": "https://splunk.project.test",
            "timeout_s": 29,
            "max_results": 75,
            "max_window_seconds": 3_600,
        },
    }


@pytest.mark.asyncio
async def test_build_connectors_passes_saved_runtime_values_to_native_providers(monkeypatch):
    monkeypatch.setenv("JIRA_API_TOKEN", "jira-test-token")
    monkeypatch.setenv("JIRA_PROJECT_KEY", "SAG")
    monkeypatch.setenv("JIRA_USER_EMAIL", "deployment@example.test")
    monkeypatch.setenv("SPLUNK_TOKEN", "splunk-test-token")
    monkeypatch.setenv("SPLUNK_INDEX", "payments")
    raw_options = {
        "itsm": {
            "enabled": True,
            "timeout_s": 5,
            "max_connections": 8,
            "max_keepalive_connections": 4,
            "max_response_bytes": 1_048_576,
            "secrets": {"api_token": "env://JIRA_API_TOKEN"},
        },
        "log_search": {
            "enabled": True,
            "timeout_s": 10,
            "max_connections": 8,
            "max_keepalive_connections": 4,
            "max_response_bytes": 1_048_576,
            "max_results": 100,
            "max_window_seconds": 86_400,
            "secrets": {"token": "env://SPLUNK_TOKEN"},
        },
    }
    rows = [
        row("itsm", "endpoint", "https://jira.runtime.test", revision=2),
        row("itsm", "service_user", "saved-jira@example.test", revision=2),
        row("itsm", "timeout_seconds", 17, revision=2),
        row("itsm", "max_response_bytes", 2_000_000, revision=2),
        row("log_search", "endpoint", "https://splunk.runtime.test", revision=2),
        row("log_search", "timeout_seconds", 23, revision=2),
        row("log_search", "max_response_bytes", 3_000_000, revision=2),
        row("log_search", "max_results", 250, revision=2),
        row("log_search", "max_window_seconds", 7_200, revision=2),
    ]

    async with AsyncExitStack() as cleanup:
        providers = build_connectors(
            raw_options,
            "live",
            cleanup,
            runtime_values=configured_connector_values(rows),
        )
        jira = providers["itsm"]
        splunk = providers["log_search"]
        assert jira.base_url == "https://jira.runtime.test"
        assert jira.user_email == "saved-jira@example.test"
        assert jira._client.timeout.read == 17
        assert jira.max_response_bytes == 2_000_000
        assert splunk.endpoint == "https://splunk.runtime.test"
        assert splunk._client.timeout.read == 23
        assert splunk.max_response_bytes == 3_000_000
        assert splunk.max_results == 250
        assert splunk.max_window_seconds == 7_200

