# Project Setup Requirements

Status: Draft for product review  
Date: September 13, 2026  
Basis: User-provided Project Template and a targeted review of the existing project setup implementation.

## 1. Purpose and scope

Provide one guided setup experience for configuring a project's purpose, environments, ownership, policies, connectors, parameters, monitoring, capabilities, and agents, then validating and activating that configuration.

This document specifies target behavior. It does not claim that every feature is implemented. Requirements marked **platform extension** need backend functionality before they can be offered as working features. Proposed defaults and unresolved product decisions are identified explicitly.

The setup applies to the deployment's authenticated project. It is not a request to introduce multiple project scopes into one deployment. Project ID is server-derived; editing a form or importing YAML must never change the authenticated tenant, project, roles, or connector authorization scope.

## 2. Setup navigation and shared behavior

Use seven steps, correcting the duplicate numbering in the source template:

1. **Basic Information** — identity, purpose, lifecycle, timezone, tags.
2. **Setup** — environments, team contacts, members, ownership, policies, project runbooks and artifacts.
3. **Connectors & Tools** — platform templates, instances, environment mappings, data sources, capabilities.
4. **Parameter Setup** — effective values, permitted overrides, inherited defaults.
5. **Monitoring Setup** — queues, query builders, triggers, schedules, execution mapping.
6. **Agent Setup** — platform defaults, permitted customization, testing, approval status.
7. **Review & Deploy** — configuration review, YAML, validation, end-to-end test, activation.

Shared requirements:

- Allow incomplete drafts to be saved and resumed. Distinguish draft persistence from changes to the active runtime configuration.
- Display step completion and field-level errors. Review links must take the user to the exact unresolved section.
- Show inherited, overridden, locked, unavailable, and unconfigured values distinctly.
- Preserve unsaved input when validation or a network request fails. Handle concurrent edits with version checks and a reload/compare path; never silently overwrite a newer version.
- Show real loading, empty, error, and permission-denied states. Never fabricate environments, members, schedules, connector health, test results, or data refresh records.
- All mutations and tests require server-side authorization. Hiding a control is not an access-control mechanism.
- Changing a dependency must identify affected mappings, schedules, capabilities, and tests before the change can be activated.

## 3. Basic Information

| Field | Requirement | Validation and behavior |
|---|---|---|
| Project ID | Required, read-only | Display the deployment-owned project identifier. Imported identity must match the authenticated scope. |
| Project Name | Required for activation | Trimmed, nonempty display name; agree field limits in the schema. |
| Responsibility | Required for activation | Triaging, Root Cause Analysis, or Generic. Proposed default: one primary responsibility; enabled capabilities separately determine execution. |
| Status | Required, controlled transition | Draft, Active, Inactive, Deleted. Do not expose an unrestricted status text field. |
| Objective | Required for activation | Plain-language purpose and expected outcomes; data only, with no effect on tool permissions. |
| Timezone | Required for activation | Valid IANA timezone. Display schedules in this timezone and store execution timestamps in UTC. |
| Tags | Optional | Trim, deduplicate, and enforce schema-defined count and length limits. |

### Lifecycle

- **Draft:** editable configuration that has not been activated.
- **Active:** validated, versioned configuration eligible for authorized execution.
- **Inactive:** configuration retained, with new project execution and automatic triggers disabled.
- **Deleted:** proposed soft-deleted state, hidden from normal selection and unavailable for new execution. Retained records remain subject to retention rules; deletion is not immediate physical erasure.
- Supported transitions: Draft → Active; Active → Inactive; Inactive → Active; Draft or Inactive → Deleted. Require deactivation before deleting an active project.
- Editing an active project creates a draft revision. The active revision remains effective until the replacement passes activation checks.
- Proposed in-flight behavior: deactivation prevents new runs; already-started runs complete against their recorded configuration version. Cancellation and restoration from Deleted require a separate product decision.

## 4. Setup

### 4.1 Project Support Environments

