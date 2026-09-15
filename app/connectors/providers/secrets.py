"""Resolve deployment secret references only within the provider boundary."""

import os
import re
import json
from urllib.parse import urlsplit


def connection_secret_references(configuration: str, endpoint: str, fallback: set[str]) -> set[str]:
    """Add only the deployment credential references approved for this host."""
    registry = json.loads(configuration or "{}")
    if not isinstance(registry, dict):
        raise ValueError("Integration credential registry must map hosts to references")
    host = urlsplit(endpoint).hostname or endpoint
    references = registry.get(host.lower(), [])
    if not isinstance(references, list) or any(
        not isinstance(value, str) or not re.fullmatch(r"env://[A-Z][A-Z0-9_]{0,127}", value)
        for value in references
    ):
        raise ValueError("Invalid deployment credential reference registry")
    return fallback | set(references)


def environment_secret(reference: str) -> str:
    if not re.fullmatch(r"env://[A-Z][A-Z0-9_]{0,127}", reference):
        raise ValueError("Only env:// secret references are supported")
    value = os.environ.get(reference.removeprefix("env://"))
    if not value:
        raise ValueError("Referenced deployment secret is not configured")
    return value
