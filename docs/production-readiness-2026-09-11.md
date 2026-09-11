# Database rebuild and production readiness review — 11 September 2026

The repository's local database was dropped and recreated with the requested simplified design. PostgreSQL runs at `127.0.0.1:5432`; the API runs at `127.0.0.1:8000`. The existing Homebrew PostgreSQL 18 service was stopped with user authorization to release port 5432; its data directory was retained. Blob files were retained. This is a verified local deployment; live authentication, external integrations, production load and recovery still require deployment-specific validation.

## Changes completed

| Area | Result | Implementation |
|---|---|---|
| Database layout | Seven schemas; 18 application tables plus migration metadata and upstream ADK/MLflow tables | [DDL](../migrations/001_initial.sql) |
| ETL metadata | Six fields: `created_time`, `created_by`, `edited_time`, `edited_by`, `etl_src_system`, `etl_batch_id`; maintained by PostgreSQL triggers | [DDL](../migrations/001_initial.sql), [tracking migration](../migrations/003_tracking_columns.sql), [transaction context](../app/persistence/lineage.py) |
| Platform/project configuration | Typed defaults, fixed or delegated project values, project display names, optimistic revisions and audit records | [parameter store](../app/configuration/parameters.py), [API](../app/api/routes/parameters.py) |
| Template deployment | Validated immutable configuration snapshots; initial import preserves existing values; later publication checks the current hash | [bundle store](../app/configuration/database_bundle.py), [seed command](../scripts/seed_database.py) |
| Secrets | Credential parameters hold `env://` references; providers resolve deployment environment variables | [secret resolver](../app/connectors/providers/secrets.py) |
| Files | Attachment catalog contains metadata and content hashes; original bytes and extracted attachment content are in blobs | [store](../app/persistence/store.py), [artifact store](../app/persistence/chat_artifacts.py) |
| Runtime metadata | ADK sessions/events and MLflow tracking metadata use PostgreSQL; upstream schema ownership is preserved | [session service](../app/persistence/database.py), [deployment job](../scripts/deploy_database.py) |
| Query efficiency | Normal run listings use one data query; expired entries use one bounded update and refresh, rather than one lookup per row | [store](../app/persistence/store.py), [regression test](../tests/unit/test_store.py) |
| Input protection | Slow body reads time out, and upload capacity is released; authentication still precedes parsing | [HTTP boundary](../app/api/application.py), [test](../tests/harness/test_request_body_timeout.py) |
| Deployment permissions | Separate runtime role without schema ownership; migration credentials excluded from API environment; audit history cannot be updated/deleted by that role | [deployment scripts](../scripts/deploy_database.py), [local setup](../scripts/deploy_local_database.py) |
| Container efficiency | Dependency installation is cached independently of source changes; dependency caches and whole-environment ownership copies are excluded from the image | [Dockerfile](../Dockerfile) |
| CI | Disposable PostgreSQL service enables actual migration and integration checks | [workflow](../.github/workflows/ci.yml) |

Existing investigation evidence and native session events can retain snippets used during analysis. The metadata-only rule applies to file storage/catalog records; removing evidence content would change the investigation and citation contract.

## Verification performed

- `make lint`: passed.
- `make test` with PostgreSQL integration enabled: **117 tests passed**, plus two subtests; no skipped PostgreSQL test.
- `make smoke`: **8 tests passed**.
- [PostgreSQL integration test](../tests/integration/test_postgres.py): clean migration and replay, typed/fixed-value constraints, minimal ETL lineage, scoped parameter API, file metadata separation, native ADK event persistence, and native MLflow run/metric storage.
- Local deployment inspection: seven schemas, exactly 108 tracking columns at migration 3 across 18 application tables, 21 runtime parameter definitions, and readable MLflow metadata using the runtime account.
- Permission inspection: runtime account cannot create tables in `runtime` or update parameter audit history.
- Container build and startup: PostgreSQL and API healthy; API liveness returns 200.

The final image refresh exposed host disk exhaustion. Docker was recovered, unreachable dependency-cache entries and four exact cache layers from this task were removed, and the Dockerfile was corrected to avoid duplicate dependency layers. Database volumes and blob files were preserved.

Upstream deprecation and experimental-feature warnings remain visible in the test output. The tests use controlled model/connector fixtures; these results are not a live model-quality score.

## Before production activation

Configure the real JWT issuer, audience, RSA public key and server-side memberships. The local deployment deliberately remains unavailable to authenticated API traffic until those are configured. Set and verify live Jira, Splunk and model credentials and permissions. Run workload-specific capacity tests and a coordinated PostgreSQL/blob backup-and-restore exercise in the intended deployment environment. No durable background worker or automatic run resumption has been introduced.

Configuration changes take effect after restarting the API. Trusted environment overrides take precedence over database runtime parameters. Follow the [database guide](database.md) for deployment, parameter updates and explicit development replay; use versioned migrations for subsequent non-destructive upgrades.

The final requested rebuild applied migrations 1–3 to a fresh application database on port 5432. All 18 application tables contain `created_time`, `created_by`, `edited_time`, `edited_by`, `etl_src_system`, and `etl_batch_id`; previous ETL column names are absent. Seeded rows carry `job:template-import` and matching initial creation/edit times. Tests verify preserved creation values, updated edit values, direct SQL fallback, and authenticated API writes. Blob files were retained. See the [tracking DDL](../migrations/003_tracking_columns.sql) and [PostgreSQL test](../tests/integration/test_postgres.py).
