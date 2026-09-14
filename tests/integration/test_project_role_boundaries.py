"""Exercise real API boundaries and personal persistence with verified identities."""

from fastapi.testclient import TestClient
from google.genai import types
from google.adk.models.llm_response import LlmResponse

from app.fast_api_app import create_app
from app.identity.principals import Role
from tests.support import FixtureModel, connectors, model_factory, settings_for


class ToolExperimentModel(FixtureModel):
    async def generate_content_async(self, llm_request, stream=False):
        self.calls += 1
        if self.calls == 1:
            part = types.Part.from_function_call(name="text_metrics", args={"text": "two words"})
        else:
            responses = [part.function_response.response for content in llm_request.contents for part in content.parts or [] if part.function_response]
            assert any(response.get("words") == 2 for response in responses)
            part = types.Part.from_text(text="The supplied text has two words.")
        yield LlmResponse(content=types.Content(role="model", parts=[part]))


def configured(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    base = settings.principals["viewer"]
    members = dict(settings.principals)
    for name, roles in {
        "manager": (Role.PROJECT_MANAGER,),
        "generic": (Role.GENERIC_USER,),
        "second": (Role.GENERIC_USER,),
        "mixed": (Role.PROJECT_VIEWER, Role.GENERIC_USER),
        "owner_viewer": (Role.PROJECT_OWNER, Role.PROJECT_VIEWER),
    }.items():
        members[name] = base.model_copy(update={"subject": name, "roles": roles,
            **({"project_id": ""} if roles == (Role.GENERIC_USER,) else {})})
    return settings.model_copy(update={"principals": members}), token


def test_project_readers_can_triage_but_cannot_write(tmp_path):
    settings, token = configured(tmp_path)
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        for subject in ("viewer", "manager", "mixed"):
            headers = token(subject)
            response = client.post("/api/v1/runs", headers=headers,
                json={"prompt": "Investigate timeout", "incident_id": "SAMSON-101"})
            assert response.status_code == 200, response.text
            assert response.json()["status"] == "SUCCEEDED"
            run_id = response.json()["run_id"]
            for path in ("runs", f"runs/{run_id}", f"runs/{run_id}/evidence", f"runs/{run_id}/trace",
                         "health", "audit", "optimizations", "optimization-datasets", "knowledge"):
                assert client.get(f"/api/v1/{path}", headers=headers).status_code == 200, path
            for method, path in (("post", "knowledge"), ("post", "agent-configurations"),
                ("post", "optimization-datasets"), ("put", "users/analyst"),
                ("post", "project/setup"), ("put", "policy"), ("post", f"runs/{run_id}/cancel")):
                assert getattr(client, method)(f"/api/v1/{path}", headers=headers, json={}).status_code == 403, path
            assert client.post("/api/v1/knowledge", headers=token(subject, roles=["PLATFORM_ADMIN"]), json={}).status_code == 403
        assert client.get("/api/v1/access", headers=token("owner_viewer")).json()["can_manage_project"] is True


def test_generic_isolation_and_actual_personal_tool_execution(tmp_path):
    settings, token = configured(tmp_path)
    def factory(stage, config):
        return ToolExperimentModel(stage=stage, model=config.model)
    with TestClient(create_app(settings, connectors=connectors(), model_factory=factory)) as client:
        headers = token("generic")
        identity = client.get("/api/v1/me", headers=headers).json()
        assert identity["project_id"] == identity["tenant_id"] == ""
        assert client.get("/api/v1/access", headers=headers).json()["project_access"] is False
        for path in ("runs", "health", "users", "knowledge", "audit", "config", "tools", "capabilities", "notifications", "optimization-datasets", "platform/ui-settings"):
            assert client.get(f"/api/v1/{path}", headers=headers).status_code == 403, path
        assert client.post("/api/v1/files", headers=headers, files={"files": ("sample.txt", b"data")}).status_code == 403
        assert client.post("/api/v1/playground/tools/generic.text_metrics", headers=headers, json={"text": "two words"}).json()["words"] == 2
        assert client.post("/api/v1/playground/tools/generic.inspect_json", headers=headers, json={"text": '{"key":1}'}).json()["valid"] is True
        assert client.post("/api/v1/playground/tools/itsm.get_ticket", headers=headers, json={"text": "ticket"}).status_code == 403
        assert client.get("/api/v1/playground/capabilities", headers=headers).json()[0]["id"] == "text_review"
        assert client.post("/api/v1/playground/runs", headers=headers,
            json={"prompt": "hello", "project_id": settings.project_id}).status_code == 422
        assert client.post("/api/v1/playground/runs", headers=headers,
            json={"prompt": "hello", "capability": "incident_triage"}).status_code == 403
        response = client.post("/api/v1/playground/runs", headers=headers, json={"prompt": "Measure two words"})
        assert response.status_code == 201, response.text
        run = response.json()
        assert run["status"] == "SUCCEEDED", run
        assert "two words" in run["result"]
        assert "tenant_id" not in run and "project_id" not in run
        run_id = run["run_id"]
        assert client.get(f"/api/v1/playground/runs/{run_id}", headers=token("second")).status_code == 404
        assert client.get("/api/v1/playground/runs", headers=token("second")).json() == []
        assert client.get(f"/api/v1/runs/{run_id}", headers=token("admin")).status_code == 404
    with TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.get(f"/api/v1/playground/runs/{run_id}", headers=headers).json()["status"] == "SUCCEEDED"


def test_personal_capability_is_exported_without_joining_project_catalog(tmp_path):
    from app.optimization.content import read_platform
    from app.capabilities.registry import CapabilityRegistry
    settings, _ = configured(tmp_path)
    registry = CapabilityRegistry()
    _, _, files = read_platform(settings, registry)
    assert "capabilities/playground/text_review.yaml" in files
    assert registry.get("text_review") is None
