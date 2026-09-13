ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS category VARCHAR(120) NOT NULL DEFAULT 'operational';
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS subcategory VARCHAR(120);
-- statement
ALTER TABLE platform.parameter_definitions
    ADD COLUMN IF NOT EXISTS allowed_values JSONB;
-- statement
ALTER TABLE platform.parameter_definitions
    ADD CONSTRAINT parameter_definition_category_nonempty
    CHECK (category <> '');
-- statement
UPDATE platform.parameter_definitions
    SET category = 'operational'
    WHERE category IS NULL OR trim(category) = '';
-- statement
UPDATE platform.parameter_definitions
    SET subcategory = NULL
    WHERE trim(subcategory) = '';
