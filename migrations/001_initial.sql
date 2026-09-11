-- Clean PostgreSQL baseline. Apply with python -m scripts.migrate.
CREATE SCHEMA IF NOT EXISTS runtime;
-- statement
CREATE SCHEMA IF NOT EXISTS governance;
-- statement
CREATE SCHEMA IF NOT EXISTS optimization;
-- statement
CREATE SCHEMA IF NOT EXISTS platform;
-- statement
CREATE SCHEMA IF NOT EXISTS project;
-- statement
CREATE SCHEMA IF NOT EXISTS adk;
-- statement
CREATE TABLE runtime.attachments (
	attachment_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	subject VARCHAR(256) NOT NULL, 
	payload_json VARCHAR NOT NULL, 
	created_at FLOAT NOT NULL, 
	expires_at FLOAT NOT NULL, 
	PRIMARY KEY (attachment_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE runtime.chat_artifacts (
	artifact_id VARCHAR(128) NOT NULL, 
	chat_id VARCHAR(128) NOT NULL, 
	attachment_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	subject VARCHAR(256) NOT NULL, 
	filename VARCHAR NOT NULL, 
	media_type VARCHAR(256) NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	processed_hash VARCHAR(128) NOT NULL, 
	processed_expires_at FLOAT NOT NULL, 
	size_bytes INTEGER NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at FLOAT NOT NULL, 
	expires_at FLOAT NOT NULL, 
	PRIMARY KEY (artifact_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_runtime_chat_artifacts_chat_id ON runtime.chat_artifacts (chat_id);
-- statement
CREATE TABLE runtime.chat_runs (
	run_id VARCHAR(128) NOT NULL, 
	chat_id VARCHAR(128) NOT NULL, 
	PRIMARY KEY (run_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS ix_runtime_chat_runs_chat_id ON runtime.chat_runs (chat_id);
-- statement
CREATE TABLE runtime.chats (
	chat_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	subject VARCHAR(256) NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (chat_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE runtime.evidence (
	evidence_id VARCHAR(128) NOT NULL, 
	run_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	bundle_json VARCHAR NOT NULL, 
	content_hash VARCHAR(128) NOT NULL, 
	PRIMARY KEY (evidence_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE runtime.runs (
	run_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	subject VARCHAR(256) NOT NULL, 
	idempotency_key_hash VARCHAR(64), 
	request_hash VARCHAR(128) NOT NULL, 
	contract_json VARCHAR NOT NULL, 
	snapshot_hash VARCHAR(128) NOT NULL, 
	deadline FLOAT NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	stage VARCHAR(128) NOT NULL, 
	result_json VARCHAR, 
	reason VARCHAR, 
	trace_id VARCHAR(256), 
	evidence_count INTEGER NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at FLOAT NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (run_id), 
	UNIQUE (idempotency_key_hash),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE governance.active_agent_configs (
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	agent_id VARCHAR(64) NOT NULL, 
	draft_id VARCHAR(128) NOT NULL, 
	content_hash VARCHAR(128) NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (tenant_id, project_id, agent_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE governance.agent_config_audit (
	event_id SERIAL NOT NULL, 
	draft_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	event VARCHAR(16) NOT NULL, 
	actor_subject VARCHAR(256) NOT NULL, 
	reason VARCHAR NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (event_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE governance.agent_config_drafts (
	draft_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	author_subject VARCHAR(256) NOT NULL, 
	definition_json VARCHAR NOT NULL, 
	blob_hash VARCHAR(128) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at FLOAT NOT NULL, 
	reviewed_at FLOAT, 
	reviewer_subject VARCHAR(256), 
	review_reason VARCHAR, 
	PRIMARY KEY (draft_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE optimization.active_optimized_content (
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	report_hash VARCHAR(128) NOT NULL, 
	optimization_id VARCHAR(128) NOT NULL, 
	PRIMARY KEY (tenant_id, project_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE optimization.optimization_datasets (
	record_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	dataset_id VARCHAR(64) NOT NULL, 
	version VARCHAR(64) NOT NULL, 
	blob_hash VARCHAR(128) NOT NULL, 
	purpose VARCHAR(32) NOT NULL, 
	metadata_json VARCHAR NOT NULL, 
	author_subject VARCHAR(256) NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (record_id), 
	UNIQUE (tenant_id, project_id, dataset_id, version),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE optimization.optimization_revisions (
	optimization_id VARCHAR(128) NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	author_subject VARCHAR(256) NOT NULL, 
	request_json VARCHAR NOT NULL, 
	dataset_hash VARCHAR(128) NOT NULL, 
	parent_hash VARCHAR(128), 
	context_hash VARCHAR(128) NOT NULL, 
	report_hash VARCHAR(128), 
	status VARCHAR(32) NOT NULL, 
	reason VARCHAR, 
	created_at FLOAT NOT NULL, 
	deadline FLOAT NOT NULL, 
	reviewer_subject VARCHAR(256), 
	reviewed_at FLOAT, 
	PRIMARY KEY (optimization_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE governance.parameter_audit (
	event_id SERIAL NOT NULL, 
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256), 
	tool VARCHAR(64) NOT NULL, 
	variable_name VARCHAR(64) NOT NULL, 
	actor_subject VARCHAR(256) NOT NULL, 
	action VARCHAR(32) NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (event_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE platform.parameter_definitions (
	tenant_id VARCHAR(256) NOT NULL, 
	tool VARCHAR(64) NOT NULL, 
	variable_name VARCHAR(64) NOT NULL, 
	value_type VARCHAR(16) NOT NULL, 
	description VARCHAR(2000) NOT NULL, 
	default_value JSONB NOT NULL, 
	allow_project_override BOOLEAN NOT NULL, 
	icon VARCHAR(64) NOT NULL, 
	revision INTEGER NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (tenant_id, tool, variable_name), 
	CHECK (value_type IN ('string','integer','number','boolean','json','secret_ref')), 
	CHECK (revision > 0),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE project.projects (
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	project_name VARCHAR(256) NOT NULL, 
	PRIMARY KEY (tenant_id, project_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE project.parameter_overrides (
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	tool VARCHAR(64) NOT NULL, 
	variable_name VARCHAR(64) NOT NULL, 
	value JSONB NOT NULL, 
	revision INTEGER NOT NULL, 
	updated_at FLOAT NOT NULL, 
	PRIMARY KEY (tenant_id, project_id, tool, variable_name), 
	FOREIGN KEY(tenant_id, tool, variable_name) REFERENCES platform.parameter_definitions (tenant_id, tool, variable_name), 
	FOREIGN KEY(tenant_id, project_id) REFERENCES project.projects (tenant_id, project_id), 
	CHECK (revision > 0),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE platform.active_configuration (
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	content_hash VARCHAR(128) NOT NULL, 
	PRIMARY KEY (tenant_id, project_id),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE TABLE platform.configuration_bundles (
	tenant_id VARCHAR(256) NOT NULL, 
	project_id VARCHAR(256) NOT NULL, 
	content_hash VARCHAR(128) NOT NULL, 
	files JSONB NOT NULL, 
	created_at FLOAT NOT NULL, 
	PRIMARY KEY (tenant_id, project_id, content_hash),
	etl_loaded_at TIMESTAMPTZ NOT NULL,
	etl_source_system TEXT NOT NULL,
	etl_batch_id TEXT NOT NULL
);
-- statement
CREATE INDEX IF NOT EXISTS runs_scope_created ON runtime.runs (tenant_id, project_id, created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS runs_retention ON runtime.runs (status, updated_at);
-- statement
CREATE INDEX IF NOT EXISTS evidence_scope_run ON runtime.evidence (tenant_id, project_id, run_id);
-- statement
CREATE INDEX IF NOT EXISTS chats_scope_created ON runtime.chats (tenant_id, project_id, subject, created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS attachments_expiry ON runtime.attachments (expires_at);
-- statement
CREATE INDEX IF NOT EXISTS drafts_scope_created ON governance.agent_config_drafts (tenant_id, project_id, created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS optimization_scope_created ON optimization.optimization_revisions (tenant_id, project_id, created_at DESC);
-- statement
CREATE TABLE adk.adk_internal_metadata (
	key VARCHAR(128) NOT NULL, 
	value VARCHAR(256) NOT NULL, 
	PRIMARY KEY (key)
);
-- statement
CREATE TABLE adk.app_states (
	app_name VARCHAR(128) NOT NULL, 
	state JSONB NOT NULL, 
	update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (app_name)
);
-- statement
CREATE TABLE adk.sessions (
	app_name VARCHAR(128) NOT NULL, 
	user_id VARCHAR(128) NOT NULL, 
	id VARCHAR(128) NOT NULL, 
	state JSONB NOT NULL, 
	create_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (app_name, user_id, id)
);
-- statement
CREATE TABLE adk.user_states (
	app_name VARCHAR(128) NOT NULL, 
	user_id VARCHAR(128) NOT NULL, 
	state JSONB NOT NULL, 
	update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (app_name, user_id)
);
-- statement
CREATE TABLE adk.events (
	id VARCHAR(128) NOT NULL, 
	app_name VARCHAR(128) NOT NULL, 
	user_id VARCHAR(128) NOT NULL, 
	session_id VARCHAR(128) NOT NULL, 
	invocation_id VARCHAR(256) NOT NULL, 
	timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	event_data JSONB, 
	PRIMARY KEY (id, app_name, user_id, session_id), 
	FOREIGN KEY(app_name, user_id, session_id) REFERENCES adk.sessions (app_name, user_id, id) ON DELETE CASCADE
);
-- statement
CREATE INDEX IF NOT EXISTS idx_events_app_user_session_ts ON adk.events (app_name, user_id, session_id, timestamp DESC);
-- statement
INSERT INTO adk.adk_internal_metadata (key, value) VALUES ('schema_version', '1') ON CONFLICT (key) DO NOTHING;
-- statement
CREATE FUNCTION platform.parameter_value_valid(kind text, val jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT coalesce(CASE kind
  WHEN 'string' THEN jsonb_typeof(val) = 'string'
  WHEN 'integer' THEN jsonb_typeof(val) = 'number' AND (val #>> '{}')::numeric = trunc((val #>> '{}')::numeric)
  WHEN 'number' THEN jsonb_typeof(val) = 'number'
  WHEN 'boolean' THEN jsonb_typeof(val) = 'boolean'
  WHEN 'json' THEN jsonb_typeof(val) IN ('array', 'object')
  WHEN 'secret_ref' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ '^env://[A-Z][A-Z0-9_]{0,127}$'
  ELSE false END, false) AND octet_length(val::text) <= 16384
$$;
-- statement
ALTER TABLE platform.parameter_definitions ADD CONSTRAINT parameter_default_typed
CHECK (platform.parameter_value_valid(value_type, default_value::jsonb));
-- statement
ALTER TABLE platform.parameter_definitions ADD CONSTRAINT parameter_secret_reference
CHECK (variable_name !~ '(^|_)(password|token|secret|api_key|credential)(_|$)' OR value_type = 'secret_ref');
-- statement
ALTER TABLE platform.parameter_definitions ADD CONSTRAINT parameter_identifiers
CHECK (tool ~ '^[a-z][a-z0-9_]{0,63}$' AND variable_name ~ '^[a-z][a-z0-9_]{0,63}$');
-- statement
CREATE FUNCTION platform.validate_project_parameter() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE definition platform.parameter_definitions%ROWTYPE;
BEGIN
 SELECT * INTO definition FROM platform.parameter_definitions
 WHERE tenant_id = NEW.tenant_id AND tool = NEW.tool AND variable_name = NEW.variable_name
 FOR UPDATE;
 IF NOT FOUND OR NOT definition.allow_project_override THEN
  RAISE EXCEPTION 'Platform parameter does not permit a project override';
 END IF;
 IF NOT platform.parameter_value_valid(definition.value_type, NEW.value::jsonb) THEN
  RAISE EXCEPTION 'Project parameter value has invalid type';
 END IF;
 RETURN NEW;
END $$;
-- statement
CREATE TRIGGER validate_project_parameter BEFORE INSERT OR UPDATE ON project.parameter_overrides
FOR EACH ROW EXECUTE FUNCTION platform.validate_project_parameter();
-- statement
CREATE FUNCTION platform.validate_parameter_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM project.parameter_overrides
  WHERE tenant_id = NEW.tenant_id AND tool = NEW.tool AND variable_name = NEW.variable_name
  AND (NOT NEW.allow_project_override OR NOT platform.parameter_value_valid(NEW.value_type, value::jsonb))) THEN
  RAISE EXCEPTION 'Existing project overrides conflict with the platform definition';
 END IF;
 RETURN NEW;
END $$;
-- statement
CREATE TRIGGER validate_parameter_change BEFORE UPDATE ON platform.parameter_definitions
FOR EACH ROW EXECUTE FUNCTION platform.validate_parameter_change();
-- statement
ALTER TABLE runtime.runs ADD CONSTRAINT runs_scope_key UNIQUE (run_id, tenant_id, project_id);
-- statement
ALTER TABLE runtime.runs ADD CONSTRAINT runs_status_valid
CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'SIMULATED', 'BLOCKED'));
-- statement
ALTER TABLE runtime.runs ADD CONSTRAINT runs_counts_valid CHECK (evidence_count >= 0 AND revision >= 0);
-- statement
ALTER TABLE runtime.evidence ADD CONSTRAINT evidence_scoped_run
FOREIGN KEY (run_id, tenant_id, project_id) REFERENCES runtime.runs (run_id, tenant_id, project_id) ON DELETE CASCADE;
-- statement
ALTER TABLE runtime.chat_runs ADD CONSTRAINT chat_runs_parent
FOREIGN KEY (run_id) REFERENCES runtime.runs (run_id) ON DELETE CASCADE;
-- statement
ALTER TABLE runtime.chat_runs ADD CONSTRAINT chat_runs_chat
FOREIGN KEY (chat_id) REFERENCES runtime.chats (chat_id) ON DELETE CASCADE;
-- statement
ALTER TABLE runtime.chats ADD CONSTRAINT chats_owner_key UNIQUE (chat_id, tenant_id, project_id, subject);
-- statement
ALTER TABLE runtime.chat_artifacts ADD CONSTRAINT artifacts_owned_chat
FOREIGN KEY (chat_id, tenant_id, project_id, subject)
REFERENCES runtime.chats (chat_id, tenant_id, project_id, subject);
-- statement
ALTER TABLE platform.active_configuration ADD CONSTRAINT active_bundle_version
FOREIGN KEY (tenant_id, project_id, content_hash)
REFERENCES platform.configuration_bundles (tenant_id, project_id, content_hash);
-- statement
CREATE SCHEMA IF NOT EXISTS mlflow;
-- statement
-- Only load time, source, and batch are ETL metadata. Business timestamps,
-- actor audit records, primary keys, and content hashes stay in their own fields.
CREATE FUNCTION platform.stamp_etl_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 NEW.etl_loaded_at := clock_timestamp();
 NEW.etl_source_system := coalesce(nullif(current_setting('rca.etl_source', true), ''), 'database');
 NEW.etl_batch_id := coalesce(nullif(current_setting('rca.etl_batch', true), ''), pg_current_xact_id()::text);
 RETURN NEW;
END $$;
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON runtime.attachments
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON runtime.chat_artifacts
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON runtime.chat_runs
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON runtime.chats
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON runtime.evidence
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON runtime.runs
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON governance.active_agent_configs
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON governance.agent_config_audit
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON governance.agent_config_drafts
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON optimization.active_optimized_content
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON optimization.optimization_datasets
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON optimization.optimization_revisions
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON governance.parameter_audit
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON platform.parameter_definitions
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON project.projects
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON project.parameter_overrides
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON platform.active_configuration
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON platform.configuration_bundles
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
