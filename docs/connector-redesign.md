# Connector form and harness contract

The supplied PRISM ten-connector specification is a target design. This implementation builds on the existing versioned catalog, saved connector instances and parameter store. It does not enable every authentication method or operation described in the specification.

## Form responsibilities

The [template editor](../frontend/src/components/connectors/ConnectorsForm.tsx) renders shared controls declared by each published template. [The Tools page](../frontend/src/pages/Tools.tsx) submits changed values through the existing atomic parameter endpoint with their expected revisions. Connector-specific field types and bounds come from the catalog; targets, credentials, environment assignments and connection tests belong to the [instance editor](../frontend/src/components/ConnectorInstanceEditor.tsx).

The [catalog API](../app/api/routes/connectors_api.py) adds `native_auth_profile_ids`, the intersection of active template profiles and installed native authentication support. This is implementation metadata, not proof of connectivity or deployment enablement. Kafka's MCP profile is not a native authentication option; Oracle remains blocked by release policy. Persisted catalog lifecycle rows remain authoritative over bundled declarations.

Fields explicitly marked `visible_in_project: false` are excluded from project-facing template fields and corresponding defaults. Instance reads, saves and enable/disable responses apply the same declared field visibility policy. Platform administrators retain the platform view. Project responses also omit instance endpoints, credentials, authentication selection, credential-binding IDs and environment connection target/credential details. Connection identities and routes are managed by platform administrators. Credentials currently resolve through deployment-approved environment references; this is not a credential-vault creation service.

## Validation and execution

[Candidate validation](../app/connectors/candidate_testing.py) checks the selected template identity/version, explicit project identity and environment choices, authentication profile, credential references and numeric bounds before testing. Hidden credential fields are rejected. MCP and Hybrid tests use the governed MCP provider with an explicit operation route, scoped arguments and a separately authorized MCP credential. Conflicting route selections are rejected. [Template validation](../app/configuration/models.py) rejects duplicate and overlapping conditional authentication field declarations.

The [runner](../app/runtime/runner.py) resolves published configuration for each run and applies permitted parameter values for the saved instance and its explicitly selected environment. [Provider resolution](../app/connectors/providers/registry.py) retains endpoint, credential, scope and deployment gates. Changing shared defaults takes effect through resolution for subsequent runs; it does not mutate an active provider client.

## Local startup repair

The API refuses to start when the schema ledger differs from [the required version](../app/persistence/database.py). The local migration 18 had a permissions block appended after deployment. Its original contents were recovered and verified against the database's recorded checksum; that permissions block now belongs to [migration 20](../migrations/020_configuration_runtime_privileges.sql), alongside access needed for migration 19's configuration table and override sequence. The [migration runner](../scripts/migrate.py) continues to validate every applied checksum before changing anything. Run `make db-migrate` with the deployment migration identity before restarting the API.

[Session verification](../frontend/src/services/api.ts) now times out after 15 seconds when the server does not respond. The [sign-in dialog](../frontend/src/components/SessionModal.tsx) reports that failure and retains the entered token for a retry after a network failure; tokens remain in memory only.

## Remaining specification boundaries

- Repeatable environment connections are persisted and resolved by explicit connection ID. See [the shared record contract](../app/configuration/connection_records.py), [store](../app/persistence/platform_admin.py) and [API](../app/api/routes/connectors_api.py). Saves reset validation and disable the connection; a test completing after an edit cannot mark the edited record as passed.
- Runs accept optional saved instance/environment selectors in [the request contract](../app/runtime/run_contract.py). [The runner](../app/runtime/runner.py) resolves these only from the authenticated project and active bindings. Ambiguous selections, disabled records and IDs outside the capability/project are rejected.
- Hybrid routing is implemented for each connector’s existing governed read operation. Separate write identities remain unavailable under release policy. New OAuth consent/refresh flows, the additional vendor authentication profiles in the specification, and credential-vault creation remain unimplemented; deployment identities and the credential service still need to be specified.
- Jira mutations, database querying, arbitrary Unix execution and other write/export capabilities remain unavailable under the current release policy. A vendor's API support does not enable those operations in this application.
- Existing published database templates are not silently rewritten. The bundled Jira declaration corrects the account-email requirement for API-token authentication, marks webhook setup as planned, and removes the invented service-account default. Apply catalog changes using the established reviewed publication/configuration workflow.

Jira account-token authentication uses account email and an API token, and Jira's external OAuth integration uses the authorization-code flow: [Atlassian Basic authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) and [Atlassian OAuth 2.0 (3LO)](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/). MCP authentication concerns the MCP server connection; see the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

## Connector workspace

The [Tools page](../frontend/src/pages/Tools.tsx) loads the published catalog, shared parameter rows, saved project connections, and project environments from authenticated APIs. Its searchable connector picker opens one continuous two-column page with template defaults, supported authentication methods, project connections, scope, field mapping, availability, and testing. Template fields are declared by the backend; only platform administrators can change shared defaults. The [template form](../frontend/src/components/connectors/ConnectorsForm.tsx) retains failed edits, offers discard, and guards connector changes and browser reloads.

The [connection editor](../frontend/src/components/ConnectorInstanceEditor.tsx) reuses project connection persistence, environment assignments, saved-connection testing, and explicit enable/disable actions. Platform administrators manage environment targets and approved `env://` references; project owners manage project settings within server-enforced permissions. MCP configuration uses the HTTP endpoint, token reference, operation mapping, and explicit hybrid route supported by the provider. It does not offer shell commands or local process transports.

The [API adapter](../frontend/src/services/api.ts) maps database JSON columns into form fields and submits edited environment connections as untested, disabled drafts. Test and enablement metadata do not count as unsaved configuration changes. The [disable endpoint](../app/api/routes/connectors_api.py) preserves connection settings and credentials while disabling execution. Oracle remains policy-restricted; catalog publication does not imply a successful live connection test.

The [project capability section](../frontend/src/components/connectors/ConnectorProjectPolicy.tsx) reads actual capability requirements and updates the existing project availability API with expected-state checks. [Runtime availability descriptions](../app/connectors/runtime_support.py) distinguish implemented provider behavior from unavailable writes, schedulers, webhooks, and interactive identity flows. Jira project field mappings serialize to the canonical field-ID-to-label dictionary consumed by the native provider.

## Persistent field access

The connector admin page includes **Field access** with Platform Only, Project Editable,
and Project Non-Editable choices. Saves use an expected revision, write tenant-scoped
`platform.system_configurations` records, synchronize existing parameter definitions,
and append audit events in one transaction. Removing delegation clears the field's
project parameter overrides. See [policy storage](../app/configuration/connector_governance.py)
and [admin control](../frontend/src/components/connectors/ConnectorFieldGovernance.tsx).

Project reads redact hidden fields, including nested parameter and resource aliases.
Project saves reject changes to locked fields and preserve omitted platform values.
Saved instance values become non-editable when policy is locked; shared runtime limits
that conflict with platform values fail closed until an administrator repairs the
connection. Credential and routing edits still require platform authority. The
[harness workspace](../app/configuration/harness_workspace.py) and
[runner](../app/runtime/runner.py) read current persisted policies for new execution;
existing in-flight run snapshots are unchanged. Tests cover restart persistence,
role boundaries, stale revisions, hidden values, aliases and runtime enforcement in
[test_connector_field_governance.py](../tests/integration/test_connector_field_governance.py).
