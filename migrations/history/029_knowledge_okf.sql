ALTER TABLE platform.platform_knowledge
    ADD COLUMN IF NOT EXISTS okf JSONB,
    ADD COLUMN IF NOT EXISTS okf_bundle_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS okf_concept_path VARCHAR(1024);
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_okf_path
    ON platform.platform_knowledge (tenant_id, project_id, okf_bundle_id, okf_concept_path);
-- statement
CREATE TABLE IF NOT EXISTS platform.knowledge_okf_bundles (
    bundle_id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    name VARCHAR(256) NOT NULL,
    revision INTEGER NOT NULL,
    content_hash VARCHAR(128) NOT NULL,
    concept_count INTEGER NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
);
-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.knowledge_okf_bundles TO rca_app;
