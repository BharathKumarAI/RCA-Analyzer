"""Public request schemas never accept identity or connector scope."""

from pydantic import BaseModel, ConfigDict, Field


class RunExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capability: str = Field(default="incident_triage", min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=16000)
    incident_id: str | None = Field(default=None, max_length=64)
    chat_id: str | None = Field(default=None, pattern=r"^chat_[0-9a-f]{32}$")
    attachment_ids: list[str] = Field(default_factory=list, max_length=100)


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    yaml: str = Field(min_length=1, max_length=65536)


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    reason: str = Field(min_length=1, max_length=2000)


class RevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)
