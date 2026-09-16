CREATE TABLE runtime.run_feedback (
    run_id VARCHAR(128) PRIMARY KEY REFERENCES runtime.runs(run_id) ON DELETE CASCADE,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    subject VARCHAR(256) NOT NULL,
    rating VARCHAR(32) NOT NULL CHECK (rating IN ('helpful', 'needs_work')),
    note TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX ix_run_feedback_project ON runtime.run_feedback(tenant_id, project_id);
-- statement
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON runtime.run_feedback TO rca_app;
    END IF;
END $$;
