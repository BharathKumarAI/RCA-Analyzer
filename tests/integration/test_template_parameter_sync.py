"""Template controls share durable definitions without leaking instance scope."""

from fastapi.testclient import TestClient
from sqlalchemy import insert, select

from app.api.application import create_app
from app.configuration.parameters import projects
from tests.support import settings_for


def test_shared_template_parameters_persist_and_match_catalog(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        headers = token("admin")
        response = client.get("/api/v1/parameters?view=template", headers=headers)
        assert response.status_code == 200
        rows = response.json()
        assert rows
        assert not {"endpoint", "project_key", "system_name", "tool_environment", "environment_dependency"} & {
            row["variable_name"] for row in rows
        }
        assert all(not {"tenant_id", "project_id", "override_value", "override_revision"} & row.keys() for row in rows)
        assert client.get("/api/v1/parameters?view=template", headers=token("viewer")).status_code == 403
        jql = next(row for row in rows if row["tool"] == "itsm" and row["variable_name"] == "custom_jql")
        path = "/api/v1/parameters/itsm/custom_jql/definition"
        payload = {
            "value_type": "string", "description": jql["description"],
            "default_value": 'status = "Open"', "allow_project_override": True,
            "category": "query", "expected_revision": jql["revision"],
        }
        assert client.put(path, headers=headers, json=payload).status_code == 200
        assert client.put(path, headers=headers, json=payload).status_code == 409
        async def register_project():
            async with client.app.state.parameters.engine.begin() as connection:
                existing = await connection.execute(select(projects).where(
                    projects.c.tenant_id == settings.tenant_id,
                    projects.c.project_id == settings.project_id,
                ))
                if existing.first() is None:
                    await connection.execute(insert(projects).values(
                        tenant_id=settings.tenant_id, project_id=settings.project_id,
                        project_name="Private instance",
                    ))
        client.portal.call(register_project)
        override = client.put("/api/v1/parameters/itsm/custom_jql/override", headers=token("owner"), json={
            "value": 'labels = "private-instance"', "expected_revision": 0,
            "expected_definition_revision": jql["revision"] + 1,
        })
        assert override.status_code == 200, override.text
        payload.update(expected_revision=jql["revision"] + 1, default_value="x" * 4097)
        assert client.put(path, headers=headers, json=payload).status_code == 422

    with TestClient(create_app(settings)) as client:
        headers = token("admin")
        shared = client.get("/api/v1/parameters?view=template", headers=headers).json()
        detail = client.get("/api/v1/connectors/templates/itsm", headers=headers).json()
        catalog = client.get("/api/v1/connectors/templates", headers=headers).json()
        expected = [row for row in shared if row["tool"] == "itsm"]
        assert detail["shared_parameters"] == expected
        assert next(row for row in catalog if row["system_name"] == "itsm")["shared_parameters"] == expected
        jql = next(row for row in expected if row["variable_name"] == "custom_jql")
        assert jql["default_value"] == 'status = "Open"'


def test_template_form_save_is_atomic_and_rejects_instance_fields(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        headers = token("admin")
        path = "/api/v1/parameters/itsm/template"

        def current():
            rows = client.get("/api/v1/parameters?view=template", headers=headers).json()
            return {row["variable_name"]: row for row in rows if row["tool"] == "itsm"}

        original = current()
        changes = {
            "custom_jql": {"value": 'status = "Open"', "expected_revision": original["custom_jql"]["revision"]},
            "timeout_seconds": {"value": 0, "expected_revision": original["timeout_seconds"]["revision"]},
        }
        # The second value is invalid; the first write must roll back with it.
        assert client.put(path, headers=headers, json={"changes": changes}).status_code == 422
        assert current() == original
        assert client.put(path, headers=token("owner"), json={"changes": changes}).status_code == 403
        assert client.put(path, headers=headers, json={"changes": {
            "project_key": {"value": "PRIVATE", "expected_revision": 0},
        }}).status_code == 422
        assert client.put(path, headers=headers, json={"changes": {
            "custom_field_mapping": {"value": {"wrong_id": "Team"}, "expected_revision": original["custom_field_mapping"]["revision"]},
        }}).status_code == 422
        changes["timeout_seconds"]["value"] = 15
        response = client.put(path, headers=headers, json={"changes": changes})
        assert response.status_code == 200, response.text
        saved = current()
        assert saved["custom_jql"]["default_value"] == 'status = "Open"'
        assert saved["timeout_seconds"]["default_value"] == 15
        # A stale second revision also rolls back a valid first update.
        changes["custom_jql"].update(value='status = "Closed"', expected_revision=saved["custom_jql"]["revision"])
        assert client.put(path, headers=headers, json={"changes": changes}).status_code == 409
        assert current() == saved


def test_persisted_template_fields_and_lifecycle_share_one_contract(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        headers = token("admin")
        definition = client.app.state.platform.connector_templates[0].model_dump(mode="json")
        definition.update(system_name="custom_connector", type="custom_connector")
        definition["parameter_fields"] = [field for field in definition["parameter_fields"]
                                          if field["variable_name"] in {"system_name", "tool_environment", "environment_dependency"}]
        definition["parameter_fields"].append({
            "variable_name": "batch_size", "label": "Batch Size", "description": "Bounded batch configuration",
            "value_type": "integer", "default_value": 3, "minimum": 1, "maximum": 20,
            "template_editable": True, "allow_project_override": False, "ownership": "platform_locked",
        })
        payload = {"template_id": "custom_connector", "version": "1.0.0", "status": "draft", "definition": definition}
        assert client.post("/api/v1/connectors/templates", headers=headers, json=payload).status_code == 200

        def shared():
            response = client.get("/api/v1/parameters?view=template", headers=headers)
            assert response.status_code == 200, response.text
            return [row for row in response.json() if row["tool"] == "custom_connector"]

        assert shared() == []
        assert client.post("/api/v1/connectors/templates/custom_connector/publish", headers=headers).status_code == 200
        row, = shared()
        assert row["label"] == "Batch Size"
        assert row["maximum"] == 20
        path = "/api/v1/parameters/custom_connector/template"
        changes = {"batch_size": {"value": 8, "expected_revision": row["revision"]}}
        assert client.put(path, headers=headers, json={"changes": changes}).status_code == 200
        row, = shared()
        assert row["default_value"] == 8
        single = {
            "value_type": "integer", "default_value": 21, "description": row["description"],
            "allow_project_override": False, "expected_revision": row["revision"],
        }
        assert client.put("/api/v1/parameters/custom_connector/batch_size/definition", headers=headers, json=single).status_code == 422
        assert shared()[0]["default_value"] == 8
        # Reject incompatible published versions without breaking the existing catalog.
        definition["parameter_fields"][-1]["maximum"] = 30
        payload.update(version="2.0.0", status="published")
        assert client.post("/api/v1/connectors/templates", headers=headers, json=payload).status_code == 409
        assert shared()[0]["default_value"] == 8
        assert client.post("/api/v1/connectors/templates/custom_connector/deprecate", headers=headers).status_code == 200
        assert shared() == []
        changes["batch_size"]["expected_revision"] = row["revision"]
        assert client.put(path, headers=headers, json={"changes": changes}).status_code == 422
        detail = client.get("/api/v1/connectors/templates/custom_connector", headers=headers).json()
        assert detail["shared_parameters"] == []


def test_instance_runtime_defaults_preserve_scope_and_enforce_precedence():
    import pytest
    from app.configuration.parameters import ParameterStore
    from app.configuration.platform import PlatformConfiguration
    from app.settings import Settings

    template = next(item for item in PlatformConfiguration.load(Settings()).connector_templates if item.system_name == "log_search")
    instance = {"instance_id": "logs", "definition_json": {"endpoint": "https://logs.invalid", "index": "private"}}
    rows = [{"tool": "log_search", "variable_name": "timeout_seconds", "effective_value": 12, "enabled": True}]
    resolved = ParameterStore.apply_instance_defaults(instance, rows, template)
    assert resolved["definition_json"]["timeout_seconds"] == 12
    assert resolved["definition_json"]["max_window_seconds"] == 86400
    assert resolved["definition_json"]["index"] == "private"
    assert "timeout_seconds" not in instance["definition_json"]
    instance["definition_json"]["timeout_seconds"] = 20
    assert ParameterStore.apply_instance_defaults(instance, rows, template)["definition_json"]["timeout_seconds"] == 20
    instance["definition_json"]["timeout_seconds"] = 61
    with pytest.raises(ValueError):
        ParameterStore.apply_instance_defaults(instance, rows, template)
    instance["definition_json"]["timeout_seconds"] = 20
    fields = tuple(field.model_copy(update={"allow_project_override": False, "ownership": "platform_locked"})
                   if field.variable_name == "timeout_seconds" else field for field in template.parameter_fields)
    locked = template.model_copy(update={"parameter_fields": fields})
    with pytest.raises(PermissionError):
        ParameterStore.apply_instance_defaults(instance, rows, locked)
    rows[0]["enabled"] = False
    with pytest.raises(PermissionError):
        ParameterStore.apply_instance_defaults(instance, rows, template)
