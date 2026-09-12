"""Optimization API routes; application services own execution."""

from fastapi import HTTPException, Request

from app.configuration.service import (
    AUTHOR_ROLES,
    ADMIN_ROLES,
)
from app.identity.principals import Role
from app.optimization.models import Dataset, OptimizationRequest

from app.api.dependencies import Principal, require_roles
from app.api.schemas import ReviewRequest
from fastapi import APIRouter

router = APIRouter()


@router.get("/api/v1/optimization-datasets")
async def optimization_datasets(request: Request, principal: Principal):
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER})
    return await request.app.state.optimizations.list_datasets(principal)


@router.post("/api/v1/optimization-datasets", status_code=201)
async def create_optimization_dataset(
    body: Dataset, request: Request, principal: Principal
):
    require_roles(principal, AUTHOR_ROLES)
    try:
        return await request.app.state.optimizations.register_dataset(body, principal)
    except ValueError:
        raise HTTPException(
            422, "Invalid, sensitive or conflicting dataset version"
        ) from None


@router.get("/api/v1/optimizations")
async def optimizations(request: Request, principal: Principal):
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER})
    return await request.app.state.optimizations.list(principal)


@router.post("/api/v1/optimizations")
async def create_optimization(
    body: OptimizationRequest, request: Request, principal: Principal
):
    require_roles(principal, AUTHOR_ROLES)
    try:
        return await request.app.state.optimizations.execute(body, principal)
    except PermissionError:
        raise HTTPException(403, "Capability evaluation access denied") from None
    except OverflowError:
        raise HTTPException(
            429, "Optimization capacity reached", headers={"Retry-After": "30"}
        ) from None
    except ValueError:
        raise HTTPException(
            409, "Dataset, content or optimization configuration is not eligible"
        ) from None


@router.get("/api/v1/optimizations/{optimization_id}")
async def get_optimization(
    optimization_id: str, request: Request, principal: Principal
):
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER})
    result = await request.app.state.optimizations.get(optimization_id, principal)
    if result is None:
        raise HTTPException(404, "Optimization not found")
    return result


async def review_optimization(optimization_id, body, request, principal, approve):
    require_roles(principal, ADMIN_ROLES)
    try:
        result = await request.app.state.optimizations.review(
            optimization_id, principal, body.expected_hash, body.reason, approve
        )
    except PermissionError:
        raise HTTPException(
            403, "Authors cannot review their own optimization"
        ) from None
    except ValueError:
        raise HTTPException(
            409, "Comparison did not pass or its content/review context changed"
        ) from None
    if result is None:
        raise HTTPException(404, "Optimization not found")
    return result


@router.post("/api/v1/optimizations/{optimization_id}/approve")
async def approve_optimization(
    optimization_id: str,
    body: ReviewRequest,
    request: Request,
    principal: Principal,
):
    return await review_optimization(optimization_id, body, request, principal, True)


@router.post("/api/v1/optimizations/{optimization_id}/reject")
async def reject_optimization(
    optimization_id: str,
    body: ReviewRequest,
    request: Request,
    principal: Principal,
):
    return await review_optimization(optimization_id, body, request, principal, False)
