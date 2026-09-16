"""Closure monitoring exposes scoped recorded data only to project administrators."""

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_closure_dashboard_permissions_empty_metrics_and_bounded_cursor(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        path = "/api/v1/knowledge/closures"
        assert client.get(path).status_code == 401
        for actor in ("analyst", "viewer"):
            assert client.get(path, headers=token(actor)).status_code == 403
            assert client.get(path + "/missing", headers=token(actor)).status_code == 403
        for actor in ("owner", "admin"):
            result = client.get(path, headers=token(actor))
            assert result.status_code == 200, result.text
            body = result.json()
            assert body["items"] == [] and body["next_cursor"] is None
            assert body["metrics"]["tracked"] == 0
            assert body["metrics"]["coverage"] is None and body["metrics"]["mean_deviation"] is None
            assert body["configuration"]["judge_stage"] == "synthesis"
            assert client.get(path + "/missing", headers=token(actor)).status_code == 404
        assert client.get(path + "?limit=101", headers=token("owner")).status_code == 422
        assert client.get(path + "?cursor=invalid", headers=token("owner")).status_code == 422
