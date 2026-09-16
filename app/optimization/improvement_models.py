"""Typed, persisted requests for the governed improvement workflow."""

from typing import Literal

from pydantic import Field, model_validator

from app.optimization.models import OptimizationRequest, Strict


class ImprovementJob(Strict):
    kind: Literal["prepare_feedback", "optimize"]
    capability: str | None = Field(default=None, min_length=1, max_length=64)
    limit: int = Field(default=50, ge=1, le=100)
    optimization: OptimizationRequest | None = None

    @model_validator(mode="after")
    def valid_job(self):
        if (self.kind == "optimize") != (self.optimization is not None):
            raise ValueError("Optimization jobs require an optimization request")
        return self


class ImprovementSchedule(Strict):
    name: str = Field(min_length=1, max_length=128)
    interval_seconds: int = Field(ge=300, le=2678400)
    enabled: bool = True
    job: ImprovementJob
    expected_revision: int | None = Field(default=None, ge=1)


class CandidateVerification(Strict):
    expected_revision: int = Field(ge=1)
    expected_outcome: Literal["FINDINGS", "INSUFFICIENT_EVIDENCE"]
    expected_facts: list[str] = Field(min_length=1, max_length=20)
    reason: str = Field(min_length=1, max_length=2000)


class CandidateDataset(Strict):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    version: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=2000)
    capability: str = Field(min_length=1, max_length=64)
    train_ids: list[str] = Field(min_length=1, max_length=100)
    holdout_ids: list[str] = Field(min_length=1, max_length=100)
    knowledge_document_ids: list[str] = Field(default_factory=list, max_length=50)


class CandidateKnowledge(Strict):
    expected_revision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=256)
    category: str = Field(default="Runbooks", min_length=1, max_length=128)


class RollbackRequest(Strict):
    expected_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    reason: str = Field(min_length=1, max_length=2000)
