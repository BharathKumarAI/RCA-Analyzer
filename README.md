# RCA Analyzer

RCA Analyzer is a Google ADK service for bounded, evidence-grounded incident analysis. The harness authenticates a request, resolves one deployment scope and capability, runs a native ADK workflow against read-only connectors, records redacted evidence, validates citations, and persists the result.

Start with the [harness guide](docs/harness.md) for the complete component map and lifecycle diagrams. Use the [architecture reference](docs/architecture.md) for implementation details and the [operations guide](docs/operations.md) for deployment behavior.

See [runtime context and tool lifecycle](docs/runtime-context.md) for evidence limits, complete request budgeting, and authorized follow-up context.

## Data and templates

PostgreSQL manages configuration snapshots, platform/project parameters, run records and file metadata. Uploaded bytes, extracted content and generated artifacts use local/GCS blobs. [`blob_local/platform`](blob_local/platform/) and project YAML provide validated deployment templates. See the [database guide](docs/database.md) for schema ownership, minimal ETL tracking, parameter inheritance and local deployment; implementation lives in the [snapshot loader](app/configuration/database_bundle.py), [store](app/persistence/store.py) and [blob provider](app/connectors/providers/blob.py).

## Documentation map

| Flow | What it explains |
|---|---|
| [Harness and lifecycles](docs/harness.md) | All runtime components, state machines and graphical flows |
| [Architecture](docs/architecture.md) | Ownership, package layout and detailed request/agent/tool/file/result flows |
| [Security model](docs/security-model.md) | Identity, scope, authorization, input safety and redaction |
| [Blob storage](docs/blob-storage.md) | Framework stages, chat uploads, generated outputs, retention and repair |
| [Connector runtime setup](docs/connector-runtime.md) | Native/MCP setup for all ten connectors, scoped operations and agent binding |
| [Connector onboarding](docs/connector-onboarding.md) | Provider boundaries, health checks and adding a read-only connector |
| [Capability authoring](docs/capability-authoring.md) | Capability YAML contract and validation rules |
| [Skill inheritance](docs/skill-inheritance.md) | Delegation, instruction precedence and action intersection |
| [Agent lifecycle](docs/skill-lifecycle.md) | Submission, approval, activation, revocation and discovery |
| [Chat artifacts](docs/chat-artifacts.md) | Upload and generated-output APIs |
| [Optimization](docs/optimization.md) | Offline evaluation and reviewed promotion |
| [Database](docs/database.md) | PostgreSQL schemas, parameters, credentials and template publication |
| [Operations](docs/operations.md) | Configuration, health, cleanup, repair and verification |

## API

- `POST /api/v1/files`: multipart upload. Supports text, Markdown, logs, JSON, CSV/TSV, DOCX, XLSX, PDF text, and image OCR. Files are local-only and size/member bounded. Optional multipart `chat_id` groups uploads; omission creates a chat. Returns chat, attachment and artifact IDs. Original bytes are persisted separately from extracted text.
- `POST /api/v1/chats` creates an owned chat; `GET /api/v1/chats` lists yours. Chat details, runs, artifacts and original downloads use `/api/v1/chats/{chat_id}`. See [chat artifact persistence](docs/chat-artifacts.md).
- `POST /api/v1/runs`: JSON body with `prompt`, `capability`, optional `incident_id`, `chat_id`, and `attachment_ids`. An omitted chat ID is inferred from uploaded attachments; mixed-chat attachments are rejected.
- `GET /api/v1/runs`, `GET /api/v1/runs/{run_id}`, `GET /api/v1/runs/{run_id}/evidence`: inspect durable run state and evidence.
- `POST /api/v1/runs/{run_id}/cancel`: request cancellation.
- `GET /api/v1/runs/{run_id}/events`: SSE progress stream.
- `GET /api/v1/me`: authenticated server-side principal.
- `GET /api/v1/config`: redacted effective configuration, model profiles, and file limits. Prompt text is not returned.
- `GET /health`: liveness check.

Project specialists use a data-only YAML approval flow. See [agent lifecycle](docs/skill-lifecycle.md).

## Local setup

Install dependencies:

```bash
uv sync --locked --extra dev
```

Deploy the local PostgreSQL instance and template configuration:

```bash
make db-deploy
```

The [local deployer](scripts/deploy_local_database.py) creates missing credentials in `.env` and `.env.runtime` and starts PostgreSQL on `127.0.0.1:5432` by default. Configure authentication before using protected endpoints.

`RCA_MODE=demo` is offline and simulated; it must not be presented as a real diagnosis. Use `RCA_MODE=live` with trusted auth and connector configuration for live operation. `RCA_TENANT_ID` and `RCA_PROJECT_ID` define the single deployment scope. `RCA_PRINCIPALS_JSON` maps verified JWT subjects to server-side principals; request bodies cannot assign roles.

## Database migrations

