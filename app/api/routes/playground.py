"""Personal experiments never accept a project, connector, or identity from clients."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import Principal
from app.tools.domain.generic import TOOLS

router = APIRouter(prefix="/api/v1/playground", tags=["playground"])


class ExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capability: str = Field(default="text_review", min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=16000)


class ExperimentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    capability: str
    status: Literal["RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "INTERRUPTED"]
    prompt: str
    result: str | None
    created_at: float
    updated_at: float


@router.get("/capabilities")
async def capabilities(request: Request, principal: Principal):
    return [{"id": cap.id, "name": cap.name, "description": cap.description,
             "tools": list(cap.allowed_actions)}
            for cap in request.app.state.playground.capabilities.values()
            if request.app.state.playground.allowed(cap, principal)]


@router.post("/runs", status_code=201, response_model=ExperimentResponse)
async def execute(body: ExperimentRequest, request: Request, principal: Principal):
    try:
        return await request.app.state.playground.execute(principal, body.capability, body.prompt)
    except PermissionError:
        raise HTTPException(403, "Playground capability unavailable") from None
    except ValueError:
        raise HTTPException(422, "Invalid experiment input") from None
    except OverflowError:
        raise HTTPException(429, "Execution capacity reached", headers={"Retry-After": "5"}) from None


@router.get("/runs", response_model=list[ExperimentResponse])
async def list_runs(request: Request, principal: Principal, limit: int = Query(50, ge=1, le=100)):
    return await request.app.state.playground.list(principal, limit)


@router.get("/runs/{run_id}", response_model=ExperimentResponse)
async def get_run(run_id: str, request: Request, principal: Principal):
    result = await request.app.state.playground.get(principal, run_id)
    if result is None:
        raise HTTPException(404, "Experiment not found")
    return result


class ToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=16000)


@router.post("/tools/{action}")
async def execute_tool(action: str, body: ToolInput, request: Request, principal: Principal):
    permitted = any(action in cap.allowed_actions
        and request.app.state.playground.allowed(cap, principal)
        for cap in request.app.state.playground.capabilities.values())
    if not permitted or action not in TOOLS:
        raise HTTPException(403, "Playground tool unavailable")
    if len(body.text) > request.app.state.settings.max_input_chars:
        raise HTTPException(422, "Tool input exceeds configured limit")
    return TOOLS[action].func(body.text)
