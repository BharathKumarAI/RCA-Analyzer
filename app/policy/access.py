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
    if path == "/api/v1/projects/management" or (path.startswith("/api/v1/projects/") and path.endswith(("/lifecycle", "/select"))):
        return  # Target project membership and lifecycle rights are checked in the project store.
    if path in {"/api/v1/me", "/api/v1/access", "/api/v1/auth/session", "/api/v1/auth/logout", "/api/v1/projects"} or path.startswith(("/api/v1/playground/", "/api/v1/project-access-requests")):
        return
    if not project_access(principal):
        raise HTTPException(403, "Project membership role required")
    if method == "POST" and path in {"/api/v1/knowledge/upload", "/api/v1/knowledge/upload/batch", "/api/v1/knowledge/okf/preview", "/api/v1/knowledge/okf/import"} and not roles & PROJECT_ADMIN_ROLES:
        raise HTTPException(403, "Project owner or platform administrator access is required")
    if method == "POST" and path == "/api/v1/knowledge/okf/export":
        return  # Export rechecks eligible exact revisions; draft export requires administration.
    if roles & (PROJECT_ADMIN_ROLES | {Role.PROJECT_ANALYST}):
        return  # Existing endpoint checks still enforce operation-specific rights.
    if method in {"GET", "HEAD", "OPTIONS"}:
        return
    if method == "POST" and path in {"/api/v1/runs", "/api/v1/files", "/api/v1/chats", "/api/v1/chat/resolve"}:
        return  # Persisting a bounded analysis and its inputs is permitted.
    if method == "POST" and path.startswith("/api/v1/projects/") and path.endswith("/select"):
        return  # Selection separately verifies active membership; it cannot grant roles.
    raise HTTPException(403, "This project role can analyze and view, but cannot modify project data or settings")
