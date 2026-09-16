# Blob storage

Shared deployed content lives in `platform/`. Scoped project configuration and artifacts live in `projects/<tenant-key>/<project-key>/`.

```text
project/
  configuration/                          Active project/user configuration
  artifacts/framework/uploads/            Agents, skills, prompts and other framework intake
    <content-type>/<approval-stage>/
  artifacts/framework/objects/agents/     Immutable canonical agent versions
  artifacts/framework/optimizations/objects/
  artifacts/chats/chat_<id>/uploads/      Raw originals and processed extraction
  artifacts/chats/chat_<id>/created/      Generated completed/failed/simulated outputs
  exports/                                Operator-managed exports
```

Read the [complete structure and lifecycle guide](../docs/reference/data-access-and-operations.md#blob-storage) for every folder, implemented versus reserved stages, moves, ownership, retention, repair and migration. Use the [project initializer guide](projects/README.md) to provision local directories. `project_1` and `project_2` are reference examples, not live scopes.

`RCA_CONTENT_ROOT` controls deployed platform content. `RCA_PROJECTS_ROOT` defaults to its sibling `projects` directory. `RCA_PROJECTS_BLOB_URI=gs://YOUR_BUCKET/rca/projects` uses the same scoped artifact keys in GCS; configuration still requires a local mount. GCS uses prefixes, not empty folder markers. Credentials remain provider-owned.

SQLAlchemy holds authorization, approval state, active pointers, chat ownership, artifact metadata, runs and evidence. Native ADK sessions remain in their session database. A manually copied or moved file never activates framework content. [Settings](../app/settings.py), [path construction](../app/connectors/providers/project_storage.py), [stage transitions](../app/configuration/service.py), [chat artifacts](../app/persistence/chat_artifacts.py).

Existing explicit canonical-store overrides remain supported. No existing data is moved by initialization. Pin old canonical paths before changing defaults; see [migration notes](../docs/reference/data-access-and-operations.md#blob-storage--deployment-and-existing-installations). Git and container builds exclude real project content. Compose mounts platform read-only and projects read-write.
