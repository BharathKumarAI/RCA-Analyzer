"""Protocol probes against a real local HTTPS server."""

import ipaddress
import json
import ssl
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx2
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient

from app.api.application import create_app
from app.api.routes import integrations as integrations_route
from app.configuration.integrations import IntegrationDefinition
from app.connectors.providers.integration_probe import probe_integration
from tests.support import settings_for


MCP_RESULT = {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "protocolVersion": "2025-11-25",
        "capabilities": {},
        "serverInfo": {"name": "local-mcp", "version": "1.0.0"},
    },
}
A2A_CARD = {
    "name": "Local agent",
    "description": "A local protocol probe target",
    "version": "1.0.0",
    "capabilities": {},
    "skills": [],
    "defaultInputModes": ["text"],
    "defaultOutputModes": ["text"],
    "url": "https://localhost/agent",
}


class ProbeState:
    def __init__(self, protocol, status=200, invalid=False):
        self.protocol = protocol
        self.status = status
        self.invalid = invalid
        self.requests = []
        self.lock = threading.Lock()
        self.sse_initialized = threading.Event()

    def record(self, request):
        with self.lock:
            self.requests.append(request)


def _certificate(tmp_path: Path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(minutes=10))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                ]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert_path = tmp_path / "probe-cert.pem"
    key_path = tmp_path / "probe-key.pem"
    cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return cert_path, key_path


def _handler(state):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def _request(self):
            length = int(self.headers.get("content-length", "0"))
            body = self.rfile.read(length) if length else b""
            state.record(
                {
                    "method": self.command,
                    "path": self.path,
                    "headers": {key.lower(): value for key, value in self.headers.items()},
                    "body": body,
                }
            )
            return body

        def _send(self, status, payload=None, content_type="application/json"):
            body = b"" if payload is None else (
                payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            )
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)
                self.wfile.flush()

        def do_POST(self):
            body = self._request()
            if state.status != 200:
                self._send(state.status, {"error": "unauthorized"})
                return
            if state.protocol == "mcp" and self.path == "/mcp":
                if state.invalid:
                    self._send(200, {"jsonrpc": "2.0", "id": 1, "result": {}})
                elif json.loads(body).get("method") == "initialize":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Mcp-Session-Id", "local-session")
                    encoded = json.dumps(MCP_RESULT).encode()
                    self.send_header("Content-Length", str(len(encoded)))
                    self.end_headers()
                    self.wfile.write(encoded)
                else:
                    self._send(204)
                return
            if state.protocol == "sse" and self.path == "/message":
                if json.loads(body).get("method") == "initialize":
                    state.sse_initialized.set()
                self._send(202)
                return
            self._send(404, {"error": "not found"})

        def do_DELETE(self):
            self._request()
            # MCP treats session cleanup as best effort, including 405 servers.
            self._send(405)

        def do_GET(self):
            self._request()
            if state.status != 200:
                self._send(state.status, {"error": "unauthorized"})
                return
            if state.protocol == "sse" and self.path == "/sse":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                self.wfile.write(b"event: endpoint\ndata: /message\n\n")
                self.wfile.flush()
                if state.sse_initialized.wait(5):
                    self.wfile.write(
                        b"event: message\ndata: "
                        + json.dumps(MCP_RESULT).encode()
                        + b"\n\n"
                    )
                    self.wfile.flush()
                self.close_connection = True
                return
            if state.protocol == "a2a":
                self._send(200, A2A_CARD)
                return
            self._send(404, {"error": "not found"})

    return Handler


@contextmanager
def tls_server(tmp_path, protocol, *, status=200, invalid=False):
    cert_path, key_path = _certificate(tmp_path)
    state = ProbeState(protocol, status=status, invalid=invalid)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=cert_path, keyfile=key_path)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state, f"https://localhost:{server.server_port}", cert_path
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _settings(tmp_path, **updates):
    settings, _ = settings_for(tmp_path)
    return settings.model_copy(
        update={"integration_allowed_hosts": "localhost", **updates}
    )


