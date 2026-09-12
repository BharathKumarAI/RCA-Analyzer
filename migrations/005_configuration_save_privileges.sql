-- Configuration saves append snapshots and update only a seeded version pointer.
-- Deployment still owns initial scope creation and historical bundle maintenance.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
  REVOKE UPDATE, DELETE ON platform.configuration_bundles FROM rca_app;
  REVOKE INSERT, UPDATE, DELETE ON platform.active_configuration FROM rca_app;
  GRANT SELECT, INSERT ON platform.configuration_bundles TO rca_app;
  GRANT SELECT ON platform.active_configuration TO rca_app;
  GRANT UPDATE (content_hash) ON platform.active_configuration TO rca_app;
 END IF;
END $$;
