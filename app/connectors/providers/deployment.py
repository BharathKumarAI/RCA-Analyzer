"""Server-side resolution of deployment credential references."""
import os
import re

_ENV_REF = re.compile(r"^env://([A-Z][A-Z0-9_]*)$")

def resolve_env_reference(reference: str) -> str:
    match = _ENV_REF.fullmatch(reference)
    if not match:
        raise ValueError("Credential fields must use an env://NAME reference")
    value = os.environ.get(match.group(1))
    if not value:
        raise ValueError(f"Configured deployment credential reference {match.group(1)} is unavailable")
    return value
