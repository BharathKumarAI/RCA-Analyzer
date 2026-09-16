"""Offline model and HTTP fixtures; no real credentials or services."""

import json
import re
import time
from pathlib import Path

import httpx2
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector
from app.identity.principals import UserPrincipal, Role
from app.settings import Settings


class FixtureModel(BaseLlm):
    stage: str
    calls: int = 0
    invalid_citation: bool = False

    async def generate_content_async(self, llm_request, stream=False):
        self.calls += 1
        if self.stage == "orchestrator":
            part = types.Part.from_text(
                text=json.dumps(
                    {
                        "request_types": ["root_cause_analysis"],
                        "goals": ["Inspect evidence"],
                        "presentation": "summary",
                    }
                )
            )
        elif self.stage == "triage" and self.calls == 1:
            part = types.Part.from_function_call(
                name="get_ticket", args={"ticket_id": "SAMSON-101"}
            )
        elif self.stage == "logs" and self.calls == 1:
            part = types.Part.from_function_call(
                name="query_range", args={"query": "ERROR", "time_range": "-15m"}
            )
        elif self.stage == "router" and self.calls == 1:
            name = next(iter(llm_request.tools_dict))
            part = types.Part.from_function_call(
                name=name, args={"request": "Inspect evidence for this incident"}
            )
        elif self.stage == "synthesis":
            instruction = str(llm_request.config.system_instruction)
            ids = list(dict.fromkeys(re.findall(r"ev_[0-9a-f]{32}", instruction)))
            if self.invalid_citation:
                ids = ["ev_" + "0" * 32]
            part = types.Part.from_text(
                text=json.dumps(
                    {
                        "outcome": "FINDINGS" if ids else "INSUFFICIENT_EVIDENCE",
                        "summary": "Offline fixture result; observed errors require investigation.",
                        "findings": [
                            {
                                "summary": "Evidence records contain a timeout.",
                                "evidence_ids": ids,
                            }
                        ]
                        if ids
                        else [],
                        "uncertainties": [
                            "Causality is not established by this fixture."
                        ],
                        "recommended_actions": [
                            "Inspect the service metrics before changing anything."
                        ],
                    }
                )
            )
        else:
            part = types.Part.from_text(
                text="Observed timeout; timestamp 2026-09-11T10:15:00Z. This is an offline fixture."
            )
        yield LlmResponse(content=types.Content(role="model", parts=[part]))


def model_factory(stage, config):
    return FixtureModel(model=config.model, stage=stage)


def candidate_receipt(client, headers, candidate):
    """Exercise the real candidate API with a local evidence fixture."""
    uploaded = client.post("/api/v1/files", headers=headers,
        files={"files": ("candidate.txt", b"2026-09-11T10:15:00Z timeout observed", "text/plain")})
    assert uploaded.status_code == 201, uploaded.text
    evidence = uploaded.json()
    tested = client.post("/api/v1/project/test", headers=headers, json=candidate | {"run": {
        "capability": "attachment_review", "prompt": "Review the recorded timeout evidence",
        "chat_id": evidence["chat_id"], "attachment_ids": [item["attachment_id"] for item in evidence["attachments"]],
    }})
    assert tested.status_code == 200 and tested.json()["receipt"]["passed"], tested.text
    return tested.json()["run"]["run_id"]


def settings_for(directory, mode="demo"):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = (
        private_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode()
    )

    def member(subject, role):
        return UserPrincipal(
            subject=subject,
            username=subject,
            tenant_id="acme",
            project_id="payments",
            roles=[role],
        )

    settings = Settings(
        mode=mode,
        tenant_id="acme",
        project_id="payments",
        auth_issuer="https://identity.example.test",
        auth_audience="rca-tests",
        auth_public_key=public_key,
        principals={
            "analyst": member("analyst", Role.PROJECT_ANALYST),
            "owner": member("owner", Role.PROJECT_OWNER),
            "admin": member("admin", Role.PLATFORM_ADMIN),
            "viewer": member("viewer", Role.PROJECT_VIEWER),
        },
        database_url=f"sqlite+aiosqlite:///{Path(directory) / 'runs.db'}",
        session_database_url=f"sqlite+aiosqlite:///{Path(directory) / 'sessions.db'}",
        projects_root=Path(directory) / "projects",
        config_blob_uri=str(Path(directory) / "blobs"),
        optimization_blob_uri=str(Path(directory) / "optimizations"),
        optimization_tracking_uri="sqlite:///" + str(Path(directory) / "mlflow.db"),
    )

    def token(subject="analyst", **overrides):
        claims = {
            "iss": settings.auth_issuer,
            "aud": settings.auth_audience,
            "sub": subject,
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
        }
        claims.update(overrides)
        return {
            "Authorization": "Bearer "
            + jwt.encode(claims, private_key, algorithm="RS256")
        }

    return settings, token


def connectors():
    def jira(request):
        if "/project/" in request.url.path:
            return httpx2.Response(200, json={"key": "SAMSON"})
        return httpx2.Response(
            200,
            json={
                "key": "SAMSON-101",
                "fields": {
                    "summary": "Timeout",
                    "status": {"name": "Open"},
                    "created": "2026-09-11T10:15:00Z",
                    "description": "timeout password=secret-value reporter=person@example.com",
                    "components": [],
                },
            },
        )

    def splunk(request):
        if "/indexes/" in request.url.path:
            return httpx2.Response(200, json={"entry": [{"name": "payments"}]})
        return httpx2.Response(
            200,
            content=json.dumps(
                {
                    "result": {
                        "_time": "2026-09-11T10:15:00Z",
                        "_raw": "ERROR timeout Bearer SECRET-TOKEN",
                    }
                }
            )
            + "\n",
        )

    return {
        "itsm": JiraConnector(
            base_url="https://jira.example.test",
            project_key="SAMSON",
            user_email="service@example.test",
            api_token="test-only",
            client=httpx2.AsyncClient(
                base_url="https://jira.example.test",
                transport=httpx2.MockTransport(jira),
            ),
        ),
        "log_search": SplunkConnector(
            endpoint="https://splunk.example.test",
            token="test-only",
            index="payments",
            client=httpx2.AsyncClient(
                base_url="https://splunk.example.test",
                transport=httpx2.MockTransport(splunk),
            ),
        ),
    }
