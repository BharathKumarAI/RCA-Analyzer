ALTER TABLE platform.parameter_definitions
    ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'platform';
-- statement
UPDATE platform.parameter_definitions
SET scope = CASE WHEN allow_project_override THEN 'project' ELSE 'platform' END;
-- statement
ALTER TABLE platform.parameter_definitions
    ADD CONSTRAINT parameter_definition_scope_check
    CHECK (scope IN ('platform', 'project', 'platform_only'));
