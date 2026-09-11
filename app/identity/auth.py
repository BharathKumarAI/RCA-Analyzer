"""Offline RS256 verification with trusted issuer/key and server-owned membership."""

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from fastapi import HTTPException, Request

from app.identity.principals import UserPrincipal


def validate_public_key(key: str) -> None:
    if not isinstance(load_pem_public_key(key.encode()), RSAPublicKey):
        raise ValueError("RCA_AUTH_PUBLIC_KEY must be an RSA public key")


async def authenticated_principal(request: Request) -> UserPrincipal:
    if getattr(request.state, "principal", None) is not None:
        return request.state.principal
    settings = request.app.state.settings
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
    principal = settings.principals.get(claims["sub"])
    if principal is None:
        raise HTTPException(403, "No project membership for this identity")
    if (
        principal.tenant_id != settings.tenant_id
        or principal.project_id != settings.project_id
    ):
        raise HTTPException(
            403, "Identity is outside this deployment's connector scope"
        )
    return principal
