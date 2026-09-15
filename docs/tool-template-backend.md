# Shared tool template parameters

See [Connector form and harness contract](connector-redesign.md) for the current form redesign and explicit remaining specification boundaries. Earlier frontend recommendations below describe the preceding implementation stage.

The [template parameter API](../app/api/routes/parameters.py) exposes `GET /api/v1/parameters?view=template` to platform administrators. It returns fields explicitly marked `template_editable: true` in published connector definitions, including connector-specific labels and bounds. The bundled declarations expose timeouts, Splunk response/result/window bounds, Jira field mapping, attachment-processing mode and custom JQL. Instance URLs, credentials, resource identifiers and environment bindings are excluded.

The [parameter store](../app/configuration/parameters.py) reads shared defaults without joining a selected project's overrides. Template rows omit tenant/project identity and override values. Save through the existing `PUT /api/v1/parameters/{tool}/{name}/definition` endpoint with `expected_revision`. Type validation, administrator authorization, audit recording, durable storage and conflict responses remain in that path.

The [connector catalog API](../app/api/routes/connectors_api.py) includes `shared_parameters` in template list/detail responses for platform administrators, sourced from the same parameter records. These are mutable shared defaults, separate from the immutable, versioned template definition and its checksum. Do not submit `shared_parameters` as part of a versioned template definition.

[The Jira template](../blob_local/platform/config/connector_templates.yaml) declares an empty custom JQL default. The backend accepts at most 4096 characters and rejects non-text/control characters. This is saved configuration, not a JQL parser or a queue execution API. Queue search and scheduled polling are not enabled. Jira-hosted attachment downloads and mutations remain unavailable.

## Atomic save for the existing form

`PUT /api/v1/parameters/{tool}/template` accepts a bounded `changes` object. Each key is a declared shared parameter name and each value contains `value` and `expected_revision`. The [parameter store](../app/configuration/parameters.py) uses one SQLAlchemy transaction for all values and audit entries, reusing the single-field validation path. Any invalid value or revision conflict rolls back the entire form. Unknown controls and instance fields are rejected. Template saves cannot modify parameter types, authorization policy, or ownership.

