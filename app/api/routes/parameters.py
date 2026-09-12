"""Authenticated parameter management, scoped exclusively by server membership."""

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.dependencies import Principal
from app.configuration.parameters import (
    ParameterConflict,
    ParameterDefinition,
    ParameterOverride,
)

router = APIRouter(prefix="/api/v1/parameters", tags=["parameters"])


async def invoke(operation):
    try:
        return await operation
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ParameterConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError:
        raise HTTPException(422, "Invalid parameter or value") from None


@router.get("")
async def list_parameters(request: Request, principal: Principal):
    return await invoke(
        request.app.state.parameters.resolve(
            principal.tenant_id,
            principal.project_id,
            request.app.state.platform.connector_templates,
            request.app.state.platform.connector_options,
        )
    )


@router.put("/{tool}/{name}/definition")
async def define_parameter(
    tool: str,
    name: str,
    body: ParameterDefinition,
    request: Request,
    principal: Principal,
):
    return await invoke(
        request.app.state.parameters.define(principal, tool, name, body)
    )


@router.delete("/{tool}/{name}/definition", status_code=204)
async def delete_parameter_definition(
    tool: str,
    name: str,
    request: Request,
    principal: Principal,
    expected_revision: int = Query(ge=1),
):
    await invoke(
        request.app.state.parameters.delete_definition(
            principal, tool, name, expected_revision
        )
    )


@router.put("/{tool}/{name}/override")
async def override_parameter(
    tool: str,
    name: str,
    body: ParameterOverride,
    request: Request,
    principal: Principal,
):
    return await invoke(
        request.app.state.parameters.set_override(principal, tool, name, body)
    )


@router.delete("/{tool}/{name}/override", status_code=204)
async def reset_parameter(
    tool: str,
    name: str,
    request: Request,
    principal: Principal,
    expected_revision: int = Query(ge=1),
):
    await invoke(
        request.app.state.parameters.reset_override(
            principal, tool, name, expected_revision
        )
    )
