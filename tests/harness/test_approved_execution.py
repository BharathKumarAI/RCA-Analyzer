"""Approved YAML is loaded into actual ADK execution, then removed on revocation."""

import tempfile
import unittest
from fastapi.testclient import TestClient
from app.fast_api_app import create_app
from tests.support import connectors, model_factory, settings_for

SOURCE = """id: timeout_specialist
version: 1.0.0
name: Timeout specialist
description: Inspect timeout evidence when relevant.
instruction: Assess the captured timeout evidence without inventing facts.
capability: incident_triage
model_profile: fast-investigation
stage_model: synthesis
tools: []
"""


class ApprovedExecutionTests(unittest.TestCase):
    def test_approved_only_delegation_profile_selection_and_revocation(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            stages = []

            def factory(stage, config):
                stages.append((stage, config.model))
                return model_factory(stage, config)

            with TestClient(
                create_app(settings, connectors=connectors(), model_factory=factory)
            ) as client:
                draft_response = client.post(
                    "/api/v1/agent-configurations",
                    headers=token("owner"),
                    json={"yaml": SOURCE},
                )
                self.assertEqual(draft_response.status_code, 201, draft_response.text)
                draft = draft_response.json()

                def run():
                    stages.clear()
                    response = client.post(
                        "/api/v1/runs",
                        headers=token(),
                        json={
                            "prompt": "Investigate timeouts",
                            "incident_id": "SAMSON-101",
                        },
                    )
                    self.assertEqual(
                        response.json()["status"], "SUCCEEDED", response.text
                    )
                    return response.json()

                run()
                self.assertNotIn("specialist", [s for s, _ in stages])
                review = {
                    "expected_hash": draft["content_hash"],
                    "reason": "Reviewed scope, instructions and allowed tools",
                }
                approved = client.post(
                    f"/api/v1/agent-configurations/{draft['draft_id']}/approve",
                    headers=token("admin"),
                    json=review,
                )
                self.assertEqual(approved.status_code, 200, approved.text)
                run()
                self.assertIn(("specialist", "gemini-3.5-flash-lite"), stages)
                self.assertIn("router", [s for s, _ in stages])
                revoked = client.post(
                    f"/api/v1/agent-configurations/{draft['draft_id']}/revoke",
                    headers=token("admin"),
                    json={"reason": "Retired"},
                )
                self.assertEqual(revoked.status_code, 200, revoked.text)
                run()
                self.assertNotIn("specialist", [s for s, _ in stages])

    def test_parallel_attachment_branch_captures_citable_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory, mode="live")
            stages = []

            def factory(stage, config):
                stages.append(stage)
                return model_factory(stage, config)

            with TestClient(
                create_app(settings, connectors=connectors(), model_factory=factory)
            ) as client:
                upload = client.post(
                    "/api/v1/files",
                    headers=token(),
                    files=[
                        (
                            "files",
                            (
                                "incident.txt",
                                b"Timeout began at 10:15 UTC",
                                "text/plain",
                            ),
                        )
                    ],
                )
                self.assertEqual(upload.status_code, 201, upload.text)
                aid = upload.json()["attachments"][0]["attachment_id"]
                response = client.post(
                    "/api/v1/runs",
                    headers=token(),
                    json={
                        "prompt": "Investigate timeouts",
                        "incident_id": "SAMSON-101",
                        "attachment_ids": [aid],
                    },
                )
                result = response.json()
                self.assertEqual(result["status"], "SUCCEEDED", response.text)
                self.assertEqual(result["evidence_count"], 3)
                self.assertIn("extraction", stages)
                evidence = client.get(
                    f"/api/v1/runs/{result['run_id']}/evidence", headers=token()
                ).json()
                self.assertIn(
                    "attachments", [e["source"]["connector"] for e in evidence]
                )
                self.assertEqual(
                    len(result["result"]["findings"][0]["evidence_ids"]), 3
                )
