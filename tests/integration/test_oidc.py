"""Full browser authorization-code flow against an isolated signed OIDC test issuer."""

import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
import httpx2
import jwt
import pytest

from app.api.application import create_app
from app.connectors.providers.oidc import OidcProvider
from app.configuration.oidc import LOGIN_COOKIE, SESSION_COOKIE, CSRF_COOKIE, OidcService
from tests.integration.test_skill_catalog import reviewed_settings
from tests.support import connectors


class TestIssuer:
    __test__ = False

    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key())) | {"kid": "test-key", "use": "sig", "alg": "RS256"}
        self.query = {}
        self.claim_changes = {}
        self.exchanges = 0
        self.token_request = None

    def handle(self, request):
        if request.url.path == "/keys":
            return httpx2.Response(200, json={"keys": [self.jwk]})
        assert request.url.path == "/token" and request.method == "POST"
        self.token_request = request
        data = parse_qs(request.content.decode())
        assert data["code"] == ["single-use-code"]
        verifier = data["code_verifier"][0]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        assert self.query["code_challenge"] == [challenge]
        assert data["redirect_uri"] == ["https://app.example.test/api/v1/auth/callback"]
        self.exchanges += 1
        claims = {"iss": "https://identity.example.test", "aud": "rca-browser", "sub": "analyst",
                  "iat": int(time.time()), "exp": int(time.time()) + 600, "nonce": self.query["nonce"][0],
                  "roles": ["PLATFORM_ADMIN"], "tenant_id": "attacker", "project_id": "attacker"} | self.claim_changes
        encoded = jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "test-key"})
        return httpx2.Response(200, json={"id_token": encoded, "access_token": "test-only-access-token"})


def configuration(**changes):
    return {"display_name": "Company sign-in", "issuer": "https://identity.example.test",
            "client_id": "rca-browser", "authorization_endpoint": "https://identity.example.test/authorize",
            "token_endpoint": "https://identity.example.test/token", "jwks_uri": "https://identity.example.test/keys",
            "redirect_uri": "https://app.example.test/api/v1/auth/callback", "token_auth_method": "none",
            "client_secret_reference": "", "scopes": ["openid", "email"], "session_ttl_seconds": 3600} | changes


