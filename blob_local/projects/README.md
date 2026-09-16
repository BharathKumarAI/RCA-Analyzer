# Project configuration and artifacts

[project_1](project_1/README.md) and [project_2](project_2/README.md) are reference folders only. Their `.yaml.example` files and `chat_example` directories are never loaded as live identities.

```bash
python -m scripts.init_project --tenant acme --project payments --subject analyst
# Optional: --root /mounted/rca/projects
```

The initializer prints the real scoped path, creates the documented folder skeleton and leaves existing files untouched. It creates `configuration/project.yaml`, optional `configuration/users/<subject-key>.yaml`, one `artifacts/framework/uploads` hierarchy, canonical framework object folders, an `artifacts/chats` container and `exports`. The [complete storage guide](../../docs/reference/data-access-and-operations.md#blob-storage) explains every branch and stage, including the separate chat `uploads` and `created` directories.

```dotenv
RCA_TENANT_ID=acme
RCA_PROJECT_ID=payments
RCA_PROJECTS_ROOT=./blob_local/projects
# Optional GCS artifact root; configuration remains locally mounted:
# RCA_PROJECTS_BLOB_URI=gs://YOUR_BUCKET/rca/projects
```

Tenant, project and user keys are readable labels plus full identity hashes. The initializer prevents symlink traversal and validates existing identities. Do not rename keys by hand. Configuration identity must match its directory. The loader rejects duplicate scopes, mismatched identities and symlinked configuration. Edit settings using the [project reference](../platform/layers/projects/README.md) and [user reference](../platform/layers/users/README.md), then restart. [Initializer](../../scripts/init_project.py), [key construction](../../app/connectors/providers/project_storage.py), [loader](../../app/configuration/layers.py).

Approved agent uploads automatically move their stage copies; SQLAlchemy remains authoritative for approval and active selection. Skill/prompt/configuration review folders are reserved and never auto-loaded. Chat uploads retain originals and redacted processed files separately; generated run/evidence exports use the chat’s `created` branch. See [lifecycle, cleanup and repair](../../docs/reference/data-access-and-operations.md#blob-storage).

## Existing installations

Explicit `RCA_CONFIG_BLOB_URI` and `RCA_OPTIMIZATION_BLOB_URI` keep their current canonical locations. If an installation used earlier defaults, pin those paths before upgrading until migration is verified. The initializer does not move or delete existing objects or database records. [Migration details](../../docs/reference/data-access-and-operations.md#blob-storage--deployment-and-existing-installations).

Legacy project/user configuration inside `platform/layers` remains supported. Move a scope only once; duplicate definitions are rejected. Real project data is excluded from Git and image builds. Compose mounts projects read-write and platform read-only; provision ownership for the runtime user (UID 10001 in the image). Only the reference folders' documentation and `.example` files are tracked.
