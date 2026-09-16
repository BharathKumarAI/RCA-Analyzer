"""Tenant-owned projects, independently verified memberships, and project selection."""

import time
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Column, Float, MetaData, String, Table, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.configuration.database_bundle import active, bundles, metadata as bundle_metadata, validate_files
from app.configuration.parameters import projects, audit
from app.connectors.providers.project_storage import project_prefix
from app.identity.principals import Role, UserPrincipal
from app.persistence.database import initialize_tables
from app.persistence.platform_admin import platform_users, project_editor_drafts
from app.runtime.run_contract import content_hash
from app.policy.redaction import redact

metadata = MetaData(schema="platform")
project_catalog = Table("project_catalog", metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", String(4000), nullable=False),
    Column("timezone", String(100), nullable=False),
    Column("status", String(32), nullable=False),
    Column("created_by", String(256), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False))
project_preferences = Table("project_preferences", metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("subject", String(256), primary_key=True),
    Column("project_id", String(256), nullable=False),
    Column("last_accessed_at", Float, nullable=False))


class ProjectDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    timezone: str = Field(default="UTC", min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def named(cls, value):
        if not value.strip():
            raise ValueError("Project name cannot be blank")
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def timezone_exists(cls, value):
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("Choose a valid timezone") from None
        return value


class ProjectCreate(ProjectDetails):
    project_id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


class ProjectLifecycleChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["deactivate", "activate", "archive", "restore"]
    expected_hash: str = Field(min_length=1, max_length=80)
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def explanation(cls, value):
        if not value.strip():
            raise ValueError("Explain this project lifecycle change")
        return value.strip()


LIFECYCLE_TRANSITIONS = {"deactivate": ("active", "inactive"), "activate": ("inactive", "active"),
                         "archive": ("inactive", "archived"), "restore": ("archived", "inactive")}
LIFECYCLE_ROLES = {Role.PLATFORM_ADMIN.value, Role.PROJECT_OWNER.value}


def lifecycle_view(row):
    fields = {key: row[key] for key in ("project_id", "name", "description", "timezone", "status", "updated_at")}
    return fields | {"content_hash": content_hash(fields), "actions": [
        action for action, (before, _after) in LIFECYCLE_TRANSITIONS.items() if row["status"] == before]}


async def apply_project_details(connection, settings, expected_editor_version):
    """Publish validated display details with the same transaction as its setup."""
    scope = (project_editor_drafts.c.tenant_id == settings.tenant_id,
             project_editor_drafts.c.project_id == settings.project_id)
    draft = (await connection.execute(select(project_editor_drafts).where(*scope)
        .with_for_update())).mappings().first()
    if draft is None or draft["version"] != expected_editor_version:
        raise ValueError("Project draft changed; reload and review before applying")
    data = draft["document"]["metadata"]
    details = ProjectDetails(name=data["name"],
        description=data["objective"], timezone=data["timezone"])
    result = await connection.execute(update(project_catalog).where(
        project_catalog.c.tenant_id == settings.tenant_id,
        project_catalog.c.project_id == settings.project_id,
        project_catalog.c.status == "active").values(name=details.name,
            description=details.description, timezone=details.timezone, updated_at=time.time()))
    if result.rowcount != 1:
        raise ValueError("Project is no longer available; reload before applying")


class ProjectStore:
    def __init__(self, engine, settings):
        self.engine, self.settings = engine, settings

    async def initialize(self):
        await initialize_tables(self.engine, metadata)
        await initialize_tables(self.engine, bundle_metadata)
        if not self.settings.tenant_id or not self.settings.project_id:
            return
        # Import the existing deployment once; subsequent membership changes win.
        try:
            async with self.engine.begin() as connection:
                where = self._scope(project_catalog, self.settings.project_id)
                if await connection.scalar(select(project_catalog.c.project_id).where(*where)):
                    return
                now = time.time()
                if not await connection.scalar(select(projects.c.project_id).where(*self._scope(projects, self.settings.project_id))):
                    await connection.execute(insert(projects).values(tenant_id=self.settings.tenant_id,
                        project_id=self.settings.project_id, project_name=self.settings.project_id))
                await connection.execute(insert(project_catalog).values(tenant_id=self.settings.tenant_id,
                    project_id=self.settings.project_id, name=self.settings.project_id, description="",
                    timezone="UTC", status="active", created_by="deployment", created_at=now, updated_at=now))
                for principal in self.settings.principals.values():
                    if (principal.tenant_id, principal.project_id) != (self.settings.tenant_id, self.settings.project_id):
                        continue
                    exists = await connection.scalar(select(platform_users.c.subject).where(
                        *self._scope(platform_users, principal.project_id), platform_users.c.subject == principal.subject))
                    if not exists:
                        await connection.execute(insert(platform_users).values(tenant_id=principal.tenant_id,
                            project_id=principal.project_id, subject=principal.subject, name=principal.username,
                            email=principal.username if "@" in principal.username else None,
                            roles=[role.value for role in principal.roles], status="active", created_at=now, updated_at=now))
        except IntegrityError:
            # A second worker may have imported the same deployment concurrently.
            async with self.engine.connect() as connection:
                if not await connection.scalar(select(project_catalog.c.project_id).where(*self._scope(project_catalog, self.settings.project_id))):
                    raise

    def _scope(self, table, project_id):
        return table.c.tenant_id == self.settings.tenant_id, table.c.project_id == project_id

    async def memberships(self, subject):
        async with self.engine.connect() as connection:
            rows = (await connection.execute(select(project_catalog, platform_users.c.roles,
                platform_users.c.status.label("membership_status"), platform_users.c.email)
                .join(platform_users, (platform_users.c.tenant_id == project_catalog.c.tenant_id)
                    & (platform_users.c.project_id == project_catalog.c.project_id))
                .where(project_catalog.c.tenant_id == self.settings.tenant_id, platform_users.c.subject == subject)
                .order_by(project_catalog.c.name, project_catalog.c.project_id))).mappings().all()
            preference = (await connection.execute(select(project_preferences).where(
                project_preferences.c.tenant_id == self.settings.tenant_id,
                project_preferences.c.subject == subject))).mappings().first()
        return [dict(row) for row in rows], dict(preference) if preference else None

    async def principal(self, subject, selected=None, *, allow_management=False):
        rows, preference = await self.memberships(subject)
        available = {row["project_id"]: row for row in rows
                     if row["status"] == "active" and row["membership_status"] == "active"}
        managed = [row for row in rows if row["membership_status"] == "active"
                   and row["status"] in {"inactive", "archived"} and LIFECYCLE_ROLES.intersection(row["roles"])]
        if allow_management and ((selected is not None and any(row["project_id"] == selected for row in managed))
                                 or (selected is None and not available and managed)):
            # Identity-only recovery grants no project access or administrator role.
            # Lifecycle handlers independently recheck membership in their target.
            return UserPrincipal(subject=subject, username=subject, tenant_id=self.settings.tenant_id,
                                 project_id="", roles=(Role.GENERIC_USER,))
        if selected is not None and selected not in available:
            raise PermissionError("You do not have active access to this project")
        target = selected or next((key for key in (
            preference["project_id"] if preference else None, self.settings.project_id, *available)
            if key in available), None)
        if target is None:
            # Platform-only experiment users do not acquire project membership.
            # This bootstrap fallback cannot revive a persisted inactive member.
            fallback = self.settings.principals.get(subject) if selected is None and not rows else None
            if (fallback and fallback.tenant_id == self.settings.tenant_id and fallback.roles
                    and set(fallback.roles) <= {Role.GENERIC_USER}):
                return fallback.model_copy(update={"project_id": ""})
            raise PermissionError("No active project membership for this identity")
        row = available[target]
        try:
            roles = tuple(Role(role) for role in row["roles"])
        except ValueError:
            raise PermissionError("This identity has invalid project roles") from None
        if not roles:
            raise PermissionError("An active project role is required")
        generic = set(roles) <= {Role.GENERIC_USER}
        return UserPrincipal(subject=subject, username=row["email"] or subject,
            tenant_id=self.settings.tenant_id, project_id="" if generic else target, roles=roles)

    async def catalog(self, principal):
        rows, preference = await self.memberships(principal.subject)
        return {"items": [{key: row[key] for key in ("project_id", "name", "description", "timezone", "status", "roles")}
                | {"last_accessed_at": preference["last_accessed_at"] if preference and preference["project_id"] == row["project_id"] else None}
                for row in rows if row["status"] == "active" and row["membership_status"] == "active"
                and set(row["roles"]) - {Role.GENERIC_USER.value}],
            "current_project_id": principal.project_id, "can_create": Role.PLATFORM_ADMIN in principal.roles}

    async def management(self, principal):
        rows, _ = await self.memberships(principal.subject)
        return {"items": [lifecycle_view(row) for row in rows if row["membership_status"] == "active"
                          and LIFECYCLE_ROLES.intersection(row["roles"])]}

    async def change_lifecycle(self, principal, project_id, payload):
        if principal.tenant_id != self.settings.tenant_id:
            raise PermissionError("Project is outside this tenant")
        async with self.engine.begin() as connection:
            row = (await connection.execute(select(project_catalog).where(
                *self._scope(project_catalog, project_id)).with_for_update())).mappings().first()
            member = (await connection.execute(select(platform_users).where(
                *self._scope(platform_users, project_id), platform_users.c.subject == principal.subject
            ).with_for_update())).mappings().first()
            if row is None or member is None or member["status"] != "active" or not LIFECYCLE_ROLES.intersection(member["roles"]):
                raise PermissionError("An active owner or administrator membership in this project is required")
            if lifecycle_view(row)["content_hash"] != payload.expected_hash:
                raise ValueError("Project changed; refresh and review its current state")
            before, after = LIFECYCLE_TRANSITIONS[payload.action]
            if row["status"] != before:
                raise ValueError(f"{payload.action.title()} requires an {before} project")
            now = time.time()
            changed = await connection.execute(update(project_catalog).where(
                *self._scope(project_catalog, project_id), project_catalog.c.updated_at == row["updated_at"],
                project_catalog.c.status == before).values(status=after, updated_at=now))
            if changed.rowcount != 1:
                raise ValueError("Project changed; refresh and review its current state")
            await connection.execute(insert(audit).values(tenant_id=principal.tenant_id, project_id=project_id,
                actor_subject=principal.subject, tool="projects", variable_name=project_id,
                action=payload.action, revision=1, created_at=now,
                details={"from": before, "to": after, "expected_hash": payload.expected_hash, "reason": redact(payload.reason)}))
        return lifecycle_view(dict(row) | {"status": after, "updated_at": now})

    async def select(self, subject, project_id):
        principal = await self.principal(subject, project_id)
        if not principal.project_id:
            raise PermissionError("An active project membership is required")
        now = time.time()
        # Each click updates only this subject's preference, never membership.
        async with self.engine.begin() as connection:
            values = dict(tenant_id=self.settings.tenant_id, subject=subject, project_id=project_id, last_accessed_at=now)
            if connection.dialect.name == "postgresql":
                from sqlalchemy.dialects.postgresql import insert as upsert
            else:
                from sqlalchemy.dialects.sqlite import insert as upsert
            await connection.execute(upsert(project_preferences).values(**values).on_conflict_do_update(
                index_elements=["tenant_id", "subject"], set_={"project_id": project_id, "last_accessed_at": now}))
        return principal

    async def create(self, principal, payload, state):
        if Role.PLATFORM_ADMIN not in principal.roles:
            raise PermissionError("Only a platform administrator can create a project")
        files = {}
        for prefix, directory, pattern in (
            ("config", state.settings.config_dir, "**/*.yaml"),
            ("capabilities", state.settings.content_root / "capabilities", "**/*.yaml"),
            ("skills", state.settings.content_root / "skills", "*/SKILL.md"),
        ):
            for path in directory.glob(pattern):
                files[f"{prefix}/{path.relative_to(directory)}"] = path.read_text()
        policy = state.settings.content_root / "layers" / "platform.yaml"
        if policy.exists():
            files["layers/platform.yaml"] = policy.read_text()
        # Managed skills remain tenant database records. An effective export
        # would flatten them into files and import the same skill a second time.
        # Only the platform's declarative baseline is inherited. No source-project
        # layers, members, evidence, documents, or connection bindings are copied.
        relative = "projects/" + project_prefix(principal.tenant_id, payload.project_id) + "/configuration/project.yaml"
        files[relative] = yaml.safe_dump({"tenant_id": principal.tenant_id, "project_id": payload.project_id})
        validate_files(files)
        digest, now = content_hash(files), time.time()
        record = dict(tenant_id=principal.tenant_id, project_id=payload.project_id,
            name=payload.name, description=payload.description, timezone=payload.timezone,
            status="active", created_by=principal.subject, created_at=now, updated_at=now)
        roles = [Role.PLATFORM_ADMIN.value, Role.PROJECT_OWNER.value]
        try:
            async with self.engine.begin() as connection:
                await connection.execute(insert(projects).values(tenant_id=principal.tenant_id,
                    project_id=payload.project_id, project_name=payload.name))
                await connection.execute(insert(project_catalog).values(**record))
                await connection.execute(insert(platform_users).values(tenant_id=principal.tenant_id,
                    project_id=payload.project_id, subject=principal.subject, name=principal.username,
                    email=principal.username if "@" in principal.username else None,
                    roles=roles, status="active", created_at=now, updated_at=now))
                await connection.execute(insert(bundles).values(tenant_id=principal.tenant_id,
                    project_id=payload.project_id, content_hash=digest, files=files, created_at=now))
                await connection.execute(insert(active).values(tenant_id=principal.tenant_id,
                    project_id=payload.project_id, content_hash=digest))
                await connection.execute(insert(project_editor_drafts).values(tenant_id=principal.tenant_id,
                    project_id=payload.project_id, version=1, updated_at=now, document={
                        "metadata": {"id": payload.project_id, "name": payload.name, "objective": payload.description,
                            "timezone": payload.timezone, "status": "active", "responsibility": []},
                        "projectScope": {"members": {"owners": [{"id": principal.subject}]}}}))
                await connection.execute(insert(audit).values(tenant_id=principal.tenant_id,
                    project_id=payload.project_id, actor_subject=principal.subject, tool="projects",
                    variable_name=payload.project_id, action="create", revision=1, created_at=now,
                    details={"name": payload.name, "baseline_hash": digest}))
        except IntegrityError:
            raise ValueError("A project with this key already exists") from None
        return {key: record[key] for key in ("project_id", "name", "description", "timezone", "status")} | {"roles": roles, "last_accessed_at": None}
