"""Resolve deployment secret references only within the provider boundary."""

import os
import re


def environment_secret(reference: str) -> str:
    if not re.fullmatch(r"env://[A-Z][A-Z0-9_]{0,127}", reference):
        raise ValueError("Only env:// secret references are supported")
    value = os.environ.get(reference.removeprefix("env://"))
    if not value:
        raise ValueError("Referenced deployment secret is not configured")
    return value
