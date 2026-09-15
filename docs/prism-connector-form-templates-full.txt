# PRISM connector form templates

Ten connector forms • Authentication research checked 14 September 2026

This specification expands the supplied Jira, Confluence, Splunk, SignalFx and qTest forms and adds GitLab, Kafka, Kubernetes, Oracle and Unix. It is a proposed PRISM form design, not a claim that these capabilities are already implemented. Vendor authentication facts are linked beside the applicable profiles; visibility, icons, defaults and override policies are proposed product decisions.

## How to read the tables

Every field table has ten columns, including Mandatory / Optional, Applies When / Dependency, Default Value and Allowed Values. Evaluate these together: a field is required only when its dependency is satisfied. Hidden fields are inactive and are not submitted or validated. Icon values are suggested semantic icon names, not required library dependencies.

- **Platform only = Yes:** hidden from project forms and project configuration responses. Managed by platform administrators; Project Override is always Disable.
- **Platform only = No, Override = Enable:** visible to the project with an inherited platform default. An authorized project administrator may override it within platform limits. Provide “Use platform default” and “Override” controls.
- **Platform only = No, Override = Disable:** an inherited field is read-only. In **Project Setup** and its report editor, it is instead a project-owned editable value; Disable means inheritance override does not apply.
- Authentication fields are platform-only. Projects can select a preapproved connection binding without seeing its endpoint, credential contents or secret identifiers. Project-specific identities are separate platform-managed bindings.
- Defaults below are proposed PRISM form defaults, not vendor defaults, unless explicitly described as system-derived or protocol-defined. Numeric ranges are proposed PRISM ceilings and may be reduced by platform policy. Mandatory fields with no default must be completed before the applicable feature is activated; an empty optional list never broadens access. Inherited values use the platform configuration once provisioned. Repeated endpoint or identity labels within a form refer to the same bound control, not duplicate independently editable values. Mandatory / Optional states whether an input is required, conditionally required, optional, or system-managed. Allowed Values lists fixed options or the validated source/registry catalog for dynamic choices. Only fields for the active authentication method are shown and validated. Secret references open a masked credential picker/create dialog; saved secret values are never returned to the form.
- Boolean field values and override permissions are separate: a capability can currently be disabled while Project Override is Enable.

## Access and inheritance behavior

A project can narrow platform resource scope, role access and capabilities, but cannot widen them. Effective authorization is the intersection of platform policy, project policy, PRISM user permissions, upstream credentials, and the selected direct/MCP route. Write Access alone never enables a specific write operation. Minimum Role assumes a defined PRISM role hierarchy; otherwise use an explicit allowed-role selector.

Per-tool rules may assign separate platform-managed credentials for read and write operations. Native grants and MCP tool availability must be checked per operation. Capability classification is platform-managed and cannot be changed from Write to Read by a project. All capabilities start disabled until validated and enabled by a platform administrator. Read access can be enabled independently; write, execution and data-export capabilities remain separate decisions. Rate, size, timeout and result overrides stay within platform ceilings. Generic Viewer Access means authorized project viewers can see permitted results; it never means public access or bypassing source permissions.

## Multiple environments per connector

Every connector contains a repeatable **Environment Connections** collection. **Add Environment** opens the connector-specific connection and authentication form for another environment. Target fields and secret bindings are stored on the selected environment connection, not as one shared login for all environments.

For Unix password login, an environment record contains **Environment Name, Host Name / IP Address, Port (default 22), Username, Password, host trust configuration and connection-test status**. Selecting key login replaces Password with Private Key and conditional Key Passphrase. Additional Unix hosts may use additional connection records under the same environment label. For example, QA can have both `unix-qa-app01` and `unix-qa-app02`, with separately assigned identities.

The same pattern applies to all connectors: Jira/Confluence/qTest/GitLab use per-environment sites or instances; Splunk uses the environment's API target and index scope; SignalFx uses realm, organization and dimension scope; Kafka uses bootstrap servers, security profile and topic/group scope; Kubernetes uses the cluster API target and identity; Oracle uses database target/service and login profile. MCP routes likewise use an environment-specific endpoint and authentication binding.

Each project environment maps to one or more assigned Environment Connection IDs. Each tool has its own allowed environment connections and per-environment credential mapping. A tool may have read access in PROD and write access in QA through different approved bindings. Its effective gates and role permissions are evaluated for the selected environment; credentials and permissions are never copied automatically to a newly added environment. For environment-independent connections, multiple project environments may reference the same explicitly assigned connection record.

## Direct and MCP access

Every connector form includes **Access Mode = Direct / MCP / Hybrid**. MCP means that PRISM accesses the tool through a compatible MCP server. It does not mean every vendor has a universal hosted MCP endpoint or that a configured server exposes every native capability.

There are two distinct connections: **PRISM → MCP server**, authenticated using the server's accepted method; and **MCP server → underlying tool**, authenticated with native credentials managed by that server or a supported delegated identity flow. Do not automatically forward an MCP access token to the underlying API. In Hybrid mode, assign each capability an explicit route and credential binding; no silent fallback between identities.

The MCP block in every form references the detailed shared MCP authentication profiles at the end of this document. Vendor-specific MCP profiles take precedence over the shared extension profiles.

## Forms

