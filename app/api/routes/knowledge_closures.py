"""Project administrators inspect recorded ticket closure comparisons."""

from fastapi import APIRouter, Query, Request

from app.api.dependencies import Principal
from app.api.routes.optimization import improvement_result
from app.optimization.closure_tracking import ClosureTrackingService

router = APIRouter(prefix="/api/v1/knowledge/closures", tags=["knowledge"])


@router.get("")
async def closure_dashboard(request: Request, principal: Principal,
                            limit: int = Query(default=50, ge=1, le=100),
                            cursor: str | None = Query(default=None, pattern=r"^closure_[0-9a-f]{64}$")):
    return await improvement_result(ClosureTrackingService(request.app.state.improvement).dashboard(principal, limit, cursor))


@router.get("/{tracking_id}")
async def closure_detail(tracking_id: str, request: Request, principal: Principal):
    return await improvement_result(ClosureTrackingService(request.app.state.improvement).detail(principal, tracking_id))
