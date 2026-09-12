"""Harness platform and project edits persist through the database bundle."""

import asyncio

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.database_bundle import metadata
from app.persistence.database import initialize_tables
from app.persistence.store import InvestigationStore
from scripts.seed_database import seed
from tests.support import connectors, settings_for


def test_harness_platform_and_project_edits_survive_restart(tmp_path):
    settings, token = settings_for(tmp_path)

    async def initialize_bundle_tables():
        store = InvestigationStore(settings.database_url.get_secret_value())
        await initialize_tables(store.engine, metadata)
        await store.aclose()

    asyncio.run(initialize_bundle_tables())
    asyncio.run(seed(settings, "Payments"))
    db_settings = settings.model_copy(update={"database_configuration": True})

    with TestClient(create_app(db_settings, connectors=connectors())) as client:
        initial = client.get("/api/v1/harness", headers=token("admin"))
        assert initial.status_code == 200, initial.text
        document = initial.json()["document"]
        document["plugins"][0]["description"] = "Persisted platform description"
        updated = client.put(
            "/api/v1/harness/platform",
            headers=token("admin"),
            json={"document": document, "expected_revision": initial.json()["revision"]},
        )
        assert updated.status_code == 200, updated.text
        platform_revision = updated.json()["revision"]
        project_revision = updated.json()["project_revision"]
        selection = {"plugins": [], "disabled_plugins": ["ticket-investigation"]}
        saved = client.put(
            "/api/v1/harness/project",
            headers=token("owner"),
            json={
                "selection": selection,
                "expected_revision": platform_revision,
                "expected_project_revision": project_revision,
            },
        )
        assert saved.status_code == 200, saved.text
        stale = client.put(
            "/api/v1/harness/project",
            headers=token("owner"),
            json={
                "selection": {},
                "expected_revision": platform_revision,
                "expected_project_revision": project_revision,
            },
        )
        assert stale.status_code == 409, stale.text
        configs = client.get("/api/v1/agent-configurations", headers=token("admin"))
        assert configs.status_code == 200, configs.text
        assert configs.json() == []

    with TestClient(create_app(db_settings, connectors=connectors())) as client:
        restored = client.get("/api/v1/harness", headers=token("owner"))
        assert restored.status_code == 200, restored.text
        assert restored.json()["document"]["plugins"][0]["description"] == (
            "Persisted platform description"
        )
        assert restored.json()["selection"]["disabled_plugins"] == [
            "ticket-investigation"
        ]
        assert "ticket-investigation" not in restored.json()["effective_plugins"]
