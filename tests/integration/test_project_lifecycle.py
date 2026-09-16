"""Lifecycle is target-membership controlled, retained, and recoverable without workspace access."""
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.api.application import create_app
from app.configuration.parameters import audit
from app.configuration.projects import project_catalog
from app.persistence.platform_admin import platform_users
from tests.support import connectors, settings_for
from tests.integration.test_projects import headers, new_project


def state(client, auth, project="payments"):
    response = client.get("/api/v1/projects/management", headers=auth)
    assert response.status_code == 200, response.text
    return next(item for item in response.json()["items"] if item["project_id"] == project)


def change(client, auth, project, action, current):
    return client.post(f"/api/v1/projects/{project}/lifecycle", headers=auth, json={
        "action": action, "expected_hash": current["content_hash"], "reason": "Reviewed project lifecycle."})


def test_last_project_recovery_never_grants_inactive_workspace_access(tmp_path):
    settings, token = settings_for(tmp_path)
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        owner = headers(token, "payments", "owner")
        initial = state(client, owner)
        assert change(client, owner, "payments", "archive", initial).status_code == 409
        disabled = change(client, owner, "payments", "deactivate", initial)
        assert disabled.status_code == 200 and disabled.json()["status"] == "inactive", disabled.text
        assert change(client, owner, "payments", "activate", initial).status_code == 409
        # The management identity can recover, but cannot read or execute project work.
        identity = client.get("/api/v1/me", headers=owner)
        assert identity.status_code == 200, identity.text
        assert identity.json()["project_id"] == "" and identity.json()["roles"] == ["GENERIC_USER"]
        assert client.get("/api/v1/projects", headers=owner).json()["items"] == []
        assert client.post("/api/v1/projects/payments/select", headers=owner).status_code == 403
        for path in ("/api/v1/config", "/api/v1/runs", "/api/v1/knowledge"):
            assert client.get(path, headers=owner).status_code == 403
        assert client.post("/api/v1/runs", headers=owner, json={}).status_code == 403
        archived = change(client, owner, "payments", "archive", disabled.json())
        assert archived.status_code == 200 and archived.json()["status"] == "archived", archived.text
        assert change(client, owner, "payments", "activate", archived.json()).status_code == 409
    # Process restart does not reactivate the bootstrap catalog or discard membership.
    with TestClient(create_app(settings, connectors=connectors())) as client:
        archived = state(client, token("owner"))
        assert archived["status"] == "archived"
        restored = change(client, token("owner"), "payments", "restore", archived)
        assert restored.status_code == 200 and restored.json()["status"] == "inactive", restored.text
        activated = change(client, token("owner"), "payments", "activate", restored.json())
        assert activated.status_code == 200 and activated.json()["status"] == "active", activated.text
        assert client.get("/api/v1/me", headers=token("owner")).json()["project_id"] == "payments"
        assert client.get("/api/v1/config", headers=token("owner")).status_code == 200


def test_lifecycle_rechecks_target_roles_membership_and_records_change(tmp_path):
    settings, token = settings_for(tmp_path)
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        new_project(client, token, "support")
        current = state(client, token("admin"), "support")
        assert change(client, token("owner"), "support", "deactivate", current).status_code == 403
        assert client.get("/api/v1/projects/management", headers=token("viewer")).json()["items"] == []
        assert change(client, token("viewer"), "payments", "deactivate", state(client, token("admin"))).status_code == 403
        disabled = change(client, token("admin"), "support", "deactivate", current)
        assert disabled.status_code == 200, disabled.text

        async def inspect_and_revoke():
            async with app.state.store.engine.begin() as connection:
                assert await connection.scalar(select(project_catalog.c.status).where(project_catalog.c.project_id == "support")) == "inactive"
                records = (await connection.execute(select(audit).where(audit.c.project_id == "support", audit.c.action == "deactivate"))).mappings().all()
                assert len(records) == 1 and records[0]["details"]["from"] == "active"
                await connection.execute(update(platform_users).where(platform_users.c.project_id == "support", platform_users.c.subject == "admin").values(status="inactive"))
        client.portal.call(inspect_and_revoke)
        assert change(client, token("admin"), "support", "activate", disabled.json()).status_code == 403
        assert client.get("/api/v1/me", headers=headers(token, "support")).status_code == 403
