CREATE TABLE platform.integration_configurations (
 tenant_id varchar(256) NOT NULL,
 project_id varchar(256) NOT NULL,
 integration_id varchar(64) NOT NULL,
 definition_json text NOT NULL,
 revision varchar(32) NOT NULL,
 created_time timestamptz NOT NULL,
 edited_time timestamptz NOT NULL,
 created_by text NOT NULL,
 edited_by text NOT NULL,
 etl_src_system text NOT NULL,
 etl_batch_id text NOT NULL,
 PRIMARY KEY (tenant_id, project_id, integration_id)
);
-- statement
CREATE TRIGGER stamp_etl_lineage BEFORE INSERT OR UPDATE ON platform.integration_configurations
FOR EACH ROW EXECUTE FUNCTION platform.stamp_etl_lineage();
-- statement
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON platform.integration_configurations TO rca_app;
 END IF;
END $$;
