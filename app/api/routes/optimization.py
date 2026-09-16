"""Optimization API routes; application services own execution."""

from fastapi import Header, HTTPException, Request

from app.configuration.service import (
    AUTHOR_ROLES,
    ADMIN_ROLES,
)
from app.identity.principals import Role
from app.optimization.models import Dataset, OptimizationRequest
from app.optimization.improvement_models import CandidateDataset, CandidateKnowledge, CandidateVerification, ImprovementJob, ImprovementSchedule, RollbackRequest
from app.optimization.improvement import candidates, jobs, schedules

from app.api.dependencies import Principal, require_roles
from app.api.schemas import ReviewRequest
from fastapi import APIRouter

router = APIRouter()


@router.get("/api/v1/optimization-datasets")
async def optimization_datasets(request: Request, principal: Principal):
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER, Role.PROJECT_MANAGER, Role.PROJECT_ANALYST})
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
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER, Role.PROJECT_MANAGER, Role.PROJECT_ANALYST})
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
    require_roles(principal, AUTHOR_ROLES | {Role.PROJECT_VIEWER, Role.PROJECT_MANAGER, Role.PROJECT_ANALYST})
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


async def improvement_result(operation):
    try:
        return await operation
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, KeyError) as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("/api/v1/improvement/jobs")
async def improvement_jobs(request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.list(jobs, principal))


@router.post("/api/v1/improvement/jobs", status_code=202)
async def enqueue_improvement_job(body: ImprovementJob, request: Request, principal: Principal, idempotency_key: str | None = Header(default=None)):
    return await improvement_result(request.app.state.improvement.enqueue(body, principal, idempotency_key))


@router.get("/api/v1/improvement/jobs/{job_id}")
async def improvement_job(job_id: str, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.get(jobs, job_id, principal))


@router.post("/api/v1/improvement/jobs/{job_id}/cancel")
async def cancel_improvement_job(job_id: str, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.control(job_id, principal))


@router.post("/api/v1/improvement/jobs/{job_id}/retry")
async def retry_improvement_job(job_id: str, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.control(job_id, principal, retry=True))


@router.get("/api/v1/improvement/schedules")
async def improvement_schedules(request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.list(schedules, principal))


@router.post("/api/v1/improvement/schedules", status_code=201)
async def create_improvement_schedule(body: ImprovementSchedule, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.save_schedule(body, principal))


@router.put("/api/v1/improvement/schedules/{schedule_id}")
async def update_improvement_schedule(schedule_id: str, body: ImprovementSchedule, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.save_schedule(body, principal, schedule_id))


@router.get("/api/v1/improvement/candidates")
async def improvement_candidates(request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.list(candidates, principal))


@router.get("/api/v1/improvement/candidates/{candidate_id}")
async def improvement_candidate(candidate_id: str, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.get(candidates, candidate_id, principal))


@router.post("/api/v1/improvement/candidates/{candidate_id}/verify")
async def verify_improvement_candidate(candidate_id: str, body: CandidateVerification, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.verify_candidate(candidate_id, body, principal))


@router.post("/api/v1/improvement/candidates/{candidate_id}/knowledge", status_code=201)
async def improvement_candidate_knowledge(candidate_id: str, body: CandidateKnowledge, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.draft_knowledge(candidate_id, body, principal))


@router.post("/api/v1/improvement/datasets", status_code=201)
async def improvement_dataset(body: CandidateDataset, request: Request, principal: Principal):
    return await improvement_result(request.app.state.improvement.publish_dataset(body, principal))


@router.post("/api/v1/optimizations/{optimization_id}/rollback")
async def rollback_optimization(optimization_id: str, body: RollbackRequest, request: Request, principal: Principal):
    return await improvement_result(request.app.state.optimizations.rollback(optimization_id, principal, body.expected_hash, body.reason))


@router.post("/api/v1/optimizations/{optimization_id}/revoke")
async def revoke_optimization(optimization_id: str, body: RollbackRequest, request: Request, principal: Principal):
    return await improvement_result(request.app.state.optimizations.rollback(optimization_id, principal, body.expected_hash, body.reason, revoke=True))
