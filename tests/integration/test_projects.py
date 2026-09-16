"""Multiple project workspaces use fresh membership and isolated runtime services."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import threading

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.api.application import create_app
from app.configuration.database_bundle import active, bundles, update_bundle_file
from app.configuration.projects import project_catalog
from tests.support import FixtureModel, connectors, model_factory, settings_for


def new_project(client, token, key):
    result = client.post("/api/v1/projects", headers=token("admin"), json={
        "project_id": key, "name": key.title(), "description": f"Investigate {key} incidents", "timezone": "UTC"})
    assert result.status_code == 201, result.text
    return result.json()


def headers(token, project, actor="admin"):
    return token(actor) | {"X-RCA-Project": project}


def add_owner(client, token, project):
    response = client.post("/api/v1/users", headers=headers(token, project), json={
        "id": "owner", "name": "Owner", "roles": ["PROJECT_OWNER"], "status": "active"})
    assert response.status_code == 200, response.text


def test_create_select_restart_and_immediate_membership_revocation(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.get("/api/v1/projects", headers=token("admin")).json()["items"][0]["project_id"] == "payments"
        project = new_project(client, token, "support")
        assert project["roles"] == ["PLATFORM_ADMIN", "PROJECT_OWNER"]
        assert client.post("/api/v1/projects", headers=token("owner"), json={"project_id": "other", "name": "Other"}).status_code == 403
        assert client.get("/api/v1/me", headers=headers(token, "support", "owner")).status_code == 403
        add_owner(client, token, "support")
        selected = client.post("/api/v1/projects/support/select", headers=token("owner"))
        assert selected.status_code == 200, selected.text
        assert selected.json()["principal"]["roles"] == ["PROJECT_OWNER"]
        assert client.get("/api/v1/me", headers=token("owner")).json()["project_id"] == "support"
        assert client.get("/api/v1/me", headers=headers(token, "payments", "owner")).json()["project_id"] == "payments"
        assert client.get("/api/v1/me", headers=headers(token, "outside", "admin")).status_code == 403
        assert client.post("/api/v1/projects", headers=token("admin"), json={"project_id": "bad", "name": "Bad", "roles": ["PLATFORM_ADMIN"]}).status_code == 422
        inactive = client.put("/api/v1/users/owner", headers=headers(token, "support"), json={
            "name": "Owner", "roles": ["PROJECT_OWNER"], "status": "inactive"})
        assert inactive.status_code == 200, inactive.text
        assert client.get("/api/v1/knowledge", headers=headers(token, "support", "owner")).status_code == 403
        # An invalid remembered project falls back to an active membership.
        assert client.get("/api/v1/me", headers=token("owner")).json()["project_id"] == "payments"
    with TestClient(create_app(settings, connectors=connectors())) as client:
        assert {item["project_id"] for item in client.get("/api/v1/projects", headers=token("admin")).json()["items"]} == {"payments", "support"}
        assert client.get("/api/v1/me", headers=headers(token, "support", "owner")).status_code == 403
        assert client.get("/api/v1/config", headers=headers(token, "support")).status_code == 200


def test_setup_apply_publishes_project_details_with_configuration_and_rolls_back_stale_draft(tmp_path):
    settings, token = settings_for(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        new_project(client, token, "support")
        auth = headers(token, "support")
        setup = client.get("/api/v1/project/setup", headers=auth).json()
        document = {"metadata": {"id": "support", "name": "Customer response", "objective": "Investigate customer incidents",
            "timezone": "America/Chicago", "responsibility": ["Root Cause Analysis"], "status": "inactive"},
            "projectScope": {"members": {"owners": [{"id": "admin"}]}}}
        saved = client.put("/api/v1/project/editor", headers=auth, json={"document": document, "expected_version": 1})
        assert saved.status_code == 200, saved.text
        directory = client.get("/api/v1/projects", headers=auth).json()["items"]
        assert next(item for item in directory if item["project_id"] == "support")["name"] == "Support"
        candidate = {"yaml": yaml.safe_dump({"prompts": {"triage": "Inspect the customer's evidence."}}),
            "expected_project_revision": setup["project_revision"], "expected_editor_version": 2}
        applied = client.post("/api/v1/project/setup", headers=auth, json=candidate)
        assert applied.status_code == 200, applied.text
        directory = client.get("/api/v1/projects", headers=auth).json()["items"]
        updated = next(item for item in directory if item["project_id"] == "support")
        assert (updated["name"], updated["description"], updated["timezone"]) == (
            "Customer response", "Investigate customer incidents", "America/Chicago")
        assert updated["status"] == "active"  # Setup readiness cannot archive a project.
        assert next(item for item in directory if item["project_id"] == "payments")["name"] == "payments"

        async def stale_transaction():
            state = app.state.project_runtimes.entries["support"].app.state
            async with state.store.engine.connect() as connection:
                before = await connection.scalar(select(active.c.content_hash).where(active.c.project_id == "support"))
                count = await connection.scalar(select(func.count()).select_from(bundles))
            with pytest.raises(ValueError, match="draft changed"):
                await update_bundle_file(state.store.engine, state.settings, "config/test.yaml", "enabled: true\n",
                    expected_bundle_hash=before, expected_editor_version=999)
            async with state.store.engine.connect() as connection:
                assert await connection.scalar(select(active.c.content_hash).where(active.c.project_id == "support")) == before
                assert await connection.scalar(select(func.count()).select_from(bundles)) == count
                assert await connection.scalar(select(project_catalog.c.name).where(project_catalog.c.project_id == "support")) == "Customer response"
        client.portal.call(stale_transaction)


def test_legacy_setup_rejects_stale_draft_before_replacing_local_file(tmp_path):
    from starlette.requests import Request
    from app.api.routes.catalog import _save_project_file

    settings, _ = settings_for(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        async def stale_apply():
            request = Request({"type": "http", "app": app, "headers": []})
            principal = settings.principals["admin"]
            original = "prompts:\n  triage: Keep the saved guidance.\n"
            path = await _save_project_file(request, principal, original)
            with pytest.raises(ValueError, match="draft changed"):
                await _save_project_file(request, principal, "prompts:\n  triage: Unreviewed replacement.\n",
                    expected_editor_version=999)
            assert path.read_text() == original
        client.portal.call(stale_apply)


def test_parallel_projects_isolate_knowledge_runs_uploads_and_runtime_configuration(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    app = create_app(settings, connectors=connectors(), model_factory=model_factory)
    with TestClient(app) as client:
        for project in ("alpha", "beta"):
            new_project(client, token, project)
            add_owner(client, token, project)
            document = client.post("/api/v1/knowledge", headers=headers(token, project, "owner"), json={
                "title": f"{project} timeout runbook", "category": "Runbooks", "content": f"Investigate {project} timeout using the {project} reference."}).json()
            review = {"expected_hash": document["content_hash"], "reason": "Checked this project's source."}
            assert client.post(f"/api/v1/knowledge/{document['id']}/submit", headers=headers(token, project, "owner"), json=review).status_code == 200
            assert client.post(f"/api/v1/knowledge/{document['id']}/approve", headers=headers(token, project), json=review).status_code == 200
        def investigate(project):
            auth = headers(token, project, "owner")
            chat = client.post("/api/v1/chats", headers=auth).json()["chat_id"]
            upload = client.post("/api/v1/files", headers=auth, data={"chat_id": chat}, files=[("files", (f"{project}.txt", f"{project} timeout observed", "text/plain"))])
            assert upload.status_code == 201, upload.text
            attachment = upload.json()["attachments"][0]["attachment_id"]
            result = client.post("/api/v1/runs", headers=auth, json={"chat_id": chat,
                "capability": "attachment_review", "prompt": f"What does {project} timeout guidance say?", "attachment_ids": [attachment]})
            assert result.status_code == 200 and result.json()["status"] == "SUCCEEDED", result.text
            return project, chat, attachment, result.json()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(investigate, ("alpha", "beta")))
        for project, chat, attachment, run in results:
            other = "beta" if project == "alpha" else "alpha"
            auth = headers(token, project, "owner")
            evidence = client.get(f"/api/v1/runs/{run['run_id']}/evidence", headers=auth).json()
            assert len(evidence) == 2
            assert all(other not in item["content_json"] for item in evidence)
            assert client.get(f"/api/v1/chats/{chat}", headers=headers(token, other, "owner")).status_code == 404
            assert client.get(f"/api/v1/runs/{run['run_id']}", headers=headers(token, other, "owner")).status_code == 404
            assert client.post("/api/v1/runs", headers=headers(token, other, "owner"), json={
                "capability": "attachment_review", "prompt": "Read the file", "attachment_ids": [attachment]}).status_code == 403
            state = app.state.project_runtimes.entries[project].app.state
            assert state.settings.project_id == project and state.runner.settings.project_id == project
            assert state.runner.connectors == {}  # No deployment credential/client inheritance.
            assert state.store.attachment_scope == (settings.tenant_id, project)
        alpha = app.state.project_runtimes.entries["alpha"].app.state
        beta = app.state.project_runtimes.entries["beta"].app.state
        assert alpha.registry is not beta.registry and alpha.runner is not beta.runner
        assert alpha.settings.artifact_uri("knowledge") != beta.settings.artifact_uri("knowledge")
        assert not client.get("/api/v1/knowledge", headers=token("owner")).json()
        assert client.get("/api/v1/telemetry", headers=headers(token, "alpha", "owner")).json()["summary"]["runs"] == 1


def test_project_disable_fails_closed_and_baseline_does_not_copy_project_layers(tmp_path):
    settings, token = settings_for(tmp_path)
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        new_project(client, token, "isolated")
        assert client.get("/api/v1/config", headers=headers(token, "isolated")).status_code == 200
        async def inspect_and_disable():
            async with app.state.store.engine.begin() as connection:
                files = await connection.scalar(select(bundles.c.files).where(bundles.c.tenant_id == "acme", bundles.c.project_id == "isolated"))
                assert len([key for key in files if key.startswith("projects/")]) == 1
                assert not any(key.startswith(("layers/projects/", "layers/users/")) for key in files)
                assert '"payments"' not in json.dumps([value for key, value in files.items() if key.startswith("projects/")])
                await connection.execute(update(project_catalog).where(project_catalog.c.tenant_id == "acme", project_catalog.c.project_id == "isolated").values(status="inactive"))
        asyncio.run(inspect_and_disable())
        assert client.get("/api/v1/config", headers=headers(token, "isolated")).status_code == 403


def test_access_requests_require_independent_project_owner_and_grant_only_after_approval(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        new_project(client, token, "support")
        added = client.post("/api/v1/project-access-requests", headers=token("viewer"), json={
            "project_id": "support", "requested_role": "PROJECT_ANALYST", "reason": "Join the support rotation."})
        assert added.status_code == 201, added.text
        record = added.json()
        body = {"expected_hash": record["content_hash"], "reason": "Confirmed rotation assignment."}
        assert client.get("/api/v1/me", headers=headers(token, "support", "viewer")).status_code == 403
        # Being an owner elsewhere confers no review rights in the target project.
        assert client.post(f"/api/v1/project-access-requests/{record['id']}/approve", headers=token("owner"), json=body).status_code == 403
        assert client.get("/api/v1/project-access-requests", headers=token("owner")).json() == []
        assert client.get("/api/v1/project-access-requests", headers=token("admin")).json()[0]["can_review"] is True
        assert client.post(f"/api/v1/project-access-requests/{record['id']}/approve", headers=token("admin"), json=body | {"expected_hash": "sha256:" + "0" * 64}).status_code == 409
        approved = client.post(f"/api/v1/project-access-requests/{record['id']}/approve", headers=token("admin"), json=body)
        assert approved.status_code == 200 and approved.json()["status"] == "APPROVED", approved.text
        assert client.get("/api/v1/me", headers=headers(token, "support", "viewer")).json()["roles"] == ["PROJECT_ANALYST"]
        assert client.post("/api/v1/projects/support/select", headers=token("viewer")).status_code == 200
        assert client.post(f"/api/v1/project-access-requests/{record['id']}/approve", headers=token("admin"), json=body).status_code == 409
        assert client.post("/api/v1/project-access-requests", headers=token("owner"), json={
            "project_id": "support", "requested_role": "PLATFORM_ADMIN", "reason": "Escalate"}).status_code == 422
        for project in ("unknown", "different-tenant-project"):
            assert client.post("/api/v1/project-access-requests", headers=token("owner"), json={
                "project_id": project, "requested_role": "PROJECT_OWNER", "reason": "Access"}).status_code == 403
        self_request = client.post("/api/v1/project-access-requests", headers=token("admin"), json={
            "project_id": "support", "requested_role": "PROJECT_OWNER", "reason": "Owner access"}).json()
        assert client.post(f"/api/v1/project-access-requests/{self_request['id']}/approve", headers=token("admin"), json={
            "expected_hash": self_request["content_hash"], "reason": "Own request"}).status_code == 403


def test_runtime_cache_keeps_streaming_request_alive_and_evicts_only_after_completion(tmp_path):
    entered, release = threading.Event(), threading.Event()

    class HeldModel(FixtureModel):
        async def generate_content_async(self, llm_request, stream=False):
            if self.stage == "orchestrator":
                entered.set()
                await asyncio.to_thread(release.wait)
            async for result in super().generate_content_async(llm_request, stream):
                yield result

    settings, token = settings_for(tmp_path, mode="live")
    app = create_app(settings, connectors=connectors(), model_factory=lambda stage, config: HeldModel(stage=stage, model=config.model))
    with TestClient(app) as client:
        for project in ("alpha", "beta"):
            new_project(client, token, project)
        app.state.project_runtimes.maximum = 1
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(client.post, "/api/v1/runs?stream=true", headers=headers(token, "alpha"), json={
                "capability": "attachment_review", "prompt": "Read project guidance"})
            try:
                assert entered.wait(15), "Native workflow never reached the model"
                assert app.state.project_runtimes.entries["alpha"].references == 1
                busy = client.get("/api/v1/config", headers=headers(token, "beta"))
                assert busy.status_code == 429, busy.text
            finally:
                release.set()
            assert future.result(timeout=30).status_code == 200
        assert app.state.project_runtimes.entries["alpha"].references == 0
        assert client.get("/api/v1/config", headers=headers(token, "beta")).status_code == 200
        assert set(app.state.project_runtimes.entries) == {"beta"}
        assert client.get("/api/v1/config", headers=headers(token, "alpha")).status_code == 200
        assert set(app.state.project_runtimes.entries) == {"alpha"}


def test_new_project_inherits_managed_skills_once_and_observes_revocation(tmp_path):
    from tests.integration.test_skill_catalog import approve, reviewed_settings, skill_input
    settings, token = reviewed_settings(tmp_path)
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        active_skill = client.post("/api/v1/skills", headers=token("admin"), json=skill_input()).json()
        assert approve(client, token, active_skill).status_code == 200
        pending = client.post("/api/v1/skills", headers=token("admin"), json=skill_input(id="pending-impact")).json()
        new_project(client, token, "newteam")
        response = client.get("/api/v1/config", headers=headers(token, "newteam"))
        assert response.status_code == 200, response.text
        registry = app.state.project_runtimes.entries["newteam"].app.state.registry
        assert registry.get("ticket_review").skills.count(active_skill["id"]) == 1
        assert pending["id"] not in registry.get("ticket_review").skills
        revoked = client.post(f"/api/v1/skills/{active_skill['id']}/revoke", headers=token("reviewer"), json={
            "expected_hash": active_skill["content_hash"], "reason": "Revocation must reach all projects."})
        assert revoked.status_code == 200, revoked.text
        assert client.get("/api/v1/config", headers=headers(token, "newteam")).status_code == 200
        assert active_skill["id"] not in app.state.project_runtimes.entries["newteam"].app.state.registry.get("ticket_review").skills


def test_rejoining_inactive_member_grants_only_the_reviewed_role(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        new_project(client, token, "support")
        add_owner(client, token, "support")
        inactive = client.put("/api/v1/users/owner", headers=headers(token, "support"), json={
            "name": "Former owner", "roles": ["PROJECT_OWNER"], "status": "inactive"})
        assert inactive.status_code == 200
        proposed = client.post("/api/v1/project-access-requests", headers=token("owner"), json={
            "project_id": "support", "requested_role": "PROJECT_VIEWER", "reason": "Rejoin with read access only."}).json()
        approved = client.post(f"/api/v1/project-access-requests/{proposed['id']}/approve", headers=token("admin"), json={
            "expected_hash": proposed["content_hash"], "reason": "Viewer access approved."})
        assert approved.status_code == 200, approved.text
        assert client.get("/api/v1/me", headers=headers(token, "support", "owner")).json()["roles"] == ["PROJECT_VIEWER"]
        assert client.post("/api/v1/knowledge", headers=headers(token, "support", "owner"), json={
            "title": "No write access", "content": "This should fail"}).status_code == 403
