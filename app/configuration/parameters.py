"""Typed platform defaults and project overrides. Values never carry credentials."""

import json
import math
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Float,
    ForeignKeyConstraint,
    Integer,
    JSON,
    MetaData,
    String,
    Table,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError

from app.identity.principals import Role
from app.persistence.database import initialize_tables, scoped_engine
from app.settings import Settings

metadata = MetaData()
projects = Table(
    "projects",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("project_name", String(256), nullable=False),
    schema="project",
)
definitions = Table(
    "parameter_definitions",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("tool", String(64), primary_key=True),
    Column("variable_name", String(64), primary_key=True),
    Column("value_type", String(16), nullable=False),
    Column("description", String(2000), nullable=False),
    Column("default_value", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("allow_project_override", Boolean, nullable=False),
    Column("icon", String(64), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("updated_at", Float, nullable=False),
    CheckConstraint(
        "value_type IN ('string','integer','number','boolean','json','secret_ref')"
    ),
    CheckConstraint("revision > 0"),
    schema="platform",
)
overrides = Table(
    "parameter_overrides",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("tool", String(64), primary_key=True),
    Column("variable_name", String(64), primary_key=True),
    Column("value", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("updated_at", Float, nullable=False),
    ForeignKeyConstraint(
        ["tenant_id", "tool", "variable_name"],
        [
            "platform.parameter_definitions.tenant_id",
            "platform.parameter_definitions.tool",
            "platform.parameter_definitions.variable_name",
        ],
    ),
    ForeignKeyConstraint(
        ["tenant_id", "project_id"],
        ["project.projects.tenant_id", "project.projects.project_id"],
    ),
    CheckConstraint("revision > 0"),
    schema="project",
)
audit = Table(
    "parameter_audit",
    metadata,
    Column("event_id", Integer, primary_key=True, autoincrement=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256)),
    Column("tool", String(64), nullable=False),
    Column("variable_name", String(64), nullable=False),
    Column("actor_subject", String(256), nullable=False),
    Column("action", String(32), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("created_at", Float, nullable=False),
    schema="governance",
)

# Deployment identity, credentials, storage paths and auth controls are deliberately
# excluded. Only these existing typed operational settings affect runtime behavior.
RUNTIME_FIELDS = frozenset(
    {
        "max_concurrent_runs",
        "max_parallel_models",
        "parallel_evidence",
        "run_timeout_seconds",
        "max_llm_calls",
        "max_input_chars",
        "max_context_chars",
        "max_evidence_items",
        "max_evidence_chars",
        "max_upload_batch_bytes",
        "attachment_ttl_seconds",
        "retention_days",
        "progress_poll_seconds",
        "health_timeout_seconds",
        "default_log_window",
        "max_concurrent_uploads",
        "max_json_body_bytes",
        "max_project_agents",
        "max_agent_yaml_bytes",
    }
)


def validate_value(kind, value):
    valid = {
        "string": isinstance(value, str),
        "integer": type(value) is int,
        "number": type(value) is int or (type(value) is float and math.isfinite(value)),
        "boolean": type(value) is bool,
        "json": isinstance(value, (dict, list)),
        "secret_ref": isinstance(value, str)
        and bool(
            re.fullmatch(
                r"env://[A-Z][A-Z0-9_]{0,127}",
                value,
            )
        ),
    }
    if not valid.get(kind):
        raise ValueError("Value does not match the declared type")
    try:
        size = len(json.dumps(value, allow_nan=False).encode())
    except (TypeError, ValueError, RecursionError):
        raise ValueError("Parameter value must be JSON serializable") from None
    if size > 16384:
        raise ValueError("Parameter value exceeds 16 KiB")


class ParameterDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    value_type: Literal["string", "integer", "number", "boolean", "json", "secret_ref"]
    description: str = Field(min_length=1, max_length=2000)
    default_value: Any
    allow_project_override: bool = False
    icon: str = Field(default="settings", pattern=r"^[a-z0-9_-]{1,64}$")
    expected_revision: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def typed_value(self):
        validate_value(self.value_type, self.default_value)
        return self


class ParameterOverride(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    value: Any
    expected_revision: int = Field(ge=0)
    expected_definition_revision: int = Field(ge=1)


class ParameterConflict(ValueError):
    pass


class ParameterStore:
    def __init__(self, engine):
        self.engine = scoped_engine(engine)

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    @staticmethod
    def key(table, tenant, tool, name):
        if not all(re.fullmatch(r"[a-z][a-z0-9_]{0,63}", v) for v in (tool, name)):
            raise ValueError("Invalid parameter identifier")
        return (
            table.c.tenant_id == tenant,
            table.c.tool == tool,
            table.c.variable_name == name,
        )

    @staticmethod
    def runtime_value(tool, name, value):
        if tool == "runtime":
            if name not in RUNTIME_FIELDS:
                raise ValueError("This setting is deployment-managed")
            Settings.model_validate({name: value}, strict=True)
        if re.search(r"(^|_)(password|token|secret|api_key|credential)(_|$)", name):
            validate_value("secret_ref", value)

    @staticmethod
    async def record(c, p, tool, name, action, revision, project_id=None):
        await c.execute(
            insert(audit).values(
                tenant_id=p.tenant_id,
                project_id=project_id,
                tool=tool,
                variable_name=name,
                actor_subject=p.subject,
                action=action,
                revision=revision,
                created_at=time.time(),
            )
        )

    async def define(self, p, tool, name, definition):
        if Role.PLATFORM_ADMIN not in p.roles:
            raise PermissionError("Platform administrator required")
        definition = ParameterDefinition.model_validate(definition.model_dump())
        self.runtime_value(tool, name, definition.default_value)
        if (
            re.search(r"(^|_)(password|token|secret|api_key|credential)(_|$)", name)
            and definition.value_type != "secret_ref"
        ):
            raise ValueError("Credential parameters require secret_ref type")
        key = self.key(definitions, p.tenant_id, tool, name)
        values = definition.model_dump(exclude={"expected_revision"})
        revision = definition.expected_revision + 1
        values.update(revision=revision, updated_at=time.time())
        try:
            async with self.engine.begin() as c:
                row = (
                    await c.execute(select(definitions).where(*key).with_for_update())
                ).first()
                if (row.revision if row else 0) != definition.expected_revision:
                    raise ParameterConflict("Definition revision changed")
                existing = (
                    await c.execute(
                        select(overrides).where(
                            *self.key(overrides, p.tenant_id, tool, name)
                        )
                    )
                ).all()
                if existing and not definition.allow_project_override:
                    raise ParameterConflict(
                        "Remove project overrides before fixing the value"
                    )
                for override in existing:
                    validate_value(definition.value_type, override.value)
                    self.runtime_value(tool, name, override.value)
                if row:
                    result = await c.execute(
                        update(definitions)
                        .where(
                            *key, definitions.c.revision == definition.expected_revision
                        )
                        .values(**values)
                    )
                    if result.rowcount != 1:
                        raise ParameterConflict("Definition revision changed")
                else:
                    await c.execute(
                        insert(definitions).values(
                            tenant_id=p.tenant_id,
                            tool=tool,
                            variable_name=name,
                            **values,
                        )
                    )
                await self.record(c, p, tool, name, "define", revision)
        except IntegrityError:
            raise ParameterConflict("Definition revision changed") from None
        return {"revision": revision}

    async def set_override(self, p, tool, name, body):
        if not set(p.roles) & {
            Role.PLATFORM_ADMIN,
            Role.TENANT_ADMIN,
            Role.PROJECT_OWNER,
        }:
            raise PermissionError("Project owner or administrator required")
        body = ParameterOverride.model_validate(body.model_dump())
        try:
            async with self.engine.begin() as c:
                definition = (
                    await c.execute(
                        select(definitions)
                        .where(*self.key(definitions, p.tenant_id, tool, name))
                        .with_for_update()
                    )
                ).first()
                if definition is None:
                    raise ValueError("Unknown parameter")
                if definition.revision != body.expected_definition_revision:
                    raise ParameterConflict("Definition revision changed")
                if not definition.allow_project_override:
                    raise PermissionError("Platform value is fixed")
                if (
                    definition.value_type == "secret_ref"
                    and Role.PLATFORM_ADMIN not in p.roles
                ):
                    raise PermissionError(
                        "Secret reference changes require a platform administrator"
                    )
                validate_value(definition.value_type, body.value)
                self.runtime_value(tool, name, body.value)
                key = (
                    *self.key(overrides, p.tenant_id, tool, name),
                    overrides.c.project_id == p.project_id,
                )
                current = (await c.execute(select(overrides).where(*key))).first()
                if (current.revision if current else 0) != body.expected_revision:
                    raise ParameterConflict("Override revision changed")
                if not await c.scalar(
                    select(projects.c.project_id).where(
                        projects.c.tenant_id == p.tenant_id,
                        projects.c.project_id == p.project_id,
                    )
                ):
                    raise ValueError("Project must be registered during deployment")
                revision = (
                    await c.scalar(
                        select(func.max(audit.c.revision)).where(
                            *self.key(audit, p.tenant_id, tool, name),
                            audit.c.project_id == p.project_id,
                        )
                    )
                    or 0
                ) + 1
                values = dict(
                    value=body.value, revision=revision, updated_at=time.time()
                )
                if current:
                    result = await c.execute(
                        update(overrides)
                        .where(*key, overrides.c.revision == body.expected_revision)
                        .values(**values)
                    )
                    if result.rowcount != 1:
                        raise ParameterConflict("Override revision changed")
                else:
                    await c.execute(
                        insert(overrides).values(
                            tenant_id=p.tenant_id,
                            project_id=p.project_id,
                            tool=tool,
                            variable_name=name,
                            **values,
                        )
                    )
                await self.record(c, p, tool, name, "override", revision, p.project_id)
        except IntegrityError:
            raise ParameterConflict("Override revision changed") from None
        return {"revision": revision}

    async def reset_override(self, p, tool, name, expected_revision):
        if not set(p.roles) & {
            Role.PLATFORM_ADMIN,
            Role.TENANT_ADMIN,
            Role.PROJECT_OWNER,
        }:
            raise PermissionError("Project owner or administrator required")
        async with self.engine.begin() as c:
            # Same lock order as define/set_override.
            definition = (
                await c.execute(
                    select(definitions)
                    .where(*self.key(definitions, p.tenant_id, tool, name))
                    .with_for_update()
                )
            ).first()
            if (
                definition is not None
                and definition.value_type == "secret_ref"
                and Role.PLATFORM_ADMIN not in p.roles
            ):
                raise PermissionError(
                    "Secret reference changes require a platform administrator"
                )
            result = await c.execute(
                delete(overrides).where(
                    *self.key(overrides, p.tenant_id, tool, name),
                    overrides.c.project_id == p.project_id,
                    overrides.c.revision == expected_revision,
                )
            )
            if result.rowcount != 1:
                raise ParameterConflict("Override revision changed")
            await self.record(
                c, p, tool, name, "reset", expected_revision, p.project_id
            )

    async def resolve(self, tenant, project):
        async with self.engine.connect() as c:
            rows = (
                (
                    await c.execute(
                        select(
                            definitions,
                            overrides.c.value.label("override_value"),
                            overrides.c.revision.label("override_revision"),
                        )
                        .outerjoin(
                            overrides,
                            (
                                (definitions.c.tenant_id == overrides.c.tenant_id)
                                & (definitions.c.tool == overrides.c.tool)
                                & (
                                    definitions.c.variable_name
                                    == overrides.c.variable_name
                                )
                                & (overrides.c.project_id == project)
                            ),
                        )
                        .where(definitions.c.tenant_id == tenant)
                        .order_by(definitions.c.tool, definitions.c.variable_name)
                    )
                )
                .mappings()
                .all()
            )
        resolved = []
        for row in rows:
            value = (
                row["override_value"]
                if row["override_revision"]
                else row["default_value"]
            )
            if row["override_revision"] and not row["allow_project_override"]:
                raise ValueError("Fixed parameter has an invalid override")
            validate_value(row["value_type"], value)
            self.runtime_value(row["tool"], row["variable_name"], value)
            resolved.append(
                dict(row)
                | {
                    "effective_value": value,
                    "source": "project" if row["override_revision"] else "platform",
                }
            )
        return resolved
