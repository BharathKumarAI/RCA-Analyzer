-- Existing knowledge is retained for review and never silently approved.
ALTER TABLE platform.platform_knowledge
    ADD COLUMN revision INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN content_hash VARCHAR(128),
    ADD COLUMN author_subject VARCHAR(256),
    ADD COLUMN reviewer_subject VARCHAR(256),
    ADD COLUMN reviewed_at DOUBLE PRECISION,
    ADD COLUMN review_reason VARCHAR(2000);
-- statement
UPDATE platform.platform_knowledge SET status = 'draft';
-- statement
ALTER TABLE governance.parameter_audit ADD COLUMN details JSONB;
