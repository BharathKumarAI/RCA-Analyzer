"""Real API/store contract for governed jobs; test models stay verification-only."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import update

from app.api.application import create_app
from tests.support import connectors, model_factory, settings_for
from app.optimization.improvement import ImprovementService, jobs


def test_improvement_job_controls_schedule_revision_and_access(tmp_path):
    settings, token = settings_for(tmp_path)
    with patch("app.optimization.improvement.ImprovementService.start"), TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.get("/api/v1/improvement/jobs", headers=token("viewer")).status_code == 403
        body = {"kind": "prepare_feedback", "limit": 10}
        headers = token("owner") | {"Idempotency-Key": "prepare-once"}
        created = client.post("/api/v1/improvement/jobs", headers=headers, json=body)
        assert created.status_code == 202, created.text
        job = created.json()
        assert client.post("/api/v1/improvement/jobs", headers=headers, json=body).json()["job_id"] == job["job_id"]
        assert client.post("/api/v1/improvement/jobs", headers=headers, json=body | {"limit": 1}).status_code == 409
        assert client.post(f"/api/v1/improvement/jobs/{job['job_id']}/retry", headers=token("owner")).status_code == 409
        stopped = client.post(f"/api/v1/improvement/jobs/{job['job_id']}/cancel", headers=token("owner"))
        assert stopped.json()["status"] == "CANCELLED"
        assert stopped.json()["history"][0]["action"] == "cancel"
        assert client.post(f"/api/v1/improvement/jobs/{job['job_id']}/retry", headers=token("owner")).json()["status"] == "QUEUED"
        schedule_body = {"name": "Prepare reviewed incident signals", "interval_seconds": 300, "job": body}
        schedule = client.post("/api/v1/improvement/schedules", headers=token("owner"), json=schedule_body)
        assert schedule.status_code == 201, schedule.text
        url = f"/api/v1/improvement/schedules/{schedule.json()['schedule_id']}"
        assert client.put(url, headers=token("owner"), json=schedule_body | {"enabled": False, "expected_revision": 1}).json()["revision"] == 2
        assert client.put(url, headers=token("owner"), json=schedule_body | {"expected_revision": 1}).status_code == 409
        assert client.post("/api/v1/improvement/jobs", headers=token("owner"), json={"kind": "optimize"}).status_code == 422


def test_recorded_feedback_to_verified_candidate_to_unapproved_knowledge(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with patch("app.optimization.improvement.ImprovementService.start"), TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        run = client.post("/api/v1/runs", headers=token("owner"), json={"capability": "incident_triage", "prompt": "Investigate SAMSON-101", "incident_id": "SAMSON-101"})
        assert run.status_code == 200, run.text
        run_id = run.json()["run_id"]
        feedback = client.put(f"/api/v1/runs/{run_id}/feedback", headers=token("owner"), json={"rating": "needs_work", "note": "The timeout needs source verification", "expected_revision": 0})
        assert feedback.status_code == 200, feedback.text
        job = client.post("/api/v1/improvement/jobs", headers=token("owner"), json={"kind": "prepare_feedback"}).json()
        assert client.portal.call(client.app.state.improvement.run_once)
        completed = client.get(f"/api/v1/improvement/jobs/{job['job_id']}", headers=token("owner")).json()
        assert completed["status"] == "SUCCEEDED", completed
        identifier = completed["result"]["candidate_ids"][0]
        summaries = client.get("/api/v1/improvement/candidates", headers=token("owner")).json()
        assert summaries[0]["incident_id"] == "SAMSON-101"
        assert "payload" not in summaries[0] and "verification" not in summaries[0]
        detail = client.get(f"/api/v1/improvement/candidates/{identifier}", headers=token("owner")).json()
        assert detail["payload"]["evidence"] and "verification" in detail
        review = {"expected_revision": 1, "expected_outcome": "FINDINGS", "expected_facts": ["Recorded observations contain timeout errors; causality is unconfirmed."], "reason": "Independently checked source evidence"}
        path = f"/api/v1/improvement/candidates/{identifier}"
        assert client.post(path + "/verify", headers=token("owner"), json=review).status_code == 403
        verified = client.post(path + "/verify", headers=token("admin"), json=review)
        assert verified.status_code == 200, verified.text
        assert verified.json()["status"] == "VERIFIED"
        drafted = client.post(path + "/knowledge", headers=token("owner"), json={"expected_revision": 2, "title": "Timeout observations"})
        assert drafted.status_code == 201, drafted.text
        assert drafted.json()["status"] == "draft"
        assert client.get("/api/v1/knowledge", headers=token("viewer")).json() == []


def test_worker_leases_correct_project_rechecks_membership_and_recovers_after_restart(tmp_path):
    settings, token = settings_for(tmp_path)
    selected = token("admin") | {"X-RCA-Project": "support"}
    owner = token("owner") | {"X-RCA-Project": "support"}
    original_prepare = ImprovementService.prepare
    observed = []
    app = create_app(settings, connectors=connectors())

    async def observe(service, payload, principal):
        observed.append(principal.project_id)
        assert service.optimizations is app.state.project_runtimes.entries["support"].app.state.optimizations
        assert app.state.project_runtimes.entries["support"].references == 1
        return await original_prepare(service, payload, principal)

    with patch.object(ImprovementService, "start"), TestClient(app) as client:
        created = client.post("/api/v1/projects", headers=token("admin"), json={"project_id": "support", "name": "Support"})
        assert created.status_code == 201, created.text
        added = client.post("/api/v1/users", headers=selected, json={"id": "owner", "name": "Owner", "roles": ["PROJECT_OWNER"], "status": "active"})
        assert added.status_code == 200, added.text
        child_job = client.post("/api/v1/improvement/jobs", headers=owner, json={"kind": "prepare_feedback"}).json()
        assert client.get("/api/v1/improvement/jobs", headers=token("admin") | {"X-RCA-Project": "payments"}).json() == []
        with patch.object(ImprovementService, "prepare", new=observe):
            assert client.portal.call(app.state.improvement.run_once)
        assert observed == ["support"]
        assert app.state.project_runtimes.entries["support"].references == 0
        assert client.get(f"/api/v1/improvement/jobs/{child_job['job_id']}", headers=selected).json()["status"] == "SUCCEEDED"

        revoked_job = client.post("/api/v1/improvement/jobs", headers=owner, json={"kind": "prepare_feedback"}).json()
        revoked = client.put("/api/v1/users/owner", headers=selected, json={"name": "Owner", "roles": ["PROJECT_OWNER"], "status": "inactive"})
        assert revoked.status_code == 200, revoked.text
        assert client.portal.call(app.state.improvement.run_once)
        assert client.get(f"/api/v1/improvement/jobs/{revoked_job['job_id']}", headers=selected).json()["status"] == "FAILED"

        interrupted = client.post("/api/v1/improvement/jobs", headers=selected, json={"kind": "prepare_feedback"}).json()
        assert client.portal.call(app.state.improvement.claim)["job_id"] == interrupted["job_id"]

        async def expire_lease():
            async with app.state.store.engine.begin() as connection:
                await connection.execute(update(jobs).where(jobs.c.job_id == interrupted["job_id"]).values(lease_until=0))

        client.portal.call(expire_lease)
    with patch.object(ImprovementService, "start"), TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.portal.call(client.app.state.improvement.run_once)
        recovered = client.get(f"/api/v1/improvement/jobs/{interrupted['job_id']}", headers=selected).json()
        assert recovered["status"] == "SUCCEEDED", recovered
        assert recovered["attempts"] == 2
        assert any(event["action"] == "recover" for event in recovered["history"])
        assert client.app.state.project_runtimes.entries["support"].references == 0
