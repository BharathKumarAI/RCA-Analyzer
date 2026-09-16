"""Explicit administrator pricing; no inferred vendor rates or invoice claims."""

import time
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from app.configuration.parameters import audit, system_configurations
from app.identity.principals import Role
from app.runtime.run_contract import content_hash
from app.configuration.knowledge import KnowledgeReview


class ModelRate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    input_per_million: float = Field(ge=0, le=1000000)
    output_per_million: float = Field(ge=0, le=1000000)
    cached_input_per_million: float | None = Field(default=None, ge=0, le=1000000)


class PricingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    rates: dict[Annotated[str, Field(min_length=1, max_length=128)], ModelRate] = Field(max_length=128)


async def _read(connection, principal):
    row = (await connection.execute(select(system_configurations).where(
        system_configurations.c.tenant_id == principal.tenant_id,
        system_configurations.c.config_type == "model_pricing",
        system_configurations.c.config_key == "rates",
    ))).mappings().first()
    if row:
        for name in ("active", "proposal"):
            candidate = row["content_json"].get(name)
            if not candidate:
                continue
            if candidate.get("content_hash") != content_hash(candidate.get("rates")):
                raise ValueError("Model pricing failed integrity verification")
            for rate in candidate["rates"].values():
                ModelRate.model_validate(rate)
            if name == "active" and (candidate.get("status") != "APPROVED" or not candidate.get("reviewer_subject")
                    or candidate["reviewer_subject"] == candidate.get("author_subject")):
                raise ValueError("Active model pricing has no independent approval")
    return row


def _view(row, principal):
    record = row["content_json"] if row else {}
    active = record.get("active") or {}
    proposal = record.get("proposal")
    return {"revision": row["revision"] if row else 0, "currency": "USD",
            "rates": active.get("rates", {}), "active_revision": active.get("revision"),
            "active_hash": active.get("content_hash"), "proposal": proposal,
            "can_review": Role.PLATFORM_ADMIN in principal.roles and bool(proposal)
                and proposal["author_subject"] != principal.subject}


async def read_pricing(engine, principal):
    async with engine.connect() as connection:
        row = await _read(connection, principal)
    return _view(row, principal)


async def pricing_snapshot(engine, principal):
    value = await read_pricing(engine, principal)
    return {"revision": value["active_revision"], "content_hash": value["active_hash"],
            "currency": "USD", "rates": value["rates"]}


async def _write(connection, principal, expected_revision, record, action, candidate):
    values = {"content_json": record, "revision": expected_revision + 1, "updated_at": time.time()}
    if expected_revision:
        result = await connection.execute(update(system_configurations).where(
            system_configurations.c.tenant_id == principal.tenant_id,
            system_configurations.c.config_type == "model_pricing", system_configurations.c.config_key == "rates",
            system_configurations.c.revision == expected_revision,
        ).values(**values))
        if result.rowcount != 1:
            raise ValueError("Model prices changed. Reload before saving.")
    else:
        await connection.execute(insert(system_configurations).values(
            tenant_id=principal.tenant_id, config_type="model_pricing", config_key="rates", **values))
    await connection.execute(insert(audit).values(
        tenant_id=principal.tenant_id, project_id=principal.project_id,
        tool="model_pricing", variable_name="rates", action=action,
        actor_subject=principal.subject, revision=values["revision"], created_at=time.time(), details=candidate))
    return _view(values, principal)


async def save_pricing(engine, principal, payload):
    if Role.PLATFORM_ADMIN not in principal.roles:
        raise PermissionError("Platform administrator access is required to configure model prices")
    rates = {model: rate.model_dump(exclude_none=True) for model, rate in payload.rates.items()}
    candidate = {"rates": rates, "status": "PENDING", "author_subject": principal.subject,
                 "project_id": principal.project_id, "content_hash": content_hash(rates),
                 "revision": payload.expected_revision + 1, "submitted_at": time.time()}
    try:
        async with engine.begin() as connection:
            previous = await _read(connection, principal)
            if (previous["revision"] if previous else 0) != payload.expected_revision:
                raise ValueError("Model prices changed. Reload before saving.")
            active = previous["content_json"].get("active") if previous else None
            return await _write(connection, principal, payload.expected_revision,
                {"active": active, "proposal": candidate}, "submit", candidate)
    except IntegrityError:
        raise ValueError("Model prices changed. Reload before saving.") from None


async def review_pricing(engine, principal, action, payload: KnowledgeReview):
    if Role.PLATFORM_ADMIN not in principal.roles:
        raise PermissionError("Platform administrator access is required to review model prices")
    async with engine.begin() as connection:
        row = await _read(connection, principal)
        record = row["content_json"] if row else {}
        candidate = record.get("active" if action == "revoke" else "proposal")
        if not candidate or candidate["content_hash"] != payload.expected_hash or candidate["status"] != ("APPROVED" if action == "revoke" else "PENDING"):
            raise ValueError("Model prices changed. Reload before reviewing.")
        if candidate["project_id"] != principal.project_id:
            raise PermissionError("Price review requires the author's project scope")
        if action != "revoke" and candidate["author_subject"] == principal.subject:
            raise PermissionError("A different platform administrator must review model prices")
        reviewed = candidate | {"status": {"approve": "APPROVED", "reject": "REJECTED", "revoke": "REVOKED"}[action],
            "reviewer_subject": principal.subject, "reviewed_at": time.time(), "reason": payload.reason}
        record = dict(record)
        if action == "approve":
            record["active"] = reviewed
        elif action == "revoke":
            record["active"] = None
        if action != "revoke" or (record.get("proposal") or {}).get("content_hash") == candidate["content_hash"]:
            record["proposal"] = reviewed
        return await _write(connection, principal, row["revision"], record, action, reviewed)
