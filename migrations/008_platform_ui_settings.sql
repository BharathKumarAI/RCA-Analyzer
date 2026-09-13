CREATE TABLE platform.platform_ui_settings (
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    brand_name VARCHAR(120) NOT NULL DEFAULT 'RCA Analyzer',
    workspace_label VARCHAR(120) NOT NULL DEFAULT 'Investigation workspace',
    default_theme VARCHAR(16) NOT NULL DEFAULT 'light',
    default_page VARCHAR(64) NOT NULL DEFAULT 'overview',
    welcome_title VARCHAR(200) NOT NULL DEFAULT 'Investigate with confidence',
    welcome_description VARCHAR(1000) NOT NULL DEFAULT 'Trace incidents from evidence to action.',
    navigation JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, project_id)
);
-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_ui_settings TO rca_app;
