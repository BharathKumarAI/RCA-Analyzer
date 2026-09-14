# Connector Templates — Review Document

**Status:** Proposed requirements for review  
**Date:** September 13, 2026  
**Related document:** [Project Setup Requirements](project-setup-requirements.md)

## 1. Purpose and reading guide

Define a consistent, extensible connector setup experience: platform administrators publish templates; authorized project administrators configure instances using those templates; the runtime receives only validated, permitted settings and tools.

This document covers all ten connector types in the repository catalog, plus reusable MCP and A2A integration templates. Authentication is a first-class configuration area. Runbooks, environment mappings, data refresh, monitoring, and capability associations use shared sections across connectors.

Markdown does not provide interactive tabs. The navigation links and `Sub-tab` headings below represent the proposed application tabs and their contents. Tables specify field types, requiredness, ownership, conditional visibility, and runtime limits.

**Notation:** R = required; C = conditionally required; O = optional. Requiredness applies before enabling an instance, except where stated otherwise. “Proposed” means new behavior, not a working feature. “Provider implemented” means source code exists, not that a deployment is connected or healthy.

## 2. Navigation and connector inventory

**Platform → Connectors → Templates → Selected template**

`Definition` · `Connection schema` · `Authentication profiles` · `Scope & operations` · `Project form` · `Validation & versions`

**Project → Connectors & Tools → Selected instance**

`Overview` · `Connection` · `Authentication` · `Environments & scope` · `Fields & operations` · `Data & monitoring` · `Runbooks & artifacts` · `Test & review`

