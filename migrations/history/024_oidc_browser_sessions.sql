CREATE TABLE runtime.oidc_login_transactions (
    state_hash VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    browser_hash VARCHAR(64) NOT NULL,
    nonce_hash VARCHAR(64) NOT NULL,
    code_verifier VARCHAR(128) NOT NULL,
    configuration_hash VARCHAR(128) NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX ix_runtime_oidc_login_transactions_expires_at ON runtime.oidc_login_transactions(expires_at);
-- statement
CREATE TABLE runtime.browser_sessions (
    session_hash VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    subject VARCHAR(256) NOT NULL,
    issuer VARCHAR(2048) NOT NULL,
    configuration_hash VARCHAR(128) NOT NULL,
    csrf_hash VARCHAR(64) NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX ix_runtime_browser_sessions_expires_at ON runtime.browser_sessions(expires_at);
-- statement
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON runtime.oidc_login_transactions, runtime.browser_sessions TO rca_app;
    END IF;
END $$;
