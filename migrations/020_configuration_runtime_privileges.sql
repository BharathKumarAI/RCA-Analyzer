-- Keep applied migration 018 immutable; grant access to the new configuration
-- tables and the generated override key only after their schemas exist.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, UPDATE ON platform.project_templates TO rca_app;
        GRANT SELECT, INSERT, UPDATE ON platform.system_configurations TO rca_app;
        GRANT USAGE, SELECT ON SEQUENCE project.parameter_overrides_override_id_seq TO rca_app;
    END IF;
END $$;
