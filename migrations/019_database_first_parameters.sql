ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS label VARCHAR(256);
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS section VARCHAR(64);
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS display_order INTEGER;
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS ownership VARCHAR(32) NOT NULL DEFAULT 'runtime';
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS validation_rules JSONB;
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS runtime_binding VARCHAR(128);
-- statement
ALTER TABLE project.parameter_overrides
    ADD COLUMN IF NOT EXISTS instance_id VARCHAR(128);
-- statement
ALTER TABLE project.parameter_overrides
    ADD COLUMN IF NOT EXISTS environment_id VARCHAR(64);
-- statement
ALTER TABLE project.parameter_overrides
    DROP CONSTRAINT IF EXISTS parameter_overrides_pkey;
-- statement
ALTER TABLE project.parameter_overrides
    ADD COLUMN IF NOT EXISTS override_id BIGSERIAL PRIMARY KEY;
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS parameter_overrides_scope_uidx ON project.parameter_overrides (
    tenant_id, project_id, tool, variable_name,
    COALESCE(instance_id, ''),
    COALESCE(environment_id, '')
);
-- statement
CREATE TABLE IF NOT EXISTS platform.system_configurations (
    tenant_id VARCHAR(256) NOT NULL,
    config_type VARCHAR(64) NOT NULL,
    config_key VARCHAR(128) NOT NULL,
    content_json JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at FLOAT NOT NULL,
    PRIMARY KEY (tenant_id, config_type, config_key),
    etl_loaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    etl_source_system TEXT NOT NULL DEFAULT 'platform',
    etl_batch_id TEXT NOT NULL DEFAULT 'initial'
);
