"""Stable ASGI entrypoint for local commands and deployed services."""

from app.api.application import create_app

__all__ = ["app", "create_app"]

app = create_app()
