"""Admin parameter edits survive new application instances, including zero."""

from fastapi.testclient import TestClient
from sqlalchemy import insert, select

from app.api.application import create_app
from app.configuration.parameters import projects
from tests.support import settings_for


def test_parameter_zero_override_and_reset_survive_restart(tmp_path):
    settings, token = settings_for(tmp_path)
    path = "/api/v1/parameters/custom/retry_budget"
    with TestClient(create_app(settings)) as client:
        async def register_project():
            async with client.app.state.parameters.engine.begin() as connection:
                existing = await connection.execute(select(projects).where(
                    projects.c.tenant_id == settings.tenant_id,
                    projects.c.project_id == settings.project_id,
                ))
                if existing.first() is None:
                    await connection.execute(insert(projects).values(
                        tenant_id=settings.tenant_id,
                        project_id=settings.project_id,
                        project_name="Payments",
                    ))

        client.portal.call(register_project)
        response = client.put(
            path + "/definition",
            headers=token("admin"),
            json={
                "value_type": "integer",
                "description": "Retry budget",
                "default_value": 3,
                "allow_project_override": True,
                "expected_revision": 0,
            },
        )
        assert response.status_code == 200, response.text
        response = client.put(
            path + "/override",
            headers=token("owner"),
            json={"value": 0, "expected_revision": 0, "expected_definition_revision": 1},
        )
        assert response.status_code == 200, response.text

    with TestClient(create_app(settings)) as client:
        rows = client.get("/api/v1/parameters", headers=token("owner")).json()
        row = next(row for row in rows if row["tool"] == "custom")
        assert row["effective_value"] == 0
        assert row["default_value"] == 3
        response = client.delete(
            path + f"/override?expected_revision={row['override_revision']}",
            headers=token("owner"),
        )
        assert response.status_code == 204, response.text

    with TestClient(create_app(settings)) as client:
        rows = client.get("/api/v1/parameters", headers=token("owner")).json()
        row = next(row for row in rows if row["tool"] == "custom")
        assert row["effective_value"] == 3
        assert row["override_revision"] is None
