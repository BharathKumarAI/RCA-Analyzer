CREATE TABLE IF NOT EXISTS platform.connector_environment_connections (
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	instance_id VARCHAR(64) NOT NULL,
	connection_id VARCHAR(64) NOT NULL,
	connection_name VARCHAR(128) NOT NULL,
	environment_name VARCHAR(64) NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT FALSE,
	routing_mode VARCHAR(32) NOT NULL DEFAULT 'direct',
	auth_profile_id VARCHAR(64),
	target_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	credentials_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	mcp_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
	resource_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
	status VARCHAR(32) NOT NULL DEFAULT 'draft',
	test_status VARCHAR(32) NOT NULL DEFAULT 'not_tested',
	last_tested_at FLOAT,
	created_at FLOAT NOT NULL,
	updated_at FLOAT NOT NULL,
	PRIMARY KEY (tenant_id, project_id, instance_id, connection_id)
);
-- statement
ALTER TABLE platform.project_environment_bindings ADD COLUMN IF NOT EXISTS connection_id VARCHAR(64);
-- statement
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.connector_environment_connections TO rca_app;
	END IF;
END $$;