def _definition(endpoint, *, kind="mcp", auth_method="none", secret_reference=""):
    return IntegrationDefinition(
        name="Local probe",
        kind=kind,
        endpoint=endpoint + ("/mcp" if kind == "mcp" else "/agent"),
        auth_method=auth_method,
        secret_reference=secret_reference,
        transport="streamable_http" if kind == "mcp" else "a2a_jsonrpc",
    )


@pytest.mark.asyncio
async def test_streamable_mcp_initialize_notification_and_best_effort_delete(tmp_path):
    with tls_server(tmp_path, "mcp") as (state, endpoint, cert_path):
        definition = _definition(endpoint)
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            result = await probe_integration(definition, _settings(tmp_path), client=client)
        assert result["status"] == "reachable", result
        assert "local-session" in str(state.requests)
        assert [request["method"] for request in state.requests] == ["POST", "POST", "DELETE"]
        assert json.loads(state.requests[0]["body"])["method"] == "initialize"
        assert json.loads(state.requests[1]["body"])["method"] == "notifications/initialized"
        assert state.requests[1]["headers"]["mcp-protocol-version"] == "2025-11-25"


@pytest.mark.asyncio
async def test_sse_mcp_initialize_uses_server_message_endpoint(tmp_path):
    with tls_server(tmp_path, "sse") as (state, endpoint, cert_path):
        definition = IntegrationDefinition(
            name="Local SSE",
            kind="mcp",
            endpoint=endpoint + "/sse",
            transport="sse",
        )
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            result = await probe_integration(definition, _settings(tmp_path), client=client)
        assert result["status"] == "reachable", result
        assert [request["method"] for request in state.requests] == ["GET", "POST", "POST"]
        assert state.requests[1]["path"] == "/message"
        assert json.loads(state.requests[1]["body"])["method"] == "initialize"
        assert json.loads(state.requests[2]["body"])["method"] == "notifications/initialized"


@pytest.mark.asyncio
async def test_a2a_agent_card_is_validated_over_tls(tmp_path):
    with tls_server(tmp_path, "a2a") as (state, endpoint, cert_path):
        definition = _definition(endpoint, kind="a2a")
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            result = await probe_integration(definition, _settings(tmp_path), client=client)
        assert result["status"] == "reachable", result
        assert len(state.requests) == 1
        assert state.requests[0]["path"] == "/.well-known/agent-card.json"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 500])
async def test_http_errors_are_sanitized(tmp_path, status):
    with tls_server(tmp_path, "mcp", status=status) as (state, endpoint, cert_path):
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            result = await probe_integration(
                _definition(endpoint), _settings(tmp_path), client=client
            )
        assert result["status"] == "failed"
        assert result["message"] == f"Remote endpoint returned HTTP {status}."
        assert "unauthorized" not in str(result)
        assert state.requests


@pytest.mark.asyncio
async def test_invalid_protocol_response_is_sanitized(tmp_path):
    with tls_server(tmp_path, "mcp", invalid=True) as (state, endpoint, cert_path):
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            result = await probe_integration(
                _definition(endpoint), _settings(tmp_path), client=client
            )
        assert result["status"] == "failed"
        assert "valid supported protocol response" in result["message"]
        assert state.requests


@pytest.mark.asyncio
async def test_host_and_secret_policy_blocks_before_any_request(tmp_path, monkeypatch):
    with tls_server(tmp_path, "mcp") as (state, endpoint, cert_path):
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            blocked_host = IntegrationDefinition(
                name="Blocked host",
                kind="mcp",
                endpoint=endpoint.replace("localhost", "blocked.localhost") + "/mcp",
                transport="streamable_http",
            )
            result = await probe_integration(blocked_host, _settings(tmp_path), client=client)
            assert result["status"] == "blocked"
            assert state.requests == []

            monkeypatch.setenv("LOCAL_PROBE_TOKEN", "never-echo-this-token")
            blocked_secret = _definition(
                endpoint,
                auth_method="bearer",
                secret_reference="env://LOCAL_PROBE_TOKEN",
            )
            result = await probe_integration(blocked_secret, _settings(tmp_path), client=client)
            assert result["status"] == "blocked"
            assert state.requests == []


