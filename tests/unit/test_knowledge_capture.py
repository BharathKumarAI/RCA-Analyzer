"""Recorded-source fixtures test capture boundaries; never runtime fallback content."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

import httpx2
from pydantic import ValidationError
from sqlalchemy import insert, update

from app.capabilities.registry import CapabilityRegistry
from app.configuration.knowledge import KnowledgeInput, KnowledgeReview, KnowledgeService
from app.configuration.parameters import ParameterStore
from app.connectors.base import ConnectorError
from app.connectors.providers.evidence import ConfluenceConnector
from app.connectors.providers.jira import JiraConnector
from app.optimization.improvement import ImprovementService, candidates, jobs, metadata
from app.optimization.improvement_models import ImprovementJob, KnowledgeCaptureRequest
from app.optimization.knowledge_capture import KnowledgeCaptureService, capture_window, feedback_capture_hash, storage_text
from app.persistence.database import initialize_tables
from app.persistence.platform_admin import PlatformAdminStore
from app.persistence.triage import TriageStore
from app.persistence.store import InvestigationStore
from app.runtime.run_contract import ConnectorSelection
from tests.support import settings_for


class KnowledgeCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings, _ = settings_for(self.directory.name)
        self.store = InvestigationStore(self.settings.database_url.get_secret_value())
        await self.store.initialize()
        await PlatformAdminStore(self.store.engine).initialize()
        await ParameterStore(self.store.engine).initialize()
        await TriageStore(self.store.engine).initialize()
        self.knowledge = KnowledgeService(self.store.engine, self.settings)
        await self.knowledge.initialize()
        self.knowledge.scope_catalog = AsyncMock(return_value={"capability_ids": [{"id": "incident_triage"}], "environment_ids": [], "connector_instance_ids": []})
        self.author, self.reviewer = self.settings.principals["owner"], self.settings.principals["admin"]
        optimizations = SimpleNamespace(settings=self.settings, registry=CapabilityRegistry())

        @asynccontextmanager
        async def resolve(*_):
            yield self.author, optimizations, self.knowledge

        self.service = ImprovementService(self.store.engine, optimizations, self.knowledge, self.store, resolve_context=resolve, max_capture_text_chars=40000)
        await initialize_tables(self.store.engine, metadata)
        self.capture = KnowledgeCaptureService(self.service)

    async def asyncTearDown(self):
        await self.service.aclose()
        await self.store.aclose()
        self.directory.cleanup()

    async def approved(self, title):
        draft = await self.knowledge.save(self.author, KnowledgeInput(title=title, content="## Resolution\nRecorded restart procedure."), max_text_chars=40000)
        review = KnowledgeReview(expected_hash=draft["content_hash"], reason="Checked source")
        await self.knowledge.review(self.author, draft["doc_id"], "submit", review)
        return await self.knowledge.review(self.reviewer, draft["doc_id"], "approve", review)

    async def test_calendar_window_and_source_contract(self):
        start, end = capture_window(3, datetime(2026, 5, 31, 12, tzinfo=timezone.utc))
        self.assertEqual(start, "2026-02-28T12:00:00+00:00")
        self.assertEqual(end, "2026-05-31T12:00:00+00:00")
        for body in ({"sources": ["documents", "documents"]}, {"sources": ["closed_tickets"]},
                     {"sources": ["documents"], "source_capabilities": {"closed_tickets": "ticket_review"}},
                     {"sources": ["documents"], "lookback_months": True}):
            with self.assertRaises(ValidationError):
                KnowledgeCaptureRequest.model_validate(body)
        self.assertEqual(ImprovementJob(kind="track_closures").limit, 50)

    async def test_persisted_continuation_retry_and_source_version_dedup(self):
        originals = [await self.approved("Recorded procedure " + str(index)) for index in range(3)]
        payload = ImprovementJob(kind="capture_knowledge", capture=KnowledgeCaptureRequest(sources=["documents"], limit=1))
        job = await self.service.enqueue(payload, self.author)
        self.assertFalse(await self.service.run_once())
        partial = await self.service.get(jobs, job["job_id"], self.author)
        self.assertEqual(partial["status"], "QUEUED")
        self.assertEqual(partial["attempts"], 0, "Successful pages do not exhaust failure recovery")
        self.assertEqual(partial["result"]["created"], 1)
        await self.service.control(job["job_id"], self.author)
        retried = await self.service.control(job["job_id"], self.author, retry=True)
        self.assertEqual(retried["result"], partial["result"])
        restarted = ImprovementService(self.store.engine, self.service.optimizations, self.knowledge, self.store,
            resolve_context=self.service.resolve_context, max_capture_text_chars=40000)
        self.assertFalse(await restarted.run_once())
        self.assertTrue(await restarted.run_once())
        completed = await self.service.get(jobs, job["job_id"], self.author)
        self.assertEqual((completed["status"], completed["result"]["created"], completed["result"]["processed"]), ("SUCCEEDED", 3, 3))
        self.assertFalse(completed["result"]["possibly_truncated"])
        for identifier in completed["result"]["document_ids"]:
            derived = await self.knowledge.row(self.author, identifier)
            self.assertEqual(derived["status"], "draft")
            self.assertIn(derived["capture"]["source"]["id"], [row["doc_id"] for row in originals])
        again = await self.capture.execute(KnowledgeCaptureRequest(sources=["documents"]), self.author)
        self.assertEqual((again["created"], again["unchanged"]), (0, 3))
        await restarted.aclose()

    async def test_feedback_only_verified_independent_facts_are_captured(self):
        payload = {"prompt": "Review recorded timeout", "incident_id": "PAY-1", "run_snapshot_hash": "sha256:" + "1" * 64, "evidence": [], "knowledge_scope": None}
        verification = {"expected_outcome": "INSUFFICIENT_EVIDENCE", "expected_facts": ["No confirmed cause was recorded."]}
        values = dict(tenant_id=self.author.tenant_id, project_id=self.author.project_id, author_subject=self.author.subject,
                      source_run_id="run-recorded", source_subject=self.author.subject, capability="incident_triage", revision=2,
                      payload_json=json.dumps(payload), verified_json=json.dumps(verification), created_at=1, updated_at=2)
        async with self.store.engine.begin() as connection:
            for identifier, status, verifier in (("one", "VERIFIED", self.reviewer.subject), ("two", "NEEDS_REVIEW", None), ("three", "VERIFIED", self.author.subject)):
                await connection.execute(insert(candidates).values(candidate_id=identifier, source_key=identifier, status=status, verifier_subject=verifier, **values))
        request = KnowledgeCaptureRequest(sources=["feedback"])
        prepared = await self.capture.execute(request, self.author)
        result = await self.capture.execute(request, self.author, prepared)
        self.assertEqual(result["created"], 1)
        derived = await self.knowledge.row(self.author, result["document_ids"][0])
        self.assertIn(verification["expected_facts"][0], derived["content"])
        self.assertEqual(derived["capture"]["source"]["metadata"]["modified_at"], 2)
        source = await self.service.get(candidates, "one", self.author)
        self.assertEqual(feedback_capture_hash(source), derived["capture"]["source"]["content_hash"])
        async with self.store.engine.begin() as connection:
            await connection.execute(update(candidates).where(candidates.c.candidate_id == "one").values(status="NEEDS_REVIEW"))
        self.assertFalse((await self.knowledge.capture_admissions(self.author, [derived]))[derived["doc_id"]]["eligible"])

    async def test_closed_ticket_hook_requires_authoritative_closure_and_records_scope(self):
        self.knowledge.ingest_capture = AsyncMock(return_value={"doc_id": "draft", "capture_outcome": "created"})
        self.knowledge.scope_catalog = AsyncMock()
        selection = ConnectorSelection(instance_id="jira_prod", environment_id="prod")
        fields = {"summary": "Connection failed", "description": "Recorded failure", "status": {"statusCategory": {"key": "done"}},
                  "updated": "2026-09-15T13:00:00Z", "resolutiondate": "2026-09-15T12:00:00Z", "resolution": {"name": "Fixed"}}
        await self.capture.capture_ticket(self.author, {"key": "PAY-1", "fields": fields}, selection, "ticket_review", observed_at=time.time())
        args = self.knowledge.ingest_capture.call_args.kwargs
        self.assertEqual(args["source"]["id"], "jira_prod:prod:PAY-1")
        self.assertEqual(args["associations"].connector_instance_ids, ["jira_prod"])
        self.assertIn("Attachments are not included", args["structure"].markdown())
        self.assertEqual(args["source"]["metadata"]["modified_at"], datetime(2026, 9, 15, 13, tzinfo=timezone.utc).timestamp())
        self.assertIsNone(await self.capture.capture_ticket(self.author, {"key": "PAY-1", "fields": fields | {"status": {"statusCategory": {"key": "indeterminate"}}}}, selection, "ticket_review", observed_at=time.time()))
        with self.assertRaises(ValueError):
            await self.capture.capture_ticket(self.author, {"key": "PAY-1", "fields": fields | {"updated": None}}, selection, "ticket_review", observed_at=time.time())

    async def test_markup_has_no_macro_execution_or_remote_asset_semantics(self):
        text = storage_text('<h2>Resolution</h2><p>Restart recorded service</p><script>secret</script><ac:structured-macro><p>remote expansion</p></ac:structured-macro><img src="https://example.test/x">', 1000)
        self.assertIn("## Resolution", text)
        self.assertNotIn("secret", text)
        self.assertNotIn("remote", text)
        with self.assertRaises(ValueError):
            storage_text("x" * 50, 10)

    async def test_real_provider_pagination_uses_only_authorized_destinations(self):
        requests = []

        async def jira_handler(request):
            requests.append(json.loads(request.content))
            return httpx2.Response(200, json={"issues": [{"key": "PAY-2", "fields": {}}], "isLast": True})

        jira = JiraConnector("https://jira.test", "PAY", "owner", "secret", client=httpx2.AsyncClient(base_url="https://jira.test", transport=httpx2.MockTransport(jira_handler)))
        result = await jira.search_issues("statusCategory = Done", max_results=1, next_page_token="persisted-page")
        self.assertEqual(requests[0]["nextPageToken"], "persisted-page")
        self.assertIn('project = "PAY"', requests[0]["jql"])
        self.assertFalse(result["possibly_truncated"])
        await jira.aclose()
        calls, remote = [], False

        async def confluence_handler(request):
            calls.append(str(request.url))
            link = "https://outside.test/api/v2/spaces/42/pages?cursor=next" if remote else "?cursor=next"
            return httpx2.Response(200, json={"results": [{"id": "9", "spaceId": "42"}], "_links": {"next": link}})

        provider = ConfluenceConnector(endpoint="https://confluence.test/wiki", scope="42", token="secret", client=httpx2.AsyncClient(transport=httpx2.MockTransport(confluence_handler)))
        self.assertEqual((await provider.read_capture_page(cursor="saved", limit=1))["next_cursor"], "next")
        remote = True
        with self.assertRaises(ConnectorError):
            await provider.read_capture_page(limit=1)
        self.assertTrue(all(url.startswith("https://confluence.test/wiki/api/v2/spaces/42/pages?") for url in calls))
        await provider.aclose()

    async def test_incomplete_page_without_cursor_does_not_complete(self):
        request = KnowledgeCaptureRequest(sources=["closed_tickets"], source_capabilities={"closed_tickets": "ticket_review"}, connector_selections={"itsm": {"instance_id": "jira_prod"}})
        provider = SimpleNamespace(search_issues=AsyncMock(return_value={"issues": [], "possibly_truncated": True, "nextPageToken": None}))

        @asynccontextmanager
        async def selected(*_):
            yield provider, request.connector_selections["itsm"]

        self.capture.provider = selected
        with self.assertRaises(ConnectorError):
            await self.capture.page(request, self.author, {"source_index": 0, "window_start": "2026-06-16T00:00:00+00:00", "window_end": "2026-09-16T00:00:00+00:00"})

    async def test_comments_mapped_facts_and_semantic_hash_share_closure_hook(self):
        self.knowledge.ingest_capture = AsyncMock(return_value={"doc_id": "draft", "capture_outcome": "created"})
        selected = ConnectorSelection(instance_id="jira_prod", environment_id="prod")
        ticket = {"key": "PAY-3", "summary": "Pool exhaustion", "description": "Recorded error", "status_category": "done",
                  "updated": "2026-09-15T13:00:00Z", "resolved": "2026-09-15T12:00:00Z", "resolution": "Fixed",
                  "components": ["Payment API"], "mapped_custom_fields": {"Root cause": "Recorded connection leak"},
                  "comments": [{"id": "10", "created": "2026-09-15T12:00:00Z", "body": "Recorded fix removes leaked connections."}],
                  "comments_count": 3, "comments_truncated": True}
        await self.capture.capture_ticket(self.author, ticket, selected, "ticket_review", observed_at=time.time())
        first = self.knowledge.ingest_capture.call_args.kwargs
        text = first["structure"].markdown()
        self.assertIn("Recorded connection leak", text)
        self.assertIn("Recorded fix removes leaked connections", text)
        self.assertIn("Comment history is partial: 1 returned of 3", text)
        self.assertEqual(first["structure"].topic, "Payment API")
        await self.capture.capture_ticket(self.author, ticket | {"updated": "2026-09-16T13:00:00Z"}, selected, "ticket_review", observed_at=time.time())
        self.assertEqual(first["source"]["content_hash"], self.knowledge.ingest_capture.call_args.kwargs["source"]["content_hash"])
        await self.capture.capture_ticket(self.author, ticket | {"mapped_custom_fields": {"Root cause": "Corrected source fact"}}, selected, "ticket_review", observed_at=time.time())
        self.assertNotEqual(first["source"]["content_hash"], self.knowledge.ingest_capture.call_args.kwargs["source"]["content_hash"])

    async def test_only_complete_confluence_inventory_reconciles_exact_environment(self):
        from app.configuration.knowledge import knowledge_captures
        from app.configuration.knowledge_structure import structure_from_markdown
        from app.optimization.knowledge_capture import capture_source_id
        selected = ConnectorSelection(instance_id="wiki", environment_id="prod")
        other = ConnectorSelection(instance_id="wiki", environment_id="prod:other")
        for selection in (selected, other):
            await self.knowledge.ingest_capture(self.author, source={"kind": "confluence", "id": capture_source_id(selection, "17"),
                "content_hash": "sha256:" + "a" * 64, "metadata": {"modified_at": 1, "observed_at": time.time()}}, title="Previous source page",
                structure=structure_from_markdown("Procedure", "Recorded procedure"), max_text_chars=40000)
        async with self.store.engine.begin() as connection:
            await connection.execute(update(knowledge_captures).values(last_seen_at=1))
        request = KnowledgeCaptureRequest(sources=["confluence"], source_capabilities={"confluence": "confluence_review"}, connector_selections={"confluence": selected})
        self.capture.validate = AsyncMock()
        provider = SimpleNamespace(read_capture_page=AsyncMock(side_effect=[{"items": [], "next_cursor": "second"}, {"items": [], "next_cursor": None}]))

        @asynccontextmanager
        async def source(*_):
            yield provider, selected

        self.capture.provider = source
        original = self.knowledge.mark_source_unavailable
        self.knowledge.mark_source_unavailable = AsyncMock(wraps=original)
        partial = await self.capture.execute(request, self.author)
        self.knowledge.mark_source_unavailable.assert_not_called()
        before_reconcile = await self.capture.execute(request, self.author, partial)
        self.assertEqual(before_reconcile["phase"], "reconcile")
        self.knowledge.mark_source_unavailable.assert_not_called()
        complete = await self.capture.execute(request, self.author, before_reconcile)
        self.assertEqual(complete["status"], "COMPLETE")
        self.assertEqual(complete["unavailable"], 1)
        self.assertEqual(self.knowledge.mark_source_unavailable.call_args.args[2], "wiki:prod:17")

    async def test_stopped_lease_cannot_checkpoint_completion(self):
        await self.approved("Recorded procedure")
        payload = ImprovementJob(kind="capture_knowledge", capture=KnowledgeCaptureRequest(sources=["documents"]))
        job = await self.service.enqueue(payload, self.author)
        original = self.knowledge.ingest_capture

        async def stop_during_ingest(*args, **kwargs):
            result = await original(*args, **kwargs)
            await self.service.control(job["job_id"], self.author)
            return result

        self.knowledge.ingest_capture = stop_during_ingest
        await self.service.run_once()
        stopped = await self.service.get(jobs, job["job_id"], self.author)
        self.assertEqual(stopped["status"], "CANCELLED")
        self.assertEqual(stopped["result"]["processed"], 0)
        self.assertEqual(stopped["result"]["source_index"], 0)

    async def test_missing_jira_ticket_has_typed_safe_status(self):
        async def handler(_request):
            return httpx2.Response(404, json={"secret_response": "must never escape"})

        provider = JiraConnector("https://jira.test", "PAY", "owner", "secret", client=httpx2.AsyncClient(base_url="https://jira.test", transport=httpx2.MockTransport(handler)))
        with self.assertRaises(ConnectorError) as caught:
            await provider.get_ticket("PAY-1")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertNotIn("secret_response", str(caught.exception))
        self.assertIsNone(ConnectorError("ordinary failure").status_code)
        await provider.aclose()