Display a table with **Environment ID, Display Name, Description, Status, Actions**.

| Field/action | Requirement |
|---|---|
| Environment ID | Required, unique within the authenticated project, stable once referenced. ENV1 and ENV2 are examples only, not seeded records. |
| Display Name | Required human-readable name. |
| Description | Optional operational context. |
| Status | Proposed values: Active and Inactive. |
| Actions | Add, edit, deactivate, and remove an unreferenced environment, subject to permissions. |

Environment-dependent connectors and schedules must reference active environments. Deactivation must identify affected dependencies and block activation until they are remapped or disabled. Do not silently cascade changes or remove historical evidence.

### 4.2 Teams & Ownership: communication

- **Team Distribution List:** optional team email address; validate address syntax.
- **Notification Channel:** optional provider and channel reference for Microsoft Teams or Slack. A channel is not assumed to be available merely because it has been entered.
- **Teams Webhook Secret Reference:** store a managed secret reference, never the raw webhook URL or credential. Resolve it only in the authorized provider layer.
- Show provider availability and delivery configuration separately. An explicit “Send test notification” action must disclose its destination and report the real delivery result.
- **Platform extension:** notification delivery requires an implemented, enabled provider. Saving contact metadata alone must not imply messages will be sent.

### 4.3 Teams: members and responsibilities

Provide independently editable lists for **Managers**, **Owners**, and **Analysts**, each supporting multiple members and an Add action.

- Select members from the authorized project membership source; persist stable subject IDs with display names.
- Prevent duplicates within a responsibility list. Proposed default: a person may belong to more than one list.
- Require at least one active owner before activation.
- These business assignments do not themselves grant authorization roles. Any role change must use the existing server-controlled membership and authorization process.
- Show removed or inactive identities as unresolved references and identify affected queue filters and ownership rules.
- Maintain provider identity mappings where required: a project subject ID is not automatically a Jira account ID.

### 4.4 Project Policies

| Policy | Requirement |
|---|---|
| Data Retention | Select an allowed policy and display duration, covered data classes, and cleanup mechanism. Project settings cannot weaken platform requirements. Do not imply that retention configuration creates a cleanup worker. |
| Access Control | Display effective permissions and allow only platform-permitted restrictions. Do not accept request-supplied authorization roles or scope. |
| Audit Logging | Display effective logging policy; mandatory platform logging cannot be disabled by the project. |
| Project Category | Select a platform-managed value where such a catalog exists. Catalog and requiredness remain product decisions. |
| Priority | Select from platform-defined values. Priority is metadata unless a real execution policy uses it; do not imply scheduling precedence. |

Audit configuration changes, lifecycle transitions, tests, activation, and agent reviews with actor, UTC timestamp, scope, version, outcome, and redacted change details.

### 4.5 Project Runbooks & Artifacts

Provide a project-level library for uploading and maintaining runbooks and supporting artifacts during setup and after activation. These are reusable project resources, distinct from attachments belonging to one chat or run.

Supported uses include operational runbooks, troubleshooting guides, architecture documentation, service inventories, and supporting evidence in platform-supported file formats.

| Field | Requirement |
|---|---|
| Artifact ID / Version | Server-generated stable artifact identity with immutable versions and a content hash. |
| File | Local file upload; show original filename, verified media type, and size. |
| Title / Type | Required title and classification, including Runbook and Supporting Artifact. |
| Description / Tags | Optional context for browsing and retrieval. |
| Environment association | All project environments or one or more explicit environment references. |
| System / Capability association | Optional references to project connector instances, services where modeled, and enabled capabilities. |
| Owner | Responsible project member; uploader and upload time are recorded separately. |
| Status | Processing, Ready, Failed, or Archived; show extraction warnings and actionable failure details. |

Library requirements:

