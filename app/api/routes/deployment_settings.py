"""Platform-admin endpoint for restart-applied deployment settings."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
import hashlib

from app.api.dependencies import Principal, require_roles
from app.configuration.deployment_settings import (
    DeploymentSettings, deployment_hash, load_deployment_settings, save_deployment_settings,
)
from app.identity.principals import Role

router = APIRouter()
ADMIN_ROLES = {Role.PLATFORM_ADMIN}


class DeploymentSettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str = Field(pattern="^(demo|live)$")
    database_configuration: bool
    database_url_ref: str = ""
    session_database_url_ref: str = ""
    optimization_tracking_uri_ref: str = ""
    config_blob_uri: str | None = None
    optimization_blob_uri: str | None = None
    content_root: str | None = None
    projects_blob_uri: str | None = None
    config_dir: str | None = None
    projects_root: str | None = None
    expected_hash: str


def _identity(request: Request) -> dict:
    settings = request.app.state.settings
    return {
        "tenant_id": settings.tenant_id,
        "project_id": settings.project_id,
        "auth_issuer": settings.auth_issuer,
        "auth_audience": settings.auth_audience,
        "auth_public_key_sha256": hashlib.sha256(settings.auth_public_key.encode()).hexdigest() if settings.auth_public_key else None,
        "principals_count": len(settings.principals),
        "reason": "Identity, scope, credentials, and principals remain deployment-owned.",
    }


def _pending_or_current(request: Request) -> DeploymentSettings:
    pending = load_deployment_settings()
    if pending is not None:
        return pending
    settings = request.app.state.deployment_settings
    return DeploymentSettings(
        mode=settings.mode,
        database_configuration=settings.database_configuration,
        config_blob_uri=settings.config_blob_uri,
        optimization_blob_uri=settings.optimization_blob_uri,
        content_root=str(settings.content_root),
        projects_blob_uri=settings.projects_blob_uri,
        config_dir=str(settings.config_dir),
        projects_root=str(settings.projects_root),
    )


@router.get("/api/v1/deployment/settings")
async def get_deployment_settings(request: Request, principal: Principal):
    require_roles(principal, ADMIN_ROLES)
    pending = _pending_or_current(request)
    return {
        **pending.model_dump(mode="json"),
        "content_hash": deployment_hash(pending),
        "applies_after_restart": True,
        "schema": DeploymentSettings.model_json_schema(),
        "immutable_fields": ["tenant_id", "project_id", "auth_issuer", "auth_audience", "auth_public_key", "principals"],
        "identity": _identity(request),
    }


@router.put("/api/v1/deployment/settings")
async def update_deployment_settings(payload: DeploymentSettingsWrite, request: Request, principal: Principal):
    require_roles(principal, ADMIN_ROLES)
    try:
        candidate = DeploymentSettings.model_validate(payload.model_dump(exclude={"expected_hash"}))
        from app.settings import Settings
        Settings.model_validate(request.app.state.settings.model_dump() | candidate.resolved())
        content_hash_value = save_deployment_settings(candidate, principal.subject, payload.expected_hash, current=_pending_or_current(request))
    except ValueError as exc:
        message = str(exc)
        if "changed" in message.lower():
            raise HTTPException(409, "Deployment settings changed; reload before retrying") from exc
        raise HTTPException(422, "Invalid deployment settings; check bounds, paths, and credential references") from exc
    return {
        **candidate.model_dump(mode="json"),
        "content_hash": content_hash_value,
        "applies_after_restart": True,
        "identity": _identity(request),
    }
