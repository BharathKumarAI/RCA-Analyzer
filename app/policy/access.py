"""Server-owned project access; execution is distinct from configuration writes."""

from fastapi import HTTPException

from app.identity.principals import Role

PROJECT_READ_ROLES = frozenset(Role) - {Role.GENERIC_USER}
PROJECT_ADMIN_ROLES = frozenset({Role.PLATFORM_ADMIN, Role.PROJECT_OWNER})
PROJECT_TRIAGE_ROLES = PROJECT_READ_ROLES
READ_ONLY_PROJECT_ROLES = frozenset({Role.PROJECT_MANAGER, Role.PROJECT_VIEWER})


def project_access(principal):
    return bool(set(principal.roles) & PROJECT_READ_ROLES)


def enforce_api_access(principal, method: str, path: str):
    """Deny before parsing uploads or invoking any project handler.

    Mixed roles are additive: an owner/viewer can administer. An analyst/viewer
    retains analyst operations. Generic membership never subtracts project access.
    """
    roles = set(principal.roles)
    if not roles:
        raise HTTPException(403, "An active platform role is required")
    if path in {"/api/v1/me", "/api/v1/access"} or path.startswith("/api/v1/playground/"):
        return
    if not project_access(principal):
        raise HTTPException(403, "Project membership role required")
    if roles & (PROJECT_ADMIN_ROLES | {Role.PROJECT_ANALYST}):
        return  # Existing endpoint checks still enforce operation-specific rights.
    if method in {"GET", "HEAD", "OPTIONS"}:
        return
    if method == "POST" and path in {"/api/v1/runs", "/api/v1/files", "/api/v1/chats"}:
        return  # Persisting a bounded analysis and its inputs is permitted.
    raise HTTPException(403, "This project role can analyze and view, but cannot modify project data or settings")
