CREATE TABLE IF NOT EXISTS optimization.ticket_closure_tracking (
    tracking_id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    source_run_id VARCHAR(128) NOT NULL,
    ticket_key VARCHAR(64) NOT NULL,
    capability VARCHAR(64) NOT NULL,
    selection_json TEXT NOT NULL,
    snapshot_hash VARCHAR(128) NOT NULL,
    original_json TEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    closure_hash VARCHAR(128),
    latest_judgment_id VARCHAR(128),
    last_checked_at DOUBLE PRECISION,
    closed_at DOUBLE PRECISION,
    source_modified_at DOUBLE PRECISION,
    last_error VARCHAR(1000),
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL,
    UNIQUE (tenant_id, project_id, source_run_id, ticket_key)
);
-- statement
CREATE INDEX IF NOT EXISTS ix_ticket_closure_tracking_scope
    ON optimization.ticket_closure_tracking (tenant_id, project_id, tracking_id);
-- statement
CREATE TABLE IF NOT EXISTS optimization.ticket_closure_judgments (
    judgment_id VARCHAR(128) PRIMARY KEY,
    tracking_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    closure_hash VARCHAR(128) NOT NULL,
    context_hash VARCHAR(128) NOT NULL,
    model VARCHAR(128) NOT NULL,
    prompt_hash VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    deviation_score DOUBLE PRECISION,
    confidence DOUBLE PRECISION NOT NULL,
    payload_json TEXT NOT NULL,
    closure_json TEXT NOT NULL,
    usage_json TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    UNIQUE (tracking_id, closure_hash, context_hash)
);
-- statement
CREATE INDEX IF NOT EXISTS ix_ticket_closure_judgments_tracking
    ON optimization.ticket_closure_judgments (tenant_id, project_id, tracking_id, created_at);
-- statement
GRANT SELECT, INSERT, UPDATE, DELETE
    ON optimization.ticket_closure_tracking, optimization.ticket_closure_judgments TO rca_app;
