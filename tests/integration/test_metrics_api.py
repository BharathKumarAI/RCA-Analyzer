"""Integration tests for SRE and Platform Metrics endpoints."""

from fastapi.testclient import TestClient
from app.api.application import create_app
from app.identity.principals import Role
from tests.support import connectors, settings_for


def setup_app(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    reviewer = settings.principals["admin"].model_copy(
        update={"subject": "reviewer", "username": "reviewer", "roles": (Role.PLATFORM_ADMIN,)}
    )
    viewer = settings.principals["viewer"].model_copy(
        update={"subject": "viewer", "username": "viewer", "roles": (Role.PROJECT_VIEWER,)}
    )
    analyst = settings.principals["analyst"].model_copy(
        update={"subject": "analyst", "username": "analyst", "roles": (Role.PROJECT_ANALYST,)}
    )
    configured_settings = settings.model_copy(
        update={"principals": settings.principals | {"reviewer": reviewer, "viewer": viewer, "analyst": analyst}}
    )
    app = create_app(configured_settings, connectors=connectors())
    return app, token


def test_project_metrics_endpoint_returns_sre_telemetry(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        res = client.get("/api/v1/metrics", headers=token("analyst"))
        assert res.status_code == 200, res.text
        data = res.json()
        assert "summary" in data
        assert "sre_metrics" in data
        assert "daily" in data
        assert "coverage" in data

        sre = data["sre_metrics"]
        assert "mttt" in sre
        assert "mttr" in sre
        assert "sla_compliance_rate" in sre
        assert "tickets_total" in sre
        assert "tickets_resolved" in sre
        assert "tickets_active" in sre
        assert "priority_breakdown" in sre
        assert "analyst_validation" in sre
        assert "auto_triage" in sre


def test_project_metrics_window_filters(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        for window in ["24h", "7d", "30d", "90d"]:
            res = client.get(f"/api/v1/metrics?window={window}", headers=token("analyst"))
            assert res.status_code == 200, res.text
            data = res.json()
            assert data["filters"]["start"] is not None
            assert data["filters"]["end"] is not None


def test_platform_metrics_authorization_enforced(tmp_path):
    app, token = setup_app(tmp_path)
    with TestClient(app) as client:
        # Analyst without PLATFORM_ADMIN must receive 403
        forbidden_res = client.get("/api/v1/metrics/platform", headers=token("analyst"))
        assert forbidden_res.status_code == 403

        # Viewer without PLATFORM_ADMIN must receive 403
        viewer_res = client.get("/api/v1/metrics/platform", headers=token("viewer"))
        assert viewer_res.status_code == 403

        # Platform administrator must receive 200
        admin_res = client.get("/api/v1/metrics/platform", headers=token("admin"))
        assert admin_res.status_code == 200, admin_res.text
        admin_data = admin_res.json()
        assert "totals" in admin_data
        assert "projects" in admin_data
        assert "tools" in admin_data
        assert "coverage" in admin_data
        assert "overall_run_latency" in admin_data["totals"]
