import asyncio
import tempfile
import time

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.service import audit as audit_table
from tests.support import connectors, settings_for


def test_scoped_catalog_endpoints_use_runtime_data_and_redact_tracking_uri():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")
            async def seed_audit():
                async with app.state.configurations.engine.begin() as connection:
                    await connection.execute(audit_table.insert().values(
                        draft_id="draft_scope", tenant_id="acme", project_id="payments",
                        event="SUBMITTED", actor_subject="admin", reason="test", created_at=time.time()))
                    await connection.execute(audit_table.insert().values(
                        draft_id="draft_other", tenant_id="other", project_id="payments",
                        event="SUBMITTED", actor_subject="other", reason="hidden", created_at=time.time()))
            asyncio.run(seed_audit())
            health = client.get("/api/v1/health", headers=headers)
            assert health.status_code == 200
            assert health.json()["tenant_id"] == "acme"
            assert health.json()["total_runs"] == 0

            audit = client.get("/api/v1/audit", headers=headers)
            assert audit.status_code == 200
            assert [event["resource"] for event in audit.json()] == ["draft_scope"]

            tools = client.get("/api/v1/tools", headers=headers)
            assert tools.status_code == 200
            catalog = {tool["system_name"]: tool for tool in tools.json()}
            assert set(catalog) == {
                "itsm", "log_search", "confluence", "signalfx", "qtest",
                "gitlab", "oracle", "kafka", "unix", "kubernetes",
            }
            assert {name for name, tool in catalog.items() if tool["enabled"]} == {
                "itsm", "log_search",
            }
            for name in set(catalog) - {"itsm", "log_search"}:
                assert catalog[name]["status"] == "not_configured"
                assert catalog[name]["supported_transports"] == ["native", "mcp"]
            assert {name for name, tool in catalog.items() if tool["type"] == "mcp"} == set()
            assert set(app.state.runner.connectors) == {"itsm", "log_search"}

            users = client.get("/api/v1/users", headers=headers)
            assert users.status_code == 200
            assert {user["id"] for user in users.json()} == {"analyst", "owner", "admin", "viewer"}

            diagnostics = client.get("/api/v1/system/diagnostics", headers=headers)
            assert diagnostics.status_code == 200
            assert "rca_db" not in str(diagnostics.json()["mlflow"]["tracking_uri"])

            # Test system connection probe endpoint
            test_conn = client.post("/api/v1/system/test-connection", json={"target": "all"}, headers=headers)
            assert test_conn.status_code == 200
            conn_data = test_conn.json()["results"]
            assert "database" in conn_data
            assert "memory" in conn_data
            assert "storage" in conn_data
            assert "mlflow" in conn_data
            assert "connectors" in conn_data
            assert conn_data["database"]["status"] in ("connected", "healthy")
            assert conn_data["storage"]["status"] in ("connected", "healthy")

            # A validly signed token without server-side membership cannot read
            # project catalog data.
            assert client.get("/api/v1/users", headers=token("unknown")).status_code == 403


def test_demo_health_ignores_synthetic_templates_but_reports_degraded_provider():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")
            healthy = client.get("/api/v1/health", headers=headers)
            assert healthy.status_code == 200
            assert healthy.json()["status"] == "healthy"

            async def degraded_probe():
                from app.connectors.health import CheckStatus, ConnectorHealth

                return ConnectorHealth(
                    connector_id="itsm",
                    overall=CheckStatus.DEGRADED,
                    latency_ms=12,
                    message="fixture provider degraded",
                )

            app.state.runner.connectors["itsm"].probe_health = degraded_probe
            degraded = client.get("/api/v1/health", headers=headers)
            assert degraded.status_code == 200
            assert degraded.json()["status"] == "degraded"


