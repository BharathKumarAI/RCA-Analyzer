"""Local-only tools for personal experimentation; no project or connector access."""

import json

from google.adk.tools import FunctionTool


def text_metrics(text: str) -> dict:
    """Measure user-supplied text; never read files, URLs, or project resources."""
    if len(text) > 16000:
        raise ValueError("Text exceeds input limit")
    return {"characters": len(text), "words": len(text.split()), "lines": len(text.splitlines())}


def _reject_constant(value):
    raise ValueError("Non-finite JSON number")


def inspect_json(text: str) -> dict:
    """Validate a supplied JSON document and report its top-level structure."""
    if len(text) > 16000:
        raise ValueError("JSON exceeds input limit")
    try:
        value = json.loads(text, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return {"valid": False, "detail": "Input is not a valid bounded JSON document"}
    return {
        "valid": True,
        "type": type(value).__name__,
        "items": len(value) if isinstance(value, (dict, list)) else None,
    }


TOOLS = {"generic.text_metrics": FunctionTool(text_metrics), "generic.inspect_json": FunctionTool(inspect_json)}
