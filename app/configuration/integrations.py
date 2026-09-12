"""Scoped, data-only MCP and A2A registrations; no remote execution."""

import json
import uuid
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Column, MetaData, String, Table, delete, insert, select, text, update
from sqlalchemy.exc import IntegrityError

from app.identity.principals import Role
from app.persistence.database import initialize_tables, scoped_engine

metadata = MetaData(schema="platform")
registrations = Table(
    "integration_configurations", metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("integration_id", String(64), primary_key=True),
    Column("definition_json", String, nullable=False),
    Column("revision", String(32), nullable=False),
)


class IntegrationDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["mcp", "a2a"]
    endpoint: str = Field(min_length=1, max_length=2048)
    description: str = Field(default="", max_length=1000)
    auth_method: Literal["none", "bearer"] = "none"
    secret_reference: str = Field(default="", max_length=134)
    transport: Literal["streamable_http", "sse", "a2a_jsonrpc", "a2a_rest"]
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    allow_project_override: bool = True

    @model_validator(mode="after")
    def validate_connection(self):
        import re

        url = urlsplit(self.endpoint)
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.query or url.fragment or any(c.isspace() for c in self.endpoint)
                or any(c in self.endpoint for c in "<>{}\\")):
            raise ValueError("Use an HTTPS endpoint without credentials, query parameters, or placeholders")
        # Validate malformed ports even though registration never opens a connection.
        _ = url.port
        if self.auth_method == "bearer":
            if not re.fullmatch(r"env://[A-Z][A-Z0-9_]{0,127}", self.secret_reference):
                raise ValueError("Use an env:// credential reference, never a token")
        elif self.secret_reference:
            raise ValueError("Choose bearer authentication to supply a credential reference")
        transports = {"mcp": {"streamable_http", "sse"}, "a2a": {"a2a_jsonrpc", "a2a_rest"}}
        if self.transport not in transports[self.kind]:
            raise ValueError("Transport does not match integration type")
        return self


class IntegrationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition: IntegrationDefinition
    expected_revision: str = Field(default="", max_length=32)
    expected_platform_revision: str = Field(default="", max_length=32)


class IntegrationConflict(ValueError):
    pass


class IntegrationStore:
    def __init__(self, engine):
        self.engine = scoped_engine(engine)

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    @staticmethod
    def authorize(principal, scope):
        roles = {Role.PLATFORM_ADMIN} if scope == "platform" else {
            Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.PROJECT_OWNER, Role.PROJECT_MANAGER,
        }
        if not set(principal.roles) & roles:
            raise PermissionError("Your role cannot configure integrations at this scope")

    async def list(self, principal):
        async with self.engine.connect() as connection:
            rows = (await connection.execute(select(registrations).where(
                registrations.c.tenant_id == principal.tenant_id,
                registrations.c.project_id.in_(["", principal.project_id]),
            ))).mappings().all()
        defaults = {r["integration_id"]: r for r in rows if not r["project_id"]}
        projects = {r["integration_id"]: r for r in rows if r["project_id"]}
        result = []
        for integration_id in sorted(defaults.keys() | projects.keys()):
            base, project = defaults.get(integration_id), projects.get(integration_id)
            base_definition = json.loads(base["definition_json"]) if base else None
            effective = project if project and (not base or base_definition["allow_project_override"]) else base
            result.append({
                "id": integration_id,
                "definition": json.loads(effective["definition_json"]),
                "revision": effective["revision"],
                "platform_definition": base_definition,
                "platform_revision": base["revision"] if base else "",
                "project_revision": project["revision"] if project else "",
                "scope_level": "project_override" if effective is project and base else
                    "project_only" if effective is project else "platform_default",
            })
        return result

    async def save(self, principal, scope, integration_id, body):
        self.authorize(principal, scope)
        target = "" if scope == "platform" else principal.project_id
        table = registrations.c
        key = (table.tenant_id == principal.tenant_id, table.integration_id == integration_id)
        try:
            async with self.engine.begin() as connection:
                if self.engine.dialect.name == "postgresql":
                    await connection.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {
                        "key": json.dumps([principal.tenant_id, integration_id]),
                    })
                # Serialize default edits with project override writes.
                base = (await connection.execute(select(registrations).where(
                    *key, table.project_id == "",
                ).with_for_update())).mappings().first()
                if scope == "project" and base:
                    definition = json.loads(base["definition_json"])
                    if not definition["allow_project_override"]:
                        raise PermissionError("This platform integration does not allow project overrides")
                    if body.expected_platform_revision != base["revision"]:
                        raise IntegrationConflict("Platform settings changed; reload before saving")
                    if body.definition.kind != definition["kind"]:
                        raise ValueError("A project override must keep the platform integration type")
                elif body.expected_platform_revision:
                    raise IntegrationConflict("Platform settings changed; reload before saving")
                if scope == "platform":
                    project_exists = await connection.scalar(select(table.integration_id).where(
                        *key, table.project_id != "",
                    ).limit(1))
                    if project_exists and base is None:
                        raise IntegrationConflict("This ID is already used by a project integration")
                    if project_exists and not body.definition.allow_project_override:
                        raise IntegrationConflict("Remove project overrides before locking the platform default")
                current = (await connection.execute(select(registrations).where(
                    *key, table.project_id == target,
                ))).mappings().first()
                if current and json.loads(current["definition_json"])["kind"] != body.definition.kind:
                    raise ValueError("Create a new integration ID to change integration type")
                values = {"definition_json": body.definition.model_dump_json(), "revision": uuid.uuid4().hex}
                if body.expected_revision:
                    changed = await connection.execute(update(registrations).where(
                        *key, table.project_id == target, table.revision == body.expected_revision,
                    ).values(**values))
                    if changed.rowcount != 1:
                        raise IntegrationConflict("Settings changed; reload before saving")
                else:
                    await connection.execute(insert(registrations).values(
                        tenant_id=principal.tenant_id, project_id=target,
                        integration_id=integration_id, **values,
                    ))
        except IntegrityError:
            raise IntegrationConflict("Integration already exists; reload before saving") from None

    async def reset(self, principal, integration_id, expected_revision):
        self.authorize(principal, "project")
        async with self.engine.begin() as connection:
            changed = await connection.execute(delete(registrations).where(
                registrations.c.tenant_id == principal.tenant_id,
                registrations.c.project_id == principal.project_id,
                registrations.c.integration_id == integration_id,
                registrations.c.revision == expected_revision,
            ))
            if changed.rowcount != 1:
                raise IntegrationConflict("Settings changed; reload before removing project settings")
