CREATE TABLE IF NOT EXISTS platform.triage_tickets (
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    summary VARCHAR(512) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority VARCHAR(16) NOT NULL DEFAULT 'P2',
    status VARCHAR(64) NOT NULL DEFAULT 'Open',
    work_state VARCHAR(64) NOT NULL DEFAULT 'NEW',
    current_team VARCHAR(128) NOT NULL DEFAULT 'Triage Team',
    assignee VARCHAR(128),
    reporter VARCHAR(128),
    environment VARCHAR(64),
    service VARCHAR(128),
    labels JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (ticket_id, tenant_id, project_id)
);
-- statement
CREATE INDEX IF NOT EXISTS ix_triage_tickets_project ON platform.triage_tickets(tenant_id, project_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.triage_queue_stays (
    stay_id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    entered_at DOUBLE PRECISION NOT NULL,
    exited_at DOUBLE PRECISION,
    accountable_duration DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    reason VARCHAR(256) NOT NULL DEFAULT 'Initial triage',
    previous_team VARCHAR(128),
    created_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_triage_queue_stays_ticket ON platform.triage_queue_stays(tenant_id, project_id, ticket_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.triage_investigations (
    investigation_id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'READY',
    owner VARCHAR(128),
    auto_triage_run_id VARCHAR(128),
    auto_triage_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    what_changed JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL,
    finalized_at DOUBLE PRECISION
);
-- statement
CREATE INDEX IF NOT EXISTS ix_triage_investigations_ticket ON platform.triage_investigations(tenant_id, project_id, ticket_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.tool_proposals (
    proposal_id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    capability VARCHAR(64) NOT NULL,
    title VARCHAR(256) NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    generated_query TEXT NOT NULL,
    current_query TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'GENERATED',
    latest_result JSONB,
    execution_count INTEGER NOT NULL DEFAULT 0,
    is_recommended BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_tool_proposals_inv ON platform.tool_proposals(tenant_id, project_id, investigation_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.investigation_evidence (
    evidence_id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    source VARCHAR(64) NOT NULL,
    query_ref VARCHAR(256),
    summary VARCHAR(512) NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'CANDIDATE',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    created_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_investigation_evidence_inv ON platform.investigation_evidence(tenant_id, project_id, investigation_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.investigation_findings (
    finding_id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    statement TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    status VARCHAR(32) NOT NULL DEFAULT 'PROPOSED',
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_investigation_findings_inv ON platform.investigation_findings(tenant_id, project_id, investigation_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.governed_actions (
    action_id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    title VARCHAR(256) NOT NULL,
    target VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PROPOSED',
    requested_by VARCHAR(128) NOT NULL DEFAULT 'PRISM Auto-Triage',
    approved_by VARCHAR(128),
    executed_at DOUBLE PRECISION,
    created_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_governed_actions_inv ON platform.governed_actions(tenant_id, project_id, investigation_id);
-- statement
CREATE TABLE IF NOT EXISTS platform.investigation_events (
    event_id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(128) NOT NULL,
    investigation_id VARCHAR(64),
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_type VARCHAR(16) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    summary VARCHAR(512) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_investigation_events_ticket ON platform.investigation_events(tenant_id, project_id, ticket_id);
-- statement
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.triage_tickets TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.triage_queue_stays TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.triage_investigations TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.tool_proposals TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.investigation_evidence TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.investigation_findings TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.governed_actions TO rca_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.investigation_events TO rca_app;
    END IF;
END $$;
