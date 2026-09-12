# Shared platform harness library

The RCA Analyzer platform supplies reusable capabilities, skills, specialist templates,
and plugin bundles. Projects inherit that library and can narrow their selection.
The authenticated deployment scope determines which project is edited.

## Baseline resources

[The shared catalog](../blob_local/platform/config/harness.yaml) contains four specialist
templates: Ticket Evidence Reviewer, Log Pattern Reviewer, Incident Timeline Reviewer,
and Attachment Evidence Reviewer. Four plugin bundles group their related capabilities
and skills. Existing [capability manifests](../blob_local/platform/capabilities) and
[skill files](../blob_local/platform/skills) remain authoritative for those resources.
Model names and execution limits remain in
[model profiles](../blob_local/platform/config/model_profiles.yaml).

A plugin here is a data-only collection of registered resources. It does not install
Python packages, execute scripts, register new tools, or activate a connector. Jira and
Splunk remain the implemented read-only providers; attachment images support OCR only.

## Specialist approval

Inheriting a specialist template makes it available for project submission. It does
not approve the agent. Submit its definition through the existing
[agent configuration API](../app/api/routes/agents.py); a different authorized
administrator in the same scope must approve the exact content hash. Only approved
project definitions enter the native ADK workflow. Editing a shared template does not
rewrite an already approved project revision.

## Deployment boundaries

The platform baseline is shared by projects loading the same platform bundle. Each
running deployment still has one server-configured tenant/project scope. Database
configuration uses scoped versioned snapshots: changing one deployment's catalog does
not broadcast changes into other deployments or replace their active snapshots.
Deploy the updated baseline to those deployments using the existing configuration
bundle workflow. This release has no background synchronization worker.

See [configuration snapshots](../app/configuration/database_bundle.py),
[inheritance rules](../app/configuration/layers.py), and the
[harness architecture](harness.md) for the source-backed deployment contract.

## UI and persistence

Open **Harness Studio → Harness Library**. The library lists platform specialist
templates, six baseline skills, six baseline capabilities (database RCA stays
disabled), and four plugin bundles. Project owners and platform administrators can
include or exclude resources, save the selection, and reset it to inheritance.
The project save keeps exclusions rather than copying every platform entry, so
future additions remain inherited. A disabled bundle excludes all its referenced
capabilities, skills, and agent IDs; another enabled bundle cannot restore a denial.
Existing custom skill instructions and other project settings remain intact.

Platform administrators can edit the specialist-template and plugin catalog as JSON
in the UI. Capability manifests and baseline skill creation remain deployment-owned
YAML/Markdown; their project instructions and selections use the existing Skills and
Project Settings editors. Catalog templates can be submitted for peer approval from
the library. They are not automatically active agents.

Writes check the loaded platform revision; project writes also check the project
revision. Database-configured deployments persist the catalog and project selection
in versioned bundles. Each run snapshots the harness revision and project selection.
Sources: [library UI](../frontend/src/pages/HarnessLibrary.tsx),
[API](../app/api/routes/harness.py), [catalog](../app/configuration/harness.py), and
[run snapshot](../app/runtime/runner.py).

## Verification

`make lint`, `make test` (165 passed, one skipped), `make smoke` (eight passed),
frontend build/lint, and the existing frontend API/configuration contract scripts
passed. [Inheritance tests](../tests/harness/test_platform_library.py) cover independent
project resolution and exclusions; [database restart tests](../tests/integration/test_harness_persistence.py)
verify both catalog edits and project exclusions survive restart without activating
unapproved templates. The browser displayed all four catalog categories and saved a
plugin exclusion in an isolated local demo; an API read confirmed its capabilities
were excluded. Live model/provider quality was not evaluated.
