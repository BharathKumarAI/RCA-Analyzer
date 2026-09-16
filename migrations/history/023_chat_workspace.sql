-- Keep applied migrations immutable; move existing installations to RCA assist.
ALTER TABLE platform.platform_ui_settings ALTER COLUMN brand_name SET DEFAULT 'RCA assist';
-- statement
ALTER TABLE platform.platform_ui_settings ALTER COLUMN default_page SET DEFAULT 'chat';
-- statement
UPDATE platform.platform_ui_settings
SET brand_name = 'RCA assist',
    default_page = CASE WHEN default_page = 'overview' THEN 'chat' ELSE default_page END,
    navigation = CASE WHEN navigation @> '[{"page":"chat"}]'::jsonb THEN navigation
        ELSE '[{"page":"chat","label":"Chat","description":"Ask questions and investigate together","group":"Workspace","visible":true}]'::jsonb || navigation END,
    version = version + 1,
    updated_at = EXTRACT(EPOCH FROM clock_timestamp());

-- statement
UPDATE platform.platform_ui_settings
SET navigation = navigation || '[{"page":"insights","label":"Insights","description":"Review measured usage and performance","group":"Workspace","visible":true}]'::jsonb
WHERE NOT navigation @> '[{"page":"insights"}]'::jsonb;