| Connector template | ID | Code/configuration status | Template section |
|---|---|---|---|
| Jira | `itsm` | Native read-only provider; enabled in checked-in runtime configuration. Live health requires a real probe. | [Jira](#6-jira-template) |
| Splunk | `log_search` | Native bounded log provider; enabled in checked-in runtime configuration. | [Splunk](#7-splunk-template) |
| Confluence | `confluence` | Scoped page provider implemented; disabled in checked-in configuration. | [Confluence](#8-confluence-template) |
| SignalFx | `signalfx` | Detector-definition provider implemented; disabled. | [SignalFx](#9-signalfx-template) |
| qTest | `qtest` | Root-level test-run provider implemented; disabled. | [qTest](#10-qtest-template) |
| GitLab | `gitlab` | Deployment-history provider implemented; disabled. | [GitLab](#11-gitlab-template) |
| Oracle | `oracle` | Fixed session-query provider exists; disabled. Local connection/auth testing is requested; production query activation remains separate. | [Oracle](#12-oracle-template) |
| Kafka | `kafka` | Native partition metadata provider implemented; disabled. Approved MCP bindings are a separate path. | [Kafka](#13-kafka-template) |
| Unix | `unix` | Native scoped SFTP log-tail provider implemented; disabled. PuTTY-compatible authentication is requested; Tuxedo is an instance System Name only. | [Unix](#14-unix-template) |
| Kubernetes | `kubernetes` | Namespace pod-status provider implemented; disabled. | [Kubernetes](#15-kubernetes-template) |
| Custom MCP | integration kind `mcp` | Registration and probe/binding code exists; registration alone does not activate arbitrary tools. | [MCP](#16-custom-mcp-template) |
| A2A | integration kind `a2a` | Registration schema exists; autonomous remote delegation is not established by this document. | [A2A](#17-a2a-template) |

Inventory sources: [template catalog](../blob_local/platform/config/connector_templates.yaml), [runtime configuration](../blob_local/platform/config/connectors.yaml), [provider registry](../app/connectors/providers/registry.py), [integration definitions](../app/configuration/integrations.py). Checked-in enablement is not evidence of current production connectivity.

## 3. Platform template contract

### Sub-tab: Definition

| Field | Type / requirement | Coverage |
|---|---|---|
| Template ID | Identifier / R | Stable connector type; preserve existing IDs. |
| Template version | Version / R | Immutable published schema and behavior contract. |
| Display name, description, category | Text / R | Catalog identity and supported use cases. |
| Integration kind | Enum / R | Native, MCP, or A2A; constrains transports and runtime adapter. |
| Provider adapter ID | Registry reference / R | Existing implemented adapter, never a dynamic module path supplied by a project. |
| Availability | Enum / R | Draft, Published, Deprecated, Retired; separate from platform-enabled state. |
| Platform enabled | Boolean / R | Hard prerequisite for project use. |
| Supported operations | Registered operation references / R | Concrete read/test capabilities, not marketing descriptions. |
| Known limitations | Text list / R | Coverage, pagination, truncation, disabled actions, and unsupported runtime features. |

### Sub-tab: Connection schema

Each field definition declares `key`, `label`, `description`, `type`, `required_when`, `default`, `validation`, `options_source`, `visibility_condition`, `ownership`, `sensitivity`, and `runtime_binding`.

- Types include text, integer, decimal, boolean, enum, multi-select, duration, URL, resource reference, secret reference, and repeatable typed records.
- Conditions use a bounded declarative rule vocabulary such as equality, membership, all, and any. No JavaScript, Python, templates with executable expressions, or arbitrary validation code in YAML.
- Defaults must be operationally safe and semantically valid. Placeholder URLs, example Jira project keys, demonstration indexes, and sample service users are help text, never connection values.
- Declare units explicitly: seconds, bytes, records, requests/minute. Retry/rate fields appear only when the runtime actually enforces them.
- A network target is a platform-approved deployment resource. Project forms select authorized resource references; they do not grant arbitrary destinations by accepting a URL.

### Sub-tab: Authentication profiles

- Declare permitted auth profile IDs, a default only when unambiguous, transport compatibility, conditional credential fields, and the provider implementation supporting each profile.
- An extensible platform auth registry does not make every auth method available on every connector.
- Provider-specific header names and token prefixes are template-owned. Users select a credential reference, not arbitrary headers containing credentials.
- Distinguish **configurable now**, **implemented but disabled**, and **proposed**. Never silently substitute Basic, Bearer, or an API-key header.

### Sub-tab: Scope & operations

Declare resource types, server-side authorization rules, allowed narrowing filters, operation IDs, typed inputs/outputs, bounds, evidence metadata, and the health/test strategy.

Project-selected resources must remain within deployment-authorized resources. A role, tenant, project, namespace, topic, index, or external project identifier entered in a request is never sufficient authorization by itself.

### Sub-tab: Project form

Declare the shared sub-tabs below and connector-specific sections. Mark each field:

| Ownership | Project behavior |
|---|---|
| Platform locked | Display inherited value and lock reason. |
| Project override allowed | Display effective value and source; allow override/reset within constraints. |
| Project only | Require project input or selection; no invented platform instance value. |
| Derived | Read-only result from validated configuration or a live probe. |
| Secret reference | Authorized reference picker; no resolved secret in the form. |

### Sub-tab: Validation & versions

- Validate schema, adapter/auth compatibility, reference integrity, and policy before publishing.
- Pin project instances to a published template version. Preview an upgrade diff before migrating; do not silently rewrite active instances.
- Compare semantic versions: additive optional fields can be compatible; new required fields, changed auth, renamed keys, or changed scope semantics require migration.
- Preserve a last-known active revision when draft validation or migration fails. Retired templates block new instances; existing use follows an explicit platform retirement policy.
- Use expected-version/hash checks for template, instance, credential-binding metadata, and activation changes.

## 4. Shared project sub-tabs and fields

These fields apply to **every connector**. Connector sections add to this contract rather than duplicating it.

**Confirmed requirement:** System Name, Environment Dependent/Independent, and Tool Environment are mandatory **project-only values for every instance**, including MCP and A2A. System Name defaults initially to the selected connector display name; for registered integrations, use the selected connector/server display name. Users may edit it. Persist the result on the project instance rather than continuously inheriting platform names. Initialize only for a new instance without a user-edited name; later catalog changes must not overwrite it. Reject duplicate project names with a distinguishing-edit prompt before testing/enabling. Environment fields require explicit selection; Shared is an explicit choice, not a fallback. Other connection/authentication fields may also be mandatory. Incomplete draft save remains supported.

### Sub-tab: Overview

| Field | Type / requirement | Coverage and ownership |
|---|---|---|
| Instance ID | Generated identifier / R | Stable instance identity, server-derived. |
| Template / version | Published template reference / R | Read-only after selection except a deliberate upgrade. |
| **System Name** | Text / R | Defaults to connector display name; editable, project-owned and unique within the project. Separate from stable connector/instance IDs. |
| **Environment Dependent/Independent** | Enum / R | Explicit project-only choice controlling mappings; no inherited default. |
| **Tool Environment** | Authorized reference or Shared / R | Explicit project-only selection; dependent instances use external-environment mappings, independent instances explicitly select Shared. |
| Description, tags | Text / O | Searchable project context. |
| Owner | Project member reference / R | Operational contact; does not grant an authorization role. |
| Instance state | Controlled enum / R | Draft, Enabled, Disabled, Archived. Health is a separate value. |
| Usage | Multi-select / R | Evidence source, monitoring source, knowledge source, or approved external integration; options depend on operations. |

### Sub-tab: Connection

| Field | Type / requirement | Coverage |
|---|---|---|
| Connection resource | Authorized deployment resource reference / R | Resolves endpoint, host/port, or broker list using the chosen adapter. |
| Protocol / transport | Template enum / R | Only implemented combinations are selectable. |
| API base / UI base | Derived URL / C and O | Distinguish API root from human links; provider defines path construction. |
| Request timeout | Duration / R | Effective value bounded by provider and platform limits. |
| Response/result bounds | Integer / R where supported | Bytes and records; most restrictive applicable bound wins. |
| CA trust reference | Managed trust reference / C | Custom server trust where needed and supported; not an auth credential. |
| Proxy reference | Approved network profile / O, proposed | Expose only with implemented proxy policy; never a free-form credential-bearing URL. |

### Sub-tab: Authentication

Select **Auth Type**, then render exactly the fields in its profile in section 5. Shared fields: credential binding reference, effective source layer, connection identity when known, verification status, last test time, and expiry/rotation metadata when the provider or secret system supplies it.

“Not tested,” “Credential unavailable,” “Authentication failed,” “Authenticated but forbidden,” and “Verified for selected operation” are distinct states. A generic successful HTTP response is not proof of access to the selected resource.

### Sub-tab: Environments & scope

| Field | Type / requirement | Coverage |
|---|---|---|
| Project environment | Active project reference / C | Required for dependent instances. |
| Tool environment | Authorized external reference / C | Exact destination for that mapping. |
| Credential binding | Approved binding reference / C | Per mapping if credentials differ; otherwise inherit instance binding. |
| External resource | Authorized reference / R | Jira project, Splunk index, space, namespace, topic, path, detector, etc. |
| Narrowing filters | Typed conditions / O | Restrict authorized resources; cannot broaden server scope. |
| Mapping status | Derived / R | Resolved, missing, ambiguous, inactive, or invalid. |

Proposed storage rule: one instance has one template and auth profile; repeatable bindings select its environment-specific target, scope, and credential references. A change of adapter or auth profile creates another instance. Shared instances explicitly apply to permitted project environments; do not infer this from a missing mapping.

### Sub-tab: Fields & operations

Select implemented read operations and available fields, configure typed mappings and field extensions, and associate enabled capabilities. Show required dependencies, input limits, output schema, and coverage limitations. Unsupported operations are unavailable with a reason, not unchecked capabilities that can be enabled anyway.

### Sub-tab: Data & monitoring

| Field | Type / requirement | Coverage |
|---|---|---|
| Use as data source | Boolean / O | Allowed only with an implemented ingestion operation. |
| Query / resource selection | Typed query or approved reference / C | Explicit retrieval target. |
| Queue name / ID | Text and generated ID / C | Required when the connector is used for monitoring queues. |
| Trigger type | Manual, Polling, Webhook / C | Availability comes from actual backend support. |
| Frequency / cron / timezone | Typed schedule / C | Polling only; validate limits and next occurrence. |
| Execution capability | Enabled capability reference / C | Required for automatic analysis. |
| Deduplication key / cursor | Template-owned strategy / C | Provider-specific identity and update/version marker; no arbitrary expressions. |
| Refresh status / history | Derived / C | Last attempt, success, failure, next run, coverage, stale state, provenance. |

Durable scheduling, refresh storage, restart recovery, and authenticated webhooks are platform extensions. Until implemented, show manual reads or an unavailable explanation; saving metadata must not create a false “Running” state. Arbitrary scripts are outside current scope.

### Sub-tab: Runbooks & artifacts

- Upload to the reusable **project artifact library**, or select an existing Ready artifact.
- Fields: title, type, artifact/version reference, description, environment association, connector instance association, capability association, tags, owner, and status.
- Show version, upload time, extraction warnings, and exact sources available to runs. New content creates a new version; prior evidence keeps its original reference.
- Local uploads use bounded parsing; images are OCR only. No macros, executable content, remote URL imports, or instructions that alter tool permissions.
- Runbooks describe procedures; uploading one does not make those procedures executable.
- Connector-refreshed knowledge and local uploads share provenance conventions but retain distinct origins and refresh/upload histories.

### Sub-tab: Test & review

Show effective configuration, redacted YAML, inherited/overridden fields, mappings, auth readiness, operation tests, and dependent capabilities. Actions: **Validate**, **Test connection**, **Test scoped read**, **Save draft**, and **Enable** when gates pass.

Tests bind to an instance revision and environment; connection/auth/scope changes invalidate affected results. Record actual outcomes, duration, UTC time, and bounded evidence. An enabled instance can still be unhealthy; never combine lifecycle and health into one ambiguous status.

## 5. Authentication types and conditional fields

The following is the proposed reusable auth-profile registry. “Future” entries describe extension contracts; they are not selectable until a compatible provider implements them.

**Form-completeness requirement:** each published template must fully describe every authentication method it offers, including nested choices, all credential fields, conditional mandatory/optional rules, and a real connection-test implementation. An auth dropdown without its complete fields and executable test is not an acceptable delivery. The registry is extensible so additional methods can be added without changing the project editor. “All authentication types” means all methods declared for that connector/deployment profile, not an assertion that every external system supports every method.

| Auth Type / stable ID | Required fields | Optional / conditional fields | Coverage and constraints |
|---|---|---|---|
| No authentication / `none` | Explicit platform permission | None | Only for an approved integration that genuinely requires none; never fallback after an auth failure. Current MCP/A2A registration accepts it; evidence execution may still require a token. |
| Basic + API token / `basic_api_token` | Account email/username; API-token secret reference | Rotation metadata if supplied | Provider builds Basic auth over verified TLS. Current Jira native implementation. |
| Basic + password / `basic_password` | Username; password secret reference | Domain only for an implemented provider | Future profile, distinct from API-token semantics; do not offer as a universal Jira/Confluence option. |
| Bearer token / `bearer_token` | Token secret reference | Expiry metadata if known | Provider adds `Authorization: Bearer`; current Splunk and several evidence providers. Token field never includes the header prefix. |
| Provider API-key header / `api_key_header` | Key secret reference; locked header-name profile | Locked prefix if the adapter requires it | Current GitLab `PRIVATE-TOKEN` and SignalFx `X-SF-Token`. Do not accept arbitrary header names from projects. |
| OAuth 2.0 client credentials / `oauth2_client_credentials` | Approved identity-provider profile; client ID; client-secret reference or approved client-auth profile; required scopes | Audience/resource where supported; certificate-key reference for a separately implemented assertion method | Future backend token acquisition/cache lifecycle. Token endpoint is platform-owned; values do not come from arbitrary uploaded configuration. |
| OAuth 2.0 authorization code with PKCE / `oauth2_authorization_code_pkce` | Approved provider profile; client ID; scopes; server-owned redirect URI; Connect account action | Client-secret reference when the registered client requires it | Future consent/callback/state/PKCE lifecycle. Refresh tokens remain in the backend secret store; no pasted authorization code form. |
| Mutual TLS / `mtls` | Client certificate reference; private-key reference; approved server trust | Key passphrase reference if required | Future compatible transport profile; may supplement application auth. Model as transport identity, not as a Bearer-token variant. |
| Database credentials / `database_password` | Database username; password secret reference | Wallet/trust profile only when implemented | Oracle source implementation uses username/password. Does not authorize enabling database queries under current project rules. |
| SASL SCRAM over TLS / `sasl_scram_tls` | Username; password secret reference; locked/selectable implemented mechanism; server trust | Client certificate only if implemented | Kafka currently fixes `SASL_SSL` + `SCRAM-SHA-512`. SCRAM-256, PLAIN, OAuth and certificate-only alternatives are future profiles. |
| SSH private key / `ssh_private_key` | Username; managed private-key reference; known-hosts trust reference | Passphrase reference only with implemented support | Unix provider uses SSH/SFTP key authentication with host verification. No shell execution implied. |
| PuTTY-compatible SSH / `putty_ssh` | Approved host/port; username; Password or PPK method; host trust reference | Password secret for Password; PPK reference for PPK; passphrase mandatory for encrypted PPK; optional session label | Requested connection profile using underlying SSH auth, not a new authentication protocol. Requires supported PPK handling and password/key testing. |
| Workload identity / `workload_identity` | Approved deployment identity profile; target resource/audience where required | Provider-specific bindings | Future connector-specific credential acquisition. An uploaded kubeconfig or executable credential helper is not this profile. |
| Kubernetes service-account token / `k8s_service_account_token` | Service-account token reference; cluster binding | Token expiry metadata and CA trust when supplied | Bearer token specialized for namespace pod reads. Automatic token renewal is a separate implementation requirement. |

### Credential behavior across all auth types

1. Project forms select authorized bindings; resolved credentials stay in providers. Existing reference support includes `env://NAME`; other secret-store schemes require a real resolver before being offered.
2. Platform-owned credential bindings may be inherited where policy permits. Resetting an override removes the project binding, not the underlying secret.
3. A changed auth type clears incompatible draft fields and requires a new test; it must not delete the original managed secret.
4. Never expose tokens, passwords, keys, OAuth responses, webhook secrets, or credential-bearing URLs in YAML, logs, downloads, error messages, or preview results.
5. Record rotation/expiry state only when known. Unknown expiry is not “never expires.” Re-resolve secret versions according to the implemented secret lifecycle; do not claim automatic rotation if absent.
6. Credential validity and permissions are separate checks. A valid credential without read permission on the authorized resource fails readiness.
7. Network/TLS failure, missing reference, invalid credential, insufficient permission, unsupported auth profile, expiry, and provider rate limiting require distinct actionable errors where observable.
8. Webhook verification is separate inbound authentication: provider-owned signature scheme, signing-secret reference, replay window and delivery deduplication. It must not reuse outbound tokens by assumption.

### 5.1 Detailed conditional authentication form contract

Every field below has a stable schema key. R means mandatory when that row's profile/condition is selected; O means optional; D means derived/read-only; H means hidden and excluded from the effective request when not applicable. Credentials are secret references, including tokens returned by a managed login flow.

All profile groups inherit `auth_type` (R, compatible enum), `credential_source` (R, Inherit / Select approved binding; creating a binding is a separate authorized flow), and `credential_binding_id` (R unless None or a platform-managed identity explicitly supplies it). Under Inherit, credential details are D; under Select, required reference selectors must be completed. A project editor does not become a credential-vault administration form.

#### Auth sub-tab: None

| Field | State | Rule |
|---|---|---|
| `auth_type` | R | Explicit None choice permitted by the connector profile and platform policy. |
| Credential/account/token fields | H | No stale credential sent. |
| `unauthenticated_access_policy` | D | Show why this target/operation permits unauthenticated access. |

#### Auth sub-tab: Basic credentials and Basic API token

| Field | State | Rule |
|---|---|---|
| `account_identifier` | R | Username or email according to the adapter; validate as email only when required by that provider. |
| `password_secret_ref` | R for Basic password; H for API token | Credential selected from an authorized binding. |
| `api_token_secret_ref` | R for Basic API token; H for password | Separate stable field; never silently reinterpret a password as an API token. |
| `domain` | R/O only if the implemented domain-aware profile says so; otherwise H | Not a generic Basic-auth field. Windows integrated auth uses a dedicated profile below. |
| Authorization header / encoding | D | Generated by provider; no editable Base64 or header input. |

#### Auth sub-tab: Bearer token and provider API key

| Field | State | Rule |
|---|---|---|
| `token_secret_ref` | R for Bearer | Token value resolved server-side. |
| `api_key_secret_ref` | R for API-key profile | Provider key; distinct from token-account credentials. |
| `key_placement` | D | Template-owned header placement for current profiles. Query/cookie placement requires a separate approved adapter and redaction policy; current integration URLs reject query credentials. |
| `header_name`, `header_prefix` | D | `Authorization` + `Bearer`, `PRIVATE-TOKEN`, `X-SF-Token`, or another implemented template-owned contract. |
| `account_label` | O | Human context only, not a required username for token auth. |
| `expires_at` | D when known; O as clearly labeled operator metadata otherwise | Do not mistake operator metadata for a provider-verified expiry. |

#### Auth sub-tab: OAuth 2.0

| Field | State | Rule |
|---|---|---|
| `oauth_provider_profile` | R | Approved issuer/endpoints/client registration, constrained to the selected connector. |
| `grant_type` | R | Only grants implemented by that adapter: Client Credentials, Authorization Code + PKCE, or a separately implemented Device Authorization flow. |
| `client_id` | R, or D when supplied by binding | Nonsecret registered identifier. |
| `client_auth_method` | R | None, Client Secret Basic, Client Secret Post, Private Key JWT, or mTLS; only compatible registered methods. |
| `client_secret_ref` | R for either Client Secret method; H otherwise | Never require a secret for a public PKCE client merely because OAuth is selected. |
| `assertion_key_ref`, `assertion_algorithm`, `assertion_key_id` | Key and algorithm R for Private Key JWT; key ID C per provider | Algorithm allowlist, key identity and signing behavior are platform-controlled. |
| `client_certificate_ref`, `client_private_key_ref` | R for mTLS client authentication; H otherwise | Reuse the TLS identity group; managed combined identity reference may supply both. |
| `authorization_endpoint`, `token_endpoint`, `device_authorization_endpoint` | D; corresponding endpoint R in the provider profile when needed | No arbitrary project URL entry. Hide endpoints irrelevant to the selected grant. |
| `redirect_uri` | D and required for Authorization Code; H otherwise | Server-owned registered callback. |
| `scopes` | R if provider requires scopes; O otherwise | Select allowed scopes; cannot request broader permissions than platform policy. |
| `audience`, `resource` | R/O according to provider; H if unsupported | Distinct fields with defined provider semantics, not assumed synonyms. |
| `pkce_method` | D for Authorization Code | Platform-enforced method; verifier and OAuth state are backend-generated and never editable. |
| `connect_account` | Required action for Authorization Code/Device flow | Real provider consent; display pending/connected/expired/denied state. A saved form does not complete consent. |
| `device_code`, `verification_uri`, `user_code` | D and temporary for Device flow | Provider-generated response; code verification and bounded polling belong to the backend. |
| `access_token_ref`, `refresh_token_ref`, `token_expiry`, `connected_identity` | D when returned | Managed acquisition/refresh; no token text in browser data or YAML. Refresh token is not universally issued or required. |

An OAuth extension is incomplete until consent (where applicable), token acquisition, expiry, refresh/reconnect, revocation handling and live scoped tests are implemented. Password-grant and implicit flows are not part of this proposed initial registry; a request for another grant requires a deliberate provider contract, not an unchecked “Custom OAuth” option.

#### Auth sub-tab: TLS client certificates

TLS identity can supplement Basic, Bearer, OAuth, database or SASL authentication when the provider requires both. Represent this as `transport_security` plus `application_auth`; a single mutually exclusive dropdown must not prevent valid combined configurations.

| Field | State | Rule |
|---|---|---|
| `client_identity_format` | R | Managed PEM pair or managed PKCS#12 bundle, only as implemented. |
| `client_certificate_ref`, `client_private_key_ref` | R for PEM pair; H for bundle | Validate certificate/key correspondence server-side. |
| `client_bundle_ref` | R for bundle; H for PEM pair | Managed certificate bundle, not a project artifact upload. |
| `key_passphrase_ref` / `bundle_password_ref` | R when selected key/bundle is encrypted; O only if the resolver can determine need; H otherwise | Missing decryption credentials produce a field error, never an insecure fallback. |
| `server_trust_mode` | R | System trust or Approved CA bundle. |
| `ca_bundle_ref` | R for Approved CA; H for System trust | Trust material reference. |
| Certificate subject, issuer, expiry | D when available | Display actual inspected certificate metadata. |
| Hostname verification | D | Enforced; no project “skip verification” control. |

#### Auth sub-tab: Kafka SASL

| Field | State | Rule |
|---|---|---|
| `security_protocol` | R, constrained | Existing native profile fixes SASL_SSL. Other combinations need implementations. |
| `sasl_mechanism` | R | SCRAM-SHA-512 current; SCRAM-SHA-256, PLAIN, OAUTHBEARER or GSSAPI are future mechanism profiles. |
| `username`, `password_secret_ref` | R for SCRAM/PLAIN; H for mechanisms that do not use them | PLAIN may be offered only with an approved encrypted transport. |
| OAuth identity/token profile | R for OAUTHBEARER; H otherwise | Reuse compatible OAuth fields and implement broker token acquisition/renewal. |
| Kerberos identity profile | R for GSSAPI; H otherwise | Reuse the following Kerberos fields; no username/password substitute. |
| TLS trust and optional client identity | R/C | Reuse TLS group according to the published broker profile. |

#### Auth sub-tab: Kerberos / integrated identity — proposed

`kerberos_gssapi` and `windows_integrated` are separate future adapter profiles, not current Jira/Kafka/Unix choices.

| Field | State | Rule |
|---|---|---|
| `identity_profile_ref` | R | Approved deployment identity configuration. |
| `principal`, `realm`, `service_principal` | R or D from profile | Provider-specific identity and target service. |
| `credential_mode` | R | Managed keytab or deployment ticket/identity, only when implemented. |
| `keytab_ref` | R for keytab; H otherwise | Backend-managed credential, not a runbook upload. |
| `ticket_cache_ref` | C for managed ticket mode | Deployment-owned reference; no arbitrary filesystem path. |
| Renewal and delegated-credential policy | D | Require explicit implementation; do not infer delegation permission from login success. |

#### Auth sub-tab: SSH / SFTP

| Field | State | Rule |
|---|---|---|
| `ssh_auth_method` | R | Private key current; Password or SSH certificate are proposed provider extensions. |
| `username` | R | Required for all these SSH profiles. |
| `private_key_ref` | R for Private key or SSH certificate; H for Password | Managed key identity. |
| `private_key_passphrase_ref` | R when encrypted and supported; H otherwise | Passphrase support must exist before accepting an encrypted key binding. |
| `password_secret_ref` | R for Password; H otherwise | No password field for current key-only provider. |
| `ssh_certificate_ref` | R for SSH certificate; H otherwise | Certificate must correspond to the selected key and permitted identity. |
| `known_hosts_ref` | R | Verified host trust from deployment configuration. |
| SSH agent / executable commands | H / unavailable | Not a project auth fallback or connection test. |

#### Auth sub-tab: Database identity

| Field | State | Rule |
|---|---|---|
| `database_auth_method` | R | Username/password source contract; wallet or external identity only after adapter extension and release authorization. |
| `database_username`, `password_secret_ref` | R for password mode | Connection account; independent of evidence scope. |
| `wallet_ref` | R for wallet mode; H otherwise | Approved managed wallet; not an arbitrary file path. |
| `wallet_password_ref` | R if wallet requires it; H otherwise | Determined by selected wallet profile. |
| `external_identity_ref` | R for external identity; H otherwise | Deployment-managed identity with implemented driver support. |
| TLS trust/client identity | C | Render the TLS group only for a supported database transport profile. |

Database form completeness does not remove the production database-execution gate. The user has requested local connection/authentication testing with explicit driver/client-library setup; see the Oracle section.

#### Auth sub-tab: Service account / workload identity

| Field | State | Rule |
|---|---|---|
| `identity_method` | R | Static service-account token, managed workload identity, or provider service-account key, as implemented. |
| `token_secret_ref` | R for static token; H otherwise | Current Kubernetes profile. |
| `workload_identity_profile_ref` | R for managed identity | Approved deployment federation/identity; no user credential needed when the profile supplies identity. |
| `audience`, `resource`, `role_binding_ref` | C | Required only according to the specific identity provider contract; server validates authorization. |
| `service_account_key_ref` | R for a supported key-based provider; H otherwise | Managed credential material; not an uploaded executable or arbitrary JSON object passed to the runtime. |
| Identity subject / expiry / renewal status | D when known | Derived from real identity acquisition. |

#### Auth sub-tab: Signed requests / JWT identity — proposed

Some future connectors need request signing rather than a static token. Use explicit `signed_request` or `jwt_assertion` profiles with provider-owned algorithms and canonicalization, never a generic signing-script field.

| Field | State | Rule |
|---|---|---|
| `signing_profile_ref` | R | Implemented provider algorithm, service/region semantics where relevant, and allowed credential modes. |
| `access_key_id`, `secret_access_key_ref` | R for an implemented access-key mode | Nonsecret identifier plus secret reference. |
| `session_token_ref` | R for temporary session credentials; H when not used | Do not drop a required session token. |
| `workload_identity_profile_ref` | R for workload mode; H for access-key mode | Alternative credential acquisition, not an additional required key. |
| `region`, `service` | R/C as required by signing profile | Locked or constrained to approved destination binding. |
| `signing_key_ref`, `issuer`, `subject`, `audience`, `algorithm` | R/C for JWT assertion per provider | Backend signs bounded-lifetime claims; reserved claims/algorithms are platform-controlled. |
| `key_id` | C per provider | Must match the selected identity. |

### 5.2 Required, optional and hidden field behavior

- Mandatory labels and validation update immediately when the user changes auth type, grant, client-auth method, transport identity or credential source.
- Hidden fields do not participate in validation or runtime serialization. Changing a draft selection may preserve values locally for switching back, but the server accepts only the effective profile's allowed fields and never applies inactive credentials.
- Conditional requirements are evaluated identically by the form and server schema. “Optional” means omitted values are supported by the selected adapter, not simply that the form lacks an asterisk.
- Derived inherited fields remain visible/read-only with their source. A required inherited credential reference can satisfy requiredness only if the caller is authorized to use its binding; existence/validity is checked server-side.
- Invalid selection or missing input links the error to its field and sub-tab. Auth-type changes show a concise summary of credentials/test results affected.
- Save Draft accepts incomplete configuration but preserves typed fields and policy restrictions. Test is unavailable until the selected operation's required fields are complete; Enable requires valid configuration and a passing live scoped test under the platform freshness policy.
- For providers requiring both transport and application credentials, validate both groups. No silent fallback to another auth type, anonymous access or disabled certificate verification.

### 5.3 Live form testing and confirmation

The form must support testing the **current candidate values**, including unsaved changes, against the selected real system without first enabling them. This is a backend candidate-test requirement, not a client-side simulation.

#### Test controls

| Action | What it checks | Passing result means |
|---|---|---|
| Validate form | Types, required conditions, allowed auth/transport, template version, scope/reference authorization and bounds | Candidate is structurally valid; no network claim. |
| Test connection | Actual destination resolution, connection, TLS/host trust and selected auth handshake/token acquisition | Connection/auth stages completed only to the extent verified by that protocol. |
| Test scoped read | A bounded read using the exact auth, environment, instance and authorized resource | Selected operation is usable with the current permissions. |
| Test all configured environments | Bounded parallel execution of the preceding scoped checks for every enabled binding | Every listed binding passed its own test; no reuse of one environment's success. |
| Test capability | Real selected capability invocation with explicit input and the candidate configuration | That end-to-end path completed; separate from connector connectivity. |

Where a provider can only verify authentication by making a scoped read, combine those stages and say so. Report “not independently verified” for stages that cannot be distinguished. Do not manufacture separate authentication success from an ambiguous response.

#### Test result panel

| Display field | Required content |
|---|---|
| Overall result | Passed, Failed, Partial, Cancelled, or Not run; Partial never satisfies a full-read requirement. |
| Tested configuration | Candidate hash/revision, template version, auth profile, environment and operation. |
| Destination / scope | Redacted target label and authorized external resource. |
| Stage results | Connection, trust, credential resolution, authentication, authorization, scoped read, response schema; include Not applicable / Not independently verified. |
| Evidence of success | Actual bounded count or operation outcome; a valid empty result is distinct from failure. |
| Coverage | Truncation, unsupported operations, untested bindings and provider-specific limitations. |
| Timing | UTC timestamp and duration; expiry/freshness under platform policy. |
| Error | Safe actionable message and affected field when known; no raw provider body or credential echo. |
| Test reference | Persisted ID/correlation reference and candidate hash for audit. |

Example result wording is a specification, not seeded data: “Scoped read passed for the selected namespace. No pods returned.” Do not display “Everything is working” unless the UI explicitly defines the tested scope; connector tests cannot establish that all agents, schedules and integrations work.

#### Backend test requirements

1. Resolve the authenticated deployment scope, authorize every target and credential binding, then build an isolated temporary provider client from the candidate configuration. Do not mutate active clients/settings to test a draft.
2. Apply UTC deadlines, request/response limits and bounded parallelism. Close connections after completion, failure or cancellation.
3. Tests perform only approved read operations; do not write Jira comments, consume Kafka messages, commit offsets, send notifications, launch shell commands or change remote resources as an implicit test.
4. Persist redacted result metadata with the candidate hash and actual operation. Changing endpoint, auth, scope, environment mapping, relevant limits or template version marks affected results stale.
5. Handle invalid/expired/revoked credentials, missing secret references, TLS mismatch, unreachable host, timeout, rate limit, forbidden scope, schema mismatch and successful empty reads. Show distinctions only when reliably observable.
6. Rate-limit repeated test requests and honor provider backoff. No invented latency or synthetic success/failure records.
7. Enablement checks the exact candidate and all required active bindings under the agreed freshness policy. A successful test is evidence for that time and operation, not a permanent health guarantee.

### 5.4 Authentication delivery gate

A method counts as supported only when all of these are delivered together: complete conditional schema; rendered fields; secure credential resolution/acquisition; compatible provider transport; authorized candidate test; real scoped-read result; redacted persistence; stale-result invalidation; and failure handling.

Until then, list the method as Planned in the platform template review, and keep it unavailable in the working project dropdown. This ensures the eventual forms cover all published authentication choices completely without falsely promising unimplemented connections.

## 6. Jira template

**Covers:** scoped ticket evidence and fields for triaging/root cause analysis. **Current native auth:** Basic email + API token. [Provider source](../app/connectors/providers/jira.py).

### Sub-tab: Connection

| Field | Type / requirement | Coverage |
|---|---|---|
| Jira deployment resource | Authorized reference / R | Resolves a real Jira site; no sample host default. |
| Site base URL | Derived HTTPS URL / R | Native provider appends `/rest/api/2/...`; do not append another API root in the form. |
| Deployment/API profile | Locked adapter profile / R | Cloud versus another deployment is not merely an auth dropdown change. Additional profiles need verification. |
| UI base URL | Derived URL / O | Human issue links. |

### Sub-tab: Authentication

| Auth option | Fields shown | Availability |
|---|---|---|
| Basic + API token | Account email R; API-token reference R | Current native provider. |
| OAuth 2.0 / deployment-specific PAT | Provider-specific profile and credential fields | Proposed separate adapters/profiles; not current native support. |

### Sub-tab: Environments & scope

Jira project reference R (server-authorized); environment bindings C; optional issue-type filters O. Project-member-to-Jira-account mapping C for member-based queues. A local project ID and Jira project key are separate identities.

### Sub-tab: Fields & operations

| Field/operation | Requirement | Coverage |
|---|---|---|
| Ticket lookup | R for enabled ticket capability | Real issue ID/key bounded by authorized Jira project. |
| Inherited Jira fields | Read-only metadata | Platform field ID, display name, data type, allowed operators/options. |
| Project custom fields | Repeatable / O | ID, field name, type, instance association; validate duplicate/conflicting IDs and provider existence. |
| Semantic mappings | O | Map available Jira fields to queue, service, severity, environment and ownership concepts without replacing field identity. |
| Comment writes / issue mutations | Unavailable | Native connector is read-only. |

**Custom-field setup extension:** expose verified field discovery for the selected Jira instance, canonical REST ID (`customfield_<ID>`), JQL representation (`cf[<ID>]`), provider field name/type, optional project display label, issue/project context and allowed options. Configure use for evidence extraction, queue filtering and/or registered semantic mappings. Mapping targets include queue, service, severity, environment and ownership where supported. Specify enabled state and whether a missing field is tolerated with a notice or blocks the selected operation.

Merge inherited platform definitions with project additions by instance + canonical field ID. Reject incompatible definitions, retain source provenance and distinguish fields missing on the test issue from invalid/unavailable metadata. Validate and preview real extracted values from an authorized issue, with redaction. This is configuration of existing Jira fields, not creation of remote fields. The existing provider returns non-null `customfield_*` values, but does not establish field discovery or the proposed extraction policy.

**Attachment processing sub-section:** include an Enabled/Disabled choice; required source when enabled (local upload linked to issue, or permitted project artifact/version); authorized Jira issue reference; supported file-type subset; file count, per-file and total-byte limits; parsing deadline/text limits; OCR-only image handling; required/optional evidence designation; partial-failure policy; capability associations; and inherited retention/redaction policy. Local upload is required when that source is selected; library artifact/version is required otherwise. Hidden source fields are excluded from the effective request.

Provide Validate Attachment Settings, Process Selected Files and Preview Extracted Evidence actions. Persist per-file processing outcomes, content hashes, originating instance/issue associations and versioned evidence references. Unusable required evidence blocks the selected operation; optional failures remain visible as partial coverage. Never treat document text or macros as executable instructions.

Automatic processing of **Jira-hosted** attachments is a separate proposed connector retrieval operation. Current source returns `attachments_count` only, while repository guidance restricts attachment inputs to local processing. Remote byte retrieval remains unavailable pending explicit authorization and an implemented scoped provider contract. That contract must authorize issue/attachment IDs, verify approved destinations/redirect behavior, bound bytes/deadlines and preserve provenance; arbitrary pasted attachment URLs are not an acceptable substitute. This restriction does not block the local issue-associated processing requirement.

### Sub-tab: Data & monitoring

Queue name R when used; Visual Builder or Custom JQL R; field/operator/value groups; AND/OR grouping; member-based assignee expansion; capability mapping; shared schedule fields. Preserve the structured builder and generated JQL. Empty member selection must not broaden results. Arbitrary custom JQL must still be combined with/enforced against authorized scope by the backend.

**Extension needed:** field discovery, dynamic/custom JQL search tests and scheduled queues are requirements beyond the inspected native `get_ticket` operation. Do not advertise an implemented queue search from the existence of a UI field.

### Sub-tab: Test & review

Test project access and one explicitly supplied scoped issue. Once query execution exists, independently test syntax, scope and bounded matches. Report field-access limitations and distinguish no matches from failure.

## 7. Splunk template

**Covers:** bounded log search and evidence. [Provider source](../app/connectors/providers/splunk.py).

### Sub-tab: Connection

Splunk management endpoint reference R; UI URL O; verified TLS R; timeout/result/response/time-window limits R. The REST management endpoint and browser UI endpoint are separate resources.

### Sub-tab: Authentication

| Auth option | Fields shown | Availability |
|---|---|---|
| Bearer token | Token reference R | Current native provider. |
| Basic / OAuth / mTLS | Respective registered profile fields | Proposed only; require compatible provider implementation. |

### Sub-tab: Environments & scope

Authorized index reference R; environment bindings C. Current native provider resolves one configured index per client. A template array of indexes does not establish multiple-index runtime support. Host/source/sourcetype filters are proposed narrowing fields, not independent authorization grants.

### Sub-tab: Fields & operations

Time range R; query text R for search; event timestamp/message/source mappings O where returned; result cap R. Keep query bounds and index enforcement server-side. Saved-search execution is a separate proposed operation until verified in the adapter.

### Sub-tab: Data & monitoring

Named log query, bounded lookback, overlap/deduplication policy and target capability; shared manual/polling fields. Automatic polling and persistent refresh history need the scheduler extension.

### Sub-tab: Test & review

Test access to the authorized index, then a bounded read. Show effective UTC range, returned count, truncation, and actual failure. Current provider restricts the time window to at most 86,400 seconds; use the tighter provider limit even if a generic schema allows more.

## 8. Confluence template

**Covers:** current page content from one authorized space; knowledge/runbook evidence. Disabled by default. [Provider source](../app/connectors/providers/evidence.py).

### Sub-tab: Connection

Confluence resource reference R; API base including the appropriate wiki base R; deployment/API profile R. Provider appends `/api/v2/spaces/{scope}/pages`; ensure path composition is correct for the selected deployment.

### Sub-tab: Authentication

Bearer-token reference R is the implemented provider contract. Whether that token works for a specific Confluence deployment must be tested. Email/API-token Basic and managed OAuth profiles are proposed alternatives, not interchangeable labels for the existing provider.

### Sub-tab: Environments & scope

Authorized space ID R. Shared knowledge instance or explicit environment mappings R. Page/label filtering is proposed narrowing functionality; the current provider lists pages from the configured space.

### Sub-tab: Fields & operations

Page ID, title, space ID, status, version, body; maximum page results R. Preserve page/version citations and pagination/partial-list indicators. Storage markup and macros are untrusted content; do not render or execute macros. No page edits.

### Sub-tab: Data & monitoring

Knowledge-source toggle O; selected capability associations O; refresh schedule C once implemented. Proposed stable item key: page ID with version as change marker. Connector knowledge remains distinguishable from locally uploaded runbooks.

### Sub-tab: Test & review

Read bounded pages in the authorized space, verify scope in returned records, show extractability and partial coverage. Scheduled indexing/retrieval is a separate extension.

## 9. SignalFx template

**Covers:** detector configuration evidence, not live metrics or proof an alert fired. Disabled by default. [Provider source](../app/connectors/providers/evidence.py).

### Sub-tab: Connection

Approved SignalFx API resource R; realm designation O where modeled; API base R. An illustrative UI host from the catalog is not sufficient API configuration.

### Sub-tab: Authentication

API-key-header profile R: locked header `X-SF-Token`; token reference R. Do not expose editable header names. Other auth profiles are proposed pending adapter support.

### Sub-tab: Environments & scope

Authorized detector ID R; explicit shared/dependent mapping R. Multiple detector instances are distinct bindings/resources, not a free-form unrestricted detector query.

### Sub-tab: Fields & operations

Detector ID, name, description, rules, tags, last-updated metadata. Explain thresholds and rules using returned definitions. Time-series queries, alert-event ingestion and detector edits are unavailable in the inspected provider.

### Sub-tab: Data & monitoring

Manual detector read supported in code. Polling for definition changes is proposed; alert webhooks/time-series monitoring require additional provider operations and inbound verification.

### Sub-tab: Test & review

Read the selected detector and verify its returned ID. Test result must say “Detector configuration retrieved,” not “Monitoring active.”

## 10. qTest template

**Covers:** root-level test runs from the authorized qTest project. Disabled by default. [Provider source](../app/connectors/providers/evidence.py).

### Sub-tab: Connection

qTest resource R; API base R with provider-compatible version; UI base O.

### Sub-tab: Authentication

Bearer-token reference R. Username/password-based token acquisition or OAuth is a proposed profile requiring a real credential-acquisition implementation.

### Sub-tab: Environments & scope

Authorized qTest project ID R; environment bindings C. qTest project IDs are external references, not RCA project scope. Nested folder/release/cycle selection is proposed and must not suggest recursive coverage today.

### Sub-tab: Fields & operations

Read test-run ID, name, project identity, test-case reference/version, properties and last-test-log fields when returned. Display root-level coverage. Do not equate a test definition with a passed execution result.

### Sub-tab: Data & monitoring

Manual test evidence; proposed filter by available execution properties; refresh/polling and complete recursive traversal need backend extensions. No test execution or result mutation.

### Sub-tab: Test & review

Read the authorized project root, report coverage and response limits, and display missing execution-result metadata as unknown.

## 11. GitLab template

**Covers:** recent deployment records in an authorized GitLab project. Disabled by default. [Provider source](../app/connectors/providers/evidence.py).

### Sub-tab: Connection

GitLab resource R; API base R; UI base O. Preserve API-root path handling so `/projects/{id}/deployments` is appended exactly once.

### Sub-tab: Authentication

Provider API-key-header profile: locked `PRIVATE-TOKEN`, token reference R. PAT is the existing catalog label. Additional token classes must be verified for the required API permissions; OAuth Bearer is a proposed distinct profile.

### Sub-tab: Environments & scope

Authorized GitLab project reference R; project/tool environment associations C. Environment-name filtering is proposed narrowing behavior, not unrestricted project access.

### Sub-tab: Fields & operations

Deployment ID, commit SHA, ref, status, created/updated times and environment. Source browsing, pipelines, merge requests, repository cloning and deployment actions are separate operations, not implied by this template name.

### Sub-tab: Data & monitoring

Manual recent-deployment read. Polling, change cursors and signed deployment webhooks are extensions. Capability association may support incident/deployment correlation; correlation does not establish causation.

### Sub-tab: Test & review

Read bounded deployments for the selected project; show sorting and coverage. Do not claim a complete historical deployment search from one bounded page.

## 12. Oracle template

**Covers:** requested local Oracle connection/authentication tests and, separately, policy-gated fixed current-session wait evidence. Production database queries remain unavailable until separately enabled; local testing does not authorize arbitrary SQL. [Provider](../app/connectors/providers/oracle.py), [repository guidance](../AGENTS.md).

### Sub-tab: Connection

Approved database resource R; DSN derived R; host/port/service name displayed from that resource where available; bounded connection/query deadline R. Do not accept arbitrary connection-string credentials.

**Local client fields:** approved test runtime R; driver profile Thin/Thick R; connection format R (direct service, approved DSN, TNS alias); host/port/service R for direct mode; DSN reference R for DSN mode; alias and approved network configuration reference R for alias mode. These are authorized resource settings, not free-form network authorization.

For Thick, require a registered library-loading profile. Expose `oracle_client_lib` as the registered local client-library directory when the platform uses explicit-directory loading; otherwise display the system-managed loader profile. Hide/omit the field in Thin mode. Display actual driver mode/version and, when loaded, client library version. “Local” identifies the backend test machine; the browser cannot supply an arbitrary native-library path for loading.

python-oracledb Thin does not use Oracle Client libraries; loading them enables Thick, and the mode is process-wide. Therefore the form selects an approved compatible runtime rather than switching a shared process per request. [Oracle initialization documentation](https://python-oracledb.readthedocs.io/en/latest/user_guide/initialization.html).

The existing provider calls `connect_async`. Asyncio is Thin-only, so Thick local testing needs a bounded synchronous adapter/runtime path with enforced deadlines and cleanup. Adding a library-directory field alone will not provide it. [Oracle asyncio documentation](https://python-oracledb.readthedocs.io/en/latest/user_guide/asyncio.html).

### Sub-tab: Authentication

Database username R; password secret reference R. Source currently reads deployment environment values. A project secret-reference binding requires a provider resolver extension; wallet, mTLS and external identity are future profiles, not current choices.

### Sub-tab: Environments & scope

Authorized database username/schema scope R; dependent environment mapping R. The account used to connect and the username used to restrict evidence are separate fields.

### Sub-tab: Fields & operations

Only a registered fixed session snapshot: SID, serial number, status, event, wait class, seconds in wait, blocking session. No SQL editor, script target, arbitrary table browser, or historical-contention claim.

### Sub-tab: Data & monitoring

Unavailable while database querying is disabled. If future activation is approved, define bounded snapshot collection and retention explicitly; never infer a historical dataset from current-session data.

### Sub-tab: Test & review

Provide Validate Form, Check Local Client Setup, and Test Local Connection actions once their adapters exist. Tests report actual runtime/mode, library setup where relevant, resolved target and authentication outcome without enabling production queries. Keep the fixed session-snapshot test separately policy gated. Missing libraries and incompatible process mode are setup errors, not authentication failures.

## 13. Kafka template

**Covers:** native topic partition metadata; optional separately approved MCP evidence. Disabled by default. [Native provider](../app/connectors/providers/infrastructure.py), [MCP binding provider](../app/connectors/providers/mcp_evidence.py).

### Sub-tab: Connection

Transport profile R: Native Kafka or approved MCP. Native fields: broker-resource reference R, derived bootstrap servers R, TLS trust C, timeout R. MCP selection displays the MCP connection/auth contract instead; native credentials do not become MCP credentials.

### Sub-tab: Authentication

| Profile | Required fields | Availability |
|---|---|---|
| Native SASL SCRAM over TLS | Username, password reference, trust profile | Implementation fixes `SASL_SSL` and `SCRAM-SHA-512`; project reference resolution needs validation against the current environment-variable provider. |
| MCP Bearer | Approved MCP credential reference | Only through approved MCP bindings. |
| SCRAM-256, PLAIN, OAuth, certificate identity | Corresponding future auth schema | Not implemented by the inspected native adapter. |

### Sub-tab: Environments & scope

Authorized topic set R; environment-to-cluster mapping R. Consumer group selection is not a native field today because the provider does not measure group lag.

**Required topic filtering extension:** selection mode R (explicit topics or topic-name filters). Explicit selection requires an authorized topic multi-select. Filter mode requires at least one include condition with Equals, Starts with, Contains or bounded Glob; optional excludes use the same operators. Define case-sensitive name matching, OR between include rows, and exclusions taking precedence. Glob supports `*` and `?`; do not accept executable expressions or unbounded regex.

Resolve matches only within the server-approved topic set. Empty results remain empty; never drop the filter and read all topics. Apply a platform maximum matched-topic count and total result/byte/deadline budget. Over-limit selection fails with a request to narrow it. Discovery must not expose unauthorized topic names. Re-resolve permitted matches per execution and record the exact topic set used, including per-topic failures and truncation.

Preview Matching Topics performs real bounded authorized discovery; Test Filtered Metadata Read reads the matched topic set with bounded concurrency. The current adapter reads one topic; multi-topic scope resolution and fan-out must be implemented before these controls work. Topic filtering does not imply message-content filtering or message consumption.

### Sub-tab: Fields & operations

Native partition metadata only. No message consumption, publishing, offset commits or group modifications. MCP operations must declare exactly whether they return lag, offsets or message evidence; do not infer all three from “Kafka.”

### Sub-tab: Data & monitoring

Manual metadata snapshot. Automatic polling and lag monitoring require the relevant scheduler and measurement operation. Show “Lag not measured” for the current native adapter.

### Sub-tab: Test & review

Validate TLS/auth, preview authorized matches, and describe only the resolved topics. Confirm returned topic identities, per-topic outcomes and aggregate bounds. Partial failures remain Partial, not a complete pass. MCP tests separately validate operation bindings and output schema.

## 14. Unix template

**Covers:** bounded tail of one approved remote log through native SFTP, or an approved MCP evidence operation. Connector type/name is Unix. Tuxedo is a user-entered System Name for an instance, not a separate tool type. Disabled by default. [Provider source](../app/connectors/providers/infrastructure.py).

### Sub-tab: Connection

Transport R: SFTP or approved MCP. SFTP host-resource R; port derived R; connection deadline R. MCP uses the shared integration fields.

### Sub-tab: Authentication

SSH username R; managed private-key reference R; known-hosts trust reference R. Current source reads deployment-controlled key/known-hosts files; a project-facing reference resolver is an extension. Password login, interactive prompts, passphrase handling and SSH-agent access must not be offered unless implemented.

**Requested PuTTY-compatible SSH profile:** show approved host/port R, login username R, optional descriptive PuTTY session label, and underlying auth method R (Password or PuTTY PPK key). Password mode requires password secret reference and hides key fields. PPK mode requires a managed `.ppk` key reference, with passphrase reference mandatory for encrypted keys; password fields are hidden. Host trust/known-hosts reference is required for both, with the expected fingerprint derived from that approved binding. Timeout is required and bounded.

PuTTY is an SSH client; the underlying authentication is password or public key. PPK is its private-key format. A working profile needs validated backend format support or vetted managed conversion during credential onboarding; do not depend on desktop PuTTY/Pageant state or execute imported session commands. [PuTTY key documentation](https://www.puttyssh.org/0.83/htmldoc/Chapter8.html).

### Sub-tab: Environments & scope

Authorized absolute log-path reference R; host/environment mapping R. Prevent traversal and selection outside deployment-approved files. This controlled connector operation is separate from local artifact upload, which still has no remote URL import feature.

### Sub-tab: Fields & operations

Log tail bytes/text and truncation metadata. No command field, script upload, service restart, arbitrary file browsing or writes. Selecting a System Name does not change the Unix connector's allowed operations.

### Sub-tab: Data & monitoring

Manual bounded read. Polling, log-rotation identity and cursor/deduplication behavior require an explicit implementation before persistent ingestion is available.

### Sub-tab: Test & review

Verify host identity and file read permissions; return a bounded redacted preview and truncation state. Never use a shell command as a connectivity test.

For PuTTY-compatible profiles, test credential-format/passphrase validity, trusted-host authentication and a bounded SFTP read separately where observable. Report unsupported PPK format, missing/wrong passphrase, changed host key, rejected credentials and denied file access. A saved desktop session label is not a passing test.

## 15. Kubernetes template

**Covers:** pod status in one authorized namespace. Disabled by default. [Provider source](../app/connectors/providers/evidence.py).

### Sub-tab: Connection

Cluster-resource reference R; API endpoint derived R; CA trust C; deadline/result cap R. A UI URL is optional and distinct from the API server.

### Sub-tab: Authentication

Service-account token reference R; trust profile C. Current adapter sends Bearer auth. Client certificates, workload identity and managed token refresh require distinct implementations. Do not execute uploaded kubeconfig credential helpers.

### Sub-tab: Environments & scope

Authorized namespace R; cluster/environment mapping R. Namespace is a server-enforced resource restriction. Label selectors and multiple namespaces are proposed narrowing/mapping extensions, not established source behavior.

### Sub-tab: Fields & operations

Pod name, namespace and returned status: conditions, restarts and related status fields when present. No Secrets, pod specs, environment variables, exec sessions, workload changes or implied pod-log operation. Report continuation/truncation.

### Sub-tab: Data & monitoring

Manual pod-status snapshot. Watch streams, alert rules, event ingestion and automatic polling require specific backend support.

### Sub-tab: Test & review

Read bounded pods from the configured namespace, verify each returned namespace, and test the exact read permission required. Do not demand cluster-admin credentials for convenience.

## 16. Custom MCP template

**Covers:** extensible integration registration and explicitly approved tool bindings. [Definitions](../app/configuration/integrations.py), [import parser](../app/configuration/mcp_import.py), [runtime bindings](../app/connectors/providers/mcp_evidence.py).

### Sub-tab: Connection

| Field | Type / requirement | Coverage |
|---|---|---|
| Integration reference / revision | Registered resource / R | Stable scoped registration; platform enablement still required by the proposed project policy. |
| Transport | Enum / R | Existing registration accepts Streamable HTTP, SSE, and stdio; each has distinct runtime support and policy. |
| Endpoint | Approved HTTPS reference / C | HTTP/SSE only; no embedded credentials, query parameters or fragments under current registration validation. |
| Executable profile | Platform-approved reference / C | stdio only; not an arbitrary project command field. Existing command registration does not authorize adding code execution to this release. |
| Timeout | Duration / R | Registration schema currently bounds it to 1–120 seconds; effective operation bounds may be tighter. |

**Project MCP identity:** require a unique project System Name, explicit Environment Dependent/Independent selection, and explicit Tool Environment when adding each MCP instance. Default System Name to the selected registered connector/server display name, allow editing and persist it on the instance. A platform template/registration may be reused by multiple project instances without sharing instance identity; duplicate names require a distinguishing edit.

Show discovered tools grouped by System Name and label selectors with System Name / tool name plus Tool Environment. Persist instance ID, approved binding ID and exact remote tool name as execution identity; names are presentation metadata. Apply this identity consistently to parameter overrides, environment mappings, data sources, capability selections, tests and run evidence. Renaming an instance must preserve bindings/history, and duplicate tool names across MCP servers must not collide.

### Sub-tab: Authentication

Current HTTP/SSE registration choices: None or Bearer. Bearer requires `env://` secret reference. stdio registration uses environment references and has no endpoint auth fields. These are registration facts; the evidence runtime uses a deployment token and approved bindings, so a None registration is not proof that evidence execution supports unauthenticated tools.

OAuth, custom API-key headers, mTLS and workload identity are future registered profiles. Do not label a generic pasted token as an OAuth connection with refresh support.

### Sub-tab: Environments & scope

Environment/resource mapping R; server-owned scope argument name/value binding R for a scoped operation; project may select only authorized resources. Tool input cannot override fixed scope arguments or deployment-owned binding arguments.

### Sub-tab: Fields & operations

| Field | Requirement | Coverage |
|---|---|---|
| Discovered tool name / schema | Derived | Display the actual registered server response and discovery timestamp. |
| Approved operation mapping | R | Map a platform operation to an exact allowed tool name; existing registry allows `read_evidence`, `get_ticket`, and `query_range`. |
| Argument mapping | Typed map / C | Validated request-field mapping; no collision with fixed scope/arguments. |
| Output schema / evidence mapping | R | Bound payload, validate structure and preserve provenance. |
| Permission / side-effect classification | Platform-owned / R | Read-only eligibility and approval; server annotations alone are not authorization. |

Newly discovered tools become **reviewable**, not automatically executable. After platform enablement and validated binding, eligible tools should appear automatically in compatible project/capability selectors. Unknown schemas, changed tool contracts and revoked bindings block execution until resolved.

### Sub-tab: Data & monitoring

Show only modes implemented by the approved mapped operation. A tool named “search” does not establish durable ingestion, webhook processing or arbitrary scheduled execution.

### Sub-tab: Test & review

Separate registration validation, protocol handshake, discovery, binding validation and one bounded approved invocation. Show which stage was tested; never call unapproved discovered tools to assess them.

## 17. A2A template

**Covers:** registered external agent connection metadata and a future explicitly approved delegation contract. [Registration schema](../app/configuration/integrations.py).

### Sub-tab: Connection

Integration reference R; endpoint HTTPS resource R; transport R (`a2a_jsonrpc` or `a2a_rest` in the current schema); timeout R. Agent identity/card reference is a proposed discovered field, not a raw remote-document upload or arbitrary fetch path.

### Sub-tab: Authentication

Current registration: None or Bearer; Bearer secret reference R when selected. OAuth, mTLS and workload identity are proposed profiles requiring implemented acquisition and transport handling.

### Sub-tab: Environments & scope

Approved external agent/resource reference R; explicit environment association R; data-sharing policy R before any execution feature. Do not send project artifacts or credentials merely because an agent is registered.

### Sub-tab: Fields & operations

Proposed fields: approved remote skill IDs, typed request/response contract, allowed artifact types, maximum payload, deadline, side-effect permissions, evidence provenance, cancellation semantics and idempotency support. Local Google ADK remains the root workflow; remote agent registration does not replace it.

### Sub-tab: Data & monitoring

Disabled unless a concrete approved adapter implements the requested operation. A2A is not automatically a database, knowledge source, or polling source.

### Sub-tab: Test & review

Validate current registration fields. Protocol discovery or remote task execution requires its own supported adapter and explicit scoped test contract; do not report “End-to-end passed” after saving metadata.

## 18. Extensibility through platform, project and runtime

### 18.1 One definition, consistent consumers

| Consumer | Uses from the template | Must not invent |
|---|---|---|
| Platform catalog | Identity, version, implemented operations/auth and limits | Live health from catalog descriptions. |
| Project connector editor | Shared sections + provider schema + authorized references | Per-page field definitions that diverge from backend validation. |
| Parameter Setup | Typed editable parameters, source layer, units and constraints | A second independent store for endpoint/auth values. |
| Environment visualization | Validated instance/binding relationships | Fake links or inferred credential sharing. |
| Monitoring builder | Supported query schema, fields, operators and trigger modes | Polling/webhooks for unsupported providers. |
| Data tab | Real source/refresh/artifact records | Successful ingestion from saved configuration alone. |
| Agent/capability selectors | Approved operation registry and dependency readiness | Automatic permissions from an imported tool name. |
| YAML review/import | Versioned typed instances and references | Raw secrets, executable hooks or client-controlled authorization. |
| Runtime resolver | Authorized scope, approved adapter/auth/binding, effective limits | Arbitrary classes, processes or destinations from YAML. |

### 18.2 Instance resolution

Resolve: authenticated deployment scope → published template/version → platform enablement → project instance → selected environment binding → permitted auth/resource references → supported operation → typed ADK tool.

Failure at any required stage blocks that operation with a specific reason. Project enablement can narrow platform availability, never broaden it. A new display template alone does not create a provider.

### 18.3 Adding a connector or auth type

1. Reuse an existing adapter and auth profile when their actual protocol and scope behavior match.
2. If missing, implement the bounded provider and typed domain operation first; keep credentials and network calls in providers.
3. Add a declarative template and supported authentication profiles with backend-validated conditional fields.
4. Register input/output schemas, scope strategy, test operation, evidence/citation model and precise limitations.
5. Verify a real authorized connection before enabling it in deployment; offline tests remain labeled offline.
6. Publish a version. Generic project forms, parameter views, mapping views and capability selectors consume that version without handcoded connector pages.
7. For later changes, preview affected instances, migrate drafts, retest dependencies and activate by expected revision.

### 18.4 Consistent value precedence

Platform schema/policy limits constrain all layers. For overridable values: template default → explicitly saved platform setting → permitted project override → permitted environment-binding value. Server-owned identity/scope and platform deny rules do not participate in an override chain.

The schema must declare whether lists merge, replace, or narrow. Proposed defaults: resource allowlists can only narrow; credential references replace as a whole; Jira fields merge by stable ID with conflict rejection; auth profiles replace as a coherent validated object. Empty, false and zero values must retain their typed meanings.

## 19. Acceptance criteria

| ID | Expected review/test outcome |
|---|---|
| CT-01 | Every connector exposes the three mandatory project-only fields and consistent shared sub-tabs. |
| CT-02 | Platform disablement prevents project use, including direct API attempts and stale saved configurations. |
| CT-03 | Auth selection renders only profile-relevant fields; unsupported combinations fail server validation. |
| CT-04 | Jira uses the correct Basic email/token contract; header-key providers use the correct locked header. |
| CT-05 | Secrets never appear in exports, preview results, validation errors or audit diffs. |
| CT-06 | Two environment bindings resolve independently to the authorized resource and credential; neither can overwrite fixed scope. |
| CT-07 | Field discovery/mapping merges inherited and project Jira fields with explicit collision errors. |
| CT-08 | A connector template cannot expose a working scheduler, query builder or write action absent its runtime operation. |
| CT-09 | Instance draft save, reload, parameter view and YAML review show the same effective typed values. |
| CT-10 | A template upgrade produces a diff and migration results; failure leaves the prior active revision effective. |
| CT-11 | Auth/resource changes invalidate tests; stale revisions cannot satisfy enablement gates. |
| CT-12 | New MCP tools remain non-executable until approved/bound; conflicting scope mappings are rejected. |
| CT-13 | Runbook selection preserves artifact version citations and scope; failed/archived content is excluded from new default retrieval. |
| CT-14 | Connector-specific limitations remain visible: detector definitions, root-level tests, deployment correlation, metadata-only Kafka, SFTP tail and pod-status-only Kubernetes. |
| CT-15 | Database activation and arbitrary command/script execution remain blocked under current release rules. |
| CT-16 | An additional implemented connector renders from the same form contract without a dedicated hardcoded page. |
| CT-17 | Credential tests distinguish unavailable credentials, auth failure and insufficient scoped permissions where observable; successful empty reads remain successes. |
| CT-18 | For every published auth profile, vary every conditional branch; form and server agree on mandatory, optional, hidden and derived fields. Missing conditional credentials fail before any connection attempt. |
| CT-19 | Change from password/token to workload identity or None; inactive credential fields are excluded and never sent. Auth selection cannot bypass platform policy. |
| CT-20 | Test unsaved candidate credentials against the real target; return a persisted result for that candidate while the active instance remains unchanged. |
| CT-21 | Test all enabled environment bindings; one environment's passing result cannot enable another failed or untested binding. |
| CT-22 | Configure a supported combination of mTLS and application auth; both sets of required fields render and both are checked without a mutually exclusive auth-dropdown limitation. |
| CT-23 | For a published OAuth profile, exercise acquisition/consent, expiry and refresh/reconnect; no resolved token or authorization code appears in exported configuration or logs. |
| CT-24 | Force trust/auth/permission/timeout/rate/schema failures and a valid empty read; the panel reports truthful stage-specific outcomes without synthetic success. |
| CT-25 | A form cannot publish an auth method without its runtime adapter and real test contract; adding a new complete auth profile requires no custom project page. |
| CT-26 | Unix is the connector type; entering Tuxedo as System Name preserves connector identity and operation permissions. |
| CT-27 | PuTTY Password/PPK selections show only applicable fields; encrypted PPK requires a passphrase, host trust is enforced, and a real approved SFTP read verifies access. |
| CT-28 | Oracle Thin omits client-library loading; Thick validates the registered `oracle_client_lib`/loader profile and compatible runtime. Local tests do not silently change a shared process's driver mode or enable production queries. |
| CT-29 | Kafka include/exclude filters select only authorized names; zero matches stays empty; excess matches require narrowing; per-topic errors and aggregate limits remain visible. |
| CT-30 | Every connector/MCP instance starts with its connector display name as editable System Name; saved/user-edited names survive catalog changes. Duplicate project names require an edit. Both environment fields require explicit selection before test/enable; incomplete drafts remain saveable. |
| CT-31 | Two MCP instances with the same remote tool name remain distinct by stable instance/binding identity and appear under their respective System Names; renaming does not rebind execution. |
| CT-32 | Jira field setup merges platform and project definitions by canonical ID, validates actual provider metadata and previews permitted selected values without creating remote Jira fields. |
| CT-33 | Jira-associated local files or selected project artifacts produce real bounded extracted evidence and per-file outcomes; required failures block execution, optional failures show partial coverage, and bytes are never fetched from arbitrary URLs. |

## 20. Decisions and implementation discrepancies for review

| Topic | Finding / proposed decision |
|---|---|
| Jira authentication | Catalog says Bearer; native source uses Basic email + token. Proposed: fix catalog semantics to the implemented profile before using it as a form source. |
| Example defaults | Catalog contains sample hosts, accounts, project keys and indexes. Proposed: convert them to nonpersistent help text. |
| Scope and project instances | Current provider configuration is largely deployment-owned. Proposed multi-instance/environment binding UI needs corresponding authorized runtime resolution; do not merely add frontend arrays. |
| Database scope | Local connection/authentication testing is now requested. Keep production query enablement separate; support explicit Thin and Thick local profiles with correct library/runtime handling. |
| Kafka / Unix catalog | Catalog descriptions emphasize MCP evidence; native source uses Kafka metadata and SFTP. Publish separate transport profiles with accurate auth and limits. |
| Secret references | Generic registration/evidence paths support references differently from native Oracle/Kafka/Unix environment/file credentials. Add a consistent resolver before claiming a universal project secret picker. |
| OAuth, mTLS, workload identity | Proposed extension contracts. Prioritize only those required by real deployment targets; do not present as supported today. |
| MCP project additions | Proposed: allow scoped registration/request, but require platform-enabled approved bindings for automatic framework visibility. |
| stdio | Existing schema accepts command configurations. Current no-new-code-execution rule still applies; do not add unrestricted project process launch. |
| Automatic schedules | Durable worker, ingestion state, retry/recovery, inbound webhook auth and real history must precede enabled controls. |
| Notifications | Teams/Slack are project communication requirements, not members of the current connector catalog. Add explicit outbound notification templates only with approved delivery providers; do not hide them inside read-only evidence connectors. |
| Validation thresholds | Agree template field lengths, auth lifecycle requirements, per-provider supported deployment versions, and activation test freshness before implementation. |

## 21. Source references

- [Connector templates](../blob_local/platform/config/connector_templates.yaml): current catalog descriptions, labels and reference defaults.
- [Runtime connector configuration](../blob_local/platform/config/connectors.yaml): checked-in enablement and bounds.
- [Registry](../app/connectors/providers/registry.py): adapter factories, MCP operation bindings, options and selected runtime parameter mapping.
- [Jira](../app/connectors/providers/jira.py) and [Splunk](../app/connectors/providers/splunk.py): native connection/auth and scoped read behavior.
- [Evidence providers](../app/connectors/providers/evidence.py): Confluence, SignalFx, qTest, GitLab and Kubernetes operations/auth headers.
- [Infrastructure providers](../app/connectors/providers/infrastructure.py): native Kafka and Unix/SFTP behavior.
- [Oracle](../app/connectors/providers/oracle.py): fixed session query, distinct from current release authorization.
- [MCP evidence](../app/connectors/providers/mcp_evidence.py): approved tool invocation and fixed scope binding.
- [Integration definitions](../app/configuration/integrations.py) and [MCP import](../app/configuration/mcp_import.py): registration schema, auth choices and revision rules.
- [File upload](../app/api/routes/files.py) and [bounded parsing](../app/inputs/files.py): reusable foundations for the proposed project artifact library.
- [Repository guidance](../AGENTS.md): architecture, authorization, local upload, code-execution and delivery constraints.

This document is a requirements proposal grounded in local source inspection. It does not certify vendor API compatibility, live credentials, production enablement or runtime health.
