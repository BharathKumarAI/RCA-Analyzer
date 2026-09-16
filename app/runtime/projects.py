"""Bounded per-project runtime contexts; requests never mutate shared scope."""

import asyncio
from contextlib import AsyncExitStack
from dataclasses import dataclass
import time
from types import SimpleNamespace

from fastapi import HTTPException
from starlette.datastructures import State


@dataclass
class RuntimeEntry:
    app: object
    cleanup: AsyncExitStack
    references: int = 0
    last_used: float = 0


class ProjectRuntimeManager:
    def __init__(self, app, model_factory=None, maximum=16):
        self.app, self.model_factory, self.maximum = app, model_factory, maximum
        self.entries = {}
        self.lock = asyncio.Lock()

    async def bind(self, request, principal):
        if not principal.project_id or principal.project_id == self.app.state.settings.project_id:
            return
        async with self.lock:
            entry = self.entries.get(principal.project_id)
            if entry is None:
                if len(self.entries) >= self.maximum:
                    idle = [(key, value) for key, value in self.entries.items()
                            if value.references == 0 and not value.app.state.runner.tasks]
                    if not idle:
                        raise HTTPException(429, "All project workspaces are busy. Try again shortly.", headers={"Retry-After": "5"})
                    key, old = min(idle, key=lambda item: item[1].last_used)
                    del self.entries[key]
                    await old.cleanup.aclose()
                from app.runtime.bootstrap import application_lifespan
                settings = self.app.state.deployment_settings.model_copy(update={
                    "project_id": principal.project_id, "principals": {}, "database_configuration": True,
                    "config_blob_uri": None, "optimization_blob_uri": None})
                child = SimpleNamespace(state=State())
                stack = AsyncExitStack()
                try:
                    await stack.enter_async_context(application_lifespan(settings, connectors={},
                        model_factory=self.model_factory, managed_projects=False)(child))
                except BaseException:
                    await stack.aclose()
                    raise
                child.state.projects = self.app.state.projects
                child.state.project_runtimes = self
                # Identity-provider approval and browser cookies remain bound to
                # the deployment's original trusted issuer/configuration context.
                child.state.oidc = self.app.state.oidc
                entry = self.entries[principal.project_id] = RuntimeEntry(child, stack)
            entry.references += 1
            entry.last_used = time.monotonic()
            request.scope["rca_project_lease"] = (self, entry)
            request.scope["app"] = entry.app

    async def release(self, entry):
        async with self.lock:
            entry.references -= 1
            entry.last_used = time.monotonic()

    async def aclose(self):
        for entry in self.entries.values():
            await entry.cleanup.aclose()
        self.entries.clear()


class ProjectLeaseMiddleware:
    """Hold runtime resources until the complete HTTP/SSE response finishes."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        try:
            await self.app(scope, receive, send)
        finally:
            lease = scope.pop("rca_project_lease", None)
            if lease:
                await lease[0].release(lease[1])
