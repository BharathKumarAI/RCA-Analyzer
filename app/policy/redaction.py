"""Bounded output and deterministic masking; not a general PII classifier."""

import re
from typing import Any

SECRET_KEY = re.compile(
    r"password|passwd|secret|token|authorization|api[_-]?key|cookie", re.I
)
PATTERNS = (
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*"), "Bearer [REDACTED]"),
    (
        re.compile(
            r"""(?i)(\b(?:password|passwd|secret|token|api[_-]?key)\b[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)"""
        ),
        r"\1[REDACTED]",
    ),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[EMAIL]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"(?i)(https?://)[^\s/@:]+:[^\s/@]+@"), r"\1[REDACTED]@"),
)


def redact(value: Any, *, max_text: int = 16000, depth: int = 0) -> Any:
    if depth > 12:
        return "[TRUNCATED]"
    if isinstance(value, str):
        for pattern, replacement in PATTERNS:
            value = pattern.sub(replacement, value)
        return value[:max_text]
    if isinstance(value, dict):
        return {
            str(k): "[REDACTED]"
            if SECRET_KEY.search(str(k))
            else redact(v, max_text=max_text, depth=depth + 1)
            for k, v in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple)):
        return [redact(v, max_text=max_text, depth=depth + 1) for v in value[:100]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact(str(value), max_text=max_text, depth=depth + 1)


def exceeds_bounds(value: Any, *, max_text: int, depth: int = 0) -> bool:
    """Report whether the redactor's bounds can discard source information."""
    if depth > 12:
        return True
    if isinstance(value, str):
        return len(value) > max_text
    if isinstance(value, dict):
        return len(value) > 100 or any(
            exceeds_bounds(v, max_text=max_text, depth=depth + 1)
            for v in value.values()
        )
    if isinstance(value, (list, tuple)):
        return len(value) > 100 or any(
            exceeds_bounds(v, max_text=max_text, depth=depth + 1) for v in value
        )
    return False
