# Database and configuration

PostgreSQL owns application records, configuration snapshots, parameter values and file metadata. Local or GCS blobs own uploaded bytes, extracted attachment content and generated artifacts. Investigation evidence and ADK events may retain the snippets used for analysis; those are investigation records, separate from the file catalog. Repository YAML and Markdown are validated deployment templates. See the [configuration snapshot loader](../app/configuration/database_bundle.py), [application store](../app/persistence/store.py) and [blob provider](../app/connectors/providers/blob.py).

## Schema ownership

The application baseline is [001_initial.sql](../migrations/001_initial.sql). The [migration runner](../scripts/migrate.py) serializes deployment with an advisory lock, applies each migration transactionally and rejects changes to an applied migration's checksum.

| Schema | Contents and owner |
|---|---|
| `platform` | Configuration snapshots, active snapshot pointers, parameter definitions and migration ledger |
| `project` | Project names and parameter overrides |
| `runtime` | Runs, evidence, chats, attachment and artifact metadata |
| `governance` | Agent submissions, approved selections and audit records; parameter change audit |
| `optimization` | Optimization datasets, revisions and promoted selections |
| `adk` | Native ADK session and event tables |
| `mlflow` | Native MLflow tracking metadata and its migration ledger |

Application tables come from the [baseline](../migrations/001_initial.sql). Native ADK table definitions are included in the baseline and used by the upstream service through [session initialization](../app/persistence/database.py); MLflow tables are upgraded by its supported migration entry point in the [deployment job](../scripts/deploy_database.py). Do not manually add application columns to upstream tables. MLflow artifact storage remains in project blobs through the [optimization evaluator](../app/optimization/evaluation.py); the [offline fixture evaluation](../scripts/eval.py) keeps its separate local tracking setup.

## Minimal ETL metadata

Each of the 18 application tables has six tracking fields:

| Field | Meaning |
|---|---|
| `created_time` | Original insert time, preserved on updates |
| `edited_time` | Last insert/update instant as PostgreSQL `timestamptz`; use UTC for reporting |
| `etl_src_system` | Source of the write, such as `api` or `template-import` |
| `etl_batch_id` | Correlation identifier for the request or import |
| `created_by` | Original authenticated subject or job identity; preserved on updates |
| `edited_by` | Authenticated subject or job identity responsible for the latest write |

The [tracking migration](../migrations/003_tracking_columns.sql) extends the baseline trigger to stamp all six fields. The [transaction context](../app/persistence/lineage.py) carries the source, batch, and trusted writer; the [API boundary](../app/api/application.py) supplies the authenticated subject. Jobs use `job:<source>`. Direct SQL defaults to source `database`, the PostgreSQL transaction ID, and the connected database role. Existing rows receive `legacy:unknown` for both actor fields because historical identity cannot be reliably reconstructed. For an upgrade retaining old rows, `created_time` uses the previously recorded ETL time; exact creation times begin with new rows. The creator and creation time cannot be overwritten by an ordinary update. Migration ledgers and native ADK/MLflow tables keep their own metadata.

## Platform and project parameters

Parameters are identified by deployment tenant, tool and variable name. Project overrides add the server-authorized project ID; its display name belongs to the project record. Definitions contain a type, description, default value, override policy, icon and revision. Supported types are `string`, `integer`, `number`, `boolean`, `json` and `secret_ref`. Setting `allow_project_override=false` fixes a definition at platform level. See the [parameter models and persistence](../app/configuration/parameters.py).

The [parameter API](../app/api/routes/parameters.py) exposes:

- `GET /api/v1/parameters` for resolved values and their source.
- `PUT /api/v1/parameters/{tool}/{name}/definition` for authorized platform definitions.
- `PUT /api/v1/parameters/{tool}/{name}/override` for authorized project overrides.
- `DELETE /api/v1/parameters/{tool}/{name}/override?expected_revision=...` to restore inheritance.

Writes check expected revisions and record an audit event. Overrides also check the definition revision. A stale edit returns 409. Roles and tenant/project scope come from verified server membership, never request fields. Fixed definitions cannot be overridden. See [parameter authorization and validation](../app/configuration/parameters.py).

Store only credential references such as `env://JIRA_API_TOKEN` or `env://SPLUNK_TOKEN` in credential parameters. Actual credentials belong in `.env` or a deployment secret system that supplies the referenced environment variables. The [parameter resolver](../app/configuration/parameters.py) validates references, and the [provider secret resolver](../app/connectors/providers/secrets.py) reads supported connector references. Parameter changes take effect after restart; explicitly supplied trusted environment settings take final precedence. Authentication and deployment scope remain environment-managed.

## Local deployment and replay

```bash
make db-deploy
```

The [local deployment command](../scripts/deploy_local_database.py) starts this repository's Compose PostgreSQL service, defaults to `127.0.0.1:5432`, creates missing credentials and writes private `.env` and `.env.runtime` files. The API container receives runtime credentials without the database owner's password or migration URL. The [deployment job](../scripts/deploy_database.py) migrates, initializes native tracking, seeds missing templates and grants the API role data access without schema ownership. Repeat deployment preserves existing parameter values and the active configuration snapshot.

For an intentional clean replay of this repository's local database:

```bash
uv run python -m scripts.deploy_local_database --recreate
```

This stops the Compose API, drops and rebuilds the configured repository database, then deploys and seeds it. Database records are erased; blob files are retained. Retained blobs do not automatically restore deleted catalog records. Restart the API with `docker compose up -d --build api` when ready. This destructive development command is implemented in the [local deployment script](../scripts/deploy_local_database.py); it is not a production upgrade or restore procedure.

## Publishing template changes

The initial [seed](../scripts/seed_database.py) imports missing definitions and a validated configuration snapshot without replacing deployed values. For a deliberate snapshot update, supply the currently active content hash:

```bash
uv run python -m scripts.seed_database --expected-bundle-hash CURRENT_ACTIVE_HASH
```

The [snapshot publisher](../app/configuration/database_bundle.py) validates the template bundle and atomically changes its active pointer only when the expected hash matches. Restart the API to load it. Use the parameter API for parameter edits; publishing a bundle does not overwrite those definitions. Capability/model/profile/skill templates retain their existing declarative validation.

## Deployment boundaries

Local deployment is a database setup, not a production certification. Before live rollout, verify trusted JWT configuration, connector/model permissions, backups and coordinated database/blob restore, and expected load. The [runtime](../app/runtime/runner.py) has no durable worker or automatic run resumption. Retention is an explicit [cleanup command](../scripts/cleanup.py). See [operations](operations.md) for checks and limits.
