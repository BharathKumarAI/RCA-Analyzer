"""Bounded optimization requests, curated datasets and comparison gates."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)


class OptimizationConfig(Strict):
    enabled: bool = True
    reflection_stage: str = "synthesis"
    judge_stage: str = "synthesis"
    repeats: int = Field(default=2, ge=1, le=5)
    min_train_cases: int = Field(default=3, ge=1, le=100)
    min_holdout_cases: int = Field(default=5, ge=1, le=100)
    max_cases_per_split: int = Field(default=20, ge=1, le=100)
    max_model_calls: int = Field(default=256, ge=1, le=2000)
    timeout_seconds: float = Field(default=1800, ge=10, le=7200)
    min_quality_gain: float = Field(default=0.02, gt=0, le=1)
    min_candidate_quality: float = Field(default=0.8, ge=0, le=1)
    max_case_quality_drop: float = Field(default=0.1, ge=0, le=1)
    max_latency_ratio: float = Field(default=1.5, ge=1, le=10)
    max_token_ratio: float = Field(default=1.25, ge=1, le=10)
    max_blob_bytes: int = Field(default=2097152, ge=65536, le=8388608)
    max_asset_chars: int = Field(default=16000, ge=100, le=32000)
    guidelines: str = (
        "Improve evidence-grounded RCA using training feedback. Preserve the task, "
        "uncertainty, citation requirements and read-only boundaries. Do not add tools, "
        "invent evidence, repeat example-specific answers, or weaken safety rules. "
        "Return only the revised instruction text in the requested JSON schema."
    )


class OptimizationRequest(Strict):
    dataset_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    dataset_version: str = Field(default="1.0.0", min_length=1, max_length=64)
    target_kind: Literal["prompt", "skill"]
    target_name: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")


class Case(Strict):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    prompt: str = Field(min_length=1, max_length=16000)
    incident_id: str | None = Field(default=None, max_length=64)
    ticket: dict | None = None
    logs: list[dict] = Field(default_factory=list, max_length=100)
    attachments: list[str] = Field(default_factory=list, max_length=10)
    expected_outcome: Literal["FINDINGS", "INSUFFICIENT_EVIDENCE"]
    expected_facts: list[str] = Field(min_length=1, max_length=20)
    recorded_sources: dict[str, dict] = Field(default_factory=dict)
    provenance: dict = Field(default_factory=dict)


class Dataset(Strict):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    version: str = Field(min_length=1, max_length=64)
    purpose: Literal["example", "benchmark"] = "example"
    capability: str = "incident_triage"
    description: str = Field(min_length=1, max_length=2000)
    train: list[Case] = Field(min_length=1, max_length=100)
    holdout: list[Case] = Field(min_length=1, max_length=100)
    knowledge_corpus: list[dict] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def distinct_cases(self):
        cases = [*self.train, *self.holdout]
        if len({case.id for case in cases}) != len(cases):
            raise ValueError("Dataset case IDs must be unique across splits")
        # Exact duplicate examples cannot masquerade as independent holdout data.
        fingerprints = [case.model_dump_json(exclude={"id", "provenance"}) for case in cases]
        if len(set(fingerprints)) != len(cases):
            raise ValueError("Train and holdout examples must be distinct")
        return self


class Judgment(Strict):
    correctness: float = Field(ge=0, le=1)
    groundedness: float = Field(ge=0, le=1)
    safe: bool
    rationale: str = Field(min_length=1, max_length=3000)


class Revision(Strict):
    text: str = Field(min_length=1, max_length=32000)