- [Jira](#jira)
- [Confluence](#confluence)
- [Splunk](#splunk)
- [SignalFx](#signalfx)
- [qTest](#qtest)
- [GitLab](#gitlab)
- [Kafka](#kafka)
- [Kubernetes](#kubernetes)
- [Oracle](#oracle)
- [Unix](#unix)

<a id="jira"></a>

## Jira

Connect PRISM to Jira Cloud for incident search, related-ticket investigation, and controlled issue creation or updates.

Connector icon: **ticket**.

### Basic Information

General details and connection routing for Jira. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Jira | Jira | Fixed to Jira. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (REST API), MCP, or Hybrid. | route | Yes | Disable |
| Jira Site URL | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for direct REST. Jira Cloud site; OAuth/scoped-token gateway routing is resolved by the authentication profile. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |
| Backend API Version | Read-only text | System-managed (fixed) | Applicable connector form section | 3 | 3 for the Jira Cloud direct adapter | Direct Jira Cloud adapter uses REST v3. | code | Yes | Disable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with Jira, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### REST — Email + API Token

Use for an approved API-token integration. The API token is the password component of HTTP Basic authentication; it is not a separate Basic-password profile.

Source: [Atlassian Jira Basic authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Account Email | Email | Mandatory for the selected account API-token profile | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server). Selected account-token method uses email + token; hidden for service-account Bearer API keys | No default; leave unset | Valid account email address | Required. Atlassian account that owns the token. | user | Yes | Disable |
| API Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Store the token in the credential vault. | key | Yes | Disable |
| Token Routing | Select | Mandatory for selected profile | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server). Account API-token REST profile; selection follows token type | No default | Site URL; Scoped-token gateway (match token type) | Required. Site URL or scoped-token gateway; match issued token requirements. | route | Yes | Disable |
| Cloud ID | Text | Conditional mandatory — see Description | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server). Selected token/gateway route requires a cloud ID | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required when the selected gateway route needs the site cloud ID. | cloud | Yes | Disable |

#### REST — OAuth 2.0 Authorization Code (3LO)

Register the integration, obtain user consent, exchange the authorization code, and retain the returned token set. Request offline access when scheduled work needs refresh tokens.

Source: [Atlassian REST OAuth 2.0 (3LO)](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Registered application identifier. | fingerprint | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server). Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for a confidential client; omit for a supported public client. | lock | Yes | Disable |
| Redirect URI | URL | Mandatory for selected profile | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Exact registered callback; HTTPS, or loopback HTTP only when supported by the OAuth flow | Required. Exact callback registered for this application. | link | Yes | Disable |
| Requested Scopes | Multi-select | Mandatory for selected profile | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | No default — derive from enabled operations and selected provider | Scopes supported by the active REST — OAuth 2.0 Authorization Code (3LO) and required by enabled tools; requesting scopes does not grant them | Required. Select scopes needed for enabled operations. | list-checks | Yes | Disable |
| Connected Account | Read-only identity | System-managed (no user input) | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Populated after consent; identifies whose permissions apply. | user | Yes | Disable |
| Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access and refresh tokens; never entered as ordinary text. | key | Yes | Disable |
| Token Expiry | Read-only datetime | System-managed (no user input) | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated from token response; reauthorization shown if renewal fails. | clock | Yes | Disable |

#### MCP — OAuth 2.1

Show only when MCP is selected. Connect through the MCP authorization flow; do not reuse REST OAuth settings automatically.

Source: [Atlassian MCP authentication](https://support.atlassian.com/atlassian-ai-gateway/docs/authentication-and-authorization/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | https://mcp.atlassian.com/v2/mcp | Valid approved HTTPS URL without embedded credentials | Required. Approved endpoint; Atlassian documents https://mcp.atlassian.com/v2/mcp. | link | Yes | Disable |
| Client Registration | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | No default | Server-supported registration modes: pre-registered or dynamic | Required. Registration mode supported by the MCP server and client. | app-window | Yes | Disable |
| OAuth Client Configuration | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Registered client metadata and callback configuration. | settings | Yes | Disable |
| Connected Account | Read-only identity | System-managed (no user input) | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Populated after the browser authorization flow. | user | Yes | Disable |
| OAuth Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access/refresh credentials and expiry metadata. | key | Yes | Disable |

#### MCP — API Token / API Key

Show only when the organization permits this method. Credential format determines the authorization header; available tools depend on token scopes.

Source: [Atlassian MCP API-token configuration](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-authentication-via-api-token/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | https://mcp.atlassian.com/v2/mcp | Valid approved HTTPS URL without embedded credentials | Required. Approved Atlassian MCP endpoint. | link | Yes | Disable |
| Credential Kind | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route | No default | Account API token; Supported service-account API key | Required. Account API token or supported service-account API key. | list | Yes | Disable |
| Account Email | Email | Mandatory for the selected account API-token profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route. Selected account-token method uses email + token; hidden for service-account Bearer API keys | No default; leave unset | Valid account email address | Required for account API-token Basic authentication. | user | Yes | Disable |
| Token / API Key | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Basic email:token for account tokens; Bearer for the documented API-key flow. | key | Yes | Disable |

Legacy app note: JWT belongs to an existing Atlassian Connect installation, not a generic API-token field. Offer a separate legacy adapter only if PRISM already supports that app lifecycle; its installation identity and shared secret must be managed by the installation flow. Webhooks are configured under Project Setup, independently of outbound authentication.

### MCP Access

Atlassian Rovo MCP has documented access for Jira. Use the method-specific MCP profiles above. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | https://mcp.atlassian.com/v2/mcp | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Default Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default historical search window. | history | No | Enable |
| Attachment Processing Mode | Select | Optional | Applicable connector form section | Disabled | Disabled; Metadata only; Text extraction | Disabled, metadata only, or text extraction. | paperclip | No | Enable |
| Max Ticket Results | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Maximum tickets returned per investigation. | list | No | Enable |
| Saved JQL Filter | Query editor | Optional | Applicable connector form section | No default; leave unset | Validated connector query or approved query template; assigned resources only | Default JQL, always constrained to permitted project keys. | search | No | Enable |
| Allow Dynamic JQL | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Allow validated runtime filters within scope. | code | No | Enable |
| Search Fields | Multi-select | Optional | Applicable connector form section | [] | Verified Jira fields within the assigned projects | Fields included in retrieval and matching. | list | No | Enable |
| Include Comments | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Include authorized issue comments. | message-square | No | Enable |
| Include Linked Issues | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Follow links only to permitted issues. | link | No | Enable |
| Include qTest Links | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Resolve links using an authorized qTest connection. | link | No | Enable |
| Historically Related Tickets | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Include earlier incidents within permitted scope. | history | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Jira project keys. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map standard incident fields to verified Jira fields; custom fields must match customfield_[0-9]+. Show All Fields, Common Fields and Project Custom Fields tabs.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Project Keys | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Jira keys permitted for this PRISM project. | folder | No | Disable |
| Monitoring JQL | Query editor | Mandatory when Jira monitoring is enabled | Project form only | No default; leave unset | Validated connector query or approved query template; assigned resources only | Project monitoring filter; validated against allowed keys. | search | No | Disable |
| Default Write Project Key | Select | Conditional mandatory — see Description | Project form only. Jira Create Issue capability and Write Access are enabled | No default | One value from this project’s selected Jira Project Keys | Required if issue creation is enabled; one selected project key. | pencil | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Search Issues | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable search issues within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Issue Details | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read issue details within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Comments | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read comments within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Attachments | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read attachments within assigned resources; default Disable. | toggle-right | No | Enable |
| Create Issue | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable create issue within assigned resources; default Disable. | toggle-right | No | Enable |
| Update Issue | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable update issue within assigned resources; default Disable. | toggle-right | No | Enable |
| Add Comment | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable add comment within assigned resources; default Disable. | toggle-right | No | Enable |
| Transition Issue | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable transition issue within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Search Issues | jira.search_issues | Required | Not required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Read Issue Details | jira.read_issue_details | Required | Not required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Read Comments | jira.read_comments | Required | Not required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Read Attachments | jira.read_attachments | Required | Not required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Create Issue | jira.create_issue | Not required | Required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Update Issue | jira.update_issue | Not required | Required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Add Comment | jira.add_comment | Not required | Required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |
| Transition Issue | jira.transition_issue | Not required | Required | Not required | Disable | Enable; Disable | Assigned Jira project/issue; source issue permissions for this operation |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

Backend note: use Jira Cloud REST v3 and enhanced JQL search at /rest/api/3/search/jql. Rich-text issue fields handled by v3 must use Atlassian Document Format where required. Source: [Jira REST v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/), [enhanced JQL search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/).

<a id="confluence"></a>

## Confluence

Connect PRISM to Confluence Cloud to search knowledge, retrieve page context, and publish controlled documentation updates.

Connector icon: **book-open**.

### Basic Information

General details and connection routing for Confluence. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Confluence | Confluence | Fixed to Confluence. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (REST API), MCP, or Hybrid. | route | Yes | Disable |
| Confluence Site URL | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for direct REST. Site URL; adapter resolves wiki API paths and authentication-dependent routing. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with Confluence, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### REST — Email + API Token

Use for an approved API-token integration. The API token is the password component of HTTP Basic authentication; it is not a separate Basic-password profile.

Source: [Atlassian Confluence Basic authentication](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Account Email | Email | Mandatory for the selected account API-token profile | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server). Selected account-token method uses email + token; hidden for service-account Bearer API keys | No default; leave unset | Valid account email address | Required. Atlassian account that owns the token. | user | Yes | Disable |
| API Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Store the token in the credential vault. | key | Yes | Disable |
| Token Routing | Select | Mandatory for selected profile | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server). Account API-token REST profile; selection follows token type | No default | Site URL; Scoped-token gateway (match token type) | Required. Site URL or scoped-token gateway; match issued token requirements. | route | Yes | Disable |
| Cloud ID | Text | Conditional mandatory — see Description | Selected environment connection. Active profile = REST — Email + API Token; Direct route (or native upstream profile managed by an MCP server). Selected token/gateway route requires a cloud ID | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required when the selected gateway route needs the site cloud ID. | cloud | Yes | Disable |

#### REST — OAuth 2.0 Authorization Code (3LO)

Register the integration, obtain user consent, exchange the authorization code, and retain the returned token set. Request offline access when scheduled work needs refresh tokens.

Source: [Atlassian REST OAuth 2.0 (3LO)](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Registered application identifier. | fingerprint | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server). Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for a confidential client; omit for a supported public client. | lock | Yes | Disable |
| Redirect URI | URL | Mandatory for selected profile | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Exact registered callback; HTTPS, or loopback HTTP only when supported by the OAuth flow | Required. Exact callback registered for this application. | link | Yes | Disable |
| Requested Scopes | Multi-select | Mandatory for selected profile | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | No default — derive from enabled operations and selected provider | Scopes supported by the active REST — OAuth 2.0 Authorization Code (3LO) and required by enabled tools; requesting scopes does not grant them | Required. Select scopes needed for enabled operations. | list-checks | Yes | Disable |
| Connected Account | Read-only identity | System-managed (no user input) | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Populated after consent; identifies whose permissions apply. | user | Yes | Disable |
| Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access and refresh tokens; never entered as ordinary text. | key | Yes | Disable |
| Token Expiry | Read-only datetime | System-managed (no user input) | Selected environment connection. Active profile = REST — OAuth 2.0 Authorization Code (3LO); Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated from token response; reauthorization shown if renewal fails. | clock | Yes | Disable |

#### MCP — OAuth 2.1

Show only when MCP is selected. Connect through the MCP authorization flow; do not reuse REST OAuth settings automatically.

Source: [Atlassian MCP authentication](https://support.atlassian.com/atlassian-ai-gateway/docs/authentication-and-authorization/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | https://mcp.atlassian.com/v2/mcp | Valid approved HTTPS URL without embedded credentials | Required. Approved endpoint; Atlassian documents https://mcp.atlassian.com/v2/mcp. | link | Yes | Disable |
| Client Registration | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | No default | Server-supported registration modes: pre-registered or dynamic | Required. Registration mode supported by the MCP server and client. | app-window | Yes | Disable |
| OAuth Client Configuration | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Registered client metadata and callback configuration. | settings | Yes | Disable |
| Connected Account | Read-only identity | System-managed (no user input) | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Populated after the browser authorization flow. | user | Yes | Disable |
| OAuth Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access/refresh credentials and expiry metadata. | key | Yes | Disable |

#### MCP — API Token / API Key

Show only when the organization permits this method. Credential format determines the authorization header; available tools depend on token scopes.

Source: [Atlassian MCP API-token configuration](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-authentication-via-api-token/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | https://mcp.atlassian.com/v2/mcp | Valid approved HTTPS URL without embedded credentials | Required. Approved Atlassian MCP endpoint. | link | Yes | Disable |
| Credential Kind | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route | No default | Account API token; Supported service-account API key | Required. Account API token or supported service-account API key. | list | Yes | Disable |
| Account Email | Email | Mandatory for the selected account API-token profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route. Selected account-token method uses email + token; hidden for service-account Bearer API keys | No default; leave unset | Valid account email address | Required for account API-token Basic authentication. | user | Yes | Disable |
| Token / API Key | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP — API Token / API Key; MCP route | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Basic email:token for account tokens; Bearer for the documented API-key flow. | key | Yes | Disable |

Legacy app note: JWT belongs to an existing Atlassian Connect installation, not a generic API-token field. Offer a separate legacy adapter only if PRISM already supports that app lifecycle; its installation identity and shared secret must be managed by the installation flow. Webhooks are configured under Project Setup, independently of outbound authentication.

### MCP Access

Atlassian Rovo MCP has documented access for Confluence. Use the method-specific MCP profiles above. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | https://mcp.atlassian.com/v2/mcp | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Default Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default modified-content window. | history | No | Enable |
| Max Page Results | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Maximum pages per search. | list | No | Enable |
| Saved CQL Filter | Query editor | Optional | Applicable connector form section | No default; leave unset | Validated connector query or approved query template; assigned resources only | Default content query constrained by selected spaces. | search | No | Enable |
| Allow Dynamic CQL | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Permit runtime filters within project scope. | code | No | Enable |
| Include Child Pages | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Traverse permitted child pages. | files | No | Enable |
| Include Comments | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Retrieve authorized comments. | message-square | No | Enable |
| Attachment Processing Mode | Select | Optional | Applicable connector form section | Disabled | Disabled; Metadata only; Text extraction | Disabled, metadata only, or text extraction. | paperclip | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Confluence spaces. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map title, body, labels, page ID, URL, owner and modified timestamp to PRISM knowledge fields.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Space Keys / IDs | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Select accessible spaces; these are not Jira project keys. | folder | No | Disable |
| Default Write Space | Select | Conditional mandatory — see Description | Project form only. Confluence Create Page capability and Write Access are enabled | No default | One value from this project’s selected Confluence spaces | Required for page creation; selected space only. | pencil | No | Disable |
| Parent Page ID | Text | Optional | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Optional default parent in the write space. | file | No | Disable |
| Monitoring CQL | Query editor | Mandatory when Confluence monitoring is enabled | Project form only | No default; leave unset | Validated connector query or approved query template; assigned resources only | Project-specific page monitoring query. | search | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Search Pages | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable search pages within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Pages | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read pages within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Attachments | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read attachments within assigned resources; default Disable. | toggle-right | No | Enable |
| Create Page | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable create page within assigned resources; default Disable. | toggle-right | No | Enable |
| Update Page | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable update page within assigned resources; default Disable. | toggle-right | No | Enable |
| Add Comment | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable add comment within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Search Pages | confluence.search_pages | Required | Not required | Not required | Disable | Enable; Disable | Assigned space/page; source content permissions for this operation |
| Read Pages | confluence.read_pages | Required | Not required | Not required | Disable | Enable; Disable | Assigned space/page; source content permissions for this operation |
| Read Attachments | confluence.read_attachments | Required | Not required | Not required | Disable | Enable; Disable | Assigned space/page; source content permissions for this operation |
| Create Page | confluence.create_page | Not required | Required | Not required | Disable | Enable; Disable | Assigned space/page; source content permissions for this operation |
| Update Page | confluence.update_page | Not required | Required | Not required | Disable | Enable; Disable | Assigned space/page; source content permissions for this operation |
| Add Comment | confluence.add_comment | Not required | Required | Not required | Disable | Enable; Disable | Assigned space/page; source content permissions for this operation |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

Backend note: use supported Confluence Cloud v2 content endpoints; resolve CQL/search through the documented endpoint supported by the adapter. Source: [Confluence REST v2](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/).

<a id="splunk"></a>

## Splunk

Connect PRISM to Splunk Platform for scoped log search, saved-search execution, and incident evidence retrieval.

Connector icon: **search**.

### Basic Information

General details and connection routing for Splunk. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Splunk | Splunk | Fixed to Splunk. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (REST API), MCP, or Hybrid. | route | Yes | Disable |
| Splunk Management API URL | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for REST. Deployment REST endpoint; distinct from the Splunk Web presentation URL. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with Splunk, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### REST — Splunk Authentication Token

Use a native Splunk authentication token for REST requests with a Bearer header.

Source: [Splunk REST authentication](https://help.splunk.com/en/splunk-enterprise/leverage-rest-apis/rest-api-user-manual/9.0/rest-api-user-manual/basic-concepts-about-the-splunk-platform-rest-api).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Authentication Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = REST — Splunk Authentication Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Native REST token, not an MCP encrypted token or HEC token. | key | Yes | Disable |
| Token Owner | Text | Optional | Selected environment connection. Active profile = REST — Splunk Authentication Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Optional account label for administration. | user | Yes | Disable |
| Token Expiry | Datetime | Optional | Selected environment connection. Active profile = REST — Splunk Authentication Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Non-empty text when supplied; validate against source configuration | Optional recorded expiry, or discovered metadata. | clock | Yes | Disable |

#### REST — Basic Username + Password

Show only where this deployment allows Basic authentication. The account still requires the relevant Splunk roles and capabilities.

Source: [Splunk REST authentication](https://help.splunk.com/en/splunk-enterprise/leverage-rest-apis/rest-api-user-manual/9.0/rest-api-user-manual/basic-concepts-about-the-splunk-platform-rest-api).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Username | Text | Mandatory for selected profile | Selected environment connection. Active profile = REST — Basic Username + Password; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Splunk account name. | user | Yes | Disable |
| Password | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = REST — Basic Username + Password; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Account password. | lock | Yes | Disable |

#### MCP — Encrypted Token

Generate an encrypted token in the Splunk MCP Server app. This token is specific to MCP and cannot authenticate direct REST requests.

Source: [Splunk MCP token setup](https://help.splunk.com/en/splunk-enterprise/mcp-server-for-splunk-platform/1.0/connecting-to-the-mcp-server-and-settings).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — Encrypted Token; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default — use verified server endpoint | Valid approved HTTPS URL without embedded credentials | Required. Copy from the installed MCP app. | link | Yes | Disable |
| Encrypted MCP Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP — Encrypted Token; MCP route | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Send as the MCP Bearer credential. | key | Yes | Disable |
| MCP App Version | Read-only text | System-managed (no user input) | Selected environment connection. Active profile = MCP — Encrypted Token; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Discovered or administrator-verified compatibility information. | info | Yes | Disable |

#### MCP — OAuth 2.1

Show only for supported Splunk Cloud deployments and MCP app versions/regions. Follow the server-advertised authorization settings.

Source: [Splunk MCP OAuth](https://help.splunk.com/en/splunk-enterprise/mcp-server-for-splunk-platform/1.2/oauth-for-mcp-server).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default — use verified server endpoint | Valid approved HTTPS URL without embedded credentials | Required. Deployment endpoint. | link | Yes | Disable |
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route. Required when using a registered client | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required when using a registered client. | fingerprint | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route. Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Only if the registered client requires it. | lock | Yes | Disable |
| Redirect URI | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | No default; leave unset | Exact registered callback; HTTPS, or loopback HTTP only when supported by the OAuth flow | Required. Match registered client configuration. | link | Yes | Disable |
| Requested Scopes | Multi-select | Optional | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | No default — derive from enabled operations and selected provider | Scopes supported by the active MCP — OAuth 2.1 and required by enabled tools; requesting scopes does not grant them | Use scopes supported by the deployment; do not hardcode generic OIDC scopes. | list-checks | Yes | Disable |
| OAuth Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = MCP — OAuth 2.1; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated after authorization; includes renewal metadata. | key | Yes | Disable |

Browser SAML/SSO and authentication scripts are deployment identity configuration, not interchangeable connector credential profiles. A webhook or HEC ingestion token also does not grant search access.

### MCP Access

Splunk Platform MCP is documented. Its encrypted tokens and OAuth profiles are distinct from direct REST authentication. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Default Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default log-search time range. | history | No | Enable |
| Saved SPL Query | Query editor | Optional | Applicable connector form section | No default; leave unset | Validated connector query or approved query template; assigned resources only | Default validated SPL constrained to permitted indexes. | search | No | Enable |
| Allow Dynamic SPL | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Allow supported queries within the enforced scope. | code | No | Enable |
| Maximum Search Results | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Limit returned events. | list | No | Enable |
| Search Job Timeout | Duration | Optional | Applicable connector form section | 60 seconds | Duration 1–300 seconds | Maximum time waiting for completion. | timer | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Splunk indexes. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map timestamp, host, source, sourcetype, severity, message and correlation ID to incident evidence.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Allowed Indexes | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Subset of platform-approved indexes. | database | No | Disable |
| Wildcard Allowed | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Default Disable. Patterns may resolve only within platform scope. | asterisk | No | Disable |
| Monitoring SPL | Query editor | Mandatory when Splunk monitoring is enabled | Project form only | No default; leave unset | Validated connector query or approved query template; assigned resources only | Project log-monitoring search. | search | No | Disable |
| Saved Search References | Multi-select | Optional | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Select approved saved searches. | bookmark | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Run Read-Only Search | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable run read-only search within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Search Results | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read search results within assigned resources; default Disable. | toggle-right | No | Enable |
| Run Approved Saved Search | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable run approved saved search within assigned resources; default Disable. | toggle-right | No | Enable |
| Create Saved Search | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable create saved search within assigned resources; default Disable. | toggle-right | No | Enable |
| Update Saved Search | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable update saved search within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Run Read-Only Search | splunk.run_read_only_search | Required | Not required | Not required | Disable | Enable; Disable | Assigned indexes/search objects; credential has required Splunk search or management capabilities |
| Read Search Results | splunk.read_search_results | Required | Not required | Not required | Disable | Enable; Disable | Assigned indexes/search objects; credential has required Splunk search or management capabilities |
| Run Approved Saved Search | splunk.run_approved_saved_search | Required | Not required | Required | Disable | Enable; Disable | Approved read-only saved search. Mutating saved searches require a separately classified Write + Execute rule |
| Create Saved Search | splunk.create_saved_search | Not required | Required | Not required | Disable | Enable; Disable | Assigned indexes/search objects; credential has required Splunk search or management capabilities |
| Update Saved Search | splunk.update_saved_search | Not required | Required | Not required | Disable | Enable; Disable | Assigned indexes/search objects; credential has required Splunk search or management capabilities |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

<a id="signalfx"></a>

## SignalFx

Connect PRISM to Splunk Observability Cloud (SignalFx) for metrics, detector alerts, SignalFlow analysis, and infrastructure health.

Connector icon: **activity**.

### Basic Information

General details and connection routing for SignalFx. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | SignalFx | SignalFx | Fixed to SignalFx. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (REST / SignalFlow), MCP, or Hybrid. | route | Yes | Disable |
| API Endpoint | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for direct access. Copy the realm-specific API URL from organization settings. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |
| Realm | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Organization realm, such as us0. | globe | Yes | Disable |
| Organization ID | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Organization identifier. | building | Yes | Disable |
| Streaming Analytics Endpoint | URL | Conditional mandatory — see Description | Applicable connector form section. SignalFlow streaming is enabled on the Direct route | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for streaming; copy realm-specific stream URL. | activity | Yes | Disable |
| Real-time Ingest Endpoint | URL | Optional | Applicable connector form section. SignalFx Ingest Metrics is enabled on the Direct route | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required only when metric ingestion is enabled. | upload | Yes | Disable |
| Historical Backfill Endpoint | URL | Optional | Applicable connector form section. SignalFx Backfill Metrics is enabled on the Direct route | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required only when backfill is enabled. | history | Yes | Disable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with SignalFx, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### REST / SignalFlow — Organization Access Token

Use a token with the permissions required by the selected API or ingestion operation.

Source: [Organization access tokens](https://help.splunk.com/en/splunk-observability-cloud/administer/authentication-and-security/authentication-tokens/org-access-tokens).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Organization Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = REST / SignalFlow — Organization Access Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Sent in X-SF-TOKEN. | key | Yes | Disable |
| Token Permissions | Read-only list | System-managed (no user input) | Selected environment connection. Active profile = REST / SignalFlow — Organization Access Token; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Verified permissions such as API or ingest; selection here cannot grant them. | shield | Yes | Disable |
| Organization ID | Text | Mandatory for selected profile | Selected environment connection. Active profile = REST / SignalFlow — Organization Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Expected organization used for validation. | building | Yes | Disable |

#### REST / SignalFlow — User API / Session Token

Use an authorized user token for supported API operations. Ingestion requires an organization token.

Source: [API access tokens](https://help.splunk.com/en?resourceId=admin_authentication_authentication-tokens_api-access-tokens).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| User API Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = REST / SignalFlow — User API / Session Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. User/session token sent in X-SF-TOKEN. | key | Yes | Disable |
| Account Label | Text | Optional | Selected environment connection. Active profile = REST / SignalFlow — User API / Session Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Optional owner label. | user | Yes | Disable |
| Expiry / Reauthentication Status | Read-only status | System-managed (no user input) | Selected environment connection. Active profile = REST / SignalFlow — User API / Session Token; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Indicates when user access must be renewed. | clock | Yes | Disable |

#### Observability MCP Gateway — User Session Token

Use the hosted Observability gateway contract. Its documented Observability headers are X-SF-REALM and X-SF-TOKEN; do not substitute a Splunk Platform MCP encrypted token.

Source: [Observability MCP setup](https://help.splunk.com/en/splunk-observability-cloud/splunk-ai-assistant/interact-with-your-observability-data-using-the-splunk-mcp-server).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Observability MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = Observability MCP Gateway — User Session Token; MCP route | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required. Copy the supported-region gateway endpoint. | link | Yes | Disable |
| Realm | Text | Mandatory for selected profile | Selected environment connection. Active profile = Observability MCP Gateway — User Session Token; MCP route | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Sent in X-SF-REALM. | globe | Yes | Disable |
| User Session Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = Observability MCP Gateway — User Session Token; MCP route | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Sent in X-SF-TOKEN for Observability gateway access. | key | Yes | Disable |
| Service Compatibility | Read-only status | System-managed (no user input) | Selected environment connection. Active profile = Observability MCP Gateway — User Session Token; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Validate realm, gateway, user context and available tools. | check | Yes | Disable |

A service account describes credential ownership, not a separate wire protocol. Do not offer a generic stored-password or SAML-XML login profile without a supported deployment-specific implementation.

### MCP Access

Observability MCP access is documented separately from Splunk Platform MCP. Use its service-specific endpoint and accepted token. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Default Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default metrics investigation window. | history | No | Enable |
| SignalFlow Program | Query editor | Mandatory when running a saved SignalFlow investigation | Applicable connector form section | No default; leave unset | Validated connector query or approved query template; assigned resources only | Saved metric analysis with enforced dimension filters. | code | No | Enable |
| Allow Dynamic SignalFlow | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Permit supported runtime programs within scope. | code | No | Enable |
| Metric Resolution | Duration | Optional | Applicable connector form section | 60 seconds | Source-supported resolution from 1 second–1 hour | Requested time-series granularity. | chart-line | No | Enable |
| Maximum Time Series | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Bound returned metric series. | list | No | Enable |
| Infrastructure Health Check | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Enable project-scoped health evaluation. | heart-pulse | No | Enable |
| Health Rule Set | Managed reference | Mandatory when Infrastructure Health Check is enabled | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Select metric thresholds and freshness rules. | list-checks | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable organizations and approved dimension values. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map metric dimensions and detector fields to environment, namespace, service, host, severity and incident correlation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Environment-to-Dimension Mapping | Key/value row editor | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Map environments to filters; for example QLAB01 → k8s.namespace.name=qlab. | network | No | Disable |
| Metric / Detector Scope | Multi-select | Optional | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Select permitted metrics and detector IDs. | activity | No | Disable |
| Health Check Targets | Multi-select | Mandatory when Infrastructure Health Check is enabled | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Select hosts, services or clusters within dimension scope. | server | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Metrics | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read metrics within assigned resources; default Disable. | toggle-right | No | Enable |
| Run SignalFlow | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable run signalflow within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Detectors | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read detectors within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Alerts | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read alerts within assigned resources; default Disable. | toggle-right | No | Enable |
| Check Infrastructure Health | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable check infrastructure health within assigned resources; default Disable. | toggle-right | No | Enable |
| Update Detector | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable update detector within assigned resources; default Disable. | toggle-right | No | Enable |
| Ingest Metrics | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable ingest metrics within assigned resources; default Disable. | toggle-right | No | Enable |
| Backfill Metrics | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable backfill metrics within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Read Metrics | signalfx.read_metrics | Required | Not required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Run SignalFlow | signalfx.run_signalflow | Required | Not required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Read Detectors | signalfx.read_detectors | Required | Not required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Read Alerts | signalfx.read_alerts | Required | Not required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Check Infrastructure Health | signalfx.check_infrastructure_health | Required | Not required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Update Detector | signalfx.update_detector | Not required | Required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Ingest Metrics | signalfx.ingest_metrics | Not required | Required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |
| Backfill Metrics | signalfx.backfill_metrics | Not required | Required | Not required | Disable | Enable; Disable | Assigned organization/dimensions; token and source role permit this API operation |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

Endpoint note: copy realm-specific URLs from the organization profile. The documented signalfx.com and newer observability.splunkcloud.com service domains coexist; a homepage is not an API or MCP endpoint. Source: [realm and endpoint settings](https://help.splunk.com/en/splunk-observability-cloud/administer/org-reference-info/view-your-realm-api-endpoints-and-organization).

<a id="qtest"></a>

## qTest

Connect PRISM to qTest Manager for test evidence, execution status, defect correlation, and controlled test-result updates.

Connector icon: **list-checks**.

### Basic Information

General details and connection routing for qTest. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | qTest | qTest | Fixed to qTest. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (REST API), MCP, or Hybrid. | route | Yes | Disable |
| qTest Manager Base URL | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for REST. Tenant base URL used by the Manager API. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with qTest, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### qTest Manager — Existing Bearer Token

Acquire the API token through the supported qTest account/resource flow and use it for API requests.

Source: [qTest API specifications](https://docs.tricentis.com/qtest-latest/content/apis/overview/qtest_api_specification.htm).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Bearer Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = qTest Manager — Existing Bearer Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. qTest Manager API token. | key | Yes | Disable |
| Account Label | Text | Optional | Selected environment connection. Active profile = qTest Manager — Existing Bearer Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Optional credential owner label. | user | Yes | Disable |

#### qTest Manager — Username/Password Token Exchange

For deployments that permit this documented login flow: request /oauth/token with grant_type=password, then use the returned Bearer token. It is not a browser authorization-code flow.

Source: [qTest Common APIs — Login](https://docs.tricentis.com/qtest-saas/content/apis/apis/common_apis.htm).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| API Client Name | Text | Mandatory for selected profile | Selected environment connection. Active profile = qTest Manager — Username/Password Token Exchange; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Client label encoded in the Basic login header as client-name:. | app-window | Yes | Disable |
| Username | Text | Mandatory for selected profile | Selected environment connection. Active profile = qTest Manager — Username/Password Token Exchange; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. qTest account username. | user | Yes | Disable |
| Password | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = qTest Manager — Username/Password Token Exchange; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Account password used only for token acquisition. | lock | Yes | Disable |
| Token Endpoint | Read-only URL | System-managed (no user input) | Selected environment connection. Active profile = qTest Manager — Username/Password Token Exchange; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Derived from tenant base URL plus /oauth/token. | link | Yes | Disable |
| Access Token | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = qTest Manager — Username/Password Token Exchange; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated after login; subsequent API calls use Bearer authentication. | key | Yes | Disable |

SSO-only users may be unable to use the password flow. Show the token-exchange profile only after tenant support is confirmed. These templates target qTest Manager; other qTest products require their own API adapter.

### MCP Access

MCP access can be provided through an approved qTest adapter/server. This research does not establish a universal qTest-hosted MCP endpoint. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Default Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default execution-history window. | history | No | Enable |
| Maximum Test Results | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Limit returned test evidence. | list | No | Enable |
| Include Test Steps | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Retrieve permitted step-level evidence. | list-checks | No | Enable |
| Include Execution Logs | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Retrieve execution details and logs. | file-text | No | Enable |
| Attachment Processing Mode | Select | Optional | Applicable connector form section | Disabled | Disabled; Metadata only; Text extraction | Disabled, metadata only, or text extraction. | paperclip | No | Enable |
| Include Linked Defects | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Follow defect references only through authorized connectors. | bug | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable qTest project IDs. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map test case, run, execution status, timestamps and defect reference fields to PRISM evidence fields.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Allow All Assigned Projects | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Default Disable. All platform-assigned projects only. | folders | No | Disable |
| Specific Project IDs | Multi-select | Mandatory unless Allow All Assigned Projects is Enable | Project form only. Allow All Assigned Projects = Disable; otherwise hidden and scope uses assigned project catalog | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required unless all assigned projects is enabled. | folder | No | Disable |
| Release / Cycle IDs | Multi-select | Optional | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Optional filters inside selected projects. | tag | No | Disable |
| Default Write Project | Select | Conditional mandatory — see Description | Project form only. At least one supported project-scoped write capability is enabled | No default | One value from this project’s selected source project IDs | Required for writes; choose one selected project. | pencil | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Test Cases | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read test cases within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Test Runs | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read test runs within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Execution Logs | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read execution logs within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Linked Defects | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read linked defects within assigned resources; default Disable. | toggle-right | No | Enable |
| Create Test Case | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable create test case within assigned resources; default Disable. | toggle-right | No | Enable |
| Update Test Case | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable update test case within assigned resources; default Disable. | toggle-right | No | Enable |
| Submit Test Results | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable submit test results within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Read Test Cases | qtest.read_test_cases | Required | Not required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |
| Read Test Runs | qtest.read_test_runs | Required | Not required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |
| Read Execution Logs | qtest.read_execution_logs | Required | Not required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |
| Read Linked Defects | qtest.read_linked_defects | Required | Not required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |
| Create Test Case | qtest.create_test_case | Not required | Required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |
| Update Test Case | qtest.update_test_case | Not required | Required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |
| Submit Test Results | qtest.submit_test_results | Not required | Required | Not required | Disable | Enable; Disable | Assigned qTest project and test objects; account permits this operation |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

<a id="gitlab"></a>

## GitLab

Connect PRISM to GitLab to correlate code changes, issues, merge requests and CI/CD failures with incidents.

Connector icon: **git-branch**.

### Basic Information

General details and connection routing for GitLab. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | GitLab | GitLab | Fixed to GitLab. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (REST API), MCP, or Hybrid. | route | Yes | Disable |
| GitLab Instance URL | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for REST. GitLab.com or self-managed instance; adapter uses API v4 paths. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with GitLab, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### Personal Access Token

Acts within the owning user’s access. Use the PRIVATE-TOKEN header.

Source: [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Account Username | Text | Mandatory for selected profile | Selected environment connection. Active profile = Personal Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Expected credential owner or resource binding. | user | Yes | Disable |
| Personal Access Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = Personal Access Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Issued GitLab token. | key | Yes | Disable |
| Granted Scopes | Read-only list | System-managed (no user input) | Selected environment connection. Active profile = Personal Access Token; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Verify required scopes; field does not grant permissions. | shield | Yes | Disable |
| Expires At | Datetime | Optional | Selected environment connection. Active profile = Personal Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Non-empty text when supplied; validate against source configuration | Optional recorded expiry or discovered token metadata. | clock | Yes | Disable |

#### Project Access Token

Restricted by the owning GitLab project and token permissions. Use the PRIVATE-TOKEN header.

Source: [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Token Project ID | Text | Mandatory for selected profile | Selected environment connection. Active profile = Project Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Expected credential owner or resource binding. | user | Yes | Disable |
| Project Access Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = Project Access Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Issued GitLab token. | key | Yes | Disable |
| Granted Scopes | Read-only list | System-managed (no user input) | Selected environment connection. Active profile = Project Access Token; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Verify required scopes; field does not grant permissions. | shield | Yes | Disable |
| Expires At | Datetime | Optional | Selected environment connection. Active profile = Project Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Non-empty text when supplied; validate against source configuration | Optional recorded expiry or discovered token metadata. | clock | Yes | Disable |

#### Group Access Token

Restricted by the owning GitLab group and token permissions. Use the PRIVATE-TOKEN header.

Source: [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Token Group ID | Text | Mandatory for selected profile | Selected environment connection. Active profile = Group Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Expected credential owner or resource binding. | user | Yes | Disable |
| Group Access Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = Group Access Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Issued GitLab token. | key | Yes | Disable |
| Granted Scopes | Read-only list | System-managed (no user input) | Selected environment connection. Active profile = Group Access Token; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Verify required scopes; field does not grant permissions. | shield | Yes | Disable |
| Expires At | Datetime | Optional | Selected environment connection. Active profile = Group Access Token; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Non-empty text when supplied; validate against source configuration | Optional recorded expiry or discovered token metadata. | clock | Yes | Disable |

#### OAuth 2.0 Authorization Code + PKCE

Register an application and obtain user consent. Use the instance OAuth endpoints; generate PKCE and state values internally.

Source: [GitLab OAuth flows](https://docs.gitlab.com/api/oauth2/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Registered application identifier. | fingerprint | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server). Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for a confidential client; omit for a supported public client. | lock | Yes | Disable |
| Redirect URI | URL | Mandatory for selected profile | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Exact registered callback; HTTPS, or loopback HTTP only when supported by the OAuth flow | Required. Exact callback registered for this application. | link | Yes | Disable |
| Requested Scopes | Multi-select | Mandatory for selected profile | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server) | No default — derive from enabled operations and selected provider | Scopes supported by the active OAuth 2.0 Authorization Code + PKCE and required by enabled tools; requesting scopes does not grant them | Required. Select scopes needed for enabled operations. | list-checks | Yes | Disable |
| Connected Account | Read-only identity | System-managed (no user input) | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Populated after consent; identifies whose permissions apply. | user | Yes | Disable |
| Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access and refresh tokens; never entered as ordinary text. | key | Yes | Disable |
| Token Expiry | Read-only datetime | System-managed (no user input) | Selected environment connection. Active profile = OAuth 2.0 Authorization Code + PKCE; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated from token response; reauthorization shown if renewal fails. | clock | Yes | Disable |

#### CI/CD Job Token — Runtime Only

Show only for a connector running inside an authorized CI job. Job tokens support a limited set of API endpoints.

Source: [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Runtime Credential Binding | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = CI/CD Job Token — Runtime Only; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Read CI_JOB_TOKEN from the current job context. | key | Yes | Disable |
| Origin Project ID | Text | Mandatory for selected profile | Selected environment connection. Active profile = CI/CD Job Token — Runtime Only; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project that owns the running job. | folder | Yes | Disable |
| Target Project Scope | Multi-select | Mandatory for selected profile | Selected environment connection. Active profile = CI/CD Job Token — Runtime Only; Direct route (or native upstream profile managed by an MCP server) | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Targets permitted by job-token access configuration. | list-checks | Yes | Disable |

#### GitLab MCP — OAuth

Use the instance MCP endpoint with browser authorization and supported dynamic client registration. Enable MCP access for the target group or instance.

Source: [GitLab MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = GitLab MCP — OAuth; MCP route. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | Derived from approved instance: /api/v4/mcp | Valid approved HTTPS URL without embedded credentials | Required. https://<gitlab-host>/api/v4/mcp. | link | Yes | Disable |
| Client Registration | Managed reference | System-managed (no user input) | Selected environment connection. Active profile = GitLab MCP — OAuth; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated or registered OAuth client configuration. | app-window | Yes | Disable |
| Redirect URI | URL | Mandatory for selected profile | Selected environment connection. Active profile = GitLab MCP — OAuth; MCP route | No default; leave unset | Exact registered callback; HTTPS, or loopback HTTP only when supported by the OAuth flow | Required. Callback used by the registered client. | link | Yes | Disable |
| Connected Account | Read-only identity | System-managed (no user input) | Selected environment connection. Active profile = GitLab MCP — OAuth; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated after consent. | user | Yes | Disable |
| Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = GitLab MCP — OAuth; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access/refresh credentials. | key | Yes | Disable |

GitLab deploy tokens and SSH deploy keys serve repository/package use cases and are not general REST API authentication. Keep a future Git-over-SSH adapter separate from this REST form.

### MCP Access

GitLab documents an instance MCP server at /api/v4/mcp with OAuth registration. Confirm target version, access settings and available tools before activation. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | Derived from approved instance: /api/v4/mcp | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Default Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default change and pipeline history window. | history | No | Enable |
| Maximum Results | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Maximum issues, changes or pipelines per request. | list | No | Enable |
| Include Commits | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Retrieve authorized commit metadata. | git-commit | No | Enable |
| Include Merge Requests | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Include merge request context. | git-pull-request | No | Enable |
| Include Pipeline / Job Logs | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Include logs from permitted projects. | file-text | No | Enable |
| Include Artifacts | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Retrieve artifacts within configured size limits. | package | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable GitLab group and project IDs. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map project, commit SHA, branch, pipeline, job status, author, timestamp and issue references to PRISM evidence.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Group IDs | Multi-select | Optional | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Optional grouping within assigned scope. | folders | No | Disable |
| Project IDs / Paths | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. GitLab projects assigned to this PRISM project. | folder | No | Disable |
| Branch / Tag Filters | Text list | Optional | Project form only | [] | Unique non-empty strings; every resolved resource must remain within assigned scope | Optional references to include. | git-branch | No | Disable |
| Pipeline Status Filters | Multi-select | Optional | Project form only | [] | Discovered statuses supported by the GitLab adapter; select any subset | Statuses to monitor. | activity | No | Disable |
| Default Write Project | Select | Conditional mandatory — see Description | Project form only. At least one supported project-scoped write capability is enabled | No default | One value from this project’s selected source project IDs | Required for writes; choose one permitted project. | pencil | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Repository | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read repository within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Issues | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read issues within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Merge Requests | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read merge requests within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Pipelines | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read pipelines within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Job Logs | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read job logs within assigned resources; default Disable. | toggle-right | No | Enable |
| Create Issue | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable create issue within assigned resources; default Disable. | toggle-right | No | Enable |
| Add Comment | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable add comment within assigned resources; default Disable. | toggle-right | No | Enable |
| Trigger Pipeline | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable trigger pipeline within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Read Repository | gitlab.read_repository | Required | Not required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Read Issues | gitlab.read_issues | Required | Not required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Read Merge Requests | gitlab.read_merge_requests | Required | Not required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Read Pipelines | gitlab.read_pipelines | Required | Not required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Read Job Logs | gitlab.read_job_logs | Required | Not required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Create Issue | gitlab.create_issue | Not required | Required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Add Comment | gitlab.add_comment | Not required | Required | Not required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |
| Trigger Pipeline | gitlab.trigger_pipeline | Not required | Required | Required | Disable | Enable; Disable | Assigned GitLab project; token scope and source project role permit this operation |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

<a id="kafka"></a>

## Kafka

Connect PRISM to Apache Kafka for cluster metadata, consumer lag investigation, scoped message sampling and controlled publishing.

Connector icon: **radio-tower**.

### Basic Information

General details and connection routing for Kafka. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Kafka | Kafka | Fixed to Kafka. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (Kafka protocol), MCP, or Hybrid. | route | Yes | Disable |
| Bootstrap Servers | Text list | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | [] | One or more distinct host:port entries; ports 1–65,535; broker listener addresses only | Required for native access. List of broker host:port addresses; not an HTTP URL. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |
| Security Protocol | Select | Mandatory for Direct/Hybrid Kafka | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation. Recompute from active Kafka profile; reject incompatible protocol values | SSL if mTLS; SASL_SSL if a SASL profile is selected | mTLS: SSL only. SCRAM, PLAIN, OAUTHBEARER or GSSAPI: SASL_SSL only. No value until profile selected | Required for native access. SSL for mTLS; SASL_SSL for SASL profiles. | shield | Yes | Disable |
| Truststore / CA Bundle | Secure file reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Approved managed file of the format required by the selected profile | Required when broker trust is not supplied by the managed runtime. | file-check | Yes | Disable |
| Truststore Password | Secret reference | Conditional mandatory — see Description | Applicable connector form section. Selected truststore is password-protected | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Required for a protected truststore. | lock | Yes | Disable |
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | Generated PRISM connector identifier | Non-empty unique client identifier; no credentials | Required. Stable PRISM Kafka client identifier. | fingerprint | Yes | Disable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with Kafka, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### TLS Client Certificate (mTLS)

Authenticate using the client certificate accepted by the Kafka listener.

Source: [Apache Kafka SSL configuration](https://kafka.apache.org/41/security/encryption-and-authentication-using-ssl/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Client Certificate / Keystore | Secure file reference | Mandatory for selected profile | Selected environment connection. Active profile = TLS Client Certificate (mTLS); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Client identity material in a supported format. | file-key | Yes | Disable |
| Private Key | Secret reference | Mandatory when selected profile uses a separate private key | Selected environment connection. Active profile = TLS Client Certificate (mTLS); Direct route (or native upstream profile managed by an MCP server). Selected certificate profile uses a separate key; not required if key is included in the managed keystore | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for separate PEM key; otherwise supplied by keystore. | key | Yes | Disable |
| Key / Keystore Password | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = TLS Client Certificate (mTLS); Direct route (or native upstream profile managed by an MCP server). Selected key/keystore is encrypted and requires unlocking | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Unlock encrypted identity material. | lock | Yes | Disable |

#### SASL/SCRAM over TLS

Select the SCRAM mechanism configured on the broker.

Source: [Apache Kafka SASL authentication](https://kafka.apache.org/43/security/authentication-using-sasl/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| SCRAM Mechanism | Select | Mandatory for selected profile | Selected environment connection. Active profile = SASL/SCRAM over TLS; Direct route (or native upstream profile managed by an MCP server) | No default — match broker | SCRAM-SHA-256; SCRAM-SHA-512 | Required. SCRAM-SHA-256 or SCRAM-SHA-512. | list | Yes | Disable |
| SASL Username | Text | Mandatory for selected profile | Selected environment connection. Active profile = SASL/SCRAM over TLS; Direct route (or native upstream profile managed by an MCP server). SASL/PLAIN or SASL/SCRAM only; hidden for mTLS, OAUTHBEARER and GSSAPI | None | Non-empty broker-provisioned SASL username; provider API key only when documented | Required. Provision this identity on the broker or identity backend; client setting sasl.jaas.config username. PRISM must preserve the exact supplied value. | user | Yes | Disable |
| SASL Password | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = SASL/SCRAM over TLS; Direct route (or native upstream profile managed by an MCP server). SASL/PLAIN or SASL/SCRAM only; hidden for mTLS, OAUTHBEARER and GSSAPI | None | Vault secret containing the matching broker password or documented provider API secret | Required. Password matching the provisioned SCRAM username; resolve from vault for sasl.jaas.config password. Never log the resolved JAAS configuration. | key | Yes | Disable |

#### SASL/PLAIN over TLS

Use when the broker authenticates with PLAIN.

Source: [Apache Kafka SASL authentication](https://kafka.apache.org/43/security/authentication-using-sasl/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| SASL Username | Text | Mandatory for selected profile | Selected environment connection. Active profile = SASL/PLAIN over TLS; Direct route (or native upstream profile managed by an MCP server). SASL/PLAIN or SASL/SCRAM only; hidden for mTLS, OAUTHBEARER and GSSAPI | None | Non-empty broker-provisioned SASL username; provider API key only when documented | Required. PLAIN identity recognized by the listener; a provider API key only if its documentation specifies that mapping. Client JAAS username. | user | Yes | Disable |
| SASL Password | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = SASL/PLAIN over TLS; Direct route (or native upstream profile managed by an MCP server). SASL/PLAIN or SASL/SCRAM only; hidden for mTLS, OAUTHBEARER and GSSAPI | None | Vault secret containing the matching broker password or documented provider API secret | Required. Matching listener password, or provider API secret where documented. Resolve from vault into client JAAS password; never log it. | key | Yes | Disable |

#### SASL/OAUTHBEARER

Use an identity-provider integration supported by the selected Kafka client and broker.

Source: [Apache Kafka SASL authentication](https://kafka.apache.org/43/security/authentication-using-sasl/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Token Endpoint | URL | Conditional mandatory — see Description | Selected environment connection. Active profile = SASL/OAUTHBEARER; Direct route (or native upstream profile managed by an MCP server). Required for token acquisition | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for token acquisition. | link | Yes | Disable |
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Selected environment connection. Active profile = SASL/OAUTHBEARER; Direct route (or native upstream profile managed by an MCP server). Required for the chosen client-credentials flow | Generated PRISM connector identifier | Non-empty unique client identifier; no credentials | Required for the chosen client-credentials flow. | fingerprint | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = SASL/OAUTHBEARER; Direct route (or native upstream profile managed by an MCP server). Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required when secret-based client authentication is used. | key | Yes | Disable |
| Scopes | Text list | Conditional mandatory — see Description | Selected environment connection. Active profile = SASL/OAUTHBEARER; Direct route (or native upstream profile managed by an MCP server). Conditional | No default — derive from enabled operations and selected provider | Scopes supported by the active SASL/OAUTHBEARER and required by enabled tools; requesting scopes does not grant them | Conditional. Provider-required scopes. | list | Yes | Disable |
| Token Provider Configuration | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = SASL/OAUTHBEARER; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Approved callback/provider and any audience settings. | settings | Yes | Disable |

#### SASL/GSSAPI (Kerberos)

Use a Kerberos-enabled broker and a prepared connector runtime.

Source: [Apache Kafka SASL authentication](https://kafka.apache.org/43/security/authentication-using-sasl/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Principal | Text | Mandatory for selected profile | Selected environment connection. Active profile = SASL/GSSAPI (Kerberos); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Client Kerberos principal. | user | Yes | Disable |
| Keytab | Secret file reference | Conditional mandatory — see Description | Selected environment connection. Active profile = SASL/GSSAPI (Kerberos); Direct route (or native upstream profile managed by an MCP server). Required for unattended keytab login | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for unattended keytab login. | file-key | Yes | Disable |
| Kerberos Configuration | Managed file reference | Mandatory for selected profile | Selected environment connection. Active profile = SASL/GSSAPI (Kerberos); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Realm/KDC configuration. | settings | Yes | Disable |
| Service Name | Text | Mandatory for selected profile | Selected Kafka environment connection; SASL/GSSAPI profile only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Broker Kerberos service name. | server | Yes | Disable |

Kafka username/password rule: SASL/PLAIN and SASL/SCRAM both require a username and matching password, with no credential defaults. mTLS uses certificate/key fields; OAUTHBEARER uses identity-provider credentials; GSSAPI uses a principal and Kerberos credentials. Hide SASL Username and SASL Password for those other profiles. A keystore password unlocks a file and is not a broker login password.

All profiles use the TLS connection fields below. This proposed form omits unauthenticated and plaintext production profiles. Provider-specific IAM mechanisms can be added only with a verified client adapter. Schema Registry and REST proxies have separate credentials; they do not replace native broker authentication.

### MCP Access

MCP requires a server/adapter that exposes Kafka operations. Broker SASL or certificates belong to the server-to-Kafka connection, not automatically to PRISM-to-MCP. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Maximum Sample Messages | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Limit messages inspected per investigation. | list | No | Enable |
| Message Start Position | Select | Optional | Applicable connector form section | Latest | Latest; Earliest; Timestamp; Explicit offsets | Latest, earliest, timestamp, or explicit offsets. | history | No | Enable |
| Message Format | Select | Optional | Applicable connector form section | JSON | Text; JSON. Avro/Protobuf only if decoder and required schema lookup are configured | Text, JSON, or adapter-supported serialized format. | braces | No | Enable |
| Schema Registry Binding | Managed reference | Optional | Applicable connector form section. Chosen message decoder requires external schema lookup | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional separate connection for schema lookup. | database | No | Enable |
| Include Message Payload | Toggle | Mandatory (default supplied) | Applicable connector form section. Kafka Sample Messages capability is enabled and payload access is permitted | Disable | Enable; Disable | Default Disable; sampling permission is required. | file-text | No | Enable |
| Consumer Lag Threshold | Integer | Optional | Applicable connector form section | 1000 | Integer 0–1,000,000 messages | Project default threshold for lag evaluation. | activity | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Kafka topics and consumer groups. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map message key, approved payload paths, headers, event timestamp and topic/partition/offset to evidence.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Topic Names / Patterns | Text list | Mandatory | Project form only | [] | Unique non-empty strings; every resolved resource must remain within assigned scope | Required. Resolve only inside platform topic scope. | list | No | Disable |
| Consumer Group IDs | Text list | Mandatory when Read Consumer Lag is enabled | Project form only | [] | Unique non-empty strings; every resolved resource must remain within assigned scope | Groups that may be inspected. | users | No | Disable |
| Sampling Consumer Group | Text | Mandatory when Sample Messages is enabled | Project form only. Kafka Sample Messages capability and Read Access are enabled | No default — provision dedicated group | Dedicated PRISM diagnostic group in assigned scope; never an application group | Dedicated PRISM group; must not use an application consumer group. | user | No | Disable |
| Partition Filter | Integer list | Optional | Project form only | [] (all permitted partitions) | Unique integers ≥0 that exist in the selected topic | Optional partitions within approved topics. | split | No | Disable |
| Publish Topic | Select | Conditional mandatory — see Description | Project form only. Kafka Publish Messages capability and Write Access are enabled | No default | One platform-approved publish topic assigned to this project | Required for publishing; select an approved topic. | send | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Cluster Metadata | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read cluster metadata within assigned resources; default Disable. | toggle-right | No | Enable |
| Describe Topics | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable describe topics within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Consumer Lag | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read consumer lag within assigned resources; default Disable. | toggle-right | No | Enable |
| Sample Messages | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable sample messages within assigned resources; default Disable. | toggle-right | No | Enable |
| Publish Messages | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable publish messages within assigned resources; default Disable. | toggle-right | No | Enable |
| Create Topic | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable create topic within assigned resources; default Disable. | toggle-right | No | Enable |
| Alter Topic Configuration | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable alter topic configuration within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Read Cluster Metadata | kafka.read_cluster_metadata | Required | Not required | Not required | Disable | Enable; Disable | Assigned topics/groups; Kafka ACLs permit the exact protocol requests |
| Describe Topics | kafka.describe_topics | Required | Not required | Not required | Disable | Enable; Disable | Assigned topics/groups; Kafka ACLs permit the exact protocol requests |
| Read Consumer Lag | kafka.read_consumer_lag | Required | Not required | Not required | Disable | Enable; Disable | Group/topic DESCRIBE permissions needed by the selected lag APIs |
| Sample Messages | kafka.sample_messages | Required | Not required | Not required | Disable | Enable; Disable | Topic READ and applicable group READ; dedicated diagnostic consumer only |
| Publish Messages | kafka.publish_messages | Not required | Required | Not required | Disable | Enable; Disable | Topic WRITE; verify additional transactional/idempotent producer permissions if used |
| Create Topic | kafka.create_topic | Not required | Required | Not required | Disable | Enable; Disable | Topic/cluster CREATE as required by the request; restrict approved names |
| Alter Topic Configuration | kafka.alter_topic_configuration | Not required | Required | Not required | Disable | Enable; Disable | Topic ALTER_CONFIGS for approved settings |

Kafka native permission basis: [Kafka authorization and ACLs](https://kafka.apache.org/42/security/authorization-and-acls/). Verify the exact requests made by the configured client before granting ACLs.

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

Sampling note: use an isolated diagnostic consumer and avoid committing offsets to application groups. The Kafka connector here means a PRISM integration, not a Kafka Connect source/sink plugin.

<a id="kubernetes"></a>

## Kubernetes

Connect PRISM to a Kubernetes cluster for workload health, events, logs and explicitly enabled remediation operations.

Connector icon: **boxes**.

### Basic Information

General details and connection routing for Kubernetes. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Kubernetes | Kubernetes | Fixed to Kubernetes. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (Kubernetes API), MCP, or Hybrid. | route | Yes | Disable |
| API Server URL | URL | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for direct access. HTTPS endpoint of the configured cluster. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |
| Cluster Name / ID | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Expected target cluster. | boxes | Yes | Disable |
| Cluster CA Certificate | Secure file reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Approved managed file of the format required by the selected profile | Required unless a managed system trust configuration validates the server. | file-check | Yes | Disable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with Kubernetes, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### In-Cluster Service Account

Use the identity mounted into the PRISM workload; allow the client to reload rotated credentials.

Source: [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Service Account Binding | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = In-Cluster Service Account; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. PRISM workload service account. | user | Yes | Disable |
| Projected Token Source | Managed file reference | Mandatory for selected profile | Selected environment connection. Active profile = In-Cluster Service Account; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Runtime-mounted token source. | key | Yes | Disable |
| Expected Audience | Text | Conditional mandatory — see Description | Selected environment connection. Active profile = In-Cluster Service Account; Direct route (or native upstream profile managed by an MCP server). Conditional | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Conditional. Must be accepted by the target API server. | target | Yes | Disable |

#### External Bearer Token

Use an administrator-provisioned token and a renewal arrangement appropriate to its issuer.

Source: [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Bearer Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = External Bearer Token; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Token accepted by the API server. | key | Yes | Disable |
| Renewal Binding | Managed reference | Conditional mandatory — see Description | Selected environment connection. Active profile = External Bearer Token; Direct route (or native upstream profile managed by an MCP server). Required for expiring unattended credentials | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for expiring unattended credentials. | refresh-cw | Yes | Disable |
| Expires At | Read-only datetime | System-managed (no user input) | Selected environment connection. Active profile = External Bearer Token; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Discovered expiry where available. | clock | Yes | Disable |

#### X.509 Client Certificate

Use a certificate trusted for client authentication by the API server.

Source: [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Client Certificate | Secure file reference | Mandatory for selected profile | Selected environment connection. Active profile = X.509 Client Certificate; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Client certificate chain. | file-key | Yes | Disable |
| Private Key | Secret reference | Mandatory when selected profile uses a separate private key | Selected environment connection. Active profile = X.509 Client Certificate; Direct route (or native upstream profile managed by an MCP server). Selected certificate profile uses a separate key; not required if key is included in the managed keystore | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Matching private key. | key | Yes | Disable |

#### Exec Credential Provider / OIDC / Cloud Identity

Use an approved client credential plugin for the configured cluster identity system.

Source: [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Provider Configuration | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = Exec Credential Provider / OIDC / Cloud Identity; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Preconfigured OIDC or cloud credential provider. | settings | Yes | Disable |
| Runtime Identity Binding | Managed reference | Optional | Selected environment connection. Active profile = Exec Credential Provider / OIDC / Cloud Identity; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required where the provider uses workload or cloud identity. | user | Yes | Disable |
| Interactive Login State | Read-only status | System-managed (no user input) | Selected environment connection. Active profile = Exec Credential Provider / OIDC / Cloud Identity; Direct route (or native upstream profile managed by an MCP server) | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Shown if the configured provider requires user sign-in. | log-in | Yes | Disable |

Kubeconfig is an import container, not another authentication protocol. If import is offered, extract the server, CA, context and one supported identity profile. Treat embedded exec commands as executable configuration and accept only registered providers.

### MCP Access

MCP requires an approved Kubernetes server/adapter. Keep its cluster identity and RBAC separate from MCP caller authentication. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Event Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default event investigation window. | history | No | Enable |
| Maximum Log Lines | Integer | Optional | Applicable connector form section | 1000 | Integer 1–10,000 | Bound pod log retrieval. | list | No | Enable |
| Include Previous Container Logs | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Include available previous-container logs. | history | No | Enable |
| Include Events | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Collect events for scoped resources. | activity | No | Enable |
| Include Resource Metrics | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Use only when a metrics API/adapter is available. | chart-line | No | Enable |
| Infrastructure Health Rules | Managed reference | Mandatory when workload health checks are enabled | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Approved checks for workload readiness and failures. | heart-pulse | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Kubernetes namespaces and resource kinds. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map cluster, namespace, workload, pod, container, labels, events and status to infrastructure evidence.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Namespaces | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Assigned namespaces only. | boxes | No | Disable |
| Label Selector | Selector editor | Optional | Project form only | No default; leave unset | Valid Kubernetes selector; may only narrow platform resource scope | Additional restriction on selected resources. | filter | No | Disable |
| Resource Kinds | Multi-select | Optional | Project form only | [] | Platform-approved namespaced/cluster-scoped Kubernetes kinds; scope validated separately | Kinds permitted for this project. | list | No | Disable |
| Workload Names | Text list | Optional | Project form only | [] | Unique non-empty strings; every resolved resource must remain within assigned scope | Optional named workload filter. | box | No | Disable |
| Environment-to-Namespace Mapping | Key/value row editor | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Map project environments to assigned namespaces. | network | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Workloads | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read workloads within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Events | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read events within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Pod Logs | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read pod logs within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Metrics | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read metrics within assigned resources; default Disable. | toggle-right | No | Enable |
| Restart Workload | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable restart workload within assigned resources; default Disable. | toggle-right | No | Enable |
| Scale Workload | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable scale workload within assigned resources; default Disable. | toggle-right | No | Enable |
| Execute Approved Command | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable execute approved command within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Secret Values | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read secret values within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Read Workloads | kubernetes.read_workloads | Required | Not required | Not required | Disable | Enable; Disable | Assigned resources; Kubernetes RBAC permits the exact resource/subresource and verbs |
| Read Events | kubernetes.read_events | Required | Not required | Not required | Disable | Enable; Disable | Assigned resources; Kubernetes RBAC permits the exact resource/subresource and verbs |
| Read Pod Logs | kubernetes.read_pod_logs | Required | Not required | Not required | Disable | Enable; Disable | Read the pods/log subresource within assigned namespaces |
| Read Metrics | kubernetes.read_metrics | Required | Not required | Not required | Disable | Enable; Disable | Assigned resources; Kubernetes RBAC permits the exact resource/subresource and verbs |
| Restart Workload | kubernetes.restart_workload | Not required | Required | Required | Disable | Enable; Disable | Assigned resources; Kubernetes RBAC permits the exact resource/subresource and verbs |
| Scale Workload | kubernetes.scale_workload | Not required | Required | Required | Disable | Enable; Disable | Assigned resources; Kubernetes RBAC permits the exact resource/subresource and verbs |
| Execute Approved Command | kubernetes.execute_approved_command | Not required | Required | Required | Disable | Enable; Disable | Approved command in scoped pod; classify conservatively as Write + Execute |
| Read Secret Values | kubernetes.read_secret_values | Required | Not required | Not required | Disable | Enable; Disable | Read explicitly assigned secrets only; do not infer from workload read access |

Kubernetes native permission basis: [RBAC resource and subresource permissions](https://kubernetes.io/docs/reference/access-authn-authz/rbac/).

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

Authorization note: verify namespaced and cluster-scoped permissions separately; namespace selection does not constrain cluster-scoped resources. Secret-value access is a separate capability and remains disabled unless explicitly provisioned. Source: [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/).

<a id="oracle"></a>

## Oracle

Connect PRISM to Oracle Database for approved SQL investigation, database health and controlled stored-procedure execution.

Connector icon: **database**.

### Basic Information

General details and connection routing for Oracle. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Oracle | Oracle | Fixed to Oracle. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (Oracle database driver), MCP, or Hybrid. | route | Yes | Disable |
| Database Connection Target | Connection target | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Non-empty text when supplied; validate against source configuration | Required for direct access. Structured host/port/service, TNS alias, or approved connection descriptor; do not embed passwords. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |
| Connection Mode | Select | Mandatory | Applicable connector form section | Host/service | Host/service; TNS alias; Approved descriptor | Required. Host/service, TNS alias, or approved descriptor. | list | Yes | Disable |
| Host | Hostname | Conditional mandatory — see Description | Applicable connector form section. Oracle Connection Mode = Host/service | No default; leave unset | Valid DNS hostname or IP address from approved connection inventory | Required for host/service mode. | server | Yes | Disable |
| Port | Integer | Conditional mandatory — see Description | Applicable connector form section. Oracle Connection Mode = Host/service | No default — match listener | Integer 1–65,535 | Required for host/service mode; match listener configuration. | plug | Yes | Disable |
| Service Name | Text | Conditional mandatory — see Description | Applicable connector form section. Oracle Host/service mode; Kafka Kerberos profile uses broker service name instead | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required for service-name connections. | database | Yes | Disable |
| TNS Configuration | Managed file reference | Conditional mandatory — see Description | Applicable connector form section. Oracle Connection Mode = TNS alias | No default; leave unset | Approved managed file of the format required by the selected profile | Required for TNS-alias mode. | file | Yes | Disable |
| Transport Security | Select | Mandatory | Applicable connector form section | TLS | TLS; mTLS (match listener and driver) | Required. Deployment-approved TLS/mTLS configuration. | shield | Yes | Disable |
| Server Trust Configuration | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Trust material and server identity verification. | file-check | Yes | Disable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Oracle Driver & Runtime — Per Environment Connection

Select the driver family, mode and execution runtime before choosing compatible authentication profiles. Thin/Thick is a driver setting, not an authentication method. Local paths refer to the machine/container actually running the Oracle driver.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Oracle Driver Family | Select | Mandatory | Direct/Hybrid Oracle connection, or a PRISM-managed MCP server that owns the Oracle connection | No default — match implemented adapter | python-oracledb; Oracle JDBC (installed supported adapters only) | Required. Choose an adapter implemented by PRISM; Python and JDBC have different mode and dependency requirements. | code | Yes | Disable |
| Oracle Driver Mode | Select | Mandatory | Selected driver family/runtime; authentication features and database compatibility further restrict values | Thin if compatible; otherwise explicit supported choice | python-oracledb: Thin, Thick. Oracle JDBC: Thin, OCI (supported versions only) | Required. Python: Thin or Thick. JDBC: Thin or OCI, only where that driver is supported. | list | Yes | Disable |
| Oracle Execution Location | Select | Mandatory | Every Oracle environment connection; must match actual native driver execution location | No default | Local worker; Remote worker/container; MCP server | Required. Where the native database connection runs: local worker, remote worker/container, or MCP server. | server | Yes | Disable |
| Oracle Runtime Binding | Managed reference | Mandatory | Every Oracle environment connection; external MCP may supply a server-managed binding | None | Approved runtime bindings for the selected location, driver family and mode | Required. Registered worker/runtime that owns driver initialization and native dependencies. | plug | Yes | Disable |
| Oracle Driver Package / Version | Managed reference | Mandatory | Direct/Hybrid or managed MCP native Oracle runtime; external MCP reports its own version if available | Runtime’s provisioned compatible package/JAR | Approved installed versions compatible with runtime, database and required features | Required. Approved Python driver package or JDBC JAR compatible with runtime, database and chosen features. | package | Yes | Disable |
| Oracle Runtime OS / Architecture | Read-only text | System-managed | Configured execution runtime; external MCP may report unavailable | Detected | Execution-host OS and process architecture | Detected execution-host operating system and process architecture; verify native library compatibility. | cpu | Yes | Disable |
| Oracle Client Library Required | Read-only boolean | System-managed | Recompute after driver family/mode changes; for remote MCP this requirement applies on its server | Derived from mode | Yes for Python Thick/JDBC OCI; No for Thin | Derived from mode. Python Thick or JDBC OCI requires native Oracle Client libraries; Thin does not. | library | Yes | Disable |
| Oracle Client Installation Type | Select | Mandatory for Thick/OCI | Mode = Python Thick or JDBC OCI and PRISM manages the native runtime | No default | Oracle Instant Client; Full Oracle Client — supported installed version only | Required for Thick/OCI. Existing compatible Instant Client or full Oracle Client installation on the execution host. | package | Yes | Disable |
| Oracle Client Library Directory | Directory path | Conditional mandatory | Thick/OCI + Explicit directory discovery. Hidden in Thin and externally managed MCP; validate OS-specific loading support | Unset — permitted only when compatible libraries are discovered | Existing accessible absolute directory on the execution host; compatible native client libraries | Conditional. Required when the selected runtime loader needs an explicit client-library path. May be omitted only if supported discovery resolves compatible libraries. | folder | Yes | Disable |
| Oracle Native Library Discovery | Select | Mandatory for Thick/OCI | Mode = Python Thick or JDBC OCI and PRISM manages native runtime | No default — match runtime loader | Explicit directory; Runtime/system discovery — only modes supported by OS and driver build | Required for Thick/OCI. Approved explicit-directory loading or preconfigured runtime/system library discovery. | search | Yes | Disable |
| Oracle Client Version | Read-only text | System-managed | After Thick/OCI native library initialization; not applicable in Thin | Not loaded | Validated client version or initialization failure | Detected after native library initialization; verify compatibility rather than assuming the database version. | info | Yes | Disable |
| Oracle Network Configuration Directory | Directory path | Conditional mandatory | TNS/configuration-dependent connection or authentication profile needs it; available in Thin where supported, not exclusively Thick | Unset unless runtime supplies required network configuration | Accessible absolute configuration directory or approved mounted configuration binding | Conditional. Directory for required Oracle Net configuration, such as tnsnames.ora; separate from the native library directory. | folder | Yes | Disable |
| Oracle Wallet Location | Secure directory binding | Conditional mandatory | Authentication or TLS profile requires wallet files; hidden otherwise; same binding as the selected profile’s wallet | None | Approved wallet directory/mount on execution host, compatible with selected driver/profile | Conditional. Required when the selected authentication/TLS profile needs a wallet; resolve on the execution host. | wallet | Yes | Disable |
| Oracle Runtime Initialization State | Read-only status | System-managed | Selected runtime; recompute after mode, library or runtime changes | Not initialized | Not initialized; Thin ready; Thick ready; JDBC Thin ready; JDBC OCI ready; Restart required; Failed; Server-managed | Reports loaded mode and whether a fresh worker is required after a mode or library change. | activity | Yes | Disable |
| Oracle Dependency Test | Action + read-only result | Action — mandatory before native connection activation | Direct/Hybrid or PRISM-managed Oracle MCP runtime; external MCP uses server-reported health | Not tested | Not tested; Passed; Failed; Restart required; Server-managed/unverified | Check driver package, mode, library discovery, architecture and required configuration before attempting database login. | check | Yes | Disable |

Python runtime note: python-oracledb Thin connects without native Oracle Client libraries. Thick loads those libraries before opening connections. Library discovery differs by operating system and client build; an entered folder alone does not guarantee Linux dependency resolution. Initialize and validate the selected runtime before enabling an environment. Source: [python-oracledb initialization](https://python-oracledb.readthedocs.io/en/latest/user_guide/initialization.html).

Mode lifecycle: a Python worker does not switch freely between Thin and Thick after initialization. If two environment connections require different modes or incompatible client installations, assign separate workers. A mode/library change invalidates the dependency and connection tests and may require a worker restart. Source: [Oracle Python driver tutorial](https://oracle.github.io/python-oracledb/samples/tutorial/Python-and-Oracle-Database-The-New-Wave-of-Scripting.html).

JDBC runtime note: JDBC Thin needs the appropriate Java driver JAR but no native Oracle Client installation. JDBC OCI uses native client libraries. Expose OCI only for supported installed versions; Oracle publishes a JDBC-OCI deprecation notice. Sources: [Oracle JDBC drivers](https://docs.oracle.com/en/database/oracle/oracle-database/18/jjdbc/introducing-JDBC.html), [Oracle JDBC downloads and support notes](https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html).

MCP location rule: when a remote MCP server owns the Oracle connection, its driver and libraries belong on that server. PRISM does not require a local Oracle Client installation just to call remote MCP. For a locally managed MCP server, configure its own runtime binding. Show only server-reported dependency status for external MCP services; do not request local library paths that PRISM cannot apply.

Dependency order: Environment Connection → Execution Location/Runtime → Driver Family/Mode → Client-library and network/wallet configuration → compatible Authentication Profile → granted operations. Filter authentication methods against the selected driver/version; do not assume a JDBC-documented wallet or Kerberos configuration is identical in a Python adapter. Never change mode automatically because a wallet is selected or login fails.

### Authentication

Configure how PRISM authenticates with Oracle, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### Database Username + Password

Authenticate as a database user; transport encryption is configured separately.

Source: [Oracle JDBC security](https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/client-side-security.html).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Database Username | Text | Mandatory for selected profile | Selected environment connection. Active profile = Database Username + Password; Direct route (or native upstream profile managed by an MCP server). Oracle database-password or wallet mTLS + database-login profile; hidden for SEPS/Kerberos | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Database account. | user | Yes | Disable |
| Database Password | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = Database Username + Password; Direct route (or native upstream profile managed by an MCP server). Oracle database-password or wallet mTLS + database-login profile; hidden for SEPS/Kerberos | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Account password. | key | Yes | Disable |

#### Secure External Password Store (SEPS)

The wallet supplies stored database login credentials; select the matching connection alias.

Source: [Oracle JDBC security](https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/client-side-security.html).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Credential Wallet | Secret file reference | Mandatory for selected profile | Selected environment connection. Active profile = Secure External Password Store (SEPS); Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Wallet with external password-store credentials. | wallet | Yes | Disable |
| Wallet Password | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = Secure External Password Store (SEPS); Direct route (or native upstream profile managed by an MCP server). Selected wallet/driver requires a password; hidden for supported auto-login wallet use | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Required for password-protected wallet access. | lock | Yes | Disable |
| Credential Alias | Text | Mandatory for selected profile | Selected environment connection. Active profile = Secure External Password Store (SEPS); Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Alias matching the database connection. | tag | Yes | Disable |

#### Wallet mTLS + Database Login

Use for deployments such as wallet-based Autonomous Database connections. The TLS wallet does not automatically replace the database username/password.

Source: [Oracle wallet-based JDBC connections](https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/connect-jdbc-thin-wallet.html).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| TLS Wallet Bundle | Secret file reference | Mandatory for selected profile | Selected environment connection. Active profile = Wallet mTLS + Database Login; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Downloaded client identity and connection configuration. | wallet | Yes | Disable |
| Wallet Password | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = Wallet mTLS + Database Login; Direct route (or native upstream profile managed by an MCP server). Selected wallet/driver requires a password; hidden for supported auto-login wallet use | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Required by the wallet/driver configuration. | lock | Yes | Disable |
| Database Username | Text | Conditional mandatory — see Description | Selected environment connection. Active profile = Wallet mTLS + Database Login; Direct route (or native upstream profile managed by an MCP server). Oracle database-password or wallet mTLS + database-login profile; hidden for SEPS/Kerberos | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required for database password authentication. | user | Yes | Disable |
| Database Password | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = Wallet mTLS + Database Login; Direct route (or native upstream profile managed by an MCP server). Oracle database-password or wallet mTLS + database-login profile; hidden for SEPS/Kerberos | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for database password authentication. | key | Yes | Disable |
| TNS Alias | Text | Mandatory for selected profile | Selected environment connection. Active profile = Wallet mTLS + Database Login; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Service alias from the supplied configuration. | tag | Yes | Disable |

#### Kerberos

Show only when both database and driver are configured for Kerberos.

Source: [Oracle JDBC security](https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/client-side-security.html).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Principal | Text | Mandatory for selected profile | Selected environment connection. Active profile = Kerberos; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Kerberos identity. | user | Yes | Disable |
| Credential Source | Select | Mandatory for selected profile | Selected environment connection. Active profile = Kerberos; Direct route (or native upstream profile managed by an MCP server) | No default | Managed ticket cache; Keytab | Required. Managed ticket cache or keytab. | list | Yes | Disable |
| Ticket Cache / Keytab | Secret file reference | Mandatory for selected profile | Selected environment connection. Active profile = Kerberos; Direct route (or native upstream profile managed by an MCP server). Credential Source selects either managed ticket cache or keytab; accept only matching type | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Match the selected source and runtime login support. | file-key | Yes | Disable |
| Kerberos Configuration | Managed file reference | Mandatory for selected profile | Selected environment connection. Active profile = Kerberos; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Realm/KDC settings. | settings | Yes | Disable |

Other external identities, certificate-only database users, and cloud IAM tokens need a deployment-specific extension. Do not expose a generic OAuth field for every Oracle database. Validate driver and database support before enabling such profiles.

### MCP Access

Oracle can be exposed through a verified vendor tool or approved database MCP adapter. Driver/wallet credentials remain an upstream connection concern; validate server deployment and supported operations. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read-only Query Mode | Toggle | Mandatory (default supplied) | Applicable connector form section | Enable | Enable; Disable | Default Enable. Disable only where platform write policy permits. | lock | No | Enable |
| Saved SQL Template | Query editor | Optional | Applicable connector form section | No default; leave unset | Validated connector query or approved query template; assigned resources only | Approved parameterized query template. | code | No | Enable |
| Allow Dynamic SQL | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Requires query policy and database grants. | code | No | Enable |
| Maximum Rows | Integer | Optional | Applicable connector form section | 100 | Integer 1–1,000 | Maximum rows returned. | list | No | Enable |
| Statement Timeout | Duration | Optional | Applicable connector form section | 30 seconds | Duration 1–300 seconds | Maximum query execution time. | timer | No | Enable |
| LOB Handling | Select | Optional | Applicable connector form section | Exclude | Exclude; Preview; Bounded retrieval | Exclude, preview, or bounded retrieval. | file-text | No | Enable |
| Health Check Template | Managed reference | Mandatory when Read Database Health is enabled | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Approved availability and performance queries. | heart-pulse | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Oracle schemas, objects and approved procedures. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map approved query columns to incident/evidence fields; apply column masking before indexing or display.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Schemas | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Assigned schema names. | database | No | Disable |
| Tables / Views | Multi-select | Optional | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Objects allowed for investigation. | table | No | Disable |
| Saved Query Parameters | Key/value row editor | Optional | Project form only. Saved SQL Template defines parameters; field types follow the selected template | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Values bound to approved template parameters. | braces | No | Disable |
| Allowed Procedures | Multi-select | Mandatory when Execute Approved Procedure is enabled | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Approved procedures only; each needs execution permission. | code | No | Disable |
| Environment-to-Service Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Select a platform-provisioned database binding for each environment. | network | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Schema Metadata | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read schema metadata within assigned resources; default Disable. | toggle-right | No | Enable |
| Run Approved SELECT | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable run approved select within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Database Health | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read database health within assigned resources; default Disable. | toggle-right | No | Enable |
| Execute Approved Procedure | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable execute approved procedure within assigned resources; default Disable. | toggle-right | No | Enable |
| Execute Approved DML | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable execute approved dml within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Read Schema Metadata | oracle.read_schema_metadata | Required | Not required | Not required | Disable | Enable; Disable | Assigned objects/procedures; database user has required object/system grants |
| Run Approved SELECT | oracle.run_approved_select | Required | Not required | Not required | Disable | Enable; Disable | SELECT on approved views/tables; approved statement policy |
| Read Database Health | oracle.read_database_health | Required | Not required | Not required | Disable | Enable; Disable | Assigned objects/procedures; database user has required object/system grants |
| Execute Approved Procedure | oracle.execute_approved_procedure | Not required | Required | Required | Disable | Enable; Disable | EXECUTE on named procedure; Write gate retained because procedure effects may mutate data |
| Execute Approved DML | oracle.execute_approved_dml | Not required | Required | Required | Disable | Enable; Disable | INSERT/UPDATE/DELETE only as required by the approved statement and object grants |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

<a id="unix"></a>

## Unix

Connect PRISM to Unix/Linux hosts over SSH for health checks, approved log access and controlled operational commands.

Connector icon: **terminal**.

### Basic Information

General details and connection routing for Unix. Connector Name, Connector Type, Description and Tags identify the connector. Endpoint, Access Mode and authentication-dependent connection fields belong to the currently selected Environment Connection below. Direct-only fields are hidden in MCP-only mode unless needed for target validation.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Connector Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–128 characters; unique at platform level | Required. Platform-unique connector name. | tag | No | Disable |
| Connector Type | Read-only select | System-managed (fixed) | Applicable connector form section | Unix | Unix | Fixed to Unix. | plug | No | Disable |
| Environment Dependency | Select | Mandatory | Applicable connector form section | Environment-dependent | Independent; Environment-dependent | Required. Independent or environment-dependent binding. | network | Yes | Disable |
| Access Mode | Select | Mandatory | Applicable connector form section | Direct | Direct; MCP; Hybrid (implemented routes only) | Required. Direct (SSH), MCP, or Hybrid. | route | Yes | Disable |
| Host Name / IP Address | Hostname | Mandatory for selected SSH environment | Selected Unix environment connection; Access Mode = Direct or Hybrid and an SSH login profile is active. MCP-only mode uses the server-managed SSH target | None | Valid DNS hostname, IPv4 or IPv6 address assigned to this environment | Required for SSH password, key, certificate or GSSAPI login. Target DNS hostname, IPv4 or IPv6 address for the selected environment connection. | link | Yes | Disable |
| Presentation URL | URL | Optional | Applicable connector form section | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Optional user-facing destination for source links; not a credential or query API. | external-link | No | Disable |
| Description | Textarea | Optional | Applicable connector form section | Empty | Plain text; 0–2,000 characters | Explain connector purpose and intended data. | file-text | No | Enable |
| Tags | Tag list | Optional | Applicable connector form section | [] | 0–20 tags, each 1–64 characters | Searchable project labels. | tags | No | Enable |
| Use as Data Source | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted content to participate in PRISM retrieval. | database | No | Enable |
| Generic Viewer Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Permit authorized project viewers to see scoped results. | eye | No | Enable |
| Port | Integer | Mandatory for selected SSH environment | Selected Unix environment connection; Access Mode = Direct or Hybrid and an SSH login profile is active. MCP-only mode uses the server-managed SSH target | 22 | Integer 1–65,535; must match the target SSH listener | Required. Default 22; set the SSH port for this environment connection. | plug | Yes | Disable |
| Known Hosts / Host CA | Managed file reference | Mandatory | Applicable connector form section. Access Mode = Direct or Hybrid; hidden in MCP-only mode unless needed for target validation | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Trusted host keys or host-certificate authority. | file-check | Yes | Disable |
| Host Key Verification | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Enforced. Reject untrusted or changed host identities. | shield | Yes | Disable |
| Jump Host Connection | Managed reference | Optional | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional separately authenticated bastion connection. | route | Yes | Disable |
| Privilege Elevation Policy | Managed reference | Optional | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional approved run-as identities and command limits. | shield | Yes | Disable |

### Environment Connections — Repeatable

Select Add Environment to create another connection record. Each environment connection owns its target, authentication, MCP route and validation status. DEV, QA, STAGING and PROD are examples, not a fixed environment list. Connection secrets remain platform-managed; projects and tools select approved records.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Add Environment | Action + read-only result | Optional action | Applicable connector form section | No extra connection | Create another environment connection; at least one active connection is needed for use | Create another environment connection row with its own profile and target. | plus | Yes | Disable |
| Environment Connection ID | Read-only text | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated stable identifier used by project and per-tool bindings. | fingerprint | Yes | Disable |
| Environment Connection Name | Text | Mandatory | Applicable connector form section | None | Text 1–128 characters; unique within this connector | Required. Unique label within this connector; for example unix-qa-app01. | tag | Yes | Disable |
| Environment Name | Text | Mandatory | Applicable connector form section | None | Organization-defined environment label, 1–64 characters; multiple connections may share a label | Required. Organization environment label; for example QA or QLAB01. | globe | Yes | Disable |
| Environment Connection Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Activate only after the selected target and authentication profile pass validation. | toggle-right | Yes | Disable |
| Environment Target | Managed reference | Conditional mandatory — selected access route requires a target | Applicable connector form section. Selected environment connection; native target required in Direct/Hybrid; MCP-only target resolved by its MCP configuration | None | Structured native target fields defined for this connector, or server-managed target binding in MCP-only mode | Required. Connection target fields from Basic Information, including Unix hostname/IP and port, stored on this environment record. | server | Yes | Disable |
| Environment Authentication Profile | Select | Conditional mandatory — see Description | Applicable connector form section. Access Mode = Direct or Hybrid for the selected environment record | No default | Native authentication profiles supported by this connector and the selected environment target | Required for Direct/Hybrid. Select a native method from this connector; fill its conditional credential fields on this environment record. | key | Yes | Disable |
| Environment MCP Configuration | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Access Mode = MCP or Hybrid for the selected environment record | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for MCP/Hybrid. Store endpoint, transport and server-authentication binding separately for this environment. | plug | Yes | Disable |
| Environment Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum resources available through this environment connection. | filter | Yes | Disable |
| Environment Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Test this target, identity and resource scope independently; changing this environment does not validate others. | check | Yes | Disable |

### Authentication

Configure how PRISM authenticates with Unix, or with the selected MCP server. Choose one active native profile for direct access and one active MCP profile for MCP access. Hybrid requires both.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Supported Authentication Profiles | Read-only list | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Methods implemented by the installed adapter and target deployment. | list | Yes | Disable |
| Active Native Profile | Select | Mandatory when Direct or Hybrid is selected | Applicable connector form section. Access Mode = Direct or Hybrid; list only profiles implemented by this connector and deployment | No default | Implemented direct profiles listed in this connector’s Authentication section | Required for Direct/Hybrid; select one profile below. | key | Yes | Disable |
| Credential Owner / Binding | Managed reference | Mandatory for each active connection route | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Platform identity or assigned connection record. | user | Yes | Disable |
| Connection Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Verify authentication and a scoped read. Show status, identity and missing permissions without secrets. | check | Yes | Disable |

#### SSH Private Key

Authenticate with the key corresponding to an authorized public key on the target account.

Source: [OpenSSH client configuration](https://man.openbsd.org/ssh_config).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Username | Text | Mandatory for selected SSH profile | Selected Unix environment connection and active SSH login profile = SSH Private Key | None | Non-empty remote Unix account accepted by the selected host; no automatic root/default account | Required. Remote Unix account. | user | Yes | Disable |
| Private Key | Secret reference | Mandatory when selected profile uses a separate private key | Selected environment connection. Active profile = SSH Private Key; Direct route (or native upstream profile managed by an MCP server). Selected certificate profile uses a separate key; not required if key is included in the managed keystore | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Supported SSH private key. | key | Yes | Disable |
| Key Passphrase | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = SSH Private Key; Direct route (or native upstream profile managed by an MCP server). Selected SSH private key is encrypted | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Required for an encrypted key. | lock | Yes | Disable |

#### SSH User Certificate

Use a signed OpenSSH user certificate with its matching key.

Source: [OpenSSH client configuration](https://man.openbsd.org/ssh_config).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Username | Text | Mandatory for selected SSH profile | Selected Unix environment connection and active SSH login profile = SSH User Certificate | None | Non-empty remote Unix account accepted by the selected host; no automatic root/default account | Required. Remote account. | user | Yes | Disable |
| User Certificate | Secure file reference | Mandatory for selected profile | Selected environment connection. Active profile = SSH User Certificate; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Signed SSH user certificate. | file-key | Yes | Disable |
| Private Key | Secret reference | Mandatory when selected profile uses a separate private key | Selected environment connection. Active profile = SSH User Certificate; Direct route (or native upstream profile managed by an MCP server). Selected certificate profile uses a separate key; not required if key is included in the managed keystore | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Matching private key. | key | Yes | Disable |
| Key Passphrase | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = SSH User Certificate; Direct route (or native upstream profile managed by an MCP server). Selected SSH private key is encrypted | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Required for an encrypted private key. | lock | Yes | Disable |

#### SSH Password

Show when password login is allowed by the remote SSH server.

Source: [OpenSSH client configuration](https://man.openbsd.org/ssh_config).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Username | Text | Mandatory for selected SSH profile | Selected Unix environment connection and active SSH login profile = SSH Password | None | Non-empty remote Unix account accepted by the selected host; no automatic root/default account | Required. Remote account. | user | Yes | Disable |
| SSH Password | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = SSH Password; Direct route (or native upstream profile managed by an MCP server) | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Account password. | lock | Yes | Disable |

#### GSSAPI / Kerberos

Show only when supported by the SSH client build, server, and prepared runtime.

Source: [OpenSSH client configuration](https://man.openbsd.org/ssh_config).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Username | Text | Mandatory for selected SSH profile | Selected Unix environment connection and active SSH login profile = GSSAPI / Kerberos | None | Non-empty remote Unix account accepted by the selected host; no automatic root/default account | Required. Target account. | user | Yes | Disable |
| Principal | Text | Mandatory for selected profile | Selected environment connection. Active profile = GSSAPI / Kerberos; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Kerberos client identity. | fingerprint | Yes | Disable |
| Ticket Cache Binding | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = GSSAPI / Kerberos; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Renewable runtime credentials. | key | Yes | Disable |
| Kerberos Configuration | Managed file reference | Mandatory for selected profile | Selected environment connection. Active profile = GSSAPI / Kerberos; Direct route (or native upstream profile managed by an MCP server) | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Realm/KDC configuration. | settings | Yes | Disable |

Keyboard-interactive MFA requires an interactive session and is excluded from unattended monitoring. Jump-host authentication is a separate managed connection. Privilege elevation is an execution permission, not an SSH login method.

### MCP Access

MCP access uses an approved remote-operations server/adapter. Its SSH credentials and host verification are independent of PRISM-to-MCP credentials. All supported methods have conditional field details in the shared MCP profiles below.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| MCP Server Source | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid. Required for MCP/Hybrid | No default | Vendor; Organization-managed; Third-party | Required for MCP/Hybrid. Vendor, organization-managed, or third-party. | server | Yes | Disable |
| MCP Transport | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | Streamable HTTP | Streamable HTTP; Managed stdio | Required. Streamable HTTP or supported managed stdio runtime. | network | Yes | Disable |
| MCP Endpoint | URL | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Streamable HTTP | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required for HTTP. Verified endpoint; no guessed vendor URL. | link | Yes | Disable |
| Managed MCP Runtime | Managed reference | Conditional mandatory — see Description | Access Mode = MCP or Hybrid. Access Mode = MCP or Hybrid and MCP Transport = Managed stdio | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for stdio; registered runtime launch configuration. | terminal | Yes | Disable |
| MCP Authentication Method | Select | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default | Server-supported vendor profiles or shared MCP A–F profiles | Required. Vendor profile or supported shared MCP profile. | key | Yes | Disable |
| MCP Authentication Binding | Managed reference | Mandatory when MCP or Hybrid is selected | Access Mode = MCP or Hybrid | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Selected method-specific credentials/configuration. | lock | Yes | Disable |
| Upstream Connection Binding | Managed reference | Mandatory when the selected MCP server requires an upstream binding | Access Mode = MCP or Hybrid. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Server-side native identity binding; not an MCP token passthrough. | link | Yes | Disable |
| Allowed MCP Tools | Multi-select | Mandatory when enabling MCP capabilities | Access Mode = MCP or Hybrid. Re-evaluate after authentication, scopes, target or route changes | [] | Discovered and platform-approved MCP tool IDs, bound to capability rules | Select discovered tool IDs; enforce against project scope. | list-checks | Yes | Disable |
| Capability Route Mapping | Row editor | Mandatory in Hybrid mode | Access Mode = MCP or Hybrid. Access Mode = Hybrid; each enabled capability needs an explicit route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required in Hybrid. Capability → Direct/MCP → approved binding. | route | Yes | Disable |
| MCP Validation Status | Read-only status | System-managed (no user input) | Access Mode = MCP or Hybrid | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Handshake, tool discovery and scoped read validated separately. | check | Yes | Disable |

### Investigation Settings

Defaults for collecting and searching connector data. All values remain bounded by platform scope and resource limits.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Health Check Profile | Managed reference | Mandatory when Check Host Health is enabled | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Approved CPU, memory, disk and service checks. | heart-pulse | No | Enable |
| Log Lookback Period | Duration | Optional | Applicable connector form section | 24 hours | Duration 1 minute–30 days, within source retention | Default log investigation window. | history | No | Enable |
| Maximum Output Size | Integer (KB) | Optional | Applicable connector form section | 1024 | Integer 1–10,240 KB | Bound command/log output returned to PRISM. | file-text | No | Enable |
| Command Timeout | Duration | Optional | Applicable connector form section | 30 seconds | Duration 1–300 seconds | Maximum runtime per approved command. | timer | No | Enable |
| Log Parsing Mode | Select | Optional | Applicable connector form section | Plain text | Plain text; JSON; Approved parser | Plain text, JSON or approved parser. | braces | No | Enable |

### Permissions & Access

Connector operations and access governance. Project overrides can restrict access only.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Allow permitted read operations. | eye | No | Enable |
| Read Roles | Multi-select | Mandatory when Read Access is enabled | Applicable connector form section. Read Access = Enable | [] / no access until explicitly assigned | Existing PRISM project roles, restricted to platform-authorized roles | Required if read is enabled; select existing PRISM project roles. | users | No | Enable |
| Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Parent gate for source-changing operations. | pencil | No | Enable |
| Minimum Write Role | Role select | Mandatory when Write Access is enabled | Applicable connector form section. Write Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if write is enabled; suggested Project Analyst if present in the role hierarchy. | shield | No | Enable |
| Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable. Required for commands, procedures, pipelines or other executable actions. | play | No | Enable |
| Minimum Execution Role | Role select | Mandatory when Execution Access is enabled | Applicable connector form section. Execution Access = Enable | [] / no access until explicitly assigned | Existing PRISM roles at or above the platform minimum; explicit role list if hierarchy is undefined | Required if execution is enabled; choose from configured PRISM roles. | shield | No | Enable |
| Platform Resource Scope | Allowlist editor | Mandatory | Applicable connector form section | [] (deny all until assigned) | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum assignable Unix hosts, paths and command profiles. | list-checks | Yes | Disable |
| Data Masking Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform masking rules applied before results are stored or displayed. | eye-off | Yes | Disable |

### Field Mapping

Map host, command output, log timestamp, severity and service identity to infrastructure evidence.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Mapping Profile | Managed reference | Optional | Applicable connector form section | Connector’s approved standard mapping, if provisioned | Compatible entries from the platform-approved registry assigned to this project/connection | Default mapping profile; project may select a compatible approved profile. | shuffle | No | Enable |
| Standard Field | Select | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default | Fields in the selected PRISM incident, knowledge or evidence schema | Required for each mapping row. PRISM target field. | tag | No | Enable |
| Source Field / Path | Select or validated path | Mandatory for each mapping row | Applicable connector form section. Required for each mapping row | No default; leave unset | Verified source field identifier/path compatible with the target field type | Required for each mapping row. Verified source schema field/path. | braces | No | Enable |
| Transform | Select | Optional | Applicable connector form section | None | None; Trim; Case normalization; Timestamp parse; Numeric parse; Registered conversion | Optional approved conversion; no arbitrary code in a mapping row. | wand | No | Enable |
| Unmapped Field Handling | Select | Optional | Applicable connector form section | Ignore | Ignore; Include approved fields | Ignore or include approved fields; masking and scope always apply. | filter | No | Enable |

### Advanced Settings

Timeouts, size limits and audit telemetry. These are proposed PRISM defaults; tune for the actual deployment.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Request / Operation Timeout | Integer (seconds) | Mandatory (platform default supplied) | Applicable connector form section | 30 | Integer 1–300 seconds | Default 30; platform policy defines the upper bound. | timer | No | Enable |
| Retry Attempts | Integer | Mandatory (platform default supplied) | Applicable connector form section | 3 | Integer 0–5 | Default 3 for safe retryable reads; never blindly retry side-effecting operations. | refresh-cw | No | Enable |
| Retry Backoff | Select + duration | Mandatory (platform default supplied) | Applicable connector form section | Exponential with jitter; 1 second initial delay | Exponential with jitter; initial delay 1–30 seconds; honor provider retry instructions | Exponential delay with jitter; honor provider retry instructions. | clock | No | Enable |
| Operation Rate Limit | Integer / minute | Mandatory (platform default supplied) | Applicable connector form section | 60 | Integer 1–6,000 operations/minute | PRISM throttle; API requests, database operations or commands as applicable. | gauge | No | Enable |
| Maximum Response Size | Integer (MB) | Mandatory (platform default supplied) | Applicable connector form section | 10 | Integer 1–100 MB | Upper bound for returned content. | file | No | Enable |
| Platform Resource Ceilings | Policy row editor | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Maximum results, bytes, runtime, rates and concurrency. | gauge | Yes | Disable |
| Audit Telemetry | Read-only policy | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Record actor, project, route, action, scope and result; exclude credentials. | clipboard-list | Yes | Disable |
| Network / TLS Policy | Managed reference | Mandatory (platform-provisioned) | Applicable connector form section | Platform policy assigned during provisioning | Compatible entries from the platform-approved registry assigned to this project/connection | Platform-managed trust, proxy and connection policy. | shield | Yes | Disable |

### Project Setup — Project Only

These fields exist only on the project form. They are editable project-owned values, so Project Override is Disable rather than an inheritance setting.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| System Name | Text | Mandatory | Project form only | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Project-specific application/system label. | app-window | No | Disable |
| Tool Environment | Select | Mandatory for environment-dependent connections; optional otherwise | Project form only. Project Setup; required for Environment Dependency = Environment-dependent | No default | Project environment catalog (for example DEV, QA, STAGING, PROD) | Required for environment-dependent connections; otherwise optional label. | globe | No | Disable |
| Connection Assignment | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required per project environment. Select an approved Environment Connection ID; show safe label/status only. | plug | No | Disable |
| Target Hosts | Multi-select | Mandatory | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Required. Hosts assigned to the project. | server | No | Disable |
| Allowed Log Paths | Text list | Conditional mandatory — see Description | Project form only. Required for log access; subset of platform-approved paths | [] | Unique non-empty strings; every resolved resource must remain within assigned scope | Required for log access; subset of platform-approved paths. | folder | No | Disable |
| Service Names | Text list | Mandatory when service inspection or restart is enabled | Project form only | [] | Unique non-empty strings; every resolved resource must remain within assigned scope | Services to inspect within policy. | settings | No | Disable |
| Approved Command Profiles | Multi-select | Mandatory when command execution is enabled | Project form only | [] | One or more verified source resources from the platform-assigned catalog; [] allowed only when optional | Select registered command templates and permitted parameters. | terminal | No | Disable |
| Environment-to-Host Mapping | Key/value row editor | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Map project environments to assigned hosts. | network | No | Disable |
| Monitoring Enabled | Toggle | Mandatory (default supplied) | Project form only | Disable | Enable; Disable | Enable scheduled checks for this project. | activity | No | Disable |
| Polling Schedule | Schedule + timezone | Mandatory when Monitoring Enabled is Enable | Project form only. Monitoring Enabled = Enable | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required if monitoring is enabled. Include named timezone. | calendar-clock | No | Disable |
| Reports | Repeatable form | Optional | Project form only | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional. Add report rows using the shared project report editor below. | file-chart | No | Disable |
| Inbound Event / Webhook Binding | Managed reference | Optional | Project form only | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional. Select an approved event receiver if supported; separate from outbound authentication. | webhook | No | Disable |

### Capabilities

One Enable/Disable toggle per capability. Show only capabilities implemented by the chosen adapter and route. Source-changing actions also require Write Access; executable actions also require Execution Access.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Check Host Health | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable check host health within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Approved Logs | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read approved logs within assigned resources; default Disable. | toggle-right | No | Enable |
| Read Service Status | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable read service status within assigned resources; default Disable. | toggle-right | No | Enable |
| Run Approved Read Command | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable run approved read command within assigned resources; default Disable. | toggle-right | No | Enable |
| Restart Approved Service | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable restart approved service within assigned resources; default Disable. | toggle-right | No | Enable |
| Transfer Approved File | Toggle | Mandatory (default supplied) | Adapter/route implements this capability and the selected credential grants the required operation; otherwise disabled | Disable | Enable; Disable | Enable transfer approved file within assigned resources; default Disable. | toggle-right | No | Enable |

#### Tool / operation access matrix

Each row is a distinct permission rule. Tool IDs below are proposed PRISM logical IDs, not asserted vendor/MCP tool names. Map actual discovered MCP tools to these rules. “Required” means that access gate must be enabled; “Not required” never grants that access. All rows also require the capability toggle and an authorized per-tool role.

| Capability | Logical tool ID | Read Access gate | Write Access gate | Execution Access gate | Default | Allowed Values | Source permission / scope requirement |
|---|---|---|---|---|---|---|---|
| Check Host Health | unix.check_host_health | Required | Not required | Not required | Disable | Enable; Disable | Assigned hosts/paths; SSH user and approved run-as policy permit this operation |
| Read Approved Logs | unix.read_approved_logs | Required | Not required | Not required | Disable | Enable; Disable | Assigned hosts/paths; SSH user and approved run-as policy permit this operation |
| Read Service Status | unix.read_service_status | Required | Not required | Not required | Disable | Enable; Disable | Assigned hosts/paths; SSH user and approved run-as policy permit this operation |
| Run Approved Read Command | unix.run_approved_read_command | Required | Not required | Required | Disable | Enable; Disable | Assigned hosts/paths; SSH user and approved run-as policy permit this operation |
| Restart Approved Service | unix.restart_approved_service | Not required | Required | Required | Disable | Enable; Disable | Assigned hosts/paths; SSH user and approved run-as policy permit this operation |
| Transfer Approved File | unix.transfer_approved_file | Not required | Required | Not required | Disable | Enable; Disable | Upload only in this capability; Write on approved destination. Downloads use separate read capability if added |

### Per-Tool Access Rules

Repeat one rule for every enabled logical operation, mapped native/MCP tool and selected environment connection. Read/Write/Execution gates can be narrowed separately in each environment rule. A connector-wide gate is a prerequisite, not a grant to all tools.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Logical Capability | Read-only select | System-managed (fixed) | Applicable connector form section | Current operation from the capability matrix | Exactly one logical capability defined for this connector | Fixed to the operation being configured; access classification comes from the matrix. | list | No | Disable |
| Source / MCP Tool ID | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Verified native operation or discovered MCP tool mapped to this capability. | plug | Yes | Disable |
| Environment Read Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Read Access; connector/project Read Access must also be enabled | Disable | Enable; Disable | Allow this tool’s read operation in the selected environment only when connector/project Read Access also permits it. | eye | No | Enable |
| Environment Write Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Write Access; connector/project Write Access must also be enabled | Disable | Enable; Disable | Allow this tool’s write operation in the selected environment only when connector/project Write Access also permits it. | pencil | No | Enable |
| Environment Execution Access | Toggle | Mandatory (default supplied) | Applicable connector form section. Tool/environment rule requires Execution Access; connector/project Execution Access must also be enabled | Disable | Enable; Disable | Allow this tool’s executable operation in the selected environment only when connector/project Execution Access also permits it. | play | No | Enable |
| Tool Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section. Re-evaluate after authentication, scopes, target or route changes | Disable | Enable; Disable | Enable this individual operation only when its connector capability and access gates allow it. | toggle-right | No | Enable |
| Tool Allowed Roles | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; role catalog narrowed by this tool’s access gates | [] | Existing PRISM project roles permitted by connector policy and applicable minimum role | Required when Tool Enabled is Enable; subset of connector roles, with the applicable write/execution minimum enforced. | users | No | Enable |
| Tool Resource Scope | Allowlist editor | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; must be a subset of connector and project scope | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required when Tool Enabled is Enable; may only narrow the connector/project scope. | filter | No | Enable |
| Tool Credential Binding | Managed reference | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; binding grants must satisfy this operation’s gates | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required for enabled operations. Platform-assigned identity with the needed read/write grants; may differ by tool. | key | Yes | Disable |
| Tool Environment Connections | Multi-select | Conditional mandatory — see Description | Applicable connector form section. Tool Enabled = Enable; use only project-assigned environment records | [] | Approved Environment Connection IDs assigned to this project; each tool/environment pair requires its own permission rule | Required when Tool Enabled is Enable. Select assigned environment connections in which this tool can run. | globe | No | Enable |
| Tool Default Environment Connection | Select | Optional | Applicable connector form section. Optional; must be in Tool Environment Connections | None — require explicit caller selection | One entry from Tool Environment Connections; empty is allowed | Optional. One allowed environment connection; when unset the caller must select one explicitly. | target | No | Enable |
| Tool Environment Credential Mapping | Row editor | Conditional mandatory — see Description | Applicable connector form section. Each enabled tool/environment pair; identity grants must match that pair’s read/write/execution policy | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required for enabled tool/environment pairs. Bind each pair to the platform-approved identity and its validated read/write grants. | key | Yes | Disable |
| Tool Access Route | Select | Mandatory when Tool Enabled is Enable | Applicable connector form section. Tool Enabled = Enable; Access Mode and actual tool support determine allowed routes | No default | Direct; MCP — only routes implemented for this tool and enabled by Access Mode | Required for enabled operations. Direct or MCP according to implemented route mapping. | route | Yes | Disable |
| Tool Permission Test | Action + read-only result | Action (mandatory before activation) | Applicable connector form section | Not tested | Not tested; Passed; Failed; Missing permissions; Expired | Validate expected grants without performing a source-changing action. | check | Yes | Disable |

## Shared MCP authentication profiles

These conditional subforms belong to the MCP Access section of every connector. Show only methods accepted by the selected server and implemented by PRISM. They supplement the vendor-specific profiles; they do not promise support on every MCP server.

For HTTP MCP, the standard authorization flow uses OAuth and audience-bound access tokens. Custom header, Basic or gateway certificate methods below are deployment-specific extensions. For stdio, use managed process credentials rather than an HTTP login flow. Source: [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [MCP transport authentication overview](https://modelcontextprotocol.io/specification/2025-11-25/basic).

#### MCP A — OAuth 2.1 Interactive

Discover the authorization service, register or identify the client, obtain consent, and store the returned tokens. State and PKCE are generated by PRISM.

Source: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Authorization Server | Read-only URL | System-managed (no user input) | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Discovered from validated server metadata. | link | Yes | Disable |
| Client Registration Method | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route | No default | Client metadata document; Pre-registered; Dynamic registration (server-supported only) | Required. Supported metadata registration, pre-registration or dynamic registration. | list | Yes | Disable |
| Client ID / Metadata URL | Text or URL | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route. Registration method determines whether client ID or metadata URL is required | No default; leave unset | Valid registered identifier or approved HTTPS metadata URL | Conditional. Required for the chosen registration method. | fingerprint | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route. Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Confidential clients only. | lock | Yes | Disable |
| Redirect URI | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route | No default; leave unset | Exact registered callback; HTTPS, or loopback HTTP only when supported by the OAuth flow | Required. Callback accepted by the authorization service. | link | Yes | Disable |
| Resource / Audience | Read-only URL | System-managed (no user input) | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Required. Intended MCP resource identifier. | target | Yes | Disable |
| Scopes | Multi-select | Mandatory for selected profile | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route | No default — derive from enabled operations and selected provider | Scopes supported by the active MCP A — OAuth 2.1 Interactive and required by enabled tools; requesting scopes does not grant them | Required. Server-advertised scopes for selected tools. | list-checks | Yes | Disable |
| Token Set | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = MCP A — OAuth 2.1 Interactive; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated access/refresh tokens and expiry. | key | Yes | Disable |

#### MCP B — Static Bearer Token / API Key

Show only when the server documents a static credential scheme; this is not automatically equivalent to OAuth.

Design: conditional adapter profile; use the selected server’s documented credential contract.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Credential Scheme | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP B — Static Bearer Token / API Key; MCP route | No default | Bearer token; API-key header (server-supported only) | Required. Bearer token or server-specific API-key header. | list | Yes | Disable |
| Header Name | Text | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP B — Static Bearer Token / API Key; MCP route. Credential Scheme = API-key header; derived as Authorization for Bearer | Authorization for Bearer; no API-key default | Authorization or the API-key header documented by the selected server | Required for an API key; fixed Authorization for Bearer. | tag | Yes | Disable |
| Token / API Key | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP B — Static Bearer Token / API Key; MCP route | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Credential issued for this MCP service. | key | Yes | Disable |
| Expiry | Datetime | Optional | Selected environment connection. Active profile = MCP B — Static Bearer Token / API Key; MCP route | No default; leave unset | Non-empty text when supplied; validate against source configuration | Optional server-provided expiry metadata. | clock | Yes | Disable |

#### MCP C — Basic Authentication

Show only when the server explicitly supports Basic authentication, such as a documented account-email/API-token flow.

Design: conditional adapter profile. See the Atlassian-specific profile for its exact credential semantics.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Username / Email | Text | Mandatory for selected profile | Selected environment connection. Active profile = MCP C — Basic Authentication; MCP route | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Identity accepted by this server. | user | Yes | Disable |
| Password / API Token | Secret reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP C — Basic Authentication; MCP route | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Credential specified by the server. | lock | Yes | Disable |

#### MCP D — Gateway mTLS

Show only for a verified gateway/server that accepts client certificates. The gateway may additionally require OAuth or another application credential.

Design: deployment-specific gateway profile, not a universal MCP authentication method.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Client Certificate | Secure file reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP D — Gateway mTLS; MCP route | No default; leave unset | Approved managed file of the format required by the selected profile | Required. Accepted client identity certificate. | file-key | Yes | Disable |
| Private Key | Secret reference | Mandatory when selected profile uses a separate private key | Selected environment connection. Active profile = MCP D — Gateway mTLS; MCP route. Selected certificate profile uses a separate key; not required if key is included in the managed keystore | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required. Matching private key. | key | Yes | Disable |
| Private Key Passphrase | Secret reference | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP D — Gateway mTLS; MCP route. Selected private key is encrypted | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Required for encrypted key material. | lock | Yes | Disable |
| Gateway CA / Trust Binding | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP D — Gateway mTLS; MCP route | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Server trust and identity verification. | shield | Yes | Disable |
| Additional Application Auth | Managed reference | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP D — Gateway mTLS; MCP route. Conditional | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Conditional. Required if mTLS alone does not authorize MCP tools. | key | Yes | Disable |

#### MCP E — Machine-to-Machine OAuth

Show only when both server and client implement a documented machine identity extension. Do not assume every interactive MCP OAuth server supports client credentials.

Design: optional extension profile, enabled only after server-specific compatibility is verified.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Token Endpoint | URL | Mandatory for selected profile | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route | No default; leave unset | Valid approved HTTPS URL without embedded credentials | Required. Verified authorization service endpoint. | link | Yes | Disable |
| Client ID | Text | Mandatory when the selected profile requires a registered client ID | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Registered machine identity. | fingerprint | Yes | Disable |
| Client Authentication Method | Select | Mandatory for selected profile | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route | No default | Client secret; Signed assertion (server-supported only) | Required. Supported client secret or signed assertion. | list | Yes | Disable |
| Client Secret | Secret reference | Conditional mandatory — selected client authentication requires a secret | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route. Selected OAuth client is confidential and uses secret-based client authentication; otherwise hidden | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for client-secret authentication. | lock | Yes | Disable |
| Signing Key / Key ID | Secret reference + text | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route. Client Authentication Method = Signed assertion | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required for signed client assertions. | file-key | Yes | Disable |
| Scopes / Audience | Structured fields | Optional | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required as specified by the server. | target | Yes | Disable |
| Token Cache | Managed secret reference | System-managed (no user input) | Selected environment connection. Active profile = MCP E — Machine-to-Machine OAuth; MCP route | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated token and renewal metadata. | key | Yes | Disable |

#### MCP F — Managed stdio Runtime

Use a registered local/server-side process configuration. A stdio connection does not have an HTTP endpoint or Bearer-header form.

Source: [MCP transport authentication overview](https://modelcontextprotocol.io/specification/2025-11-25/basic).

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Runtime Package / Image | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP F — Managed stdio Runtime; MCP route | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Approved server implementation and version. | package | Yes | Disable |
| Execution Identity | Managed reference | Mandatory for selected profile | Selected environment connection. Active profile = MCP F — Managed stdio Runtime; MCP route | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Operating-system/runtime identity. | user | Yes | Disable |
| Environment Credential Bindings | Secret mapping | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP F — Managed stdio Runtime; MCP route. Managed stdio runtime declares credential environment inputs | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Conditional. Map approved variable names to vault credentials. | key | Yes | Disable |
| Upstream Profile Binding | Managed reference | Conditional mandatory — see Description | Selected environment connection. Active profile = MCP F — Managed stdio Runtime; MCP route. Required when this process needs credentials for the target tool | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required when this process needs credentials for the target tool. | plug | Yes | Disable |

## Shared project report editor

Use this repeatable editor under Reports on every project form. All rows are project-owned, so Project Override is Disable. Show an “Add report” action and create one complete group of the fields below per report.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Report Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Unique name within the project. | file-chart | No | Disable |
| Query / Check Definition | Query editor or managed reference | Mandatory for each report row | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. JQL, CQL, SPL, SignalFlow, supported filters, SQL template or approved health-check profile. | search | No | Disable |
| Dynamic Query Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Default Disable; requires the connector’s applicable query policy. | code | No | Disable |
| Schedule | Schedule + timezone | Mandatory when the report is scheduled | Applicable connector form section. Report Enabled = Enable and scheduled execution requested | Disabled / no schedule | Valid schedule supported by PRISM plus an IANA timezone; polling no faster than 1 minute | Required when scheduled delivery is enabled. | calendar-clock | No | Disable |
| Reporting Template | Managed reference | Mandatory for each report row | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Approved layout/format template. | layout | No | Disable |
| Custom Script | Managed reference | Optional | Applicable connector form section. Optional report processor selected from the approved script registry | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Optional approved processing script; no unrestricted inline execution. | code | No | Disable |
| Report Parameters | Key/value row editor | Optional | Applicable connector form section. Selected Reporting Template or Query / Check Definition declares parameters | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Optional typed parameters validated against the template. | braces | No | Disable |
| Report Enabled | Toggle | Mandatory (default supplied) | Applicable connector form section | Disable | Enable; Disable | Enable or disable this report. | toggle-right | No | Disable |

## Shared inbound event / webhook binding

An inbound webhook verifies an event arriving at PRISM. It does not authenticate PRISM’s outbound API or MCP requests. Create this platform-managed binding only where the source supports event delivery; projects select the resulting safe reference.

| Field | Type | Mandatory / Optional | Applies When / Dependency | Default Value | Allowed Values | Description | Icon | Platform only (not visible for project) | Project Override allowed |
|---|---|---|---|---|---|---|---|---|---|
| Receiver Name | Text | Mandatory | Applicable connector form section | No default; leave unset | Text 1–255 characters when supplied; validate resource identity with source | Required. Unique platform receiver label. | tag | Yes | Disable |
| Source Connector Binding | Managed reference | Mandatory | Applicable connector form section | No default; leave unset | Compatible entries from the platform-approved registry assigned to this project/connection | Required. Source instance and permitted project scope. | plug | Yes | Disable |
| Receiver URL | Read-only URL | System-managed (no user input) | Applicable connector form section | System-derived; not user-editable | Values returned by validated discovery, authentication or platform policy | Generated by PRISM for the configured event adapter. | link | Yes | Disable |
| Verification Method | Select | Mandatory | Applicable connector form section | No default | Signature; Shared header token; mTLS; Registered source verifier | Required. Signature, shared header token, mTLS or other verified source method. | shield | Yes | Disable |
| Verification Secret / Trust Binding | Secret or managed reference | Optional | Applicable connector form section. Verification Method selects signature secret, header token, client trust or registered verifier configuration | None — credentials are never prefilled | Authorized vault entry of the required credential type; never an inline saved secret | Required according to the chosen verification method. | key | Yes | Disable |
| Accepted Event Types | Multi-select | Mandatory | Applicable connector form section | [] | Events declared by the registered source adapter | Required. Events supported by the adapter. | list-checks | Yes | Disable |
| Project Routing Mapping | Mapping editor | Mandatory | Applicable connector form section | [] / no rows | Rows matching the declared typed schema; unique keys; references constrained to assigned scope | Required. Map verified source identifiers to authorized PRISM projects. | route | Yes | Disable |

## Dynamic field and permission rules

Authentication Method, Access Mode, deployment support, transport, credential format, environment dependency and enabled capabilities are parent selections. Child fields must be recalculated whenever a parent changes.

- Apply rules in this order: connector/deployment compatibility → access route → active authentication profile → credential format and provider settings → granted permissions → enabled capabilities → project scope and overrides.
- Visibility and mandatory status are separate. When an active field is optional, it may remain empty. When it is hidden, ignore its value for validation and request construction; never reuse credentials from a previously selected profile.
- Defaults are conditional suggestions, not permission grants. Preserve a user-entered value only if it remains valid under the new profile. Otherwise clear its binding or mark it invalid for correction. Do not silently substitute a credential or downgrade transport security.
- Kafka mTLS derives Security Protocol = SSL and requires certificate/key inputs; Kafka SASL profiles derive SASL_SSL. Only PLAIN and SCRAM show broker username/password. OAuth client credentials and keystore passwords are distinct inputs.
- An OAuth public client hides Client Secret; a confidential client requires the configured secret or assertion material. Oracle SEPS hides explicit database username/password; the wallet mTLS + database-login profile requires them. MCP-only mode hides native credentials when the MCP server already owns the upstream connection.
- Changing credentials, scopes, target, transport or route marks connection tests stale. Revalidate identity, source permissions and discovered MCP tools before activating affected capabilities. A read-only credential cannot activate write operations even when the connector supports them.
- Each native/MCP tool maps to a platform-classified operation. Effective tool access requires capability enabled, applicable Read/Write/Execution gates, an authorized role, assigned resource scope and sufficient credential grants. Unknown/unmapped tools remain disabled. MCP tool annotations alone do not establish permission.
- Project overrides obey the same dependencies. Hidden inherited fields have no active override. Resetting a parent re-evaluates dependent fields against platform policy.

## Form behavior and validation

1. Selecting the connector type loads that connector’s sections and supported authentication methods. Deployment discovery can reduce the method list; it must not silently add an unsupported profile.
2. Selecting Direct, MCP or Hybrid reveals only relevant connection fields. MCP-only mode does not require PRISM to collect the underlying tool password when the MCP server already manages that identity.
3. Changing authentication method reveals that profile’s inputs. Inactive credentials are not submitted with the active profile. Switching methods requires a new connection test.
4. OAuth profiles provide Connect, Reconnect and Disconnect actions; token profiles provide a masked credential picker; certificate, wallet and key profiles use managed secret/file controls. Show expiry and connection health without showing secrets.
5. Validate required inputs, URLs/hosts/ports, identity, credential freshness, supported operations and project scope separately. A successful login does not mean every capability is authorized.
6. Project override controls show the inherited value, effective value and “Reset to platform default.” Platform policy changes immediately constrain existing project overrides. Platform-only data stays absent from project-facing configuration responses.
7. Enforce permissions and resource constraints on the backend for both direct and MCP calls. A query filter or hidden form control alone is not an access boundary. MCP tool discovery confirms availability; it does not grant permission.
8. For independent environments, permit one assigned connection across environments. For dependent environments, require an explicit platform-provisioned connection assignment for each project environment.

## Research boundaries

Authentication coverage is selected for the connector use cases above, not an exhaustive list of every legacy or vendor-specific identity system. Jira and Confluence here are Cloud forms, qTest is Manager, and Oracle is a database connector. Cloud-provider IAM, custom SSO, legacy app installations and specialized gateways require a deployment-specific profile before they appear as selectable methods. All example addresses and suggested defaults must be validated against the configured deployment.
