# Guided project creation

The [Overview project summary](../frontend/src/pages/Overview.tsx) links to the [seven-step setup](../frontend/src/pages/ProjectSetup.tsx). The “+ New project” and “Open project” actions configure the deployment's authenticated project. “New project” does not provision a second tenant, project identity, or infrastructure.

## Working behavior

- Save draft persists incomplete project details and existing editor content through the [SQLAlchemy editor store](../app/persistence/platform_admin.py). [Editor validation](../app/api/routes/project_editor.py) bounds metadata, validates timezone and scope, and checks versions. It does not change active runtime settings.
- Setup selects owners from the [authorized membership API](../app/api/routes/catalog.py). Assignments do not grant authorization roles. Applying through this flow requires name, responsibility, objective, timezone, and an active owner.
- The existing [connector editor](../frontend/src/components/ConnectorInstanceEditor.tsx) owns connector persistence, connection tests, and environment bindings. The [parameter panel](../frontend/src/components/ParameterSettingsPanel.tsx) owns effective values and permitted overrides. Their saves apply independently and are labeled accordingly.
- [Agent setup](../frontend/src/components/ProjectHarnessSetup.tsx) loads published project templates, provenance, and effective agents. Explicit template application uses the existing [revision/checksum-guarded backend](../app/api/routes/project_templates.py). Approval rules for custom agents are unchanged.
- Review presents entered details and the exact supported runtime YAML. [Runtime application](../app/api/routes/catalog.py) validates the saved draft and expected project revision before saving. It preserves inherited runtime values rather than inserting frontend defaults. Enabled connector dependencies prevent removal of referenced environments. Failed runtime application does not replace the active runtime configuration; the separately saved draft remains available.
- Conflict recovery preserves the form, supports a comparison with the latest draft, and downloads local entries before an explicit reload. Navigation warns about unsaved entries. New investigations use the existing authorized run flow and saved harness.

## Release boundary

This is the supported setup flow, not completion of every proposed requirement in [project-setup-requirements.md](project-setup-requirements.md). There is no new project lifecycle/revision activation service, candidate end-to-end test matrix, durable scheduler, refresh worker, notification provider, or custom script execution. Monitoring states this boundary. Metadata and contact details are editor data, not new runtime permissions or workflow instructions. Runtime YAML export is separate from a conflict-recovery draft download; this change does not introduce a general YAML import route. Knowledge uses the existing library; this change does not implement the proposed project artifact versioning service.

[Integration coverage](../tests/integration/test_project_setup_workflow.py) verifies real draft persistence, unchanged runtime while drafting, scope/timezone rejection, required setup checks, authorized owner selection, stale draft/project rejection, and application. Existing [template coverage](../tests/integration/test_project_templates.py) exercises template provenance and native harness execution. Offline tests do not establish live model quality.

Project setup is an action from Overview, rather than a sidebar destination. The summary reads the authenticated setup and saved editor metadata through the existing backend endpoints. Connector field access policies appear as read-only badges in this flow; platform governance editing stays in the platform tools workspace.
