"""Integration tests for connector templates and project connector instances lifecycle."""

import tempfile
from pathlib import Path
import httpx2
from starlette.testclient import TestClient

from app.api.application import create_app
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.project_storage import project_prefix
from tests.support import connectors, settings_for


def test_connector_templates_listing_and_detail():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")
            res = client.get("/api/v1/connectors/templates", headers=headers)
            assert res.status_code == 200
            templates = res.json()
            assert len(templates) >= 10
            by_id = {t["type"]: t for t in templates}
            assert "itsm" in by_id
            assert "log_search" in by_id
            assert "oracle" in by_id
            assert by_id["itsm"]["auth_method"] == "Basic API Token"
            assert by_id["oracle"]["is_enabled_by_policy"] is False

            # Detail lookup
            detail = client.get("/api/v1/connectors/templates/itsm", headers=headers)
            assert detail.status_code == 200
            assert detail.json()["type"] == "itsm"
            assert len(detail.json()["auth_profiles"]) >= 1


def test_template_draft_publish_and_immutability():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            admin_headers = token("admin")
            viewer_headers = token("viewer")

            # Unauthorized user cannot save template
            denied = client.post(
                "/api/v1/connectors/templates",
                headers=viewer_headers,
                json={"template_id": "custom_api", "version": "1.0.0", "status": "draft", "definition": {"name": "Custom"}},
            )
            assert denied.status_code == 403

            # Save draft
            custom_definition = {
                "name": "Custom API",
                "type": "custom",
                "category": "Testing",
                "description": "A typed custom HTTPS connector.",
                "protocol": "HTTPS",
                "auth_method": "Bearer Token",
                "default_endpoint": "https://custom.example",
                "default_secret": "env://CUSTOM_TOKEN",
                "default_scope": "project_override",
                "parameter_fields": [
                    {
                        "variable_name": "system_name",
                        "description": "Project connector name",
                        "value_type": "string",
                        "default_value": "Custom API",
                        "required": True,
                        "ownership": "project_only",
                    },
                    {
                        "variable_name": "environment_dependency",
                        "description": "Environment mapping mode",
                        "value_type": "string",
                        "default_value": "independent",
                        "allowed_values": ["dependent", "independent"],
                        "required": True,
                        "ownership": "project_only",
                    },
                    {
                        "variable_name": "tool_environment",
                        "description": "Authorized tool environment",
                        "value_type": "string",
                        "default_value": "Shared",
                        "required": True,
                        "ownership": "project_only",
                    },
                ],
            }
            save_res = client.post(
                "/api/v1/connectors/templates",
                headers=admin_headers,
                json={"template_id": "custom_api", "version": "1.0.0", "status": "draft", "definition": custom_definition},
            )
            assert save_res.status_code == 200
            assert save_res.json()["status"] == "draft"

            # Publish
            pub_res = client.post(
                "/api/v1/connectors/templates/custom_api/publish?version=1.0.0",
                headers=admin_headers,
            )
            assert pub_res.status_code == 200
            assert pub_res.json()["status"] == "published"

            # Published template is immutable (cannot overwrite without version bump)
            overwrite = client.post(
                "/api/v1/connectors/templates",
                headers=admin_headers,
                json={"template_id": "custom_api", "version": "1.0.0", "status": "draft", "definition": {"name": "Mutated"}},
            )
            assert overwrite.status_code == 409

            # Deprecate
            dep_res = client.post(
                "/api/v1/connectors/templates/custom_api/deprecate?version=1.0.0",
                headers=admin_headers,
            )
            assert dep_res.status_code == 200
            assert dep_res.json()["status"] == "deprecated"


