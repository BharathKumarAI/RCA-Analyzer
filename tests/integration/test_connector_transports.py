"""Exercise real MCP and SFTP servers against repository files, without mock providers."""

import asyncio
import hashlib
import json
import socket

import asyncssh
import pytest
import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse

from app.connectors.providers.infrastructure import UnixConnector
from app.connectors.providers.mcp_evidence import McpEvidenceConnector
from app.connectors.providers.registry import McpBinding, resolve_project_connector
from app.connectors.candidate_testing import execute_candidate_test
from app.configuration.platform import PlatformConfiguration
from app.settings import Settings
from app.settings import CONTENT_ROOT
from tests.integration.test_integration_probe import _certificate


@pytest.mark.asyncio
@pytest.mark.parametrize("json_response", [True, False])
async def test_mcp_bound_read_from_real_server(tmp_path, monkeypatch, json_response):
    source = CONTENT_ROOT / "config/connectors.yaml"
    server = FastMCP("repository-reader", json_response=json_response)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))
    def read_configuration(scope: str) -> dict:
        if scope != CONTENT_ROOT.name:
            raise PermissionError("Outside scope")
        return {"sha256": hashlib.sha256(source.read_bytes()).hexdigest()}

    @server.custom_route("/api/v2/spaces/{scope}/pages", methods=["GET"])
    async def read_native_configuration(request):
        if request.path_params["scope"] != CONTENT_ROOT.name:
            return JSONResponse({"error": "Outside scope"}, status_code=403)
        if request.headers.get("authorization") != "Bearer " + hashlib.sha256(cert.read_bytes()).hexdigest():
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return JSONResponse({"results": [{"id": source.name, "title": source.name,
                                          "spaceId": CONTENT_ROOT.name, "status": "current",
                                          "body": {"storage": {"value": source.read_text()}}}]})

    cert, key = _certificate(tmp_path)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    app = uvicorn.Server(uvicorn.Config(server.streamable_http_app(), host="127.0.0.1", port=port,
                                      ssl_certfile=str(cert), ssl_keyfile=str(key), log_level="error"))
    task = asyncio.create_task(app.serve(sockets=[listener]))
    connector = None
    try:
        async with asyncio.timeout(10):
            while not app.started:
                if task.done():
                    await task
                    raise RuntimeError("MCP server did not start")
                await asyncio.sleep(0)
        monkeypatch.setenv("CONFLUENCE_CA_FILE", str(cert))
        connector = McpEvidenceConnector("confluence", endpoint=f"https://127.0.0.1:{port}/mcp",
                                         scope=CONTENT_ROOT.name, token=hashlib.sha256(cert.read_bytes()).hexdigest(),
                                         mcp_tools={"read_evidence": McpBinding(name="read_configuration", scope_argument="scope")})
        health = await connector.probe_health()
        assert health.overall.value == "HEALTHY"
        result = await connector.read_evidence()
        assert json.loads(result["content"][0])["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
        monkeypatch.setenv("CONFLUENCE_TOKEN", hashlib.sha256(cert.read_bytes()).hexdigest())
        candidate = {
            "template_id": "confluence", "template_version": "1.0.0", "system_name": "Repository",
            "environment_dependency": "independent", "tool_environment": "Shared",
            "external_resource": CONTENT_ROOT.name, "access_mode": "hybrid",
            "endpoint": f"https://127.0.0.1:{port}", "auth_type": "bearer_token",
            "credentials": {"token_secret_ref": "env://CONFLUENCE_TOKEN"},
            "mcp_configuration": {
                "endpoint": f"https://127.0.0.1:{port}/mcp",
                "token_secret_ref": "env://CONFLUENCE_TOKEN",
                "mcp_tools": {"read_evidence": {"name": "read_configuration", "scope_argument": "scope"}},
                "operation_routes": {"read_evidence": "mcp"},
            },
        }
        template = next(t for t in PlatformConfiguration.load(Settings()).connector_templates if t.type == "confluence")
        tested = await execute_candidate_test(
            candidate, template.model_dump(mode="json"), "test_scoped_read",
            allowed_secret_references={"env://CONFLUENCE_TOKEN"}, allowed_endpoint_hosts={"127.0.0.1"},
        )
        assert tested["overall_result"] == "PASSED", tested
        monkeypatch.setenv("NATIVE_CONFLUENCE_TOKEN", hashlib.sha256(key.read_bytes()).hexdigest())
        rejected = await execute_candidate_test(
            {**candidate, "credentials": {"token_secret_ref": "env://NATIVE_CONFLUENCE_TOKEN"}},
            template.model_dump(mode="json"), "test_connection",
            allowed_secret_references={"env://CONFLUENCE_TOKEN", "env://NATIVE_CONFLUENCE_TOKEN"},
            allowed_endpoint_hosts={"127.0.0.1"},
        )
        assert rejected["overall_result"] == "FAILED"
        assert rejected["stage_results"]["route_direct"]["status"] == "FAILED"
        assert rejected["stage_results"]["route_mcp"]["status"] == "PASSED"
        runtime = resolve_project_connector(
            {"tenant_id": "tenant", "project_id": "project", "instance_id": "repository",
             "template_id": "confluence", "status": "enabled", "enabled": True,
             "definition_json": candidate},
            deployment_tenant_id="tenant", deployment_project_id="project",
            allowed_secret_references={"env://CONFLUENCE_TOKEN"}, allowed_hosts={"127.0.0.1"},
        )
        try:
            result = await runtime.read_evidence()
            assert json.loads(result["content"][0])["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
        finally:
            await runtime.aclose()
    finally:
        if connector:
            await connector.aclose()
        app.should_exit = True
        await asyncio.wait_for(task, 10)
        listener.close()


@pytest.mark.asyncio
async def test_native_sftp_reads_only_configured_file(tmp_path, monkeypatch):
    source = CONTENT_ROOT / "skills/unix-review/SKILL.md"
    host_key = asyncssh.generate_private_key("ssh-ed25519")
    client_key = asyncssh.generate_private_key("ssh-ed25519")
    key_path = tmp_path / "client_key"
    key_path.write_bytes(client_key.export_private_key())

    class Server(asyncssh.SSHServer):
        def begin_auth(self, username):
            return True

        def public_key_auth_supported(self):
            return True

        def validate_public_key(self, username, key):
            return username == "reader" and key == client_key.convert_to_public()

    listener = await asyncssh.create_server(Server, "127.0.0.1", 0, server_host_keys=[host_key],
                                           sftp_factory=lambda channel: asyncssh.SFTPServer(channel, chroot=str(source.parent)))
    known_hosts = tmp_path / "known_hosts"
    known_hosts.write_text(f"[127.0.0.1]:{listener.get_port()} " + host_key.export_public_key().decode())
    for name, value in {"UNIX_HOST": "127.0.0.1", "UNIX_PORT": str(listener.get_port()), "UNIX_USER": "reader",
                        "UNIX_CLIENT_KEY": str(key_path), "UNIX_KNOWN_HOSTS": str(known_hosts), "UNIX_LOG_PATH": "/SKILL.md"}.items():
        monkeypatch.setenv(name, value)
    connector = UnixConnector()
    try:
        result = await connector.read_evidence()
        assert result["text"] == source.read_text()
        assert not result["truncated"]
        monkeypatch.setenv("UNIX_PORT", "22")
        template = next(t for t in PlatformConfiguration.load(Settings()).connector_templates if t.type == "unix")
        tested = await execute_candidate_test({
            "template_id": "unix", "template_version": "1.0.0", "system_name": "Repository SFTP",
            "environment_dependency": "independent", "tool_environment": "Shared",
            "endpoint": "sftp://127.0.0.1", "port": listener.get_port(), "external_resource": "/SKILL.md",
            "auth_type": "ssh_private_key",
            "credentials": {"username": "reader", "private_key_ref": "env://UNIX_CLIENT_KEY",
                            "known_hosts_ref": "env://UNIX_KNOWN_HOSTS"},
        }, template.model_dump(mode="json"), "test_scoped_read",
            allowed_secret_references={"env://UNIX_CLIENT_KEY", "env://UNIX_KNOWN_HOSTS"},
            allowed_endpoint_hosts={"127.0.0.1"},
        )
        assert tested["overall_result"] == "PASSED", tested
    finally:
        await connector.aclose()
        listener.close()
        await listener.wait_closed()
