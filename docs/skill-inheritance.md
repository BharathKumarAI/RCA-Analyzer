# Skill inheritance within the application architecture

Skills use the same [platform/project/user configuration resolver](architecture.md#configuration-ownership-and-inheritance) as capabilities, connector restrictions, budgets, workflow options and presentation preferences. They are one part of the application configuration, not a separate architecture.

At run creation, the resolver selects the exact project by authenticated tenant/project and the exact user layer by authenticated subject. The platform defines the skill and its delegation policy; project and user values are applied only when those fields are delegated. See the [selection sequence and element matrix](harness.md#selection-rules-by-harness-element).

Default instructions remain in [platform skills](../blob_local/platform/skills/). [Platform layer policy](../blob_local/platform/layers/platform.yaml) maps each skill to existing actions and controls whether project/user overrides are permitted. New scoped overrides live under each [project folder](../blob_local/projects/README.md), with legacy `layers/projects/` and `layers/users/` still readable; examples are in the [project](../blob_local/platform/layers/projects/README.md) and [user](../blob_local/platform/layers/users/README.md) folders.

| Decision | Rule |
|---|---|
| Instruction text | Permitted user text replaces explicit project text, which replaces permitted approved optimization text, which replaces platform defaults. |
| Tool actions | Each layer may narrow the skill's action set. Contributions from enabled skills are deduplicated and intersected with the resolved capability permissions. |
| Disabling a skill | `enabled: false` removes its text and tool contribution. A user cannot restore a project-disabled skill. |
| Shared actions | A tool remains available if another enabled skill legitimately contributes the same permitted action. |
| Immutable skill | Lower tiers and project optimization cannot replace its instruction. Native security controls are independently immutable. |
| Missing rule/layer | Inherit defaults; no implicit override grant. |
| Conflicts | Unknown fields, actions or skills, duplicate YAML keys/scopes, aliases and unauthorized overrides fail startup. |

Instructions are bounded data; no script execution, dynamic Python imports, remote resource fetching or credential handling is added. Both native stages and approved `AgentTool` specialists use the same filtered [tool catalog](../app/tools/catalog.py), and [governance](../app/runtime/governance.py) checks calls again. Selected hashes and decisions are persisted in the [run contract](../app/runtime/runner.py).

Implementation: [configuration models](../app/configuration/models.py), [layer resolver](../app/configuration/layers.py), [capability resolver](../app/capabilities/resolver.py), [ADK assembly](../app/agents/root.py). Verification: [inheritance contracts](../tests/unit/test_skill_inheritance.py) and [native execution](../tests/harness/test_skill_inheritance.py).

Existing mounted bundles using `skill_layers/` must rename that directory to `layers/`, update the platform policy for any newly delegated sections, and restart. Startup rejects the old layout instead of silently dropping its restrictions.
