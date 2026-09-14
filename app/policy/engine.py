"""Unified policy evaluation engine (RBAC + ABAC + Entitlements)."""

from enum import Enum
from pydantic import BaseModel, ConfigDict
from app.policy.abac import AuthorizationContext
from app.identity.principals import Role


class PolicyDecisionType(str, Enum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    REDACT = "REDACT"


class PolicyDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: PolicyDecisionType
    reason: str
    policy_version: str = "2.1.0"
    mutation_dry_run: bool = False


class PolicyEngine:
    """Evaluates multi-attribute authorization decisions for agent tool calls."""

    def evaluate(self, ctx: AuthorizationContext) -> PolicyDecision:
        if not set(ctx.principal.roles) - {Role.GENERIC_USER}:
            return PolicyDecision(decision=PolicyDecisionType.DENY, reason="Project membership role required.")
        if ctx.principal.tenant_id != ctx.tenant_id:
            return PolicyDecision(
                decision=PolicyDecisionType.DENY, reason="Tenant boundary violation."
            )
        if ctx.principal.project_id != ctx.project_id:
            return PolicyDecision(
                decision=PolicyDecisionType.DENY, reason="Project boundary violation."
            )

        allowed_actions = ctx.attributes.get("allowed_actions")
        if (
            not isinstance(allowed_actions, (list, tuple, set))
            or ctx.action not in allowed_actions
        ):
            return PolicyDecision(
                decision=PolicyDecisionType.DENY,
                reason="Action is not explicitly permitted.",
            )

        # Mutations remain disabled until the durable approval path exists.
        if ctx.is_mutation:
            return PolicyDecision(
                decision=PolicyDecisionType.DENY,
                reason="Mutations are disabled in the read-only release.",
            )

        # 3. Restricted data access check
        if (
            ctx.data_classification == "RESTRICTED"
            and Role.PROJECT_OWNER not in ctx.principal.roles
            and Role.PLATFORM_ADMIN not in ctx.principal.roles
        ):
            return PolicyDecision(
                decision=PolicyDecisionType.REDACT,
                reason="Restricted data classification requires output masking.",
            )

        return PolicyDecision(
            decision=PolicyDecisionType.ALLOW, reason="Authorization policy satisfied."
        )
