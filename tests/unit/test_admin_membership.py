"""A signed identity's next request uses its current server-side membership."""
from starlette.testclient import TestClient
from app.api.application import create_app
from tests.support import connectors, settings_for


def test_membership_edits_take_effect_and_cannot_escalate(tmp_path):
    settings, token = settings_for(tmp_path)
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        admin, owner, viewer = token('admin'), token('owner'), token('viewer')
        payload = {"name": "Viewer", "roles": ["PROJECT_ANALYST"], "status": "active"}
        assert client.put('/api/v1/users/viewer', headers=viewer, json=payload).status_code == 403
        assert client.put('/api/v1/users/viewer', headers=admin, json=payload).status_code == 200
        assert client.get('/api/v1/me', headers=viewer).json()['roles'] == ['PROJECT_ANALYST']
        payload['status'] = 'inactive'
        assert client.put('/api/v1/users/viewer', headers=admin, json=payload).status_code == 200
        assert client.get('/api/v1/me', headers=viewer).status_code == 403
        payload.update(status='active', roles=['PLATFORM_ADMIN'])
        assert client.post('/api/v1/users', headers=owner, json={**payload, 'id': 'new-admin'}).status_code == 403
        assert client.post('/api/v1/users', headers=admin, json={**payload, 'id': 'new-admin'}).status_code == 200
        assert client.get('/api/v1/me', headers=token('new-admin')).json()['roles'] == ['PLATFORM_ADMIN']
        demotion = {**payload, 'roles': ['PROJECT_VIEWER']}
        for subject in ['admin', 'new-admin']:
            assert client.put(f'/api/v1/users/{subject}', headers=owner, json=demotion).status_code == 403
            assert client.post('/api/v1/users', headers=owner, json={**demotion, 'id': subject}).status_code == 403
            assert client.delete(f'/api/v1/users/{subject}', headers=owner).status_code == 403
        assert client.delete('/api/v1/users/admin', headers=admin).status_code == 400
        assert client.delete('/api/v1/users/analyst', headers=admin).status_code == 204
        assert client.get('/api/v1/me', headers=token('analyst')).status_code == 403
    # Revocation survives restart even though the deployment still bootstraps analyst.
    with TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.get('/api/v1/me', headers=token('analyst')).status_code == 403
        assert client.get('/api/v1/me', headers=token('new-admin')).status_code == 200
