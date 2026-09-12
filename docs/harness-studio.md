# Harness Studio source workspace

Harness Studio edits a capability-scoped, data-only source bundle. The API
validates and compiles YAML/JSON sources into the governed RCA workflow; it
does not load uploaded Python or execute arbitrary code. Python files may be
retained as inert source for portability, but they produce a warning and are
never part of runtime execution. The source of this contract is the
[bundle model and compiler](../app/configuration/harness_bundles.py), with
revision and review persistence in the
[workspace service](../app/configuration/harness_workspace.py).

The workspace API is scoped from the authenticated tenant and project. The
caller supplies only a capability ID; roles, tenant, project, connector
scope, and approval state are resolved server-side.

| Operation | Endpoint | Effect |
| --- | --- | --- |
| Load workspace | `GET /api/v1/harness/workspace?capability=...` | Reads the active bundle, or the platform default when no approved draft exists |
| Validate | `POST /api/v1/harness/validate` | Validates `{files, capability}` without persisting a draft |
| Save draft | `PUT /api/v1/harness/draft` | Saves `{files, capability, expected_revision, draft_id?}` as a draft with optimistic concurrency |
| Import | `POST /api/v1/harness/import` | Reads a UTF-8 source file or ZIP multipart upload and saves a draft |
| Export | `GET /api/v1/harness/export?capability=...&draft_id=...` | Downloads a ZIP source archive; `draft_id` is optional |
| Review | `POST /api/v1/harness/drafts/{draft_id}/{submit,approve,reject,revoke}` | Applies the two-person review lifecycle with `expected_revision` and a reason |

The route implementation is in the [Harness API router](../app/api/routes/harness.py),
and the browser client mirrors these operations in
[`harnessApi.ts`](../frontend/src/features/harness-studio/harnessApi.ts).

## Bundle limits

The service accepts at most 100 files, 64 KiB per file, and 512 KiB of total
source. Paths must be normalized relative POSIX paths. Hidden files,
credential-named files, PEM/key/P12 files, symlinks, encrypted ZIP entries,
duplicate paths, and invalid UTF-8 are rejected. The limits and path checks
are defined in [harness_bundles.py](../app/configuration/harness_bundles.py).
The default deployment JSON request ceiling is 128 KiB in
[settings.py](../app/settings.py); deployments that use JSON validate/save
requests must account for that transport ceiling as well. ZIP imports use the
bundle limits and the configured request/upload policy.

## CLI

The authenticated CLI uses `RCA_API_URL` (default `http://127.0.0.1:8000`)
and reads a bearer token from `RCA_API_TOKEN` (with `RCA_TOKEN` accepted for
compatibility). It never prints the token or uploaded file contents. The
implementation is [scripts/harness_config.py](../scripts/harness_config.py).

```sh
export RCA_API_URL=http://127.0.0.1:8000
export RCA_API_TOKEN='…'

uv run python -m scripts.harness_config validate ./harness --capability incident_triage
uv run python -m scripts.harness_config import ./harness.zip --capability incident_triage
uv run python -m scripts.harness_config diff ./harness --capability incident_triage
uv run python -m scripts.harness_config export --capability incident_triage --output incident_triage.zip
```

`validate` is read-only. `import` creates a draft and does not submit or
approve it. `diff` exits with status 1 when source differs, which makes it
usable in review scripts. The corresponding Make targets are
`config-validate`, `config-import`, `config-diff`, and `config-export`.

## Frontend contract generation

The [type generator](../scripts/generate_harness_types.py) consumes a local
JSON Schema or discovers the `Workspace` response component from the API's
OpenAPI document. It writes
[`workspace.generated.ts`](../frontend/src/features/harness-studio/types/workspace.generated.ts),
which is generated output and should not be edited by hand.

```sh
# Fetch the running API's Pydantic/OpenAPI contract.
make harness-types

# Or use a checked-in/exported OpenAPI JSON document.
make harness-types HARNESS_SCHEMA=/path/to/openapi.json
```

The generator has no code-generation dependency and does not import or
execute workspace source files. Changes to the Pydantic `Workspace` response
are reflected by regenerating this file against the same API revision.