- Support single and multiple local file uploads, with per-file progress/outcomes, bounded batch size, and retry of failed files without duplicating completed uploads.
- Offer search and filters by title, type, environment, association, status, and tags. Display filename/title, type, associations, version, uploader, uploaded time, and status in the library table.
- Provide authorized metadata editing, extracted-text preview, original download, new-version upload, and archive actions. Archival removes the artifact from future default retrieval while preserving run provenance under retention policy.
- Reuse the supported parser formats and platform-configured limits. The existing parser accepts text/Markdown/logs, JSON, CSV/TSV, PDF, DOCX, XLSX, and supported images; images provide OCR text only, not visual interpretation.
- Enforce identity and project membership before upload; validate filenames, file content/type, per-file and batch bounds, extraction bounds, and deadlines. Reject unsupported/executable/macro-bearing input and do not fetch remote URLs.
- A file with failed extraction or no usable text must not be labeled ready for agent use. Show truncation or extraction limitations explicitly.
- Store original bytes and extracted, policy-redacted content with durable project ownership and integrity metadata. Do not give a reusable project runbook the short-lived lifecycle of an incidental chat attachment.
- Re-uploading identical content must identify the existing version rather than silently creating duplicate searchable content. Replacing content creates a new version, preserving prior versions referenced by runs.
- File contents are reference data, not permission to run commands, change policies, or override agent instructions. Uploading a runbook does not turn its procedures into executable tools or approved agent configuration.

Agent and run integration:

- Allow the project to select which Ready artifacts are available as reference material by capability and environment, and allow an authorized user to explicitly select relevant artifacts when starting a run.
- Retrieve only within the authenticated project and permitted associations, with bounded context and an inspectable list of selected sources. Do not automatically inject every project document into every run.
- Record the exact artifact ID, version/hash, and available page/section locator used as evidence so conclusions can cite their sources.
- New runs use the currently selected Ready version; existing runs retain their original references. Do not silently substitute a newer runbook when viewing prior results.
- Include selected runbook/artifact readiness in review and end-to-end testing. Uploads are optional unless a capability explicitly requires them; required missing, failed, or archived artifacts block that capability's activation.
- Add project library visibility to the Data tab while distinguishing user-uploaded resources from connector-refreshed datasets and showing the appropriate upload/refresh provenance.
- YAML exports include artifact/version references and associations, not embedded file bytes or public download links. Validate those references on import.
- **Platform extension:** implement project-level artifact persistence, library APIs, version selection, and scoped runtime retrieval. Reuse bounded parsing and storage primitives; the current chat-upload endpoint does not establish this reusable library contract.

## 5. Connectors & Tools

### 5.1 Catalog and template inheritance

Detailed connector sub-tabs, field contracts, authentication profiles, and extension rules are specified in [Connector Templates — Review Document](connector-template-requirements.md).

- Show only platform-enabled connectors and tools available to the authenticated project.
- Generate connector forms from platform-owned templates, including field types, validation, secret references, and allowed project overrides.
- Distinguish a connector type, a configured connector instance, and a tool exposed by that connector.
- Every instance must contain the three requested project-level fields:

  Their values are persisted only on project instances, including custom MCP instances. System Name defaults initially to the selected connector display name and remains editable; MCP uses its selected registered connector/server display name. Preserve user-edited/saved names through catalog changes and require unique names within the project. The environment fields require explicit selection. Additional fields remain mandatory when required by the chosen connection/auth profile. Testing and activation require all three; incomplete drafts may be saved.

| Field | Requirement |
|---|---|
| System Name | Required; initially defaults to selected connector name, editable and unique within the project. Persist a separate stable instance ID. |
| Environment Dependence | Required choice: Environment Dependent or Environment Independent. |
| Tool Environment | Required description/reference of the external system environment. For an independent connector, explicitly select Shared rather than leaving it blank. |

- Also require a platform template reference and all template-required connection settings. Server authorization determines which underlying connector resources may be used.
- Allow multiple instances of a connector type so separate external environments and credentials can be represented.
- Test connectivity through the actual provider and report timestamp, outcome, and a redacted failure reason. Template availability is not successful connectivity.

