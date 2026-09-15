"""Loopback-only Jira/Splunk mock servers for explicitly authorized local testing.

Run: python -m scripts.dev_connector_servers --directory .local/connector-tests
Never registered in a normal deployment. Generated TLS material stays local.
"""

import argparse
import base64
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import secrets
import ssl
import threading
from urllib.parse import parse_qs, urlsplit

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


class ConnectorMockServer:
    """Real TLS sockets with strict test credentials and bounded fixed responses."""

    def __init__(self, directory: Path, port: int = 0):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory = directory
        self.token = secrets.token_urlsafe(24)
        self.account = "connector-test@localhost.test"
        self.requests: list[str] = []
        self.forced_status: int | None = None
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PRISM local connector tests")])
        now = datetime.now(timezone.utc)
        certificate = (
            x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.SubjectAlternativeName([
                x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            ]), critical=False)
            .sign(key, hashes.SHA256())
        )
        self.cert_path = directory / "server.crt"
        key_path = directory / "server.key"
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        key_path.chmod(0o600)
        self.cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass  # No credential-bearing request logs.

            def do_GET(self):
                parsed = urlsplit(self.path)
                owner.requests.append(parsed.path)
                basic = "Basic " + base64.b64encode(f"{owner.account}:{owner.token}".encode()).decode()
                expected = basic if parsed.path.startswith("/rest/") else f"Bearer {owner.token}"
                status, body = 200, {}
                if self.headers.get("Authorization") != expected:
                    status, body = 401, {"error": "Test credential rejected"}
                elif owner.forced_status:
                    status, body = owner.forced_status, {"error": "Explicit mock failure scenario"}
                elif parsed.path in ("/rest/api/3/project/LOCAL", "/rest/api/2/project/LOCAL"):
                    body = {"key": "LOCAL", "name": "Local connector test project"}
                elif parsed.path in ("/rest/api/3/field", "/rest/api/2/field"):
                    body = [{"id": "customfield_10290", "name": "Support Queue"}]
                elif parsed.path in ("/rest/api/3/myself", "/rest/api/2/myself"):
                    body = {"accountId": "test-user-123", "displayName": "Triage Bot", "emailAddress": owner.account}
                elif parsed.path in ("/rest/api/3/issue/LOCAL-1", "/rest/api/2/issue/LOCAL-1"):
                    body = {"key": "LOCAL-1", "fields": {
                        "summary": "MOCK SERVER: bounded connector transport test",
                        "status": {"name": "Open"}, "description": "Local fixture evidence only.",
                        "customfield_10290": "Local queue", "attachment": [],
                    }}
                elif parsed.path == "/services/data/indexes/local_test":
                    body = {"name": "local_test"}
                elif parsed.path == "/services/search/jobs/export":
                    search = parse_qs(parsed.query).get("search", [""])[0]
                    if not search.startswith('search index=local_test "'):
                        status, body = 403, {"error": "Index outside test scope"}
                    else:
                        body = {"result": {"_raw": "MOCK SERVER: local transport evidence", "source": "local-mock", "index": "local_test"}}
                else:
                    status, body = 404, {"error": "Resource outside test scope"}
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cert_path, key_path)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.endpoint = f"https://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(".local/connector-tests"))
    parser.add_argument("--port", type=int, default=9443)
    args = parser.parse_args()
    with ConnectorMockServer(args.directory, args.port) as server:
        config = args.directory / "mock-connection.json"
        config.write_text(json.dumps({
            "mock_only": True, "endpoint": server.endpoint,
            "account": server.account, "token": server.token,
            "ca_file": str(server.cert_path.resolve()),
            "jira_project": "LOCAL", "splunk_index": "local_test",
        }, indent=2))
        config.chmod(0o600)
        print(f"Local MOCK connector server: {server.endpoint}", flush=True)
        print(f"Private test configuration: {config}", flush=True)
        try:
            server.thread.join()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
