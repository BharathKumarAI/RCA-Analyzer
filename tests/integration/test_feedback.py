"""Real run feedback survives restart, redacts notes, and enforces ownership/CAS."""

import asyncio
import time

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.persistence.feedback import feedback
from app.persistence.store import runs

from app.api.application import create_app
from tests.support import connectors, model_factory, settings_for


def test_feedback_is_owned_versioned_persisted_and_measured(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    def application():
        return create_app(settings, connectors=connectors(), model_factory=model_factory)
    with TestClient(application()) as client:
        run = client.post("/api/v1/runs", headers=token(), json={
            "capability": "ticket_review", "prompt": "Explain the impact of SAMSON-101 briefly.",
        })
        assert run.status_code == 200 and run.json()["status"] == "SUCCEEDED", run.text
        path = f"/api/v1/runs/{run.json()['run_id']}/feedback"
        assert client.get(path, headers=token()).json() is None
        payload = {"rating": "helpful", "note": "Useful, remove token=private-test-key from evidence.", "expected_revision": 0}
        assert client.put(path, json=payload).status_code == 401
        assert client.put(path, headers=token("admin"), json=payload).status_code == 404
        assert client.get(path, headers=token("admin")).status_code == 404
        assert client.put(path, headers=token(), json=payload | {"roles": ["PLATFORM_ADMIN"]}).status_code == 422
        saved = client.put(path, headers=token(), json=payload)
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1 and saved.json()["rating"] == "helpful"
        assert "private-test-key" not in saved.text and "[REDACTED]" in saved.json()["note"]
        assert client.put(path, headers=token(), json=payload).status_code == 409
        report = client.get("/api/v1/telemetry", headers=token()).json()
        assert report["feedback"] == {"helpful": 1, "needs_work": 0, "reviewed_runs": 1, "unreviewed_runs": 0}
        updated = client.put(path, headers=token(), json={"rating": "needs_work", "note": "Needs a clearer next step.", "expected_revision": 1})
        assert updated.status_code == 200 and updated.json()["revision"] == 2
        report = client.get("/api/v1/telemetry?capability=attachment_review", headers=token()).json()
        assert report["feedback"]["reviewed_runs"] == 0
        assert client.put(path, headers=token(), json={"rating": "unknown"}).status_code == 422
        assert client.put(path, headers=token(), json={"rating": "helpful", "note": "x" * 2001}).status_code == 422
    with TestClient(application()) as client:
        restored = client.get(path, headers=token()).json()
        assert restored["rating"] == "needs_work" and restored["revision"] == 2
        report = client.get("/api/v1/telemetry", headers=token()).json()
        assert report["feedback"]["helpful"] == 0 and report["feedback"]["needs_work"] == 1

        async def expire_run():
            async with client.app.state.store.engine.begin() as connection:
                await connection.execute(update(runs).where(runs.c.run_id == restored["run_id"]).values(updated_at=time.time() - 90000))
            await client.app.state.store.delete_expired(86400)
            async with client.app.state.store.engine.connect() as connection:
                return await connection.scalar(select(feedback.c.run_id).where(feedback.c.run_id == restored["run_id"]))
        assert asyncio.run(expire_run()) is None
