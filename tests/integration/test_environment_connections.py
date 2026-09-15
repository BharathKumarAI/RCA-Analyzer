"""Integration tests for repeatable Environment Connections and authorized selection."""

import tempfile
from pathlib import Path
from starlette.testclient import TestClient

import httpx2
from app.api.application import create_app
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.project_storage import project_prefix
from tests.support import connectors, settings_for


def test_repeatable_environment_connections_lifecycle(monkeypatch):
    monkeypatch.setenv("JIRA_API_TOKEN", "mock-token-secret")

    async def jira_probe(request):
        if request.url.path in ("/rest/api/2/project/PAY", "/rest/api/3/project/PAY"):
            return httpx2.Response(200, json={"key": "PAY", "name": "Payments"})
        return httpx2.Response(200, json={"key": "PAY", "name": "Payments"})

    def controlled_jira(**kwargs):
        client = httpx2.AsyncClient(
            base_url=kwargs["base_url"],
            transport=httpx2.MockTransport(jira_probe),
        )
        return JiraConnector(client=client, allow_insecure=True, **kwargs)

    monkeypatch.setattr("app.connectors.candidate_testing.JiraConnector", controlled_jira)

    with tempfile.TemporaryDirectory() as tmpdir:

        project_config = (
            Path(tmpdir)
            / "projects"
            / project_prefix("acme", "payments")
            / "configuration"
        )
        project_config.mkdir(parents=True)
        (project_config / "project.yaml").write_text(
            "tenant_id: acme\n"
            "project_id: payments\n"
            "environments:\n"
            "  - id: production\n"
            "    enabled: true\n"
            "  - id: staging\n"
            "    enabled: true\n"
            "  - id: qa\n"
            "    enabled: true\n",
            encoding="utf-8",
        )

        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")

            # 1. Save a connector instance with repeatable environment connections
            inst_payload = {
                "instance_id": "jira_multi_env",
                "template_id": "itsm",
                "template_version": "1.0.0",
                "system_name": "jira_multi_env",
                "environment_dependent": True,
                "tool_environment": "production",
                "definition": {
                    "endpoint": "http://jira-prod.test",
                    "auth_type": "basic_api_token",
                    "credentials": {
                        "account_identifier": "prod-admin@company.com",
                        "api_token_secret_ref": "env://JIRA_API_TOKEN",
                    },
                    "timeout_seconds": 30,
                    "max_results": 100,
                },
                "expected_revision": 0,
                "bindings": [
                    {
                        "project_env_id": "production",
                        "tool_env_id": "jira-prod-01",
                        "external_resource": "PAY",
                        "connection_id": "conn-jira-prod",
                    }
                ],
                "environment_connections": [
                    {
                        "connection_id": "conn-jira-prod",
                        "connection_name": "Jira Cloud Production",
                        "environment_name": "production",
                        "enabled": False,
                        "routing_mode": "direct",
                        "auth_profile_id": "basic_api_token",
                        "target": {"endpoint": "http://jira-prod.test"},
                        "credentials": {
                            "account_identifier": "prod-admin@company.com",
                            "api_token_secret_ref": "env://JIRA_API_TOKEN",
                        },
                        "resource_scope": ["PAY", "INC"],
                        "status": "draft",
                        "test_status": "not_tested",
                    },
                    {
                        "connection_id": "conn-jira-qa",
                        "connection_name": "Jira Cloud QA",
                        "environment_name": "qa",
                        "enabled": False,
                        "routing_mode": "direct",
                        "auth_profile_id": "basic_api_token",
                        "target": {"endpoint": "http://jira-qa.test"},
                        "credentials": {
                            "account_identifier": "qa-admin@company.com",
                            "api_token_secret_ref": "env://JIRA_API_TOKEN",
                        },
                        "resource_scope": ["PAY_QA"],
                        "status": "draft",
                        "test_status": "not_tested",
                    },
                ],
            }

            save_res = client.post(
                "/api/v1/projects/payments/connectors",
                headers=headers,
                json=inst_payload,
            )
            assert save_res.status_code == 200, save_res.text
            data = save_res.json()
            assert len(data.get("environment_connections", [])) == 2

            # 2. List environment connections via dedicated endpoint
            list_res = client.get(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections",
                headers=headers,
            )
            assert list_res.status_code == 200
            conns = list_res.json()
            assert len(conns) == 2
            conn_ids = {c["connection_id"] for c in conns}
            assert "conn-jira-prod" in conn_ids
            assert "conn-jira-qa" in conn_ids

            # 3. Enabling before passing test fails with 412
            enable_fail = client.post(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections/conn-jira-prod/enable",
                headers=headers,
            )
            assert enable_fail.status_code == 412
            assert "has not passed a live connection test" in enable_fail.json()["detail"]

            # 4. Save a new environment connection individually
            new_conn = {
                "connection_id": "conn-jira-staging",
                "connection_name": "Jira Cloud Staging",
                "environment_name": "staging",
                "enabled": False,
                "routing_mode": "direct",
                "auth_profile_id": "basic_api_token",
                "target": {"endpoint": "http://jira-staging.test"},
                "credentials": {
                    "account_identifier": "staging@company.com",
                    "api_token_secret_ref": "env://JIRA_API_TOKEN",
                },
                "resource_scope": ["PAY_STG"],
                "status": "draft",
                "test_status": "not_tested",
            }
            create_conn_res = client.post(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections",
                headers=headers,
                json=new_conn,
            )
            assert create_conn_res.status_code == 200
            assert create_conn_res.json()["connection_id"] == "conn-jira-staging"

            # 5. Run live test on specific environment connection
            test_conn_res = client.post(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections/conn-jira-prod/test",
                headers=headers,
            )
            assert test_conn_res.status_code == 200
            test_data = test_conn_res.json()
            assert test_data["connection_id"] == "conn-jira-prod"
            assert test_data["test_status"] == "passed", f"FAILED TEST DATA: {test_data}"


            # 6. Enabling connection now succeeds!
            enable_ok = client.post(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections/conn-jira-prod/enable",
                headers=headers,
            )
            assert enable_ok.status_code == 200
            assert enable_ok.json()["enabled"] is True
            assert enable_ok.json()["status"] == "active"

            disabled = client.post(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections/conn-jira-prod/disable",
                headers=headers,
            )
            assert disabled.status_code == 200
            assert disabled.json()["enabled"] is False
            assert disabled.json()["status"] == "inactive"
            assert disabled.json()["target_json"] == enable_ok.json()["target_json"]
            assert disabled.json()["credentials_json"] == enable_ok.json()["credentials_json"]
            assert client.post(
                "/api/v1/projects/another-project/connectors/jira_multi_env/connections/conn-jira-prod/disable",
                headers=headers,
            ).status_code == 403

            # 7. Delete an environment connection
            del_res = client.delete(
                "/api/v1/projects/payments/connectors/jira_multi_env/connections/conn-jira-staging",
                headers=headers,
            )
            assert del_res.status_code == 200
            assert del_res.json()["status"] == "deleted"



