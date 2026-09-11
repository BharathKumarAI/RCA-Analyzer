# Chat artifact API

Each chat separates **uploads** from **created outputs**. Upload originals remain byte-for-byte intact under `uploads/raw`; redacted extracted text is stored under `uploads/processed`. Generated terminal run/evidence JSON goes under `created/completed`, `created/failed` or `created/simulated`. See the [complete blob structure and lifecycle](blob-storage.md) for folder meanings, retention, recovery and framework approval stages.

## Client flow

1. `POST /api/v1/chats` returns a server-generated `chat_id`.
2. Send multipart `chat_id` and `files` to `POST /api/v1/files`. Omitting `chat_id` creates one after successful parsing. Each returned attachment includes `attachment_id`, `artifact_id`, filename, media type, SHA-256, byte count, expiry and extraction warnings.
3. Submit `POST /api/v1/runs` with `chat_id`, `prompt`, capability and optional `attachment_ids`. An omitted chat ID is inferred from uploaded attachments. Mixed-chat attachments are rejected. Existing ungrouped runs remain readable.
4. Read `GET /api/v1/chats/{chat_id}/runs` for run history, or `/artifacts` for original artifact metadata. `GET /api/v1/chats` lists owned chats. Listings accept `limit` (1–100) and `before` (creation timestamp).
5. Download an original using `GET /api/v1/chats/{chat_id}/artifacts/{artifact_id}/download`. Download generated JSON using `GET /api/v1/chats/{chat_id}/created/{run_id}/download`.

[Chat routes](../app/api/routes/chats.py), [upload route](../app/api/routes/files.py), [ownership and run links](../app/persistence/store.py), [artifact catalog and export lifecycle](../app/persistence/chat_artifacts.py).

All chat routes require the authenticated owner; administrators cannot download another user’s originals through this API. Existing project-level run/evidence access remains unchanged. Originals download as attachments with no MIME sniffing or caching. Unsupported and textless uploads are rejected; image extraction remains OCR-only, with no remote URL fetching, macro evaluation or code execution. [Authentication](../app/api/application.py), [parsers](../app/inputs/files.py).

Originals use `RCA_RETENTION_DAYS` at upload; processed copies and extracted attachments use `RCA_ATTACHMENT_TTL_SECONDS`. An original can still be downloaded after extraction expires; re-upload it to analyze it again. Generated exports follow terminal run retention and can be rebuilt from stored run/evidence records. Chat metadata remains after artifact cleanup. Native ADK sessions stay per-run; this does not add conversational model memory or background recovery. [Retention and repair commands](blob-storage.md#initialization-cleanup-and-repair).
