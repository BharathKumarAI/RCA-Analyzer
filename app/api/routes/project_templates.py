"""Authenticated template management and explicit application to this deployment."""
import time
from typing import Annotated

import yaml
from fastapi import APIRouter, HTTPException, Path, Request
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import Principal, require_roles
from app.api.routes.catalog import _save_project_file, _validate_project_yaml
from app.api.routes.harness import _lock, _project_revision
from app.configuration.models import ProjectLayer
from app.configuration.project_templates import (
    TemplateWrite, TemplateApply, project_template_context,
)
from app.identity.principals import Role
from app.runtime.run_contract import content_hash

router = APIRouter(prefix="/api/v1/project-templates", tags=["project-templates"])
TemplateId = Annotated[str, Path(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
Version = Annotated[str, Path(pattern=r"^\d+\.\d+\.\d+$", max_length=32)]


def validate_definition(definition, request, principal):
    if "harness" not in request.app.state.registry.inheritance.policy.project_sections:
        raise HTTPException(403, "Project templates require delegated Harness selection")
    valid, errors, _, data = _validate_project_yaml(yaml.safe_dump(definition), request, principal)
    if not valid:
        raise HTTPException(422, "; ".join(errors))
    return data


@router.get("")
async def list_templates(request: Request, principal: Principal):
    rows = await request.app.state.project_templates.list(principal.tenant_id)
    return [{k: v for k, v in row.items() if k != "tenant_id"} for row in rows
            if Role.PLATFORM_ADMIN in principal.roles or row["status"] == "published"]


@router.get("/binding")
async def binding(request: Request, principal: Principal):
    state = request.app.state
    project = state.registry.inheritance.project(principal)
    context = await project_template_context(state.project_templates, principal, project, state.harness.revision)
    return context | {"project_revision": _project_revision(project), "harness_revision": state.harness.revision}


@router.put("/{template_id}/{version}")
async def save_template(template_id: TemplateId, version: Version, body: TemplateWrite,
                        request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    async with _lock(request):
        validate_definition(body.definition, request, principal)
        try:
            row = await request.app.state.project_templates.save(principal, template_id, version, body)
        except (IntegrityError, ValueError) as exc:
            raise HTTPException(409, str(exc) if isinstance(exc, ValueError) else "Template changed; reload before saving") from None
    return {k: v for k, v in row.items() if k != "tenant_id"}


@router.post("/{template_id}/{version}/apply")
async def apply_template(template_id: TemplateId, version: Version, body: TemplateApply,
                         request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN, Role.PROJECT_OWNER})
    state = request.app.state
    async with _lock(request):
        row = await state.project_templates.get(principal.tenant_id, template_id, version)
        if row is None or row["status"] != "published":
            raise HTTPException(404, "Published project template not found")
        project = state.registry.inheritance.project(principal)
        if (row["revision"] != body.expected_template_revision
                or row["checksum"] != body.expected_template_checksum
                or _project_revision(project) != body.expected_project_revision
                or state.harness.revision != body.expected_harness_revision):
            raise HTTPException(409, "Template, project, or Harness changed; reload before applying")
        # Replace only the sections explicitly owned by this template. Other
        # project sections and all parameter-table overrides remain authoritative.
        data = (project.model_dump(mode="json", exclude_unset=True, exclude={"project_template"}) if project else {}) | row["definition"]
        data.pop("tenant_id", None)
        data.pop("project_id", None)
        supplied = dict(data)
        data = validate_definition(data, request, principal)
        data["project_template"] = {
            "template_id": template_id, "template_version": version,
            "template_checksum": row["checksum"], "template_revision": row["revision"],
            "project_revision": content_hash({k: v for k, v in data.items() if k != "project_template"}),
            "harness_revision": state.harness.revision,
            "applied_at": time.time(), "applied_by": principal.subject,
        }
        persisted = supplied | {"tenant_id": principal.tenant_id, "project_id": principal.project_id,
                                "project_template": data["project_template"]}
        layer = ProjectLayer.model_validate(persisted)
        await _save_project_file(request, principal, yaml.safe_dump(persisted, sort_keys=False))
        state.registry.inheritance.projects[(principal.tenant_id, principal.project_id)] = layer
    return await binding(request, principal)
