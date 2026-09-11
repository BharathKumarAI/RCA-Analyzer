"""Shared authentication and role checks for API routes."""

from typing import Annotated
from fastapi import Depends, HTTPException
from app.identity.auth import authenticated_principal
from app.identity.principals import UserPrincipal

Principal = Annotated[UserPrincipal, Depends(authenticated_principal)]


def require_roles(principal, roles):
    if not set(principal.roles).intersection(roles):
        raise HTTPException(403, "This role cannot perform the requested operation")
