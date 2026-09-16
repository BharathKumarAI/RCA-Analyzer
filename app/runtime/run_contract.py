"""Server-owned run snapshot and typed public results."""

import hashlib
import json
import time
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.identity.principals import UserPrincipal
from app.runtime.visuals import Visual, visual_citations


def content_hash(value: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
    )


class ConnectorSelection(BaseModel):
    """Opaque saved-record selectors; targets, credentials and scope stay server-owned."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    instance_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    environment_id: str | None = Field(default=None, min_length=1, max_length=64)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    text: str = Field(min_length=1, max_length=16000)
    incident_id: str | None = Field(default=None, max_length=64)
    chat_id: str | None = Field(default=None, pattern=r"^chat_[0-9a-f]{32}$")
    attachment_ids: tuple[str, ...] = Field(default=(), max_length=100)
    connector_selections: dict[str, ConnectorSelection] = Field(default_factory=dict, max_length=10)


class RunContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    run_id: str = Field(default_factory=lambda: "run_" + uuid.uuid4().hex)
    tenant_id: str
    project_id: str
    principal: UserPrincipal
    request: RunRequest
    capability: str
    capability_version: str
    capability_hash: str
    policy_hash: str
    skill_hashes: tuple[str, ...] = ()
    agent_hashes: tuple[str, ...] = ()
    attachment_hashes: tuple[str, ...] = ()
    model_profile: str
    model_config_json: str
    data_scope: str
    mode: Literal["demo", "live"]
    created_at: float = Field(default_factory=time.time)

    @model_validator(mode="after")
    def validate_scope(self):
        if (self.tenant_id, self.project_id) != (
            self.principal.tenant_id,
            self.principal.project_id,
        ):
            raise ValueError("Run scope must match authenticated identity")
        if self.data_scope != f"tenant:{self.tenant_id}/project:{self.project_id}":
            raise ValueError("Data scope must match the run")
        return self

    @property
    def snapshot_hash(self) -> str:
        return content_hash(self.model_dump(mode="json"))


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=4000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=100)


class InvestigationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: Literal["FINDINGS", "INSUFFICIENT_EVIDENCE"]
    summary: str = Field(min_length=1, max_length=8000)
    findings: list[Finding] = Field(default_factory=list, max_length=20)
    uncertainties: list[str] = Field(default_factory=list, max_length=20)
    recommended_actions: list[str] = Field(default_factory=list, max_length=20)
    request_types: list[str] = Field(default_factory=list, max_length=4)
    presentation: Literal["summary", "table", "timeline", "dashboard", "report"] = (
        "summary"
    )
    follow_up_questions: list[str] = Field(default_factory=list, max_length=8)
    visuals: list[Visual] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def grounded_shape(self):
        if len({visual.id for visual in self.visuals}) != len(self.visuals):
            raise ValueError("Visual IDs must be unique")
        if len(json.dumps([visual.model_dump(mode="json") for visual in self.visuals], ensure_ascii=False).encode()) > 65536:
            raise ValueError("Visual data exceeds the 64 KiB result limit")
        if self.outcome == "FINDINGS" and (
            not self.findings or any(not f.evidence_ids for f in self.findings)
        ):
            raise ValueError("Every finding needs evidence IDs")
        if self.outcome == "INSUFFICIENT_EVIDENCE" and self.findings:
            raise ValueError("Insufficient evidence cannot contain confirmed findings")
        return self

    def validate_evidence(self, valid_ids: set[str]) -> None:
        citations = {evidence_id for finding in self.findings for evidence_id in finding.evidence_ids}
        for visual in self.visuals:
            citations.update(visual_citations(visual))
        if not citations.issubset(valid_ids):
            raise ValueError("Synthesis cited unknown evidence")


RunStatus = Literal[
    "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED", "SIMULATED", "BLOCKED"
]
TERMINAL_STATUSES = {
    "SUCCEEDED",
    "PARTIAL",
    "FAILED",
    "CANCELLED",
    "SIMULATED",
    "BLOCKED",
}


class RunResponse(BaseModel):
    chat_id: str | None = None
    incident_id: str | None = None
    prompt: str = ""
    run_id: str
    status: RunStatus
    mode: Literal["demo", "live"]
    capability: str
    created_at: float
    updated_at: float
    stage: str
    result: InvestigationResult | None = None
    reason: str | None = None
    trace_id: str | None = None
    evidence_count: int = 0
    revision: int = 0
