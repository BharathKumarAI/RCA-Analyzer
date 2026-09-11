"""HTTP boundary; runtime bootstrap owns infrastructure composition."""

import asyncio

from pathlib import Path

from app.persistence.lineage import ingestion_context
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.identity.auth import authenticated_principal
from app.identity.principals import Role

from app.runtime.bootstrap import application_lifespan
from app.api.routes import catalog, files, runs, agents, optimization, chats, parameters


def create_app(settings=None, *, connectors=None, model_factory=None):
    lifespan = application_lifespan(
        settings, connectors=connectors, model_factory=model_factory
    )
    api = FastAPI(title="RCA Analyzer", version="0.2.0", lifespan=lifespan)

    @api.middleware("http")
    async def authenticate_and_limit(request, call_next):
        # Run before multipart parsing: unauthenticated clients cannot consume the
        # parser pool or spool uploads to disk.
        if request.url.path.startswith("/api/"):
            try:
                request.state.principal = await authenticated_principal(request)
                if request.url.path != "/api/v1/me" and set(
                    request.state.principal.roles
                ) <= {Role.GENERIC_VIEWER}:
                    raise HTTPException(403, "Project membership role required")
            except HTTPException as exc:
                return JSONResponse(
                    {"detail": exc.detail},
                    status_code=exc.status_code,
                    headers=exc.headers,
                )
        is_upload = request.url.path == "/api/v1/files" and request.method == "POST"
        if is_upload:
            project = request.app.state.registry.inheritance.project(
                request.state.principal
            )
            if project and not project.workflow.attachments:
                return JSONResponse(
                    {"detail": "Attachments are disabled by project policy"},
                    status_code=403,
                )
        limiter = request.app.state.upload_limiter
        if is_upload and limiter.locked():
            return JSONResponse(
                {"detail": "Upload capacity reached"},
                status_code=429,
                headers={"Retry-After": "5"},
            )
        if is_upload:
            await limiter.acquire()
        try:
            if request.method in {"POST", "PUT", "PATCH"}:
                maximum = (
                    request.app.state.settings.max_upload_batch_bytes + 65536
                    if is_upload
                    else request.app.state.settings.max_json_body_bytes
                )
                pieces, size = [], 0
                try:
                    async with asyncio.timeout(
                        min(request.app.state.settings.run_timeout_seconds, 60)
                    ):
                        async for chunk in request.stream():
                            size += len(chunk)
                            if size > maximum:
                                return JSONResponse(
                                    {"detail": "Request body exceeds configured limit"},
                                    status_code=413,
                                )
                            pieces.append(chunk)
                except TimeoutError:
                    return JSONResponse(
                        {"detail": "Request body upload timed out"}, status_code=408
                    )
                request._body = b"".join(pieces)
            principal = getattr(request.state, "principal", None)
            with ingestion_context(
                "api", actor=principal.subject if principal else "service:api"
            ):
                response = await call_next(request)
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Cache-Control"] = "no-store"
            if request.url.path.startswith("/admin") or request.url.path == "/":
                response.headers["Content-Security-Policy"] = (
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
                )
                response.headers["X-Frame-Options"] = "DENY"
            return response
        finally:
            if is_upload:
                limiter.release()

    @api.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            {
                "detail": [
                    {"loc": e["loc"], "type": e["type"], "msg": e["msg"]}
                    for e in exc.errors()
                ]
            },
            status_code=422,
        )

    for module in (catalog, files, runs, agents, optimization, chats, parameters):
        api.include_router(module.router)

    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    web_dir = Path(__file__).resolve().parents[2] / "web"
    admin_dir = frontend_dist if frontend_dist.is_dir() else web_dir
    if admin_dir.is_dir():
        api.mount("/admin", StaticFiles(directory=str(admin_dir), html=True), name="admin")

        @api.get("/", include_in_schema=False)
        async def root_redirect():
            return RedirectResponse(url="/admin/")

    return api
