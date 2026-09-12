"""Role-Based Access Control mapping."""

from typing import Dict
from app.identity.principals import Role

ROLE_HIERARCHY: Dict[Role, int] = {
    Role.PLATFORM_ADMIN: 100,
    Role.PROJECT_OWNER: 80,
    Role.PROJECT_MANAGER: 60,
    Role.PROJECT_ANALYST: 40,
    Role.PROJECT_VIEWER: 20,
    Role.GENERIC_USER: 10,
}


def meets_minimum_role(user_roles: list[Role], minimum_role: Role) -> bool:
    """Check if any of the user's roles meet or exceed the required minimum tier."""
    req_level = ROLE_HIERARCHY.get(minimum_role)
    if req_level is None:
        return False
    for r in user_roles:
        if ROLE_HIERARCHY.get(r) is not None and ROLE_HIERARCHY[r] >= req_level:
            return True
    return False


def has_explicit_role(user_roles: list[Role], allowed_roles: tuple[Role, ...]) -> bool:
    return bool(set(user_roles).intersection(allowed_roles))
