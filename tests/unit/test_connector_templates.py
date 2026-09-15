"""Connector template contracts stay typed, scoped and honest about runtime support."""

import pytest
from pydantic import ValidationError

from app.configuration.models import ConnectorTemplate, ConnectorTemplateField
from app.configuration.platform import (
    PlatformConfiguration,
    _normalize_legacy_connector_template,
)
from app.settings import Settings


def test_platform_connector_templates_have_project_identity_defaults():
    platform = PlatformConfiguration.load(Settings())

    assert len(platform.connector_templates) >= 10
    for template in platform.connector_templates:
        fields = {field.variable_name: field for field in template.parameter_fields}
        assert fields["system_name"].default_value == template.name
        assert fields["system_name"].required is True
        assert fields["system_name"].ownership == "project_only"
        assert fields["environment_dependency"].allowed_values == (
            "dependent",
            "independent",
        )
        assert fields["tool_environment"].required is True

    unix = next(template for template in platform.connector_templates if template.type == "unix")
    assert unix.name == "Unix"
    assert [profile["id"] for profile in unix.auth_profiles] == ["ssh_private_key", "ssh_password"]
    assert "password_secret_ref" in unix.auth_profiles[1]["required_fields"]


def test_legacy_catalog_gets_project_metadata_without_changing_operational_defaults():
    legacy = {
        "type": "legacy",
        "name": "Legacy Connector",
        "system_name": "legacy",
        "category": "Testing",
        "description": "Existing deployed connector",
        "protocol": "HTTPS",
        "auth_method": "Bearer Token",
        "default_endpoint": "https://configured.example",
        "default_secret": "env://LEGACY_TOKEN",
        "default_scope": "platform_default",
        "default_config": {"resource": "configured"},
    }
    normalized = _normalize_legacy_connector_template(legacy)
    assert normalized["default_config"] == legacy["default_config"]
    template = ConnectorTemplate.model_validate(normalized)
    fields = {field.variable_name: field for field in template.parameter_fields}
    assert fields["system_name"].default_value == "Legacy Connector"
    assert fields["tool_environment"].default_value == "Shared"


def test_connector_field_rejects_null_static_defaults_and_bad_secret_metadata():
    with pytest.raises(ValidationError):
        ConnectorTemplateField(
            variable_name="endpoint",
            description="Endpoint",
            value_type="string",
            default_value=None,
        )

    with pytest.raises(ValidationError):
        ConnectorTemplateField(
            variable_name="token",
            description="Token reference",
            value_type="secret_ref",
            default_value="env://TOKEN",
            sensitivity="normal",
        )


def test_published_template_rejects_incompatible_auth_profile_shape():
    core_fields = (
        ConnectorTemplateField(
            variable_name="system_name",
            description="System name",
            value_type="string",
            default_value="Example",
            required=True,
            ownership="project_only",
        ),
        ConnectorTemplateField(
            variable_name="environment_dependency",
            description="Environment choice",
            value_type="string",
            default_value="independent",
            allowed_values=("dependent", "independent"),
            required=True,
            ownership="project_only",
        ),
        ConnectorTemplateField(
            variable_name="tool_environment",
            description="Tool environment",
            value_type="string",
            default_value="Shared",
            required=True,
            ownership="project_only",
        ),
    )
    with pytest.raises(ValidationError):
        ConnectorTemplate(
            type="example",
            name="Example",
            system_name="example",
            category="Testing",
            description="Example connector",
            protocol="HTTPS",
            auth_method="Bearer Token",
            default_endpoint="https://example.test",
            default_secret="env://EXAMPLE_TOKEN",
            default_scope="platform_default",
            parameter_fields=core_fields,
            auth_profiles=(
                {
                    "id": "bearer_token",
                    "name": "Bearer Token",
                    "status": "active",
                    "transport_compatibility": "HTTPS",
                    "required_fields": ["token_secret_ref"],
                    "optional_fields": ["token_secret_ref"],
                    "hidden_fields": [],
                    "unsupported_metadata": True,
                },
            ),
        )


def test_auth_profile_rejects_duplicate_conditional_fields():
    core_fields = (
        ConnectorTemplateField(
            variable_name="system_name", description="System name", value_type="string",
            default_value="Example", required=True, ownership="project_only",
        ),
        ConnectorTemplateField(
            variable_name="environment_dependency", description="Environment choice", value_type="string",
            default_value="independent", allowed_values=("dependent", "independent"),
            required=True, ownership="project_only",
        ),
        ConnectorTemplateField(
            variable_name="tool_environment", description="Tool environment", value_type="string",
            default_value="Shared", required=True, ownership="project_only",
        ),
    )

    with pytest.raises(ValidationError, match="must not contain duplicates"):
        ConnectorTemplate(
            type="example",
            name="Example",
            system_name="example",
            category="Testing",
            description="Example connector",
            protocol="HTTPS",
            auth_method="Bearer Token",
            default_endpoint="https://example.test",
            default_secret="env://EXAMPLE_TOKEN",
            default_scope="platform_default",
            parameter_fields=core_fields,
            auth_profiles=(
                {
                    "id": "bearer_token",
                    "name": "Bearer Token",
                    "status": "active",
                    "transport_compatibility": "HTTPS",
                    "required_fields": ["token_secret_ref", "token_secret_ref"],
                    "optional_fields": [],
                    "hidden_fields": [],
                },
            ),
        )


def test_auth_profile_rejects_unhashable_conditional_fields():
    core_fields = (
        ConnectorTemplateField(
            variable_name="system_name", description="System name", value_type="string",
            default_value="Example", required=True, ownership="project_only",
        ),
        ConnectorTemplateField(
            variable_name="environment_dependency", description="Environment choice", value_type="string",
            default_value="independent", allowed_values=("dependent", "independent"),
            required=True, ownership="project_only",
        ),
        ConnectorTemplateField(
            variable_name="tool_environment", description="Tool environment", value_type="string",
            default_value="Shared", required=True, ownership="project_only",
        ),
    )

    with pytest.raises(ValidationError, match="lowercase identifiers"):
        ConnectorTemplate(
            type="example",
            name="Example",
            system_name="example",
            category="Testing",
            description="Example connector",
            protocol="HTTPS",
            auth_method="Bearer Token",
            default_endpoint="https://example.test",
            default_secret="env://EXAMPLE_TOKEN",
            default_scope="platform_default",
            parameter_fields=core_fields,
            auth_profiles=(
                {
                    "id": "bearer_token",
                    "name": "Bearer Token",
                    "status": "active",
                    "transport_compatibility": "HTTPS",
                    "required_fields": [{"field": "token_secret_ref"}],
                    "optional_fields": [],
                    "hidden_fields": [],
                },
            ),
        )


def test_shared_field_contract_excludes_instance_fields_and_enforces_bounds():
    with pytest.raises(ValidationError):
        ConnectorTemplateField(variable_name="host", description="Host", value_type="string",
                               default_value="", ownership="project_only", template_editable=True)
    with pytest.raises(ValidationError):
        ConnectorTemplateField(variable_name="api_token", description="Credential", value_type="secret_ref",
                               default_value="env://TOKEN", sensitivity="secret_reference", template_editable=True)
    with pytest.raises(ValidationError):
        ConnectorTemplateField(variable_name="limit", description="Limit", value_type="integer",
                               default_value=5, template_editable=True, minimum=1, maximum=4)
