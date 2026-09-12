"""Shared platform templates and scoped project resource selection."""

import asyncio
import copy
import hashlib
import json

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import Principal
from app.configuration.harness import HarnessCatalog, HarnessDocument
from app.configuration.models import HarnessSelection, ProjectLayer
from app.identity.principals import Role

router = APIRouter(prefix="/api/v1/harness", tags=["harness"])
PROJECT_EDITORS = {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER}


class HarnessWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: HarnessDocument
    expected_revision: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class SelectionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selection: HarnessSelection
    expected_revision: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    expected_project_revision: str


def catalog(request: Request) -> HarnessCatalog:
    return request.app.state.harness


def _lock(request):
    if not hasattr(request.app.state, "harness_lock"):
        request.app.state.harness_lock = asyncio.Lock()
    return request.app.state.harness_lock


def _project_revision(project):
    if project is None:
        return ""
    payload = json.dumps(project.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(payload).hexdigest()


@router.get("")
async def get_harness(request: Request, principal: Principal):
    c = catalog(request)
    inheritance = request.app.state.registry.inheritance
    project = inheritance.project(principal)
    selection = project.harness if project else HarnessSelection()
    agents, plugins = c.resolve(selection)
    exclusions = c.exclusions(selection)
    delegated = "harness" in inheritance.policy.project_sections
    can_edit = delegated and bool(PROJECT_EDITORS.intersection(principal.roles))
    skills = []
    for name in request.app.state.registry.skill_contents:
        rule = inheritance.rules.get(name)
        override = project.skills.get(name) if project else None
        enabled = name not in exclusions["skills"] and (not override or override.enabled)
        skills.append({"id": name, "name": name, "enabled": enabled,
                       "customizable": can_edit and bool(rule and not rule.immutable and rule.project_override)})
    capabilities = [{"id": cap.id, "name": cap.name,
                     "enabled": inheritance.resolve_capability(cap, principal).enabled,
                     "customizable": can_edit and cap.enabled}
                    for cap in request.app.state.registry.list_all()]
    return {
        "tenant_id": principal.tenant_id,
        "project_id": principal.project_id,
        "revision": c.revision,
        "platform_revision": c.revision,
        "project_revision": _project_revision(project),
        "document": c.document.model_dump(mode="json"),
        "selection": selection.model_dump(mode="json"),
        "effective_agents": [a.definition.id for a in agents],
        "effective_plugins": [p.id for p in plugins],
        "skills": skills,
        "capabilities": capabilities,
        "effective_skills": [s["id"] for s in skills if s["enabled"]],
        "effective_capabilities": [cap["id"] for cap in capabilities if cap["enabled"]],
        "permissions": {"manage_platform": Role.PLATFORM_ADMIN in principal.roles,
                        "manage_project": can_edit},
    }


@router.put("/platform")
async def replace_platform_harness(body: HarnessWrite, request: Request, principal: Principal):
    if Role.PLATFORM_ADMIN not in principal.roles:
        raise HTTPException(403, "Platform administrator role required")
    async with _lock(request):
        c = catalog(request)
        if body.expected_revision != c.revision:
            raise HTTPException(409, "Harness catalog changed; reload before saving")
        candidate = copy.copy(c)
        try:
            for entry in body.document.agents:
                request.app.state.configurations._parse(yaml.safe_dump(entry.definition.model_dump(mode="json")))
            candidate.replace(body.document, body.expected_revision)
            for project in request.app.state.registry.inheritance.projects.values():
                candidate.validate_selection(project.harness)
            content = yaml.safe_dump(body.document.model_dump(mode="json"), sort_keys=False)
            if len(content.encode()) > 262144:
                raise ValueError("Harness catalog exceeds 256 KiB")
            if request.app.state.settings.database_configuration:
                from app.configuration.database_bundle import update_bundle_file
                await update_bundle_file(request.app.state.store.engine, request.app.state.settings,
                                         "config/harness.yaml", content)
            candidate.save()
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        c.document = candidate.document
    return await get_harness(request, principal)


async def save_selection(body: SelectionWrite, request: Request, principal: Principal):
    inheritance = request.app.state.registry.inheritance
    if not PROJECT_EDITORS.intersection(principal.roles):
        raise HTTPException(403, "Project owner or platform administrator role required")
    if "harness" not in inheritance.policy.project_sections:
        raise HTTPException(403, "Harness selection is not delegated by the platform")
    async with _lock(request):
        c = catalog(request)
        project = inheritance.project(principal)
        if body.expected_revision != c.revision or body.expected_project_revision != _project_revision(project):
            raise HTTPException(409, "Harness or project changed; reload before saving")
        try:
            c.validate_selection(body.selection)
            data = project.model_dump(mode="json", exclude_unset=True) if project else {
                "tenant_id": principal.tenant_id, "project_id": principal.project_id}
            data["harness"] = body.selection.model_dump(mode="json")
            validated = ProjectLayer.model_validate(data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        from app.api.routes.catalog import _save_project_file
        await _save_project_file(request, principal, yaml.safe_dump(data, sort_keys=False))
        inheritance.projects[(principal.tenant_id, principal.project_id)] = validated
    return await get_harness(request, principal)


@router.put("/project")
async def replace_project_harness(body: SelectionWrite, request: Request, principal: Principal):
    return await save_selection(body, request, principal)


@router.delete("/project")
async def reset_project_harness(request: Request, principal: Principal, expected_project_revision: str):
    return await save_selection(SelectionWrite(selection=HarnessSelection(),
        expected_revision=catalog(request).revision, expected_project_revision=expected_project_revision),
        request, principal)
