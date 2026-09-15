# Harness-linked backend configuration

Frontend integration recommendations in this document are not frontend changes.

## Sources and consumers

| Configuration | Authoritative source | Backend consumer and inspection |
| --- | --- | --- |
| Runtime parameters | SQLAlchemy parameter definitions and permitted project overrides | [Parameter API](../app/api/routes/parameters.py), [execution runner](../app/runtime/runner.py), and [Harness workspace](../app/configuration/harness_workspace.py) |
| Connector contracts | Published, versioned connector catalog | [Catalog resolver](../app/configuration/connector_catalog.py), [connector API](../app/api/routes/connectors_api.py), and [runner provider resolution](../app/runtime/runner.py) |
| Shared connector values | Parameter definitions; permitted project and instance overrides | [Parameter resolution](../app/configuration/parameters.py) feeds supported provider controls at run preparation |
| Managed project templates | Tenant-scoped `platform.project_templates` records | [Template API](../app/api/routes/project_templates.py) applies delegated sections and Harness selection to the authenticated project; provenance is persisted in that same project document |
| Agent model stages and limits | `config/model_profiles.yaml` in the active platform configuration | [Model profiles](../app/models/profiles.py), [native agent assembly](../app/agents/root.py), and [Harness compilation](../app/configuration/harness_workspace.py) |
| Attachment parsing limits | `config/file_processing.yaml` in the active platform configuration | [Configuration editor](../app/api/routes/platform_configuration.py) updates upload parsing and Harness attachment context together |
| Capabilities and permissions | Declarative capability YAML and server-controlled policy | [Capability resolver](../app/capabilities/resolver.py) determines which configuration and tools an agent may use |
| Harness workflow and specialist definitions | Approved, content-addressed bundles and agent definitions | [Workspace activation](../app/configuration/harness_workspace.py) and [agent approval](../app/configuration/service.py) feed native ADK execution |

Model stages and capabilities retain their existing declarative sources instead of introducing competing parameter-table copies. Authentication identity, connector authorization scope, credentials, and approval rules remain server-controlled.

## Model and attachment synchronization

[Project setup](../app/api/routes/catalog.py) now derives stage definitions from the builtin mapping used by Harness and native agents. Each stage returns its agent IDs, configured capability/model-profile bindings, model settings, source, and content hash. A binding is explicitly labeled `capability_default`; its `harness_workspace_api` points to the capability workspace where approved workflow overrides can be inspected. Clients must not treat a capability default as an override of an approved Harness bundle.

Saving attachment limits updates the platform reference held by Harness as well as the upload and execution services. The [regression check](../tests/unit/test_platform_configuration.py) saves attachment and model limits through authenticated APIs and verifies the resulting project setup and Harness responses.

## Managed project templates

The [template store](../app/configuration/project_templates.py) stores named, versioned templates with a checksum, optimistic revision, lifecycle status, actor, and timestamp. Template definitions must explicitly include `harness`, pass the existing project-policy validation, and exclude identity, connector scope, and provenance. Parameter values remain in the existing parameter tables rather than being duplicated inside project templates.

- `GET /api/v1/project-templates`: list templates; project readers see published versions.
- `PUT /api/v1/project-templates/{id}/{version}`: platform administrator creates or edits a draft, publishes it, or deprecates a version, using `expected_revision`. Published content is immutable; changes require a new version.
- `GET /api/v1/project-templates/binding`: obtain current project and Harness revisions plus the applied template's synchronization state.
- `POST /api/v1/project-templates/{id}/{version}/apply`: a project owner or platform administrator applies a published version using its revision/checksum and the current project/Harness revisions.

Apply works for initial setup and updates within the deployment's authenticated scope. It replaces only explicitly supplied sections, preserves other sections and parameter-table overrides, and persists server-owned provenance with the resulting project configuration. Applying a newer version is explicit; template publication does not silently rewrite existing projects. Provision project identity and membership through deployment setup before applying a template. This API does not create a different tenant or project from a request body.

Project setup and Harness return the applied version and synchronization state. Ordinary project edits preserve provenance and can cause `DRIFTED`; a changed Harness catalog produces `HARNESS_CHANGED`. Deprecating a project template prevents new application while existing projects retain their previously applied configuration. The [run snapshot](../app/runtime/runner.py) captures applied template provenance, active runtime controls, and supported nonsecret provider controls with the workflow used by the agents.

PostgreSQL deployments require [migration 018](../migrations/018_project_templates.sql) before startup. SQLite initializes the table through the existing SQLAlchemy startup path. [Integration coverage](../tests/integration/test_project_templates.py) checks authorization, application, update conflicts, restart persistence, native ADK execution, source provenance, and shared provider controls.

## Connector activation

[Catalog resolution](../app/configuration/connector_catalog.py) honors persisted lifecycle state at startup and publication. The tools, template, project-setup, parameter, and Harness APIs resolve this catalog. Shared operational controls feed newly constructed deployed native clients for subsequent runs; existing clients are not mutated. Explicitly injected providers remain owned by their caller. Connection identity defaults do not retarget clients until explicitly edited. Per-project instance resolution retains its scope, credential, environment, and availability checks.

The tools response reports unavailable usage metrics as `null`, rather than inventing zero calls or a zero error rate. Declared queries and attachment-processing controls without an implemented execution consumer remain explicitly identified in Harness; this work does not add scheduled polling or remote attachment downloads.

## Frontend recommendations only

1. Read values and permissions from the backend endpoints above. Use returned field contracts, choices, bounds, revisions, and hashes instead of independent frontend defaults.
2. Show the source and effective value separately. Keep inherited values, permitted overrides, locked fields, inactive drafts, and restart-pending settings distinct.
3. Link configuration details to the relevant Harness workspace and display its agent, tool, model, and connector dependencies. Use the capability-specific workspace for effective workflow overrides.
4. Save with the endpoint's revision/hash guard. Preserve unsaved input on validation or conflict responses; reload affected parameter, template, project setup, and Harness queries after success.
   For project setup, select a published managed template and use its apply endpoint for both initial setup and explicit version updates. Display drift and the applied version from the binding response.
5. Use actual backend availability and probe results. A stored contract or query is not proof that a provider, scheduler, or agent operation is implemented or enabled.

The [Harness workspace projection](../app/configuration/harness_workspace.py) adds connector-template and parameter nodes to the dependency graph. Parameter details include source revisions, template references, permitted instance provenance, and consumer links. Treat configuration relationships separately from supported runtime bindings: a field with a declared but unimplemented binding is visible for inspection, not advertised as an executing agent control. Secret and hidden values must not be rendered from this projection.

There is no new frontend implementation in this work. Existing workspace frontend changes from before this task are preserved.
