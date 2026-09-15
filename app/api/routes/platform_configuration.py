"""Typed editors for active declarative platform configuration documents."""
import asyncio
import os
import tempfile
from dataclasses import asdict, fields, replace
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
from sqlalchemy import select

from app.api.dependencies import Principal, require_roles
from app.configuration.database_bundle import active, bundles, update_bundle_file
from app.configuration.yaml_data import load_yaml_data
from app.identity.principals import Role
from app.inputs.files import FileLimits
from app.optimization.models import OptimizationConfig
from app.runtime.run_contract import content_hash

router = APIRouter(prefix="/api/v1/platform/configuration", tags=["platform configuration"])
Section = Literal["file-processing", "optimization"]
FILES = {"file-processing": "file_processing.yaml", "optimization": "optimization.yaml"}


class ConfigurationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    values: dict[str, Any]
    expected_hash: str


def json_values(value):
    if isinstance(value, FileLimits):
        return {**asdict(value), "allowed_extensions": sorted(value.allowed_extensions)}
    return value.model_dump(mode="json")


async def saved_values(request, section):
    settings = request.app.state.settings
    filename = FILES[section]
    if settings.database_configuration:
        async with request.app.state.store.engine.connect() as connection:
            contents = await connection.scalar(select(bundles.c.files).join(active, (
                (bundles.c.tenant_id == active.c.tenant_id)
                & (bundles.c.project_id == active.c.project_id)
                & (bundles.c.content_hash == active.c.content_hash)
            )).where(active.c.tenant_id == settings.tenant_id, active.c.project_id == settings.project_id))
        if contents is None:
            raise HTTPException(409, "Active platform configuration is not available")
        return load_yaml_data(contents[f"config/{filename}"])
    return load_yaml_data((settings.config_dir / filename).read_text())


def validate_configuration(section, values, request):
    if section == "file-processing":
        if set(values) - {field.name for field in fields(FileLimits)}:
            raise ValueError("Unknown file-processing setting")
        result = TypeAdapter(FileLimits).validate_python(values)
        if not result.allowed_extensions <= FileLimits().allowed_extensions:
            raise ValueError("Only implemented attachment formats may be enabled")
        return result
    result = OptimizationConfig.model_validate(values)
    for stage in (result.reflection_stage, result.judge_stage):
        configured = request.app.state.platform.profiles.stages.get(stage)
        if configured is None or not configured.enabled:
            raise ValueError("Optimization stages must reference an enabled model stage")
    if max(result.min_train_cases, result.min_holdout_cases) > result.max_cases_per_split:
        raise ValueError("Minimum case counts cannot exceed the split limit")
    return result


async def snapshot(request, section):
    saved = validate_configuration(section, await saved_values(request, section), request)
    current = request.app.state.file_limits if section == "file-processing" else request.app.state.optimizations.config
    schema = TypeAdapter(FileLimits).json_schema() if section == "file-processing" else OptimizationConfig.model_json_schema()
    properties = schema["properties"]
    if section == "file-processing":
        properties["allowed_extensions"]["options"] = sorted(FileLimits().allowed_extensions)
    else:
        for key in ("reflection_stage", "judge_stage"):
            properties[key]["enum"] = [name for name, stage in request.app.state.platform.profiles.stages.items() if stage.enabled]
    return {"section": section, "source": f"config/{FILES[section]}", "values": json_values(saved),
            "active_values": json_values(current), "fields": properties,
            "content_hash": content_hash(json_values(saved)),
            "activation": "next_upload" if section == "file-processing" else "restart",
            "pending_restart": section == "optimization" and json_values(saved) != json_values(current)}


@router.get("/{section}")
async def get_configuration(section: Section, request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    return await snapshot(request, section)


@router.put("/{section}")
async def put_configuration(section: Section, body: ConfigurationWrite, request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if not hasattr(request.app.state, "platform_configuration_lock"):
        request.app.state.platform_configuration_lock = asyncio.Lock()
    async with request.app.state.platform_configuration_lock:
        previous = await snapshot(request, section)
        if body.expected_hash != previous["content_hash"]:
            raise HTTPException(409, "Configuration changed. Reload before saving.")
        try:
            candidate = validate_configuration(section, body.values, request)
        except (ValueError, TypeError, ValidationError):
            raise HTTPException(422, "Invalid configuration. Check types, bounds, supported formats, and stage references.") from None
        content = yaml.safe_dump(json_values(candidate), sort_keys=False)
        settings = request.app.state.settings
        if settings.database_configuration:
            try:
                await update_bundle_file(request.app.state.store.engine, settings, f"config/{FILES[section]}", content)
            except ValueError:
                raise HTTPException(409, "Configuration changed. Reload before saving.") from None
        target = Path(settings.config_dir) / FILES[section]
        fd, name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(content)
            os.replace(name, target)
        finally:
            Path(name).unlink(missing_ok=True)
        if section == "file-processing":
            request.app.state.file_limits = candidate
            request.app.state.platform = replace(request.app.state.platform, file_limits=candidate)
            request.app.state.runner.platform = request.app.state.platform
            request.app.state.harness_workspace.platform = request.app.state.platform
            request.app.state.chat_artifacts.max_bytes = candidate.max_file_bytes
        return await snapshot(request, section)
