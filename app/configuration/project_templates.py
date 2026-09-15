"""Managed project templates; applied provenance lives in the project layer."""
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Column, Float, Integer, JSON, MetaData, String, Table, insert, select, update
from sqlalchemy.dialects.postgresql import JSONB

from app.persistence.database import initialize_tables, scoped_engine
from app.runtime.run_contract import content_hash

metadata = MetaData(schema="platform")
templates = Table("project_templates", metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("template_id", String(64), primary_key=True),
    Column("version", String(32), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("definition", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("status", String(16), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("checksum", String(128), nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(256), nullable=False))


class TemplateWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    name: str = Field(min_length=1, max_length=200)
    definition: dict[str, Any]
    status: Literal["draft", "published", "deprecated"] = "draft"
    expected_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def safe_document(self):
        import json
        if set(self.definition) & {"tenant_id", "project_id", "roles", "connectors", "project_template"}:
            raise ValueError("Templates cannot contain identity, connector scope, or provenance")
        if "harness" not in self.definition:
            raise ValueError("Every project template must explicitly declare its Harness selection")
        if len(json.dumps(self.definition).encode()) > 32768:
            raise ValueError("Project template exceeds 32 KiB")
        return self


class TemplateApply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_template_revision: int = Field(ge=1)
    expected_template_checksum: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    expected_project_revision: str
    expected_harness_revision: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class ProjectTemplateStore:
    def __init__(self, engine):
        self.engine = scoped_engine(engine)

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    async def list(self, tenant):
        async with self.engine.connect() as c:
            return [dict(row) for row in (await c.execute(select(templates).where(
                templates.c.tenant_id == tenant,
            ).order_by(templates.c.template_id, templates.c.version))).mappings()]

    async def get(self, tenant, template_id, version):
        async with self.engine.connect() as c:
            row = (await c.execute(select(templates).where(
                templates.c.tenant_id == tenant, templates.c.template_id == template_id,
                templates.c.version == version,
            ))).mappings().first()
        if row is None:
            return None
        result = dict(row)
        if result["checksum"] != content_hash({"name": result["name"], "definition": result["definition"]}):
            raise ValueError("Project template integrity check failed")
        return result

    async def save(self, principal, template_id, version, body):
        key = (templates.c.tenant_id == principal.tenant_id,
               templates.c.template_id == template_id, templates.c.version == version)
        async with self.engine.begin() as c:
            previous = (await c.execute(select(templates).where(*key).with_for_update())).mappings().first()
            if (previous["revision"] if previous else 0) != body.expected_revision:
                raise ValueError("Project template revision changed")
            if previous and previous["status"] != "draft":
                if (body.name != previous["name"] or body.definition != previous["definition"]
                        or body.status != "deprecated"):
                    raise ValueError("Published versions are immutable; create a new version")
            if not previous and body.status == "deprecated":
                raise ValueError("Only existing templates can be deprecated")
            values = dict(name=body.name, definition=body.definition, status=body.status,
                revision=body.expected_revision + 1,
                checksum=content_hash({"name": body.name, "definition": body.definition}),
                updated_at=time.time(), updated_by=principal.subject)
            if previous:
                result = await c.execute(update(templates).where(*key,
                    templates.c.revision == body.expected_revision).values(**values))
                if result.rowcount != 1:
                    raise ValueError("Project template revision changed")
            else:
                await c.execute(insert(templates).values(tenant_id=principal.tenant_id,
                    template_id=template_id, version=version, **values))
        return await self.get(principal.tenant_id, template_id, version)


def project_content(project):
    return project.model_dump(mode="json", exclude={"project_template"}) if project else {}


async def project_template_context(store, principal, project, harness_revision):
    provenance = project.project_template if project else None
    current = content_hash(project_content(project))
    result = {"source": "platform.project_templates", "parameter_source": "/api/v1/parameters",
              "project_content_hash": current, "status": "UNBOUND", "binding": None,
              "management_api": "/api/v1/project-templates", "activation": "explicit_apply",
              "templates": [{k: v for k, v in item.items() if k != "tenant_id"}
                            for item in await store.list(principal.tenant_id)
                            if item["status"] == "published"]}
    if provenance is None:
        return result
    row = await store.get(principal.tenant_id, provenance.template_id, provenance.template_version)
    status = "SYNCED"
    if row is None or row["status"] != "published":
        status = "UNAVAILABLE"
    elif row["checksum"] != provenance.template_checksum:
        status = "TEMPLATE_CHANGED"
    elif current != provenance.project_revision:
        status = "DRIFTED"
    elif harness_revision != provenance.harness_revision:
        status = "HARNESS_CHANGED"
    result.update(status=status, binding=provenance.model_dump(mode="json"))
    return result
