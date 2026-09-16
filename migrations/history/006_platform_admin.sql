CREATE TABLE platform.platform_users (
	subject VARCHAR(256) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	name VARCHAR(256) NOT NULL,
	email VARCHAR(256),
	roles JSONB NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	created_at FLOAT NOT NULL,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (subject, tenant_id, project_id)
);
-- statement
CREATE TABLE platform.platform_roles (
	role_id VARCHAR(64) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	name VARCHAR(256) NOT NULL,
	description VARCHAR(1000) NOT NULL,
	permissions JSONB NOT NULL,
	is_system BOOLEAN NOT NULL DEFAULT FALSE,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (role_id, tenant_id)
);
-- statement
CREATE TABLE platform.platform_billing (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	tier VARCHAR(64) NOT NULL DEFAULT 'Standard',
	monthly_spend_budget FLOAT NOT NULL DEFAULT 500.0,
	monthly_token_budget INTEGER NOT NULL DEFAULT 50000000,
	max_concurrent_investigations INTEGER NOT NULL DEFAULT 4,
	rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
	rate_limit_tpm INTEGER NOT NULL DEFAULT 250000,
	alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
	webhook_url VARCHAR(1024),
	pricing_matrix JSONB NOT NULL,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id)
);
-- statement
CREATE TABLE platform.platform_policy (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	redaction_patterns JSONB NOT NULL,
	guardrails JSONB NOT NULL,
	skill_guardrails JSONB NOT NULL,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id)
);
-- statement
CREATE TABLE platform.platform_file_limits (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	max_file_bytes INTEGER NOT NULL DEFAULT 10485760,
	max_files INTEGER NOT NULL DEFAULT 10,
	max_text_chars INTEGER NOT NULL DEFAULT 50000,
	max_pdf_pages INTEGER NOT NULL DEFAULT 20,
	max_rows INTEGER NOT NULL DEFAULT 2000,
	max_cells INTEGER NOT NULL DEFAULT 20000,
	parser_timeout_seconds INTEGER NOT NULL DEFAULT 30,
	concurrency INTEGER NOT NULL DEFAULT 4,
	allowed_extensions JSONB NOT NULL,
	retention_days INTEGER NOT NULL DEFAULT 90,
	auto_prune_enabled BOOLEAN NOT NULL DEFAULT TRUE,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id)
);
-- statement
CREATE TABLE platform.platform_knowledge (
	doc_id VARCHAR(128) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	title VARCHAR(256) NOT NULL,
	category VARCHAR(128) NOT NULL DEFAULT 'Runbooks',
	tags JSONB NOT NULL,
	content TEXT NOT NULL,
	media_type VARCHAR(64) NOT NULL DEFAULT 'text/markdown',
	size_bytes INTEGER NOT NULL DEFAULT 0,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	created_at FLOAT NOT NULL,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (doc_id)
);
-- statement
CREATE TABLE platform.platform_alerts (
	alert_id VARCHAR(128) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	severity VARCHAR(32) NOT NULL DEFAULT 'warning',
	source VARCHAR(64) NOT NULL DEFAULT 'operator',
	component VARCHAR(128) NOT NULL DEFAULT 'platform',
	title VARCHAR(256) NOT NULL,
	summary VARCHAR(1000) NOT NULL,
	message TEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'open',
	resolution_note TEXT,
	created_at FLOAT NOT NULL,
	resolved_at FLOAT,
	PRIMARY KEY (alert_id)
);
-- statement
CREATE TABLE platform.platform_alert_config (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	mttr_warning_minutes INTEGER NOT NULL DEFAULT 45,
	tool_failure_rate_percent INTEGER NOT NULL DEFAULT 15,
	probe_latency_warning_ms INTEGER NOT NULL DEFAULT 2500,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id)
);
-- statement
CREATE TABLE platform.platform_runtime_stages (
	stage_id VARCHAR(64) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	name VARCHAR(256) NOT NULL,
	model VARCHAR(128) NOT NULL,
	thinking_level VARCHAR(64) NOT NULL DEFAULT 'medium',
	thinking_budget INTEGER NOT NULL DEFAULT 2048,
	output_limit INTEGER NOT NULL DEFAULT 4096,
	temperature FLOAT NOT NULL DEFAULT 0.2,
	tool_limit INTEGER NOT NULL DEFAULT 10,
	tools JSONB NOT NULL,
	instruction TEXT NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT TRUE,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (stage_id, tenant_id, project_id)
);
-- statement
CREATE TABLE platform.platform_settings (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	run_timeout_seconds INTEGER NOT NULL DEFAULT 120,
	max_concurrent_runs INTEGER NOT NULL DEFAULT 4,
	max_llm_calls INTEGER NOT NULL DEFAULT 12,
	max_input_chars INTEGER NOT NULL DEFAULT 16000,
	max_context_chars INTEGER NOT NULL DEFAULT 64000,
	retention_days INTEGER NOT NULL DEFAULT 90,
	allowed_extensions JSONB NOT NULL,
	mode VARCHAR(32) NOT NULL DEFAULT 'demo',
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id)
);
-- statement
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_users TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_roles TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_billing TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_policy TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_file_limits TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_knowledge TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_alerts TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_alert_config TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_runtime_stages TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_settings TO rca_app;
	END IF;
END $$;
