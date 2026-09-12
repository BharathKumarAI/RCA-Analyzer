CREATE TABLE governance.harness_bundles (
 draft_id VARCHAR(128) PRIMARY KEY, tenant_id VARCHAR(256) NOT NULL,
 project_id VARCHAR(256) NOT NULL, capability VARCHAR(128) NOT NULL,
 author_subject VARCHAR(256) NOT NULL, blob_hash VARCHAR(128) NOT NULL,
 revision VARCHAR(128) NOT NULL, status VARCHAR(32) NOT NULL,
 reviewer_subject VARCHAR(256), reason VARCHAR(2000),
 created_at DOUBLE PRECISION NOT NULL, updated_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE TABLE governance.harness_activations (
 tenant_id VARCHAR(256) NOT NULL, project_id VARCHAR(256) NOT NULL,
 capability VARCHAR(128) NOT NULL, draft_id VARCHAR(128) NOT NULL REFERENCES governance.harness_bundles(draft_id),
 revision VARCHAR(128) NOT NULL, PRIMARY KEY(tenant_id,project_id,capability)
);
-- statement
CREATE TABLE governance.harness_bundle_audit (
 id VARCHAR(128) PRIMARY KEY, draft_id VARCHAR(128) NOT NULL,
 tenant_id VARCHAR(256) NOT NULL, project_id VARCHAR(256) NOT NULL,
 actor VARCHAR(256) NOT NULL, action VARCHAR(32) NOT NULL,
 revision VARCHAR(128) NOT NULL, timestamp DOUBLE PRECISION NOT NULL, reason VARCHAR(2000) NOT NULL
);
-- statement
CREATE TABLE runtime.harness_run_events (
 run_id VARCHAR(128) NOT NULL REFERENCES runtime.runs(run_id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL, tenant_id VARCHAR(256) NOT NULL, project_id VARCHAR(256) NOT NULL,
 node_id VARCHAR(256) NOT NULL, kind VARCHAR(64) NOT NULL,
 timestamp DOUBLE PRECISION NOT NULL, details_json TEXT NOT NULL,
 PRIMARY KEY(run_id,sequence)
);
-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON governance.harness_bundles, governance.harness_activations, governance.harness_bundle_audit, runtime.harness_run_events TO rca_app;
