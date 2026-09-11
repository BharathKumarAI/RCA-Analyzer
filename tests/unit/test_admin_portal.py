"""Tests for Admin Portal static serving and security headers."""

import tempfile
from html.parser import HTMLParser

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import settings_for


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        url = attributes.get("src") if tag == "script" else (
            attributes.get("href")
            if tag == "link" and attributes.get("rel") == "stylesheet"
            else None
        )
        if url and not url.startswith(("http:", "https:", "//")):
            self.assets.append(url)


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

            # Check the selected portal's assets (built React or legacy fallback).
            parser = AssetParser()
            parser.feed(res.text)
            assert parser.assets
            for asset in parser.assets:
                path = asset if asset.startswith("/") else f"/admin/{asset}"
                response = client.get(path)
                assert response.status_code == 200, path
                assert response.content

            # 5. /api/v1/* remains protected by bearer token auth
            res_api = client.get("/api/v1/runs")
            assert res_api.status_code == 401
