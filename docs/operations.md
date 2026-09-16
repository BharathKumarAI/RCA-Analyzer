# Operations

This release runs a FastAPI process, PostgreSQL, and a React frontend. Local development can use Vite; the API can serve the built frontend. Configuration and investigation records persist. A [leased database queue](../app/optimization/improvement.py) recovers improvement jobs; interactive investigations still do not automatically resume after process failure. Sources: [application](../app/api/application.py), [runner](../app/runtime/runner.py), [Compose](../docker-compose.yml).

## Contents

- [Chat and metrics integration rollout](#chat-and-metrics-integration-rollout)

- [Local setup](#local-setup)
- [Authentication and project connections](#authentication-and-project-connections)
- [Database and configuration rollout](#database-and-configuration-rollout)
- [Health and measurements](#health-and-measurements)
- [Retention, repair and recovery](#retention-repair-and-recovery)
- [Verification and deployment evidence](#verification-and-deployment-evidence)
- [Runbook: bring a deployment into service](#runbook-bring-a-deployment-into-service)
- [Runbook: diagnose a failed or incomplete investigation](#runbook-diagnose-a-failed-or-incomplete-investigation)
- [Runbook: publish a configuration change](#runbook-publish-a-configuration-change)
- [Runbook: retention and restoration](#runbook-retention-and-restoration)


## Chat and metrics integration rollout

**Acceptance runbook, not deployment certification.** Follow the [delivery plan](development.md#chat-and-metrics-delivery-plan) and verify [platform metrics authorization](configuration.md#chat-and-metrics-integration-policy) in the target deployment.

1. Record revision, dependency versions and transport choice. Trial CopilotKit against the governed ADK runner; retain the existing UI/API as rollback without moving history into a second store.
2. Verify authentication, active membership, private conversation ownership and project switching. Test cross-project denial for streams, evidence and downloads as well as normal requests.
3. Run an authorized live investigation against a configured model/source. Inspect saved message/run IDs, tool events, citations, artifacts and usage. Demo/readiness success is insufficient.
4. Exercise duplicate submission, cancellation, network disconnect and process interruption. Assess saved state and retry explicitly when needed. Do not promise automatic recovery for interactive runs. Scheduled knowledge and improvement jobs have a separate leased queue and must be verified through their persisted job state.
5. Compare the same run population in chat, project metrics and authorized platform metrics. Check prices, missing data, sample counts, truncation, date ranges and export metadata. Verify project-owner/member denial for platform totals.
6. Measure query/refresh latency under expected load. Prevent overlapping refresh and pause it on hidden views; investigate slow aggregation before adding caches or workers.
7. Record actual checks and unresolved gaps. Roll back adapter/UI deployment while preserving SQLAlchemy/native session/blob records. Do not rewrite historical results or prices to force agreement.

Sources: [run lifecycle](../app/api/routes/runs.py), [runner cleanup](../app/runtime/runner.py), [metrics routes](../app/api/routes/metrics.py), [telemetry coverage](../app/persistence/telemetry.py). Use [retention/restoration](#runbook-retention-and-restoration); replaying recorded events does not recover lost execution.

## Local setup

```sh
make setup
make db-deploy
```

The local deployer starts PostgreSQL, applies migrations, seeds missing configuration, grants runtime permissions and creates missing credentials in private `.env` and `.env.runtime` files. Repeat deployment preserves active configuration. Configure authentication and source credentials using [.env.example](../.env.example); do not commit or print secrets. Source: [local deployer](../scripts/deploy_local_database.py).

New settings, local deployment configuration and container images default to `RCA_MODE=live`. Set `RCA_MODE=demo` explicitly only for a non-diagnostic simulation; it returns `SIMULATED` without fake source evidence. Existing database-managed configuration remains authoritative and is not overwritten by new defaults; inspect its mode before release. Live runs require real model access, authorized connector endpoints/credentials, and active project membership. `RCA_TENANT_ID` owns the deployment; `RCA_PROJECT_ID` identifies its bootstrap project. Bearer verification uses `RCA_AUTH_ISSUER`, `RCA_AUTH_AUDIENCE`, and `RCA_AUTH_PUBLIC_KEY`; trusted `RCA_PRINCIPALS_JSON` supplies bootstrap membership. Sources: [settings](../app/settings.py), [authentication](../app/identity/auth.py).

```sh
make dev
```

The API starts on port 8000. In another terminal:

```sh
cd frontend
npm ci
RCA_API_TARGET=http://127.0.0.1:8000 npm run dev
```

Open `http://localhost:5173/`. The explicit API target avoids the development proxy's port-8005 default. Stop each foreground development process with Ctrl+C. Source: [Vite configuration](../frontend/vite.config.ts).

To serve the built frontend through FastAPI, run `npm run build` from `frontend/`. To run the Compose stack, use `make docker-up`; stop it with `make docker-down`. Inspect the checked-in [Makefile](../Makefile) and [Compose configuration](../docker-compose.yml) for exact commands and mounted services.

## Authentication and project connections

For company sign-in, configure and independently approve the OIDC provider, use the exact HTTPS callback URL, and provision subject membership before login. Preserve bearer bootstrap/recovery configuration. Browser-session security and real identity-provider setup are described in [sign-in reference](reference/data-access-and-operations.md#browser-sign-in); implementation is in [OIDC configuration](../app/configuration/oidc.py).

Configure each project's enabled connector instances, environments, authorized resources and secret references. All implemented connector types are in scope; do not mark an unconfigured or unhealthy connection ready. Oracle uses fixed bounded diagnostics; deployment adapters and saved project connections still require explicit enablement as described in [configuration](configuration.md#all-connectors-enabled-per-project). Publishing template metadata does not enable deployment records. Sources: [provider resolution](../app/connectors/providers/registry.py), [connector API](../app/api/routes/connectors_api.py).

## Container and release checks

The [Docker image](../Dockerfile) builds the real frontend, runs as a non-root account and defaults to live database-backed configuration. [Compose](../docker-compose.yml) and the image healthcheck use bounded `/ready` requests. `/health` remains process liveness. Development mock servers and token issuers are excluded from the image by [.dockerignore](../.dockerignore). [CI](../.github/workflows/ci.yml) checks Python and frontend code, runs offline smoke contracts and builds the image.

The distinction between liveness and readiness follows the [Kubernetes probe guidance](https://kubernetes.io/docs/concepts/workloads/pods/probes/). For an actual deployment, verify database migrations/grants, persistent blob storage, approved OIDC/JWT settings, model access, and at least one scoped read from every enabled provider. Exercise duplicate requests, cancellation and reconnect against the chosen ingress timeout. An image build or passing offline fixtures cannot establish any of these live behaviors.

Interactive investigation execution remains request-owned. Use one application process per instance and account for process interruption during rollout. Improvement workers claim persisted jobs through leases; an interrupted evaluation can repeat within the retry ceiling, but cannot activate its own result. A cloud/cluster release needs its own approved target, secrets, ingress/TLS, storage, backup and restore validation. No cloud deployment is implied by local changes.

## Database and configuration rollout

- `make db-migrate` applies pending versioned SQL migrations. The runner uses transactions, an advisory lock and applied-file checksums.
- `make db-deploy` also handles local provisioning, seeding and runtime role permissions. Do not give the API database-owner credentials.
- To publish an intentional template update, use `uv run python -m scripts.seed_database --expected-bundle-hash CURRENT_ACTIVE_HASH`, substituting the verified active hash.
- Restart to load startup-owned bundle/settings changes. Use the corresponding service's activation contract for database-backed runtime edits; existing runs retain their pinned configuration.
- The deployer's `--recreate` option erases the configured local database. It is a destructive development reset, not an upgrade or backup restore; retained blobs cannot reconstruct missing database metadata.

Sources: [migration runner](../scripts/migrate.py), [deployment](../scripts/deploy_database.py), [seed publisher](../scripts/seed_database.py), [bootstrap](../app/runtime/bootstrap.py).

## Health and measurements

| Surface | Meaning |
| --- | --- |
| `GET /health` | Process liveness |
| `GET /ready` | Bounded storage/auth readiness with a `live_execution` flag; not proof of model or connector success |
| `GET /api/v1/connectors/health` | Authenticated connector health |
| `GET /api/v1/config` | Authenticated redacted effective settings |
| Insights and run events | Recorded timings/usage; coverage limits and missing values remain visible |

Sources: [application](../app/api/application.py), [connector routes](../app/api/routes/connectors_api.py), [telemetry](../app/persistence/telemetry.py).

OpenTelemetry export requires deployment collector configuration through `OTEL_*` settings. Exported operational data must remain redacted and bounded. Model cost estimates depend on independently approved rates and recorded provider usage; they are not invoices or accuracy scores. Sources: [observability](../app/observability), [pricing](../app/configuration/model_pricing.py).

## Retention, repair and recovery

```sh
# Report candidates before deleting anything.
uv run --env-file .env python -m scripts.cleanup
# Inspect derived artifact views without applying repairs.
uv run --env-file .env python -m scripts.sync_artifacts
```

Both operations are explicit; use `--apply` only for the intended cleanup or repair. Cleanup removes eligible terminal records, sessions and expired attachments/artifacts according to its scope. Run it for each project with the correct `RCA_PROJECT_ID`, database configuration and shared artifact root. There is no automatic all-project cleanup loop. Sources: [cleanup](../scripts/cleanup.py), [repair](../scripts/sync_artifacts.py).

Back up PostgreSQL, native sessions and project blobs together, and verify coordinated restoration. After an interrupted process, inspect saved run IDs and retry explicitly; do not assume abandoned work resumes. Blob repair rebuilds derived views from authoritative records, not missing evidence or deleted catalogs. Sources: [artifact storage](../app/persistence/chat_artifacts.py), [runner](../app/runtime/runner.py).

## Verification and deployment evidence

Run `make lint`, `make test`, and `make smoke` before handoff; use `make eval` for offline contracts. Confirm real SSO, source credentials, model behavior, expected load and database/blob restoration in the target deployment. Passing local checks is not production certification. Dated verification records are retained under [references](reference/README.md); their counts describe those runs, not the current working tree.

## Runbook: bring a deployment into service

Use the following sequence for an environment you are authorized to operate. Record the actual deployment and verification results; a configuration form saved successfully is not evidence that a source or model worked.

| Phase | Action | Exit evidence |
| --- | --- | --- |
| Prepare | Confirm database, blob location, tenant, bootstrap project and secret references | Explicit deployment settings with no credentials committed |
| Provision | Apply all shipped migrations and seed missing configuration using the deployment tooling | Migration/deployment completes against the intended database |
| Authenticate | Configure bearer verification and approved OIDC when used; provision membership | Authorized login succeeds and unauthorized project access fails |
| Start | Run the API and frontend using the documented process configuration | Process liveness and readiness endpoints respond |
| Connect | Save project instances, resources, environments and credential bindings | Required connector health is usable for the selected capability |
| Investigate | Run an authorized live investigation | Saved live run with inspectable source evidence and honest limitations |
| Restore | Exercise coordinated database/session/blob restoration in a suitable environment | Restored records and their artifacts can be read consistently |

These are operator acceptance steps, not claims that they have been performed by this documentation update. Sources: [deployment](../scripts/deploy_database.py), [bootstrap](../app/runtime/bootstrap.py), [health endpoints](../app/api/application.py), [runner](../app/runtime/runner.py).

## Runbook: diagnose a failed or incomplete investigation

Start with the project, run ID, status, stage and sanitized reason. Use the run's trace and contract to distinguish input, configuration, dependency and execution failures. Avoid copying raw credentials or unredacted source payloads into incident notes.

| Symptom | Inspect first | Next action |
| --- | --- | --- |
| Sign-in rejected | Issuer/audience/key settings, approved OIDC binding and active subject membership | Correct identity configuration or membership through its authorized path |
| Project inaccessible | Active database membership for the selected project | Review access; changing the project header cannot grant it |
| Start returns `409` | Attachment ownership/expiry, configuration validity and idempotency reuse | Correct the conflict; do not blindly reuse a key with changed inputs |
| Start returns `429` | Run capacity and busy project-runtime contexts | Retry after the indicated delay; inspect load if persistent |
| `BLOCKED` at preflight | Required connector health and live model-backend configuration | Repair the missing required dependency before retrying |
| `FAILED` at `context_limit` | Required input size and resolved context limits | Narrow the request or review permitted limits; source truncation cannot remove required instructions |
| `FAILED` at `timeout` | Deadline, stage/tool timing and bounded source request | Investigate the slow dependency or narrow the investigation |
| `PARTIAL` | Missing optional sources, truncation and insufficient-evidence outcome | Obtain missing evidence or ask a narrower follow-up |
| Original downloads but cannot be analyzed | Extraction expiry versus original retention | Re-upload the retained original if analysis is still needed |
| Missing complete cost estimate | Provider usage coverage and approved pricing | Preserve unknown values; inspect partial recorded charges separately |
| Process stopped during execution | Last persisted run and trace state | Assess the interrupted work and retry explicitly; no recovery worker resumes it |

Sources: [authentication](../app/identity/auth.py), [project runtimes](../app/runtime/projects.py), [run endpoints](../app/api/routes/runs.py), [execution failures](../app/runtime/runner.py), [artifacts](../app/persistence/chat_artifacts.py), [telemetry](../app/persistence/telemetry.py).

## Runbook: publish a configuration change

1. Identify whether the setting is startup-owned, a scoped parameter, or a reviewed runtime artifact. Use the corresponding [configuration workflow](configuration.md).
2. Read the active revision/hash and prepare the intended change. Preserve operator-managed values when updating repository seed templates.
3. Validate the change through the existing service or configuration command. Obtain the independent review required by that artifact type.
4. Activate or publish with the expected revision/hash. A stale conflict requires re-reading the active state; do not overwrite it blindly.
5. Restart only when the setting's loading contract requires it. Existing runs retain their resolved snapshot.
6. Start a new authorized verification run and inspect its effective settings, graph and evidence. If the change fails, use the artifact's supported revision/approval lifecycle to restore known content rather than editing historical run records.

Sources: [database bundle](../app/configuration/database_bundle.py), [seed publisher](../scripts/seed_database.py), [parameters](../app/configuration/parameters.py), [harness workspace](../app/configuration/harness_workspace.py).

## Runbook: retention and restoration

**Before cleanup:** verify the selected project and retention settings, run the dry report, and confirm that the intended database and blob store are backed up together. Originals, extracted text, terminal outputs and sessions have different lifetimes; do not assume one timestamp controls all of them.

**During cleanup:** apply only the reviewed scope. Repeat deliberately for other projects. The release does not schedule an automatic all-project retention loop.

**After cleanup:** inspect remaining run and artifact records. Use artifact synchronization to inspect and, when intended, repair derived exports. Repair can rebuild outputs from retained authoritative run/evidence data; it cannot recover deleted source records.

**During restoration:** restore the corresponding database, native session data and blobs, then verify ownership, run/evidence links and original downloads before treating the restored deployment as usable. Interrupted execution still needs explicit assessment and retry. Sources: [cleanup command](../scripts/cleanup.py), [artifact repair](../scripts/sync_artifacts.py), [artifact ownership and exports](../app/persistence/chat_artifacts.py).

## Database DDL maintenance and seed policy

Use [the consolidated SQL](../migrations/schema.sql) to inspect the current database design by schema. Deploy with `make db-migrate` or the existing deployment job, which reads immutable SQL from [migration history](../migrations/history). The SQL reference does not replace checksummed upgrades, native schema-version rows, bootstrap configuration or restricted-role provisioning.

To regenerate the reference, prepare a **disposable UTF-8 PostgreSQL database** using the same locked dependencies and compatible `pg_dump` version. Apply `scripts.migrate.migrate` and `scripts.deploy_database.upgrade_tracking` to that database; do not import sample data or application configuration. Then set `RCA_MIGRATION_DATABASE_URL` to that disposable database and run:

```sh
uv run python -m scripts.export_database_ddl --output migrations/schema.sql
```

The exporter reads schema definitions only. Never use an operator database as the canonical source: drift, project-specific objects or comments could otherwise enter the checked-in reference. Review generated changes, including indexes, foreign keys, functions, triggers and privileges. MLflow object changes may reflect a dependency migration and require corresponding review.

Set `RCA_POSTGRES_TEST_URL` to an isolated database-creator account and run the [DDL integration test](../tests/integration/test_database_ddl.py). It creates disposable databases, applies the migrations twice, compares the export to the checked-in reference, restores it and compares again. Run the normal [verification commands](development.md#verification) before handoff. A schema-only restore intentionally has no migration ledger or native version rows and must not be started as a deployed API database.

[Required configuration import](../scripts/seed_database.py) remains part of deployment: project identity, parameter definitions and the deployment template baseline are necessary for database-first runtime configuration. Demo triage ticket creation has been removed from reads. No cleanup command in this change deletes existing operator data; review historical sample rows separately before any destructive cleanup.

## Operate governed improvement jobs

Open **Optimization → Continuous improvement** in the selected project. Prepare feedback candidates manually or create a recurring preparation schedule. A different administrator verifies the source outcomes; select distinct incidents for training and holdout and optionally freeze approved knowledge. Publish a new immutable benchmark, then queue an evaluation of a configured prompt or skill. Review its report through the existing independent activation workflow. The UI also exposes cancellation, retry, schedule editing/pause/resume, knowledge drafts and reviewed restore/revoke actions. Sources: [page](../frontend/src/pages/Improvement.tsx), [API](../app/api/routes/optimization.py).

The worker starts with the API process, claims jobs only for the deployment tenant, and re-resolves the author's current project membership and runtime. SQL leases and conditional updates fence stale attempts. An interrupted evaluation may repeat model calls; operators should allow for that cost. Bounded attempts end in a visible failure; an explicit retry starts a new bounded attempt budget. Pausing a schedule stops future dispatch; cancel an already queued/running job separately. A scheduling failure or revoked membership never grants new authority or auto-approves a result. Sources: [worker](../app/optimization/improvement.py), [bootstrap and project leases](../app/runtime/bootstrap.py).

Apply migrations 029–034 before starting this version against an existing database. Back up the new OKF metadata, reviewed knowledge associations, upload-to-revision identities, structured capture receipts, source-state fences, closure comparisons, improvement records and immutable knowledge/evaluation blobs with the existing application state. Interactive `/runs` requests retain their separate request-owned lifecycle; job recovery does not imply interactive-run recovery. The packaged Docs page serves the maintained guides from this exact deployment, including their content hashes.
