import asyncio
import json
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from tests.support import FixtureModel, connectors, model_factory, settings_for


class SlowModel(FixtureModel):
    async def generate_content_async(self, llm_request, stream=False):
        await asyncio.sleep(5)
        async for response in super().generate_content_async(llm_request, stream):
            yield response


def slow_factory(stage, config):
    return SlowModel(model=config.model, stage=stage)


class RunTraceIntegrationTests(unittest.TestCase):
    def test_stream_persists_graph_and_tool_durations(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            with TestClient(
                create_app(settings, connectors=connectors(), model_factory=model_factory)
            ) as client:
                response = client.post(
                    "/api/v1/runs?stream=true",
                    headers=token(),
                    json={"prompt": "Investigate", "incident_id": "SAMSON-101"},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIn("event: run", response.text)
                self.assertIn("event: trace", response.text)
                self.assertIn("event: complete", response.text)
                run_id = next(
                    json.loads(line[6:])["run_id"]
                    for line in response.text.splitlines()
                    if line.startswith('data: {"run_id"')
                )

                trace = client.get(
                    f"/api/v1/runs/{run_id}/trace", headers=token()
                )
                self.assertEqual(trace.status_code, 200, trace.text)
                payload = trace.json()
                self.assertTrue(payload["graph"]["nodes"])
                node_ids = {node["id"] for node in payload["graph"]["nodes"]}
                self.assertIn("request_orchestrator", node_ids)
                self.assertEqual(
                    [event["sequence"] for event in payload["events"]],
                    sorted(event["sequence"] for event in payload["events"]),
                )
                completed_tools = [
                    event
                    for event in payload["events"]
                    if event["kind"] == "tool_completed"
                ]
                self.assertTrue(completed_tools)
                self.assertTrue(all(event["node_id"] in node_ids for event in completed_tools))
                self.assertIn("tool:itsm.get_ticket", node_ids)
                self.assertIn("model:balanced-investigation", node_ids)
                self.assertNotIn("tool:get_ticket", node_ids)
                completed_agents = [event for event in payload["events"] if event["kind"] == "completed"]
                self.assertTrue(completed_agents, payload["events"])
                self.assertTrue(all(event["details"]["duration_ms"] >= 0 for event in completed_agents))
                self.assertTrue(
                    all(event["details"]["duration_ms"] >= 0 for event in completed_tools)
                )

    def test_cancelled_request_leaves_scoped_trace_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            with (
                TestClient(
                    create_app(settings, connectors=connectors(), model_factory=slow_factory)
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
                run_id = active[0]["run_id"]
                cancelled = client.post(
                    f"/api/v1/runs/{run_id}/cancel", headers=token()
                )
                self.assertEqual(cancelled.status_code, 200)
                self.assertEqual(cancelled.json()["status"], "CANCELLED")
                result = pending.result(timeout=3)
                self.assertEqual(result.json()["status"], "CANCELLED")
                trace = client.get(f"/api/v1/runs/{run_id}/trace", headers=token())
                self.assertEqual(trace.status_code, 200)
                self.assertIsInstance(trace.json()["events"], list)


if __name__ == "__main__":
    unittest.main()
