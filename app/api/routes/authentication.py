"""Browser sign-in and independently reviewed identity-provider configuration."""

import hmac
import time
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from app.api.dependencies import Principal, require_roles
from app.api.schemas import ReviewRequest
from app.configuration.oidc import (
    CSRF_COOKIE, LOGIN_COOKIE, SESSION_COOKIE, OidcCapacity, OidcConfiguration, OidcConflict, token_hash,
)
from app.identity.auth import principal_for_subject
from app.identity.principals import Role

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
PUBLIC_AUTH_PATHS = frozenset({"/api/v1/auth/providers", "/api/v1/auth/login", "/api/v1/auth/callback"})


async def operation(promise):
    try:
        return await promise
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except OidcConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except OidcCapacity as exc:
        raise HTTPException(429, str(exc), headers={"Retry-After": "30"}) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/providers")
async def providers(request: Request):
    record = await request.app.state.oidc.active()
    return {"configured": record is not None, "name": record.definition.display_name if record else None,
            "login_path": "/api/v1/auth/login" if record else None}


@router.get("/login")
async def login(request: Request):
    target, browser = await operation(request.app.state.oidc.begin_login())
    response = RedirectResponse(target, status_code=303)
    response.set_cookie(LOGIN_COOKIE, browser, max_age=300, secure=True, httponly=True, samesite="lax", path="/")
    return response


@router.get("/callback")
async def callback(request: Request):
    state, code, error = (request.query_params.get(name, "") for name in ("state", "code", "error"))
    # Authorization codes must not enter access logs after the response is sent.
    request.scope["query_string"] = b""
    service = request.app.state.oidc
    response = RedirectResponse("/workspace", status_code=303)
    try:
        if error:
            raise ValueError("The identity provider did not complete sign-in")
        record, claims = await service.consume_login(state, request.cookies.get(LOGIN_COOKIE), code)
        principal = await principal_for_subject(request, claims["sub"])
        await service.logout(request.cookies.get(SESSION_COOKIE))
        session, csrf, expires = await service.create_session(record, principal, claims)
        lifetime = max(1, int(expires - time.time()))
        response.set_cookie(SESSION_COOKIE, session, max_age=lifetime, secure=True, httponly=True, samesite="lax", path="/")
        response.set_cookie(CSRF_COOKIE, csrf, max_age=lifetime, secure=True, httponly=False, samesite="lax", path="/")
    except (ValueError, HTTPException):
        response = RedirectResponse("/workspace?" + urlencode({
            "sign_in_error": "Sign-in could not be verified. Start again or ask your administrator to check your project access."
        }), status_code=303)
    response.delete_cookie(LOGIN_COOKIE, secure=True, httponly=True, samesite="lax", path="/")
    return response


@router.get("/session")
async def session(request: Request, principal: Principal):
    current = getattr(request.state, "browser_session", None)
    csrf = request.cookies.get(CSRF_COOKIE, "")
    if current and (not csrf or not hmac.compare_digest(token_hash(csrf), current.csrf_hash)):
        raise HTTPException(401, "Your browser session could not be verified. Sign in again.")
    return {"principal": principal, "expires_at": current.expires_at if current else None,
            "csrf_token": csrf if current else None, "authentication": "sso" if current else "bearer"}


@router.post("/logout", status_code=204)
async def logout(request: Request, principal: Principal):
    await request.app.state.oidc.logout(request.cookies.get(SESSION_COOKIE))
    response = Response(status_code=204)
    for cookie in (SESSION_COOKIE, CSRF_COOKIE, LOGIN_COOKIE):
        response.delete_cookie(cookie, path="/", secure=True, httponly=cookie != CSRF_COOKIE, samesite="lax")
    return response


@router.get("/configurations")
async def configurations(request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    return await request.app.state.oidc.catalog()


@router.post("/configurations", status_code=201)
async def submit_configuration(body: OidcConfiguration, request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    return await operation(request.app.state.oidc.submit(principal, body))


@router.post("/configurations/{draft_id}/{action}")
async def review_configuration(draft_id: str, action: Literal["approve", "reject", "revoke"],
                               body: ReviewRequest, request: Request, principal: Principal):
    require_roles(principal, {Role.PLATFORM_ADMIN})
    if not body.reason.strip():
        raise HTTPException(422, "A review reason is required")
    return await operation(request.app.state.oidc.review(principal, draft_id, action, body.expected_hash, body.reason.strip()))
