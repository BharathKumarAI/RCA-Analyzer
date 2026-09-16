"""Same-tenant access proposals reviewed by independent target-project owners."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from app.api.dependencies import Principal
from app.configuration.knowledge import KnowledgeReview
from app.configuration import project_access

router = APIRouter(prefix="/api/v1/project-access-requests", tags=["project-access"])


async def operation(value):
    try:
        return await value
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("")
async def requests(request: Request, principal: Principal):
    return await operation(project_access.requests(request.app.state.projects, principal))


@router.post("", status_code=201)
async def submit(body: project_access.AccessRequest, request: Request, principal: Principal):
    return await operation(project_access.submit(request.app.state.projects, principal, body))


@router.post("/{request_id}/{action}")
async def review(request_id: str, action: Literal["approve", "reject"], body: KnowledgeReview,
                 request: Request, principal: Principal):
    return await operation(project_access.review(request.app.state.projects, principal, request_id, action, body))
