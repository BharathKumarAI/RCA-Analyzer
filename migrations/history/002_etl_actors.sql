-- Existing rows have no reliable creator/updater history; do not invent it.
DO $$
DECLARE target record;
BEGIN
 FOR target IN
  SELECT table_schema, table_name FROM information_schema.columns
  WHERE column_name = 'etl_batch_id'
    AND table_schema IN ('runtime', 'governance', 'optimization', 'platform', 'project')
 LOOP
  EXECUTE format('ALTER TABLE %I.%I ADD COLUMN etl_created_by TEXT NOT NULL DEFAULT %L, ADD COLUMN etl_updated_by TEXT NOT NULL DEFAULT %L',
    target.table_schema, target.table_name, 'legacy:unknown', 'legacy:unknown');
  EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN etl_created_by DROP DEFAULT, ALTER COLUMN etl_updated_by DROP DEFAULT',
    target.table_schema, target.table_name);
 END LOOP;
END $$;
-- statement
CREATE OR REPLACE FUNCTION platform.stamp_etl_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actor text := coalesce(nullif(current_setting('rca.etl_actor', true), ''), current_user);
BEGIN
 NEW.etl_loaded_at := clock_timestamp();
 NEW.etl_source_system := coalesce(nullif(current_setting('rca.etl_source', true), ''), 'database');
 NEW.etl_batch_id := coalesce(nullif(current_setting('rca.etl_batch', true), ''), pg_current_xact_id()::text);
 IF TG_OP = 'INSERT' THEN
  NEW.etl_created_by := actor;
 ELSE
  NEW.etl_created_by := OLD.etl_created_by;
 END IF;
 NEW.etl_updated_by := actor;
 RETURN NEW;
END $$;
