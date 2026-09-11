# Operations

Operational lifecycle at a glance:

```mermaid
flowchart LR
    START[Start] --> VALIDATE[Validate environment and content]
    VALIDATE --> READY[Serve liveness/readiness]
    READY --> RUN[Execute bounded runs]
    RUN --> OBS[Inspect health, logs and traces]
    OBS --> REPAIR[Repair derived blob views when needed]
    REPAIR --> CLEAN[Run retention cleanup explicitly]
    CLEAN --> BACKUP[Back up DB, ADK sessions and scoped blobs]
```

The [harness lifecycle guide](harness.md) is the canonical explanation of what each stage owns.

This release runs as one API service with PostgreSQL in Compose; SQLite remains available for offline tests and fixtures. The [local deployment command](../scripts/deploy_local_database.py) and [database guide](database.md) describe the seven schemas, runtime role and explicit clean replay. It has no durable background worker or restart recovery loop. Approved agent definitions and their content-addressed blobs do survive process restarts.

## Configuration

Run `make db-deploy` to configure the local PostgreSQL instance and generate missing credentials in private `.env` and `.env.runtime` files; use [.env.example](../.env.example) as the setting reference. The [deployer](../scripts/deploy_local_database.py) excludes database owner credentials from the API container. Set `RCA_MODE=demo` for offline simulation or `RCA_MODE=live` for authenticated connector-backed runs. Configure one deployment scope with `RCA_TENANT_ID` and `RCA_PROJECT_ID`. Configure RS256 verification and server-side principals with `RCA_AUTH_ISSUER`, `RCA_AUTH_AUDIENCE`, `RCA_AUTH_PUBLIC_KEY`, and `RCA_PRINCIPALS_JSON`.

## Health and observability

`GET /health` is a liveness check and `GET /ready` checks storage/auth readiness. OpenTelemetry uses standard `OTEL_*` variables. MLflow uses the configured experiment identifier. Connector health is exposed at `GET /api/v1/connectors/health`. Effective redacted settings are exposed at `GET /api/v1/config` for authenticated project users.

## Limits and recovery

The service enforces `RCA_MAX_CONCURRENT_RUNS`, `RCA_RUN_TIMEOUT_SECONDS`, and `RCA_MAX_LLM_CALLS`. Request deadlines are UTC-based. The [HTTP boundary](../app/api/application.py) limits streamed request bodies to the smaller of the configured run timeout and 60 seconds, returning 408 and releasing upload capacity on timeout. Clients should retain run IDs and retry explicitly after process failure; no durable worker resumes abandoned work. Retention cleanup is an explicit operator action: `uv run --env-file .env python -m scripts.cleanup` reports candidates; add `--apply` to delete expired terminal runs, their evidence and ADK sessions, plus expired extracted attachments and original chat artifact blobs/catalog entries. Raw artifacts expire after `RCA_RETENTION_DAYS` from upload; extracted text uses the shorter `RCA_ATTACHMENT_TTL_SECONDS`. Original cleanup is limited to the configured deployment project, and deletes bytes before metadata so failed deletions can be retried. See [artifact storage and recovery](chat-artifacts.md). This is not scheduled automatically. Configuration blobs and approval audit records are retained separately.

Uploads are local-only and bounded. OCR requires Tesseract in the runtime image. Agent YAML blobs use local storage by default and GCS when `RCA_CONFIG_BLOB_URI` is a `gs://` URI. No remote file URLs, macros, code execution, or raw image visual semantics are supported.

Telemetry is disabled without an OTLP endpoint. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the collector or MLflow trace ingestion URL, and `MLFLOW_EXPERIMENT_ID` when using MLflow. Standard `OTEL_EXPORTER_OTLP_HEADERS` carries deployment credentials. Exported spans retain allowlisted operational attributes and usage, stripping payload attributes, exception events, links, and arbitrary resource attributes. Export failures are visible in `/api/v1/config`; they do not fail investigations. This does not configure a remote collector for you.

The default redactor masks known credential patterns, email addresses and US SSN patterns. It is not a complete PII classifier; adapt data handling and retention to your deployment requirements. `/ready` checks local database connectivity and configured authentication; connector health and model authorization are checked separately at run preflight.

## Database configuration and template rollout

With `RCA_DATABASE_CONFIGURATION=true`, [bootstrap](../app/runtime/bootstrap.py) loads one validated database snapshot and resolves platform/project parameters at startup. Explicit trusted environment settings take final precedence. Restart after publishing configuration or parameter changes; active runs retain their resolved contract. Invalid configuration fails startup and acquired resources are closed.

Repository `blob_local/platform/` YAML and Markdown and administrator-managed project YAML are templates. `RCA_CONTENT_ROOT`, `RCA_CONFIG_DIR` and `RCA_PROJECTS_ROOT` select the input locations for the [seed command](../scripts/seed_database.py). Initial deployment imports missing values without overwriting deployed configuration. Publish an intentional template update with `uv run python -m scripts.seed_database --expected-bundle-hash CURRENT_ACTIVE_HASH`, then restart. The [bundle publisher](../app/configuration/database_bundle.py) validates content and compares the active hash atomically. See [database configuration](database.md) for the parameter API, schema ownership and replay procedure.

Runtime optimization tracking metadata uses the PostgreSQL `mlflow` schema after local deployment; native MLflow migrations run in the [deployment job](../scripts/deploy_database.py). Artifacts remain in project blobs through the [optimization evaluator](../app/optimization/evaluation.py). Offline fixture evaluation keeps its own tracking store. Back up PostgreSQL and scoped blobs together and verify restoration before live rollout; local deployment does not establish production readiness.

## Separate project storage

Initialize real projects with the [project provisioning command](../blob_local/projects/README.md). `RCA_PROJECTS_ROOT` selects local project configuration; optional `RCA_PROJECTS_BLOB_URI` selects the root of GCS artifact prefixes. New blobs are separated by tenant and project. Preserve explicit legacy blob locations until scoped migration is verified. Reference `project_1` and `project_2` are not active scopes.
