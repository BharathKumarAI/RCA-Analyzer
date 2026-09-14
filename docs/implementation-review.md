# Project and connector implementation review

Review date: 13 September 2026. This is an evidence ledger for the implementation, separate from the target requirements. A passing unit suite does not establish that every requested workflow is delivered.

## Acceptance standard

- A user can configure, validate, save, reload, test and activate the same connector instance without re-entering data or changing its identity.
- Connection, authentication, authorization, resource access and data parsing have distinct outcomes. A successful health check does not establish that a query or environment mapping works.
- Displayed environments, credential references, test timestamps, approval state and readiness come from persisted backend records. Absent evidence is displayed as not configured or not tested.
- Project identity comes from authenticated deployment scope. A URL selects a view; it cannot grant access to another project.
- Form fields follow the selected connector, authentication method and environment choice. Unsupported modes cannot appear operational.
- Setup screens put the current task and its primary action first. Detailed policy information, hashes and diagnostics belong in secondary views.
- Tests use isolated servers with explicit test credentials. Test responses must never become product defaults or production evidence.

## Findings and corrections

| Finding | Impact | Correction or acceptance evidence |
| --- | --- | --- |
| Applied migration 014 had been modified | Existing installations fail immutable migration checks | Original migration restored; additive migration 015 expands system names. Verified against the local database checksum and applied without deleting data. |
| Legacy saved templates fail the new schema | Application cannot start | Compatibility reader supplies missing project identity metadata. New publication remains a separate validation boundary. |
| Revised source catalog is absent from the saved deployment | Users see outdated connector names and forms | Updated the local active configuration through the immutable bundle store; preserved previous snapshots and unrelated project configuration. |
| Redaction status previously lacked a runtime-backed preview | UI cannot demonstrate what protection is actually applied | Project policy endpoint and bounded preview use the actual deterministic redaction function. Authentication, bounds and output tested; browser preview confirmed. |
| Upload provenance disappears after refresh | Users lose filename, digest and processing outcomes | Migration 016 persists upload metadata alongside project knowledge. The list API returns the same metadata as upload. |
| MCP project identity is missing | Similar systems cannot be clearly differentiated | Project-only system name, dependency choice, tool environment and active-project environment mappings added. Platform definitions cannot store project identity. Defaults preserve saved custom names. |
| Jira mapping declarations do not affect extraction | Saved fields appear functional without changing evidence | Provider accepts bounded canonical-ID-to-display-name mappings, returns mapped values and reports unavailable fields. Discovery verifies project access; real local TLS transport test covers success and denied access. |
| Unix passphrase input was not wired, and encrypted OpenSSH support was absent | Valid credentials fail despite apparently supported forms | Password and key authentication explicitly select the SSH method; passphrase reaches the provider. AsyncSSH's bcrypt extra is installed. A local SSH test covers password, encrypted key, wrong password and untrusted host-key behavior. PPK conversion remains explicit. |

## Verified lifecycle and review results

| Area | Verified behavior | Evidence |
| --- | --- | --- |
| Saved identity | Draft, test and enable use the same instance, template version and provider configuration. Save-only metadata originally caused a hash mismatch; the browser exposed it and the editor now constructs one shared payload. | [Editor](../frontend/src/components/ConnectorInstanceEditor.tsx), [public API lifecycle tests](../tests/integration/test_connector_lifecycle.py) |
| Activation races | Activation compares the reviewed revision atomically; editing the draft during validation cannot enable its replacement. Archived instances cannot be activated. | [Persistence](../app/persistence/platform_admin.py), [identity regression](../tests/integration/test_connector_identity.py) |
| Names | Case-insensitive duplicate names are rejected within native project connectors; MCP registrations have their own uniqueness check. Cross-catalog uniqueness remains an improvement. | [Persistence](../app/persistence/platform_admin.py), [MCP configuration](../app/configuration/integrations.py) |
| Environment ownership | Save, validate, test, enable and field discovery reject mappings outside active authenticated-project environments. Runtime rejects invalid required bindings. | [Lifecycle API](../app/api/routes/connectors_api.py), [runtime tests](../tests/integration/test_connector_runtime_resolution.py) |
| Scoped reads | Tests construct the selected provider and perform bounded authorized reads. A health-only response cannot satisfy scoped-read validation. | [Candidate testing](../app/connectors/candidate_testing.py), [TLS tests](../tests/integration/test_connector_socket_transport.py), [SSH tests](../tests/integration/test_unix_socket_transport.py) |
| Project navigation | Browser sign-in and direct reload resolve `/p/payments-prod/tools` and `/p/payments-prod/project-setup`; API scope remains authenticated. | [App navigation](../frontend/src/App.tsx), browser review |
| Honest project details | Removed sample field counts and static lookback cards. Instance cards show the saved system name, template separately, and missing configuration explicitly. | [Project Setup](../frontend/src/pages/ProjectSetup.tsx) |
| Accessible layout | Wrapped tabs/actions, named controls, selected-state semantics and collapsed advanced overrides. Browser review confirmed the corrected Tools header at 1280px and 390px widths. | [Tools](../frontend/src/pages/Tools.tsx), [styles](../frontend/src/styles/tools-workspace.css) |