### 5.2 Environment mapping and visualization

- Environment-dependent instances require one or more explicit mappings from an active project environment to a tool environment/instance.
- Proposed default: an independent instance applies to all active project environments and appears as Shared. An exception mechanism is not required unless requested.
- Resolve execution to one explicit connector instance per required tool/environment selection. Reject ambiguous mappings; never guess among multiple matching instances.
- Visualize **Project Environment → Connector Instance / Tool Environment → Available Tools and Capabilities** using the saved/draft mapping data.
- Selecting an environment or connector highlights its relationships. Show missing, inactive, and invalid dependencies with text as well as color.
- Provide an equivalent accessible table, including keyboard access to edit the mapping. The diagram is a view of the same data, not a separately maintained configuration.

### 5.3 Jira custom fields

- Show inherited platform `custom_fields` and their `field_name` labels, IDs, and types.
- Allow project-specific additions with a field ID, display name, type, and provider instance association.
- Merge inherited and project fields for the query builder. Reject conflicting definitions of an existing ID; inherited meanings cannot be silently replaced.
- Validate additions against the selected Jira instance where metadata access is supported. Unverified fields must be marked explicitly and cannot be presented as successfully tested.
- Use provider field types to constrain available operators and input values.
- Configure each field's use for extraction, queue filters and semantic mappings; preview actual values on an authorized issue and explicitly define missing-field behavior. This configures existing Jira fields, not remote field creation.
- Include attachment-processing settings for local files associated with a Jira issue and permitted project-library versions: supported formats, size/count/text bounds, OCR-only images, required/optional evidence, partial-failure handling, retention and redaction. Show actual per-file processing results and cite issue, instance and artifact/version provenance.
- Jira-hosted attachment retrieval is a separate proposed extension: the current provider exposes attachment counts only. Current local-only attachment rules remain in effect unless retrieval is explicitly authorized and implemented through a bounded, scoped provider operation. Do not imply automatic download from a saved toggle.

### 5.4 Project MCP additions

Desired outcome: add a project MCP integration and make its eligible tools discoverable by the framework without a separate hardcoded UI registration.

- Extend existing integration registration rather than creating a second integration system.
- Discovery must pass platform policy, connector authorization, supported transport, credential-reference, and tool-schema validation.
- Only approved/enabled tools within the project's allowed scope become available to capability and agent configuration. Discovery alone does not grant execution permission.
- Show Registered, Validating, Available, Disabled, or Failed states, with actionable errors.
- Each project MCP instance requires its own System Name, Environment Dependent/Independent choice and Tool Environment. Default System Name to the registered connector/server display name and allow editing; explicitly select environment fields. Group tools by System Name and distinguish identical remote tool names using stable instance/binding IDs. Reusing a registered MCP server does not reuse project instance identity.
- **Decision required:** the request for project-added MCPs must be reconciled with “platform-enabled tools only.” Proposed rule: project administrators may register or request an integration, but platform enablement remains a prerequisite for execution.
- Do not infer permission to execute arbitrary processes or project-supplied code from the MCP requirement.

### 5.5 Data sources and refresh

- Allow an eligible connector instance to be designated as a data source, with an explicit query/scope, environment, refresh schedule, and destination managed by the platform.
- The Data tab must show source, environment, last attempt, last successful refresh, next scheduled refresh, status, record count when available, and failure details.
- Distinguish “never refreshed,” “refresh failed,” and “successful refresh with zero records.” Retain the last successful dataset when a subsequent refresh fails, with a stale indicator.
- Track source provenance and refresh execution IDs. Avoid duplicate ingestion on retries.
- **Platform extension:** scheduled refresh and persistent ingestion require real execution/storage services. Configuration-only schedules must be labeled as unavailable for automatic execution.

### 5.6 Capabilities

