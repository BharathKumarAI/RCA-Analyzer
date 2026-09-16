CREATE TABLE platform.project_editor_drafts (
 tenant_id VARCHAR(256) NOT NULL, project_id VARCHAR(256) NOT NULL,
 document JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 updated_at DOUBLE PRECISION NOT NULL, PRIMARY KEY (tenant_id, project_id)
);
-- statement
GRANT SELECT, INSERT, UPDATE ON platform.project_editor_drafts TO rca_app;
