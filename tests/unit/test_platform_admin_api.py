"""Tests for PlatformAdminStore and admin CRUD endpoints."""

import tempfile
import shutil
from pathlib import Path
import asyncio
from starlette.testclient import TestClient

from app.api.application import create_app
from app.configuration.database_bundle import seed_bundle, metadata
from app.persistence.database import initialize_tables
from tests.support import connectors, settings_for as base_settings_for


def settings_for(directory):
    settings, token = base_settings_for(directory)
    config_dir = Path(directory) / "config"
    shutil.copytree(settings.config_dir, config_dir)
    return settings.model_copy(update={"config_dir": config_dir}), token


def test_platform_admin_crud_endpoints():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            asyncio.run(initialize_tables(app.state.store.engine, metadata))
            asyncio.run(seed_bundle(app.state.store.engine, app.state.settings))
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
            triage_stage = next(stage for stage in stages_res.json() if stage["stage_id"] == "triage")

            update_stage = client.put(
                "/api/v1/runtime/stages/triage",
                headers=headers,
                json={
                    "model": "gemini-2.5-pro",
                    "thinking_level": "high",
                    "output_limit": 4096,
                    "temperature": 0.1,
                    "enabled": True,
                    "expected_hash": triage_stage["content_hash"],
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
                    "max_input_chars": 16000,
                    "max_context_chars": 80000,
                    "retention_days": 120,
                    "allowed_extensions": [".txt", ".log", ".json"],
                    "mode": "demo",
                },
            )
            assert update_settings.status_code == 200
            assert update_settings.json()["run_timeout_seconds"] == 150


def test_runtime_stage_api_is_authoritative_and_protected():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            asyncio.run(initialize_tables(app.state.store.engine, metadata))
            asyncio.run(seed_bundle(app.state.store.engine, app.state.settings))
            admin_headers = token("admin")
            viewer_headers = token("viewer")

            stages = client.get("/api/v1/runtime/stages", headers=admin_headers)
            assert stages.status_code == 200
            planning = next(item for item in stages.json() if item["stage_id"] == "triage")
            assert planning["model"] == app.state.platform.profiles.stages["triage"].model
            assert planning["content_hash"].startswith("sha256:")
            assert "instruction" in planning["immutable_fields"]

            payload = {
                "model": "gemini-test-runtime",
                "thinking_level": "low",
                "output_limit": 3072,
                "temperature": 0.3,
                "enabled": True,
                "expected_hash": planning["content_hash"],
            }
            denied = client.put("/api/v1/runtime/stages/triage", headers=viewer_headers, json=payload)
            assert denied.status_code == 403

            updated = client.put("/api/v1/runtime/stages/triage", headers=admin_headers, json=payload)
            assert updated.status_code == 200
            assert updated.json()["model"] == "gemini-test-runtime"
            assert app.state.platform.profiles.stages["triage"].model == "gemini-test-runtime"
            assert app.state.runner.profiles.stages["triage"].model == "gemini-test-runtime"

            stale = client.put("/api/v1/runtime/stages/triage", headers=admin_headers, json=payload)
            assert stale.status_code == 409
            invalid_stage = client.put("/api/v1/runtime/stages/missing", headers=admin_headers, json={**payload, "expected_hash": "sha256:nope"})
            assert invalid_stage.status_code == 404
            synthesis = next(item for item in stages.json() if item["stage_id"] == "synthesis")
            disable_synthesis = client.put(
                "/api/v1/runtime/stages/synthesis",
                headers=admin_headers,
                json={
                    "model": synthesis["model"],
                    "output_limit": synthesis["output_limit"],
                    "temperature": synthesis["temperature"],
                    "enabled": False,
                    "expected_hash": synthesis["content_hash"],
                },
            )
            assert disable_synthesis.status_code == 422
            both_thinking_modes = client.put(
                "/api/v1/runtime/stages/triage",
                headers=admin_headers,
                json={**payload, "expected_hash": updated.json()["content_hash"], "thinking_budget": 512},
            )
            assert both_thinking_modes.status_code == 422
            profile_file = Path(app.state.settings.config_dir) / "model_profiles.yaml"
            assert "gemini-test-runtime" in profile_file.read_text(encoding="utf-8")
        restarted = create_app(settings, connectors=connectors())
        with TestClient(restarted) as client:
            stages = client.get("/api/v1/runtime/stages", headers=token("admin")).json()
            assert next(stage for stage in stages if stage["stage_id"] == "triage")["model"] == "gemini-test-runtime"



def test_ui_settings_are_scoped_validated_and_versioned():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            admin, viewer = token("admin"), token("viewer")
            initial = client.get("/api/v1/platform/ui-settings", headers=viewer)
            assert initial.status_code == 200
            assert initial.json()["version"] == 1
            body = {key: initial.json()[key] for key in ("brand_name", "workspace_label", "default_theme", "default_page", "welcome_title", "welcome_description", "navigation")}
            body.update(brand_name="Acme RCA", expected_version=1)
            saved = client.put("/api/v1/platform/ui-settings", headers=admin, json=body)
            assert saved.status_code == 200
            assert saved.json()["version"] == 2
            assert saved.json()["brand_name"] == "Acme RCA"
            assert client.put("/api/v1/platform/ui-settings", headers=admin, json=body).status_code == 409
            assert client.put("/api/v1/platform/ui-settings", headers=viewer, json={**body, "expected_version": 2}).status_code == 403
            navigation = [{**item, "visible": False} if item["page"] == "settings" else item for item in saved.json()["navigation"]]
            assert client.put("/api/v1/platform/ui-settings", headers=admin, json={**body, "expected_version": 2, "navigation": navigation}).status_code == 422


