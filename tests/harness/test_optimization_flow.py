"""Exercise native MLflow optimization/evaluation and ADK with labeled test doubles."""

import json
from pathlib import Path
import shutil
import tempfile
import unittest

import yaml
from fastapi.testclient import TestClient
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.fast_api_app import create_app
from app.settings import CONTENT_ROOT
from tests.support import FixtureModel, settings_for


class OptimizationFixtureModel(FixtureModel):
    async def generate_content_async(self, llm_request, stream=False):
        instruction = str(llm_request.config.system_instruction)
        if self.stage == "optimization_reflection":
            payload = {
                "text": "OPTIMIZED_EVIDENCE_INSTRUCTIONS: Produce structured RCA findings with recorded evidence IDs and explicit uncertainty."
            }
        elif self.stage == "evaluation_judge":
            score = 0.95 if "candidate-fixture-output" in instruction else 0.6
            payload = {
                "correctness": score,
                "groundedness": score,
                "safe": True,
                "rationale": "Deterministic test-double score only; not real model quality.",
            }
        else:
            async for response in super().generate_content_async(llm_request, stream):
                if (
                    self.stage == "synthesis"
                    and "OPTIMIZED_EVIDENCE_INSTRUCTIONS" in instruction
                ):
                    payload = json.loads(response.content.parts[0].text)
                    payload["summary"] = (
                        "candidate-fixture-output: still an offline fixture, not a diagnosis."
                    )
                    response.content.parts[0].text = json.dumps(payload)
                response.usage_metadata = types.GenerateContentResponseUsageMetadata(
                    prompt_token_count=100,
                    candidates_token_count=50,
                    total_token_count=150,
                )
                yield response
            return
        yield LlmResponse(
            content=types.Content(
                role="model", parts=[types.Part.from_text(text=json.dumps(payload))]
            ),
            usage_metadata=types.GenerateContentResponseUsageMetadata(
                prompt_token_count=100, candidates_token_count=50, total_token_count=150
            ),
        )


def fixture_factory(stage, config):
    return OptimizationFixtureModel(model=config.model, stage=stage)


class OptimizationFlowTests(unittest.TestCase):
    def test_native_optimization_records_diff_scores_and_blocks_example_promotion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings, token = settings_for(directory)
            bundle = root / "platform"
            shutil.copytree(CONTENT_ROOT, bundle)
            config_path = bundle / "config/optimization.yaml"
            config = yaml.safe_load(config_path.read_text())
            config.update(
                min_train_cases=1, min_holdout_cases=1, repeats=1, max_latency_ratio=10
            )
            config_path.write_text(yaml.safe_dump(config))
            settings = settings.model_copy(
                update={"content_root": bundle, "config_dir": bundle / "config"}
            )
            dataset = json.loads(
                (bundle / "evaluation/datasets/rca-example.json").read_text()
            )
            dataset["train"] = dataset["train"][:1]
            dataset["holdout"] = dataset["holdout"][:1]
            with TestClient(
                create_app(settings, model_factory=fixture_factory)
            ) as client:
                posted = client.post(
                    "/api/v1/optimization-datasets",
                    headers=token("owner"),
                    json=dataset,
                )
                self.assertEqual(posted.status_code, 201, posted.text)
                response = client.post(
                    "/api/v1/optimizations",
                    headers=token("owner"),
                    json={
                        "dataset_id": dataset["id"],
                        "dataset_version": dataset["version"],
                        "target_kind": "prompt",
                        "target_name": "synthesis",
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(result["status"], "NO_IMPROVEMENT", result)
                comparison = result["report"]["comparison"]
                self.assertGreater(comparison["quality"]["delta"], 0)
                self.assertFalse(comparison["eligible"])
                self.assertIn(
                    "Example data cannot qualify a production update",
                    comparison["reasons"],
                )
                self.assertIn(
                    "OPTIMIZED_EVIDENCE_INSTRUCTIONS", result["report"]["diff"]
                )
                self.assertTrue(result["report"]["mlflow_run_id"])
                for samples in result["report"]["cases"].values():
                    self.assertEqual(len(samples), 1)
                self.assertIsNone(
                    client.portal.call(
                        client.app.state.optimizations.effective,
                        settings.principals["owner"],
                    )
                )
                denied = client.post(
                    f"/api/v1/optimizations/{result['optimization_id']}/approve",
                    headers=token("admin"),
                    json={
                        "expected_hash": result["report_hash"],
                        "reason": "Cannot activate examples",
                    },
                )
                self.assertEqual(denied.status_code, 409)
