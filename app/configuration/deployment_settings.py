"""Durable, non-identity deployment settings managed by platform administrators."""

import json
import os
import tempfile
import fcntl
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, SecretStr, model_validator

from app.runtime.run_contract import content_hash
from app.connectors.providers.deployment import resolve_env_reference

ROOT = Path(__file__).resolve().parents[2]
DEPLOYMENT_SETTINGS_PATH = ROOT / "data" / "deployment-settings.yaml"
DEPLOYMENT_AUDIT_PATH = ROOT / "data" / "deployment-settings.audit.jsonl"


class DeploymentSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    mode: Literal["demo", "live"] = "demo"
    database_configuration: bool = False
    database_url_ref: str = ""
    session_database_url_ref: str = ""
    optimization_tracking_uri_ref: str = ""
    config_blob_uri: str | None = None
    optimization_blob_uri: str | None = None
    content_root: str | None = None
    projects_blob_uri: str | None = None
    config_dir: str | None = None
    projects_root: str | None = None

    @model_validator(mode="after")
    def refs_are_safe(self):
        for name in ("database_url_ref", "session_database_url_ref", "optimization_tracking_uri_ref"):
            value = getattr(self, name)
            if value and (not value.startswith("env://") or not value[6:] or not value[6:].replace("_", "").isalnum() or value[6:] != value[6:].upper()):
                raise ValueError(f"{name} must be an env:// reference")
        for name in ("config_blob_uri", "optimization_blob_uri", "projects_blob_uri", "config_dir", "projects_root"):
            value = getattr(self, name)
            if value and ("@" in value or "?" in value or "#" in value):
                raise ValueError(f"{name} cannot contain credentials or query parameters")
        return self

    def resolved(self) -> dict[str, Any]:
        result = self.model_dump(mode="json")
        for field in ("database_url_ref", "session_database_url_ref", "optimization_tracking_uri_ref"):
            ref = result.pop(field)
            if ref:
                value = resolve_env_reference(ref)
                result[field.removesuffix("_ref")] = SecretStr(value)
        for field in ("config_blob_uri", "optimization_blob_uri", "content_root", "projects_blob_uri", "config_dir", "projects_root"):
            if result.get(field) is None:
                result.pop(field, None)
        return result


def deployment_hash(settings: DeploymentSettings) -> str:
    return content_hash(settings.model_dump(mode="json"))


def load_deployment_settings() -> DeploymentSettings | None:
    if not DEPLOYMENT_SETTINGS_PATH.exists():
        return None
    try:
        raw = yaml.safe_load(DEPLOYMENT_SETTINGS_PATH.read_text(encoding="utf-8")) or {}
        return DeploymentSettings.model_validate(raw)
    except (OSError, ValueError, yaml.YAMLError) as exc:
        raise ValueError(f"Invalid durable deployment settings: {exc}") from exc


def save_deployment_settings(settings: DeploymentSettings, actor: str, expected_hash: str, current: DeploymentSettings | None = None) -> str:
    DEPLOYMENT_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_path = DEPLOYMENT_SETTINGS_PATH.with_suffix(DEPLOYMENT_SETTINGS_PATH.suffix + ".lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        fresh = load_deployment_settings()
        current = fresh or current or DeploymentSettings()
        if deployment_hash(current) != expected_hash:
            raise ValueError("Deployment settings changed; reload its hash before retrying")
        return _save_locked(settings, actor)


def _save_locked(settings: DeploymentSettings, actor: str) -> str:
    fd, temporary_name = tempfile.mkstemp(prefix=".deployment-settings.", suffix=".tmp", dir=DEPLOYMENT_SETTINGS_PATH.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        temporary.write_text(yaml.safe_dump(settings.model_dump(mode="json"), sort_keys=False), encoding="utf-8")
        os.replace(temporary, DEPLOYMENT_SETTINGS_PATH)
    finally:
        temporary.unlink(missing_ok=True)
    audit = {"actor": actor, "content_hash": deployment_hash(settings)}
    with DEPLOYMENT_AUDIT_PATH.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(audit, separators=(",", ":")) + "\n")
    return deployment_hash(settings)