def test_project_setup_and_validation_enforces_platform_rules():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")

            # 1. GET /api/v1/project/setup returns stage-by-stage platform definitions
            res = client.get("/api/v1/project/setup", headers=headers)
            assert res.status_code == 200
            data = res.json()
            assert "platform_policy" in data
            assert "available_capabilities" in data
            assert "available_skills" in data
            assert "stage_definitions" in data
            assert "template_yaml" in data
            assert len(data["stage_definitions"]) == 6
            for stage in data["stage_definitions"]:
                assert stage["agent_ids"]
                assert stage["bindings"]
                for binding in stage["bindings"]:
                    configured = app.state.platform.profiles.stages[binding["stage_id"]]
                    assert binding["model"] == configured.model
                    assert binding["max_output_tokens"] == configured.max_output_tokens

            # 2. POST /api/v1/project/validate with valid YAML
            valid_yaml = (
                f"tenant_id: {settings.tenant_id}\n"
                f"project_id: {settings.project_id}\n"
                "preferences:\n"
                "  presentation: summary\n"
            )
            v_res = client.post(
                "/api/v1/project/validate",
                headers=headers,
                json={"yaml": valid_yaml},
            )
            assert v_res.status_code == 200
            assert v_res.json()["valid"] is True
            assert len(v_res.json()["errors"]) == 0

            # 3. POST /api/v1/project/validate rejects immutable skill override
            invalid_skill_yaml = (
                f"tenant_id: {settings.tenant_id}\n"
                f"project_id: {settings.project_id}\n"
                "skills:\n"
                "  database-rca:\n"
                "    instruction: test override\n"
            )
            v_res2 = client.post(
                "/api/v1/project/validate",
                headers=headers,
                json={"yaml": invalid_skill_yaml},
            )
            assert v_res2.status_code == 200
            assert v_res2.json()["valid"] is False
            assert any(
                "immutable" in err for err in v_res2.json()["errors"]
            )

            # 4. POST /api/v1/project/validate rejects non-delegated section
            invalid_sec_yaml = (
                f"tenant_id: {settings.tenant_id}\n"
                f"project_id: {settings.project_id}\n"
                "unauthorized_section:\n"
                "  foo: bar\n"
            )
            v_res3 = client.post(
                "/api/v1/project/validate",
                headers=headers,
                json={"yaml": invalid_sec_yaml},
            )
            assert v_res3.status_code == 200
            assert v_res3.json()["valid"] is False
            assert any(
                "not delegated" in err for err in v_res3.json()["errors"]
            )

            # 5. POST /api/v1/project/setup saves valid configuration
            save_res = client.post(
                "/api/v1/project/setup",
                headers=headers,
                json={"yaml": valid_yaml},
            )
            assert save_res.status_code == 200
            saved_data = save_res.json()
            assert saved_data["project_file"]["exists"] is True

            # 6. POST /api/v1/project/validate accepts valid dynamic environments
            env_yaml = (
                f"tenant_id: {settings.tenant_id}\n"
                f"project_id: {settings.project_id}\n"
                "environments:\n"
                "  - id: prod\n"
                "    name: Production US-East\n"
                "    enabled: true\n"
                "    cluster: k8s-prod-01\n"
                "    namespace: checkout\n"
                "    host: checkout.company.internal\n"
                "    splunk_index: app_prod_logs\n"
                "    jira_env_name: Production\n"
            )
            v_env_res = client.post(
                "/api/v1/project/validate",
                headers=headers,
                json={"yaml": env_yaml},
            )
            assert v_env_res.status_code == 200
            assert v_env_res.json()["valid"] is True

            # 7. POST /api/v1/project/validate rejects invalid environment id
            bad_env_yaml = (
                f"tenant_id: {settings.tenant_id}\n"
                f"project_id: {settings.project_id}\n"
                "environments:\n"
                "  - id: 'invalid id with spaces'\n"
                "    name: Test\n"
            )
            v_bad_res = client.post(
                "/api/v1/project/validate",
                headers=headers,
                json={"yaml": bad_env_yaml},
            )
            assert v_bad_res.status_code == 200
            assert v_bad_res.json()["valid"] is False
            assert any("invalid characters" in err for err in v_bad_res.json()["errors"])


def test_skills_endpoint_and_project_override_validation():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")

            # 1. GET /api/v1/skills returns full content, parsed frontmatter, and instructions
            skills_res = client.get("/api/v1/skills", headers=headers)
            assert skills_res.status_code == 200
            skills = skills_res.json()
            assert len(skills) >= 2
            triage_skill = next(s for s in skills if s["id"] == "incident-triage")
            assert "content" in triage_skill
            assert "Workflow" in triage_skill["content"]
            assert triage_skill["frontmatter"]["category"] == "triage"
            assert triage_skill["is_overridden_in_project"] is False
            assert triage_skill["project_override"] is True

            # 2. POST /api/v1/skills/database-rca rejects immutable skill
            db_res = client.post(
                "/api/v1/skills/database-rca",
                headers=headers,
                json={"instruction": "Custom instruction override"},
            )
            assert db_res.status_code == 403
            assert "immutable" in db_res.json()["detail"]

            # Saving validates configuration; model quality requires a real evaluation run.
            save_skill_res = client.post(
                "/api/v1/skills/incident-triage",
                headers=headers,
                json={
                    "instruction": "Triage incident by resolving explicit timestamp temporal anchor and cite all evidence IDs.",
                    "enabled": True,
                },
            )
            assert save_skill_res.status_code == 200
            eval_data = save_skill_res.json()
            assert eval_data["saved"] is True
            assert eval_data["skill_id"] == "incident-triage"
            assert eval_data["stage"] == "triage"
            assert "mlflow" not in eval_data
            assert eval_data["validation"]["status"] == "PASSED"
            assert eval_data["validation"]["model_execution"] == "NOT_RUN"
            assert eval_data["validation"]["quality_evaluation"] == "NOT_RUN"

            # 4. Subsequent GET /api/v1/skills reflects project override
            skills_res2 = client.get("/api/v1/skills", headers=headers)
            triage_skill2 = next(s for s in skills_res2.json() if s["id"] == "incident-triage")
            assert triage_skill2["is_overridden_in_project"] is True
            assert "temporal anchor" in triage_skill2["project_instruction"]

            # 5. DELETE /api/v1/skills/incident-triage resets to baseline
            reset_res = client.delete("/api/v1/skills/incident-triage", headers=headers)
            assert reset_res.status_code == 200
            assert reset_res.json()["reset"] is True

            # 6. PUT /api/v1/project/availability/skills/{skill_id} toggles project availability
            toggle_res = client.put(
                "/api/v1/project/availability/skills/incident-triage",
                headers=headers,
                json={"enabled": False, "expected_enabled": True},
            )
            assert toggle_res.status_code == 200
            assert toggle_res.json() == {"id": "incident-triage", "project_enabled": False}

            # Verify reflected in skills catalog
            skills_res3 = client.get("/api/v1/skills", headers=headers)
            triage_skill3 = next(s for s in skills_res3.json() if s["id"] == "incident-triage")
            assert triage_skill3["project_enabled"] is False

            # Immutable skill cannot be altered by project availability
            immutable_res = client.put(
                "/api/v1/project/availability/skills/database-rca",
                headers=headers,
                json={"enabled": False, "expected_enabled": True},
            )
            assert immutable_res.status_code == 403

            # Re-enable
            reenable_res = client.put(
                "/api/v1/project/availability/skills/incident-triage",
                headers=headers,
                json={"enabled": True, "expected_enabled": False},
            )
            assert reenable_res.status_code == 200
            assert reenable_res.json()["project_enabled"] is True

