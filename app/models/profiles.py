"""Strict, hashable configuration for stage-specific model selection."""

from pathlib import Path
from typing import Literal

import yaml
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.settings import CONTENT_ROOT


class StageModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    model: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    temperature: float = Field(default=1.0, ge=0, le=2)
    max_output_tokens: int = Field(default=4096, ge=256, le=32768)
    thinking_level: Literal["minimal", "low", "medium", "high"] | None = None
    thinking_budget: int | None = Field(default=None, ge=0, le=32768)

    @model_validator(mode="after")
    def thinking_configuration(self):
        if self.thinking_level is not None and self.thinking_budget is not None:
            raise ValueError("Use thinking_level or thinking_budget, not both")
        return self

    def generation_config(self) -> types.GenerateContentConfig:
        thinking = None
        if self.thinking_level is not None:
            thinking = types.ThinkingConfig(
                thinking_level=self.thinking_level.upper(), include_thoughts=False
            )
        elif self.thinking_budget is not None:
            thinking = types.ThinkingConfig(
                thinking_budget=self.thinking_budget, include_thoughts=False
            )
        return types.GenerateContentConfig(
            temperature=self.temperature,
            max_output_tokens=self.max_output_tokens,
            thinking_config=thinking,
        )


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    extraction: str
    triage: str
    logs: str
    synthesis: str
    evidence: str | None = None
    tool_call_limit: int = Field(default=12, ge=1, le=100)


class ModelProfiles(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    stages: dict[str, StageModel]
    profiles: dict[str, Profile]

    @model_validator(mode="after")
    def check_references(self):
        for profile in self.profiles.values():
            for stage in ("extraction", "triage", "logs", "synthesis"):
                if getattr(profile, stage) not in self.stages:
                    raise ValueError(f"Unknown model stage: {getattr(profile, stage)}")
            if profile.evidence is not None and profile.evidence not in self.stages:
                raise ValueError(f"Unknown evidence model stage: {profile.evidence}")
            if not self.stages[profile.synthesis].enabled:
                raise ValueError("Final synthesis must be enabled")
        return self

    @classmethod
    def load(cls, path: Path | None = None) -> "ModelProfiles":
        return cls.model_validate(
            yaml.safe_load((path or CONTENT_ROOT / "config/model_profiles.yaml").read_text())
        )

    def resolve(self, profile_name: str) -> dict[str, StageModel]:
        profile = self.profiles[profile_name]
        resolved = {
            stage: self.stages[getattr(profile, stage)]
            for stage in ("extraction", "triage", "logs", "synthesis")
        }
        # Older saved profiles explicitly mapped additional sources to logs.
        # A supplied evidence mapping separates those sources without enabling them.
        resolved["evidence"] = self.stages[profile.evidence or profile.logs]
        return resolved

    def resolve_stage(self, profile_name: str, stage_name: str) -> StageModel:
        aliases = self.resolve(profile_name)
        if stage_name in aliases:
            return aliases[stage_name]
        if stage_name in self.stages:
            return self.stages[stage_name]
        raise ValueError(f"Unknown model stage: {stage_name}")
