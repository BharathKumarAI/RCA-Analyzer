"""Offline RS256 verification with trusted issuer/key and server-owned membership."""

import jwt
import re
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from fastapi import HTTPException, Request

from app.identity.principals import UserPrincipal
from app.identity.principals import Role


def validate_public_key(key: str) -> None:
    if not isinstance(load_pem_public_key(key.encode()), RSAPublicKey):
        raise ValueError("RCA_AUTH_PUBLIC_KEY must be an RSA public key")


async def authenticated_principal(request: Request) -> UserPrincipal:
    if getattr(request.state, "principal", None) is not None:
        return request.state.principal
    settings = request.app.state.settings
    if not request.headers.get("Authorization") and request.cookies.get("__Host-rca_session"):
        identity = getattr(request.app.state, "oidc", None)
        verified = await identity.session(request.cookies["__Host-rca_session"]) if identity else None
        if verified is None:
            raise HTTPException(401, "Your sign-in session expired. Sign in again.")
        session, configuration = verified
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            try:
                identity.check_csrf(request, session, configuration)
            except PermissionError as exc:
                raise HTTPException(403, str(exc)) from None
        request.state.browser_session = session
        principal = await principal_for_subject(request, session.subject)
        return await _prepare_principal(request, principal)
    if not settings.auth_configured:
        raise HTTPException(503, "Authentication is not configured")
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 16384:
        raise HTTPException(
            401,
            "A valid bearer token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = jwt.decode(
            token,
            settings.auth_public_key,
            algorithms=["RS256"],
            issuer=settings.auth_issuer,
            audience=settings.auth_audience,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            401,
            "Invalid or expired bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    principal = await principal_for_subject(request, claims["sub"])
    return await _prepare_principal(request, principal)


async def principal_for_subject(request: Request, subject: str) -> UserPrincipal:
    """Membership always comes from the server, including after verified SSO."""
    settings = request.app.state.settings
    projects = getattr(request.app.state, "projects", None)
    if projects is not None:
        selected = request.headers.get("X-RCA-Project")
        if selected is not None and (not selected or len(selected) > 256 or any(ord(char) < 32 for char in selected)):
            raise HTTPException(400, "Invalid project selector")
        try:
            path = request.url.path.rstrip("/")
            allow_management = path in {"/api/v1/me", "/api/v1/auth/session", "/api/v1/auth/logout", "/api/v1/auth/callback",
                                        "/api/v1/projects", "/api/v1/projects/management"} or bool(
                re.fullmatch(r"/api/v1/projects/[^/]+/(?:lifecycle|select)", path))
            return await projects.principal(subject, selected, allow_management=allow_management)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from None
    principal = None
    admin_store = getattr(request.app.state, "platform_admin", None)
    if admin_store is not None:
        stored = await admin_store.get_user(settings.tenant_id, settings.project_id, subject)
        if stored is not None:
            if stored.get("status") != "active":
                raise HTTPException(403, "This identity's project membership is inactive")
            try:
                roles = tuple(Role(role) for role in (stored.get("roles") or []))
            except ValueError:
                raise HTTPException(403, "This identity has invalid project roles") from None
            principal = UserPrincipal(
                subject=subject,
                username=stored.get("email") or subject,
                tenant_id=settings.tenant_id,
                project_id=settings.project_id,
                roles=roles,
            )
    if principal is None:
        principal = settings.principals.get(subject)
    if principal is None:
        raise HTTPException(403, "No project membership for this identity")
    if principal.roles and set(principal.roles) <= {Role.GENERIC_USER}:
        if principal.tenant_id != settings.tenant_id:
            raise HTTPException(403, "Identity is outside this platform tenant")
        return principal.model_copy(update={"project_id": ""})
    if (
        principal.tenant_id != settings.tenant_id
        or principal.project_id != settings.project_id
    ):
        raise HTTPException(
            403, "Identity is outside this deployment's connector scope"
        )
    return principal


async def _prepare_principal(request, principal):
    from app.configuration.skill_catalog import refresh_skill_catalog
    manager = getattr(request.app.state, "project_runtimes", None)
    if manager is not None:
        try:
            await manager.bind(request, principal)
        except (ValueError, OSError):
            raise HTTPException(503, "Project configuration is unavailable. Ask an administrator to check this workspace.") from None
    await refresh_skill_catalog(request)
    request.state.principal = principal
    return principal
