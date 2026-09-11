"""Tests for scripts.issue_dev_token."""

import tempfile
import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.identity.principals import Role, UserPrincipal
from app.settings import Settings
from scripts.issue_dev_token import issue_token


@pytest.fixture
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    return private_pem, public_pem


def test_issue_token_success(rsa_keypair):
    private_pem, public_pem = rsa_keypair
    with tempfile.NamedTemporaryFile(suffix=".pem", delete=False) as f:
        f.write(private_pem)
        key_path = f.name

    try:
        settings = Settings(
            mode="demo",
            tenant_id="acme",
            project_id="payments",
            auth_issuer="https://issuer.example.test",
            auth_audience="rca-app",
            auth_public_key=public_pem,
            principals={
                "analyst": UserPrincipal(
                    subject="analyst",
                    username="analyst",
                    tenant_id="acme",
                    project_id="payments",
                    roles=[Role.PROJECT_ANALYST],
                )
            },
        )

        token = issue_token("analyst", key_path, settings=settings)
        decoded = jwt.decode(
            token,
            public_pem,
            algorithms=["RS256"],
            issuer="https://issuer.example.test",
            audience="rca-app",
        )
        assert decoded["sub"] == "analyst"
        assert decoded["exp"] > time.time()
    finally:
        Path(key_path).unlink(missing_ok=True)


def test_issue_token_refuses_live_mode(rsa_keypair):
    private_pem, public_pem = rsa_keypair
    with tempfile.NamedTemporaryFile(suffix=".pem", delete=False) as f:
        f.write(private_pem)
        key_path = f.name

    try:
        settings = Settings(
            mode="live",
            tenant_id="acme",
            project_id="payments",
            auth_issuer="https://issuer.example.test",
            auth_audience="rca-app",
            auth_public_key=public_pem,
            principals={
                "analyst": UserPrincipal(
                    subject="analyst",
                    username="analyst",
                    tenant_id="acme",
                    project_id="payments",
                    roles=[Role.PROJECT_ANALYST],
                )
            },
        )

        with pytest.raises(PermissionError, match="restricted to RCA_MODE=demo"):
            issue_token("analyst", key_path, settings=settings)
    finally:
        Path(key_path).unlink(missing_ok=True)


def test_issue_token_unconfigured_principal(rsa_keypair):
    private_pem, public_pem = rsa_keypair
    with tempfile.NamedTemporaryFile(suffix=".pem", delete=False) as f:
        f.write(private_pem)
        key_path = f.name

    try:
        settings = Settings(
            mode="demo",
            tenant_id="acme",
            project_id="payments",
            auth_issuer="https://issuer.example.test",
            auth_audience="rca-app",
            auth_public_key=public_pem,
            principals={},
        )

        with pytest.raises(KeyError, match="not in configured principals"):
            issue_token("unknown_user", key_path, settings=settings)
    finally:
        Path(key_path).unlink(missing_ok=True)