def submit(client, token, **changes):
    response = client.post("/api/v1/auth/configurations", headers=token("admin"), json=configuration(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def review(client, token, record, action="approve", actor="reviewer"):
    return client.post(f"/api/v1/auth/configurations/{record['draft_id']}/{action}", headers=token(actor),
                       json={"expected_hash": record["content_hash"], "reason": "Reviewed client, redirect URI, and identity scope."})


def login(client, issuer):
    redirect = client.get("/api/v1/auth/login", follow_redirects=False)
    assert redirect.status_code == 303, redirect.text
    issuer.query = parse_qs(urlsplit(redirect.headers["location"]).query)
    assert issuer.query["response_type"] == ["code"]
    assert issuer.query["code_challenge_method"] == ["S256"]
    return client.get("/api/v1/auth/callback", params={"state": issuer.query["state"][0], "code": "single-use-code"},
                      follow_redirects=False)


@pytest.fixture
def oidc_app(tmp_path):
    settings, token = reviewed_settings(tmp_path)
    issuer = TestIssuer()
    app = create_app(settings, connectors=connectors())
    with TestClient(app, base_url="https://app.example.test") as client:
        original = app.state.oidc.provider
        app.state.oidc.provider = OidcProvider(httpx2.MockTransport(issuer.handle))
        client.portal.call(original.aclose)
        yield client, token, issuer, settings


def test_sso_review_code_pkce_nonce_membership_csrf_logout_and_replay(oidc_app):
    client, token, issuer, settings = oidc_app
    assert client.get("/api/v1/auth/providers").json()["configured"] is False
    record = submit(client, token)
    assert record["status"] == "PENDING"
    assert client.get("/api/v1/auth/providers").json()["configured"] is False
    assert review(client, token, record, actor="admin").status_code == 403
    assert review(client, token, record).status_code == 200
    callback = login(client, issuer)
    assert callback.headers["location"] == "/workspace", callback.text
    cookies = callback.headers.get_list("set-cookie")
    assert any(SESSION_COOKIE in cookie and "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie for cookie in cookies)
    assert any(CSRF_COOKIE in cookie and "HttpOnly" not in cookie and "Secure" in cookie for cookie in cookies)
    session = client.get("/api/v1/auth/session")
    assert session.status_code == 200, session.text
    assert session.json()["principal"]["subject"] == "analyst"
    assert session.json()["principal"]["roles"] == ["PROJECT_ANALYST"]
    assert session.json()["principal"]["project_id"] == settings.project_id
    assert session.json()["authentication"] == "sso"
    csrf = session.json()["csrf_token"]
    assert client.post("/api/v1/chats").status_code == 403
    assert client.post("/api/v1/chats", headers={"X-CSRF-Token": csrf, "Origin": "https://attacker.example"}).status_code == 403
    headers = {"X-CSRF-Token": csrf, "Origin": "https://app.example.test"}
    assert client.post("/api/v1/chats", headers=headers).status_code == 201
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/me").status_code == 401
    replay = client.get("/api/v1/auth/callback", params={"state": issuer.query["state"][0], "code": "single-use-code"}, follow_redirects=False)
    assert "sign_in_error=" in replay.headers["location"]
    assert issuer.exchanges == 1


@pytest.mark.parametrize("claims", [
    {"nonce": "wrong"}, {"aud": "another-client"}, {"iss": "https://other.example"},
    {"sub": "unprovisioned"}, {"exp": 1}, {"aud": ["rca-browser", "another-client"]},
])
def test_unverified_or_unprovisioned_identities_never_create_sessions(oidc_app, claims):
    client, token, issuer, _ = oidc_app
    assert review(client, token, submit(client, token)).status_code == 200
    issuer.claim_changes = claims
    response = login(client, issuer)
    assert "sign_in_error=" in response.headers["location"]
    assert client.get("/api/v1/me").status_code == 401


def test_sso_configuration_replacement_revocation_and_session_expiry(oidc_app):
    client, token, issuer, settings = oidc_app
    record = submit(client, token)
    assert review(client, token, record).status_code == 200
    assert login(client, issuer).headers["location"] == "/workspace"
    pending = submit(client, token, display_name="Updated sign-in")
    assert client.get("/api/v1/auth/providers").json()["name"] == "Company sign-in"
    assert review(client, token, pending).status_code == 200
    assert client.get("/api/v1/me").status_code == 401
    assert login(client, issuer).headers["location"] == "/workspace"
    with sqlite3.connect(str(settings.database_url.get_secret_value()).split("///", 1)[1]) as database:
        database.execute("UPDATE browser_sessions SET expires_at=0")
    assert client.get("/api/v1/me").status_code == 401
    assert review(client, token, pending, action="revoke", actor="admin").status_code == 200
    assert client.get("/api/v1/auth/providers").json()["configured"] is False
    assert client.post("/api/v1/auth/configurations", headers=token("admin"), json=configuration(redirect_uri="https://app.example.test/wrong")).status_code == 422
    assert client.post("/api/v1/auth/configurations", headers=token("admin"), json=configuration(token_endpoint="http://identity.example.test/token")).status_code == 422
    assert client.get("/api/v1/auth/configurations", headers=token("analyst")).status_code == 403


def test_concurrent_sso_approvals_keep_one_active_provider(oidc_app):
    client, token, _, _ = oidc_app
    initial = submit(client, token)
    assert review(client, token, initial).status_code == 200
    candidates = [submit(client, token, display_name=f"Company provider {number}") for number in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda record: review(client, token, record), candidates))
    assert all(result.status_code in {200, 409} for result in results), [r.text for r in results]
    catalog = client.get("/api/v1/auth/configurations", headers=token("admin"))
    assert catalog.status_code == 200, catalog.text
    assert sum(row["status"] == "APPROVED" for row in catalog.json()["drafts"]) == 1
    assert client.get("/api/v1/auth/providers").json()["configured"] is True


def test_login_requests_are_bounded_expiring_and_bound_to_browser(oidc_app):
    client, token, issuer, settings = oidc_app
    assert review(client, token, submit(client, token, max_pending_logins=10)).status_code == 200
    for _ in range(10):
        assert client.get("/api/v1/auth/login", follow_redirects=False).status_code == 303
    limited = client.get("/api/v1/auth/login", follow_redirects=False)
    assert limited.status_code == 429 and limited.headers["Retry-After"]
    with sqlite3.connect(str(settings.database_url.get_secret_value()).split("///", 1)[1]) as database:
        assert database.execute("SELECT count(*) FROM oidc_login_transactions").fetchone()[0] == 10
        database.execute("UPDATE oidc_login_transactions SET expires_at=0")
    redirect = client.get("/api/v1/auth/login", follow_redirects=False)
    assert redirect.status_code == 303
    issuer.query = parse_qs(urlsplit(redirect.headers["location"]).query)
    client.cookies.delete(LOGIN_COOKIE)
    response = client.get("/api/v1/auth/callback", params={"state": issuer.query["state"][0], "code": "single-use-code"}, follow_redirects=False)
    assert "sign_in_error=" in response.headers["location"]
    assert issuer.exchanges == 0
    assert client.get("/api/v1/me").status_code == 401


@pytest.mark.parametrize("method", ["client_secret_basic", "client_secret_post"])
def test_confidential_oidc_client_resolves_secret_only_during_exchange(oidc_app, monkeypatch, method):
    client, token, issuer, _ = oidc_app
    secret = "test-only:secret + characters"
    monkeypatch.setenv("RCA_OIDC_TEST_SECRET", secret)
    record = submit(client, token, token_auth_method=method, client_secret_reference="env://RCA_OIDC_TEST_SECRET")
    assert secret not in json.dumps(record)
    assert review(client, token, record).status_code == 200
    assert login(client, issuer).headers["location"] == "/workspace"
    if method == "client_secret_post":
        assert parse_qs(issuer.token_request.content.decode())["client_secret"] == [secret]
    else:
        credentials = base64.b64decode(issuer.token_request.headers["Authorization"].split(" ", 1)[1]).decode()
        assert credentials == "rca-browser:test-only%3Asecret+%2B+characters"


@pytest.mark.parametrize("key_operations", [None, ["encrypt"], "verify"])
def test_invalid_signing_key_permissions_fail_closed(oidc_app, key_operations):
    client, token, issuer, _ = oidc_app
    assert review(client, token, submit(client, token)).status_code == 200
    issuer.jwk["key_ops"] = key_operations
    assert "sign_in_error=" in login(client, issuer).headers["location"]
    assert client.get("/api/v1/me").status_code == 401


def test_identity_provider_configuration_isolated_between_project_deployments(oidc_app):
    client, token, _, settings = oidc_app
    record = submit(client, token)
    assert review(client, token, record).status_code == 200
    other = OidcService(client.app.state.store.engine, settings.model_copy(update={"project_id": "another-project"}))
    try:
        assert client.portal.call(other.active) is None
        assert client.portal.call(other.catalog) == {"active": None, "drafts": []}
        assert client.get("/api/v1/auth/providers").json()["configured"] is True
    finally:
        client.portal.call(other.aclose)


def test_identical_reapproval_cannot_revive_revoked_sessions_or_login_requests(oidc_app):
    client, token, issuer, _ = oidc_app
    first = submit(client, token)
    assert review(client, token, first).status_code == 200
    assert login(client, issuer).headers["location"] == "/workspace"
    redirect = client.get("/api/v1/auth/login", follow_redirects=False)
    stale_query = parse_qs(urlsplit(redirect.headers["location"]).query)
    assert review(client, token, first, action="revoke").status_code == 200
    assert client.get("/api/v1/me").status_code == 401
    replacement = submit(client, token)
    assert replacement["content_hash"] == first["content_hash"]
    assert review(client, token, replacement).status_code == 200
    assert client.get("/api/v1/me").status_code == 401
    stale = client.get("/api/v1/auth/callback", params={"state": stale_query["state"][0], "code": "single-use-code"}, follow_redirects=False)
    assert "sign_in_error=" in stale.headers["location"]
    assert issuer.exchanges == 1
    assert login(client, issuer).headers["location"] == "/workspace"
