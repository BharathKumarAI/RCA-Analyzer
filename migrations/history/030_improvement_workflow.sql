CREATE TABLE optimization.improvement_candidates (
	candidate_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	author_subject VARCHAR(256) NOT NULL, 
	source_key VARCHAR(256) NOT NULL, 
	source_run_id VARCHAR(128) NOT NULL, 
	source_subject VARCHAR(256) NOT NULL, 
	capability VARCHAR(64) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	revision INTEGER NOT NULL, 
	payload_json VARCHAR NOT NULL, 
	verified_json VARCHAR, 
	verifier_subject VARCHAR(256), 
	reason VARCHAR, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (candidate_id), 
	UNIQUE (tenant_id, project_id, source_key)
);
-- statement
CREATE TABLE optimization.improvement_jobs (
	job_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	author_subject VARCHAR(256) NOT NULL, 
	payload_json VARCHAR NOT NULL, 
	fingerprint VARCHAR(128) NOT NULL, 
	idempotency_key VARCHAR(128), 
	status VARCHAR(32) NOT NULL, 
	attempts INTEGER NOT NULL, 
	cancel_requested BOOLEAN NOT NULL, 
	lease_owner VARCHAR(128), 
	lease_until FLOAT, 
	result_json VARCHAR, 
	error VARCHAR, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (job_id), 
	UNIQUE (tenant_id, project_id, author_subject, idempotency_key)
);
-- statement
CREATE TABLE optimization.improvement_schedules (
	schedule_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	author_subject VARCHAR(256) NOT NULL, 
	name VARCHAR(128) NOT NULL, 
	payload_json VARCHAR NOT NULL, 
	interval_seconds INTEGER NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	revision INTEGER NOT NULL, 
	next_run_at FLOAT NOT NULL, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (schedule_id)
);
-- statement
CREATE TABLE optimization.optimization_changes (
	change_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	optimization_id VARCHAR(128) NOT NULL, 
	actor_subject VARCHAR(256) NOT NULL, 
	action VARCHAR(32) NOT NULL, 
	previous_hash VARCHAR(128) NOT NULL, 
	restored_hash VARCHAR(128), 
	reason VARCHAR NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (change_id)
);
-- statement
CREATE INDEX improvement_jobs_claim ON optimization.improvement_jobs(tenant_id, status, lease_until, created_at);
-- statement
CREATE INDEX improvement_schedules_due ON optimization.improvement_schedules(tenant_id, enabled, next_run_at);
-- statement
CREATE INDEX improvement_candidates_scope ON optimization.improvement_candidates(tenant_id, project_id, created_at);
-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON optimization.improvement_jobs, optimization.improvement_schedules, optimization.improvement_candidates, optimization.optimization_changes TO rca_app;
