# Workspace administration

Sign in as `PLATFORM_ADMIN` or `PROJECT_OWNER` to edit administrative settings.
The server verifies the token and scope before accepting writes.

## Workspace presentation

Open **Platform settings → Workspace presentation** to edit brand and workspace
names, the overview heading and description, the default theme and landing page,
and navigation labels, descriptions, groups, ordering, and visibility. Changes
apply immediately and reload from scoped SQL storage in subsequent sessions.
Overview and Settings stay visible so administrators retain access. Hidden links
do not change authorization. Stale saves return a conflict and require reloading.

Sources: [editor](../frontend/src/pages/Settings.tsx),
[shell](../frontend/src/App.tsx), [API](../app/api/routes/ui_settings.py),
[storage](../app/persistence/platform_admin.py),
[migration](../migrations/008_platform_ui_settings.sql).

## Project settings

The project editor manages actual execution limits, workflow switches, report
preferences, and delegated environments. The full configuration editor exposes
other delegated sections, including capability, prompt, skill, and harness
overrides. The backend validates policy before saving. The form preserves
unchanged sections and omits sections not delegated by the deployment.
Tenant and project are taken from the authenticated snapshot.

The setup page no longer presents example people, environments, connector health,
or schedules as saved configuration. Membership, connectors, skills, and
capabilities use their dedicated screens. There is no background scheduler or
recovery worker in this release.

Sources: [editor](../frontend/src/pages/ProjectSetup.tsx),
[contract](../app/configuration/models.py),
[validation and persistence](../app/api/routes/catalog.py).

## Runtime settings

Runtime model tuning reads the active `config/model_profiles.yaml`. Model,
thinking configuration, output limit, temperature, and enabled state are
validated and saved to the active configuration source. Content hashes reject
stale edits; referenced synthesis stages cannot be disabled. Agent instructions
and tool permissions retain their existing configuration and review flow.

Operational limits persist across restart and apply to subsequent investigations.
Concurrency changes require idle investigations. Credentials, authentication,
deployment scope, and demo/live mode remain deployment settings. Live updates
apply within one API process; there is no distributed refresh coordinator.

Sources: [runtime editor](../frontend/src/pages/Runtime.tsx),
[API](../app/api/routes/catalog.py),
[configuration loading](../app/configuration/database_bundle.py),
[runner](../app/runtime/runner.py).

## Operator notes

Tool operator notes now persist as scoped project knowledge and can also be
managed from Knowledge. Catalog failures no longer manufacture fallback agents
or editable parameter revisions.

Sources: [tools](../frontend/src/pages/Tools.tsx),
[agents](../frontend/src/pages/Agents.tsx),
[knowledge API](../app/api/routes/catalog.py).

## Membership

User role and status edits are resolved from server-side SQL membership on the
next verified request. Revocation persists as an inactive membership so a
deployment bootstrap entry cannot silently restore access. Project owners cannot
modify platform administrators or grant that role; administrators cannot remove
their own management access. Membership assignments use supported system roles.
Custom role catalog entries remain descriptive; they do not add new runtime roles.

Sources: [authentication](../app/identity/auth.py),
[membership API](../app/api/routes/catalog.py),
[membership editor](../frontend/src/pages/Users.tsx).

## Platform configuration and parameter scope

Platform settings retains its existing seven-tab layout. Additional runtime and
optimization controls are inside Platform Execution & Boundaries. Attachment
controls remain in File Processing & Formats, and restart-applied connection
settings are inside Deployment Export.
Attachment settings and Persistence use the same active configuration document;
new uploads use the saved values. Optimization changes require a restart.
Deployment settings expose mode, configuration storage selection, storage paths,
and database/session/MLflow credential references. Secret values remain in the
deployment environment; the editor saves references, never secret contents.
Authentication trust and tenant/project identity remain deployment-owned.
Storage path changes do not migrate existing data.

Parameter definitions have an explicit scope:

- **Platform default:** project-visible, inherited, and read-only in the project.
- **Project workspace:** project-visible and overridable by a project owner or administrator.
- **Platform only:** excluded from the project API view and project pane.

Administrators choose scope in Parameters. Project settings includes a parameter
pane with inherited/effective values. Scope changes remove incompatible project
overrides. Revision checks protect against conflicting edits.
Runtime parameters persist in SQL and are loaded at startup. Most changes apply
to subsequent requests; model concurrency, upload concurrency, and agent YAML
storage bounds remain pending until restart. Settings shows pending active values.
There is no multi-process live-refresh coordinator.

Sources: [settings page](../frontend/src/pages/Settings.tsx),
[parameter editor](../frontend/src/pages/ParameterStudio.tsx),
[project pane](../frontend/src/components/ParameterSettingsPanel.tsx),
[scope API](../app/api/routes/parameters.py),
[definitions](../app/configuration/parameters.py),
[scope migration](../migrations/010_parameter_scopes.sql),
[configuration API](../app/api/routes/platform_configuration.py),
[deployment API](../app/api/routes/deployment_settings.py),
[startup](../app/settings.py),
[deployment persistence](../app/configuration/deployment_settings.py).

The original six-step Project Setup wizard is retained. Its authoring metadata,
team planning, query templates, and scheduling drafts persist through the
[project editor API](../app/api/routes/project_editor.py) with version conflicts.
These drafts do not grant membership, register connector scopes, or launch jobs.
Supported executable project settings continue through the existing validated
ProjectLayer API. [Wizard source](../frontend/src/pages/ProjectSetup.tsx),
[draft migration](../migrations/011_project_editor_drafts.sql).
