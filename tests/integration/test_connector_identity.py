"""Project connector identity and concurrent activation boundaries."""
import tempfile

import pytest
from starlette.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_duplicate_names_and_stale_activation_are_rejected():
    with tempfile.TemporaryDirectory() as directory:
        settings, token = settings_for(directory)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            payload = {
                "instance_id": "primary", "template_id": "itsm", "template_version": "1.0.0",
                "system_name": "Payments Jira", "status": "draft", "expected_revision": 0,
                "environment_dependency": "independent", "tool_environment": "Shared",
            }
            response = client.post('/api/v1/projects/payments/connectors', headers=token('admin'), json=payload)
            assert response.status_code == 200, response.text
            duplicate = client.post('/api/v1/projects/payments/connectors', headers=token('admin'), json={
                **payload, "instance_id": "secondary", "system_name": "payments JIRA",
            })
            assert duplicate.status_code == 409
            assert "unique system name" in duplicate.text
            response = client.post('/api/v1/projects/payments/connectors', headers=token('admin'), json={
                **payload, "expected_revision": 1, "tool_environment": "Shared updated",
            })
            assert response.status_code == 200, response.text

            async def stale_enable():
                return await app.state.platform_admin.set_project_connector_instance_enabled(
                    'acme', 'payments', 'primary', True, expected_revision=1,
                )

            with pytest.raises(ValueError, match="changed or is unavailable"):
                client.portal.call(stale_enable)
            persisted = client.get('/api/v1/projects/payments/connectors/primary', headers=token('admin')).json()
            assert persisted['revision'] == 2
            assert persisted['enabled'] is False
