# Connector Forms — Tool-by-Tool Review

**Status:** Proposed form layouts, not functioning connection forms.  
**Field rules and auth extensions:** [Connector Template Requirements](connector-template-requirements.md)

`*` Required · `○` Optional · `🔒` Inherited/read-only · `[Select…]` Dropdown/reference picker · `[Enter…]` Text input

**Mandatory project-only identity:** every connector instance, including every MCP instance, has these three mandatory identity/environment fields: **System Name**, **Environment Dependent/Independent**, and **Tool Environment**. System Name initially defaults to the selected connector's display name and remains editable; for MCP, use the selected registered MCP connector/server display name. Persist it as a project instance value, not a live inherited setting. The two environment fields require explicit project selection. Other connection/authentication fields may also be mandatory. Incomplete drafts may be saved; testing/enabling requires completed valid values.

Authentication fields change with the selected method. Secret inputs select an authorized **secret reference**, never display a resolved credential. Planned methods stay unavailable until their provider and real connection test are implemented. Every form has the shared header and footer shown below; the tool-specific sections are its middle content.

## Navigation

[Jira](#1-jira) · [Splunk](#2-splunk) · [Confluence](#3-confluence) · [SignalFx](#4-signalfx) · [qTest](#5-qtest) · [GitLab](#6-gitlab) · [Oracle](#7-oracle) · [Kafka](#8-kafka) · [Unix](#9-unix) · [Kubernetes](#10-kubernetes) · [MCP](#11-custom-mcp) · [A2A](#12-a2a)

## Shared form header — appears for every tool

**Connector:** selected tool · **State:** Draft · **Health:** Not tested

`Overview` | `Connection` | `Authentication` | `Environments & scope` | `Fields & operations` | `Data & monitoring` | `Runbooks & artifacts` | `Test & review`

### Overview

| Field | Form control |
|---|---|
| Template / version 🔒 | Selected published template |
| Instance ID 🔒 | Assigned by server |
| System Name * | `[Selected connector name — editable]` |
| Environment Dependent/Independent * | `( ) Environment Dependent  ( ) Environment Independent` — explicit project choice |
| Tool Environment * | `[Select authorized external environment…]` — explicit `Shared` choice for an Independent instance; never automatically filled |
| Owner * | `[Select project member…]` |
| Description ○ | `[Describe what this connection is used for…]` |
| Tags ○ | `[Add tags…]` |
| Usage * | `[ ] Evidence  [ ] Knowledge  [ ] Monitoring` — only supported modes selectable |

Initialize System Name only when creating/selecting a connector for a new instance, preserving any user-edited name. Later catalog renames must not overwrite the saved project name. If the initial name already exists in the project, show an inline duplicate-name error and require a distinguishing edit before testing/enabling; keep the stable instance ID separate.

### Environment mappings — visible for Environment Dependent

| Project Environment * | External Resource * | Tool Environment * | Credential Binding * | Actions |
|---|---|---|---|---|
| `[Select…]` | `[Select authorized resource…]` | `[Select…]` | `[Inherit instance / Select binding…]` | Remove |

**[+ Add environment mapping]**

Each row selects an authorized resource/credential combination. One row's successful connection test does not validate the others. If different environments need different auth methods or adapters, use separate instances.

---

## 1. Jira

### Connection

| Field | Form control |
|---|---|
| Jira connection resource * | `[Select approved Jira site…]` |
| Site base URL 🔒 | Resolved from resource; provider appends the API path |
| API/deployment profile 🔒 | Native adapter profile |
| Browser URL ○ | `[Select approved Jira UI reference…]` |
| Request timeout * | `[Inherited value] seconds` |

### Authentication

**Auth Type *** → `[Basic — Email + API token ▾]`

| Visible field | Form control |
|---|---|
| Credential source * | `( ) Inherit  ( ) Select approved binding` |
| Account email * | `[Enter account email…]` — read-only if inherited |
| API-token secret reference * | `[Select secret reference…]` — read-only if inherited |
| Credential status 🔒 | Not tested |

**Planned alternative:** OAuth 2.0. Selecting it after implementation opens the [OAuth conditional form](#oauth-conditional-form). Password and Bearer fields do not appear for the current Basic API-token profile.

### Environments & scope

| Field | Form control |
|---|---|
| Authorized Jira project * | `[Select deployment-authorized Jira project…]` |
| Issue types ○ | `[Select allowed issue types…]` |
| Member identity mapping ○ | `[Project member] → [Jira account]` — required for member-based queues |

### Fields & operations

**Fields**

| Source | Jira Field ID * | Field Name * | Type * | Available Options | Actions |
|---|---|---|---|---|---|
| Platform 🔒 | Inherited | Inherited | Inherited | Provider metadata | View |
| Project | `[Enter field ID…]` | `[Enter display name…]` | `[Select…]` | `[Provider values…]` | Validate / Remove |

**[+ Add project custom field]** · **[Validate field mappings]**

#### Jira custom-field setup

| Field | Form control / rule |
|---|---|
| Field source 🔒 | Platform inherited or Project added |
| Jira field selector * | `[Select from this Jira instance's verified metadata…]` |
| Jira REST field ID * | `[customfield_<ID>]` — derived from verified selection; manual entry requires validation |
| JQL field reference 🔒 | Corresponding `cf[<ID>]` when supported by the field |
| Field name * | Provider name; optional separate project display label |
| Field type * | Provider-verified text, number, date/time, user, option, multi-option, or supported structured type |
| Options/context 🔒 | Actual issue-type/project context and provider options, where available |
| Use for * | `[ ] Evidence extraction  [ ] Queue filtering  [ ] Semantic mapping` — at least one permitted purpose |
| Semantic target * for mapping | `[Queue / Service / Severity / Environment / Ownership / Registered target ▾]` |
| Missing-value behavior * | `[Allow missing with notice / Require for selected operation ▾]` |
| Processing enabled * | `[Yes / No ▾]` — independent of Jira field existence |

**[Load Jira fields] [+ Add project field] [Validate selected fields] [Preview extraction from test issue]**

Show inherited platform fields and merge project additions by canonical Jira field ID for this connector instance. Reject incompatible redefinitions; a project label must not alter inherited meaning. This setup configures use of existing Jira fields—it does not create or edit fields in Jira. Missing/forbidden metadata is shown explicitly. Preview the real selected values with policy redaction, and feed verified fields/types into the JQL builder.

The existing native provider returns non-null `customfield_*` values from an issue, but verified discovery, configurable extraction/mapping, and queue search require backend extensions. [Jira provider](../app/connectors/providers/jira.py).

#### Jira attachment processing

| Field | Form control / rule |
|---|---|
| Process attachments * | `( ) Disabled  ( ) Enabled` |
| Attachment source * when Enabled | `[Local upload associated with Jira issue / Project library reference ▾]` |
| Jira issue association * | `[Select/enter an issue within this instance's authorized project…]` |
| Files * for Local upload | `[Choose local files…]` |
| Artifact/version * for Library reference | `[Select permitted Ready artifact and version…]` |
| Allowed file types * | `[Select a subset of platform-supported formats…]` |
| Maximum files / file bytes / total bytes * | `[Platform-bounded limits]` |
| Extract text * | Enabled for supported text/document formats |
| Image handling * when images allowed | `[OCR text only]` |
| Parsing deadline / text bounds * | `[Inherited platform bounds or permitted lower limits]` |
| Failure policy * | `[Continue with explicit partial evidence / Fail when required attachment is unusable ▾]` |
| Required evidence * | `[Optional / Required for selected operation ▾]` |
| Capability association ○ | `[Select compatible enabled capabilities…]` |
| Retention / redaction 🔒 | Effective project/platform policy |

**[Validate attachment settings] [Process selected files] [Preview extracted evidence]**

Results show per-file state, name, size, hash, issue/instance association, extraction warnings, truncation, and version/evidence references. No uploaded file means Not run, never successful processing. An attachment is not an executable script or an agent instruction.

**Jira-hosted attachments:** automatic retrieval is a distinct requested extension, not established support. The current Jira provider returns only `attachments_count`; it does not download or parse Jira attachment bytes. Current repository rules permit local attachment processing only. Keep remote retrieval unavailable until explicitly authorized and implemented as a scoped provider operation, with attachment-ID authorization and bounded retrieval—not arbitrary URL fetching. Local files can still be linked to an authorized Jira issue and processed under the form above.

### Data & monitoring

| Field | Form control |
|---|---|
| Queue name * when monitoring | `[Enter queue name…]` |
| Query mode * | `( ) Visual Builder  ( ) Custom JQL` |
| Builder condition * in Builder | `[Field ▾] [Operator ▾] [Value…]` |
| Condition grouping | `[AND / OR ▾]` **[+ Condition] [+ Group]** |
| Assignee source ○ | `[Specific Jira accounts / Project members / Project group ▾]` |
| Generated JQL 🔒 in Builder | Generated from validated conditions; not seeded |
| Custom JQL * in Custom mode | `[Enter scoped JQL…]` |
| Execution capability * for monitoring | `[Select compatible enabled capability…]` |

**[Test query]** — available only when real scoped search is implemented. Scheduling uses the shared footer.

### Test & review

`Test issue key * [Enter an issue in the authorized project…]`

**[Validate form] [Test Jira connection] [Test ticket read]**

Success confirms access to the selected project/issue. It does not confirm automatic queue polling or Jira writes.

---

## 2. Splunk

### Connection

| Field | Form control |
|---|---|
| Splunk resource * | `[Select approved Splunk instance…]` |
| Management API endpoint 🔒 | Resolved API endpoint |
| Browser URL ○ | `[Select approved Splunk UI reference…]` |
| Timeout * | `[Inherited value] seconds` |
| Maximum results * | `[Inherited bounded value] records` |
| Maximum search window * | `[Inherited bounded value] seconds` |

### Authentication

**Auth Type *** → `[Bearer token ▾]`

| Visible field | Form control |
|---|---|
| Credential source * | `[Inherit / Select approved binding ▾]` |
| Token secret reference * | `[Select secret reference…]` |
| Authorization header 🔒 | Generated by provider |

Username/password fields are hidden. OAuth or client-certificate options are planned profiles, not current alternatives.

### Environments & scope

`Authorized index * [Select index…]`

The current native client uses one configured index. Multiple bindings need an implemented instance resolver; a multi-select alone is insufficient.

### Fields & operations / Data & monitoring

| Field | Form control |
|---|---|
| Query name ○ | `[Enter name…]` |
| Search query * | `[Enter supported bounded log query…]` |
| Start time * | `[Date/time picker]` |
| End time / window * | `[Date/time or supported bounded duration]` |
| Execution capability ○ | `[Select compatible capability…]` |
| Use as data source ○ | `[ ] Enable when ingestion backend is available` |

### Test & review

**[Validate form] [Test Splunk connection] [Test bounded search]**

Results show index, actual time range, count, truncation and redacted errors.

---

## 3. Confluence

### Connection

| Field | Form control |
|---|---|
| Confluence resource * | `[Select approved site…]` |
| Wiki API base 🔒 | Resolved provider-compatible base |
| API/deployment profile 🔒 | Selected adapter profile |
| Maximum pages * | `[Inherited bounded value]` |

### Authentication

**Auth Type *** → `[Bearer token ▾]` — implemented adapter contract; deployment compatibility still requires testing.

`Credential source * [Inherit / Select binding ▾]`  
`Token secret reference * [Select…]`

**Planned: Basic API token** → `Account email *`, `API-token secret reference *`.  
**Planned: OAuth 2.0** → [OAuth conditional form](#oauth-conditional-form).

Only the selected supported profile's fields render; none of these methods is silently substituted for another.

### Environments & scope / Fields & operations

| Field | Form control |
|---|---|
| Authorized space ID * | `[Select space…]` |
| Read operation 🔒 | Current pages in selected space |
| Extracted fields 🔒 | Page ID, title, version, body and status |
| Page/label filters ○, planned | `[Available only with implemented filtering…]` |
| Capability associations ○ | `[Select enabled capabilities…]` |

### Data & monitoring

`Knowledge source ○ [ ]` · `Refresh schedule [Unavailable until implemented]`

### Test & review

**[Validate form] [Test Confluence connection] [Read bounded pages]**

Show actual space, page coverage and extraction limits. Macros remain untrusted reference text.

---

## 4. SignalFx

### Connection

`SignalFx API resource * [Select…]`  
`API endpoint 🔒 [Resolved]`  
`Realm ○ [Resolved from approved resource, where applicable]`  
`Timeout * [Inherited value] seconds`

### Authentication

**Auth Type *** → `[API key — X-SF-Token ▾]`

| Visible field | Form control |
|---|---|
| Credential source * | `[Inherit / Select binding ▾]` |
| API-key secret reference * | `[Select…]` |
| Header name 🔒 | `X-SF-Token` |

### Environments & scope / Fields & operations

`Authorized detector ID * [Select…]`  
`Operation 🔒 Read detector definition`  
`Returned fields 🔒 Name, rules, thresholds, tags, last update`

### Data & monitoring

`Definition refresh [Manual; automatic refresh planned]`  
`Live metric streams / alert webhooks [Unavailable in current provider]`

### Test & review

**[Validate form] [Test connection] [Read detector definition]**

Success means detector configuration was retrieved, not that live alert monitoring is active.

---

## 5. qTest

### Connection

`qTest resource * [Select…]`  
`API base / version 🔒 [Resolved]`  
`Timeout * [Inherited value] seconds`  
`Maximum results * [Inherited bounded value]`

### Authentication

**Auth Type *** → `[Bearer token ▾]`

`Credential source * [Inherit / Select binding ▾]`  
`Token secret reference * [Select…]`

Managed username/password token acquisition or OAuth requires a new implemented profile.

### Environments & scope / Fields & operations

`Authorized qTest project * [Select…]`  
`Coverage 🔒 Root-level test runs`  
`Operation 🔒 Read test-run evidence`  
`Capability association ○ [Select…]`

### Data & monitoring

`Data refresh [Manual; scheduling planned]`  
`Recursive folder/release/cycle filters [Planned]`

### Test & review

**[Validate form] [Test connection] [Read root-level test runs]**

Show returned execution metadata and coverage; missing results are unknown, not passed tests.

---

## 6. GitLab

### Connection

`GitLab resource * [Select…]`  
`API base 🔒 [Resolved]`  
`Browser URL ○ [Approved UI reference…]`  
`Maximum deployment records * [Inherited bounded value]`

### Authentication

**Auth Type *** → `[API key — PRIVATE-TOKEN ▾]`

| Visible field | Form control |
|---|---|
| Credential source * | `[Inherit / Select binding ▾]` |
| Token secret reference * | `[Select…]` |
| Header name 🔒 | `PRIVATE-TOKEN` |

OAuth Bearer is a planned separate profile. A different token label must be verified for the same required deployment-read permission.

### Environments & scope / Fields & operations

`Authorized GitLab project * [Select…]`  
`Deployment environment filter ○ [Planned narrowing filter]`  
`Operation 🔒 Read recent deployment records`  
`Returned fields 🔒 Deployment ID, SHA, ref, status, timestamps, environment`

### Data & monitoring

`Refresh [Manual]` · `Deployment webhook [Planned]` · `Execution capability ○ [Select…]`

### Test & review

**[Validate form] [Test connection] [Read recent deployments]**

Source browsing, pipeline execution and deployment changes are not implied operations.

---

## 7. Oracle

**Updated scope:** include local Oracle connection/authentication testing as requested. Production query enablement remains separately controlled; local testing does not create an arbitrary SQL interface.

### Connection

`Database resource * [Select approved resource…]`  
`DSN / service 🔒 [Resolved without credentials]`  
`Connection timeout * [Inherited value] seconds`  
`Query timeout * [Inherited value] seconds`

### Local client setup

| Field | Form control / condition |
|---|---|
| Test execution location * | `[Select approved local backend runtime…]` — the machine running the test, not necessarily the browser |
| Driver profile * | `[Thin / Thick — Oracle Client libraries ▾]` — compatible runtime profiles only |
| Connection format * | `[Host + port + service / Approved DSN / TNS alias ▾]` |
| Host / port / service name * for direct connection | Resolved from selected approved database resource; hidden for alias/DSN mode |
| DSN reference * for DSN mode | `[Select approved connection reference…]` |
| TNS alias * for alias mode | `[Select approved alias…]` |
| Network configuration reference * for alias mode | `[Select configured tnsnames directory/profile…]` |
| `oracle_client_lib` * for explicit-library Thick profile | `[Select registered local Oracle Client library directory…]`; hidden and omitted in Thin mode |
| Client library loading mode * for Thick | `[Registered directory / System-managed library search ▾]` — platform-compatible choices |
| Effective driver mode / driver version 🔒 | Actual backend inspection |
| Loaded client version 🔒 | Actual library version for Thick; Not applicable for Thin |

**Terminology:** python-oracledb Thin mode does not load Oracle Client libraries. If `oracle_client_lib` identifies an Instant Client/native library directory, that is a **Thick** profile. The form covers both; it must not silently switch modes. Driver mode is fixed for the lifetime of a Python process, so tests select compatible runtime profiles rather than changing a shared process per request. [Oracle initialization documentation](https://python-oracledb.readthedocs.io/en/latest/user_guide/initialization.html).

The current provider uses `connect_async`; python-oracledb asyncio is Thin-only. Thick local testing therefore requires a separate bounded synchronous test adapter/runtime path, not the addition of `lib_dir` to the current async call. [Oracle asyncio documentation](https://python-oracledb.readthedocs.io/en/latest/user_guide/asyncio.html).

### Authentication

**Auth Type *** → `[Database username + password ▾]`

`Database username * [Enter / inherit account…]`  
`Password secret reference * [Select…]`

| Planned selection | Required fields shown | Fields hidden |
|---|---|---|
| Managed wallet | Wallet reference *; wallet password * if encrypted/required | Password-account fields unless the implemented wallet profile also requires them |
| External identity | Approved identity profile * | Password and wallet fields |
| TLS client identity overlay | [TLS conditional form](#tls-conditional-form) | Inapplicable certificate formats |

### Environments & scope / Fields & operations

`Authorized evidence username/schema * [Select…]`  
`Operation 🔒 Fixed current-session wait snapshot`  
`Maximum rows * [Inherited bounded value]`

No SQL editor or custom scripts.

### Test & review

**[Validate form] [Check local client setup] [Test local Oracle connection]** · **[Read session snapshot — separately policy gated]**

Local test implementation must verify actual driver mode, library readiness when applicable, target resolution and authentication; record the exact runtime and candidate revision. Missing/incompatible libraries are setup failures, distinct from rejected database credentials. The designed controls are not working until the backend adapter and credential bindings are implemented.

---

## 8. Kafka

### Connection

**Transport *** → `( ) Native Kafka  ( ) Approved MCP`

| Native Kafka field | Form control |
|---|---|
| Cluster resource * | `[Select approved Kafka cluster…]` |
| Bootstrap servers 🔒 | Resolved from cluster resource |
| Security protocol 🔒 | `SASL_SSL` for current native profile |
| CA trust reference | `[System trust / Approved CA ▾]` |
| CA bundle * for Approved CA | `[Select managed CA…]` |
| Timeout * | `[Inherited value] seconds` |

MCP transport replaces native connection/auth fields with the [MCP form](#11-custom-mcp).

### Authentication

**Auth Type *** → `[SASL SCRAM over TLS ▾]`

`Mechanism 🔒 SCRAM-SHA-512`  
`Username * [Enter / inherit…]`  
`Password secret reference * [Select…]`

| Planned mechanism | Conditional form |
|---|---|
| SCRAM-SHA-256 / PLAIN | Username *; password reference *; approved TLS * |
| OAUTHBEARER | Approved OAuth profile *; provider/grant-specific fields; username/password hidden |
| GSSAPI | Identity profile *; principal/realm/service identity *; keytab reference * when keytab mode |

### Environments & scope / Fields & operations

`Authorized topic scope 🔒 [Server-approved topic set]`  
`Operation 🔒 Describe topic partitions`  
`Maximum partitions returned * [Inherited bounded value]`

### Topic filters

| Field | Form control / condition |
|---|---|
| Topic selection mode * | `( ) Select topics  ( ) Filter topic names` |
| Selected topics * for Select topics | `[Multi-select from authorized topics…]` |
| Include filters * for Filter names | `[Equals / Starts with / Contains / Glob ▾] [Value…]` **[+ Include filter]** |
| Exclude filters ○ | `[Equals / Starts with / Contains / Glob ▾] [Value…]` **[+ Exclude filter]** |
| Maximum matched topics * | `[Platform-bounded count]` |
| Matching topics 🔒 | Actual authorized preview after testing |
| Selection refresh policy * | `[Resolve current authorized matches at each execution]` |

**[Preview matching topics] [Test filtered metadata read]**

Filters match **topic names**, not message content. Include rows combine with OR; exclusions take precedence. Glob supports a defined bounded `*`/`?` grammar, not executable expressions or unrestricted regex. The result is always intersected with the server-approved topic set. Zero matches is a valid empty result; it never falls back to all topics. Over-limit results require narrowing and are not silently truncated into an active selection. Native code currently reads one topic, so multi-topic discovery/filtering and bounded fan-out are explicit implementation work.

### Data & monitoring

`Metadata refresh [Manual]` · `Consumer lag / message consumption [Not supplied by native provider]`

### Test & review

**[Validate form] [Test Kafka connection] [Preview matching topics] [Describe matched authorized topics]**

No message publication, consumption, offset commits or consumer-group changes during testing.

---

## 9. Unix

**Connector type:** Unix (`unix`). **System Name:** user-defined; Tuxedo may be entered here when that is the system being accessed. It is not a separate connector type or auth method.

### Connection

**Transport *** → `( ) SFTP  ( ) Approved MCP`

`Host resource * [Select approved host…]`  
`Host / port 🔒 [Resolved]`  
`Connection timeout * [Inherited value] seconds`

`Connection profile * [Standard SSH/SFTP / PuTTY-compatible SSH ▾]`

PuTTY-compatible is the user-facing connection profile. Its underlying SSH authentication remains password or public key; PuTTY itself is a client, not an authentication protocol. See [PuTTY public-key authentication](https://www.puttyssh.org/0.83/htmldoc/Chapter8.html).

### Authentication

**Auth Type *** → `[SSH private key ▾]`

| Visible field | Form control |
|---|---|
| Username * | `[Enter / inherit…]` |
| Private-key reference * | `[Select managed key…]` |
| Known-hosts reference * | `[Select approved host trust…]` |
| Key passphrase * if encrypted | `[Select secret…]` — encrypted-key support must be implemented first |

| Planned selection | Fields shown |
|---|---|
| SSH password | Username *; password reference *; known-hosts reference *; key fields hidden |
| SSH certificate | Username *; private-key reference *; SSH certificate reference *; known-hosts reference *; passphrase conditional |

### PuTTY-compatible authentication form

Render when Connection profile = PuTTY-compatible SSH. This requested profile requires backend support before becoming selectable as a working connection.

| Field | Form control / condition |
|---|---|
| PuTTY session label ○ | `[Enter session label…]` — descriptive only; does not execute/import registry sessions |
| Host / port * | Resolved approved host and SSH port |
| Login username * | `[Enter / inherit username…]` |
| Authentication method * | `[Password / PuTTY private key (.ppk) ▾]` |
| Password secret reference * for Password | `[Select…]`; hidden for PPK |
| PPK private-key reference * for PPK | `[Select managed PuTTY key…]`; hidden for Password |
| PPK version / encryption 🔒 | Inspected by the credential service; unsupported formats fail validation |
| Key passphrase reference * for encrypted PPK | `[Select…]`; hidden when unencrypted |
| Host trust reference * | `[Select approved known-hosts / verified host-key binding…]` |
| Expected host-key fingerprint 🔒 | Derived from the approved trust binding |
| Timeout * | `[Inherited bounded value] seconds` |

**[Validate PuTTY profile] [Test SSH authentication] [Test approved SFTP read]**

The backend must support the chosen PPK format directly or use a vetted managed conversion during credential onboarding; it cannot pass an unsupported PPK file as though it were an OpenSSH key. No dependency on a user's desktop PuTTY window, Pageant session, saved password, or arbitrary command is implied. Host-key changes fail verification until the approved trust binding is updated.

### Environments & scope / Fields & operations

`Approved absolute log path * [Select deployment-authorized file…]`  
`Maximum tail bytes * [Inherited bounded value]`  
`Operation 🔒 Read bounded log tail`

### Data & monitoring

`Refresh [Manual]` · `Scheduled tailing / rotation tracking [Planned]`

### Test & review

**[Validate form] [Test SFTP connection] [Read approved log tail]**

No command/script field. A System Name such as Tuxedo does not add process administration operations to the Unix connector.

---

## 10. Kubernetes

### Connection

`Cluster resource * [Select approved cluster…]`  
`API endpoint 🔒 [Resolved]`  
`Server trust * [System / Approved CA ▾]`  
`CA bundle reference * if Approved CA [Select…]`  
`Timeout * [Inherited value] seconds`

### Authentication

**Auth Type *** → `[Service-account token ▾]`

`Token secret reference * [Select…]`  
`Token expiry 🔒 [Known expiry or Unknown]`

| Planned selection | Fields shown |
|---|---|
| Workload identity | Approved deployment identity profile *; audience/resource conditional; static-token field hidden |
| Client certificate | Managed certificate/key or bundle fields from the [TLS form](#tls-conditional-form) |

### Environments & scope / Fields & operations

`Authorized namespace * [Select…]`  
`Operation 🔒 List pod status`  
`Maximum pods * [Inherited bounded value]`  
`Label selectors ○ [Planned filtering extension]`

### Data & monitoring

`Status refresh [Manual]` · `Watch / automatic polling [Planned]`

### Test & review

**[Validate form] [Test cluster connection] [Read namespace pod status]**

No secret reads, workload modifications, executable kubeconfig helpers or container exec.

---

## 11. Custom MCP

### Project identity — required when adding MCP

| Field | Form control |
|---|---|
| System Name * | `[Selected MCP connector/server name — editable]` |
| Environment Dependent/Independent * | `( ) Environment Dependent  ( ) Environment Independent` |
| Tool Environment * | `[Select authorized tool environment / Explicit Shared…]` |

These are the shared header fields repeated here for visibility, not a second set of stored values. The selected registered connector/server name initializes System Name; it remains editable and project-owned. Multiple project instances may reference the same approved MCP registration and require distinct System Names and stable instance IDs. Environment fields still require explicit selection.

### Connection

| Field | Form control |
|---|---|
| Integration reference * | `[Select authorized registration…]` |
| Transport * | `[Streamable HTTP / SSE / Approved stdio profile ▾]` — runtime/policy availability applies |
| HTTPS endpoint * for HTTP/SSE | `[Resolved approved resource]` |
| Executable profile * for stdio | `[Platform-approved reference]` — no unrestricted project command entry |
| Timeout * | `[Inherited bounded value] seconds` |

Existing stdio registration does not authorize adding project code execution under current release rules.

### Authentication

**Auth Type *** → `[None / Bearer token ▾]` for compatible registered HTTP/SSE profiles.

| Selection | Visible fields |
|---|---|
| None | Platform permission 🔒; credential fields hidden |
| Bearer | Token secret reference * |
| Approved stdio environment | Environment variable name 🔒; authorized `env://` reference * for every required variable; HTTP auth fields hidden |
| OAuth / mTLS, planned | Respective conditional form after implementation |

None at registration does not guarantee unauthenticated evidence-runtime support; validate the selected approved operation's requirements.

### Environments & scope / Fields & operations

| Field | Form control |
|---|---|
| Authorized resource scope * | `[Select…]` |
| Discovered tools 🔒 | Real discovery output; empty until tested |
| Platform operation * | `[Select permitted operation…]` |
| Approved tool binding * | `[Select approved exact tool…]` |
| Project tool label 🔒 | `System Name / Discovered tool name` |
| Input mapping * where required | `[Source field] → [Allowed argument]` |
| Fixed scope argument 🔒 | Server-owned binding |
| Response schema / bounds 🔒 | Published operation contract |

### Data & monitoring

`Available modes 🔒 Derived from approved operation support` — discovery does not establish scheduling or ingestion.

### Test & review

**[Validate registration] [Test protocol connection] [Discover tools] [Test approved read]**

Discovery and invocation are separate actions. Newly discovered tools require policy validation and approved bindings before execution.

Group discovered tools under their project System Name. Display System Name, Tool Environment and tool name in selectors, previews, test results and run provenance. Use instance ID + binding ID + exact remote tool name for execution identity; display names cannot grant scope, collide across servers or change tool permissions. Renaming System Name changes presentation only and preserves historic instance references.

---

## 12. A2A

### Connection

`Integration reference * [Select authorized registration…]`  
`Transport * [A2A JSON-RPC / A2A REST ▾]`  
`HTTPS endpoint 🔒 [Approved resource]`  
`Timeout * [Inherited bounded value] seconds`

### Authentication

**Auth Type *** → `[None / Bearer token ▾]`

`None → Platform permission 🔒; credential fields hidden`  
`Bearer → Token secret reference * [Select…]`

OAuth, mTLS and workload identity are planned profiles with their complete conditional forms, not generic token aliases.

### Environments & scope / Fields & operations

`Approved external agent * [Select…]`  
`Environment binding * [Select…]`  
`Allowed skill IDs * for future execution [Select approved skills…]`  
`Data-sharing policy * for future execution [Select approved policy…]`  
`Request/response schema 🔒 [Published contract]`  
`Maximum payload / deadline * [Platform-bounded values]`

### Data & monitoring

`Automatic execution [Unavailable until approved adapter and worker support exist]`

### Test & review

**[Validate registration]** · **[Test protocol — requires implemented adapter]** · **[Test approved task — requires execution contract]**

Registration alone does not authorize remote delegation or transmission of project files.

---

## Shared conditional forms

### OAuth conditional form

Render inside the selected tool's Authentication tab only when its OAuth profile is implemented.

| Field | Form control / conditional rule |
|---|---|
| Provider profile * | `[Select approved identity provider…]` |
| Grant type * | `[Client Credentials / Authorization Code + PKCE / Device Authorization ▾]` — supported choices only |
| Client ID * | `[Enter / inherit registered client ID…]` |
| Client authentication * | `[None / Secret Basic / Secret Post / Private Key JWT / mTLS ▾]` — compatible choices only |
| Client secret * for Secret Basic/Post | `[Select secret reference…]`; hidden for None/key/cert modes |
| Assertion key * for Private Key JWT | `[Select signing key…]`; algorithm/key ID follow provider-required rules |
| Client certificate identity * for mTLS | `[Select managed identity…]`; renders TLS identity fields |
| Authorization/token/device endpoint 🔒 | Approved provider endpoints; only relevant endpoints visible |
| Redirect URI 🔒 for Authorization Code | Server-owned registered callback |
| Scopes * when provider requires | `[Select allowed scopes…]` |
| Audience/resource | `[Select…]`; required only when provider profile specifies |
| Connected identity 🔒 | Not connected / actual acquired identity |
| Token expiry/refresh state 🔒 | Actual backend lifecycle status, not entered token text |

**[Connect account]** for consent-based grants · **[Acquire token & test]** for Client Credentials · **[Reconnect]** when required

No manual refresh-token field. Provider-issued access/refresh credentials remain backend-managed.

### TLS conditional form

Render as transport security independently of application auth, so a connector can require both mTLS and Bearer/OAuth/Basic.

| Field | Form control / conditional rule |
|---|---|
| Server trust * | `[System trust / Approved CA ▾]` |
| CA bundle * if Approved CA | `[Select managed trust reference…]` |
| Client identity format * when mTLS selected | `[PEM pair / PKCS#12 bundle ▾]` — implemented choices only |
| Certificate reference * for PEM | `[Select…]` |
| Private-key reference * for PEM | `[Select…]` |
| Bundle reference * for PKCS#12 | `[Select…]`; PEM fields hidden |
| Key/bundle password * when encrypted | `[Select secret reference…]` |
| Certificate subject / expiry 🔒 | Real inspected metadata |
| Hostname verification 🔒 | Enforced |

---

## Shared form footer — appears for every tool

### Data & monitoring: execution settings

Visible only for supported operations. Scheduling fields may be saved as proposed draft settings, but automatic execution remains unavailable until the backend exists.

| Field | Form control |
|---|---|
| Trigger * when enabled | `( ) Manual  ( ) Polling  ( ) Webhook` — unavailable modes labeled |
| Frequency * for interval polling | `[Value] [Minutes / Hours ▾]` |
| Cron * for cron polling | `[Enter validated cron…]` — alternative to interval |
| Timezone * for schedule | `[Select IANA timezone…]` |
| Webhook signing reference * for verified webhook | `[Select provider-compatible secret reference…]` |
| Webhook destination 🔒 | Backend-managed endpoint when implemented |
| Execution capability * for automated analysis | `[Select compatible capability…]` |
| Next run / last success 🔒 | Actual scheduler records, otherwise Not scheduled / Never run |

### Runbooks & artifacts

**[Upload local files] [Select from project library]**

| Field | Form control |
|---|---|
| Artifact title * for upload | `[Enter title…]` |
| Type * | `[Runbook / Supporting artifact ▾]` |
| File * for upload | `[Choose local file…]` |
| Existing artifact * for selection | `[Select Ready artifact…]` |
| Version * | `[Select version…]` / generated for new upload |
| Environment association * | `[All permitted / Selected environments ▾]` |
| Connector association 🔒 | This instance |
| Capability association ○ | `[Select…]` |
| Owner * | `[Select project member…]` |
| Description / tags ○ | `[Enter…]` |

Show the uploaded/selected records below the form with actual processing state. Credentials, keys and certificate bundles belong in managed credential bindings, not the runbook library.

### Test & review: result panel

**[Validate form] [Test selected environment] [Test all configured environments] [View redacted YAML] [Save draft] [Enable]**

| Check | Result before testing |
|---|---|
| Required fields and conditional rules | Not run |
| Selected destination and TLS/host trust | Not run |
| Credential resolution / acquisition | Not run |
| Authentication | Not run |
| Scoped permissions | Not run |
| Selected read operation and response schema | Not run |
| Environment coverage | Not run |

After testing, replace these states with actual results: Passed, Failed, Partial, Not applicable, or Not independently verified. Include candidate revision/hash, environment, operation, UTC time, duration, count/coverage, safe error details and test reference.

**Enable rule:** all required fields valid, platform permission present, approved operation implemented, and a fresh successful scoped test for each required binding. Testing current unsaved values must not change the active configuration. A passing connection test does not prove scheduling or end-to-end agent execution.

## Review checklist

- Does each tool expose the right connection target, scope and operations?
- Does every offered auth selection show all required credential fields and hide irrelevant ones?
- Can each supported choice run a real candidate connection and scoped-read test?
- Are inherited values and authorized project overrides clear?
- Are environment-specific credentials and test results independent?
- Are runbook references reusable and versioned?
- Are unavailable provider/auth/scheduler features visibly distinguished from working choices?

These forms are the visual field layout companion to the [full template contract](connector-template-requirements.md), which defines extension profiles such as Kerberos, workload identity and signed requests, and the detailed schema/test acceptance criteria.