### Validation record

- `make lint`: passed.
- `make test`: **256 passed, 2 skipped, 2 subtests passed**. Existing dependency warnings remain; skips are not successful coverage.
- `make smoke`: **8 passed**.
- Frontend production build: passed; frontend checks: **13 passed**.
- `git diff --check`: passed.
- Browser: created a real isolated project draft, saved it, reopened it, invoked testing, and confirmed missing endpoint/scope/credentials produce failure with enablement blocked. Archived the disposable draft afterward. No customer credentials were used.
- Browser review found defects missed by the automated detector: squeezed header content and a save/test payload mismatch. Both were corrected and rechecked. A clean detector is not design acceptance.

### Design assessment

Two independent reviewers assessed the earlier interface. Assessment A scored **21/40** before final corrections: visibility 2, real-world language 2, control/freedom 3, consistency 2, error prevention 2, recognition 2, efficiency 2, minimalist design 2, recovery 2, help 2. Assessment B found zero automated detector matches but confirmed clipped navigation, unnamed controls and truncation through browser inspection.

The baseline is not a score for the final implementation. The follow-up corrected these findings, made actions readable at desktop width, checked phone width, removed nonfunctional links and reduced instructional copy. A fresh holistic review is still required before calling the design excellent. Novice users still face substantial configuration vocabulary; expert users need a concise revision/test timeline; keyboard users need a complete flow audit beyond individual tab and label checks.

## Scope and evidence limits

- Local TLS mock-server tests establish request, authentication, scope, parsing and error behavior against controlled responses. They do not establish compatibility with a particular customer deployment or production credential set.
- The local deployment remains in demo mode. No configured production Jira, Splunk, Kafka, Unix or Oracle connection has been verified during this review.
- Knowledge uploads currently retain extracted, redacted text and source metadata. Original-file retention, immutable runbook versions, deduplication and automatic retrieval by agents require their own complete implementation and acceptance tests.
- Built-in redaction rules are enforced. Persisted custom redaction patterns are currently metadata; the project view must state this clearly.
- Saved scheduling definitions do not imply a durable scheduler. This release has no durable background-worker or recovery contract.
- Jira-hosted attachment downloading is not implemented. Local attachments remain bounded and authenticated; image processing is OCR only.
- Required connectors with multiple active environment bindings remain blocked at runtime because investigations do not yet have an authenticated environment selector. Testing each mapping does not remove this execution limitation.
- Oracle Thin mode does not use Oracle Client libraries. Thick-mode support must demonstrate the appropriate runtime and local library handling before its form can claim successful operation.

## Improvements to carry forward

Prioritize a complete connector lifecycle over additional catalog decoration. The next strongest improvements are a task-oriented project overview with explicit blockers, a compact test-result timeline tied to configuration revisions, a source-aware field-mapping editor, and a versioned project artifact library with citations back to the exact version used by a run. Each must be backed by persisted records and exercised through the public API and interface.

## Source references

- [Project requirements](project-setup-requirements.md)
- [Connector requirements](connector-template-requirements.md)
- [Connector form specification](connector-forms.md)
- [Redaction API](../app/api/routes/project_redaction.py)
- [Upload API](../app/api/routes/knowledge_uploads.py)
- [MCP registration rules](../app/configuration/integrations.py)
- [Connector lifecycle API](../app/api/routes/connectors_api.py)
- [Jira provider](../app/connectors/providers/jira.py)
- [Isolated TLS transport test](../tests/integration/test_connector_socket_transport.py)
