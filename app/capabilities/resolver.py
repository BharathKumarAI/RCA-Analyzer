"""Capability resolver evaluating intent, roles, and connector readiness."""

from typing import List, Optional, Mapping
from pydantic import BaseModel, Field
from app.capabilities.registry import CapabilityRegistry
from app.capabilities.models import CapabilityDefinition
from app.identity.principals import UserPrincipal
from app.policy.rbac import meets_minimum_role, has_explicit_role


def required_connector_error(capability, connector_health):
    for connector in capability.requires.connectors:
        health = connector_health.get(connector)
        status = (
            health.get("overall")
            if isinstance(health, dict)
            else getattr(health, "overall", health)
        )
        if status is None or str(getattr(status, "value", status)).upper() != "HEALTHY":
            return f"Required connector is not healthy: {connector}."
    return None


class ResolvedCapabilityContract(BaseModel):
    capability: CapabilityDefinition
    allowed_skills: List[str]
    required_connectors: List[str]
    optional_connectors: List[str]
    model_profile: str
    is_authorized: bool
    rejection_reason: Optional[str] = None
    content_hash: str = ""
    skill_contents: dict[str, str] = Field(default_factory=dict)
    skill_sources: dict[str, dict] = Field(default_factory=dict)


class CapabilityResolver:
    """Resolves requested capability contracts against principal entitlements."""

    def __init__(
        self,
        registry: CapabilityRegistry,
        connector_health: Optional[Mapping[str, object]] = None,
    ):
        self.registry = registry
        self.connector_health = connector_health or {}

    def resolve(
        self,
        capability_id: str,
        principal: UserPrincipal,
        *,
        check_health: bool = True,
        platform_contents=None,
    ) -> ResolvedCapabilityContract:
        cap = self.registry.get(capability_id)
        if not cap:
            return ResolvedCapabilityContract(
                capability=CapabilityDefinition(
                    id=capability_id,
                    version="0.0.0",
                    name="Unknown",
                    description="",
                    category="error",
                ),
                allowed_skills=[],
                required_connectors=[],
                optional_connectors=[],
                model_profile="default",
                is_authorized=False,
                rejection_reason=f"Capability '{capability_id}' not found in registry.",
                content_hash=self.registry.content_hash,
            )

        def denied(reason: str) -> ResolvedCapabilityContract:
            return ResolvedCapabilityContract(
                capability=cap,
                allowed_skills=[],
                required_connectors=[],
                optional_connectors=[],
                model_profile=cap.model_profile,
                is_authorized=False,
                rejection_reason=reason,
                content_hash=self.registry.content_hash,
            )

        cap = self.registry.inheritance.resolve_capability(cap, principal)
        if not cap.enabled:
            return denied("Capability is disabled.")
        if not principal.tenant_id or not principal.project_id:
            return denied("Principal scope is incomplete.")
        if not meets_minimum_role(
            principal.roles, cap.minimum_role
        ) or not has_explicit_role(principal.roles, cap.allowed_roles):
            return denied(
                f"Principal lacks an allowed role for capability (minimum: {cap.minimum_role.value})."
            )
        if check_health and (
            reason := required_connector_error(cap, self.connector_health)
        ):
            return denied(reason)

        cap, contents, sources = self.registry.inheritance.resolve(
            cap,
            principal,
            self.registry.skill_contents,
            platform_contents,
        )
        return ResolvedCapabilityContract(
            capability=cap,
            allowed_skills=cap.skills,
            skill_contents=contents,
            skill_sources=sources,
            required_connectors=cap.requires.connectors,
            optional_connectors=cap.optional.connectors,
            model_profile=cap.model_profile,
            is_authorized=True,
            content_hash=self.registry.content_hash,
        )
