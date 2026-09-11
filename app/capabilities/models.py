"""Domain models for declarative Capabilities."""

from typing import Tuple, Literal
from pydantic import BaseModel, ConfigDict, Field
from app.identity.principals import Role


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SafetyProfile(StrictModel):
    tool_mutations: Literal["forbidden", "approval_required", "allowed"] = (
        "approval_required"
    )
    pii_access: Literal["none", "redacted", "project_scoped", "full"] = "project_scoped"
    raw_payload_access: Literal["restricted", "offload_to_artifacts", "direct"] = (
        "restricted"
    )
    external_network: Literal["connector_allowlist"] = "connector_allowlist"


class CapabilityRequirements(StrictModel):
    connectors: Tuple[str, ...] = Field(default_factory=tuple)


class CapabilityPermissions(StrictModel):
    minimum_role: Role = Role.PROJECT_ANALYST
    allowed_roles: Tuple[Role, ...] = Field(default_factory=tuple)
    allowed_actions: Tuple[str, ...] = Field(default_factory=tuple)


class CapabilityDefinition(StrictModel):
    """Declarative capability contract governing agent behavior."""

    id: str
    enabled: bool = True
    version: str
    name: str
    description: str
    category: str
    skills: Tuple[str, ...] = Field(default_factory=tuple)
    requires: CapabilityRequirements = Field(default_factory=CapabilityRequirements)
    optional: CapabilityRequirements = Field(default_factory=CapabilityRequirements)
    permissions: CapabilityPermissions = Field(default_factory=CapabilityPermissions)
    safety_profile: SafetyProfile = Field(default_factory=SafetyProfile)
    model_profile: str = "balanced-investigation"

    @property
    def minimum_role(self) -> Role:
        return self.permissions.minimum_role

    @property
    def allowed_roles(self) -> Tuple[Role, ...]:
        return self.permissions.allowed_roles

    @property
    def allowed_actions(self) -> Tuple[str, ...]:
        return self.permissions.allowed_actions
