"""Persisted connection identity and activation checks without remote stand-ins."""

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.routes.connectors_api import EnvironmentConnectionPayload, _safe_connection
from app.configuration.connection_records import apply_environment_connection
from app.connectors.candidate_testing import compute_candidate_hash
from app.connectors.providers.registry import _normalise_saved_instance, _resolve_instance_binding
from app.connectors.providers.secrets import connection_secret_references
from app.identity.principals import Role, UserPrincipal
from app.persistence.platform_admin import PlatformAdminStore


def connection_input():
    return EnvironmentConnectionPayload(
        connection_id="qa", connection_name="QA", environment_name="qa",
        target={"endpoint": "https://qa.internal"},
        auth_profile_id="basic_api_token",
        credentials={"account_identifier": "reader", "api_token_secret_ref": "env://QA_TOKEN"},
        resource_scope=["QA"],
    ).model_dump()


@pytest.mark.asyncio
async def test_connection_roundtrip_stale_test_and_runtime_identity(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'connections.db'}")
    store = PlatformAdminStore(engine)
    try:
        await store.initialize()
        instance = await store.save_project_connector_instance(
            tenant_id="tenant", project_id="project", instance_id="jira", template_id="itsm",
            template_version="1.0.0", system_name="Jira", expected_revision=0, author="admin",
            definition_json={"endpoint": "https://old.internal", "credentials": {"old_ref": "env://OLD_TOKEN"},
                             "environment_dependency": "dependent"},
            bindings=[{"project_env_id": "qa", "external_resource": "QA", "connection_id": "qa"}],
            environment_connections=[connection_input()],
        )
        saved = instance["environment_connections"][0]
        assert saved["target_json"] == {"endpoint": "https://qa.internal"}
        assert saved["credentials_json"] == connection_input()["credentials"]
        assert saved["resource_scope_json"] == ["QA"]
        assert not saved["enabled"]
        with pytest.raises(ValueError, match="fresh passing test"):
            await store.set_environment_connection_enabled("tenant", "project", "jira", "qa", True)
        await store.update_environment_connection_test_status(
            "tenant", "project", "jira", "qa", "passed", expected_updated_at=saved["updated_at"],
        )
        await store.set_environment_connection_enabled("tenant", "project", "jira", "qa", True)
        instance = await store.get_project_connector_instance("tenant", "project", "jira")
        resolved = _resolve_instance_binding(_normalise_saved_instance(instance), "qa")
        assert resolved["endpoint"] == "https://qa.internal"
        assert resolved["credentials"] == connection_input()["credentials"]
        assert "old_ref" not in resolved["credentials"]
        prior = instance["environment_connections"][0]
        edited = await store.save_environment_connection("tenant", "project", "jira", {
            **connection_input(), "target": {"endpoint": "https://qa-new.internal"},
        })
        assert edited["test_status"] == "not_tested" and not edited["enabled"]
        assert edited["last_tested_at"] is None
        with pytest.raises(ValueError, match="changed during testing"):
            await store.update_environment_connection_test_status(
                "tenant", "project", "jira", "qa", "passed", expected_updated_at=prior["updated_at"],
            )
        with pytest.raises(ValueError, match="not enabled"):
            apply_environment_connection({"external_resource": "QA"}, edited, require_enabled=True)
    finally:
        await engine.dispose()


def test_connection_inputs_are_data_only_and_status_is_server_owned():
    for changes in (
        {"enabled": True}, {"test_status": "passed"}, {"last_tested_at": 1},
        {"credentials": {"password": "disallowed-inline-value"}},
        {"target": {"tenant_id": "other"}},
    ):
        with pytest.raises(ValidationError):
            EnvironmentConnectionPayload.model_validate({**connection_input(), **changes})
    with pytest.raises(ValueError, match="outside"):
        apply_environment_connection({"external_resource": "PROD"}, connection_input())
    owner = UserPrincipal(subject="owner", username="owner", tenant_id="tenant", project_id="project",
                          roles=(Role.PROJECT_OWNER,))
    safe = _safe_connection(connection_input(), owner)
    assert not set(safe) & {"target", "credentials", "mcp_configuration", "resource_scope"}
    assert compute_candidate_hash({"routing_mode": "direct"}) != compute_candidate_hash({"routing_mode": "mcp"})
    registry = '{"qa.internal": ["env://QA_TOKEN"]}'
    assert connection_secret_references(registry, "https://qa.internal/mcp", set()) == {"env://QA_TOKEN"}
    assert connection_secret_references(registry, "https://prod.internal/mcp", set()) == set()


def test_authenticated_run_selection_uses_saved_instance(tmp_path, monkeypatch):
    import secrets
    from starlette.testclient import TestClient
    from app.api.application import create_app
    from app.runtime.run_contract import ConnectorSelection
    from tests.support import settings_for

    monkeypatch.setenv("JIRA_API_TOKEN", secrets.token_urlsafe(32))
    settings, token = settings_for(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        for instance_id in ("primary", "secondary"):
            response = client.post("/api/v1/projects/payments/connectors", headers=token("admin"), json={
                "instance_id": instance_id, "template_id": "itsm", "expected_revision": 0,
                "system_name": instance_id, "environment_dependency": "independent", "tool_environment": "Shared",
                "definition": {"endpoint": "https://localhost", "project_key": "PAY", "auth_type": "basic_api_token",
                               "credentials": {"account_identifier": instance_id, "api_token_secret_ref": "env://JIRA_API_TOKEN"}},
            })
            assert response.status_code == 200, response.text
            # Internal state transition isolates selection from the separately
            # exercised live-test gate; no remote probe result is invented.
            client.portal.call(app.state.platform_admin.set_project_connector_instance_enabled,
                               "acme", "payments", instance_id, True)

        project_view = client.get("/api/v1/projects/payments/connectors/primary", headers=token("owner"))
        assert project_view.status_code == 200
        assert not {"endpoint", "credentials", "auth_type"} & set(project_view.json()["definition_json"])
        forbidden = client.post("/api/v1/projects/payments/connectors/primary/connections",
                                headers=token("owner"), json=connection_input())
        assert forbidden.status_code == 403

        async def check_selection():
            principal = settings.principals["analyst"]
            with pytest.raises(PermissionError, match="exactly one"):
                await app.state.runner._connectors_for_run(principal, {"itsm"}, {"itsm"})
            with pytest.raises(PermissionError, match="not assigned"):
                await app.state.runner._connectors_for_run(principal, {"itsm"}, {"itsm"},
                                                         {"itsm": ConnectorSelection(instance_id="other-project")})
            with pytest.raises(PermissionError, match="outside the capability"):
                await app.state.runner._connectors_for_run(principal, {"itsm"}, {"itsm"},
                                                         {"unix": ConnectorSelection(instance_id="secondary")})
            providers, created = await app.state.runner._connectors_for_run(
                principal, {"itsm"}, {"itsm"}, {"itsm": ConnectorSelection(instance_id="secondary")},
            )
            try:
                assert providers["itsm"].user_email == "secondary"
                assert providers["itsm"].project_key == "PAY"
            finally:
                for provider in created:
                    await provider.aclose()
        client.portal.call(check_selection)
