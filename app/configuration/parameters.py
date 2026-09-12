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
from app.configuration.models import ConnectorTemplate

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


_NAME_SANITIZE = re.compile(r"[^a-z0-9_]+")


def _normalize_parameter_name(raw: str) -> str:
    name = _NAME_SANITIZE.sub("_", raw.strip().lower())
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        return "custom_field"
    if not re.match(r"[a-z]", name):
        name = f"field_{name}"
    if len(name) > 64:
        name = name[:64]
    return name


def _resolve_secret_variable(template: ConnectorTemplate, connector_options) -> str | None:
    if template.secret_variable:
        return template.secret_variable
    options = connector_options.get(template.system_name, {})
    if not isinstance(options, dict):
        options = options.model_dump() if hasattr(options, "model_dump") else {}
    secrets = options.get("secrets", {})
    if isinstance(secrets, dict) and len(secrets) == 1:
        key, value = next(iter(secrets.items()))
        if isinstance(value, str) and value.startswith("env://"):
            return key
        return key
    return None


def _infer_value_type(value):
    if isinstance(value, bool):
        return "boolean"
    if type(value) is int:
        return "integer"
    if type(value) is float:
        return "number"
    if isinstance(value, (dict, list)):
        return "json"
    if isinstance(value, str):
        return "string"
    raise ValueError("Unsupported connector template parameter value type")


def _connector_parameter_rows(template: ConnectorTemplate, connector_options) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    base = [
        {
            "tool": template.system_name,
            "variable_name": "endpoint",
            "description": "Connector API endpoint",
            "value_type": "string",
            "default_value": template.default_endpoint,
            "allow_project_override": template.can_override,
            "visible_in_project": True,
            "icon": "link",
        },
        {
            "tool": template.system_name,
            "variable_name": "ui_base_url",
            "description": "Connector console base URL",
            "value_type": "string",
            "default_value": template.default_ui_base_url,
            "allow_project_override": template.can_override,
            "visible_in_project": True,
            "icon": "globe",
        },
        {
            "tool": template.system_name,
            "variable_name": "protocol",
            "description": "Connector transport protocol",
            "value_type": "string",
            "default_value": template.protocol,
            "allow_project_override": template.can_override,
            "visible_in_project": False,
            "icon": "radio",
        },
        {
            "tool": template.system_name,
            "variable_name": "auth_method",
            "description": "Authentication mechanism for the connector",
            "value_type": "string",
            "default_value": template.auth_method,
            "allow_project_override": template.can_override,
            "visible_in_project": False,
            "icon": "shield",
        },
        {
            "tool": template.system_name,
            "variable_name": "service_user",
            "description": "Connector service identity",
            "value_type": "string",
            "default_value": template.default_service_user,
            "allow_project_override": template.can_override,
            "visible_in_project": False,
            "icon": "user",
        },
        {
            "tool": template.system_name,
            "variable_name": "timeout_seconds",
            "description": "Connector request timeout in seconds",
            "value_type": "integer",
            "default_value": template.default_timeout_seconds,
            "allow_project_override": template.can_override,
            "visible_in_project": True,
            "icon": "clock",
        },
        {
            "tool": template.system_name,
            "variable_name": "retry_attempts",
            "description": "Connector retry attempts",
            "value_type": "integer",
            "default_value": template.default_retry_attempts,
            "allow_project_override": template.can_override,
            "visible_in_project": True,
            "icon": "rotate-cw",
        },
        {
            "tool": template.system_name,
            "variable_name": "retry_backoff_seconds",
            "description": "Connector retry backoff seconds",
            "value_type": "integer",
            "default_value": template.default_retry_backoff,
            "allow_project_override": template.can_override,
            "visible_in_project": True,
            "icon": "timer",
        },
        {
            "tool": template.system_name,
            "variable_name": "rate_limit",
            "description": "Connector rate limit policy",
            "value_type": "string",
            "default_value": template.default_rate_limit,
            "allow_project_override": template.can_override,
            "visible_in_project": True,
            "icon": "tachometer",
        },
    ]
    secret_variable = _resolve_secret_variable(template, connector_options)
    if template.default_secret and secret_variable:
        base.append(
            {
                "tool": template.system_name,
                "variable_name": secret_variable,
                "description": f"Secret reference for {template.system_name}",
                "value_type": "secret_ref",
                "default_value": f"env://{template.default_secret}",
                "allow_project_override": False,
                "visible_in_project": False,
                "icon": "key",
            }
        )
    for field in template.parameter_fields:
        rows.append(
            {
                "tool": template.system_name,
                "variable_name": _normalize_parameter_name(field.variable_name),
                "description": field.description,
                "value_type": field.value_type,
                "default_value": field.default_value,
                "allow_project_override": field.allow_project_override,
                "visible_in_project": field.visible_in_project,
                "icon": field.icon,
            }
        )
    for key, value in template.default_config.items():
        if not isinstance(key, str):
            continue
        rows.append(
            {
                "tool": template.system_name,
                "variable_name": _normalize_parameter_name(key),
                "description": f"Connector default config: {key}",
                "value_type": _infer_value_type(value),
                "default_value": value,
                "allow_project_override": template.can_override,
                "visible_in_project": True,
                "icon": "settings",
            }
        )
    for item in base:
        if item["default_value"] is not None:
            rows.append(item)
    deduplicated = []
    seen = set()
    for row in rows:
        key = (row["tool"], row["variable_name"])
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(row)
    return deduplicated


