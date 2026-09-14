"""Authenticated MCP and A2A registration API contracts backed by SQLite."""

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import settings_for


def definition(
    *,
    name="Incident MCP",
    kind="mcp",
    endpoint="https://mcp.example.test",
    allow_project_override=True,
):
    return {
        "name": name,
        "kind": kind,
        "endpoint": endpoint,
        "description": "Evidence connection",
        "auth_method": "none",
        "secret_reference": "",
        "transport": "streamable_http" if kind == "mcp" else "a2a_jsonrpc",
        "timeout_seconds": 30,
        "allow_project_override": allow_project_override,
    }


def project_definition(**kwargs):
    return {**definition(**kwargs), "environment_dependency": "independent", "tool_environment": "Shared"}


def write_body(value, *, expected_revision="", expected_platform_revision=""):
    return {
        "definition": value,
        "expected_revision": expected_revision,
        "expected_platform_revision": expected_platform_revision,
    }


def test_integrations_require_membership_and_server_owned_roles(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/integrations").status_code == 401

        # Claims cannot inject platform authority or a different deployment scope.
        forged = token(
            "analyst", roles=["PLATFORM_ADMIN"], tenant_id="other", project_id="other"
        )
        assert client.put(
            "/api/v1/integrations/platform/incident",
            headers=forged,
            json=write_body(definition()),
        ).status_code == 403

        assert client.put(
            "/api/v1/integrations/platform/incident",
            headers=token("analyst"),
            json=write_body(definition()),
        ).status_code == 403
        assert client.put(
            "/api/v1/integrations/project/incident",
            headers=token("viewer"),
            json=write_body(definition()),
        ).status_code == 403


def test_platform_project_crud_inheritance_and_revision_guards(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        platform = client.put(
            "/api/v1/integrations/platform/incident",
            headers=token("admin"),
            json=write_body(definition()),
        )
        assert platform.status_code == 200, platform.text
        registration = platform.json()[0]
        platform_revision = registration["revision"]
        assert registration["scope_level"] == "platform_default"

        updated_platform = client.put(
            "/api/v1/integrations/platform/incident",
            headers=token("admin"),
            json=write_body(
                definition(endpoint="https://updated-mcp.example.test"),
                expected_revision=platform_revision,
            ),
        )
        assert updated_platform.status_code == 200, updated_platform.text
        platform_revision = updated_platform.json()[0]["revision"]
        assert platform_revision != registration["revision"]

        inherited = client.get("/api/v1/integrations", headers=token()).json()
        assert inherited[0]["definition"]["endpoint"] == "https://updated-mcp.example.test"
        assert inherited[0]["platform_revision"] == platform_revision
        assert inherited[0]["project_revision"] == ""

        project = client.put(
            "/api/v1/integrations/project/incident",
            headers=token("owner"),
            json=write_body(
                project_definition(endpoint="https://project-mcp.example.test"),
                expected_platform_revision=platform_revision,
            ),
        )
        assert project.status_code == 200, project.text
        effective = project.json()[0]
        project_revision = effective["project_revision"]
        assert effective["scope_level"] == "project_override"
        assert effective["definition"]["endpoint"] == "https://project-mcp.example.test"
        assert effective["platform_definition"]["endpoint"] == "https://updated-mcp.example.test"

        locked_with_existing_override = client.put(
            "/api/v1/integrations/platform/incident",
            headers=token("admin"),
            json=write_body(
                definition(allow_project_override=False),
                expected_revision=platform_revision,
            ),
        )
        assert locked_with_existing_override.status_code == 409

        platform_stale = client.put(
            "/api/v1/integrations/platform/incident",
            headers=token("admin"),
            json=write_body(
                definition(endpoint="https://stale-platform.example.test"),
                expected_revision="0" * 32,
            ),
        )
        assert platform_stale.status_code == 409

        updated_project = client.put(
            "/api/v1/integrations/project/incident",
            headers=token("owner"),
            json=write_body(
                project_definition(endpoint="https://updated-project-mcp.example.test"),
                expected_revision=project_revision,
                expected_platform_revision=platform_revision,
            ),
        )
        assert updated_project.status_code == 200, updated_project.text
        project_revision = updated_project.json()[0]["project_revision"]
        assert updated_project.json()[0]["definition"]["endpoint"] == "https://updated-project-mcp.example.test"

        stale = client.put(
            "/api/v1/integrations/project/incident",
            headers=token("owner"),
            json=write_body(
                project_definition(endpoint="https://stale.example.test"),
                expected_revision="0" * 32,
                expected_platform_revision=platform_revision,
            ),
        )
        assert stale.status_code == 409

        removed = client.delete(
            "/api/v1/integrations/project/incident",
            headers=token("owner"),
            params={"expected_revision": "0" * 32},
        )
        assert removed.status_code == 409
        removed = client.delete(
            "/api/v1/integrations/project/incident",
            headers=token("owner"),
            params={"expected_revision": project_revision},
        )
        assert removed.status_code == 204
        assert client.get("/api/v1/integrations", headers=token()).json()[0]["scope_level"] == "platform_default"


def test_platform_settings_can_lock_project_overrides(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        platform = client.put(
            "/api/v1/integrations/platform/locked",
            headers=token("admin"),
            json=write_body(definition(allow_project_override=False)),
        )
        assert platform.status_code == 200, platform.text
        revision = platform.json()[0]["revision"]

        response = client.put(
            "/api/v1/integrations/project/locked",
            headers=token("owner"),
            json=write_body(
                project_definition(endpoint="https://project.example.test"),
                expected_platform_revision=revision,
            ),
        )
        assert response.status_code == 403

        # A project-only registration remains possible under a distinct ID.
        response = client.put(
            "/api/v1/integrations/project/project-only",
            headers=token("owner"),
            json=write_body(project_definition(endpoint="https://project.example.test")),
        )
        assert response.status_code == 200, response.text
        assert any(row["scope_level"] == "project_only" for row in response.json())


def test_registrations_survive_application_restart_and_catalog_stays_planned(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        saved = client.put(
            "/api/v1/integrations/platform/agent",
            headers=token("admin"),
            json=write_body(
                definition(
                    name="Incident A2A",
                    kind="a2a",
                    endpoint="https://agent.example.test/rpc",
                )
            ),
        )
        assert saved.status_code == 200, saved.text
        revision = saved.json()[0]["revision"]

        tools = client.get("/api/v1/tools", headers=token("admin"))
        assert tools.status_code == 200, tools.text
        registered = next(row for row in tools.json() if row["id"] == "integration:agent")
        assert registered["type"] == "a2a"
        assert registered["status"] == "planned"
        assert registered["enabled"] is False
        assert registered["protocol"] == "a2a_jsonrpc"

    # A new app instance reads the same SQLite file, proving persistence is not
    # held only in the process that accepted the write.
    with TestClient(create_app(settings)) as client:
        rows = client.get("/api/v1/integrations", headers=token("analyst")).json()
        assert rows[0]["id"] == "agent"
        assert rows[0]["revision"] == revision
        assert rows[0]["definition"]["kind"] == "a2a"


def test_registration_schema_rejects_unsafe_endpoints_and_mismatched_transports(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        for value in (
            definition(endpoint="http://mcp.example.test"),
            definition(endpoint="https://mcp.example.test?token=secret"),
            definition(endpoint="https://user:pass@mcp.example.test"),
            {
                **definition(endpoint="https://mcp.example.test", kind="a2a"),
                "transport": "streamable_http",
            },
        ):
            response = client.put(
                "/api/v1/integrations/platform/unsafe",
                headers=token("admin"),
                json=write_body(value),
            )
            assert response.status_code == 422, response.text


def test_project_integration_identity_is_required_and_preserved(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        url = "/api/v1/integrations/project/identity"
        headers = token("owner")
        assert client.put(url, headers=headers, json=write_body(definition())).status_code == 422
        saved = client.put(url, headers=headers, json=write_body(project_definition())).json()[0]
        assert saved["definition"]["system_name"] == "Incident MCP"
        updated = client.put(url, headers=headers, json=write_body(
            project_definition(name="Renamed connector"), expected_revision=saved["revision"],
        ))
        assert updated.status_code == 200, updated.text
        assert updated.json()[0]["definition"]["system_name"] == "Incident MCP"
        duplicate = {**project_definition(), "system_name": "incident mcp"}
        assert client.put("/api/v1/integrations/project/duplicate", headers=headers, json=write_body(duplicate)).status_code == 422
        forbidden_mapping = {**project_definition(), "environment_dependency": "dependent", "project_environment_ids": ["not-this-project"]}
        assert client.put("/api/v1/integrations/project/mapped", headers=headers, json=write_body(forbidden_mapping)).status_code == 422
        assert client.put("/api/v1/integrations/platform/identity", headers=token("admin"), json=write_body(project_definition())).status_code == 422
