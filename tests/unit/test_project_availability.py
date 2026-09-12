import tempfile

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_project_availability_persists_and_narrows_capability_tools():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token('admin')
            path = '/api/v1/project/availability/connectors/itsm'
            payload = {'enabled': False, 'expected_enabled': True}
            assert client.put(path, json=payload, headers=token('viewer')).status_code == 403
            assert client.put(path, json={**payload, 'tenant_id': 'other'}, headers=headers).status_code == 422
            response = client.put(path, json=payload, headers=headers)
            assert response.status_code == 200, response.text
            assert client.put(path, json=payload, headers=headers).status_code == 409
            catalog = client.get('/api/v1/capabilities?all=true', headers=headers).json()
            for capability in catalog:
                assert not any(action.startswith('itsm.') for action in capability['permissions']['allowed_actions'])
                if 'itsm' in capability['required_connectors']:
                    assert capability['enabled'] is False
            assert client.put(path, json={'enabled': True, 'expected_enabled': False}, headers=headers).status_code == 200
            path = '/api/v1/project/availability/capabilities/ticket_review'
            response = client.put(path, json=payload, headers=headers)
            assert response.status_code == 200, response.text
            caps = client.get('/api/v1/capabilities?all=true', headers=headers).json()
            assert next(cap for cap in caps if cap['id'] == 'ticket_review')['enabled'] is False
        with TestClient(create_app(settings, connectors=connectors())) as client:
            caps = client.get('/api/v1/capabilities?all=true', headers=headers).json()
            assert next(cap for cap in caps if cap['id'] == 'ticket_review')['project_enabled'] is False
