"""Database-owned skills reach native ADK runs without changing connector privileges."""

import asyncio
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.api.application import create_app
from app.capabilities.resolver import CapabilityResolver
from app.capabilities.registry import CapabilityRegistry
from app.configuration.database_bundle import metadata
from app.persistence.database import initialize_tables
from app.persistence.store import InvestigationStore
from app.optimization.content import materialize, read_platform
from scripts.seed_database import seed
from tests.support import FixtureModel, connectors, model_factory, settings_for
from app.identity.principals import Role


def reviewed_settings(tmp_path, mode="demo"):
    settings, token = settings_for(tmp_path, mode=mode)
    reviewer = settings.principals["admin"].model_copy(update={"subject": "reviewer", "username": "reviewer",
                                                             "roles": (Role.PLATFORM_ADMIN,)})
    return settings.model_copy(update={"principals": settings.principals | {"reviewer": reviewer}}), token


def approve(client, token, created):
    return client.post(f"/api/v1/skills/{created['id']}/approve", headers=token("reviewer"),
                       json={"expected_hash": created["content_hash"], "reason": "Reviewed evidence handling and tool permissions."})


def skill_input(**changes):
    return {
        "id": "customer-impact", "name": "Customer impact",
        "description": "Explain customer impact from incident evidence.",
        "instruction": "Report affected customer journeys and cite captured evidence IDs.",
        "capabilities": ["ticket_review"], "actions": ["itsm.get_ticket"],
        "project_override": False,
    } | changes


def test_created_skill_reaches_native_adk_and_persisted_contract(tmp_path, monkeypatch):
    settings, token = reviewed_settings(tmp_path, mode="live")
    instructions = []
    generate = FixtureModel.generate_content_async

    async def capture(self, llm_request, stream=False):
        instructions.append(str(llm_request.config.system_instruction))
        async for response in generate(self, llm_request, stream):
            yield response

    monkeypatch.setattr(FixtureModel, "generate_content_async", capture)
    app = create_app(settings, connectors=connectors(), model_factory=model_factory)
    with TestClient(app) as client:
        created = client.post("/api/v1/skills", headers=token("admin"), json=skill_input())
        assert created.status_code == 201, created.text
        assert created.json()["name"] == "Customer impact"
        assert created.json()["managed_in_database"] is True
        assert created.json()["capabilities"] == ["ticket_review"]
        assert created.json()["status"] == "PENDING"
        assert "customer-impact" not in app.state.registry.get("ticket_review").skills
        assert client.post("/api/v1/skills/customer-impact", headers=token("owner"),
                           json={"instruction": "Unreviewed project change"}).status_code == 409
        assert client.post("/api/v1/skills/customer-impact/approve", headers=token("admin"),
                           json={"expected_hash": created.json()["content_hash"], "reason": "Self review"}).status_code == 403
        approved = approve(client, token, created.json())
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "APPROVED"
        bundle, _, files = read_platform(settings, app.state.registry)
        materialize(tmp_path / "replay" / "platform", files, bundle)
        replay = CapabilityRegistry(str(tmp_path / "replay" / "platform" / "capabilities"))
        assert "customer-impact" in replay.get("ticket_review").skills
        assert replay.skill_contents["customer-impact"] == app.state.registry.skill_contents["customer-impact"]
        response = client.post("/api/v1/runs", headers=token(), json={
            "capability": "ticket_review", "prompt": "Review customer impact", "incident_id": "SAMSON-101",
        })
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "SUCCEEDED", response.json()
        assert any(skill_input()["instruction"] in instruction for instruction in instructions)
        assert set(app.state.runner.connectors) == {"itsm", "log_search"}
    with sqlite3.connect(tmp_path / "runs.db") as database:
        contract = json.loads(database.execute("SELECT contract_json FROM runs WHERE run_id = ?",
            (response.json()["run_id"],)).fetchone()[0])
        snapshot = json.loads(contract["model_config_json"])
        assert snapshot["skill_resolution"]["customer-impact"]["enabled"] is True
        assert snapshot["allowed_actions"] == ["itsm.get_ticket"]


