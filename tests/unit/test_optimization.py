import json
import tempfile
import time
import unittest
from pathlib import Path
from sqlalchemy import insert

from app.capabilities.registry import CapabilityRegistry
from app.configuration.service import AgentConfigurationService
from app.connectors.providers.blob import ConfigurationBlobStore
from app.persistence.store import InvestigationStore
from app.models.profiles import ModelProfiles
from app.optimization.content import canonical, replace_target, split_skill
from app.optimization.evaluation import compare
from app.optimization.models import Dataset, OptimizationConfig, OptimizationRequest
from app.optimization.service import OptimizationService, revisions
from app.settings import CONTENT_ROOT
from tests.support import settings_for


def comparison_rows(quality=0.8, tokens=100, latency=100):
    return [
        {
            "case_id": "heldout",
            "repetition": 0,
            "quality": quality,
            "latency_ms": latency,
            "tokens": tokens,
        }
    ]


def metrics(quality=0.8):
    return {
        "quality/mean": quality,
        "safety/mean": 1,
        "citation_integrity/mean": 1,
        "expected_outcome/mean": 1,
    }


class ComparisonTests(unittest.TestCase):
    def test_improvement_requires_quality_safety_cost_and_real_benchmark(self):
        cfg = OptimizationConfig(repeats=1)
        before, after = comparison_rows(0.6), comparison_rows(0.9)
        self.assertTrue(
            compare(metrics(0.6), metrics(0.9), before, after, cfg, "benchmark")[
                "eligible"
            ]
        )
        self.assertFalse(
            compare(metrics(0.6), metrics(0.9), before, after, cfg, "example")[
                "eligible"
            ]
        )
        self.assertFalse(
            compare(
                metrics(0.6),
                metrics(0.9),
                before,
                comparison_rows(0.9, tokens=None),
                cfg,
                "benchmark",
            )["eligible"]
        )
        self.assertFalse(
            compare(
                metrics(0.6),
                metrics(0.9) | {"safety/mean": 0.9},
                before,
                after,
                cfg,
                "benchmark",
            )["eligible"]
        )
        self.assertFalse(
            compare(
                metrics(0.6),
                metrics(0.9),
                before,
                comparison_rows(0.9, tokens=200),
                cfg,
                "benchmark",
            )["eligible"]
        )
        self.assertFalse(
            compare(
                metrics(0.6),
                metrics(0.61),
                before,
                comparison_rows(0.61),
                cfg,
                "benchmark",
            )["eligible"]
        )

    def test_case_regression_and_duplicate_splits_fail_closed(self):
        cfg = OptimizationConfig()
        before = [
            *comparison_rows(0.9),
            {**comparison_rows(0.2)[0], "case_id": "other"},
        ]
        after = [*comparison_rows(0.6), {**comparison_rows(1.0)[0], "case_id": "other"}]
        self.assertFalse(
            compare(metrics(0.55), metrics(0.8), before, after, cfg, "benchmark")[
                "eligible"
            ]
        )
        data = json.loads(
            (CONTENT_ROOT / "evaluation/datasets/rca-example.json").read_text()
        )
        data["holdout"][0] = dict(data["train"][0], id="duplicate")
        with self.assertRaises(ValueError):
            Dataset.model_validate(data)


class ApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings, _ = settings_for(self.directory.name)
        self.store = InvestigationStore(self.settings.database_url.get_secret_value())
        await self.store.initialize()
        self.configurations = AgentConfigurationService(
            self.store.engine,
            ConfigurationBlobStore(self.settings.config_blob_uri),
            CapabilityRegistry(),
            ModelProfiles.load(),
        )
        await self.configurations.initialize()
        self.service = OptimizationService(
            self.store.engine, self.settings, self.configurations
        )
        await self.service.initialize()
        self.author, self.admin = (
            self.settings.principals["owner"],
            self.settings.principals["admin"],
        )
        value = json.loads(
            (CONTENT_ROOT / "evaluation/datasets/rca-example.json").read_text()
        )
        value["purpose"] = "benchmark"
        self.dataset = Dataset.model_validate(value)
        await self.service.register_dataset(self.dataset, self.author)

    async def asyncTearDown(self):
        await self.service.aclose()
        await self.store.aclose()
        self.directory.cleanup()

    async def candidate(self, identifier, kind="prompt", name="synthesis"):
        request = OptimizationRequest(
            dataset_id=self.dataset.id,
            dataset_version=self.dataset.version,
            target_kind=kind,
            target_name=name,
        )
        bundle, parent, context_hash, _ = await self.service._context(
            self.author, self.dataset.capability
        )
        updated = replace_target(
            bundle,
            request,
            "Revised instruction: retain recorded evidence IDs and uncertainty.\n",
            16000,
        )
        report = {
            "platform_hash": self.service.platform_hash,
            "bundle": updated,
            "comparison": {"eligible": True},
        }
        report_hash = await self.service.blobs.put(canonical(report))
        async with self.store.engine.begin() as connection:
            await connection.execute(
                insert(revisions).values(
                    optimization_id=identifier,
                    tenant_id=self.author.tenant_id,
                    project_id=self.author.project_id,
                    author_subject=self.author.subject,
                    request_json=request.model_dump_json(),
                    dataset_hash="test",
                    parent_hash=parent,
                    context_hash=context_hash,
                    report_hash=report_hash,
                    status="PENDING_APPROVAL",
                    created_at=time.time(),
                    deadline=time.time() + 120,
                )
            )
        return report_hash

    async def test_approval_writes_active_revision_and_stale_candidate_cannot_overwrite_it(
        self,
    ):
        first = await self.candidate("first")
        stale = await self.candidate("stale")
        self.assertIsNone(await self.service.effective(self.author))
        with self.assertRaises(PermissionError):
            await self.service.review(
                "first",
                self.author.model_copy(update={"roles": self.admin.roles}),
                first,
                "Self review",
                True,
            )
        with self.assertRaises(ValueError):
            await self.service.review(
                "first", self.admin, "sha256:" + "0" * 64, "Wrong hash", True
            )
        approved = await self.service.review(
            "first", self.admin, first, "Reviewed held-out comparison", True
        )
        self.assertEqual(approved["status"], "APPROVED")
        self.assertEqual(
            (await self.service.effective(self.author))["revision_hash"], first
        )
        with self.assertRaises(ValueError):
            await self.service.review("stale", self.admin, stale, "Outdated", True)
        other = self.admin.model_copy(update={"tenant_id": "other"})
        self.assertIsNone(await self.service.get("first", other))
        self.assertIsNone(await self.service.effective(other))

    async def test_skill_frontmatter_preserved_and_rejection_never_activates(self):
        before = self.service.base_bundle["skills"]["incident-triage"]
        content_hash = await self.candidate("skill", "skill", "incident-triage")
        report = await self.service._artifact(content_hash)
        self.assertEqual(
            split_skill(before)[0],
            split_skill(report["bundle"]["skills"]["incident-triage"])[0],
        )
        rejected = await self.service.review(
            "skill", self.admin, content_hash, "Not convincing", False
        )
        self.assertEqual(rejected["status"], "REJECTED")
        self.assertIsNone(await self.service.effective(self.author))

    async def test_approved_prompt_and_skill_reach_next_adk_run(self):
        import hashlib
        from sqlalchemy import select
        from app.connectors.providers.replay import ReplayConnector
        from app.persistence.store import runs
        from app.runtime.runner import ExecutionRunner
        from app.runtime.run_contract import RunRequest
        from tests.support import FixtureModel

        observed = []

        class CaptureModel(FixtureModel):
            async def generate_content_async(self, llm_request, stream=False):
                observed.append(str(llm_request.config.system_instruction))
                async for result in super().generate_content_async(llm_request, stream):
                    yield result

        for kind, name in [("prompt", "synthesis"), ("skill", "incident-triage")]:
            content_hash = await self.candidate(kind, kind, name)
            await self.service.review(kind, self.admin, content_hash, "Reviewed", True)
        runner = ExecutionRunner(
            self.settings.model_copy(update={"mode": "live"}),
            self.service.registry,
            self.store,
            {
                name: ReplayConnector(name, self.dataset.train[0])
                for name in ("itsm", "log_search")
            },
            self.configurations,
            lambda stage, config: CaptureModel(model=config.model, stage=stage),
            self.service,
        )
        try:
            result = await runner.execute(
                self.author,
                RunRequest(text="Investigate SAMSON-101", incident_id="SAMSON-101"),
                self.dataset.capability,
            )
            async with self.store.engine.connect() as connection:
                raw = (
                    await connection.execute(
                        select(runs.c.contract_json).where(
                            runs.c.run_id == result.run_id
                        )
                    )
                ).scalar_one()
            contract = json.loads(raw)
            snapshot = json.loads(contract["model_config_json"])
            self.assertEqual(snapshot["optimization_revision_hash"], content_hash)
            self.assertIn("Revised instruction", snapshot["prompts"]["synthesis"])
            effective = await self.service.effective(self.author)
            skill = effective["bundle"]["skills"]["incident-triage"]
            self.assertIn(
                "sha256:" + hashlib.sha256(skill.encode()).hexdigest(),
                contract["skill_hashes"],
            )
            self.assertTrue(
                any("Revised instruction" in instruction for instruction in observed)
            )
        finally:
            await runner.aclose()

    async def test_dataset_immutable_and_blob_tampering_rejected(self):
        with self.assertRaises(ValueError):
            await self.service.register_dataset(self.dataset, self.author)
        content_hash = await self.candidate("tampered")
        path = Path(self.settings.optimization_blob_uri) / (content_hash[7:] + ".yaml")
        path.write_text("{}")
        with self.assertRaises(ValueError):
            await self.service.review(
                "tampered", self.admin, content_hash, "Tampered", True
            )
