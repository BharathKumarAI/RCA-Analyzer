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
            assert {tool["system_name"] for tool in tools.json()} == {"itsm", "log_search"}

            users = client.get("/api/v1/users", headers=headers)
            assert users.status_code == 200
            assert {user["id"] for user in users.json()} == {"analyst", "owner", "admin", "viewer"}

            diagnostics = client.get("/api/v1/system/diagnostics", headers=headers)
            assert diagnostics.status_code == 200
            assert "rca_db" not in str(diagnostics.json()["mlflow"]["tracking_uri"])

            # A validly signed token without server-side membership cannot read
            # project catalog data.
            assert client.get("/api/v1/users", headers=token("unknown")).status_code == 403