def test_skill_creation_enforces_membership_schema_and_capability_ceiling(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        for actor in ("owner", "analyst", "viewer", "unknown"):
            assert client.post("/api/v1/skills", headers=token(actor), json=skill_input()).status_code == 403
        assert client.post("/api/v1/skills", json=skill_input()).status_code == 401
        for changes in (
            {"id": "../escape"}, {"instruction": " "}, {"instruction": "x" * 16001},
            {"actions": ["itsm.delete_ticket"]}, {"actions": ["database.query_readonly"]},
            {"actions": ["log_search.query_range"]}, {"capabilities": ["unknown"]},
            {"capabilities": ["ticket_review", "ticket_review"]}, {"tenant_id": "other"}, {"project_override": True},
        ):
            rejected = client.post("/api/v1/skills", headers=token("admin"), json=skill_input(**changes))
            assert rejected.status_code == 422, rejected.text
        assert client.post("/api/v1/skills", headers=token("admin"), json=skill_input()).status_code == 201
        assert client.post("/api/v1/skills", headers=token("admin"), json=skill_input()).status_code == 409
        assert client.post("/api/v1/skills", headers=token("admin"),
            json=skill_input(id="incident-triage")).status_code == 409
        protected = client.post("/api/v1/skills", headers=token("admin"),
            json=skill_input(id="protected-impact", project_override=False))
        assert protected.status_code == 201
        assert approve(client, token, protected.json()).status_code == 200
        assert client.post("/api/v1/skills/protected-impact", headers=token("owner"),
            json={"instruction": "Replace protected instruction"}).status_code == 403
        for number in range(3):
            added = client.post("/api/v1/skills", headers=token("admin"),
                json=skill_input(id=f"bounded-impact-{number}", instruction="x" * 16000))
            assert added.status_code == 201, added.text
            assert approve(client, token, added.json()).status_code == 200
        too_large = client.post("/api/v1/skills", headers=token("admin"),
            json=skill_input(id="bounded-impact-final", instruction="x" * 16000))
        assert too_large.status_code == 201
        over_limit = approve(client, token, too_large.json())
        assert over_limit.status_code == 422, over_limit.text
        assert "64,000" in over_limit.json()["detail"]
        assert client.get("/api/v1/skills", headers=token("admin")).status_code == 200


def test_skill_persistence_worker_refresh_and_project_override_versions(tmp_path):
    settings, token = reviewed_settings(tmp_path)

    async def initialize():
        store = InvestigationStore(settings.database_url.get_secret_value())
        await initialize_tables(store.engine, metadata)
        await store.aclose()

    asyncio.run(initialize())
    asyncio.run(seed(settings, "Payments"))
    settings = settings.model_copy(update={"database_configuration": True})
    first = create_app(settings, connectors=connectors())
    second = create_app(settings, connectors=connectors())
    with TestClient(first) as a, TestClient(second) as b:
        created = a.post("/api/v1/skills", headers=token("admin"), json=skill_input())
        assert created.status_code == 201, created.text
        assert approve(a, token, created.json()).status_code == 200
        other_worker = b.get("/api/v1/skills", headers=token("owner")).json()
        skill = next(item for item in other_worker if item["id"] == "incident-triage")
        assert any(item["id"] == "customer-impact" and item["status"] == "APPROVED" for item in other_worker)
        changed = b.post("/api/v1/skills/incident-triage", headers=token("owner"), json={
            "instruction": "Cite evidence IDs for affected checkout journeys.", "actions": [],
            "expected_hash": skill["effective_hash"],
        })
        assert changed.status_code == 200, changed.text
        # Authoritative database content prevents another worker overwriting the newer override.
        stale = a.post("/api/v1/skills/incident-triage", headers=token("owner"), json={
            "instruction": "Older editor", "expected_hash": skill["effective_hash"],
        })
        assert stale.status_code == 409, stale.text
        assert a.delete("/api/v1/skills/incident-triage", headers=token("owner"),
            params={"expected_hash": skill["effective_hash"]}).status_code == 409
        reloaded = next(item for item in a.get("/api/v1/skills", headers=token("owner")).json()
                        if item["id"] == "incident-triage")
        assert reloaded["effective_hash"] == changed.json()["effective_hash"]
        assert reloaded["project_instruction"] == "Cite evidence IDs for affected checkout journeys."

    with TestClient(create_app(settings, connectors=connectors())) as client:
        listed = client.get("/api/v1/skills", headers=token("owner")).json()
        persisted = next(item for item in listed if item["id"] == "incident-triage")
        assert persisted["project_instruction"] == "Cite evidence IDs for affected checkout journeys."
        assert persisted["project_actions"] == []
        reset = client.delete("/api/v1/skills/incident-triage", headers=token("owner"),
            params={"expected_hash": persisted["effective_hash"]})
        assert reset.status_code == 200, reset.text
        resolved = CapabilityResolver(client.app.state.registry).resolve("ticket_review",
            settings.principals["owner"], check_health=False)
        assert "customer-impact" in resolved.allowed_skills
        assert skill_input()["instruction"] in resolved.skill_contents["customer-impact"]


def test_reviews_reject_revoke_and_concurrent_approvals_remain_available(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        rejected = client.post("/api/v1/skills", headers=token("admin"), json=skill_input()).json()
        endpoint = "/api/v1/skills/customer-impact/reject"
        body = {"expected_hash": rejected["content_hash"], "reason": "Requires clearer evidence handling"}
        assert client.post(endpoint, headers=token("owner"), json=body).status_code == 403
        assert client.post(endpoint, headers=token("reviewer"), json=body | {"expected_hash": "sha256:" + "0" * 64}).status_code == 409
        assert client.post(endpoint, headers=token("reviewer"), json=body).json()["status"] == "REJECTED"
        assert approve(client, token, rejected).status_code == 409
        assert "customer-impact" not in app.state.registry.get("ticket_review").skills

        records = [client.post("/api/v1/skills", headers=token("admin"), json=skill_input(
            id=f"concurrent-impact-{number}", instruction="x" * 16000)).json() for number in range(4)]
        for record in records[:2]:
            assert approve(client, token, record).status_code == 200
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda record: approve(client, token, record), records[2:]))
        assert sorted(result.status_code for result in results) in ([200, 409], [200, 422]), [r.text for r in results]
        catalog = client.get("/api/v1/skills", headers=token("admin"))
        assert catalog.status_code == 200, catalog.text
        assert sum(item["status"] == "APPROVED" for item in catalog.json()) == 3
        revoke = client.post("/api/v1/skills/concurrent-impact-0/revoke", headers=token("admin"),
            json={"expected_hash": records[0]["content_hash"], "reason": "Withdraw reviewed instructions"})
        assert revoke.status_code == 200, revoke.text
        assert revoke.json()["status"] == "REVOKED"
        assert "concurrent-impact-0" not in app.state.registry.get("ticket_review").skills
        assert client.get("/api/v1/skills", headers=token("owner")).status_code == 200
    with TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.get("/api/v1/skills", headers=token("owner")).status_code == 200
        assert "concurrent-impact-0" not in client.app.state.registry.get("ticket_review").skills
