CREATE TABLE platform.platform_notification_reads (
	notification_id VARCHAR(128) NOT NULL,
	tenant_id VARCHAR(256) NOT NULL,
	project_id VARCHAR(256) NOT NULL,
	subject VARCHAR(256) NOT NULL,
	read_at DOUBLE PRECISION NOT NULL,
	PRIMARY KEY (notification_id, tenant_id, project_id, subject)
);
-- statement
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON platform.platform_notification_reads TO rca_app;
	END IF;
END $$;
