"""Run budgets and cancellation stop actual ADK execution."""

import asyncio
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from app.fast_api_app import create_app
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
                    headers=token(),
                    json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
                )
                deadline = time.monotonic() + 3
                active = []
                while not active and time.monotonic() < deadline:
                    active = client.get("/api/v1/runs", headers=token()).json()
                    time.sleep(0.02)
                self.assertTrue(active)
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
