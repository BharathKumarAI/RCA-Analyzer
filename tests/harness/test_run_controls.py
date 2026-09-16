"""Run budgets and cancellation stop actual ADK execution."""

import asyncio
import json
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.fast_api_app import create_app
from app.runtime.run_contract import RunRequest
from tests.support import FixtureModel, connectors, settings_for


class SlowModel(FixtureModel):
    async def generate_content_async(self, llm_request, stream=False):
        await asyncio.sleep(5)
        async for response in super().generate_content_async(llm_request, stream):
            yield response


def slow_factory(stage, config):
    return SlowModel(model=config.model, stage=stage)


class RunControlsTests(unittest.TestCase):
    def test_timeout_is_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            settings = settings.model_copy(update={"run_timeout_seconds": 1})
            with TestClient(
                create_app(
                    settings, connectors=connectors(), model_factory=slow_factory
                )
            ) as client:
                response = client.post(
                    "/api/v1/runs",
                    headers=token(),
                    json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
                )
                self.assertEqual(response.json()["status"], "FAILED", response.text)
                self.assertIsNone(response.json()["result"])

    def test_capacity_and_cancellation(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            settings = settings.model_copy(update={"max_concurrent_runs": 1})
            with (
                TestClient(
                    create_app(
                        settings, connectors=connectors(), model_factory=slow_factory
                    )
                ) as client,
                ThreadPoolExecutor(max_workers=1) as pool,
            ):
                pending = pool.submit(
                    client.post,
                    "/api/v1/runs",
                    headers={**token(), "Idempotency-Key": "active-investigation"},
                    json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
                )
                deadline = time.monotonic() + 3
                active = []
                while not active and time.monotonic() < deadline:
                    active = client.get("/api/v1/runs", headers=token()).json()
                    time.sleep(0.02)
                self.assertTrue(active)
                replay = client.post(
                    "/api/v1/runs",
                    headers={**token(), "Idempotency-Key": "active-investigation"},
                    json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
                )
                self.assertEqual(replay.status_code, 200, replay.text)
                self.assertEqual(replay.json()["run_id"], active[0]["run_id"])
                conflict = client.post(
                    "/api/v1/runs",
                    headers={**token(), "Idempotency-Key": "active-investigation"},
                    json={"prompt": "Changed investigation"},
                )
                self.assertEqual(conflict.status_code, 409, conflict.text)
                rejected = client.post(
                    "/api/v1/runs", headers=token(), json={"prompt": "Another run"}
                )
                self.assertEqual(rejected.status_code, 429)
                cancelled = client.post(
                    f"/api/v1/runs/{active[0]['run_id']}/cancel", headers=token()
                )
                self.assertEqual(cancelled.json()["status"], "CANCELLED")
                self.assertEqual(
                    pending.result(timeout=3).json()["status"], "CANCELLED"
                )

    def test_cancel_during_creation_callback_finalizes_saved_run(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, _ = settings_for(directory)
            with TestClient(create_app(settings, connectors=connectors())) as client:
                runner = client.app.state.runner

                async def cancel_on_created(_response):
                    raise asyncio.CancelledError()

                response = client.portal.call(
                    runner.execute, settings.principals["analyst"], RunRequest(text="Investigate"),
                    "incident_triage", None, cancel_on_created,
                )
                self.assertEqual(response.status, "CANCELLED")
                self.assertFalse(runner.tasks)
                self.assertEqual(runner.run_limiter._value, runner._run_limit)

    def test_connector_selection_reaches_resolution_and_persisted_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            with TestClient(create_app(settings, connectors=connectors())) as client:
                runner = client.app.state.runner
                selected = {"itsm": {"instance_id": "jira_prod", "environment_id": "prod"}}
                with patch.object(runner, "_connectors_for_run", wraps=runner._connectors_for_run) as resolve:
                    response = client.post("/api/v1/runs", headers=token(), json={
                        "prompt": "Investigate", "connector_selections": selected,
                    })
                self.assertEqual(response.status_code, 200, response.text)
                actual = resolve.await_args.args[3]
                self.assertEqual({key: value.model_dump() for key, value in actual.items()}, selected)
                with sqlite3.connect(f"{directory}/runs.db") as connection:
                    saved = connection.execute("SELECT contract_json FROM runs WHERE run_id = ?",
                                               (response.json()["run_id"],)).fetchone()[0]
                self.assertEqual(json.loads(saved)["request"]["connector_selections"], selected)
