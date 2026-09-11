"""Tests for Admin Portal static serving and security headers."""

import tempfile

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import settings_for


def test_admin_portal_mount_and_security_headers():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token_func = settings_for(tmpdir, mode="demo")
        app = create_app(settings)

        with TestClient(app) as client:
            # 1. Root redirects to /admin/
            res = client.get("/", follow_redirects=False)
            assert res.status_code == 307
            assert res.headers["location"] == "/admin/"

            # 2. /admin/ serves index.html with 200
            res = client.get("/admin/")
            assert res.status_code == 200
            assert "RCA Analyzer" in res.text
            assert "Investigation workspace" in res.text

            # 3. Security headers: nosniff, CSP, X-Frame-Options
            assert res.headers["X-Content-Type-Options"] == "nosniff"
            assert "Content-Security-Policy" in res.headers
            csp = res.headers["Content-Security-Policy"]
            assert "default-src 'self'" in csp
            assert "frame-ancestors 'none'" in csp
            assert res.headers["X-Frame-Options"] == "DENY"

            # 4. Static assets (css/js) served successfully
            res_css = client.get("/admin/css/variables.css")
            assert res_css.status_code == 200
            assert "--bg-void" in res_css.text

            res_js = client.get("/admin/js/api.js")
            assert res_js.status_code == 200
            assert "inMemoryToken" in res_js.text

            # 5. /api/v1/* remains protected by bearer token auth
            res_api = client.get("/api/v1/runs")
            assert res_api.status_code == 401
