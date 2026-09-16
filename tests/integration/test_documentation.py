"""Documentation is the deployed handbook, behind the same membership boundary."""

import hashlib
import asyncio

from sqlalchemy import update

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.api.routes.documentation import ROOT
from app.persistence.platform_admin import platform_ui_settings
from tests.integration.test_knowledge_lifecycle import approve, draft, review
from tests.support import settings_for


def test_documentation_is_authenticated_versioned_and_allowlisted(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors={})) as client:
        assert client.get("/api/v1/documentation").status_code == 401
        headers = token("admin")
        listing = client.get("/api/v1/documentation", headers=headers)
        assert listing.status_code == 200
        for item in listing.json():
            response = client.get("/api/v1/documentation/" + item["id"], headers=headers)
            assert response.status_code == 200, response.text
            raw = (ROOT / item["filename"]).read_bytes()
            assert response.json()["content"] == raw.decode("utf-8")
            assert response.json()["content_hash"] == "sha256:" + hashlib.sha256(raw).hexdigest()
        assert client.get("/api/v1/documentation/.env", headers=headers).status_code == 404
        assert client.get("/api/v1/documentation/..%2F..%2F.env", headers=headers).status_code == 404


def test_handbook_reader_access_is_separate_from_approved_project_documents(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors={})) as client:
        viewer = token("viewer")
        assert client.get("/api/v1/documentation", headers=viewer).status_code == 200
        assert client.get("/api/v1/documentation/project", headers=viewer).status_code == 200
        item = draft(client, token)
        assert client.get("/api/v1/knowledge", headers=viewer).json() == []
        approved = approve(client, token, item)
        library = client.get("/api/v1/knowledge", headers=viewer).json()
        assert [row["id"] for row in library] == [approved["id"]]
        assert library[0]["content"] == approved["content"]
        # The project selector remains a membership check, even for the handbook.
        foreign = viewer | {"X-RCA-Project": "outside-project"}
        assert client.get("/api/v1/knowledge", headers=foreign).status_code == 403
        assert client.get("/api/v1/documentation", headers=foreign).status_code == 403
        assert review(client, token, approved, "revoke", "admin").status_code == 200
        assert client.get("/api/v1/knowledge", headers=viewer).json() == []
        assert client.get("/api/v1/documentation", headers=viewer).status_code == 200


def test_existing_navigation_gains_handbook_without_replacing_custom_settings(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors={})) as client:
        headers = token("owner")
        current = client.get("/api/v1/platform/ui-settings", headers=headers).json()
        keys = ("brand_name", "workspace_label", "default_theme", "default_page", "welcome_title", "welcome_description", "navigation")
        payload = {key: current[key] for key in keys}
        payload.update(brand_name="Operations library", expected_version=current["version"])
        stored = client.put("/api/v1/platform/ui-settings", headers=headers, json=payload)
        assert stored.status_code == 200, stored.text
        navigation = [item | {"label": "Team runbooks", "visible": False} if item["page"] == "docs" else item
                      for item in stored.json()["navigation"] if item["page"] != "platform-docs"]

        async def legacy_settings():
            async with client.app.state.store.engine.begin() as connection:
                await connection.execute(update(platform_ui_settings).where(
                    platform_ui_settings.c.tenant_id == "acme", platform_ui_settings.c.project_id == "payments",
                ).values(navigation=navigation))

        asyncio.run(legacy_settings())
        upgraded = client.get("/api/v1/platform/ui-settings", headers=token("viewer")).json()
        assert upgraded["navigation"][:-1] == navigation
        assert upgraded["navigation"][-1]["page"] == "platform-docs"
        assert upgraded["brand_name"] == "Operations library"
        assert upgraded["version"] == stored.json()["version"]
        payload = {key: upgraded[key] for key in keys} | {"expected_version": upgraded["version"]}
        saved = client.put("/api/v1/platform/ui-settings", headers=headers, json=payload)
        assert saved.status_code == 200, saved.text
        assert saved.json()["navigation"] == upgraded["navigation"]
        assert saved.json()["version"] == upgraded["version"] + 1
