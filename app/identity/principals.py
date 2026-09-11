"""Principal, role, and identity definitions."""

from enum import Enum
from typing import Tuple
from pydantic import BaseModel, ConfigDict, Field


class Role(str, Enum):
    """Enterprise platform roles."""

    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    TENANT_ADMIN = "TENANT_ADMIN"
    PROJECT_OWNER = "PROJECT_OWNER"
    PROJECT_MANAGER = "PROJECT_MANAGER"
    PROJECT_ANALYST = "PROJECT_ANALYST"
    OPERATOR = "OPERATOR"
    AUDITOR = "AUDITOR"
    SKILL_AUTHOR = "SKILL_AUTHOR"
    PROJECT_VIEWER = "PROJECT_VIEWER"
    GENERIC_VIEWER = "GENERIC_VIEWER"


class UserPrincipal(BaseModel):
    """Authenticated human or service principal."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    subject: str
    username: str
    tenant_id: str
    project_id: str
    roles: Tuple[Role, ...]
    groups: Tuple[str, ...] = Field(default_factory=tuple)
    authn_method: str = "workforce_identity"

    def has_role(self, role: Role) -> bool:
        return role in self.roles or Role.PLATFORM_ADMIN in self.roles
