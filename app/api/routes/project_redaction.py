"""Project visibility into the redaction policy actually applied by the runtime."""

import hashlib
import json

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import Principal
from app.policy.redaction import PATTERNS, SECRET_KEY, redact

router = APIRouter(prefix="/api/v1/project/redaction", tags=["project-policy"])


def policy_id() -> str:
    contract = [(SECRET_KEY.pattern, SECRET_KEY.flags)] + [
        (pattern.pattern, pattern.flags, replacement)
        for pattern, replacement in PATTERNS
    ]
    return hashlib.sha256(json.dumps(contract).encode()).hexdigest()


@router.get("")
async def project_redaction(request: Request, principal: Principal):
    custom = await request.app.state.platform_admin.get_policy(
        principal.tenant_id, principal.project_id
    )
    return {
        "project_id": principal.project_id,
        "policy_id": policy_id(),
        "enabled": True,
        "editable": False,
        "source": "app/policy/redaction.py",
        "rules": [
            {"id": "secret-keys", "label": "Sensitive object fields", "description": "Masks values under credential-related keys, including passwords, tokens, authorization and cookies.", "enabled": True},
            {"id": "bearer", "label": "Bearer credentials", "description": "Masks recognized Bearer tokens in text.", "enabled": True},
            {"id": "assignments", "label": "Credential assignments", "description": "Masks recognized password, secret, token and API-key assignments.", "enabled": True},
            {"id": "email", "label": "Email addresses", "description": "Replaces recognized email addresses with [EMAIL].", "enabled": True},
            {"id": "ssn", "label": "US Social Security number pattern", "description": "Masks numbers matching the three-two-four digit pattern.", "enabled": True},
            {"id": "url-credentials", "label": "Credentials in web URLs", "description": "Masks recognized username/password pairs embedded in HTTP URLs.", "enabled": True},
        ],
        "configured_custom_rule_count": len(custom.get("redaction_patterns", [])),
        "custom_rules_enforced": False,
        "limitations": [
            "Deterministic pattern masking is not a comprehensive personal-data classifier.",
            "Stored custom redaction rules are configuration metadata and are not executed by the current runtime.",
            "Raw uploaded files can be retained under the artifact policy; masking extracted text does not rewrite original files.",
            "Project settings cannot disable the built-in masking rules.",
        ],
    }


class RedactionPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=32000)


@router.post("/preview")
async def preview_redaction(body: RedactionPreview, principal: Principal):
    # Deliberately not persisted: a user may paste sensitive material to inspect it.
    masked = redact(body.text, max_text=32000)
    return {
        "policy_id": policy_id(),
        "redacted_text": masked[:16000],
        "changed": masked != body.text,
        "truncated": len(masked) > 16000,
    }