Jira custom field mappings use the [provider's validator](../app/connectors/providers/jira.py) before persistence: canonical field IDs, nonempty display names, at most 100 entries and unique display names. Saving a mapping does not assert that the field exists on Jira; use the existing scoped discovery endpoint for that.

## Frontend recommendations (not implemented)

- Preserve the existing layout, navigation, sections, buttons, and input elements. Replace hardcoded values with the template catalog and `shared_parameters`, or the template parameter view. No page redesign or replacement editor is needed.
- Remove project/environment selectors, owners, groups, invented connection status, OAuth URLs, cache/webhook switches and write permissions from template editing.
- Map the existing timeout, result-limit, field-mapping and query inputs to `timeout_seconds`, `max_results`, `custom_field_mapping` and `custom_jql`. Keep the existing input elements. Expose only supported authentication profiles as descriptive metadata.
- Connect the existing Save button to the atomic template endpoint with changed values and their revisions. Display API errors, preserve unsaved edits on failure, and refresh both views after success. Never swallow failed saves or show a successful connection test without a real result.
- Keep instance endpoints, credentials and resource bindings in the existing connector-instance editor. Label custom JQL as saved configuration until a scoped search API is implemented.

[Integration coverage](../tests/integration/test_template_parameter_sync.py) checks authorization, field exclusion, save conflicts, JQL bounds, persistence after restart, override isolation and equality between catalog and parameter responses.

Atomic-save coverage also verifies whole-form rollback on invalid values and stale revisions, administrator-only writes and rejection of instance-only fields. The Tools page environment dropdown and Environment Overrides block have been removed, including their hardcoded environment defaults and inaccurate automatic-scoping claim. Field discovery uses backend binding resolution; an ambiguous binding returns an error. Other frontend elements and styling are preserved.


## Multiple configuration scenarios

[Connector field contracts](../app/configuration/models.py) now declare shared editability, numeric minimum/maximum and string length limits. Shared fields must have nonsecret, non-null static defaults and shared ownership. Instance-only or credential fields cannot opt into the template form. Constraints apply to atomic saves and individual definition/override API edits in [parameters.py](../app/api/routes/parameters.py).

[Catalog resolution](../app/configuration/connector_catalog.py) merges bundled and database templates by identity/version. Persisted lifecycle records override their bundled counterpart. Drafts, retired and deprecated versions are excluded from active shared defaults; publication checks compatible shared contracts and existing stored defaults before activation. Published versions share parameter records by system/name, so incompatible types, bounds, override permissions or allowed values require an explicit migration rather than silent coexistence. Creating a template does not register a new executable provider.

| Scenario | Backend behavior |
| --- | --- |
| New connector-specific shared control | Declare a typed, shared field in the template; no Python UI allowlist change is required. |
| Several compatible published versions | Reuse shared definitions without duplicate parameter rows. Catalog responses include only fields declared on that version. |
| Draft or deprecated version | Excluded from active template edits; existing records are retained. |
| Invalid field or stale revision in a multi-field save | Roll back all value and audit writes in the transaction. |
| Project override and saved instance value | For supported runtime controls, permitted instance values take precedence over resolved project/platform defaults. |
| Disabled or platform-locked control | Reject invalid runtime use; do not silently bypass policy. |
| Multiple enabled instances or ambiguous environment bindings | Continue to reject execution until an authenticated selection contract exists. No environment is guessed. |

[The runner](../app/runtime/runner.py) resolves published templates and parameter values for saved managed instances on each run. [Parameter resolution](../app/configuration/parameters.py) merges only supported safe runtime controls, without modifying endpoints, credentials, resource scope or environment bindings. [Provider construction](../app/connectors/providers/registry.py) now forwards Splunk window/response limits as well as result count and timeout. Existing explicit instance values remain authoritative when overrides are permitted. Deployed native clients are reconstructed for subsequent runs from shared operational controls without mutating active clients; explicitly injected clients remain caller-owned. See the [Harness configuration contract](harness-configuration-backend.md) for project-template application and synchronized provenance.

Custom JQL remains configuration-only; automatic polling, queue execution, arbitrary provider code, database querying and automatic selection across multiple instances are not introduced.


## Dynamic JQL preview

The [connector API](../app/api/routes/connectors_api.py) exposes:

- `GET /api/v1/projects/{project_id}/connectors/{instance_id}/fields?include_schema=true`: existing field discovery plus supported query fields, value types, operators and sorting metadata.
- `POST /api/v1/projects/{project_id}/connectors/{instance_id}/jql/preview`: accepts `filters` (field ID, operator, value), `match` (`all` or `any`) and optional `order_by` (field ID and ASC/DESC). An optional `environment_id` query parameter must select an existing authorized binding; ambiguity is rejected.

The [typed compiler](../app/connectors/jql.py) supports a conservative subset of Jira field types: text, choices, numbers, dates and datetimes. Custom field IDs become `cf[id]` references. Text searches use literal phrases; values are quoted and escaped. ALL/ANY clauses stay inside a mandatory project restriction taken from the resolved provider, never from request-body scope. Unknown fields, mismatched operators/types, control characters and oversized queries are rejected. Bounds: 30 filters, 50 list values per filter, 3 sort fields, 512 characters per input string, and 4096 characters for generated JQL. Empty filters return only the authorized project restriction.

The [Jira provider](../app/connectors/providers/jira.py) verifies project access, fetches field schemas and Jira's JQL operator reference, then submits generated queries to `/rest/api/2/jql/parse?validation=strict`. A successful preview returns `validation: jira_strict` and `execution_enabled: false`. Unsupported metadata/parser APIs, timeouts and Jira validation failures return errors. It does not search issues, persist queries, enable connectors or write to Jira. Dates without a timezone follow Jira's configured timezone. Unsupported plugin field types and JQL functions are not guessed.

Keep reusable filter definitions separate from a resolved query: generated JQL includes an instance-specific project restriction and must not become a platform-wide default. Frontend wiring is separate; this change adds no UI elements.

References: [Atlassian JQL reference and parser APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-jql/), [JQL operators](https://support.atlassian.com/jira-service-management-cloud/docs/jql-operators/). Regression coverage: [compiler tests](../tests/unit/test_jql.py) and [scoped API integration tests](../tests/integration/test_connector_lifecycle.py).
