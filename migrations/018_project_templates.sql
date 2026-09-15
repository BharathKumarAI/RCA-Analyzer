CREATE TABLE platform.project_templates (
    tenant_id VARCHAR(256) NOT NULL,
    template_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    name VARCHAR(200) NOT NULL,
    definition JSONB NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('draft', 'published', 'deprecated')),
    revision INTEGER NOT NULL CHECK (revision > 0),
    checksum VARCHAR(128) NOT NULL,
    updated_at FLOAT NOT NULL,
    updated_by VARCHAR(256) NOT NULL,
    PRIMARY KEY (tenant_id, template_id, version)
);
