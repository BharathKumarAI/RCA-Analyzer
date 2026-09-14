"""Explicit local SSH test server; no external hosts or user credentials."""

import asyncssh
import pytest

from app.connectors.base import ConnectorError
from app.connectors.providers.infrastructure import UnixConnector


@pytest.mark.asyncio
async def test_unix_password_encrypted_key_and_host_verification(tmp_path):
    host_key = asyncssh.generate_private_key("ssh-ed25519")
    client_key = asyncssh.generate_private_key("ssh-ed25519")
    passphrase = "ephemeral-test-passphrase"
    key_path = tmp_path / "client-key"
    key_path.write_bytes(client_key.export_private_key(passphrase=passphrase))
    key_path.chmod(0o600)
    (tmp_path / "service.log").write_text("Isolated SSH fixture evidence\n")

    class Server(asyncssh.SSHServer):
        def begin_auth(self, username):
            return True

        def password_auth_supported(self):
            return True

        def public_key_auth_supported(self):
            return True

        def validate_password(self, username, password):
            return username == "test-reader" and password == "ephemeral-test-password"

        def validate_public_key(self, username, key):
            return username == "test-reader" and key == client_key.convert_to_public()

    server = await asyncssh.create_server(
        Server, "127.0.0.1", 0, server_host_keys=[host_key],
        sftp_factory=lambda channel: asyncssh.SFTPServer(channel, chroot=str(tmp_path)),
    )
    trust = tmp_path / "known_hosts"
    trust.write_text(f"[127.0.0.1]:{server.get_port()} " + host_key.export_public_key().decode())
    options = dict(host="127.0.0.1", port=server.get_port(), username="test-reader",
                   known_hosts=str(trust), path="/service.log", timeout_s=3)
    try:
        password = UnixConnector(**options, auth_method="ssh_password", password="ephemeral-test-password")
        assert "fixture evidence" in (await password.read_evidence())["text"]
        key = UnixConnector(**options, private_key_path=str(key_path), private_key_passphrase=passphrase)
        assert "fixture evidence" in (await key.read_evidence())["text"]
        wrong_password = UnixConnector(**options, auth_method="ssh_password", password="incorrect")
        with pytest.raises(ConnectorError):
            await wrong_password.read_evidence()
        trust.write_text(f"[127.0.0.1]:{server.get_port()} " + client_key.export_public_key().decode())
        with pytest.raises(ConnectorError):
            await password.read_evidence()
    finally:
        server.close()
        await server.wait_closed()