- Show platform-available capabilities, their descriptions, required tools, and environment readiness.
- Allow project enablement only within platform authorization and dependency constraints.
- Prevent activation of enabled capabilities with unresolved mandatory dependencies. Explain which connector, tool, environment, or agent definition is missing.
- Keep capability definitions declarative YAML; project choices do not create arbitrary executable capability implementations.

## 6. Parameter Setup

The source template leaves this section unspecified. The following is a proposed scope based on the existing parameter editor:

- Present platform-defined parameters relevant to enabled project capabilities, connectors, agents, and schedules.
- Show parameter name, description, type, effective value, source layer, editability, validation constraints, and secret status.
- Permit project overrides only where platform policy allows them; provide Reset to Inherited Value.
- Reject unknown parameter names and invalid types/ranges server-side. Preserve explicit false, zero, and empty values where the schema permits them.
- Show affected configuration and invalidate related test results after changes.
- Do not expose new model names or stage limits as arbitrary free text: use the platform's model profiles and permitted overrides.
- Mask secrets and store references. Provide a redacted effective configuration preview.

## 7. Monitoring Setup

### 7.1 Monitoring source and queues

- Select an enabled connector instance that exposes a supported monitoring/query capability, then select its project environment mapping.
- Support multiple named queues per monitoring source, each with a stable ID, filter definition, status, and execution capability.
- Use provider-specific schemas for other monitoring tools; do not offer a Jira query form for every connector.

### 7.2 Jira query builder

- Offer **Visual Builder** and **Custom JQL** modes.
- The visual builder provides field selection, type-appropriate operators, values, AND/OR groups, and parentheses. Field choices combine platform and project Jira metadata for the selected instance.
- Support the requested illustrative expression `cf[10290] = "Q1" OR cf[10290] = "Q2"`; this is an example, not default project data.
- Support an assignee filter based on selected project members or a defined member group. Resolve identities to Jira account IDs server-side and safely encode query values.
- Proposed empty-group behavior: match no issues and show a warning. Never remove the assignee constraint and unintentionally broaden the query.
- Display the generated JQL before testing or saving. Keep its structured builder definition for future editing.
- Custom JQL is stored as a literal query subject to provider validation and authorized scope. Switching to the builder must not discard an expression the builder cannot represent; require a deliberate reset or keep custom mode.
- “Test query” executes a bounded, read-only request against the real selected provider. Return query validity, bounded results/count semantics, timestamp, duration, and redacted errors.
- Distinguish syntax validation, successful execution with no matches, provider denial, timeout, and unavailable credentials.

### 7.3 Triggers

- Support polling and, where implemented, provider webhooks. Display only executable trigger modes as available.
- Polling requires interval or cron, timezone, enabled state, and an explicit queue/execution mapping. Enforce platform minimum frequency and runtime limits.
- Webhooks require a backend endpoint, provider-specific authentication/verification, replay protection, duplicate-event handling, and routing to the authorized scope. Do not route based solely on a payload-supplied project ID.
- **Platform extension:** neither a saved polling frequency nor a saved webhook reference establishes a running monitoring service.

### 7.4 Automated Schedules & Execution Mapping

Display **Job & Schedule ID, Trigger & Frequency, Execution Target (JQL / Script), Capability, Status**, with actions to edit, test, enable/disable, and inspect history.

- Persist stable job/schedule IDs, queue/query reference, connector instance, environment, capability, trigger definition, timezone, version, and enabled state.
- Display next run, last attempt, last success, and last failure only from actual scheduler/execution records.
- “Test schedule” first validates resolution and dependencies; an explicitly labeled run action executes the real selected capability once and records its run ID. A query-only test must not be reported as an end-to-end test.
- Disable a schedule when its project is inactive; block enabling it when dependencies are unavailable.
- Record the configuration version and resolved query used for each execution, including dynamic member expansion.
- **Platform extension:** automatic execution needs a durable worker, persisted jobs, concurrency limits, bounded retry policy, deduplication, missed-run policy, and restart recovery. These are release prerequisites, not claims about the current runtime.
- Proposed defaults for review: no overlapping runs of the same schedule, skip missed runs with an audit record, and run a duplicated daylight-saving local time once. Show the next occurrence to make timezone behavior reviewable.

