-- Exact local-file identity survives replacement without reactivating old revisions.
CREATE TABLE platform.knowledge_uploads (
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    doc_id VARCHAR(128) NOT NULL,
    revision INTEGER NOT NULL,
    content_hash VARCHAR(128) NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (tenant_id, project_id, source_sha256)
);

-- statement

-- Preserve reviewed hashes. Existing duplicate files map to the oldest identity.
INSERT INTO platform.knowledge_uploads
    (tenant_id, project_id, source_sha256, doc_id, revision, content_hash, created_at)
SELECT DISTINCT ON (tenant_id, project_id, upload->>'sha256')
    tenant_id, project_id, upload->>'sha256', doc_id, revision, content_hash, created_at
FROM platform.platform_knowledge
WHERE upload->>'sha256' ~ '^[a-f0-9]{64}$'
    AND content_hash IS NOT NULL AND revision > 0
    AND COALESCE(upload->>'processing_status', '') <> 'okf_import'
ORDER BY tenant_id, project_id, upload->>'sha256', created_at, doc_id;
