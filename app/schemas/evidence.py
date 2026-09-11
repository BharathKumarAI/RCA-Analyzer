"""Immutable, scoped evidence records. Only redacted content is persisted."""

from pydantic import BaseModel, ConfigDict


class EvidenceSource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    connector: str
    system: str


class EvidenceBundle(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    evidence_id: str
    run_id: str
    tenant_id: str
    project_id: str
    source: EvidenceSource
    query_json: str
    observed_at: str
    content_json: str
    content_hash: str
    classification: str = "REDACTED_OPERATIONAL"
