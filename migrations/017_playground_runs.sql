CREATE TABLE runtime.playground_runs (
    run_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    owner_key VARCHAR(128) NOT NULL,
    capability VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    prompt TEXT NOT NULL,
    result TEXT,
    created_at DOUBLE PRECISION NOT NULL,
    deadline DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX ix_runtime_playground_runs_owner_key ON runtime.playground_runs(owner_key);

-- statement
UPDATE platform.platform_roles SET
    description = 'Starts read-only project triage and views live investigations, metrics, and feedback. Cannot modify project configuration, membership, feedback, or external systems.',
    permissions = '["view_runs","create_runs","view_docs","view_status","view_audit"]'::jsonb
WHERE is_system = TRUE AND role_id IN ('PROJECT_MANAGER', 'PROJECT_VIEWER');
-- statement
UPDATE platform.platform_roles SET
    description = 'Uses personal platform experiments and local text tools without access to any project data or connectors.',
    permissions = '[]'::jsonb
WHERE is_system = TRUE AND role_id = 'GENERIC_USER';

-- statement
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON runtime.playground_runs TO rca_app;
    END IF;
END $$;
