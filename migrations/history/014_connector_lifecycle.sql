CREATE TABLE platform.connector_templates (
	template_id VARCHAR(64) NOT NULL,
	version VARCHAR(32) NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'published',
	definition_json JSONB NOT NULL,
	checksum VARCHAR(64) NOT NULL,
	created_at FLOAT NOT NULL,
	updated_at FLOAT NOT NULL,
	created_by TEXT NOT NULL DEFAULT 'system',
	updated_by TEXT NOT NULL DEFAULT 'system',
	PRIMARY KEY (template_id, version)
);
-- statement
CREATE TABLE platform.project_connector_instances (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	instance_id VARCHAR(64) NOT NULL,
	template_id VARCHAR(64) NOT NULL,
	template_version VARCHAR(32) NOT NULL,
	system_name VARCHAR(64) NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT FALSE,
	status VARCHAR(32) NOT NULL DEFAULT 'draft',
	definition_json JSONB NOT NULL,
	revision INTEGER NOT NULL DEFAULT 1,
	created_at FLOAT NOT NULL,
	updated_at FLOAT NOT NULL,
	created_by TEXT NOT NULL DEFAULT 'admin',
	updated_by TEXT NOT NULL DEFAULT 'admin',
	PRIMARY KEY (tenant_id, project_id, instance_id)
);
-- statement
CREATE TABLE platform.project_environment_bindings (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	instance_id VARCHAR(64) NOT NULL,
	project_env_id VARCHAR(64) NOT NULL,
	tool_env_id VARCHAR(64) NOT NULL,
	external_resource VARCHAR(256) NOT NULL,
	credential_binding_id VARCHAR(128),
	narrowing_filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	created_at FLOAT NOT NULL,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id, instance_id, project_env_id)
);
-- statement
CREATE TABLE platform.connector_candidate_test_results (
	candidate_hash VARCHAR(64) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	instance_id VARCHAR(64) NOT NULL,
	template_id VARCHAR(64) NOT NULL,
	template_version VARCHAR(32) NOT NULL,
	environment_id VARCHAR(64) NOT NULL DEFAULT 'default',
	operation VARCHAR(64) NOT NULL DEFAULT 'test_connection',
	overall_result VARCHAR(32) NOT NULL,
	stage_results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	latency_ms FLOAT NOT NULL DEFAULT 0.0,
	evidence_summary TEXT NOT NULL DEFAULT '',
	error_message TEXT NOT NULL DEFAULT '',
	tested_at FLOAT NOT NULL,
	PRIMARY KEY (candidate_hash, tenant_id, project_id, environment_id)
);
-- statement
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.connector_templates TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.project_connector_instances TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.project_environment_bindings TO rca_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.connector_candidate_test_results TO rca_app;
	END IF;
END $$;
