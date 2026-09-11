"""Validated process settings. Secrets come from deployment, never requests."""

import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from app.identity.principals import UserPrincipal
from app.configuration.yaml_data import load_yaml_data
from app.connectors.providers.project_storage import project_artifact_uri, ArtifactKind

ROOT = Path(__file__).resolve().parents[1]
CONTENT_ROOT = ROOT / "blob_local" / "platform"


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    mode: Literal["demo", "live"] = "demo"
    database_configuration: bool = False
    tenant_id: str = ""
    project_id: str = ""
    auth_issuer: str = ""
    auth_audience: str = ""
    auth_public_key: str = ""
    principals: dict[str, UserPrincipal] = Field(default_factory=dict)
    database_url: SecretStr = SecretStr("sqlite+aiosqlite:///./data/rca.db")
    session_database_url: SecretStr = SecretStr(
        "sqlite+aiosqlite:///./data/sessions.db"
    )
    max_concurrent_uploads: int = Field(default=2, ge=1, le=16)
    max_json_body_bytes: int = Field(default=131072, ge=1024, le=1048576)
    max_concurrent_runs: int = Field(default=4, ge=1, le=64)
    max_parallel_models: int = Field(default=4, ge=1, le=32)
    parallel_evidence: bool = True
    run_timeout_seconds: float = Field(default=120, ge=1, le=900)
    max_llm_calls: int = Field(default=12, ge=1, le=100)
    max_input_chars: int = Field(default=16000, ge=100, le=16000)
    max_context_chars: int = Field(default=64000, ge=1000, le=256000)
    max_evidence_items: int = Field(default=100, ge=1, le=100)
    max_evidence_chars: int = Field(default=12000, ge=100, le=16000)
    max_upload_batch_bytes: int = Field(default=33554432, ge=1024, le=67108864)
    attachment_ttl_seconds: int = Field(default=86400, ge=60, le=604800)
    retention_days: int = Field(default=90, ge=1, le=2555)
    progress_poll_seconds: float = Field(default=0.5, ge=0.1, le=10)
    health_timeout_seconds: float = Field(default=10, ge=1, le=60)
    default_log_window: str = Field(default="-15m", pattern=r"^-[1-9][0-9]*[smhd]$")
    max_project_agents: int = Field(default=4, ge=1, le=20)
    max_agent_yaml_bytes: int = Field(default=65536, ge=1024, le=65536)
    optimization_tracking_uri: SecretStr = SecretStr(
        "sqlite:///./data/optimization-mlflow.db"
    )
    optimization_blob_uri: str | None = None
    config_blob_uri: str | None = None
    projects_root: Path = CONTENT_ROOT.parent / "projects"
    projects_blob_uri: str | None = None
    content_root: Path = CONTENT_ROOT
    config_dir: Path = CONTENT_ROOT / "config"

    @model_validator(mode="before")
    @classmethod
    def resolve_content_paths(cls, values):
        if isinstance(values, dict):
            values = dict(values)
            values.setdefault(
                "projects_root",
                Path(values.get("content_root", CONTENT_ROOT)).parent / "projects",
            )
            values.setdefault(
                "config_dir", Path(values.get("content_root", CONTENT_ROOT)) / "config"
            )
        return values

    @classmethod
    def from_env(cls) -> "Settings":
        members = json.loads(os.getenv("RCA_PRINCIPALS_JSON", "{}"))
        content_root = Path(os.getenv("RCA_CONTENT_ROOT", str(CONTENT_ROOT))).resolve()
        directory = Path(
            os.getenv("RCA_CONFIG_DIR", str(content_root / "config"))
        ).resolve()
        values = ({} if os.getenv("RCA_DATABASE_CONFIGURATION", "false").lower() in {"true", "1"}
                  else load_yaml_data((directory / "runtime.yaml").read_text()))
        if not isinstance(values, dict):
            raise ValueError("runtime.yaml must be a mapping")
        if set(values) & {
            "tenant_id",
            "project_id",
            "principals",
            "auth_issuer",
            "auth_audience",
            "auth_public_key",
            "database_url",
            "session_database_url",
            "optimization_tracking_uri",
        }:
            raise ValueError(
                "Identity and credential settings must come from deployment environment"
            )
        # Only deployment environment can provide secrets/identity. YAML is for
        # operational settings and is validated against the same typed schema.
        for name in cls.model_fields:
            if name in {"principals", "config_dir"}:
                continue
            env_value = os.getenv("RCA_" + name.upper())
            if env_value is not None:
                values[name] = env_value
        values["config_dir"] = directory
        values["content_root"] = content_root
        values["auth_public_key"] = str(values.get("auth_public_key", "")).replace(
            "\\n", "\n"
        )
        values["principals"] = {
            subject: UserPrincipal(subject=subject, **member)
            for subject, member in members.items()
        }
        return cls.model_validate(values)

    def artifact_uri(self, kind: ArtifactKind) -> str:
        if kind not in {
            "agent-configurations",
            "optimizations",
            "chats",
            "framework-uploads",
        }:
            raise ValueError("Unknown project artifact kind")
        override = (
            self.config_blob_uri
            if kind == "agent-configurations"
            else self.optimization_blob_uri
            if kind == "optimizations"
            else None
        )
        if override:
            return override  # Explicit existing stores retain their data and location.
        if not self.tenant_id or not self.project_id:
            if self.mode == "live":
                raise ValueError("Project artifact storage requires deployment scope")
            return str(self.projects_root / "_unconfigured" / "artifacts" / kind)
        return project_artifact_uri(
            self.projects_blob_uri or str(self.projects_root),
            self.tenant_id,
            self.project_id,
            kind,
        )

    @property
    def auth_configured(self) -> bool:
        return bool(
            self.auth_issuer
            and self.auth_audience
            and self.auth_public_key
            and self.principals
        )

    def validate_runtime(self) -> None:
        if self.mode == "live" and not (
            self.auth_configured and self.tenant_id and self.project_id
        ):
            raise ValueError(
                "Live mode requires token verification, memberships, and connector tenant/project scope"
            )
        for subject, principal in self.principals.items():
            if subject != principal.subject:
                raise ValueError("Membership subject does not match its key")
