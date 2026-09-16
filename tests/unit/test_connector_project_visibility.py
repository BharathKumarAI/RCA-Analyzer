"""Project catalog and instance responses honor the same field visibility policy."""

from copy import deepcopy

from app.api.routes.connectors_api import (
    _sanitize_instance_for_project,
    _sanitize_template_for_project,
    _template_response,
)
from app.configuration.platform import PlatformConfiguration
from app.identity.principals import Role, UserPrincipal
from app.settings import Settings


def test_jira_catalog_matches_account_token_requirements():
    template = next(
        item for item in PlatformConfiguration.load(Settings()).connector_templates
        if item.type == "itsm"
    )
    profiles = {profile["id"]: profile for profile in template.auth_profiles}
    for profile_id in ("basic_auth", "api_token"):
        assert set(profiles[profile_id]["required_fields"]) == {"account_identifier", "api_token_secret_ref"}
        assert "account_identifier" not in profiles[profile_id]["hidden_fields"]
    assert profiles["webhook_ref"]["status"] == "planned"
    assert template.default_service_user is None


def test_catalog_exposes_only_installed_native_authentication():
    principal = UserPrincipal(
        subject="admin", username="admin", tenant_id="tenant", project_id="project",
        roles=(Role.PLATFORM_ADMIN,),
    )
    catalog = {
        item.type: _template_response(item.model_dump(mode="json"), principal)
        for item in PlatformConfiguration.load(Settings()).connector_templates
    }
    assert catalog["kafka"]["native_auth_profile_ids"] == ["sasl_scram_tls"]
    assert catalog["oracle"]["native_auth_profile_ids"] == ["database_password"]
    assert set(catalog["itsm"]["native_auth_profile_ids"]) == {"basic_auth", "api_token"}


def test_hidden_template_defaults_are_removed_without_mutating_platform_configuration():
    template = next(
        item for item in PlatformConfiguration.load(Settings()).connector_templates
        if item.type == "itsm"
    ).model_dump(mode="json")
    field = next(item for item in template["parameter_fields"] if item["variable_name"] == "timeout_seconds")
    field["visible_in_project"] = False
    template["default_config"]["timeout_seconds"] = field["default_value"]
    original = deepcopy(template)
    owner = UserPrincipal(
        subject="owner", username="owner", tenant_id="tenant", project_id="project",
        roles=(Role.PROJECT_OWNER,),
    )
    projected = _sanitize_template_for_project(template, owner)
    assert "timeout_seconds" not in {item["variable_name"] for item in projected["parameter_fields"]}
    assert "timeout_seconds" not in projected["default_config"]
    assert "default_timeout_seconds" not in projected
    instance = {"definition_json": {"timeout_seconds": field["default_value"], "system_name": template["name"]}}
    assert _sanitize_instance_for_project(instance, template, owner)["definition_json"] == {"system_name": template["name"]}
    assert instance["definition_json"]["timeout_seconds"] == field["default_value"]
    admin = owner.model_copy(update={"roles": (Role.PLATFORM_ADMIN,)})
    assert _sanitize_template_for_project(template, admin) == original
    assert template == original