def test_release_policy_restricts_write_and_execution():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        project_config = root / "blob_local" / "tenants" / "acme" / "projects" / "payments" / "config"
        project_config.mkdir(parents=True)
        (project_config / "project.yaml").write_text(
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

            # Candidate with write access must be rejected by release policy
            candidate_with_write = {
                "template_id": "itsm",
                "template_version": "1.0.0",
                "system_name": "jira_main",
                "environment_dependency": "dependent",
                "tool_environment": "production",
                "endpoint": "http://jira.test",
                "auth_type": "basic_api_token",
                "credentials": {
                    "account_identifier": "bot@company.com",
                    "api_token_secret_ref": "env://JIRA_API_TOKEN",
                },
                "bindings": [
                    {
                        "project_env_id": "production",
                        "external_resource": "PAY",
                    }
                ],
                "tool_access_rules": [
                    {
                        "logical_capability": "jira.create_issue",
                        "tool_id": "jira.create_issue",
                        "tool_enabled": True,
                        "write_access": True,
                    }
                ],
            }
            res = client.post(
                "/api/v1/connectors/validate",
                headers=headers,
                json={"candidate": candidate_with_write},
            )
            assert res.status_code == 200
            data = res.json()
            assert data["valid"] is False
            assert any("restricted by release policy" in err for err in data["errors"])
