import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from typing import Literal
from app.api.dependencies import Principal, require_roles
from app.configuration.service import ADMIN_ROLES

router = APIRouter(prefix="/api/v1/project/editor", tags=["project-editor"])

class EditorMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(default="", max_length=256)
    name: str = Field(default="", max_length=200)
    responsibility: list[str] = Field(default_factory=list, max_length=1)
    status: Literal["active", "inactive"] = "active"
    objective: str = Field(default="", max_length=4000)
    timezone: str = Field(default="", max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("timezone")
    @classmethod
    def timezone_exists(cls, value):
        if value:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Choose a valid timezone, such as America/Chicago") from None
        return value

    @field_validator("tags")
    @classmethod
    def bounded_tags(cls, values):
        if any(not tag.strip() or len(tag) > 64 for tag in values):
            raise ValueError("Tags must contain 1 to 64 characters")
        return values


async def validate_setup_draft(request, principal, expected_version):
    """Validate the saved candidate without changing active project settings."""
    draft = await request.app.state.platform_admin.get_project_editor_draft(principal.tenant_id, principal.project_id)
    if draft["version"] != expected_version:
        raise HTTPException(409, "Project draft changed; reload and review before applying")
    document = draft["document"]
    try:
        metadata = EditorMetadata.model_validate(document.get("metadata", {}))
    except ValidationError:
        raise HTTPException(422, "Basic information: review the saved project fields") from None
    errors = []
    if metadata.id != principal.project_id:
        errors.append("Basic information: project identity must match this workspace")
    for field in ("name", "objective", "timezone"):
        if not getattr(metadata, field).strip():
            errors.append(f"Basic information: {field} is required")
    if not metadata.responsibility or not metadata.responsibility[0].strip():
        errors.append("Basic information: choose a responsibility")
    scope = document.get("projectScope", {})
    owners = scope.get("members", {}).get("owners", [])
    from app.api.routes.catalog import list_users
    users = await list_users(request, principal)
    active_ids = {user["id"] for user in users if user["status"] == "active"}
    if not owners or any(owner.get("id") not in active_ids for owner in owners):
        errors.append("Setup: select at least one active project owner from the member list")
    if errors:
        raise HTTPException(422, "; ".join(errors))


class DraftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: dict[str, object] = Field(default_factory=dict)
    expected_version: int = Field(ge=0)

    @field_validator("document")
    @classmethod
    def bounded(cls, value):
        if any(key in value for key in ("tenant_id", "project_id", "roles", "connectors")):
            raise ValueError("Identity and connector scope are deployment-owned")
        if len(json.dumps(value, ensure_ascii=False).encode()) > 262144:
            raise ValueError("Project editor draft exceeds 256 KiB")
        if "metadata" in value:
            EditorMetadata.model_validate(value["metadata"])
        scope = value.get("projectScope", {})
        if not isinstance(scope, dict) or not isinstance(scope.get("members", {}), dict):
            raise ValueError("Project setup and members must be objects")
        for group in ("managers", "owners", "analysts"):
            members = scope.get("members", {}).get(group, [])
            if not isinstance(members, list) or any(not isinstance(member, dict) or not isinstance(member.get("id"), str) for member in members):
                raise ValueError("Members must reference project subjects")
            if len({member["id"] for member in members}) != len(members):
                raise ValueError("Duplicate project member assignment")
        return value

@router.get("")
async def get_editor(request: Request, principal: Principal):
    return await request.app.state.platform_admin.get_project_editor_draft(principal.tenant_id, principal.project_id)

@router.put("")
async def save_editor(body: DraftUpdate, request: Request, principal: Principal):
    require_roles(principal, ADMIN_ROLES)
    if body.document.get("metadata", {}).get("id", principal.project_id) != principal.project_id:
        raise HTTPException(422, "Project identity is deployment-owned")
    from app.api.routes.harness import _lock
    try:
        async with _lock(request):
            return await request.app.state.platform_admin.update_project_editor_draft(
                principal.tenant_id, principal.project_id, body.document, body.expected_version)
    except IntegrityError:
        raise HTTPException(409, "Project editor draft changed; reload before saving") from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