def test_project_connector_instance_lifecycle_and_enablement_gate(monkeypatch):
    monkeypatch.setenv("JIRA_API_TOKEN", "mock-token-secret")

    async def jira_probe(request):
        if request.url.path == "/rest/api/2/project/PAY":
            return httpx2.Response(200, json={"key": "PAY", "name": "Payments"})
        if request.url.path == "/rest/api/2/field":
            return httpx2.Response(200, json=[{"id": "customfield_1", "name": "Queue"}])
        return httpx2.Response(404, json={"error": "missing"})

    def controlled_jira(**kwargs):
        client = httpx2.AsyncClient(
            base_url=kwargs["base_url"],
            transport=httpx2.MockTransport(jira_probe),
        )
        return JiraConnector(client=client, allow_insecure=True, **kwargs)

    def controlled_resolve(*_args, **_kwargs):
        return controlled_jira(
            base_url="http://jira.test",
            project_key="PAY",
            user_email="bot@company.com",
            api_token="mock-token-secret",
        )

    monkeypatch.setattr("app.connectors.candidate_testing.JiraConnector", controlled_jira)

    with tempfile.TemporaryDirectory() as tmpdir:
        project_configuration = (
            Path(tmpdir)
            / "projects"
            / project_prefix("acme", "payments")
            / "configuration"
        )
        project_configuration.mkdir(parents=True)
        (project_configuration / "project.yaml").write_text(
            "tenant_id: acme\n"
            "project_id: payments\n"
            "environments:\n"
            "  - id: production\n"
            "    enabled: true\n",
            encoding="utf-8",
        )
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")

            candidate_def = {
                "instance_id": "jira_main",
                "template_id": "itsm",
                "template_version": "1.0.0",
                "system_name": "jira_main",
                "environment_dependent": True,
                "tool_environment": "production",
                "bindings": [
                    {
                        "project_env_id": "production",
                        "tool_env_id": "jira_cloud_prod",
                        "external_resource": "PAY",
                        "credential_binding_id": "jira_cred_prod",
                    }
                ],
                    "endpoint": "http://jira.test",
                "auth_type": "basic_api_token",
                "credentials": {
                    "account_identifier": "bot@company.com",
                        "api_token_secret_ref": "env://JIRA_API_TOKEN",
                },
                "timeout_seconds": 30,
                "max_results": 100,
            }

            # 1. Candidate validation
            val_res = client.post(
                "/api/v1/connectors/validate",
                headers=headers,
                json={"candidate": candidate_def},
            )
            assert val_res.status_code == 200
            assert val_res.json()["valid"] is True
            candidate_hash = val_res.json()["candidate_hash"]

            # Incomplete candidate missing tool_environment fails validation
            incomplete_val = client.post(
                "/api/v1/connectors/validate",
                headers=headers,
                json={
                    "candidate": {
                        "template_id": "itsm",
                        "template_version": "1.0.0",
                        "system_name": "jira_main",
                        "environment_dependent": True,
                        "endpoint": "http://jira.test",
                    }
                },
            )
            assert incomplete_val.status_code == 200
            assert incomplete_val.json()["valid"] is False
            assert any("Tool Environment is mandatory" in e for e in incomplete_val.json()["errors"])

            # Incomplete draft can be saved successfully
            draft_save = client.post(
                "/api/v1/projects/payments/connectors",
                headers=headers,
                json={
                    "instance_id": "draft_conn",
                    "template_id": "itsm",
                    "template_version": "1.0.0",
                    "system_name": "draft_conn",
                    "status": "draft",
                    "expected_revision": 0,
                    "definition": {"notes": "WIP configuration"},
                },
            )
            assert draft_save.status_code == 200
            assert draft_save.json()["status"] == "draft"

            # Connector bindings must reference an active environment owned by
            # the authenticated project, including for drafts.
            invalid_environment_save = client.post(
                "/api/v1/projects/payments/connectors",
                headers=headers,
                json={
                    "instance_id": "invalid_environment",
                    "template_id": "itsm",
                    "template_version": "1.0.0",
                    "system_name": "invalid_environment",
                    "status": "draft",
                    "expected_revision": 0,
                    "definition": {"notes": "invalid environment mapping"},
                    "bindings": [
                        {
                            "project_env_id": "staging",
                            "external_resource": "PAY",
                        }
                    ],
                },
            )
            assert invalid_environment_save.status_code == 422

            # 2. Rejection of Oracle candidate by policy
            oracle_val = client.post(
                "/api/v1/connectors/validate",
                headers=headers,
                json={
                    "candidate": {
                        "template_id": "oracle",
                        "template_version": "1.0.0",
                        "system_name": "oracle_db",
                        "endpoint": "oracle-host",
                        "auth_type": "database_password",
                        "credentials": {"database_username": "app", "password_secret_ref": "env://ORACLE_PW"},
                    }
                },
            )
            assert oracle_val.status_code == 200
            assert oracle_val.json()["valid"] is False
            assert any("disabled by policy" in e for e in oracle_val.json()["errors"])

            # 3. Save project connector instance
            save_inst = client.post(
                "/api/v1/projects/payments/connectors",
                headers=headers,
                json={
                    "instance_id": "jira_main",
                    "template_id": "itsm",
                    "template_version": "1.0.0",
                    "system_name": "jira_main",
                    "environment_dependent": True,
                    "tool_environment": "production",
                    "definition": {
                        "endpoint": "http://jira.test",
                        "auth_type": "basic_api_token",
                        "credentials": {
                            "account_identifier": "bot@company.com",
                            "api_token_secret_ref": "env://JIRA_API_TOKEN",
                        },
                        "timeout_seconds": 30,
                        "max_results": 100,
                    },
                    "expected_revision": 0,
                    "bindings": [
                        {
                            "project_env_id": "production",
                            "tool_env_id": "jira_cloud_prod",
                            "external_resource": "PAY",
                            "credential_binding_id": "jira_cred_prod",
                        }
                    ],
                },
            )
            assert save_inst.status_code == 200
            assert save_inst.json()["instance_id"] == "jira_main"
            assert save_inst.json()["revision"] == 1
            assert len(save_inst.json()["bindings"]) == 1

            # Discovery is available for a fully validated saved draft and
            # does not create a candidate-test result or enable the instance.
            monkeypatch.setattr("app.api.routes.connectors_api.resolve_project_connector", controlled_resolve)
            fields_res = client.get(
                "/api/v1/projects/payments/connectors/jira_main/fields",
                headers=headers,
            )
            assert fields_res.status_code == 200
            assert fields_res.json()["fields"] == [{"id": "customfield_1", "name": "Queue"}]
            invalid_fields_environment = client.get(
                "/api/v1/projects/payments/connectors/jira_main/fields?environment_id=staging",
                headers=headers,
            )
            assert invalid_fields_environment.status_code == 422

            # 4. Concurrent edit check
            stale_edit = client.post(
                "/api/v1/projects/payments/connectors",
                headers=headers,
                json={
                    "instance_id": "jira_main",
                    "template_id": "itsm",
                    "template_version": "1.0.0",
                    "system_name": "jira_main",
                    "environment_dependent": True,
                    "tool_environment": "production",
                    "definition": {
                        "endpoint": "http://jira.test",
                        "auth_type": "basic_api_token",
                        "credentials": {
                            "account_identifier": "bot@company.com",
                            "api_token_secret_ref": "env://JIRA_API_TOKEN",
                        },
                    },
                    "expected_revision": 0,  # Expected revision 0 is stale now that revision is 1!
                },
            )
            assert stale_edit.status_code == 409

            # 5. Enablement without fresh passing test fails with 412 Precondition Failed
            enable_fail = client.post(
                "/api/v1/projects/payments/connectors/jira_main/enable",
                headers=headers,
            )
            assert enable_fail.status_code == 412
            assert "Enablement gate failed" in enable_fail.json()["detail"]

            # 6. Run live test on candidate
            test_res = client.post(
                "/api/v1/connectors/test",
                headers=headers,
                json={
                    "candidate": candidate_def,
                    "operation": "test_connection",
                },
            )
            assert test_res.status_code == 200
            assert "stage_results" in test_res.json()
            assert test_res.json()["candidate_hash"] == candidate_hash

            # The API test itself writes the exact normalized environment result.
            candidate_hash = test_res.json()["candidate_hash"]

            # 7. Enablement now succeeds
            enable_ok = client.post(
                "/api/v1/projects/payments/connectors/jira_main/enable",
                headers=headers,
            )
            assert enable_ok.status_code == 200
            assert enable_ok.json()["enabled"] is True
            assert enable_ok.json()["status"] == "enabled"

            # 8. Disable
            disable_res = client.post(
                "/api/v1/projects/payments/connectors/jira_main/disable",
                headers=headers,
            )
            assert disable_res.status_code == 200
            assert disable_res.json()["enabled"] is False

            # 9. Cross-scope access rejection
            cross_scope = client.get(
                "/api/v1/projects/other_project/connectors",
                headers=headers,
            )
            assert cross_scope.status_code == 403
