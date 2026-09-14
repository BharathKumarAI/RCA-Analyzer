"""Regression checks exercise the public API and actual native ADK runner offline."""

import tempfile
import unittest

from fastapi.testclient import TestClient

from app.fast_api_app import create_app
from tests.support import FixtureModel, connectors, model_factory, settings_for


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings, self.token = settings_for(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_authentication_and_role_injection(self):
        with TestClient(create_app(self.settings)) as client:
            self.assertEqual(
                client.post("/api/v1/runs", json={"prompt": "DNS?"}).status_code, 401
            )
            self.assertEqual(
                client.post(
                    "/api/v1/runs",
                    headers=self.token(),
                    json={"prompt": "DNS?", "roles": ["PLATFORM_ADMIN"]},
                ).status_code,
                422,
            )
            self.assertEqual(
                client.post(
                    "/api/v1/knowledge",
                    headers=self.token("viewer"),
                    json={"prompt": "DNS?"},
                ).status_code,
                403,
            )
            self.assertEqual(
                client.get("/api/v1/me", headers=self.token(exp=1)).status_code, 401
            )
            # Token-provided administrator roles cannot change server membership.
            self.assertEqual(
                client.post(
                    "/api/v1/knowledge",
                    headers=self.token("viewer", roles=["PLATFORM_ADMIN"]),
                    json={"prompt": "DNS?"},
                ).status_code,
                403,
            )

    def test_demo_is_explicit_and_idempotent(self):
        with TestClient(create_app(self.settings)) as client:
            headers = self.token() | {"Idempotency-Key": "request-1"}
            response = client.post(
                "/api/v1/runs", headers=headers, json={"prompt": "DNS?"}
            )
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual(result["status"], "SIMULATED")
            self.assertIsNone(result["result"])
            again = client.post(
                "/api/v1/runs", headers=headers, json={"prompt": "DNS?"}
            )
            self.assertEqual(again.json()["run_id"], result["run_id"])
            self.assertEqual(
                client.post(
                    "/api/v1/runs", headers=headers, json={"prompt": "different"}
                ).status_code,
                409,
            )
            events = client.get(
                f"/api/v1/runs/{result['run_id']}/events", headers=self.token()
            )
            self.assertIn("event: progress", events.text)

    def test_real_adk_fixture_pipeline_and_redacted_evidence(self):
        live = self.settings.model_copy(update={"mode": "live"})
        with TestClient(
            create_app(live, connectors=connectors(), model_factory=model_factory)
        ) as client:
            response = client.post(
                "/api/v1/runs",
                headers=self.token(),
                json={"prompt": "Investigate timeouts", "incident_id": "SAMSON-101"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual(result["status"], "SUCCEEDED", result)
            self.assertEqual(result["evidence_count"], 2)
            evidence = client.get(
                f"/api/v1/runs/{result['run_id']}/evidence", headers=self.token()
            ).json()
            ids = {item["evidence_id"] for item in evidence}
            self.assertTrue(
                set(result["result"]["findings"][0]["evidence_ids"]).issubset(ids)
            )
            self.assertNotIn("secret-value", str(evidence))
            self.assertNotIn("person@example.com", str(evidence))
            self.assertNotIn("SECRET-TOKEN", str(evidence))

    def test_bad_citation_fails_closed(self):
        live = self.settings.model_copy(update={"mode": "live"})

        def invalid(stage, config):
            return FixtureModel(model=config.model, stage=stage, invalid_citation=True)

        with TestClient(
            create_app(live, connectors=connectors(), model_factory=invalid)
        ) as client:
            response = client.post(
                "/api/v1/runs",
                headers=self.token(),
                json={"prompt": "Timeouts?", "incident_id": "SAMSON-101"},
            )
            self.assertEqual(response.json()["status"], "FAILED", response.text)
            self.assertIsNone(response.json()["result"])

    def test_live_unconfigured_is_blocked(self):
        live = self.settings.model_copy(update={"mode": "live"})
        with TestClient(
            create_app(live, connectors={}, model_factory=model_factory)
        ) as client:
            result = client.post(
                "/api/v1/runs", headers=self.token(), json={"prompt": "Timeouts?"}
            )
            self.assertEqual(result.json()["status"], "BLOCKED")

    def test_attachment_upload_is_scoped(self):
        with TestClient(create_app(self.settings)) as client:
            upload = client.post(
                "/api/v1/files",
                headers=self.token(),
                files=[
                    (
                        "files",
                        ("incident.txt", b"timeout password=hidden", "text/plain"),
                    )
                ],
            )
            self.assertEqual(upload.status_code, 201, upload.text)
            aid = upload.json()["attachments"][0]["attachment_id"]
            denied = client.post(
                "/api/v1/runs",
                headers=self.token("owner"),
                json={"prompt": "Investigate", "attachment_ids": [aid]},
            )
            self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