### 7.5 Custom scripts: explicit scope conflict

The source template requests custom scripts. Current repository guidance prohibits adding code execution. Consequently, arbitrary script upload, inline script editing, and execution of a user-provided path are **not implementable under the current architecture rules**.

Retain this request as an unresolved product requirement. A compatible alternative is selecting an existing approved capability or typed tool as the execution target. Actual custom-script execution requires an explicit architecture/security scope change and a separately designed execution service; it must not appear as a working control in the current release.

## 8. Agent Setup

- Start with effective platform defaults for each enabled capability and show inheritance, stages, permitted model profiles, tools, and limits.
- Allow only policy-permitted, data-only customization. Project configuration cannot introduce unknown tool names or arbitrary executable instructions.
- Reuse the agent-configuration submission, validation, content-hash storage, review, approval, and revocation lifecycle.
- A same-scope administrator other than the author must approve a custom definition. Preserve expected-hash checks so approval cannot apply to changed content.
- Show draft/review/approved/revoked state and the exact version selected by the project. The orchestrator may use only approved custom definitions.
- Provide schema/dependency validation for drafts. Runtime testing of a custom definition requires its approved version; distinguish this from draft validation in the UI.
- Tests use explicitly selected real inputs and the configured provider, record a run/evidence trail, and report actual results. Do not label offline fixture contracts as live agent quality measurements.
- Revocation must prevent future selection/execution of the revoked definition and identify affected project configurations.

## 9. Review & Deploy

Review displays all seven sections, effective inheritance, changed values, environment mappings, enabled capabilities, agent approval status, schedule readiness, and blocking errors.

### YAML

- Generate a versioned project YAML representation from the same typed configuration used by the forms, with redacted secrets/reference-only credentials.
- Provide view, copy, download, and server-side validation. Any YAML edit/import path must preserve form/YAML consistency and reject unsupported fields.
- Treat imported identity as a consistency check, never an authorization source. Validate referenced connector resources against server-owned scope.
- Do not silently discard unsupported fields or represent editor-only metadata as active runtime configuration.

### Tests and activation

1. **Validate configuration:** check schema, authorization, policies, references, mappings, and agent approval. Return field/section-specific failures and nonblocking warnings.
2. **Test connections and queries:** execute bounded live probes against the selected providers.
3. **Test end-to-end:** run an explicitly selected enabled capability with real input, the exact candidate configuration, and the intended environment. Record stages, results, evidence, duration, and failures.
4. **Activate:** atomically select the reviewed configuration version only after required checks pass and the user invokes Activate. Reject stale-version activation.

Proposed activation gate: at least one successful end-to-end test per enabled capability and supported environment combination, or an explicitly defined platform test policy. The final matrix and freshness window require product agreement. Changes to tested dependencies invalidate the relevant results.

Activation must not require candidate settings to become active merely to test them; a backend candidate-test path is needed if absent. Failure leaves the previously active revision effective. Show which revision is active and which revision remains a draft.

“Deploy” means activating project configuration; it does not imply infrastructure provisioning, worker deployment, or notification delivery. Unsupported schedules may remain disabled in a draft or active configuration, but cannot be reported as running.

## 10. Persistence and API requirements

Extend existing services and schemas before adding UI behavior. Required logical records are:

