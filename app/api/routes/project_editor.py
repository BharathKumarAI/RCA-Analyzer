import json
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.api.dependencies import Principal, require_roles
from app.configuration.service import ADMIN_ROLES

router = APIRouter(prefix="/api/v1/project/editor", tags=["project-editor"])

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
        return value

@router.get("")
async def get_editor(request: Request, principal: Principal):
    return await request.app.state.platform_admin.get_project_editor_draft(principal.tenant_id, principal.project_id)

@router.put("")
async def save_editor(body: DraftUpdate, request: Request, principal: Principal):
    require_roles(principal, ADMIN_ROLES)
    try:
        return await request.app.state.platform_admin.update_project_editor_draft(
            principal.tenant_id, principal.project_id, body.document, body.expected_version)
    except IntegrityError:
        raise HTTPException(409, "Project editor draft changed; reload before saving") from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
