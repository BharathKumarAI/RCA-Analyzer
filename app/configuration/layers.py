"""Resolve trusted, scoped configuration without allowing permission escalation."""

from pathlib import Path


from app.configuration.yaml_data import load_yaml_data
from app.connectors.providers.project_storage import project_prefix, scope_key
from app.configuration.models import (
    PlatformRules,
    SkillRule,
    ProjectLayer,
    UserLayer,
    CapabilityOverride,
    ExecutionLimits,
    WorkflowOptions,
    PresentationPreferences,
)


class ConfigurationLayers:
    """Load once, then resolve only by authenticated tenant/project/subject."""

    def __init__(self, root: Path, skill_names, capabilities, projects_root: Path):
        legacy = root.with_name("skill_layers")
        if legacy.exists() or legacy.is_symlink():
            raise ValueError("Migrate skill_layers to layers before startup")
        self.files = {}
        self.project_files = {}

        def read(path, model, external=False):
            if (
                path.is_symlink()
                or not path.is_file()
                or path.resolve() != path.absolute()
            ):
                raise ValueError("Configuration layers must be regular local files")
            if path.stat().st_size > 65536:
                raise ValueError("Configuration layer exceeds 64 KiB")
            text = path.read_text(encoding="utf-8")
            if external:
                self.project_files[str(path.relative_to(projects_root))] = text
            else:
                self.files[str(path.relative_to(root))] = text
            return model.model_validate(load_yaml_data(text))

        if root.is_symlink():
            raise ValueError("Configuration layer directory cannot be a symlink")
        path = root / "platform.yaml"
        self.policy = read(path, PlatformRules) if path.exists() else PlatformRules()
        self.rules = self.policy.skills
        if set(self.rules) - set(skill_names):
            raise ValueError("Platform policy references an unknown skill")
        self.projects, self.users = {}, {}
        for tier, model, target in (
            ("projects", ProjectLayer, self.projects),
            ("users", UserLayer, self.users),
        ):
            directory = root / tier
            if directory.is_symlink():
                raise ValueError("Configuration layer directory cannot be a symlink")
            external_pattern = (
                "*/*/configuration/project.yaml"
                if tier == "projects"
                else "*/*/configuration/users/*.yaml"
            )
            paths = [(path, False) for path in directory.glob("*.yaml")]
            paths += [(path, True) for path in projects_root.glob(external_pattern)]
            for path, external in sorted(paths):
                layer = read(path, model, external)
                if external:
                    relative = path.relative_to(projects_root)
                    if "/".join(relative.parts[:2]) != project_prefix(
                        layer.tenant_id, layer.project_id
                    ):
                        raise ValueError(
                            "Project configuration scope does not match its directory"
                        )
                    if tier == "users" and path.stem != scope_key(layer.subject):
                        raise ValueError(
                            "User configuration subject does not match its filename"
                        )
                key = (layer.tenant_id, layer.project_id)
                if tier == "users":
                    key += (layer.subject,)
                if key in target:
                    raise ValueError(f"Duplicate {tier} skill scope")
                for name, override in layer.skills.items():
                    rule = self.rules.get(name, SkillRule())
                    permitted = (
                        rule.project_override
                        if tier == "projects"
                        else rule.user_override
                    )
                    if rule.immutable or not permitted:
                        raise ValueError(f"{tier} cannot override skill {name}")
                    if override.actions is not None and not set(
                        override.actions
                    ) <= set(rule.actions):
                        raise ValueError("Skill override cannot grant new actions")
                if tier == "projects":
                    sections = layer.model_fields_set - {
                        "tenant_id",
                        "project_id",
                        "allow_user_overrides",
                        "allow_user_preferences",
                    }
                    # Existing skill-only bundles retain their explicit skill grants.
                    allowed = set(self.policy.project_sections) | {"skills"}
                    if sections - allowed:
                        raise ValueError(
                            "Project section is not delegated by platform policy"
                        )
                    if not set(layer.allow_user_preferences) <= set(
                        self.policy.user_preferences
                    ):
                        raise ValueError(
                            "Project cannot grant user preference permission"
                        )
                    for capability_id, override in layer.capabilities.items():
                        cap = capabilities.get(capability_id)
                        if cap is None:
                            raise ValueError("Project references an unknown capability")
                        if override.allowed_actions is not None and not set(
                            override.allowed_actions
                        ) <= set(cap.allowed_actions):
                            raise ValueError(
                                "Project cannot grant new capability actions"
                            )
                        if (
                            override.allowed_roles is not None
                            and cap.allowed_roles
                            and not set(override.allowed_roles)
                            <= set(cap.allowed_roles)
                        ):
                            raise ValueError(
                                "Project cannot grant new capability roles"
                            )
                        if (
                            override.model_profile is not None
                            and override.model_profile not in self.policy.model_profiles
                        ):
                            raise ValueError("Project model profile is not delegated")
                    for name in layer.allow_user_overrides:
                        rule = self.rules.get(name, SkillRule())
                        if rule.immutable or not rule.user_override:
                            raise ValueError(
                                "Project cannot grant user override permission"
                            )
                target[key] = layer
        for key, user in self.users.items():
            project = self.projects.get(key[:2])
            if not project or not set(user.skills) <= set(project.allow_user_overrides):
                raise ValueError("User overrides require explicit project permission")
            if not user.preferences.model_fields_set <= set(
                project.allow_user_preferences
            ):
                raise ValueError("User preferences require explicit project permission")

    def project(self, principal):
        return self.projects.get((principal.tenant_id, principal.project_id))

    def resolve_capability(self, capability, principal):
        project = self.project(principal)
        if project is None:
            return capability
        override = project.capabilities.get(capability.id, CapabilityOverride())
        actions = tuple(
            action
            for action in capability.allowed_actions
            if action.split(".", 1)[0] not in project.disabled_connectors
            and (override.allowed_actions is None or action in override.allowed_actions)
        )
        roles = (
            capability.allowed_roles
            if override.allowed_roles is None
            else override.allowed_roles
        )
        # An empty explicit role list denies access; the base empty list means no extra role constraint.
        enabled = (
            capability.enabled and override.enabled and override.allowed_roles != ()
        )
        if set(capability.requires.connectors) & set(project.disabled_connectors):
            enabled = False
        return capability.model_copy(
            update={
                "enabled": enabled,
                "model_profile": override.model_profile or capability.model_profile,
                "permissions": capability.permissions.model_copy(
                    update={
                        "allowed_actions": actions,
                        "allowed_roles": roles,
                    }
                ),
            }
        )

    def runtime(self, principal, settings, prompts):
        project = self.project(principal)
        user = self.users.get(
            (principal.tenant_id, principal.project_id, principal.subject)
        )
        limits = project.limits if project else ExecutionLimits()
        workflow = project.workflow if project else WorkflowOptions()
        workflow = workflow.model_copy(
            update={
                "parallel_evidence": settings.parallel_evidence
                and workflow.parallel_evidence,
            }
        )
        preferences = project.preferences if project else PresentationPreferences()
        if user:
            preferences = preferences.model_copy(
                update=user.preferences.model_dump(exclude_unset=True)
            )
        return {
            "settings": limits.apply(settings),
            "max_tool_calls": limits.max_tool_calls,
            "workflow": workflow,
            "preferences": preferences,
            "prompts": {**prompts, **(project.prompts if project else {})},
            "disabled_connectors": project.disabled_connectors if project else (),
        }

    def resolve(
        self, capability, principal, platform_contents, optimized_contents=None
    ):
        project = self.projects.get((principal.tenant_id, principal.project_id))
        user = self.users.get(
            (principal.tenant_id, principal.project_id, principal.subject)
        )
        contents, sources, actions = {}, {}, set()
        for name in dict.fromkeys(capability.skills):
            rule = self.rules.get(name)
            text = platform_contents[name]
            permitted = set(rule.actions if rule else capability.allowed_actions)
            enabled, source = True, "platform"
            if (
                optimized_contents is not None
                and rule is not None
                and not rule.immutable
                and rule.project_override
                and optimized_contents[name] != text
            ):
                text, source = optimized_contents[name], "project_optimization"
            for tier, layer in (("project", project), ("user", user)):
                if layer is None or name not in layer.skills:
                    continue
                override = layer.skills[name]
                # Denials accumulate: a user cannot re-enable a project-disabled skill.
                enabled = enabled and override.enabled
                if override.actions is not None:
                    permitted.intersection_update(override.actions)
                if override.instruction is not None:
                    text = override.instruction
                source = tier
            sources[name] = {
                "tier": source,
                "enabled": enabled,
                "actions": sorted(permitted & set(capability.allowed_actions))
                if enabled
                else [],
            }
            if enabled:
                contents[name] = text
                actions.update(permitted)
        effective = capability.model_copy(
            update={
                "skills": tuple(contents),
                "permissions": capability.permissions.model_copy(
                    update={
                        "allowed_actions": tuple(
                            action
                            for action in dict.fromkeys(capability.allowed_actions)
                            if action in actions
                        ),
                    }
                ),
            }
        )
        return effective, contents, sources
