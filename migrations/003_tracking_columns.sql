-- Standard tracking names. Recreated tables receive exact creation times.
DO $$
DECLARE target record;
BEGIN
 FOR target IN
  SELECT table_schema, table_name FROM information_schema.columns
  WHERE column_name = 'etl_batch_id'
    AND table_schema IN ('runtime', 'governance', 'optimization', 'platform', 'project')
 LOOP
  EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN etl_loaded_at TO edited_time', target.table_schema, target.table_name);
  EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN etl_created_by TO created_by', target.table_schema, target.table_name);
  EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN etl_updated_by TO edited_by', target.table_schema, target.table_name);
  EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN etl_source_system TO etl_src_system', target.table_schema, target.table_name);
  -- Preserve the only available ETL time for preexisting rows without firing
  -- the old trigger, whose column names have just changed.
  EXECUTE format('ALTER TABLE %I.%I ADD COLUMN created_time TIMESTAMPTZ', target.table_schema, target.table_name);
  EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER stamp_etl_lineage', target.table_schema, target.table_name);
  EXECUTE format('UPDATE %I.%I SET created_time = edited_time', target.table_schema, target.table_name);
  EXECUTE format('ALTER TABLE %I.%I ENABLE TRIGGER stamp_etl_lineage', target.table_schema, target.table_name);
  EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN created_time SET NOT NULL', target.table_schema, target.table_name);
 END LOOP;
END $$;
-- statement
CREATE OR REPLACE FUNCTION platform.stamp_etl_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actor text := coalesce(nullif(current_setting('rca.etl_actor', true), ''), current_user);
BEGIN
 NEW.edited_time := clock_timestamp();
 NEW.etl_src_system := coalesce(nullif(current_setting('rca.etl_source', true), ''), 'database');
 NEW.etl_batch_id := coalesce(nullif(current_setting('rca.etl_batch', true), ''), pg_current_xact_id()::text);
 IF TG_OP = 'INSERT' THEN
  NEW.created_time := NEW.edited_time;
  NEW.created_by := actor;
 ELSE
  NEW.created_time := OLD.created_time;
  NEW.created_by := OLD.created_by;
 END IF;
 NEW.edited_by := actor;
 RETURN NEW;
END $$;
