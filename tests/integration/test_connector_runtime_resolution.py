"""Tests for environment-aware connector runtime resolution."""

import asyncio
from types import SimpleNamespace

import pytest
from app.connectors.providers.registry import resolve_connector_provider, resolve_project_connector
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector
from app.identity.principals import Role, UserPrincipal
from app.runtime.runner import ExecutionRunner


def test_resolve_connector_provider_from_candidate(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    monkeypatch.setenv("RESOLVED_SPLUNK_TOKEN", "splunk-67890")

    # 1. Jira resolution
    jira_candidate = {
        "template_id": "itsm",
        "system_name": "jira_primary",
        "endpoint": "https://company.atlassian.net",
        "project_key": "PAY",
        "credentials": {
            "account_identifier": "svc-jira@company.com",
            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
        },
        "timeout_seconds": 15,
    }
    jira_client = resolve_connector_provider("itsm", instance_definition=jira_candidate)
    assert isinstance(jira_client, JiraConnector)
    assert jira_client.base_url == "https://company.atlassian.net"
    assert jira_client.user_email == "svc-jira@company.com"
    assert jira_client.api_token == "token-12345"

    # 2. Splunk resolution
    splunk_candidate = {
        "template_id": "log_search",
        "system_name": "splunk_prod",
        "endpoint": "https://splunk-api.company.internal:8089",
        "index": "payments",
        "credentials": {
            "token_secret_ref": "env://RESOLVED_SPLUNK_TOKEN",
        },
        "timeout_seconds": 20,
        "max_results": 50,
    }
    splunk_client = resolve_connector_provider("log_search", instance_definition=splunk_candidate)
    assert isinstance(splunk_client, SplunkConnector)
    assert splunk_client.endpoint == "https://splunk-api.company.internal:8089"
    assert splunk_client.token == "splunk-67890"
    assert splunk_client.max_results == 50

    # 3. Oracle policy block
    with pytest.raises(ValueError, match="Oracle connector execution is blocked by policy"):
        resolve_connector_provider("oracle", instance_definition={"template_id": "oracle"})


def test_project_instance_cannot_fall_back_to_global_scope(monkeypatch):
    monkeypatch.setenv("CONFLUENCE_ENDPOINT", "https://global.example")
    monkeypatch.setenv("CONFLUENCE_SCOPE", "global-space")
    monkeypatch.setenv("CONFLUENCE_TOKEN", "global-token")
    definition = {
        "template_id": "confluence",
        "status": "enabled",
        "enabled": True,
        "endpoint": "https://project.example",
        "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
    }

    with pytest.raises(ValueError, match="resource scope is required"):
        resolve_connector_provider("confluence", instance_definition=definition)


def test_enabled_dependent_instance_requires_one_environment_binding(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    definition = {
        "template_id": "itsm",
        "status": "enabled",
        "enabled": True,
        "endpoint": "https://company.atlassian.net",
        "credentials": {
            "account_identifier": "svc-jira@company.com",
            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
        },
        "environment_dependency": "dependent",
        "bindings": [
            {"project_env_id": "prod", "external_resource": "PAY"},
            {"project_env_id": "stage", "external_resource": "PAY"},
        ],
    }

    with pytest.raises(ValueError, match="requires an environment id"):
        resolve_connector_provider("itsm", instance_definition=definition)


def test_project_resolver_flattens_scoped_store_instance(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    instance = {
        "tenant_id": "acme",
        "project_id": "payments",
        "instance_id": "jira-main",
        "template_id": "itsm",
        "template_version": "1.0.0",
        "system_name": "jira-main",
        "status": "enabled",
        "enabled": True,
        "definition_json": {
            "environment_dependency": "independent",
            "tool_environment": "Shared",
            "endpoint": "https://company.atlassian.net",
            "project_key": "PAY",
            "auth_type": "basic_api_token",
            "credentials": {
                "account_identifier": "svc-jira@company.com",
                "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
            },
        },
        "bindings": [],
    }

    client = resolve_project_connector(
        instance,
        deployment_tenant_id="acme",
        deployment_project_id="payments",
    )
    assert isinstance(client, JiraConnector)
    assert client.project_key == "PAY"


def test_runtime_blocks_connector_binding_outside_active_project_environment():
    class InstanceStore:
        async def list_project_connector_instances(self, tenant_id, project_id):
            return [
                {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "instance_id": "jira-main",
                    "template_id": "itsm",
                    "template_version": "1.0.0",
                    "status": "enabled",
                    "enabled": True,
                    "definition_json": {
                        "environment_dependency": "dependent",
                        "endpoint": "https://company.atlassian.net",
                    },
                    "bindings": [
                        {"project_env_id": "staging", "external_resource": "PAY"}
                    ],
                }
            ]

    class Inheritance:
        @staticmethod
        def project(principal):
            return SimpleNamespace(
                environments=(SimpleNamespace(id="production", enabled=True),)
            )

    runner = object.__new__(ExecutionRunner)
    runner.connector_instance_store = InstanceStore()
    runner.registry = SimpleNamespace(inheritance=Inheritance())
    runner.connectors = {}
    runner.connector_enabled_adapters = {"itsm"}
    runner.connector_secret_references = set()
    runner.connector_allowed_hosts = None
    runner.platform = SimpleNamespace(
        connector_templates=(
            SimpleNamespace(
                system_name="itsm",
                type="itsm",
                version="1.0.0",
                availability="published",
                platform_enabled=True,
                is_enabled_by_policy=True,
            ),
        )
    )
    principal = UserPrincipal(
        subject="owner",
        username="owner",
        tenant_id="acme",
        project_id="payments",
        roles=[Role.PROJECT_OWNER],
    )

    with pytest.raises(PermissionError, match="inactive or out-of-scope project environments"):
        asyncio.run(runner._connectors_for_run(principal, {"itsm"}, {"itsm"}))