Versioned SQL migrations are located in the [`migrations/`](migrations/) directory. Migrations run inside a transaction under a PostgreSQL advisory lock (`726320260911`) and verify SHA-256 checksums to guarantee schema immutability.

- **Apply pending migrations:**
  ```bash
  make db-migrate
  # Equivalent to: uv run python -m scripts.migrate
  ```
  Applies any unapplied `.sql` migrations sequentially using `RCA_MIGRATION_DATABASE_URL` (or `RCA_DATABASE_URL` from `.env`) and records each version in `platform.schema_migrations`.

- **Initial deployment & role permission sync:**
  ```bash
  make db-deploy
  # Equivalent to: uv run python -m scripts.deploy_local_database
  ```
  Ensures the PostgreSQL container is up, applies all migrations, runs MLflow tracking upgrades, provisions/syncs data permissions for the restricted runtime `rca_app` role across all schemas, and seeds baseline platform and project templates. If a newly created table causes `permission denied for table ...` on startup, re-run `make db-deploy` (or `uv run python -m scripts.deploy_database`) to grant permissions to `rca_app`.

- **Recreate and re-migrate (clean database):**
  ```bash
  uv run python -m scripts.deploy_local_database --recreate
  ```
  Drops and recreates the database before running migrations and seeds; stored local blob files are retained.

## Starting and stopping services

RCA Analyzer consists of three core components:
1. **PostgreSQL Database** (`127.0.0.1:5432`)
2. **Backend API** (`127.0.0.1:8000`)
3. **Frontend Admin Workspace** (`http://localhost:5173/admin/` in dev, or `http://localhost:8000/admin/` when built)

### Option 1: Local development (Separate processes)

#### Starting services

1. **Database:**
   ```bash
   # Initialize credentials and start PostgreSQL (if not already running):
   make db-deploy

   # Or resume an existing container:
   docker compose up -d postgres
   ```

2. **Backend API:**
   ```bash
   make dev
   # Equivalent to: uv run uvicorn app.fast_api_app:app --reload --env-file .env --host 0.0.0.0 --port 8000
   ```
   Verify the API is running:
   ```bash
   curl http://127.0.0.1:8000/health
   curl http://127.0.0.1:8000/ready
   ```

3. **Frontend Admin Workspace:**
   ```bash
   cd frontend
   npm ci
   RCA_API_TARGET=http://127.0.0.1:8000 npm run dev
   ```
   Open `http://localhost:5173/admin/` in your browser.

*(Optional production build)*: To serve the frontend directly through the FastAPI backend without running Vite:
```bash
cd frontend && npm run build
```
The FastAPI backend will automatically mount and serve the built assets at `http://localhost:8000/admin/`.

#### Stopping services

- **Frontend:** Press `Ctrl+C` in the frontend terminal, or terminate the process on port 5173:
  ```bash
  lsof -ti :5173 | xargs kill
  ```
- **Backend API:** Press `Ctrl+C` in the backend terminal, or terminate the process on port 8000:
  ```bash
  lsof -ti :8000 | xargs kill
  ```
- **Database:**
  ```bash
  # Stop PostgreSQL container without removing stored data:
  docker compose stop postgres

  # Or stop and remove Compose containers:
  docker compose down
  ```

---

### Option 2: Full stack with Docker Compose

#### Starting all services

```bash
make docker-up
```
This runs `make db-deploy` to ensure `.env.runtime` and database credentials exist, then builds and starts both `postgres` and `api` containers in detached mode.

Verify container status:
```bash
docker compose ps
curl http://127.0.0.1:8000/health
```

#### Stopping all services

```bash
make docker-down
# Equivalent to: docker compose down
```

To pause containers without deleting them:
```bash
docker compose stop
```

To reset the database (recreate schemas while retaining local blob storage):
```bash
uv run python -m scripts.deploy_local_database --recreate
```


## Verification and current boundaries

The React admin workspace is available at `/admin/`. See the [frontend setup guide](frontend/README.md) for development, production builds, authentication, and the distinction between persisted backend data and live connector execution.

From the source checkout, run `make lint`, `make test`, `make smoke`, and `make eval`. Smoke checks invoke the actual ADK runner with local model/HTTP fixtures. The four-case MLflow evaluation checks status handling, citation existence and redaction; it does not measure live root-cause accuracy. Its summary is written to `data/evaluation/summary.json`.

Images support local OCR, not visual scene reasoning. Scanned PDFs without extractable text are rejected. Model availability, live connector permissions, GCS access and production PostgreSQL operation must be verified in the deployment environment. Concurrency limits are per process. Runs persist across restarts but are not resumed automatically; expired runs become failed when read. See [operations](docs/operations.md) for retention and telemetry.

Configuration inheritance, optimization and storage lifecycle are documented in [architecture](docs/architecture.md), [optimization](docs/optimization.md), and [blob storage](docs/blob-storage.md).

See the [database rebuild and readiness review](docs/production-readiness-2026-09-11.md) for the implemented changes, verification evidence and remaining live-deployment requirements.
