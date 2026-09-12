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

from app.connectors.providers.infrastructure import UnixConnector
from app.connectors.providers.mcp_evidence import McpEvidenceConnector
from app.connectors.providers.registry import McpBinding
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
    finally:
        await connector.aclose()
        listener.close()
        await listener.wait_closed()
