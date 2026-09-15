"""Field policies survive restart and apply to project writes and runtime resolution."""

import pytest
from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.parameters import ParameterStore
from tests.support import settings_for


def test_field_policy_persistence_scope_and_runtime(tmp_path):
    settings, token = settings_for(tmp_path)
    path = '/api/v1/connectors/templates/itsm/field-governance'
    with TestClient(create_app(settings)) as client:
        admin = token('admin')
        template = client.get('/api/v1/connectors/templates/itsm', headers=admin).json()
        revision = template['governance_revision']
        body = {'expected_revision': revision, 'fields': {'timeout_seconds': 'project_locked', 'custom_jql': 'platform_only'}}
        assert client.put(path, headers=token('owner'), json=body).status_code == 403
        assert client.put(path, headers=admin, json={**body, 'fields': {'credentials': 'project_editable'}}).status_code == 422
        assert client.put(path, headers=admin, json={**body, 'fields': {'unknown': 'project_locked'}}).status_code == 422
        response = client.put(path, headers=admin, json=body)
        assert response.status_code == 200, response.text
        assert client.put(path, headers=admin, json=body).status_code == 409

    with TestClient(create_app(settings)) as client:
        template = client.get('/api/v1/connectors/templates/itsm', headers=token('admin')).json()
        assert template['governance_revision'] == revision + 1
        assert next(f for f in template['field_governance'] if f['variable_name'] == 'timeout_seconds')['tier'] == 'project_locked'
        project = client.get('/api/v1/connectors/templates/itsm', headers=token('owner')).json()
        assert 'custom_jql' not in {f['variable_name'] for f in project['parameter_fields']}
        rows = client.get('/api/v1/parameters?view=template', headers=token('admin')).json()
        timeout = next(r for r in rows if r['tool'] == 'itsm' and r['variable_name'] == 'timeout_seconds')
        assert not timeout['allow_project_override']
        assert client.put('/api/v1/parameters/itsm/timeout_seconds/override', headers=token('owner'), json={
            'value': 12, 'expected_revision': 0, 'expected_definition_revision': timeout['revision'],
        }).status_code == 403
        # The harness reads the same persisted field flags, even after process restart.
        async def context():
            from app.api.routes.parameters import parameter_templates
            from types import SimpleNamespace
            return await parameter_templates(SimpleNamespace(app=client.app))
        templates = client.portal.call(context)
        governed = next(t for t in templates if t.system_name == 'itsm')
        assert not next(f for f in governed.parameter_fields if f.variable_name == 'timeout_seconds').allow_project_override
        with pytest.raises(PermissionError):
            ParameterStore.apply_instance_defaults({'definition_json': {'timeout_seconds': 12}}, rows, governed)


def test_locked_instance_fields_preserved_and_aliases_rejected(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        path = f'/api/v1/projects/{settings.project_id}/connectors'
        admin = token('admin')
        payload = dict(instance_id='governed', template_id='itsm', template_version='1.0.0', system_name='Service desk',
                       environment_dependency='independent', tool_environment='Shared', expected_revision=0,
                       definition={'external_resource': 'PAY', 'project_key': 'PAY', 'owner': 'platform-team'})
        saved = client.post(path, headers=admin, json=payload)
        assert saved.status_code == 200, saved.text
        policy = '/api/v1/connectors/templates/itsm/field-governance'
        assert client.put(policy, headers=admin, json={'expected_revision': 0, 'fields': {
            'external_resource': 'project_locked', 'owner': 'platform_only', 'system_name': 'project_locked',
        }}).status_code == 200
        owner = token('owner')
        payload['expected_revision'] = saved.json()['revision']
        payload['definition'] = {'project_key': 'OTHER'}
        assert client.post(path, headers=owner, json=payload).status_code == 403
        payload['definition'] = {'parameters': {'external_resource': 'OTHER'}}
        assert client.post(path, headers=owner, json=payload).status_code == 403
        payload['definition'] = {'description': 'Project-owned description'}
        saved = client.post(path, headers=owner, json=payload)
        assert saved.status_code == 200, saved.text
        assert 'owner' not in saved.json()['definition_json']
        actual = client.get(path + '/governed', headers=admin).json()
        assert actual['definition_json']['owner'] == 'platform-team'
        assert actual['definition_json']['external_resource'] == 'PAY'
        assert actual['definition_json']['project_key'] == 'PAY'


def test_lock_removes_scoped_overrides_and_updates_harness(tmp_path):
    from sqlalchemy import insert, select
    from app.configuration.parameters import audit, projects
    from app.identity.principals import Role, UserPrincipal

    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        async def register_project():
            async with client.app.state.parameters.engine.begin() as c:
                scope = (projects.c.tenant_id == settings.tenant_id, projects.c.project_id == settings.project_id)
                if not (await c.execute(select(projects).where(*scope))).first():
                    await c.execute(insert(projects).values(tenant_id=settings.tenant_id,
                        project_id=settings.project_id, project_name='Governance test'))
        client.portal.call(register_project)
        rows = client.get('/api/v1/parameters?view=template', headers=token('admin')).json()
        field = next(r for r in rows if r['tool'] == 'itsm' and r['variable_name'] == 'custom_jql')
        response = client.put('/api/v1/parameters/itsm/custom_jql/override', headers=token('owner'), json={
            'expected_revision': 0, 'expected_definition_revision': field['revision'], 'value': 'status = "Open"',
        })
        assert response.status_code == 200, response.text
        response = client.put('/api/v1/connectors/templates/itsm/field-governance', headers=token('admin'), json={
            'expected_revision': 0, 'fields': {'custom_jql': 'project_locked'},
        })
        assert response.status_code == 200, response.text
        principal = UserPrincipal(subject='owner', username='owner', tenant_id=settings.tenant_id,
            project_id=settings.project_id, roles=(Role.PROJECT_OWNER,))
        templates, rows, _ = client.portal.call(client.app.state.harness_workspace.connector_context, principal)
        declaration = next(f for t in templates if t.system_name == 'itsm' for f in t.parameter_fields if f.variable_name == 'custom_jql')
        resolved = next(r for r in rows if r['tool'] == 'itsm' and r['variable_name'] == 'custom_jql')
        assert not declaration.allow_project_override
        assert resolved['override_revision'] is None
        assert resolved['effective_value'] == field['default_value']
        async def audit_events():
            async with client.app.state.parameters.engine.connect() as c:
                return (await c.execute(select(audit).where(audit.c.action == 'field_policy'))).mappings().all()
        events = client.portal.call(audit_events)
        assert any(e['variable_name'] == 'custom_jql' and e['actor_subject'] == 'admin' for e in events)
