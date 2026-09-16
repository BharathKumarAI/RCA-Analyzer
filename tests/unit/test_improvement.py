"""Verification-only recorded cases exercise durable curation, leases and replay."""

import asyncio
from contextlib import asynccontextmanager
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import insert, update

from app.capabilities.registry import CapabilityRegistry
from app.configuration.knowledge import KnowledgeAssociations, KnowledgeInput, KnowledgeReview, KnowledgeService
from app.configuration.parameters import ParameterStore
from app.configuration.service import AgentConfigurationService
from app.connectors.providers.blob import ConfigurationBlobStore
from app.models.profiles import ModelProfiles
from app.optimization.content import canonical, replace_target
from app.optimization.evaluation import Budget, ReplayEvaluator
from app.optimization.improvement import ImprovementService, candidates, jobs, schedules
from app.optimization.improvement_models import CandidateDataset, CandidateKnowledge, CandidateVerification, ImprovementJob, ImprovementSchedule
from app.optimization.models import Dataset, Judgment, KnowledgeReplayScope, OptimizationRequest
from app.optimization.service import OptimizationService, revisions
from app.persistence.feedback import feedback
from app.persistence.platform_admin import PlatformAdminStore
from app.persistence.store import InvestigationStore, evidence, runs
from app.persistence.triage import TriageStore
from app.settings import CONTENT_ROOT
from app.runtime.run_contract import content_hash
from tests.support import model_factory, settings_for


