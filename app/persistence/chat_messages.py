"""Owner-scoped conversation turns that do not create an investigation run."""

import json
import time
import uuid

from sqlalchemy import Column, Float, Integer, MetaData, String, Table, insert, select

from app.persistence.database import initialize_tables
from app.policy.redaction import redact

metadata = MetaData(schema="runtime")
messages = Table(
    "chat_messages", metadata,
    Column("sequence", Integer, primary_key=True, autoincrement=True),
    Column("message_id", String(64), nullable=False, unique=True),
    Column("exchange_id", String(64), nullable=False),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False),
    Column("chat_id", String(128), nullable=False, index=True),
    Column("role", String(16), nullable=False),
    Column("content", String, nullable=False),
    Column("kind", String(32), nullable=False),
    Column("reason_code", String(64)),
    Column("choices_json", String, nullable=False),
    Column("attachment_ids_json", String, nullable=False),
    Column("created_at", Float, nullable=False),
)


async def initialize(engine):
    await initialize_tables(engine, metadata)


def scope(principal, chat_id):
    return (messages.c.tenant_id == principal.tenant_id,
            messages.c.project_id == principal.project_id,
            messages.c.subject == principal.subject, messages.c.chat_id == chat_id)


def view(row):
    return {"id": row["message_id"], **{key: row[key] for key in (
        "exchange_id", "sequence", "role", "content", "kind", "reason_code", "created_at",
    )}, "choices": json.loads(row["choices_json"]),
        "attachment_ids": json.loads(row["attachment_ids_json"])}


async def save_exchange(store, principal, chat_id, prompt, resolution):
    await store.require_chat(chat_id, principal)
    exchange_id = "exchange_" + uuid.uuid4().hex
    shared = {"exchange_id": exchange_id, "tenant_id": principal.tenant_id,
              "project_id": principal.project_id, "subject": principal.subject,
              "chat_id": chat_id, "created_at": time.time(),
              "attachment_ids_json": json.dumps(resolution.attachment_ids)}
    async with store.engine.begin() as connection:
        for role, content, kind, choices, reason in (
            ("user", prompt, "question", [], None),
            ("assistant", resolution.message, resolution.status,
             [choice.model_dump() for choice in resolution.choices], resolution.reason_code),
        ):
            message_id = "msg_" + uuid.uuid4().hex
            await connection.execute(insert(messages).values(**shared, message_id=message_id,
                role=role, content=redact(content), kind=kind, choices_json=json.dumps(choices), reason_code=reason))
    return exchange_id, message_id


async def list_messages(store, principal, chat_id, limit=100, before=None):
    await store.require_chat(chat_id, principal)
    query = select(messages).where(*scope(principal, chat_id))
    if before is not None:
        query = query.where(messages.c.sequence < before)
    async with store.engine.connect() as connection:
        rows = (await connection.execute(query.order_by(messages.c.sequence.desc()).limit(limit))).mappings().all()
    return [view(row) for row in reversed(rows)]