def _build_template_parameter_rows(
    tenant: str,
    connector_templates: tuple[ConnectorTemplate, ...],
    connector_options,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for template in connector_templates:
        for row in _connector_parameter_rows(template, connector_options):
            rows.append(
                {
                    "tenant_id": tenant,
                    "tool": row["tool"],
                    "variable_name": row["variable_name"],
                    "value_type": row["value_type"],
                    "description": row["description"],
                    "default_value": row["default_value"],
                    "allow_project_override": row["allow_project_override"],
                    "icon": row["icon"],
                    "project_visible": row["visible_in_project"],
                    "revision": 1,
                    "updated_at": time.time(),
                }
            )
    return rows


def _template_visibility_map(
    tenant: str,
    connector_templates: tuple[ConnectorTemplate, ...],
    connector_options,
) -> dict[tuple[str, str], bool]:
    rows = _build_template_parameter_rows(tenant, connector_templates, connector_options)
    return {
        (row["tool"], row["variable_name"]): row["project_visible"]
        for row in rows
    }


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
        if tool in {"itsm", "log_search"} and name in {
            "timeout_seconds", "max_response_bytes", "max_results", "max_window_seconds",
        }:
            from app.connectors.providers.registry import ConnectorOptions

            field = "timeout_s" if name == "timeout_seconds" else name
            ConnectorOptions.model_validate({field: value}, strict=True)
            if tool == "log_search" and name == "max_window_seconds" and value > 86400:
                raise ValueError("Splunk window limit cannot exceed one day")
        if re.search(r"(^|_)(password|token|secret|api_key|credential)(_|$)", name):
            validate_value("secret_ref", value)

    @staticmethod
    def native_connection_edit(p, tool, name, value):
        if tool not in {"itsm", "log_search"}:
            return
        if name in {"endpoint", "service_user"}:
            if Role.PLATFORM_ADMIN not in p.roles:
                raise PermissionError("Native connection changes require a platform administrator")
            if not isinstance(value, str) or not value.strip() or len(value) > 2048:
                raise ValueError("Connection values must be nonempty strings")
            if name == "endpoint":
                from urllib.parse import urlsplit

                url = urlsplit(value)
                if (url.scheme != "https" or not url.hostname or url.username or url.password
                        or url.query or url.fragment or any(c in value for c in "<>{}\\")
                        or any(c.isspace() for c in value)):
                    raise ValueError("Use an HTTPS endpoint without credentials or placeholders")
                _ = url.port

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
        self.native_connection_edit(p, tool, name, definition.default_value)
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

    async def delete_definition(self, p, tool, name, expected_revision):
        if Role.PLATFORM_ADMIN not in p.roles:
            raise PermissionError("Platform administrator required")
        key = self.key(definitions, p.tenant_id, tool, name)
        async with self.engine.begin() as c:
            row = (
                await c.execute(select(definitions).where(*key).with_for_update())
            ).first()
            if not row:
                raise ValueError("Parameter definition not found")
            if row.revision != expected_revision:
                raise ParameterConflict("Definition revision changed")
            await c.execute(
                delete(overrides).where(
                    *self.key(overrides, p.tenant_id, tool, name)
                )
            )
            await c.execute(delete(definitions).where(*key))
            await self.record(c, p, tool, name, "delete_definition", expected_revision)

    async def seed_connector_template_definitions(
        self,
        tenant: str,
        connector_templates: tuple[ConnectorTemplate, ...],
        connector_options,
    ) -> dict[str, int]:
        rows = _build_template_parameter_rows(
            tenant, tuple(connector_templates), connector_options
        )
        if not rows:
            return {"inserted": 0}
        inserted = 0
        async with self.engine.begin() as c:
            for row in rows:
                key = self.key(
                    definitions,
                    tenant,
                    row["tool"],
                    row["variable_name"],
                )
                existing = (await c.execute(select(definitions).where(*key))).first()
                if existing:
                    continue
                validate_value(row["value_type"], row["default_value"])
                self.runtime_value(row["tool"], row["variable_name"], row["default_value"])
                await c.execute(
                    insert(definitions).values(
                        tenant_id=tenant,
                        tool=row["tool"],
                        variable_name=row["variable_name"],
                        value_type=row["value_type"],
                        description=row["description"],
                        default_value=row["default_value"],
                        allow_project_override=row["allow_project_override"],
                        icon=row["icon"],
                        revision=1,
                        updated_at=time.time(),
                    )
                )
                inserted += 1
        return {"inserted": inserted}

    async def set_override(self, p, tool, name, body):
        if not set(p.roles) & {
            Role.PLATFORM_ADMIN,
            Role.PROJECT_OWNER,
            Role.PROJECT_MANAGER,
        }:
            raise PermissionError("Project owner or administrator required")
        body = ParameterOverride.model_validate(body.model_dump())
        self.native_connection_edit(p, tool, name, body.value)
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
            Role.PROJECT_OWNER,
            Role.PROJECT_MANAGER,
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

    async def resolve(
        self,
        tenant,
        project,
        connector_templates: tuple[ConnectorTemplate, ...] | tuple = (),
        connector_options=None,
    ):
        template_rows: list[dict[str, Any]] = []
        project_visible = _template_visibility_map(
            tenant,
            tuple(connector_templates),
            connector_options,
        )
        if connector_templates:
            template_rows = _build_template_parameter_rows(
                tenant,
                tuple(connector_templates),
                connector_options,
            )
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
        resolved_keys = set()
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
            key = (row["tool"], row["variable_name"])
            resolved_keys.add(key)
            resolved.append(
                dict(row)
                | {
                    "effective_value": value,
                    "source": "project" if row["override_revision"] else "platform",
                    "project_visible": project_visible.get(
                        (row["tool"], row["variable_name"]), True
                    ),
                }
            )
        for row in template_rows:
            key = (row["tool"], row["variable_name"])
            if key in resolved_keys:
                continue
            validate_value(row["value_type"], row["default_value"])
            self.runtime_value(row["tool"], row["variable_name"], row["default_value"])
            resolved.append(
                {
                    "tenant_id": tenant,
                    "tool": row["tool"],
                    "variable_name": row["variable_name"],
                    "value_type": row["value_type"],
                    "description": row["description"],
                    "default_value": row["default_value"],
                    "allow_project_override": row["allow_project_override"],
                    "icon": row["icon"],
                    "revision": 0,
                    "override_revision": None,
                    "effective_value": row["default_value"],
                    "source": "platform",
                    "project_visible": row["project_visible"],
                }
            )
        return resolved
