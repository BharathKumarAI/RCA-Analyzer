"""Durable persistence for platform admin management: users, roles, billing, policy, storage, knowledge, alerts, runtime stages, and settings."""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import (
    Boolean,
    Column,
    Float,
    Integer,
    JSON,
    MetaData,
    String,
    Table,
    delete,
    insert,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.exc import IntegrityError
from app.persistence.database import scoped_engine, initialize_tables

metadata = MetaData(schema="platform")

platform_users = Table(
    "platform_users",
    metadata,
    Column("subject", String(256), primary_key=True),
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("name", String(256), nullable=False),
    Column("email", String(256), nullable=True),
    Column("roles", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("status", String(32), nullable=False, default="active"),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

platform_roles = Table(
    "platform_roles",
    metadata,
    Column("role_id", String(64), primary_key=True),
    Column("tenant_id", String(256), primary_key=True),
    Column("name", String(256), nullable=False),
    Column("description", String(1000), nullable=False),
    Column("permissions", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("is_system", Boolean, nullable=False, default=False),
    Column("status", String(32), nullable=False, default="active"),
    Column("updated_at", Float, nullable=False),
)

platform_billing = Table(
    "platform_billing",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("tier", String(64), nullable=False, default="Standard"),
    Column("monthly_spend_budget", Float, nullable=False, default=500.0),
    Column("monthly_token_budget", Integer, nullable=False, default=50000000),
    Column("max_concurrent_investigations", Integer, nullable=False, default=4),
    Column("rate_limit_rpm", Integer, nullable=False, default=60),
    Column("rate_limit_tpm", Integer, nullable=False, default=250000),
    Column("alert_threshold_percent", Integer, nullable=False, default=80),
    Column("webhook_url", String(1024), nullable=True),
    Column("pricing_matrix", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("updated_at", Float, nullable=False),
)

platform_policy = Table(
    "platform_policy",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("redaction_patterns", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("guardrails", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("skill_guardrails", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("updated_at", Float, nullable=False),
)

platform_file_limits = Table(
    "platform_file_limits",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("max_file_bytes", Integer, nullable=False, default=10485760),
    Column("max_files", Integer, nullable=False, default=10),
    Column("max_text_chars", Integer, nullable=False, default=50000),
    Column("max_pdf_pages", Integer, nullable=False, default=20),
    Column("max_rows", Integer, nullable=False, default=2000),
    Column("max_cells", Integer, nullable=False, default=20000),
    Column("parser_timeout_seconds", Integer, nullable=False, default=30),
    Column("concurrency", Integer, nullable=False, default=4),
    Column("allowed_extensions", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("retention_days", Integer, nullable=False, default=90),
    Column("auto_prune_enabled", Boolean, nullable=False, default=True),
    Column("updated_at", Float, nullable=False),
)

platform_knowledge = Table(
    "platform_knowledge",
    metadata,
    Column("doc_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("title", String(256), nullable=False),
    Column("category", String(128), nullable=False, default="Runbooks"),
    Column("tags", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("content", String, nullable=False),
    Column("media_type", String(64), nullable=False, default="text/markdown"),
    Column("size_bytes", Integer, nullable=False, default=0),
    Column("status", String(32), nullable=False, default="active"),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

platform_alerts = Table(
    "platform_alerts",
    metadata,
    Column("alert_id", String(128), primary_key=True),
    Column("tenant_id", String(256), nullable=False),
    Column("project_id", String(256), nullable=False),
    Column("severity", String(32), nullable=False, default="warning"),
    Column("source", String(64), nullable=False, default="operator"),
    Column("component", String(128), nullable=False, default="platform"),
    Column("title", String(256), nullable=False),
    Column("summary", String(1000), nullable=False),
    Column("message", String, nullable=False),
    Column("status", String(32), nullable=False, default="open"),
    Column("resolution_note", String, nullable=True),
    Column("created_at", Float, nullable=False),
    Column("resolved_at", Float, nullable=True),
)

platform_alert_config = Table(
    "platform_alert_config",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("mttr_warning_minutes", Integer, nullable=False, default=45),
    Column("tool_failure_rate_percent", Integer, nullable=False, default=15),
    Column("probe_latency_warning_ms", Integer, nullable=False, default=2500),
    Column("updated_at", Float, nullable=False),
)

platform_notification_reads = Table(
    "platform_notification_reads",
    metadata,
    Column("notification_id", String(128), primary_key=True),
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("subject", String(256), primary_key=True),
    Column("read_at", Float, nullable=False),
)

platform_runtime_stages = Table(
    "platform_runtime_stages",
    metadata,
    Column("stage_id", String(64), primary_key=True),
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("name", String(256), nullable=False),
    Column("model", String(128), nullable=False),
    Column("thinking_level", String(64), nullable=False, default="medium"),
    Column("thinking_budget", Integer, nullable=False, default=2048),
    Column("output_limit", Integer, nullable=False, default=4096),
    Column("temperature", Float, nullable=False, default=0.2),
    Column("tool_limit", Integer, nullable=False, default=10),
    Column("tools", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("instruction", String, nullable=False),
    Column("enabled", Boolean, nullable=False, default=True),
    Column("updated_at", Float, nullable=False),
)

platform_settings = Table(
    "platform_settings",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("run_timeout_seconds", Integer, nullable=False, default=120),
    Column("max_concurrent_runs", Integer, nullable=False, default=4),
    Column("max_llm_calls", Integer, nullable=False, default=12),
    Column("max_input_chars", Integer, nullable=False, default=16000),
    Column("max_context_chars", Integer, nullable=False, default=64000),
    Column("retention_days", Integer, nullable=False, default=90),
    Column("allowed_extensions", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("mode", String(32), nullable=False, default="demo"),
    Column("updated_at", Float, nullable=False),
)

platform_ui_settings = Table(
    "platform_ui_settings",
    metadata,
    Column("tenant_id", String(256), primary_key=True),
    Column("project_id", String(256), primary_key=True),
    Column("brand_name", String(120), nullable=False, default="RCA Analyzer"),
    Column("workspace_label", String(120), nullable=False, default="Investigation workspace"),
    Column("default_theme", String(16), nullable=False, default="light"),
    Column("default_page", String(64), nullable=False, default="overview"),
    Column("welcome_title", String(200), nullable=False, default="Investigate with confidence"),
    Column("welcome_description", String(1000), nullable=False, default="Trace incidents from evidence to action."),
    Column("navigation", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("version", Integer, nullable=False, default=1),
    Column("updated_at", Float, nullable=False),
)

project_editor_drafts = Table(
    "project_editor_drafts", metadata,
    Column("tenant_id", String(256), primary_key=True), Column("project_id", String(256), primary_key=True),
    Column("document", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("version", Integer, nullable=False, default=1), Column("updated_at", Float, nullable=False),
)


DEFAULT_PERMISSIONS = [
    "view_runs",
    "create_runs",
    "approve_agents",
    "manage_policy",
    "manage_connectors",
    "manage_parameters",
    "manage_users",
    "manage_billing",
    "trigger_cleanup",
    "view_docs",
    "view_status",
    "view_audit",
]

DEFAULT_UI_NAVIGATION = [
    {"page": page, "label": label, "description": description, "group": group, "visible": True}
    for page, label, description, group in (
        ("overview", "Overview", "Health and recent investigations", "Admin console"),
        ("runs", "Investigations", "Review grounded incident reports", "Monitoring"),
        ("capabilities", "Capabilities", "Manage investigation capabilities", "Configuration"),
        ("skills", "Skills", "Manage reusable agent guidance", "Configuration"),
        ("runtime", "Runtime", "Tune execution stages", "Monitoring"),
        ("parameters", "Parameters", "Manage tool parameters", "Configuration"),
        ("optimization", "Optimization", "Review evaluation workflows", "Monitoring"),
        ("agents", "Agents", "Review specialist agents", "Configuration"),
        ("tools", "Tools & connectors", "Manage data access", "Configuration"),
        ("alerts", "Alerts", "Track operational alerts", "Monitoring"),
        ("health-checks", "Health checks", "Inspect connector health", "Monitoring"),
        ("project-setup", "Project setup", "Configure project behavior", "Admin console"),
        ("persistence", "Persistence", "Manage storage and retention", "Monitoring"),
        ("policy", "Policy", "Manage security guardrails", "Configuration"),
        ("roles", "Roles", "Manage access roles", "Admin console"),
        ("governance", "Audit", "Review configuration history", "Monitoring"),
        ("knowledge", "Knowledge", "Manage runbooks and evidence", "Workspace"),
        ("users", "Users", "Manage project membership", "Admin console"),
        ("billing", "Billing", "Manage budgets and quotas", "Monitoring"),
        ("settings", "Platform settings", "Configure the workspace", "Admin console"),
        ("harness-library", "Harness library", "Manage workflow templates", "Configuration"),
    )
]

DEFAULT_SYSTEM_ROLES = [
    {
        "role_id": "PLATFORM_ADMIN",
        "name": "Platform Administrator",
        "description": "Full authority across global platform topology, persistence, runtime configuration, user directories, security policy, connectors, and billing.",
        "permissions": DEFAULT_PERMISSIONS,
        "is_system": True,
    },
    {
        "role_id": "PROJECT_OWNER",
        "name": "Project Owner",
        "description": "Owns project-level configuration, custom specialist agent approvals, parameter overrides, team memberships, and budget allocations.",
        "permissions": [
            "view_runs",
            "create_runs",
            "approve_agents",
            "manage_parameters",
            "manage_users",
            "manage_billing",
            "view_docs",
            "view_status",
            "view_audit",
        ],
        "is_system": True,
    },
    {
        "role_id": "PROJECT_MANAGER",
        "name": "Project Manager",
        "description": "Governs team resource allocation, SLA metrics, parameter governance, user membership, and budget monitoring across the project. Not authorized for incident triage or active log analysis.",
        "permissions": [
            "view_runs",
            "approve_agents",
            "manage_parameters",
            "manage_users",
            "manage_billing",
            "view_docs",
            "view_status",
            "view_audit",
        ],
        "is_system": True,
    },
    {
        "role_id": "PROJECT_ANALYST",
        "name": "Project Analyst",
        "description": "Conducts deep incident investigations, executes triage workflows, uploads diagnostic evidence bundles, and correlates log anomalies.",
        "permissions": ["view_runs", "create_runs", "view_docs", "view_status"],
        "is_system": True,
    },
    {
        "role_id": "PROJECT_VIEWER",
        "name": "Project Viewer",
        "description": "Read-only access to view completed investigation reports, root cause syntheses, evidence citations, and health dashboards.",
        "permissions": ["view_runs", "view_docs", "view_status"],
        "is_system": True,
    },
    {
        "role_id": "GENERIC_USER",
        "name": "Generic User",
        "description": "Standard authenticated platform member with access to system documentation, runbooks, and self-service profile review.",
        "permissions": ["view_docs", "view_status"],
        "is_system": True,
    },
]

DEFAULT_REDACTION_PATTERNS = [
    {
        "id": "redact-bearer",
        "name": "Bearer Auth Tokens",
        "pattern": r"Bearer\s+[A-Za-z0-9._~+/-]+={0,2}",
        "replacement": "Bearer [REDACTED]",
        "enabled": True,
        "description": "Sanitizes Authorization HTTP headers containing OAuth/JWT tokens.",
    },
    {
        "id": "redact-secrets",
        "name": "API Keys & Passwords",
        "pattern": r'(password|passwd|secret|token|api[_-]?key)(["\']?\s*[:=]\s*)(?:["\'][^"\']*["\']|[^\s,;}]+)',
        "replacement": r"\1\2[REDACTED]",
        "enabled": True,
        "description": "Redacts plaintext credentials, passwords, and sensitive API keys.",
    },
    {
        "id": "redact-email",
        "name": "Email Addresses (PII)",
        "pattern": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        "replacement": "[EMAIL_REDACTED]",
        "enabled": True,
        "description": "Masks personally identifiable email addresses.",
    },
    {
        "id": "redact-ssn",
        "name": "Social Security Numbers",
        "pattern": r"\b\d{3}-\d{2}-\d{4}\b",
        "replacement": "[SSN_REDACTED]",
        "enabled": True,
        "description": "Masks government issued identification numbers.",
    },
    {
        "id": "redact-cc",
        "name": "Credit Card Numbers",
        "pattern": r"\b(?:\d{4}[-\s]?){3}\d{4}\b",
        "replacement": "[CC_REDACTED]",
        "enabled": True,
        "description": "Masks payment card account numbers.",
    },
]

DEFAULT_PRICING_MATRIX = {
    "gemini-2.5-flash": {"input_per_million": 0.15, "output_per_million": 0.60},
    "gemini-2.5-flash-lite": {"input_per_million": 0.075, "output_per_million": 0.30},
    "gemini-2.5-pro": {"input_per_million": 1.25, "output_per_million": 5.00},
    "gemini-1.5-pro": {"input_per_million": 1.25, "output_per_million": 5.00},
    "gemini-1.5-flash": {"input_per_million": 0.075, "output_per_million": 0.30},
    "ocr-parser": {"input_per_million": 0.20, "output_per_million": 0.20},
}

DEFAULT_RUNTIME_STAGES = [
    {
        "stage_id": "root",
        "name": "Root Orchestration Runner",
        "model": "Deterministic Orchestrator",
        "thinking_level": "none",
        "thinking_budget": 0,
        "output_limit": 4096,
        "temperature": 0.0,
        "tool_limit": 5,
        "tools": ["FastAPI Router", "SQLAlchemy Run Store", "Principal JWT RS256 Scope"],
        "instruction": "Initializes run execution context, enforces UTC deadline, coordinates parallel branches.",
        "enabled": True,
    },
    {
        "stage_id": "planning",
        "name": "Request Planning Stage",
        "model": "gemini-2.5-flash",
        "thinking_level": "high",
        "thinking_budget": 8192,
        "output_limit": 4096,
        "temperature": 0.2,
        "tool_limit": 5,
        "tools": ["capability_resolver"],
        "instruction": "Analyze incident scope and formulate parallel investigation branches.",
        "enabled": True,
    },
    {
        "stage_id": "triage",
        "name": "ITSM Incident Triage",
        "model": "gemini-2.5-flash-lite",
        "thinking_level": "low",
        "thinking_budget": 1024,
        "output_limit": 2048,
        "temperature": 0.1,
        "tool_limit": 3,
        "tools": ["itsm.get_ticket"],
        "instruction": "Retrieve ticket details, assess component impacts, extract severity.",
        "enabled": True,
    },
    {
        "stage_id": "investigation",
        "name": "Splunk Log Investigation",
        "model": "gemini-2.5-flash",
        "thinking_level": "medium",
        "thinking_budget": 4096,
        "output_limit": 4096,
        "temperature": 0.2,
        "tool_limit": 8,
        "tools": ["log_search.search_events"],
        "instruction": "Execute targeted SPL queries around the incident window, trace error spikes.",
        "enabled": True,
    },
    {
        "stage_id": "correlation",
        "name": "Evidence Correlation & Cross-Analysis",
        "model": "gemini-2.5-flash",
        "thinking_level": "medium",
        "thinking_budget": 4096,
        "output_limit": 4096,
        "temperature": 0.2,
        "tool_limit": 6,
        "tools": ["capability_resolver"],
        "instruction": "Cross-reference log anomalies with ticket descriptions and known runbooks.",
        "enabled": True,
    },
    {
        "stage_id": "synthesis",
        "name": "Root Cause Synthesis & Action Plan",
        "model": "gemini-2.5-pro",
        "thinking_level": "high",
        "thinking_budget": 8192,
        "output_limit": 8192,
        "temperature": 0.1,
        "tool_limit": 5,
        "tools": [],
        "instruction": "Synthesize comprehensive Root Cause Analysis, timeline, findings, and preventive actions.",
        "enabled": True,
    },
]


class PlatformAdminStore:
    def __init__(self, engine: AsyncEngine):
        self.engine = scoped_engine(engine)

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    async def get_project_editor_draft(self, tenant_id: str, project_id: str):
        async with self.engine.connect() as conn:
            row = (await conn.execute(select(project_editor_drafts).where(
                project_editor_drafts.c.tenant_id == tenant_id,
                project_editor_drafts.c.project_id == project_id,
            ))).mappings().first()
        return dict(row) if row else {"tenant_id": tenant_id, "project_id": project_id, "document": {}, "version": 0}

    async def update_project_editor_draft(self, tenant_id, project_id, document, expected_version):
        now = time.time()
        async with self.engine.begin() as conn:
            row = (await conn.execute(select(project_editor_drafts.c.version).where(
                project_editor_drafts.c.tenant_id == tenant_id, project_editor_drafts.c.project_id == project_id,
            ).with_for_update())).scalar_one_or_none()
            if (row or 0) != expected_version:
                raise ValueError("Project editor draft changed; reload before saving")
            if row is None:
                await conn.execute(insert(project_editor_drafts).values(
                    tenant_id=tenant_id, project_id=project_id, document=document, version=1, updated_at=now))
                version = 1
            else:
                version = row + 1
                await conn.execute(update(project_editor_drafts).where(
                    project_editor_drafts.c.tenant_id == tenant_id, project_editor_drafts.c.project_id == project_id,
                    project_editor_drafts.c.version == row,
                ).values(document=document, version=version, updated_at=now))
            return {"tenant_id": tenant_id, "project_id": project_id, "document": document, "version": version, "updated_at": now}

    # -------------------------------------------------------------------------
    # USERS
    # -------------------------------------------------------------------------
    async def list_users(self, tenant_id: str, project_id: str) -> List[Dict[str, Any]]:
        legacy_role_map = {
            "TENANT_ADMIN": "PROJECT_OWNER",
            "OPERATOR": "PROJECT_ANALYST",
            "AUDITOR": "PROJECT_VIEWER",
            "SKILL_AUTHOR": "PROJECT_MANAGER",
            "GENERIC_VIEWER": "GENERIC_USER",
        }
        async with self.engine.begin() as conn:
            stmt = select(platform_users).where(
                platform_users.c.tenant_id == tenant_id,
                platform_users.c.project_id == project_id,
            )
            rows = (await conn.execute(stmt)).mappings().all()
            results = []
            for r in rows:
                user_dict = dict(r)
                user_roles = user_dict.get("roles") or []
                migrated = False
                new_roles = []
                for role in user_roles:
                    if role in legacy_role_map:
                        new_roles.append(legacy_role_map[role])
                        migrated = True
                    else:
                        new_roles.append(role)
                if migrated:
                    new_roles = list(dict.fromkeys(new_roles))
                    user_dict["roles"] = new_roles
                    await conn.execute(
                        update(platform_users)
                        .where(
                            platform_users.c.tenant_id == tenant_id,
                            platform_users.c.project_id == project_id,
                            platform_users.c.subject == user_dict["subject"],
                        )
                        .values(roles=new_roles)
                    )
                results.append(user_dict)
            return results

    async def get_user(self, tenant_id: str, project_id: str, subject: str) -> Dict[str, Any] | None:
        async with self.engine.begin() as conn:
            row = (await conn.execute(select(platform_users).where(
                platform_users.c.tenant_id == tenant_id,
                platform_users.c.project_id == project_id,
                platform_users.c.subject == subject,
            ))).mappings().first()
            return dict(row) if row else None

    async def upsert_user(
        self,
        tenant_id: str,
        project_id: str,
        subject: str,
        name: str,
        email: Optional[str],
        roles: List[str],
        status: str = "active",
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_users).where(
                        platform_users.c.tenant_id == tenant_id,
                        platform_users.c.project_id == project_id,
                        platform_users.c.subject == subject,
                    )
                )
            ).first()

            if existing:
                await conn.execute(
                    update(platform_users)
                    .where(
                        platform_users.c.tenant_id == tenant_id,
                        platform_users.c.project_id == project_id,
                        platform_users.c.subject == subject,
                    )
                    .values(
                        name=name,
                        email=email,
                        roles=roles,
                        status=status,
                        updated_at=now,
                    )
                )
            else:
                await conn.execute(
                    insert(platform_users).values(
                        tenant_id=tenant_id,
                        project_id=project_id,
                        subject=subject,
                        name=name,
                        email=email,
                        roles=roles,
                        status=status,
                        created_at=now,
                        updated_at=now,
                    )
                )
        return {
            "id": subject,
            "name": name,
            "email": email,
            "roles": roles,
            "status": status,
            "updated_at": now,
        }

    async def delete_user(self, tenant_id: str, project_id: str, subject: str) -> bool:
        async with self.engine.begin() as conn:
            res = await conn.execute(
                update(platform_users).where(
                    platform_users.c.tenant_id == tenant_id,
                    platform_users.c.project_id == project_id,
                    platform_users.c.subject == subject,
                ).values(status="inactive", updated_at=time.time())
            )
            return bool(res.rowcount > 0)

    # -------------------------------------------------------------------------
    # ROLES
    # -------------------------------------------------------------------------
    async def list_roles(self, tenant_id: str) -> List[Dict[str, Any]]:
        async with self.engine.begin() as conn:
            valid_system_role_ids = {r["role_id"] for r in DEFAULT_SYSTEM_ROLES}
            # Purge deprecated system roles if present
            await conn.execute(
                delete(platform_roles).where(
                    platform_roles.c.tenant_id == tenant_id,
                    platform_roles.c.is_system.is_(True),
                    platform_roles.c.role_id.notin_(valid_system_role_ids),
                )
            )
            stmt = select(platform_roles).where(platform_roles.c.tenant_id == tenant_id)
            rows = (await conn.execute(stmt)).mappings().all()
            existing_roles = {r["role_id"]: dict(r) for r in rows}

            # Seed default system roles if absent
            missing_roles = [r for r in DEFAULT_SYSTEM_ROLES if r["role_id"] not in existing_roles]
            if missing_roles:
                now = time.time()
                for r in missing_roles:
                    await conn.execute(
                        insert(platform_roles).values(
                            role_id=r["role_id"],
                            tenant_id=tenant_id,
                            name=r["name"],
                            description=r["description"],
                            permissions=r["permissions"],
                            is_system=True,
                            status="active",
                            updated_at=now,
                        )
                    )
                    existing_roles[r["role_id"]] = {
                        "role_id": r["role_id"],
                        "name": r["name"],
                        "description": r["description"],
                        "permissions": r["permissions"],
                        "is_system": True,
                        "status": "active",
                        "updated_at": now,
                    }

            return list(existing_roles.values())

    async def upsert_role(
        self,
        tenant_id: str,
        role_id: str,
        name: str,
        description: str,
        permissions: List[str],
        status: str = "active",
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_roles).where(
                        platform_roles.c.tenant_id == tenant_id,
                        platform_roles.c.role_id == role_id,
                    )
                )
            ).mappings().first()

            is_system = existing["is_system"] if existing else False
            if existing:
                await conn.execute(
                    update(platform_roles)
                    .where(
                        platform_roles.c.tenant_id == tenant_id,
                        platform_roles.c.role_id == role_id,
                    )
                    .values(
                        name=name,
                        description=description,
                        permissions=permissions,
                        status=status,
                        updated_at=now,
                    )
                )
            else:
                await conn.execute(
                    insert(platform_roles).values(
                        role_id=role_id,
                        tenant_id=tenant_id,
                        name=name,
                        description=description,
                        permissions=permissions,
                        is_system=is_system,
                        status=status,
                        updated_at=now,
                    )
                )

        return {
            "id": role_id,
            "role_id": role_id,
            "name": name,
            "description": description,
            "permissions": permissions,
            "is_system": is_system,
            "status": status,
            "updated_at": now,
        }

    async def delete_role(self, tenant_id: str, role_id: str) -> bool:
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_roles).where(
                        platform_roles.c.tenant_id == tenant_id,
                        platform_roles.c.role_id == role_id,
                    )
                )
            ).mappings().first()
            if existing and existing["is_system"]:
                raise ValueError("System-defined roles cannot be deleted")
            res = await conn.execute(
                delete(platform_roles).where(
                    platform_roles.c.tenant_id == tenant_id,
                    platform_roles.c.role_id == role_id,
                )
            )
            return bool(res.rowcount > 0)

    # -------------------------------------------------------------------------
    # BILLING & COMPUTE QUOTAS
    # -------------------------------------------------------------------------
    async def get_billing(self, tenant_id: str, project_id: str) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (
                await conn.execute(
                    select(platform_billing).where(
                        platform_billing.c.tenant_id == tenant_id,
                        platform_billing.c.project_id == project_id,
                    )
                )
            ).mappings().first()

            if not row:
                now = time.time()
                initial = {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "tier": "Standard",
                    "monthly_spend_budget": 500.0,
                    "monthly_token_budget": 50000000,
                    "max_concurrent_investigations": 4,
                    "rate_limit_rpm": 60,
                    "rate_limit_tpm": 250000,
                    "alert_threshold_percent": 80,
                    "webhook_url": "",
                    "pricing_matrix": DEFAULT_PRICING_MATRIX,
                    "updated_at": now,
                }
                await conn.execute(insert(platform_billing).values(**initial))
                return initial

            return dict(row)

    async def update_billing(
        self, tenant_id: str, project_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_billing).where(
                        platform_billing.c.tenant_id == tenant_id,
                        platform_billing.c.project_id == project_id,
                    )
                )
            ).first()

            values = {
                "tier": payload.get("tier", "Standard"),
                "monthly_spend_budget": float(payload.get("monthly_spend_budget", 500.0)),
                "monthly_token_budget": int(payload.get("monthly_token_budget", 50000000)),
                "max_concurrent_investigations": int(payload.get("max_concurrent_investigations", 4)),
                "rate_limit_rpm": int(payload.get("rate_limit_rpm", 60)),
                "rate_limit_tpm": int(payload.get("rate_limit_tpm", 250000)),
                "alert_threshold_percent": int(payload.get("alert_threshold_percent", 80)),
                "webhook_url": payload.get("webhook_url", ""),
                "pricing_matrix": payload.get("pricing_matrix", DEFAULT_PRICING_MATRIX),
                "updated_at": now,
            }

            if existing:
                await conn.execute(
                    update(platform_billing)
                    .where(
                        platform_billing.c.tenant_id == tenant_id,
                        platform_billing.c.project_id == project_id,
                    )
                    .values(**values)
                )
            else:
                await conn.execute(
                    insert(platform_billing).values(
                        tenant_id=tenant_id, project_id=project_id, **values
                    )
                )
            values["tenant_id"] = tenant_id
            values["project_id"] = project_id
            return values

    # -------------------------------------------------------------------------
    # POLICY & GUARDRAILS
    # -------------------------------------------------------------------------
    async def get_policy(self, tenant_id: str, project_id: str) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (
                await conn.execute(
                    select(platform_policy).where(
                        platform_policy.c.tenant_id == tenant_id,
                        platform_policy.c.project_id == project_id,
                    )
                )
            ).mappings().first()

            if not row:
                now = time.time()
                initial = {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "redaction_patterns": DEFAULT_REDACTION_PATTERNS,
                    "guardrails": {
                        "dual_custody_enforced": True,
                        "max_tool_call_depth": 10,
                        "request_deadline_seconds": 120,
                        "write_protection_active": True,
                        "blocked_keywords": [
                            "DROP", "DELETE", "TRUNCATE", "eval(", "rm -rf", "shutil.rmtree"
                        ],
                    },
                    "skill_guardrails": {
                        "itsm": {"actions": ["get_ticket"], "immutable": False, "project_override": True},
                        "log_search": {"actions": ["search_events"], "immutable": False, "project_override": True},
                    },
                    "updated_at": now,
                }
                await conn.execute(insert(platform_policy).values(**initial))
                return initial
            return dict(row)

    async def update_policy(
        self, tenant_id: str, project_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_policy).where(
                        platform_policy.c.tenant_id == tenant_id,
                        platform_policy.c.project_id == project_id,
                    )
                )
            ).first()

            values = {
                "redaction_patterns": payload.get("redaction_patterns", DEFAULT_REDACTION_PATTERNS),
                "guardrails": payload.get("guardrails", {}),
                "skill_guardrails": payload.get("skill_guardrails", {}),
                "updated_at": now,
            }

            if existing:
                await conn.execute(
                    update(platform_policy)
                    .where(
                        platform_policy.c.tenant_id == tenant_id,
                        platform_policy.c.project_id == project_id,
                    )
                    .values(**values)
                )
            else:
                await conn.execute(
                    insert(platform_policy).values(
                        tenant_id=tenant_id, project_id=project_id, **values
                    )
                )
            values["tenant_id"] = tenant_id
            values["project_id"] = project_id
            return values

    # -------------------------------------------------------------------------
    # PERSISTENCE & FILE PROCESSING LIMITS
    # -------------------------------------------------------------------------
    async def get_file_limits(self, tenant_id: str, project_id: str) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (
                await conn.execute(
                    select(platform_file_limits).where(
                        platform_file_limits.c.tenant_id == tenant_id,
                        platform_file_limits.c.project_id == project_id,
                    )
                )
            ).mappings().first()

            if not row:
                now = time.time()
                initial = {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "max_file_bytes": 10485760,  # 10 MB
                    "max_files": 10,
                    "max_text_chars": 50000,
                    "max_pdf_pages": 20,
                    "max_rows": 2000,
                    "max_cells": 20000,
                    "parser_timeout_seconds": 30,
                    "concurrency": 4,
                    "allowed_extensions": [".txt", ".log", ".json", ".csv", ".tsv", ".pdf", ".yaml", ".yml", ".xml"],
                    "retention_days": 90,
                    "auto_prune_enabled": True,
                    "updated_at": now,
                }
                await conn.execute(insert(platform_file_limits).values(**initial))
                return initial
            return dict(row)

    async def update_file_limits(
        self, tenant_id: str, project_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_file_limits).where(
                        platform_file_limits.c.tenant_id == tenant_id,
                        platform_file_limits.c.project_id == project_id,
                    )
                )
            ).first()

            values = {
                "max_file_bytes": int(payload.get("max_file_bytes", 10485760)),
                "max_files": int(payload.get("max_files", 10)),
                "max_text_chars": int(payload.get("max_text_chars", 50000)),
                "max_pdf_pages": int(payload.get("max_pdf_pages", 20)),
                "max_rows": int(payload.get("max_rows", 2000)),
                "max_cells": int(payload.get("max_cells", 20000)),
                "parser_timeout_seconds": int(payload.get("parser_timeout_seconds", 30)),
                "concurrency": int(payload.get("concurrency", 4)),
                "allowed_extensions": payload.get("allowed_extensions", [".txt", ".log", ".json", ".csv"]),
                "retention_days": int(payload.get("retention_days", 90)),
                "auto_prune_enabled": bool(payload.get("auto_prune_enabled", True)),
                "updated_at": now,
            }

            if existing:
                await conn.execute(
                    update(platform_file_limits)
                    .where(
                        platform_file_limits.c.tenant_id == tenant_id,
                        platform_file_limits.c.project_id == project_id,
                    )
                    .values(**values)
                )
            else:
                await conn.execute(
                    insert(platform_file_limits).values(
                        tenant_id=tenant_id, project_id=project_id, **values
                    )
                )
            values["tenant_id"] = tenant_id
            values["project_id"] = project_id
            return values

    # -------------------------------------------------------------------------
    # KNOWLEDGE & RUNBOOKS
    # -------------------------------------------------------------------------
    async def list_knowledge(self, tenant_id: str, project_id: str) -> List[Dict[str, Any]]:
        async with self.engine.begin() as conn:
            stmt = (
                select(platform_knowledge)
                .where(
                    platform_knowledge.c.tenant_id == tenant_id,
                    platform_knowledge.c.project_id == project_id,
                )
                .order_by(platform_knowledge.c.updated_at.desc())
            )
            rows = (await conn.execute(stmt)).mappings().all()
            return [dict(r) for r in rows]

    async def upsert_knowledge(
        self,
        tenant_id: str,
        project_id: str,
        doc_id: Optional[str],
        title: str,
        category: str,
        tags: List[str],
        content: str,
        media_type: str = "text/markdown",
        status: str = "active",
    ) -> Dict[str, Any]:
        now = time.time()
        final_id = doc_id or f"kb_{uuid.uuid4().hex[:8]}"
        size_bytes = len(content.encode("utf-8"))
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_knowledge).where(
                        platform_knowledge.c.tenant_id == tenant_id,
                        platform_knowledge.c.project_id == project_id,
                        platform_knowledge.c.doc_id == final_id,
                    )
                )
            ).first()

            if existing:
                await conn.execute(
                    update(platform_knowledge)
                    .where(
                        platform_knowledge.c.tenant_id == tenant_id,
                        platform_knowledge.c.project_id == project_id,
                        platform_knowledge.c.doc_id == final_id,
                    )
                    .values(
                        title=title,
                        category=category,
                        tags=tags,
                        content=content,
                        media_type=media_type,
                        size_bytes=size_bytes,
                        status=status,
                        updated_at=now,
                    )
                )
            else:
                await conn.execute(
                    insert(platform_knowledge).values(
                        doc_id=final_id,
                        tenant_id=tenant_id,
                        project_id=project_id,
                        title=title,
                        category=category,
                        tags=tags,
                        content=content,
                        media_type=media_type,
                        size_bytes=size_bytes,
                        status=status,
                        created_at=now,
                        updated_at=now,
                    )
                )

        return {
            "id": final_id,
            "doc_id": final_id,
            "title": title,
            "category": category,
            "tags": tags,
            "content": content,
            "media_type": media_type,
            "size_bytes": size_bytes,
            "status": status,
            "updated_at": now,
        }

    async def delete_knowledge(self, tenant_id: str, project_id: str, doc_id: str) -> bool:
        async with self.engine.begin() as conn:
            res = await conn.execute(
                delete(platform_knowledge).where(
                    platform_knowledge.c.tenant_id == tenant_id,
                    platform_knowledge.c.project_id == project_id,
                    platform_knowledge.c.doc_id == doc_id,
                )
            )
            return bool(res.rowcount > 0)

    # -------------------------------------------------------------------------
    # OPERATIONAL ALERTS & BROADCASTS
    # -------------------------------------------------------------------------
    async def list_alerts(self, tenant_id: str, project_id: str) -> List[Dict[str, Any]]:
        async with self.engine.begin() as conn:
            stmt = (
                select(platform_alerts)
                .where(
                    platform_alerts.c.tenant_id == tenant_id,
                    platform_alerts.c.project_id == project_id,
                )
                .order_by(platform_alerts.c.created_at.desc())
            )
            rows = (await conn.execute(stmt)).mappings().all()
            return [dict(r) for r in rows]

    async def create_alert(
        self,
        tenant_id: str,
        project_id: str,
        severity: str,
        source: str,
        component: str,
        title: str,
        summary: str,
        message: str,
    ) -> Dict[str, Any]:
        now = time.time()
        alert_id = f"alert_{uuid.uuid4().hex[:8]}"
        async with self.engine.begin() as conn:
            await conn.execute(
                insert(platform_alerts).values(
                    alert_id=alert_id,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    severity=severity,
                    source=source,
                    component=component,
                    title=title,
                    summary=summary,
                    message=message,
                    status="open",
                    resolution_note=None,
                    created_at=now,
                    resolved_at=None,
                )
            )
        return {
            "id": alert_id,
            "alert_id": alert_id,
            "severity": severity,
            "source": source,
            "component": component,
            "title": title,
            "summary": summary,
            "message": message,
            "status": "open",
            "created_at": now,
        }

    async def update_alert_status(
        self,
        tenant_id: str,
        project_id: str,
        alert_id: str,
        status: str,
        resolution_note: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = time.time()
        resolved_at = now if status == "resolved" else None
        async with self.engine.begin() as conn:
            await conn.execute(
                update(platform_alerts)
                .where(
                    platform_alerts.c.tenant_id == tenant_id,
                    platform_alerts.c.project_id == project_id,
                    platform_alerts.c.alert_id == alert_id,
                )
                .values(
                    status=status,
                    resolution_note=resolution_note,
                    resolved_at=resolved_at,
                )
            )
            row = (
                await conn.execute(
                    select(platform_alerts).where(
                        platform_alerts.c.tenant_id == tenant_id,
                        platform_alerts.c.project_id == project_id,
                        platform_alerts.c.alert_id == alert_id,
                    )
                )
            ).mappings().first()
            return dict(row) if row else {"id": alert_id, "status": status}

    async def get_alert_config(self, tenant_id: str, project_id: str) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (
                await conn.execute(
                    select(platform_alert_config).where(
                        platform_alert_config.c.tenant_id == tenant_id,
                        platform_alert_config.c.project_id == project_id,
                    )
                )
            ).mappings().first()

            if not row:
                now = time.time()
                initial = {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "mttr_warning_minutes": 45,
                    "tool_failure_rate_percent": 15,
                    "probe_latency_warning_ms": 2500,
                    "updated_at": now,
                }
                await conn.execute(insert(platform_alert_config).values(**initial))
                return initial
            return dict(row)

    async def update_alert_config(
        self, tenant_id: str, project_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_alert_config).where(
                        platform_alert_config.c.tenant_id == tenant_id,
                        platform_alert_config.c.project_id == project_id,
                    )
                )
            ).first()

            values = {
                "mttr_warning_minutes": int(payload.get("mttr_warning_minutes", 45)),
                "tool_failure_rate_percent": int(payload.get("tool_failure_rate_percent", 15)),
                "probe_latency_warning_ms": int(payload.get("probe_latency_warning_ms", 2500)),
                "updated_at": now,
            }

            if existing:
                await conn.execute(
                    update(platform_alert_config)
                    .where(
                        platform_alert_config.c.tenant_id == tenant_id,
                        platform_alert_config.c.project_id == project_id,
                    )
                    .values(**values)
                )
            else:
                await conn.execute(
                    insert(platform_alert_config).values(
                        tenant_id=tenant_id, project_id=project_id, **values
                    )
                )
            values["tenant_id"] = tenant_id
            values["project_id"] = project_id
            return values

    async def get_read_notification_ids(
        self, tenant_id: str, project_id: str, subject: str
    ) -> set[str]:
        async with self.engine.connect() as conn:
            rows = (
                await conn.execute(
                    select(platform_notification_reads.c.notification_id).where(
                        platform_notification_reads.c.tenant_id == tenant_id,
                        platform_notification_reads.c.project_id == project_id,
                        platform_notification_reads.c.subject == subject,
                    )
                )
            ).scalars().all()
            return set(rows)

    async def mark_notifications_read(
        self,
        tenant_id: str,
        project_id: str,
        subject: str,
        notification_ids: List[str],
    ) -> int:
        now = time.time()
        count = 0
        async with self.engine.begin() as conn:
            for nid in notification_ids:
                try:
                    await conn.execute(
                        insert(platform_notification_reads).values(
                            notification_id=nid,
                            tenant_id=tenant_id,
                            project_id=project_id,
                            subject=subject,
                            read_at=now,
                        )
                    )
                    count += 1
                except Exception:
                    pass
        return count

    # -------------------------------------------------------------------------
    # RUNTIME STAGE TUNING
    # -------------------------------------------------------------------------
    async def list_runtime_stages(self, tenant_id: str, project_id: str) -> List[Dict[str, Any]]:
        async with self.engine.begin() as conn:
            stmt = select(platform_runtime_stages).where(
                platform_runtime_stages.c.tenant_id == tenant_id,
                platform_runtime_stages.c.project_id == project_id,
            )
            rows = (await conn.execute(stmt)).mappings().all()
            stages_dict = {r["stage_id"]: dict(r) for r in rows}

            # Seed default runtime stages if absent
            missing = [s for s in DEFAULT_RUNTIME_STAGES if s["stage_id"] not in stages_dict]
            if missing:
                now = time.time()
                for s in missing:
                    await conn.execute(
                        insert(platform_runtime_stages).values(
                            stage_id=s["stage_id"],
                            tenant_id=tenant_id,
                            project_id=project_id,
                            name=s["name"],
                            model=s["model"],
                            thinking_level=s["thinking_level"],
                            thinking_budget=s["thinking_budget"],
                            output_limit=s["output_limit"],
                            temperature=s["temperature"],
                            tool_limit=s["tool_limit"],
                            tools=s["tools"],
                            instruction=s["instruction"],
                            enabled=s["enabled"],
                            updated_at=now,
                        )
                    )
                    stages_dict[s["stage_id"]] = {**s, "updated_at": now}

            return list(stages_dict.values())

    async def update_runtime_stage(
        self, tenant_id: str, project_id: str, stage_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_runtime_stages).where(
                        platform_runtime_stages.c.tenant_id == tenant_id,
                        platform_runtime_stages.c.project_id == project_id,
                        platform_runtime_stages.c.stage_id == stage_id,
                    )
                )
            ).first()

            values = {
                "name": payload.get("name", stage_id.title()),
                "model": payload.get("model", "gemini-2.5-flash"),
                "thinking_level": payload.get("thinking_level", "medium"),
                "thinking_budget": int(payload.get("thinking_budget", 2048)),
                "output_limit": int(payload.get("output_limit", 4096)),
                "temperature": float(payload.get("temperature", 0.2)),
                "tool_limit": int(payload.get("tool_limit", 5)),
                "tools": payload.get("tools", []),
                "instruction": payload.get("instruction", ""),
                "enabled": bool(payload.get("enabled", True)),
                "updated_at": now,
            }

            if existing:
                await conn.execute(
                    update(platform_runtime_stages)
                    .where(
                        platform_runtime_stages.c.tenant_id == tenant_id,
                        platform_runtime_stages.c.project_id == project_id,
                        platform_runtime_stages.c.stage_id == stage_id,
                    )
                    .values(**values)
                )
            else:
                await conn.execute(
                    insert(platform_runtime_stages).values(
                        stage_id=stage_id,
                        tenant_id=tenant_id,
                        project_id=project_id,
                        **values,
                    )
                )
            values["stage_id"] = stage_id
            values["id"] = stage_id
            return values

    # -------------------------------------------------------------------------
    # PLATFORM SETTINGS
    # -------------------------------------------------------------------------
    async def get_platform_settings(self, tenant_id: str, project_id: str, *, create: bool = True) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (
                await conn.execute(
                    select(platform_settings).where(
                        platform_settings.c.tenant_id == tenant_id,
                        platform_settings.c.project_id == project_id,
                    )
                )
            ).mappings().first()

            if not row:
                now = time.time()
                initial = {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "run_timeout_seconds": 120,
                    "max_concurrent_runs": 4,
                    "max_llm_calls": 12,
                    "max_input_chars": 16000,
                    "max_context_chars": 64000,
                    "retention_days": 90,
                    "allowed_extensions": [".txt", ".log", ".json", ".csv", ".tsv", ".pdf", ".yaml", ".yml"],
                    "mode": "demo",
                    "updated_at": now,
                }
                if create:
                    await conn.execute(insert(platform_settings).values(**initial))
                return initial
            return dict(row)

    async def update_platform_settings(
        self, tenant_id: str, project_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        now = time.time()
        async with self.engine.begin() as conn:
            existing = (
                await conn.execute(
                    select(platform_settings).where(
                        platform_settings.c.tenant_id == tenant_id,
                        platform_settings.c.project_id == project_id,
                    )
                )
            ).first()

            values = {
                "run_timeout_seconds": int(payload.get("run_timeout_seconds", 120)),
                "max_concurrent_runs": int(payload.get("max_concurrent_runs", 4)),
                "max_llm_calls": int(payload.get("max_llm_calls", 12)),
                "max_input_chars": int(payload.get("max_input_chars", 16000)),
                "max_context_chars": int(payload.get("max_context_chars", 64000)),
                "retention_days": int(payload.get("retention_days", 90)),
                "allowed_extensions": payload.get(
                    "allowed_extensions", [".txt", ".log", ".json", ".csv", ".pdf"]
                ),
                "mode": payload.get("mode", "demo"),
                "updated_at": now,
            }

            if existing:
                await conn.execute(
                    update(platform_settings)
                    .where(
                        platform_settings.c.tenant_id == tenant_id,
                        platform_settings.c.project_id == project_id,
                    )
                    .values(**values)
                )
            else:
                await conn.execute(
                    insert(platform_settings).values(
                        tenant_id=tenant_id, project_id=project_id, **values
                    )
                )
            values["tenant_id"] = tenant_id
            values["project_id"] = project_id
            return values

    # -------------------------------------------------------------------------
    # ADMINISTRABLE UI SETTINGS
    # -------------------------------------------------------------------------
    async def get_ui_settings(self, tenant_id: str, project_id: str) -> Dict[str, Any]:
        async with self.engine.begin() as conn:
            row = (await conn.execute(select(platform_ui_settings).where(
                platform_ui_settings.c.tenant_id == tenant_id,
                platform_ui_settings.c.project_id == project_id,
            ))).mappings().first()
            if row:
                return dict(row)
            now = time.time()
            initial = {
                "tenant_id": tenant_id,
                "project_id": project_id,
                "brand_name": "RCA Analyzer",
                "workspace_label": "Investigation workspace",
                "default_theme": "light",
                "default_page": "overview",
                "welcome_title": "Investigate with confidence",
                "welcome_description": "Trace incidents from evidence to action.",
                "navigation": DEFAULT_UI_NAVIGATION,
                "version": 1,
                "updated_at": now,
            }
            # Reads must remain safe under concurrent first loads; the first
            # successful write materializes the defaults.
            return initial

    async def update_ui_settings(
        self, tenant_id: str, project_id: str, payload: Dict[str, Any], expected_version: int
    ) -> Dict[str, Any]:
        now = time.time()
        values = {
            "brand_name": payload["brand_name"],
            "workspace_label": payload["workspace_label"],
            "default_theme": payload["default_theme"],
            "default_page": payload["default_page"],
            "welcome_title": payload["welcome_title"],
            "welcome_description": payload["welcome_description"],
            "navigation": payload["navigation"],
            "updated_at": now,
        }
        async with self.engine.begin() as conn:
            current = (await conn.execute(select(platform_ui_settings.c.version).where(
                platform_ui_settings.c.tenant_id == tenant_id,
                platform_ui_settings.c.project_id == project_id,
            ))).scalar_one_or_none()
            if current is None:
                try:
                    await conn.execute(insert(platform_ui_settings).values(
                        tenant_id=tenant_id, project_id=project_id,
                        brand_name="RCA Analyzer", workspace_label="Investigation workspace",
                        default_theme="light", default_page="overview",
                        welcome_title="Investigate with confidence",
                        welcome_description="Trace incidents from evidence to action.",
                        navigation=DEFAULT_UI_NAVIGATION, version=1, updated_at=now,
                    ))
                except IntegrityError:
                    raise ValueError("UI settings have changed; reload before saving") from None
                current = 1
            if current != expected_version:
                raise ValueError("UI settings have changed; reload before saving")
            result = await conn.execute(update(platform_ui_settings).where(
                platform_ui_settings.c.tenant_id == tenant_id,
                platform_ui_settings.c.project_id == project_id,
                platform_ui_settings.c.version == expected_version,
            ).values(**values, version=expected_version + 1))
            if result.rowcount != 1:
                raise ValueError("UI settings have changed; reload before saving")
            return {
                "tenant_id": tenant_id, "project_id": project_id,
                **values, "version": expected_version + 1,
            }
