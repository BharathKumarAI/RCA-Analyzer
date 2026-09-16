"""Recorded-source fixtures exercise the real persistence and native ADK judge."""

import asyncio
from contextlib import asynccontextmanager
import json
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import ValidationError
from sqlalchemy import insert, select, update

from app.capabilities.registry import CapabilityRegistry
from app.configuration.knowledge import KnowledgeService
from app.configuration.parameters import ParameterStore, definitions
from app.connectors.base import ConnectorError
from app.models.profiles import ModelProfiles
from app.optimization.closure_tracking import ClosureJudgment, ClosureTrackingService, judgments, tracking
from app.optimization.improvement import ImprovementService
from app.optimization.improvement_models import ImprovementJob
from app.persistence.platform_admin import PlatformAdminStore, knowledge_captures, platform_alerts
from app.persistence.store import InvestigationStore, evidence, runs
from app.runtime.run_contract import content_hash
from tests.support import settings_for


class RecordedClosureModel(BaseLlm):
    result: dict
    seen: list

    async def generate_content_async(self, llm_request, stream=False):
        assert not llm_request.tools_dict, "Closure comparison must never expose tools"
        self.seen.append(str(llm_request.config.system_instruction))
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part.from_text(text=json.dumps(self.result))]))


class ClosureTrackingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings, _ = settings_for(self.directory.name, mode="live")
        self.store = InvestigationStore(self.settings.database_url.get_secret_value())
        await self.store.initialize()
        await PlatformAdminStore(self.store.engine).initialize()
        await ParameterStore(self.store.engine).initialize()
        self.knowledge = KnowledgeService(self.store.engine, self.settings)
        await self.knowledge.initialize()
        self.knowledge.scope_catalog = AsyncMock(return_value={"capability_ids": [{"id": "incident_triage"}],
            "environment_ids": [{"id": "prod"}], "connector_instance_ids": [{"id": "jira_prod"}]})
        self.author = self.settings.principals["owner"]
        self.seen = []
        self.assessment = {"status": "ASSESSED", "deviation_score": 0.8, "confidence": 0.9,
            "summary": "Recorded closure identifies a different cause.", "discrepancies": ["Original cause differs."],
            "expected_facts": ["Closure records a failed pool configuration."]}
        def factory(name, config):
            model = RecordedClosureModel(model=config.model, result=dict(self.assessment), seen=[])
            model.seen = self.seen
            return model

        optimizations = SimpleNamespace(settings=self.settings, registry=CapabilityRegistry(), model_factory=factory)
        runner = SimpleNamespace(profiles=ModelProfiles.load(), model_limiter=asyncio.Semaphore(1))
        self.improvement = ImprovementService(self.store.engine, optimizations, self.knowledge, self.store,
            runner=runner, max_capture_text_chars=40000)
        await self.improvement.initialize()
        self.service = ClosureTrackingService(self.improvement)
        self.issue = {"key": "SAMSON-101", "summary": "Pool timeouts", "description": "Observed checkout timeout",
            "status_category": "done", "resolution": "Fixed", "resolved": "2026-09-15T12:00:00Z",
            "updated": "2026-09-15T13:00:00Z", "mapped_custom_fields": {}, "components": [],
            "comments": [{"id": "17", "created": "2026-09-15T12:00:00Z", "body": "Closure records a failed pool configuration."}],
            "comments_count": 1, "comments_returned": 1, "comments_truncated": False,
            "attachments": ["PRIVATE_ATTACHMENT_MUST_NOT_APPEAR"]}
        self.provider_error = None

        @asynccontextmanager
        async def provider(principal, source, payload):
            self.assertEqual(principal, self.author)
            self.assertEqual(source, "closed_tickets")
            selection = payload.connector_selections["itsm"]
            self.assertEqual(selection.instance_id, "jira_prod")
            self.assertEqual(selection.environment_id, "prod")
            self.assertEqual(payload.source_capabilities, {"closed_tickets": "incident_triage"})
            yield SimpleNamespace(get_ticket=AsyncMock(return_value=dict(self.issue), side_effect=self.provider_error)), selection

        self.service.capture.provider = provider

    async def asyncTearDown(self):
        await self.improvement.aclose()
        await self.store.aclose()
        self.directory.cleanup()

    async def recorded(self, identifier="run-one", *, mode="live", selection=True, old=False, evidence_valid=True):
        now = time.time() - (400 * 86400 if old else 1)
        snapshot = {"knowledge_scope": {"connector_selections": {"itsm": {"instance_id": "jira_prod", "environment_id": "prod"}}}} if selection else {}
        contract = {"mode": mode, "capability": "incident_triage", "request": {"text": "PRIVATE_CHAT_PROMPT", "attachment_ids": ["PRIVATE_ATTACHMENT"]},
            "model_config_json": json.dumps(snapshot)}
        content = {"key": "SAMSON-101", "summary": "Pool timeouts", "description": "Observed timeout"}
        bundle = {"evidence_id": "ev-" + identifier, "run_id": identifier, "tenant_id": self.author.tenant_id,
            "project_id": self.author.project_id, "source": {"connector": "itsm", "system": "get_ticket"},
            "query_json": json.dumps({"ticket_id": "SAMSON-101"}), "observed_at": "2026-09-15T12:00:00Z",
            "content_json": json.dumps(content), "content_hash": content_hash(content)}
        async with self.store.engine.begin() as connection:
            await connection.execute(insert(runs).values(run_id=identifier, tenant_id=self.author.tenant_id,
                project_id=self.author.project_id, subject=self.author.subject, request_hash=identifier,
                contract_json=json.dumps(contract), snapshot_hash=content_hash(contract), deadline=now + 30,
                status="SUCCEEDED", stage="completed", result_json=json.dumps({"outcome": "FINDINGS", "summary": "Original investigation recorded a network issue."}),
                evidence_count=1, revision=1, created_at=now, updated_at=now))
            await connection.execute(insert(evidence).values(evidence_id=bundle["evidence_id"], run_id=identifier,
                tenant_id=self.author.tenant_id, project_id=self.author.project_id, bundle_json=json.dumps(bundle),
                content_hash=bundle["content_hash"] if evidence_valid else "mismatch"))

    async def run_watch(self, **kwargs):
        return await self.service.execute(ImprovementJob(kind="track_closures", **kwargs), self.author)

    async def test_changed_closure_reopen_and_immutable_assessment_dedup(self):
        await self.recorded()
        result = await self.run_watch()
        self.assertEqual((result["discovered"], result["checked"], result["failed"]), (1, 1, 0))
        dashboard = await self.service.dashboard(self.author)
        row = dashboard["items"][0]
        self.assertEqual(dashboard["metrics"], {"tracked": 1, "open": 0, "closed": 1, "assessed": 1,
            "insufficient": 0, "errors": 0, "pending": 0, "mean_deviation": 0.8, "coverage": 1.0, "alerts": 1})
        await self.run_watch()
        self.assertEqual(len(self.seen), 1, "Unchanged source and judge context reuse the immutable assessment")
        self.issue["description"] = "Updated closure: failed pool configuration confirmed"
        self.issue["updated"] = "2026-09-16T13:00:00Z"
        await self.run_watch()
        history = await self.service.detail(self.author, row["tracking_id"])
        self.assertEqual(len(history["judgments"]), 2)
        self.assertNotEqual(history["judgments"][0]["closure_hash"], history["judgments"][1]["closure_hash"])
        self.assertEqual(history["original"]["result"]["summary"], "Original investigation recorded a network issue.")
        self.assertEqual(history["original"]["result_hash"], content_hash(history["original"]["result"]))
        self.assertNotIn("PRIVATE_CHAT_PROMPT", json.dumps(history))
        self.assertNotIn("PRIVATE_ATTACHMENT", json.dumps(history))
        async with self.store.engine.connect() as connection:
            alerts = (await connection.execute(select(platform_alerts))).mappings().all()
            captures = (await connection.execute(select(knowledge_captures))).mappings().all()
        self.assertEqual(len(alerts), 2)
        self.assertEqual(len(captures), 2)
        self.assertNotIn("Original investigation", json.dumps([dict(item) for item in alerts]))
        self.issue.update(status_category="indeterminate", updated="2026-09-17T13:00:00Z")
        await self.run_watch()
        reopened = (await self.service.dashboard(self.author))["items"][0]
        self.assertEqual(reopened["status"], "OPEN")
        self.assertIsNone(reopened["latest_judgment"])
        self.assertEqual(len((await self.service.detail(self.author, row["tracking_id"]))["judgments"]), 2)
        async with self.store.engine.connect() as connection:
            captures = (await connection.execute(select(knowledge_captures))).mappings().all()
        self.assertTrue(all(item["unavailable_at"] is not None for item in captures))
        async with self.store.engine.connect() as connection:
            alerts = (await connection.execute(select(platform_alerts))).mappings().all()
        self.assertTrue(all(item["status"] == "resolved" for item in alerts))
        # An older response arriving after reopening cannot restore the prior assessment.
        self.issue.update(status_category="done", updated="2026-09-16T13:00:00Z")
        await self.run_watch()
        self.assertEqual((await self.service.dashboard(self.author))["items"][0]["status"], "OPEN")

    async def test_insufficient_and_failed_judge_are_not_agreement(self):
        await self.recorded()
        self.assessment.update(status="INSUFFICIENT_CLOSURE_EVIDENCE", deviation_score=None, confidence=0.2,
            expected_facts=[], discrepancies=[], summary="Only a generic Fixed label is available.")
        self.issue.update(comments=[], comments_count=0, comments_returned=0)
        await self.run_watch()
        metrics = (await self.service.dashboard(self.author))["metrics"]
        self.assertEqual((metrics["insufficient"], metrics["assessed"], metrics["alerts"]), (1, 0, 0))
        self.assertIsNone(metrics["mean_deviation"])
        self.issue.update(description="Different recorded closure", updated="2026-09-16T13:00:00Z")
        self.service.judge = AsyncMock(side_effect=TimeoutError("model unavailable"))
        result = await self.run_watch()
        self.assertEqual(result["failed"], 1)
        metrics = (await self.service.dashboard(self.author))["metrics"]
        self.assertEqual((metrics["closed"], metrics["pending"], metrics["errors"], metrics["insufficient"]), (1, 1, 1, 0))
        self.assertIsNone(metrics["mean_deviation"])

    async def test_discovery_bounds_permissions_and_continued_tracking(self):
        await self.recorded("eligible")
        await self.recorded("old", old=True)
        await self.recorded("demo", mode="demo")
        await self.recorded("legacy", selection=False)
        await self.recorded("tampered", evidence_valid=False)
        state = None
        pages = 0
        while state is None or state["status"] != "COMPLETE":
            state = await self.service.execute(ImprovementJob(kind="track_closures", limit=1), self.author, state)
            pages += 1
            self.assertLess(pages, 10)
        self.assertEqual(state["discovered"], 1)
        self.assertGreater(pages, 1)
        async with self.store.engine.begin() as connection:
            await connection.execute(update(runs).values(created_at=time.time() - 400 * 86400))
        self.issue.update(status_category="indeterminate", updated="2026-09-18T13:00:00Z")
        self.assertEqual((await self.run_watch())["checked"], 1, "Tracking survives discovery lookback expiry")
        other = self.author.model_copy(update={"project_id": "elsewhere"})
        self.assertEqual((await self.service.dashboard(other))["metrics"]["tracked"], 0)
        with self.assertRaises(PermissionError):
            await self.service.dashboard(self.settings.principals["viewer"])
        with self.assertRaises(PermissionError):
            await self.service.execute(ImprovementJob(kind="track_closures"), self.settings.principals["viewer"])

    async def test_current_judge_context_reassesses_without_duplicate_capture(self):
        await self.recorded()
        self.assessment["confidence"] = 0.5
        await self.run_watch()
        async with self.store.engine.begin() as connection:
            await connection.execute(update(definitions).where(definitions.c.tool == "knowledge",
                definitions.c.variable_name == "closure_judge_instruction").values(default_value="Compare only recorded closure facts; return schema JSON."))
        await self.run_watch()
        async with self.store.engine.connect() as connection:
            saved = (await connection.execute(select(judgments))).mappings().all()
            captures = (await connection.execute(select(knowledge_captures))).mappings().all()
        self.assertEqual(len(saved), 2)
        self.assertNotEqual(saved[0]["context_hash"], saved[1]["context_hash"])
        self.assertEqual(len(captures), 1)
        self.assertEqual((await self.service.dashboard(self.author))["metrics"]["alerts"], 0)
        self.assertTrue(all(json.loads(item["usage_json"])["model_calls"] == 1 for item in saved))

    async def test_inflight_judgment_cannot_alert_or_replace_a_newer_reopen(self):
        await self.recorded()
        original = self.service.judge

        async def reopened_during_judge(principal, row, closure, configuration, remaining):
            async with self.store.engine.begin() as connection:
                await connection.execute(update(tracking).where(tracking.c.tracking_id == row["tracking_id"])
                    .values(status="OPEN", source_modified_at=row["source_modified_at"] + 1,
                        closure_hash=None, latest_judgment_id=None, closed_at=None))
            return await original(principal, row, closure, configuration, remaining)

        self.service.judge = reopened_during_judge
        await self.run_watch()
        dashboard = await self.service.dashboard(self.author)
        self.assertEqual((dashboard["metrics"]["open"], dashboard["metrics"]["alerts"]), (1, 0))
        self.assertIsNone(dashboard["items"][0]["latest_judgment"])
        self.assertEqual(len((await self.service.detail(self.author, dashboard["items"][0]["tracking_id"]))["judgments"]), 1)

    async def test_new_context_retires_previous_alert_and_missing_source_degrades_metrics(self):
        await self.recorded()
        await self.run_watch()
        self.assessment["deviation_score"] = 0.1
        async with self.store.engine.begin() as connection:
            await connection.execute(update(definitions).where(definitions.c.tool == "knowledge",
                definitions.c.variable_name == "closure_judge_instruction").values(default_value="Updated comparison criteria, recorded facts only."))
        await self.run_watch()
        async with self.store.engine.connect() as connection:
            alerts = (await connection.execute(select(platform_alerts))).mappings().all()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["status"], "resolved")
        self.assertEqual((await self.service.dashboard(self.author))["metrics"]["mean_deviation"], 0.1)
        self.provider_error = ConnectorError("Jira issue request failed with HTTP 404", status_code=404)
        self.assertEqual((await self.run_watch())["failed"], 1)
        dashboard = await self.service.dashboard(self.author)
        self.assertEqual((dashboard["metrics"]["pending"], dashboard["metrics"]["errors"]), (1, 1))
        self.assertIsNone(dashboard["metrics"]["mean_deviation"])
        async with self.store.engine.connect() as connection:
            captures = (await connection.execute(select(knowledge_captures))).mappings().all()
        self.assertTrue(all(item["unavailable_at"] is not None for item in captures))

    def test_score_contract_rejects_false_zero_and_unbounded_facts(self):
        for changes in ({"status": "INSUFFICIENT_CLOSURE_EVIDENCE"}, {"deviation_score": None},
                        {"expected_facts": []}, {"confidence": float("nan")}, {"deviation_score": 1.1}):
            with self.assertRaises(ValidationError):
                ClosureJudgment.model_validate(self.assessment | changes)
