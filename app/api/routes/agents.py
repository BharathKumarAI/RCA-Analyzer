"""Agents API routes; application services own execution."""

import yaml
from fastapi import HTTPException, Request

from app.configuration.models import AgentDefinition, AgentDraft
from app.configuration.service import (
    AUTHOR_ROLES,
    ADMIN_ROLES,
)
from app.identity.principals import Role

from app.api.dependencies import Principal, require_roles
from app.api.schemas import DraftRequest, ReviewRequest, RevokeRequest
from fastapi import APIRouter

router = APIRouter()


@router.get("/api/v1/agent-configurations/schema")
async def agent_schema(principal: Principal):
    return AgentDefinition.model_json_schema()


@router.get("/api/v1/agent-configurations", response_model=list[AgentDraft])
async def agent_configurations(request: Request, principal: Principal):
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER})
    return await request.app.state.configurations.list(principal)


@router.post("/api/v1/agent-configurations", response_model=AgentDraft, status_code=201)
async def submit_configuration(
    body: DraftRequest, request: Request, principal: Principal
):
    require_roles(principal, AUTHOR_ROLES)
    if len(body.yaml.encode()) > request.app.state.settings.max_agent_yaml_bytes:
        raise HTTPException(413, "Agent configuration exceeds size limit")
    try:
        return await request.app.state.configurations.submit(body.yaml, principal)
    except (ValueError, yaml.YAMLError):
        raise HTTPException(
            422, "Invalid agent YAML, capability, model profile or tools"
        ) from None


async def review_configuration(action, draft_id, body, request, principal):
    require_roles(principal, ADMIN_ROLES)
    try:
        result = await getattr(request.app.state.configurations, action)(
            draft_id, principal, body.expected_hash, body.reason
        )
    except PermissionError:
        raise HTTPException(
            403, "Authors cannot review their own configurations"
        ) from None
    except ValueError:
        raise HTTPException(
            409, "Configuration version or review state changed"
        ) from None
    if result is None:
        raise HTTPException(404, "Configuration not found")
    return result


@router.post(
    "/api/v1/agent-configurations/{draft_id}/approve", response_model=AgentDraft
)
async def approve_configuration(
    draft_id: str, body: ReviewRequest, request: Request, principal: Principal
):
    return await review_configuration("approve", draft_id, body, request, principal)


@router.post(
    "/api/v1/agent-configurations/{draft_id}/reject", response_model=AgentDraft
)
async def reject_configuration(
    draft_id: str, body: ReviewRequest, request: Request, principal: Principal
):
    return await review_configuration("reject", draft_id, body, request, principal)


@router.post(
    "/api/v1/agent-configurations/{draft_id}/revoke", response_model=AgentDraft
)
async def revoke_configuration(
    draft_id: str, body: RevokeRequest, request: Request, principal: Principal
):
    require_roles(principal, ADMIN_ROLES)
    try:
        result = await request.app.state.configurations.revoke(
            draft_id, principal, body.reason
        )
    except ValueError:
        raise HTTPException(409, "Configuration is not active") from None
    if result is None:
        raise HTTPException(404, "Configuration not found")
    return result