| Record | Minimum content |
|---|---|
| Project revision | Server-owned scope, version/hash, metadata, lifecycle, active/draft designation, actor/timestamps. |
| Environment | Stable ID, display name, description, status. |
| Team configuration | Member subject references, business assignments, contact/channel and secret references. |
| Connector instance and binding | Template/version, instance ID, project settings, dependence mode, tool environment, environment references. |
| Jira field extension | Instance reference, field ID/name/type, validation status. |
| Data source / refresh | Source/query/destination references, schedule, execution history, freshness and provenance. |
| Queue / schedule | Structured or literal query, trigger, execution target, capability, environment, version and status. |
| Agent selection | Inherited default or approved definition ID/hash. |
| Project artifact / version | Server-owned scope, artifact ID, immutable version/hash, blob and extracted-content references, metadata, associations, readiness, uploader and timestamps. |
| Validation / test result | Candidate version, dependencies tested, actor, timestamp, outcome, real run/evidence references where applicable. |

Use async SQLAlchemy for durable run, evidence, and supported configuration records; retain existing content-hashed blob storage for agent definitions. Avoid duplicate sources of truth between editor drafts, generated YAML, and effective runtime settings.

APIs must enforce typed validation, optimistic concurrency, bounded queries/tests, UTC deadlines, redacted errors, and scope checks. Tests must not send external notifications unless the action explicitly includes them. All network calls and credential resolution belong in connector providers; expose runtime tools through typed ADK domain tools.

## 11. Existing implementation references and gaps

This is a targeted inventory, not a complete implementation audit.

| Area | Existing source / observed behavior | Required follow-up |
|---|---|---|
| Setup UI | [ProjectSetup.tsx](../frontend/src/pages/ProjectSetup.tsx) defines a six-step editor. | Reorganize into the proposed seven steps and verify each field against backend support. |
| Editor drafts | [project_editor.py](../app/api/routes/project_editor.py) provides scoped get/save, version checks, a document size bound, and restricted top-level keys. | Define typed contracts for new records; editor persistence alone does not implement execution semantics. |
| Setup APIs | [catalog.py](../app/api/routes/catalog.py) exposes project setup, YAML validation/save, and connector/capability availability endpoints. | Separate draft, candidate test, and lifecycle activation behavior where required. |
| YAML generation | [projectSetupConfig.ts](../frontend/src/utils/projectSetupConfig.ts) builds project documents, including schedule fields and fallback values. | Verify lossless persistence and remove unsupported/default-generated behavior from runtime claims. |
| Parameters | [parameters.py](../app/api/routes/parameters.py) and [ParameterSettingsPanel.tsx](../frontend/src/components/ParameterSettingsPanel.tsx). | Reuse the existing parameter surface and verify project override coverage. |
| MCP registration | [mcp_import.py](../app/configuration/mcp_import.py) parses MCP definitions and enforces secret-reference inputs. | Verify project registration, platform enablement, runtime discovery, and allowed execution coverage separately. |
| Agent review | [agents.py](../app/api/routes/agents.py) exposes submission, schema, approval, rejection, and revocation; [service.py](../app/configuration/service.py) owns lifecycle behavior. | Integrate these workflows into setup without bypassing approval. |
| File upload and parsing | [files.py](../app/api/routes/files.py) uploads attachments into a chat, creating a chat when omitted; [input parsing](../app/inputs/files.py) defines bounded local extraction and supported formats. | Extend reusable primitives with a durable project artifact library rather than treating chat attachments as project runbooks. |
| Runtime boundaries | [AGENTS.md](../AGENTS.md) identifies read-only Jira/Splunk, disabled database querying, no durable worker/recovery contract, and prohibited code execution. | Treat unsupported providers, durable schedules, and custom scripts according to these explicit constraints. |

## 12. Acceptance criteria

