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
        "auth_type": "api_token",
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
        "max_window_seconds": 3600,
        "max_response_bytes": 2048,
    }
    splunk_client = resolve_connector_provider("log_search", instance_definition=splunk_candidate)
    assert isinstance(splunk_client, SplunkConnector)
    assert splunk_client.endpoint == "https://splunk-api.company.internal:8089"
    assert splunk_client.token == "splunk-67890"
    assert splunk_client.max_results == 50
    assert splunk_client.max_window_seconds == 3600
    assert splunk_client.max_response_bytes == 2048

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


def test_environment_binding_filters_cannot_replace_provider_identity(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    definition = {
        "template_id": "itsm",
        "status": "enabled",
        "enabled": True,
        "environment_dependency": "dependent",
        "endpoint": "https://company.atlassian.net",
        "project_key": "PAY",
        "auth_type": "basic_api_token",
        "credentials": {
            "account_identifier": "svc-jira@company.com",
            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
        },
        "bindings": [
            {
                "project_env_id": "prod",
                "external_resource": "PAY",
                "narrowing_filters_json": {
                    "endpoint": "https://attacker.example",
                },
            },
        ],
    }

    with pytest.raises(ValueError, match="cannot override instance fields"):
        resolve_connector_provider("itsm", instance_definition=definition, environment_id="prod")


def test_inactive_environment_binding_cannot_fall_back_to_instance_scope(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    definition = {
        "template_id": "itsm",
        "status": "enabled",
        "enabled": True,
        "environment_dependency": "independent",
        "endpoint": "https://company.atlassian.net",
        "project_key": "PAY",
        "auth_type": "basic_api_token",
        "credentials": {
            "account_identifier": "svc-jira@company.com",
            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
        },
        "bindings": [
            {
                "project_env_id": "prod",
                "external_resource": "PAY",
                "status": "inactive",
            },
        ],
    }

    with pytest.raises(ValueError, match="No active environment binding"):
        resolve_connector_provider("itsm", instance_definition=definition)


def test_persisted_binding_rows_override_legacy_inline_mappings(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    definition = {
        "template_id": "itsm",
        "status": "enabled",
        "enabled": True,
        "environment_dependency": "dependent",
        "endpoint": "https://company.atlassian.net",
        "project_key": "PAY",
        "auth_type": "api_token",
        "credentials": {
            "account_identifier": "svc-jira@company.com",
            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
        },
        "bindings": [],
        "environment_mappings": [
            {"project_env_id": "prod", "external_resource": "PAY"},
        ],
    }

    with pytest.raises(ValueError, match="No unique active environment binding"):
        resolve_connector_provider("itsm", instance_definition=definition, environment_id="prod")


def test_malformed_environment_binding_returns_value_error(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    definition = {
        "template_id": "itsm",
        "status": "enabled",
        "enabled": True,
        "environment_dependency": "dependent",
        "endpoint": "https://company.atlassian.net",
        "project_key": "PAY",
        "auth_type": "api_token",
        "credentials": {
            "account_identifier": "svc-jira@company.com",
            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
        },
        "bindings": [None],
    }

    with pytest.raises(ValueError, match="No unique active environment binding"):
        resolve_connector_provider("itsm", instance_definition=definition, environment_id="prod")


def test_saved_custom_template_keeps_published_provider_adapter(monkeypatch):
    monkeypatch.setenv("RESOLVED_JIRA_TOKEN", "token-12345")
    instance = {
        "tenant_id": "acme",
        "project_id": "payments",
        "instance_id": "jira-custom",
        "template_id": "jira_custom_template",
        "template_version": "2.0.0",
        "system_name": "jira-custom",
        "provider_adapter_id": "itsm",
        "status": "enabled",
        "enabled": True,
        "definition_json": {
            "endpoint": "https://company.atlassian.net",
            "project_key": "PAY",
            "auth_type": "api_token",
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


def test_runtime_applies_instance_environment_parameter_overrides(monkeypatch):
    async def unchanged_templates(_engine, _tenant, templates):
        return templates

    # This focused precedence test uses an in-memory store; persistence is covered separately.
    monkeypatch.setattr("app.configuration.connector_governance.governed_templates", unchanged_templates)
    captured = {}
    parameter_calls = []

    class Provider:
        async def aclose(self):
            return None

    def fake_resolve(instance, **_kwargs):
        captured["instance"] = instance
        return Provider()

    monkeypatch.setattr("app.runtime.runner.resolve_project_connector", fake_resolve)

    class InstanceStore:
        async def list_connector_templates(self):
            return []

        async def list_project_connector_instances(self, tenant_id, project_id):
            return [
                {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "instance_id": "jira-main",
                    "template_id": "itsm",
                    "template_version": "1.0.0",
                    "system_name": "jira-main",
                    "status": "enabled",
                    "enabled": True,
                    "definition_json": {
                        "environment_dependency": "dependent",
                        "tool_environment": "production",
                        "endpoint": "https://company.atlassian.net",
                        "project_key": "PAY",
                        "auth_type": "basic_api_token",
                        "credentials": {
                            "account_identifier": "svc-jira@company.com",
                            "api_token_secret_ref": "env://RESOLVED_JIRA_TOKEN",
                        },
                    },
                    "bindings": [
                        {
                            "project_env_id": "production",
                            "tool_env_id": "production",
                            "external_resource": "PAY",
                            "status": "active",
                        },
                    ],
                }
            ]

    class ParameterStore:
        engine = None

        async def resolve(self, *args, instance_id=None, environment_id=None, **_kwargs):
            parameter_calls.append((instance_id, environment_id))
            if instance_id is None:
                return []
            return [
                {
                    "tool": "itsm",
                    "variable_name": "custom_field_mapping",
                    "enabled": True,
                    "effective_value": {"customfield_1": "Queue"},
                }
            ]

        @staticmethod
        def apply_instance_defaults(instance, rows, template):
            from app.configuration.parameters import ParameterStore as Store

            return Store.apply_instance_defaults(instance, rows, template)

    class Inheritance:
        @staticmethod
        def project(principal):
            return SimpleNamespace(
                environments=(SimpleNamespace(id="production", enabled=True),)
            )

    field = SimpleNamespace(
        template_editable=True,
        variable_name="custom_field_mapping",
        default_value={},
        allow_project_override=True,
        validate_parameter_value=lambda _value: None,
    )
    template = SimpleNamespace(
        system_name="itsm",
        type="itsm",
        version="1.0.0",
        availability="published",
        platform_enabled=True,
        is_enabled_by_policy=True,
        provider_adapter_id="itsm",
        auth_profiles=(
            {
                "id": "basic_api_token",
                "status": "active",
                "required_fields": ["account_identifier", "api_token_secret_ref"],
                "optional_fields": [],
                "hidden_fields": [],
            },
        ),
        parameter_fields=(field,),
    )
    runner = object.__new__(ExecutionRunner)
    runner.connector_instance_store = InstanceStore()
    runner.parameter_store = ParameterStore()
    runner.registry = SimpleNamespace(inheritance=Inheritance())
    runner.connectors = {}
    runner.connector_enabled_adapters = {"itsm"}
    runner.connector_secret_references = set()
    runner.connector_allowed_hosts = None
    runner.refresh_deployment_connectors = False
    runner.settings = SimpleNamespace(mode="demo")
    runner.platform = SimpleNamespace(
        connector_templates=(template,), connector_options={}
    )
    principal = UserPrincipal(
        subject="owner",
        username="owner",
        tenant_id="acme",
        project_id="payments",
        roles=[Role.PROJECT_OWNER],
    )

    resolved, created = asyncio.run(
        runner._connectors_for_run(principal, {"itsm"}, {"itsm"})
    )

    assert parameter_calls == [(None, None), ("jira-main", "production")]
    assert resolved["itsm"] is created[0]
    assert captured["instance"]["definition_json"]["custom_field_mapping"] == {
        "customfield_1": "Queue"
    }
