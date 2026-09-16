CREATE TABLE platform.project_catalog (
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(4000) NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_by VARCHAR(256) NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, project_id)
);
-- statement
CREATE TABLE platform.project_preferences (
    tenant_id VARCHAR(256) NOT NULL,
    subject VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    last_accessed_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, subject)
);
-- statement
-- Creating a workspace appends a project and its initial configuration pointer.
-- Existing scope keys and historical configurations remain immutable.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, UPDATE ON platform.project_catalog, platform.project_preferences TO rca_app;
        GRANT SELECT, INSERT ON project.projects TO rca_app;
        GRANT INSERT ON platform.active_configuration TO rca_app;
    END IF;
END $$;
