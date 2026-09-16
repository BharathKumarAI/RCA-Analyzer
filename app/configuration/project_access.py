"""Reviewed access requests are proposals; only approval changes membership."""

import time
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import insert, or_, select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from app.configuration.parameters import audit, system_configurations
from app.configuration.projects import project_catalog
from app.identity.principals import Role
from app.persistence.platform_admin import platform_users
from app.runtime.run_contract import content_hash

REVIEWERS = {Role.PLATFORM_ADMIN.value, Role.PROJECT_OWNER.value}


class AccessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str = Field(min_length=1, max_length=256)
    requested_role: Literal["PROJECT_VIEWER", "PROJECT_ANALYST", "PROJECT_MANAGER", "PROJECT_OWNER"]
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value):
        if not value.strip():
            raise ValueError("Explain why this access is needed")
        return value.strip()


def verified_record(row):
    record = row["content_json"]
    proposal = {key: record[key] for key in ("id", "project_id", "requested_role", "requester_subject", "reason", "created_at")}
    if content_hash(proposal) != record["content_hash"]:
        raise ValueError("Access request failed integrity verification")
    AccessRequest.model_validate({key: proposal[key] for key in ("project_id", "requested_role", "reason")})
    return record


async def requests(store, principal):
    members, _ = await store.memberships(principal.subject)
    reviewable = {row["project_id"] for row in members if row["status"] == "active"
        and row["membership_status"] == "active" and REVIEWERS.intersection(row["roles"])}
    async with store.engine.connect() as connection:
        rows = (await connection.execute(select(system_configurations).where(
            system_configurations.c.tenant_id == principal.tenant_id,
            system_configurations.c.config_type == "project_access_request",
            or_(system_configurations.c.content_json["requester_subject"].as_string() == principal.subject,
                system_configurations.c.content_json["project_id"].as_string().in_(reviewable)))
            .order_by(system_configurations.c.updated_at.desc()).limit(200))).mappings().all()
    return [verified_record(row) | {"can_review": row["content_json"]["project_id"] in reviewable
        and row["content_json"]["requester_subject"] != principal.subject and row["content_json"]["status"] == "PENDING"} for row in rows]


async def submit(store, principal, payload):
    now = time.time()
    proposal = {"id": "access_" + uuid.uuid4().hex, "project_id": payload.project_id,
        "requested_role": payload.requested_role, "requester_subject": principal.subject,
        "reason": payload.reason, "created_at": now}
    record = proposal | {"status": "PENDING", "content_hash": content_hash(proposal),
        "reviewer_subject": None, "review_reason": None, "reviewed_at": None}
    async with store.engine.begin() as connection:
        target = await connection.scalar(select(project_catalog.c.project_id).where(
            project_catalog.c.tenant_id == principal.tenant_id,
            project_catalog.c.project_id == payload.project_id, project_catalog.c.status == "active"))
        if target is None:
            raise PermissionError("This project cannot accept an access request")
        await connection.execute(insert(system_configurations).values(tenant_id=principal.tenant_id,
            config_type="project_access_request", config_key=record["id"], content_json=record, revision=1, updated_at=now))
        await connection.execute(insert(audit).values(tenant_id=principal.tenant_id, project_id=payload.project_id,
            actor_subject=principal.subject, tool="project_access", variable_name=record["id"],
            action="submit", revision=1, created_at=now, details=record))
    return record | {"can_review": False}


async def review(store, principal, request_id, action, payload):
    try:
        async with store.engine.begin() as connection:
            scope = (system_configurations.c.tenant_id == principal.tenant_id,
                system_configurations.c.config_type == "project_access_request", system_configurations.c.config_key == request_id)
            row = (await connection.execute(select(system_configurations).where(*scope))).mappings().first()
            if row is None:
                raise PermissionError("This access request cannot be reviewed")
            record = verified_record(row)
            reviewer = await store.principal(principal.subject, record["project_id"])
            if not REVIEWERS.intersection(reviewer.roles) or record["requester_subject"] == principal.subject:
                raise PermissionError("A different owner or administrator of this project must review the request")
            if record["status"] != "PENDING" or record["content_hash"] != payload.expected_hash:
                raise ValueError("Access request changed. Reload before reviewing")
            now = time.time()
            reviewed = record | {"status": "APPROVED" if action == "approve" else "REJECTED",
                "reviewer_subject": principal.subject, "review_reason": payload.reason, "reviewed_at": now}
            changed = await connection.execute(update(system_configurations).where(*scope,
                system_configurations.c.revision == row["revision"]).values(content_json=reviewed,
                    revision=row["revision"] + 1, updated_at=now))
            if changed.rowcount != 1:
                raise ValueError("Access request changed. Reload before reviewing")
            if action == "approve":
                member_scope = (platform_users.c.tenant_id == principal.tenant_id,
                    platform_users.c.project_id == record["project_id"],
                    platform_users.c.subject == record["requester_subject"])
                member = (await connection.execute(select(platform_users).where(*member_scope).with_for_update())).mappings().first()
                if member and Role.PLATFORM_ADMIN.value in member["roles"] and Role.PLATFORM_ADMIN not in reviewer.roles:
                    raise PermissionError("Only a platform administrator can modify administrator membership")
                # Rejoining does not restore previously revoked privileges that
                # are absent from this exact reviewed proposal.
                previous_roles = member["roles"] if member and member["status"] == "active" else []
                roles = sorted(set(previous_roles) | {record["requested_role"]})
                if member:
                    changed = await connection.execute(update(platform_users).where(*member_scope,
                        platform_users.c.updated_at == member["updated_at"]).values(roles=roles, status="active", updated_at=now))
                    if changed.rowcount != 1:
                        raise ValueError("Membership changed. Reload before reviewing")
                else:
                    await connection.execute(insert(platform_users).values(tenant_id=principal.tenant_id,
                        project_id=record["project_id"], subject=record["requester_subject"],
                        name=record["requester_subject"], email=None, roles=roles, status="active", created_at=now, updated_at=now))
            await connection.execute(insert(audit).values(tenant_id=principal.tenant_id, project_id=record["project_id"],
                actor_subject=principal.subject, tool="project_access", variable_name=request_id,
                action=action, revision=row["revision"] + 1, created_at=now, details=reviewed))
        return reviewed | {"can_review": False}
    except IntegrityError:
        raise ValueError("Membership changed. Reload before reviewing") from None
    except OperationalError as exc:
        if "locked" in str(exc.orig).lower() or "busy" in str(exc.orig).lower():
            raise ValueError("Access request is being reviewed. Reload before trying again") from None
        raise