| ID | Scenario and expected result |
|---|---|
| AC-01 | Save an incomplete draft, reload, and recover entered data without changing the active revision. |
| AC-02 | Attempt to alter scope through forms, YAML, or direct API input; the server rejects scope changes and unauthorized references. |
| AC-03 | Activate with missing required metadata or owner; receive errors linked to the relevant fields. |
| AC-04 | Deactivate a referenced environment; receive dependency details and no silently reassigned execution. |
| AC-05 | Configure two instances of one connector type; each environment resolves to the explicitly selected instance in both the table and visualization. |
| AC-06 | Disable a platform connector; the project cannot enable or execute it through saved configuration or direct requests. |
| AC-07 | Add a valid project Jira field; it appears with inherited fields. Conflicting IDs/types fail validation. |
| AC-08 | Build grouped filters and member-based assignee criteria; generated JQL preserves grouping and safely resolves identities, including an empty group. |
| AC-09 | Save custom JQL outside builder support; revisiting or switching modes does not silently rewrite or lose it. |
| AC-10 | Test a query that returns no records; show a successful empty result, distinct from provider failure. |
| AC-11 | Override and reset a parameter; effective values and inheritance match server resolution after reload. |
| AC-12 | Attempt to use an unapproved or revoked custom agent; runtime selection fails. Self-approval and stale-hash approval fail. |
| AC-13 | Test a candidate and subsequently edit a dependency; its affected result becomes stale and cannot satisfy activation checks. |
| AC-14 | Two administrators edit the same version; the second conflicting save/activation fails without losing their local input. |
| AC-15 | Export and validate project YAML; supported configuration is preserved and raw secrets are absent. |
| AC-16 | Fail candidate activation; the prior active revision remains effective and the failure is auditable. |
| AC-17 | In a release without a worker, saved schedules never display as running or show invented next-run/refresh history. |
| AC-18 | With a durable worker implemented, restart during a scheduled job; persisted policy governs retries/recovery without duplicate successful ingestion. |
| AC-19 | Inactivate the project; reject new runs/triggers and preserve historical results under the stated in-flight policy. |
| AC-20 | Navigate all setup steps and mappings by keyboard; errors, statuses, and dependencies remain understandable without color alone. |
| AC-21 | Register a project MCP; tools become selectable only after platform enablement and scope/tool validation. |
| AC-22 | Refresh a data source successfully, then fail a refresh; retain the last successful data and show its actual freshness and failure state. |
| AC-23 | Upload a runbook to the project, reload the library, and access its metadata and content without requiring a chat association. Other project scopes cannot access it. |
| AC-24 | Upload invalid, oversized, macro-bearing, or unextractable files; show a real per-file failure and never mark them Ready for agent use. |
| AC-25 | Upload a new runbook version; new selections use that version while previous runs retain the original hash and source references. Identical re-uploads do not create duplicate searchable versions. |
| AC-26 | Run a capability for an environment; only authorized, relevant Ready artifacts are available and cited sources identify the versions actually used. |
| AC-27 | Archive a required runbook or leave its replacement in Failed state; identify the dependency and prevent activation until a valid Ready selection is made. |

## 13. Delivery dependencies and decisions

Suggested implementation order:

1. Typed project configuration, draft/version lifecycle, metadata, environments, members, and policies.
2. Template-driven connector instances, environment resolution, Jira fields, parameter integration, project runbook/artifact library, and capability readiness.
3. Read-only monitoring/query tests, agent review integration, candidate end-to-end tests, YAML round-trip, and activation.
4. Durable polling, ingestion/data refresh, webhook processing, and notification providers as independently verifiable platform extensions.

Resolve before implementing affected behavior:

- Whether responsibility is single-select or multi-select.
- Allowed categories, priority values, retention choices, and field limits.
- Whether a member may hold multiple business responsibilities; proposed default is yes.
- Project MCP registration authority and how it reaches platform enablement.
- Whether to replace custom scripts with approved capabilities or authorize a separate architecture change.
- Schedule frequency limits, retry/missed-run/concurrency rules, daylight-saving behavior, and webhook-provider scope.
- End-to-end test matrix, freshness window, and acceptable live test inputs.
- Deleted-state restoration and handling of in-flight work during deactivation.

Implementation handoff must run the repository-required `make lint`, `make test`, and `make smoke`, plus focused integration checks for changed behavior. These checks validate implementation; they do not substitute for the product acceptance criteria or establish live model quality.
