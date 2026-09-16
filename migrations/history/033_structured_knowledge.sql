ALTER TABLE platform.platform_knowledge
    ADD COLUMN IF NOT EXISTS structure JSONB,
    ADD COLUMN IF NOT EXISTS capture JSONB;
-- statement
CREATE TABLE IF NOT EXISTS platform.knowledge_captures (
    capture_key VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    source_kind VARCHAR(32) NOT NULL,
    source_id VARCHAR(512) NOT NULL,
    source_hash VARCHAR(128) NOT NULL,
    source_modified_at DOUBLE PRECISION NOT NULL,
    unavailable_at DOUBLE PRECISION,
    doc_id VARCHAR(128) NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    last_seen_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE TABLE IF NOT EXISTS platform.knowledge_source_states (
    source_key VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    source_kind VARCHAR(32) NOT NULL,
    source_id VARCHAR(512) NOT NULL,
    unavailable_at DOUBLE PRECISION NOT NULL,
    source_modified_at DOUBLE PRECISION
);
-- statement
CREATE INDEX IF NOT EXISTS knowledge_captures_source_version
    ON platform.knowledge_captures (tenant_id, project_id, source_kind, source_id,
                                   source_modified_at DESC, last_seen_at DESC, created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS knowledge_source_states_scope
    ON platform.knowledge_source_states (tenant_id, project_id, source_kind, source_id);
-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.knowledge_captures, platform.knowledge_source_states,
    platform.knowledge_uploads TO rca_app;
