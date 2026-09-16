ALTER TABLE platform.platform_knowledge
    ADD COLUMN IF NOT EXISTS associations JSONB,
    ADD COLUMN IF NOT EXISTS required_associations JSONB;
