CREATE TABLE runtime.chat_messages (
    sequence SERIAL PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL UNIQUE,
    exchange_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    project_id VARCHAR(256) NOT NULL,
    subject VARCHAR(256) NOT NULL,
    chat_id VARCHAR(128) NOT NULL REFERENCES runtime.chats(chat_id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('question', 'clarification', 'unsupported')),
    reason_code VARCHAR(64),
    choices_json TEXT NOT NULL,
    attachment_ids_json TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL
);
-- statement
CREATE INDEX ix_runtime_chat_messages_chat_id ON runtime.chat_messages(chat_id);
-- statement
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rca_app') THEN
        GRANT SELECT, INSERT, DELETE ON runtime.chat_messages TO rca_app;
        GRANT USAGE, SELECT ON SEQUENCE runtime.chat_messages_sequence_seq TO rca_app;
    END IF;
END $$;