def test_parameter_project_view_hides_platform_only_for_administrators():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            admin = token("admin")
            definition = {
                "value_type": "string", "description": "Internal control",
                "default_value": "internal", "scope": "platform_only",
            }
            created = client.put("/api/v1/parameters/internal/control/definition", headers=admin, json=definition)
            assert created.status_code == 200
            all_rows = client.get("/api/v1/parameters?view=all", headers=admin).json()
            project_rows = client.get("/api/v1/parameters?view=project", headers=admin).json()
            assert any(row["variable_name"] == "control" for row in all_rows)
            assert not any(row["variable_name"] == "control" for row in project_rows)


def test_project_editor_draft_is_scoped_versioned_and_data_only():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            admin, viewer = token("admin"), token("viewer")
            initial = client.get("/api/v1/project/editor", headers=viewer).json()
            assert initial["version"] == 0 and initial["document"] == {}
            saved = client.put("/api/v1/project/editor", headers=admin, json={"document": {"metadata": {"name": "Payments"}}, "expected_version": 0})
            assert saved.status_code == 200 and saved.json()["version"] == 1
            assert client.put("/api/v1/project/editor", headers=admin, json={"document": {}, "expected_version": 0}).status_code == 409
            assert client.put("/api/v1/project/editor", headers=viewer, json={"document": {}, "expected_version": 1}).status_code == 403
            assert client.put("/api/v1/project/editor", headers=admin, json={"document": {"roles": ["PLATFORM_ADMIN"]}, "expected_version": 1}).status_code == 422


def test_platform_settings_and_real_retention_cleanup():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            admin = token("admin")
            viewer = token("viewer")

            # 1. Platform settings read & update
            settings_res = client.get("/api/v1/platform/settings", headers=admin)
            assert settings_res.status_code == 200
            initial = settings_res.json()
            assert "allowed_extensions" in initial
            assert initial["run_timeout_seconds"] == 120

            update_res = client.put(
                "/api/v1/platform/settings",
                headers=admin,
                json={
                    "run_timeout_seconds": 150,
                    "max_concurrent_runs": 4,
                    "max_llm_calls": 15,
                    "max_input_chars": 12000,
                    "max_context_chars": 50000,
                    "retention_days": 60,
                    "mode": "demo",
                },
            )
            assert update_res.status_code == 200
            updated = update_res.json()
            assert updated["run_timeout_seconds"] == 150
            assert updated["retention_days"] == 60
            assert "allowed_extensions" in updated

            # 2. Cleanup authorization
            assert client.post("/api/v1/persistence/cleanup", headers=viewer).status_code == 403

            # 3. Cleanup execution
            cleanup_res = client.post("/api/v1/persistence/cleanup", headers=admin)
            assert cleanup_res.status_code == 200
            cleanup_data = cleanup_res.json()
            assert cleanup_data["status"] == "success"
            assert "purged_attachments" in cleanup_data
            assert "purged_runs" in cleanup_data
            assert "purged_artifacts" in cleanup_data
            assert "freed_bytes" in cleanup_data
            assert "retention_cutoff_utc" in cleanup_data
            assert "timestamp" in cleanup_data
            assert "message" in cleanup_data


def test_notifications_read_tracking_and_marking():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings, token = settings_for(tmpdir)
        app = create_app(settings, connectors=connectors())
        with TestClient(app) as client:
            admin = token("admin")

            # 1. Fetch initial notifications
            res = client.get("/api/v1/notifications", headers=admin)
            assert res.status_code == 200
            data = res.json()
            assert "items" in data
            assert "unread_count" in data
            assert isinstance(data["items"], list)

            if data["items"]:
                first_id = data["items"][0]["id"]
                assert data["items"][0]["read"] is False

                # 2. Mark single notification as read
                mark_res = client.post(
                    "/api/v1/notifications/read",
                    headers=admin,
                    json={"notification_ids": [first_id], "all": False},
                )
                assert mark_res.status_code == 200
                assert mark_res.json()["marked"] == 1

                # 3. Verify notification is now read and unread_count decreased
                after_res = client.get("/api/v1/notifications", headers=admin)
                assert after_res.status_code == 200
                after_data = after_res.json()
                matching = next(n for n in after_data["items"] if n["id"] == first_id)
                assert matching["read"] is True

                # 4. Mark all as read
                mark_all_res = client.post(
                    "/api/v1/notifications/read",
                    headers=admin,
                    json={"all": True},
                )
                assert mark_all_res.status_code == 200
                all_after_res = client.get("/api/v1/notifications", headers=admin)
                assert all_after_res.status_code == 200
                assert all_after_res.json()["unread_count"] == 0
                for item in all_after_res.json()["items"]:
                    assert item["read"] is True

