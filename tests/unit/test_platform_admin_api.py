"""Tests for PlatformAdminStore and admin CRUD endpoints."""

import tempfile
from starlette.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_platform_admin_crud_endpoints():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            headers = token("admin")

            # 1. Users CRUD
            users_res = client.get("/api/v1/users", headers=headers)
            assert users_res.status_code == 200
            initial_count = len(users_res.json())

            create_user = client.post(
                "/api/v1/users",
                headers=headers,
                json={
                    "id": "operator-sre",
                    "name": "SRE Operator 1",
                    "email": "sre@internal.example.com",
                    "roles": ["PROJECT_ANALYST"],
                    "status": "active",
                },
            )
            assert create_user.status_code == 200
            assert create_user.json()["name"] == "SRE Operator 1"

            # Check list contains new user
            users_res = client.get("/api/v1/users", headers=headers)
            assert len(users_res.json()) == initial_count + 1

            # Update user
            update_user = client.put(
                "/api/v1/users/operator-sre",
                headers=headers,
                json={
                    "name": "Senior SRE Lead",
                    "email": "lead-sre@internal.example.com",
                    "roles": ["PROJECT_ANALYST", "PLATFORM_ADMIN"],
                    "status": "active",
                },
            )
            assert update_user.status_code == 200
            assert update_user.json()["name"] == "Senior SRE Lead"

            # 2. Roles CRUD
            roles_res = client.get("/api/v1/roles", headers=headers)
            assert roles_res.status_code == 200
            assert len(roles_res.json()) >= 6

            create_role = client.post(
                "/api/v1/roles",
                headers=headers,
                json={
                    "id": "CUSTOM_SECURITY_LEAD",
                    "name": "Security Lead",
                    "description": "Monitors security policy and audit trails",
                    "permissions": ["view_runs", "manage_policy"],
                    "status": "active",
                },
            )
            assert create_role.status_code == 200
            assert create_role.json()["role_id"] == "CUSTOM_SECURITY_LEAD"

            # Update role
            update_role = client.put(
                "/api/v1/roles/CUSTOM_SECURITY_LEAD",
                headers=headers,
                json={
                    "name": "Senior Security Architect",
                    "description": "Governs enterprise security guardrails",
                    "permissions": ["view_runs", "manage_policy", "approve_agents"],
                    "status": "active",
                },
            )
            assert update_role.status_code == 200
            assert update_role.json()["name"] == "Senior Security Architect"

            # 3. Billing & Quota Management
            billing_res = client.get("/api/v1/billing", headers=headers)
            assert billing_res.status_code == 200
            assert "monthly_spend_budget" in billing_res.json()
            assert "usage" in billing_res.json()

            update_billing = client.put(
                "/api/v1/billing",
                headers=headers,
                json={
                    "tier": "Dedicated High-Throughput",
                    "monthly_spend_budget": 1200.0,
                    "monthly_token_budget": 100000000,
                    "max_concurrent_investigations": 8,
                    "rate_limit_rpm": 120,
                    "rate_limit_tpm": 500000,
                    "alert_threshold_percent": 85,
                    "webhook_url": "https://hooks.internal.example.com/alerts",
                    "pricing_matrix": {
                        "gemini-2.5-flash": {"input_per_million": 0.15, "output_per_million": 0.60},
                    },
                },
            )
            assert update_billing.status_code == 200
            assert update_billing.json()["tier"] == "Dedicated High-Throughput"
            assert update_billing.json()["monthly_spend_budget"] == 1200.0

            # 4. Policy & Redaction rules
            policy_res = client.get("/api/v1/policy", headers=headers)
            assert policy_res.status_code == 200
            assert "redaction_patterns" in policy_res.json()

            update_policy = client.put(
                "/api/v1/policy",
                headers=headers,
                json={
                    "redaction_patterns": [
                        {
                            "id": "custom-token",
                            "name": "Custom Token",
                            "pattern": r"sec_[A-Za-z0-9]{16}",
                            "replacement": "[CUSTOM_TOKEN]",
                            "enabled": True,
                            "description": "Internal token regex",
                        }
                    ],
                    "guardrails": {"dual_custody_enforced": True},
                    "skill_guardrails": {},
                },
            )
            assert update_policy.status_code == 200

            # 5. Persistence limits & Cleanup
            limits_res = client.get("/api/v1/persistence/limits", headers=headers)
            assert limits_res.status_code == 200

            update_limits = client.put(
                "/api/v1/persistence/limits",
                headers=headers,
                json={
                    "max_file_bytes": 20971520,
                    "max_files": 20,
                    "max_text_chars": 80000,
                    "max_pdf_pages": 40,
                    "max_rows": 5000,
                    "max_cells": 50000,
                    "parser_timeout_seconds": 60,
                    "concurrency": 8,
                    "allowed_extensions": [".txt", ".log", ".json", ".csv", ".pdf"],
                    "retention_days": 60,
                    "auto_prune_enabled": True,
                },
            )
            assert update_limits.status_code == 200
            assert update_limits.json()["retention_days"] == 60

            cleanup_res = client.post("/api/v1/persistence/cleanup", headers=headers)
            assert cleanup_res.status_code == 200
            assert cleanup_res.json()["status"] == "success"

            # 6. Knowledge Corpus CRUD
            kb_res = client.get("/api/v1/knowledge", headers=headers)
            assert kb_res.status_code == 200

            create_kb = client.post(
                "/api/v1/knowledge",
                headers=headers,
                json={
                    "title": "Payment Gateway Runbook",
                    "category": "Runbooks",
                    "tags": ["payments", "checkout"],
                    "content": "# Runbook for Payments Outage\nStep 1: Check upstream...",
                    "media_type": "text/markdown",
                    "status": "active",
                },
            )
            assert create_kb.status_code == 200
            doc_id = create_kb.json()["id"]

            update_kb = client.put(
                f"/api/v1/knowledge/{doc_id}",
                headers=headers,
                json={
                    "title": "Payment Gateway Runbook v2",
                    "category": "Runbooks",
                    "tags": ["payments", "checkout", "v2"],
                    "content": "# Updated Runbook\nCheck Splunk payments index first.",
                    "media_type": "text/markdown",
                    "status": "active",
                },
            )
            assert update_kb.status_code == 200
            assert update_kb.json()["title"] == "Payment Gateway Runbook v2"

            delete_kb = client.delete(f"/api/v1/knowledge/{doc_id}", headers=headers)
            assert delete_kb.status_code == 204

            # 7. Runtime Stages Tuning
            stages_res = client.get("/api/v1/runtime/stages", headers=headers)
            assert stages_res.status_code == 200
            assert len(stages_res.json()) >= 5

            update_stage = client.put(
                "/api/v1/runtime/stages/planning",
                headers=headers,
                json={
                    "name": "Advanced Planning Stage",
                    "model": "gemini-2.5-pro",
                    "thinking_level": "high",
                    "thinking_budget": 8192,
                    "output_limit": 4096,
                    "temperature": 0.1,
                    "tool_limit": 5,
                    "tools": ["capability_resolver"],
                    "instruction": "Deconstruct incident evidence into parallel triage workflows.",
                    "enabled": True,
                },
            )
            assert update_stage.status_code == 200
            assert update_stage.json()["model"] == "gemini-2.5-pro"

            # 8. Operational Alerts & Thresholds
            create_alert = client.post(
                "/api/v1/alerts",
                headers=headers,
                json={
                    "severity": "warning",
                    "source": "operator",
                    "component": "payments-db",
                    "title": "Database Connection Pool High",
                    "summary": "Connection pool usage above 80%",
                    "message": "Verify DB connection pool settings before peak traffic.",
                },
            )
            assert create_alert.status_code == 200
            alert_id = create_alert.json()["id"]

            patch_alert = client.patch(
                f"/api/v1/alerts/{alert_id}",
                headers=headers,
                json={"status": "resolved", "resolution_note": "Capacity scaled up."},
            )
            assert patch_alert.status_code == 200
            assert patch_alert.json()["status"] == "resolved"

            # 9. Platform Settings
            settings_res = client.get("/api/v1/platform/settings", headers=headers)
            assert settings_res.status_code == 200

            update_settings = client.put(
                "/api/v1/platform/settings",
                headers=headers,
                json={
                    "run_timeout_seconds": 150,
                    "max_concurrent_runs": 6,
                    "max_llm_calls": 15,
                    "max_input_chars": 20000,
                    "max_context_chars": 80000,
                    "retention_days": 120,
                    "allowed_extensions": [".txt", ".log", ".json"],
                    "mode": "demo",
                },
            )
            assert update_settings.status_code == 200
            assert update_settings.json()["run_timeout_seconds"] == 150
