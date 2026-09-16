"""Project catalog edits survive application restarts with database configuration."""

import asyncio

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.database_bundle import metadata
from app.persistence.database import initialize_tables
from app.persistence.store import InvestigationStore
from scripts.seed_database import seed
from tests.support import candidate_receipt, connectors, model_factory, settings_for


def test_project_setup_and_skill_edits_survive_restart(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    async def initialize_bundle_tables():
        store = InvestigationStore(settings.database_url.get_secret_value())
        await initialize_tables(store.engine, metadata)
        await store.aclose()
    asyncio.run(initialize_bundle_tables())
    asyncio.run(seed(settings, "Payments"))
    db_settings = settings.model_copy(update={"database_configuration": True})
    valid_yaml = (
        f"tenant_id: {settings.tenant_id}\n"
        f"project_id: {settings.project_id}\n"
        "preferences:\n  presentation: table\n"
    )

    with TestClient(create_app(db_settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("owner")
        candidate = {"yaml": valid_yaml}
        candidate["candidate_run_id"] = candidate_receipt(client, headers, candidate)
        saved = client.post("/api/v1/project/setup", headers=headers, json=candidate)
        assert saved.status_code == 200, saved.text

    with TestClient(create_app(db_settings, connectors=connectors())) as client:
        setup = client.get("/api/v1/project/setup", headers=token("owner"))
        assert setup.status_code == 200
        assert setup.json()["project_layer"]["preferences"]["presentation"] == "table"
        saved = client.post(
            "/api/v1/skills/incident-triage",
            headers=token("owner"),
            json={
                "instruction": "Cite evidence IDs and anchor every finding to an explicit timestamp.",
                "enabled": True,
                "actions": [],
            },
        )
        assert saved.status_code == 200, saved.text

    with TestClient(create_app(db_settings, connectors=connectors())) as client:
        skill = next(s for s in client.get("/api/v1/skills", headers=token("owner")).json() if s["id"] == "incident-triage")
        assert skill["is_overridden_in_project"] is True
        assert skill["project_actions"] == []
        assert skill["project_instruction"] == "Cite evidence IDs and anchor every finding to an explicit timestamp."
        assert client.get("/api/v1/project/setup", headers=token("owner")).json()["project_layer"]["preferences"]["presentation"] == "table"
        reset = client.delete("/api/v1/skills/incident-triage", headers=token("owner"))
        assert reset.status_code == 200, reset.text

    with TestClient(create_app(db_settings, connectors=connectors())) as client:
        skill = next(s for s in client.get("/api/v1/skills", headers=token("owner")).json() if s["id"] == "incident-triage")
        assert skill["is_overridden_in_project"] is False
        assert client.get("/api/v1/project/setup", headers=token("owner")).json()["project_layer"]["preferences"]["presentation"] == "table"