@pytest.mark.asyncio
async def test_bearer_secret_is_sent_by_server_side_reference_and_never_echoed(
    tmp_path, monkeypatch
):
    token = "never-echo-this-token"
    monkeypatch.setenv("LOCAL_PROBE_TOKEN", token)
    with tls_server(tmp_path, "mcp") as (state, endpoint, cert_path):
        definition = _definition(
            endpoint,
            auth_method="bearer",
            secret_reference="env://LOCAL_PROBE_TOKEN",
        )
        settings = _settings(
            tmp_path,
            integration_secret_references=json.dumps(
                {"localhost": ["env://LOCAL_PROBE_TOKEN"]}
            ),
        )
        context = ssl.create_default_context(cafile=cert_path)
        async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
            result = await probe_integration(definition, settings, client=client)
        assert result["status"] == "reachable", result
        assert state.requests[0]["headers"]["authorization"] == f"Bearer {token}"
        assert token not in json.dumps(result)


def test_api_test_route_uses_saved_effective_definition_and_enforces_permissions(
    tmp_path, monkeypatch
):
    settings, token = settings_for(tmp_path)
    settings = settings.model_copy(update={"integration_allowed_hosts": "localhost"})
    with tls_server(tmp_path, "mcp") as (state, endpoint, cert_path):
        # The route owns the call, while this hook supplies the test certificate
        # to the real probe client. Network traffic still reaches the TLS server.
        original_probe = integrations_route.probe_integration
        seen = {}

        async def probe_with_trusted_client(definition, configured):
            seen["definition"] = definition
            context = ssl.create_default_context(cafile=cert_path)
            async with httpx2.AsyncClient(verify=context, trust_env=False) as client:
                return await original_probe(definition, configured, client=client)

        monkeypatch.setattr(integrations_route, "probe_integration", probe_with_trusted_client)
        with TestClient(create_app(settings)) as client:
            saved = client.put(
                "/api/v1/integrations/platform/live-agent",
                headers=token("admin"),
                json={
                    "definition": {
                        "name": "Platform agent",
                        "kind": "mcp",
                        "endpoint": endpoint + "/mcp",
                        "description": "platform",
                        "auth_method": "none",
                        "secret_reference": "",
                        "transport": "streamable_http",
                        "timeout_seconds": 30,
                        "allow_project_override": True,
                    }
                },
            )
            assert saved.status_code == 200, saved.text
            platform_revision = saved.json()[0]["revision"]
            overridden = client.put(
                "/api/v1/integrations/project/live-agent",
                headers=token("owner"),
                json={
                    "definition": {
                        "name": "Project agent",
                        "kind": "mcp",
                        "endpoint": endpoint + "/mcp",
                        "description": "project",
                        "auth_method": "none",
                        "secret_reference": "",
                        "transport": "streamable_http",
                        "timeout_seconds": 30,
                        "allow_project_override": True,
                    },
                    "expected_platform_revision": platform_revision,
                },
            )
            assert overridden.status_code == 200, overridden.text
            revision = overridden.json()[0]["revision"]

            tested = client.post(
                "/api/v1/integrations/live-agent/test", headers=token("owner")
            )
            assert tested.status_code == 200, tested.text
            assert tested.json()["status"] == "reachable"
            assert tested.json()["revision"] == revision
            assert seen["definition"].name == "Project agent"
            assert [request["method"] for request in state.requests] == [
                "POST",
                "POST",
                "DELETE",
            ]

            # A project analyst may read a registration but cannot initiate a
            # connection test that requires project configuration authority.
            request_count = len(state.requests)
            forbidden = client.post(
                "/api/v1/integrations/live-agent/test", headers=token("analyst")
            )
            assert forbidden.status_code == 403
            assert len(state.requests) == request_count
