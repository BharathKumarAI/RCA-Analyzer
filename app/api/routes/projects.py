"""Project catalog and explicit membership-checked project selection."""

from fastapi import APIRouter, HTTPException, Request

from app.api.dependencies import Principal
from app.configuration.projects import ProjectCreate, ProjectLifecycleChange

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


@router.get("")
async def projects(request: Request, principal: Principal):
    return await request.app.state.projects.catalog(principal)


@router.post("", status_code=201)
async def create_project(payload: ProjectCreate, request: Request, principal: Principal):
    try:
        return await request.app.state.projects.create(principal, payload, request.app.state)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("/management")
async def project_management(request: Request, principal: Principal):
    return await request.app.state.projects.management(principal)


@router.post("/{project_id}/lifecycle")
async def change_project_lifecycle(project_id: str, payload: ProjectLifecycleChange, request: Request, principal: Principal):
    try:
        return await request.app.state.projects.change_lifecycle(principal, project_id, payload)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/{project_id}/select")
async def select_project(project_id: str, request: Request, principal: Principal):
    try:
        selected = await request.app.state.projects.select(principal.subject, project_id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    catalog = await request.app.state.projects.catalog(selected)
    return {"principal": selected, "project": next(item for item in catalog["items"] if item["project_id"] == project_id)}