class ImprovementTests(unittest.IsolatedAsyncioTestCase):
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
        configurations = AgentConfigurationService(self.store.engine, ConfigurationBlobStore(self.settings.config_blob_uri), CapabilityRegistry(), ModelProfiles.load())
        await configurations.initialize()
        self.optimizations = OptimizationService(self.store.engine, self.settings, configurations)
        await self.optimizations.initialize()
        self.author, self.reviewer = self.settings.principals["owner"], self.settings.principals["admin"]
        self.membership_active = True

        @asynccontextmanager
        async def resolve(tenant, project, subject):
            if not self.membership_active:
                raise PermissionError("Membership revoked")
            yield self.settings.principals[subject], self.optimizations, self.knowledge

        self.service = ImprovementService(self.store.engine, self.optimizations, self.knowledge, self.store, resolve_context=resolve)
        await self.service.initialize()
        self.dataset = Dataset.model_validate_json((CONTENT_ROOT / "evaluation/datasets/rca-example.json").read_text())

    async def asyncTearDown(self):
        await self.service.aclose()
        await self.optimizations.aclose()
        await self.store.aclose()
        self.directory.cleanup()

    async def recorded_run(self, identifier, incident):
        now = time.time()
        bundle = {"evidence_id": "evidence-" + identifier, "run_id": identifier, "tenant_id": self.author.tenant_id, "project_id": self.author.project_id, "source": {"connector": "itsm", "system": "get_ticket"}, "content_json": json.dumps({"key": incident, "summary": "Recorded timeout"}), "query_json": json.dumps({"ticket_id": incident}), "observed_at": "2026-09-15T12:00:00Z", "content_hash": "recorded-hash"}
        contract = {"mode": "live", "capability": "incident_triage", "request": {"text": "Investigate " + incident, "incident_id": incident}}
        bundle["content_hash"] = content_hash(json.loads(bundle["content_json"]))
        async with self.store.engine.begin() as connection:
            await connection.execute(insert(runs).values(run_id=identifier, tenant_id=self.author.tenant_id, project_id=self.author.project_id, subject=self.author.subject, request_hash=identifier, contract_json=json.dumps(contract), snapshot_hash=content_hash(contract), deadline=now + 30, status="SUCCEEDED", stage="completed", result_json=json.dumps({"outcome": "FINDINGS", "summary": "Recorded timeout"}), evidence_count=1, revision=1, created_at=now, updated_at=now))
            await connection.execute(insert(evidence).values(evidence_id=bundle["evidence_id"], run_id=identifier, tenant_id=self.author.tenant_id, project_id=self.author.project_id, bundle_json=json.dumps(bundle), content_hash=bundle["content_hash"]))
            await connection.execute(insert(feedback).values(run_id=identifier, tenant_id=self.author.tenant_id, project_id=self.author.project_id, subject=self.author.subject, rating="needs_work", note="Check the recorded outcome", revision=1, created_at=now, updated_at=now))

    async def verified_candidates(self):
        await self.recorded_run("run-one", "SAMSON-101")
        await self.recorded_run("run-two", "SAMSON-102")
        result = await self.service.prepare(ImprovementJob(kind="prepare_feedback"), self.author)
        for identifier in result["candidate_ids"]:
            await self.service.verify_candidate(identifier, CandidateVerification(expected_revision=1, expected_outcome="FINDINGS", expected_facts=["The recorded ticket reports a timeout."], reason="Confirmed against incident evidence"), self.reviewer)
        return result["candidate_ids"]

    async def test_scoped_idempotent_jobs_and_independent_verified_publication(self):
        await self.recorded_run("run-one", "SAMSON-101")
        payload = ImprovementJob(kind="prepare_feedback")
        job = await self.service.enqueue(payload, self.author, "same-request")
        self.assertEqual((await self.service.enqueue(payload, self.author, "same-request"))["job_id"], job["job_id"])
        with self.assertRaises(ValueError):
            await self.service.enqueue(ImprovementJob(kind="prepare_feedback", limit=1), self.author, "same-request")
        self.assertTrue(await self.service.run_once())
        finished = await self.service.get(jobs, job["job_id"], self.author)
        self.assertEqual(finished["status"], "SUCCEEDED")
        identifier = finished["result"]["candidate_ids"][0]
        row = await self.service.get(candidates, identifier, self.author)
        self.assertEqual(row["status"], "NEEDS_REVIEW")
        self.assertIsNone(row["verification"], "A rating must never become a training label")
        review = CandidateVerification(expected_revision=1, expected_outcome="FINDINGS", expected_facts=["Recorded timeout"], reason="Verified")
        with self.assertRaises(PermissionError):
            await self.service.verify_candidate(identifier, review, self.author)
        await self.service.verify_candidate(identifier, review, self.reviewer)
        with self.assertRaises(ValueError):
            await self.service.verify_candidate(identifier, review, self.reviewer)
        foreign = self.author.model_copy(update={"project_id": "other"})
        with self.assertRaises(LookupError):
            await self.service.get(candidates, identifier, foreign)
        await self.recorded_run("run-two", "SAMSON-102")
        other = (await self.service.prepare(payload, self.author))["candidate_ids"][0]
        await self.service.verify_candidate(other, review, self.reviewer)
        dataset = await self.service.publish_dataset(CandidateDataset(id="curated", version="1", description="Verified incident cases", capability="incident_triage", train_ids=[identifier], holdout_ids=[other]), self.author)
        self.assertEqual(dataset["purpose"], "benchmark")
        stored, _ = await self.optimizations._dataset(OptimizationRequest(dataset_id="curated", dataset_version="1", target_kind="prompt", target_name="synthesis"), self.author)
        self.assertEqual(stored.train[0].provenance["verified_by"], self.reviewer.subject)
        draft = await self.service.draft_knowledge(identifier, CandidateKnowledge(expected_revision=2, title="Timeout guidance"), self.author)
        self.assertEqual(draft["status"], "draft", "Curation cannot approve knowledge")

    async def test_leases_recover_and_exhaust_without_touching_other_tenants(self):
        payload = ImprovementJob(kind="prepare_feedback")
        first = await self.service.enqueue(payload, self.author)
        claim = await self.service.claim()
        self.assertEqual(claim["job_id"], first["job_id"])
        self.assertIsNone(await self.service.claim())
        async with self.store.engine.begin() as connection:
            await connection.execute(update(jobs).where(jobs.c.job_id == first["job_id"]).values(lease_until=time.time() - 1))
        reclaimed = await self.service.claim()
        self.assertNotEqual(claim["lease_owner"], reclaimed["lease_owner"])
        async with self.store.engine.begin() as connection:
            await connection.execute(update(jobs).where(jobs.c.job_id == first["job_id"]).values(lease_until=0, attempts=3))
        self.assertIsNone(await self.service.claim())
        self.assertEqual((await self.service.get(jobs, first["job_id"], self.author))["status"], "FAILED")
        await self.service.control(first["job_id"], self.author, retry=True)
        self.assertEqual((await self.service.get(jobs, first["job_id"], self.author))["attempts"], 0)
        await self.service.control(first["job_id"], self.author)
        foreign = self.author.model_copy(update={"tenant_id": "another-tenant"})
        await self.service.enqueue(payload, foreign)
        self.assertIsNone(await self.service.claim())

    async def test_job_membership_is_rechecked_and_schedules_coalesce(self):
        schedule = await self.service.save_schedule(ImprovementSchedule(name="Review feedback", interval_seconds=300, job=ImprovementJob(kind="prepare_feedback")), self.author)
        foreign = self.author.model_copy(update={"tenant_id": "another-tenant", "project_id": "other"})
        await self.service.enqueue(ImprovementJob(kind="prepare_feedback"), foreign, f"schedule:{schedule['schedule_id']}:1:0")
        async with self.store.engine.begin() as connection:
            await connection.execute(update(schedules).values(next_run_at=0))
        await self.service.tick_schedules()
        async with self.store.engine.begin() as connection:
            await connection.execute(update(schedules).values(next_run_at=0))
        await self.service.tick_schedules()
        self.assertEqual(len(await self.service.list(jobs, self.author)), 1)
        self.membership_active = False
        await self.service.run_once()
        self.assertEqual((await self.service.list(jobs, self.author))[0]["status"], "FAILED")
        changed = ImprovementSchedule(name="Paused", interval_seconds=300, enabled=False, expected_revision=1, job=ImprovementJob(kind="prepare_feedback"))
        await self.service.save_schedule(changed, self.author, schedule["schedule_id"])
        with self.assertRaises(ValueError):
            await self.service.save_schedule(changed, self.author, schedule["schedule_id"])

    async def test_running_cancel_is_cooperative_and_no_revision_is_approved(self):
        await self.optimizations.register_dataset(self.dataset, self.author)
        entered = asyncio.Event()

        async def wait_for_cancel(*_args):
            entered.set()
            await asyncio.Event().wait()

        self.optimizations.execute = wait_for_cancel
        self.service.lease_seconds = 0.03
        job = await self.service.enqueue(ImprovementJob(kind="optimize", optimization=OptimizationRequest(dataset_id=self.dataset.id, dataset_version=self.dataset.version, target_kind="prompt", target_name="synthesis")), self.author)
        running = asyncio.create_task(self.service.run_once())
        await entered.wait()
        await self.service.control(job["job_id"], self.author)
        await asyncio.wait_for(running, 1)
        self.assertEqual((await self.service.get(jobs, job["job_id"], self.author))["status"], "CANCELLED")
        self.assertIsNone(await self.optimizations.effective(self.author))

    async def test_capacity_wait_does_not_exhaust_recovery_or_let_stale_worker_finish(self):
        await self.optimizations.register_dataset(self.dataset, self.author)
        payload = ImprovementJob(kind="optimize", optimization=OptimizationRequest(dataset_id=self.dataset.id, dataset_version=self.dataset.version, target_kind="prompt", target_name="synthesis"))
        job = await self.service.enqueue(payload, self.author)
        self.optimizations.execute = AsyncMock(side_effect=OverflowError("Capacity"))
        self.assertFalse(await self.service.run_once())
        waiting = await self.service.get(jobs, job["job_id"], self.author)
        self.assertEqual((waiting["status"], waiting["attempts"]), ("QUEUED", 0))
        entered, release = asyncio.Event(), asyncio.Event()

        async def delayed(*_args):
            entered.set()
            await release.wait()
            return {"optimization_id": "late-result", "status": "NO_IMPROVEMENT"}

        self.optimizations.execute = delayed
        running = asyncio.create_task(self.service.run_once())
        await entered.wait()
        async with self.store.engine.begin() as connection:
            await connection.execute(update(jobs).where(jobs.c.job_id == job["job_id"]).values(lease_owner="replacement-worker", lease_until=time.time()+60))
        release.set()
        await running
        fenced = await self.service.get(jobs, job["job_id"], self.author)
        self.assertEqual(fenced["status"], "RUNNING")
        self.assertIsNone(fenced["result"], "A stale worker cannot publish its result")

    async def test_invalid_sources_are_audited_once_and_verified_labels_cannot_be_forged(self):
        await self.recorded_run("tampered", "SAMSON-100")
        await self.recorded_run("intact", "SAMSON-101")
        async with self.store.engine.begin() as connection:
            await connection.execute(update(runs).where(runs.c.run_id == "tampered").values(snapshot_hash="invalid"))
        payload = ImprovementJob(kind="prepare_feedback", limit=1, capability="incident_triage")
        first = await self.service.prepare(payload, self.author)
        self.assertEqual(first["created"], 0)
        self.assertIn("integrity", first["skipped"][0]["reason"])
        second = await self.service.prepare(payload, self.author)
        self.assertEqual(second["created"], 1, "Old invalid signals must not starve subsequent candidates")
        identifier = second["candidate_ids"][0]
        await self.service.verify_candidate(identifier, CandidateVerification(expected_revision=1, expected_outcome="FINDINGS", expected_facts=["Observed timeout"], reason="Verified"), self.reviewer)
        row = await self.service.get(candidates, identifier, self.author)
        verified = self.service.case(row)
        forged = verified.model_copy(update={"expected_facts": ["Unverified claim"]})
        dataset = self.dataset.model_copy(update={"train": [forged]})
        with self.assertRaisesRegex(ValueError, "candidate changed"):
            await self.optimizations.register_dataset(dataset, self.author)
        await self.recorded_run("same-incident", "SAMSON-101")
        duplicate_id = (await self.service.prepare(payload, self.author))["candidate_ids"][0]
        await self.service.verify_candidate(duplicate_id, CandidateVerification(expected_revision=1, expected_outcome="FINDINGS", expected_facts=["The same incident reports a timeout"], reason="Checked another observation"), self.reviewer)
        duplicate_case = self.service.case(await self.service.get(candidates, duplicate_id, self.author))
        direct_dataset = self.dataset.model_copy(update={"train": [verified], "holdout": [duplicate_case]})
        with self.assertRaisesRegex(ValueError, "recorded incident"):
            await self.optimizations.register_dataset(direct_dataset, self.author)

    async def test_native_replay_uses_frozen_reviewed_corpus_and_rejects_revocation(self):
        self.knowledge.scope_catalog = AsyncMock(return_value={"environment_ids": [{"id": "prod"}], "capability_ids": [{"id": "incident_triage"}], "connector_instance_ids": [{"id": "jira-prod"}]})
        associations = KnowledgeAssociations(environment_ids=["prod"], capability_ids=["incident_triage"], connector_instance_ids=["jira-prod"], required=True)
        draft = await self.knowledge.save(self.author, KnowledgeInput(title="Checkout timeout", associations=associations, content="Checkout timeouts require checking the connection pool and comparing recorded errors before changing settings."), max_text_chars=10000)
        review = KnowledgeReview(expected_hash=draft["content_hash"], reason="Reviewed exact text")
        await self.knowledge.review(self.author, draft["id"], "submit", review)
        await self.knowledge.review(self.reviewer, draft["id"], "approve", review)
        corpus = await self.knowledge.frozen_corpus(self.author, document_ids=[draft["id"]])
        policy = (await self.knowledge.policy(self.author)).model_dump(mode="json")
        dataset = self.dataset.model_copy(update={"knowledge_corpus": corpus, "knowledge_policy": policy})
        with self.assertRaisesRegex(ValueError, "recorded environment"):
            await self.optimizations.register_dataset(dataset, self.author)
        scope = KnowledgeReplayScope(connector_selections={"itsm": {"instance_id": "jira-prod", "environment_id": "prod"}}, environment_ids=["prod"], instance_ids=["jira-prod"])
        dataset = dataset.model_copy(update={split: [case.model_copy(update={"knowledge_scope": scope, "knowledge_document_ids": [draft["id"]]}) for case in getattr(dataset, split)] for split in ("train", "holdout")})
        with self.assertRaisesRegex(ValueError, "must include approved required knowledge"):
            await self.optimizations.register_dataset(dataset.model_copy(update={"knowledge_corpus": []}), self.author)
        await self.optimizations.register_dataset(dataset, self.author)
        evaluator = ReplayEvaluator(self.settings, self.optimizations.config, dataset, self.optimizations.base_bundle, self.optimizations.files, self.author, [], Budget(self.optimizations.config, threading.Event()), model_factory)
        case = dataset.train[0].model_copy(update={"prompt": "Investigate checkout timeout SAMSON-101"})
        with patch("app.optimization.evaluation.structured_agent", new=AsyncMock(return_value=Judgment(correctness=1, groundedness=1, safe=True, rationale="Verification fixture"))):
            with_knowledge = await evaluator.run_case(case, self.optimizations.base_bundle)
            without = await evaluator.run_case(case, self.optimizations.base_bundle, with_knowledge=False)
        self.assertEqual(with_knowledge["knowledge_evidence"][0]["doc_id"], draft["id"])
        self.assertEqual(without["knowledge_evidence"], [])
        await self.knowledge.review(self.author, draft["id"], "revoke", review)
        with self.assertRaises(ValueError):
            await self.optimizations.validate_corpus(dataset, self.author)

    async def test_native_replay_freezes_capture_lineage_and_rechecks_live_source(self):
        source = await self.knowledge.save(self.author, KnowledgeInput(title="Checkout runbook", content="Inspect checkout connection-pool saturation."), max_text_chars=10000)
        source_review = KnowledgeReview(expected_hash=source["content_hash"], reason="Checked source")
        await self.knowledge.review(self.author, source["id"], "submit", source_review)
        await self.knowledge.review(self.reviewer, source["id"], "approve", source_review)
        derived = await self.knowledge.ingest_capture(self.author,
            source={"kind": "document", "id": source["id"], "content_hash": source["content_hash"]},
            title="Checkout checks", structure={"topic": "Checkout", "blocks": [{"kind": "check", "title": "Pool saturation", "content": source["content"]}]}, max_text_chars=10000)
        review = KnowledgeReview(expected_hash=derived["content_hash"], reason="Checked captured blocks")
        await self.knowledge.review(self.author, derived["id"], "submit", review)
        await self.knowledge.review(self.reviewer, derived["id"], "approve", review)
        corpus = await self.knowledge.frozen_corpus(self.author, document_ids=[derived["id"]])
        dataset = self.dataset.model_copy(update={"knowledge_corpus": corpus, "knowledge_policy": (await self.knowledge.policy(self.author)).model_dump(mode="json")})
        await self.optimizations.register_dataset(dataset, self.author)
        evaluator = ReplayEvaluator(self.settings, self.optimizations.config, dataset, self.optimizations.base_bundle, self.optimizations.files, self.author, [], Budget(self.optimizations.config, threading.Event()), model_factory)
        case = dataset.train[0].model_copy(update={"prompt": "Investigate checkout timeout SAMSON-101", "knowledge_document_ids": [derived["id"]]})
        with patch("app.optimization.evaluation.structured_agent", new=AsyncMock(return_value=Judgment(correctness=1, groundedness=1, safe=True, rationale="Verification fixture"))):
            result = await evaluator.run_case(case, self.optimizations.base_bundle)
        self.assertEqual(result["knowledge_evidence"][0]["doc_id"], derived["id"])
        await self.knowledge.review(self.author, source["id"], "revoke", source_review)
        with self.assertRaises(ValueError):
            await self.optimizations.validate_corpus(dataset, self.author)

    async def test_reviewed_rollback_restores_exact_previous_revision_and_preserves_audit(self):
        benchmark = self.dataset.model_copy(update={"purpose": "benchmark"})
        await self.optimizations.register_dataset(benchmark, self.author)
        request = OptimizationRequest(dataset_id=benchmark.id, dataset_version=benchmark.version, target_kind="prompt", target_name="synthesis")
        hashes = []
        for identifier in ("first", "second"):
            bundle, parent, context, _ = await self.optimizations._context(self.author, benchmark.capability)
            changed = replace_target(bundle, request, identifier + " revised instruction preserves evidence and uncertainty.", 16000)
            report_hash = await self.optimizations.blobs.put(canonical({"platform_hash": self.optimizations.platform_hash, "bundle": changed, "comparison": {"eligible": True}}))
            async with self.store.engine.begin() as connection:
                await connection.execute(insert(revisions).values(optimization_id=identifier, tenant_id=self.author.tenant_id, project_id=self.author.project_id, author_subject=self.author.subject, request_json=request.model_dump_json(), dataset_hash="fixture", parent_hash=parent, context_hash=context, report_hash=report_hash, status="PENDING_APPROVAL", created_at=time.time(), deadline=time.time()+60))
            await self.optimizations.review(identifier, self.reviewer, report_hash, "Reviewed comparison", True)
            hashes.append(report_hash)
        with self.assertRaises(PermissionError):
            await self.optimizations.rollback("second", self.author, hashes[1], "Self review")
        restored = await self.optimizations.rollback("second", self.reviewer, hashes[1], "Regression confirmed")
        self.assertEqual(restored["status"], "REVOKED")
        self.assertEqual(restored["changes"][0]["restored_hash"], hashes[0])
        self.assertEqual((await self.optimizations.effective(self.author))["optimization_id"], "first")
        with self.assertRaises(ValueError):
            await self.optimizations.rollback("second", self.reviewer, hashes[1], "Stale retry")
        await self.optimizations.rollback("first", self.reviewer, hashes[0], "Return to platform baseline", revoke=True)
        self.assertIsNone(await self.optimizations.effective(self.author))

    async def test_capture_prepares_feedback_pages_without_promoting_ratings(self):
        from app.optimization.improvement_models import KnowledgeCaptureRequest
        from app.optimization.knowledge_capture import KnowledgeCaptureService
        for identifier in ("a-denied", "b-recorded", "c-recorded"):
            await self.recorded_run(identifier, "SAMSON-101")
        async with self.store.engine.begin() as connection:
            unavailable = {"mode": "live", "capability": "unavailable-capability", "request": {"text": "Recorded investigation", "incident_id": "SAMSON-101"}}
            await connection.execute(update(runs).where(runs.c.run_id == "a-denied").values(contract_json=json.dumps(unavailable), snapshot_hash=content_hash(unavailable)))
        self.service.max_capture_text_chars = 40000
        capture = KnowledgeCaptureService(self.service)
        request = KnowledgeCaptureRequest(sources=["feedback"], limit=1)
        state = None
        for _ in range(5):
            state = await capture.execute(request, self.author, state)
            if state["status"] == "COMPLETE":
                break
        self.assertEqual(state["status"], "COMPLETE")
        self.assertEqual(state["feedback_candidates_created"], 2)
        self.assertEqual(state["feedback_signals_inspected"], 3)
        self.assertEqual(state["feedback_signals_unavailable"], 1)
        self.assertEqual(state["created"], 0, "Raw ratings cannot become knowledge facts")
        rows = await self.service.list(candidates, self.author)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["status"] == "NEEDS_REVIEW" for row in rows))
        # An unauthorized source is not permanently discarded for another future scope.
        restarted = await capture.execute(request, self.author)
        self.assertEqual(restarted["feedback_signals_inspected"], 1)
        self.assertEqual(restarted["feedback_signals_unavailable"], 1)
