"""Typed, persisted requests for the governed improvement workflow."""

from typing import Literal

from pydantic import Field, model_validator

from app.optimization.models import OptimizationRequest, Strict
from app.runtime.run_contract import ConnectorSelection


class KnowledgeCaptureRequest(Strict):
    sources: list[Literal["documents", "closed_tickets", "confluence", "feedback"]] = Field(min_length=1, max_length=4)
    lookback_months: int | None = Field(default=None, ge=1, le=24, strict=True)
    limit: int = Field(default=50, ge=1, le=100, strict=True)
    connector_selections: dict[Literal["itsm", "confluence"], ConnectorSelection] = Field(default_factory=dict, max_length=2)
    source_capabilities: dict[Literal["closed_tickets", "confluence"], str] = Field(default_factory=dict, max_length=2)
    topic: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def explicit_source_scope(self):
        if len(set(self.sources)) != len(self.sources):
            raise ValueError("Capture sources must be unique")
        external = set(self.sources) & {"closed_tickets", "confluence"}
        adapters = {"itsm" if source == "closed_tickets" else source for source in external}
        if set(self.source_capabilities) != external or set(self.connector_selections) != adapters:
            raise ValueError("Each external capture source requires its explicit capability and saved connector selection")
        if any(not value.strip() or len(value) > 64 for value in self.source_capabilities.values()):
            raise ValueError("Capture capabilities must be bounded nonempty identifiers")
        if self.topic is not None and not self.topic.strip():
            raise ValueError("Capture topic cannot be blank")
        return self


class ImprovementJob(Strict):
    kind: Literal["prepare_feedback", "optimize", "capture_knowledge", "track_closures"]
    capability: str | None = Field(default=None, min_length=1, max_length=64)
    limit: int = Field(default=50, ge=1, le=100)
    optimization: OptimizationRequest | None = None
    capture: KnowledgeCaptureRequest | None = None

    @model_validator(mode="after")
    def valid_job(self):
        if (self.kind == "optimize") != (self.optimization is not None):
            raise ValueError("Optimization jobs require an optimization request")
        if (self.kind == "capture_knowledge") != (self.capture is not None):
            raise ValueError("Knowledge capture jobs require a capture request")
        if self.kind == "capture_knowledge" and self.capability is not None:
            raise ValueError("Knowledge capture uses source_capabilities")
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
