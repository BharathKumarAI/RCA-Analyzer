"""Authenticated parameter management, scoped exclusively by server membership."""

from typing import Literal
from fastapi import APIRouter, HTTPException, Query, Request

from app.api.dependencies import Principal
from app.identity.principals import Role
from app.settings import Settings
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


async def refresh_runtime(request: Request, principal: Principal):
    rows = await request.app.state.parameters.resolve(principal.tenant_id, principal.project_id)
    runtime = {row["variable_name"]: row["effective_value"] for row in rows if row["tool"] == "runtime"}
    if not runtime:
        return False
    current = request.app.state.settings
    changed_restart_fields = {
        name for name in ("max_parallel_models", "max_concurrent_uploads", "max_agent_yaml_bytes")
        if name in runtime and getattr(current, name) != runtime[name]
    }
    restart_fields = {"max_parallel_models", "max_concurrent_uploads", "max_agent_yaml_bytes"}
    updated = Settings.model_validate(current.model_dump() | {
        name: value for name, value in runtime.items() if name not in restart_fields
    })
    updated.validate_runtime()
    if updated.max_concurrent_runs != request.app.state.runner._run_limit and request.app.state.runner.run_limiter._value != request.app.state.runner._run_limit:
        raise HTTPException(409, "Runtime setting cannot change while investigations are active")
    request.app.state.settings = updated
    request.app.state.runner.update_runtime_settings(updated)
    return bool(changed_restart_fields)


def ensure_runtime_editable(request: Request, tool: str, name: str):
    runner = request.app.state.runner
    if tool == "runtime" and name == "max_concurrent_runs" and runner.run_limiter._value != runner._run_limit:
        raise HTTPException(409, "Runtime setting cannot change while investigations are active")


async def mutate_runtime(request: Request, principal: Principal, operation, tool: str, name: str):
    async with request.app.state.runner.runtime_settings_lock:
        ensure_runtime_editable(request, tool, name)
        result = await invoke(operation)
        restart_required = await refresh_runtime(request, principal)
    if result is None:
        result = {}
    if restart_required:
        result["restart_required"] = True
    return result


@router.get("/taxonomy")
async def get_parameter_taxonomy(principal: Principal):
    from app.configuration.models import KNOWN_PARAMETER_CATEGORIES

    return {
        "categories": {
            cat: list(subcats)
            for cat, subcats in KNOWN_PARAMETER_CATEGORIES.items()
        }
    }


@router.get("")
async def list_parameters(request: Request, principal: Principal, view: Literal["all", "project"] = "all"):
    result = await invoke(
        request.app.state.parameters.resolve(
            principal.tenant_id,
            principal.project_id,
            request.app.state.platform.connector_templates,
            request.app.state.platform.connector_options,
        )
    )
    if view == "project" or Role.PLATFORM_ADMIN not in principal.roles:
        result = [row for row in result if row.get("project_visible", True)]
    for row in result:
        if row["tool"] == "runtime":
            row["active_value"] = getattr(request.app.state.settings, row["variable_name"], None)
            row["restart_required"] = row["active_value"] != row["effective_value"]
    return result


@router.put("/{tool}/{name}/definition")
async def define_parameter(
    tool: str,
    name: str,
    body: ParameterDefinition,
    request: Request,
    principal: Principal,
):
    ensure_runtime_editable(request, tool, name)
    if tool == "runtime":
        result = await mutate_runtime(request, principal, request.app.state.parameters.define(principal, tool, name, body), tool, name)
    else:
        result = await invoke(request.app.state.parameters.define(principal, tool, name, body))
    return result


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
    ensure_runtime_editable(request, tool, name)
    if tool == "runtime":
        result = await mutate_runtime(request, principal, request.app.state.parameters.set_override(principal, tool, name, body), tool, name)
    else:
        result = await invoke(request.app.state.parameters.set_override(principal, tool, name, body))
    return result


@router.delete("/{tool}/{name}/override", status_code=204)
async def reset_parameter(
    tool: str,
    name: str,
    request: Request,
    principal: Principal,
    expected_revision: int = Query(ge=1),
):
    ensure_runtime_editable(request, tool, name)
    if tool == "runtime":
        await mutate_runtime(
            request, principal,
            request.app.state.parameters.reset_override(principal, tool, name, expected_revision),
            tool, name,
        )
    else:
        await invoke(request.app.state.parameters.reset_override(principal, tool, name, expected_revision))
