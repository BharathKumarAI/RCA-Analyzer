"""Independent security checks after the browser sign-in implementation review."""

from copy import deepcopy

import pytest

from tests.integration.test_oidc import submit, review, login

pytest_plugins = ["tests.integration.test_oidc"]


def test_current_membership_revocation_immediately_blocks_an_existing_browser_session(oidc_app):
    client, token, issuer, _ = oidc_app
    assert review(client, token, submit(client, token)).status_code == 200
    assert login(client, issuer).headers["location"] == "/workspace"
    assert client.get("/api/v1/me").status_code == 200
    changed = client.put("/api/v1/users/analyst", headers=token("admin"), json={
        "name": "Analyst", "roles": ["PROJECT_ANALYST"], "status": "inactive",
    })
    assert changed.status_code == 200, changed.text
    assert client.get("/api/v1/me").status_code == 403
    assert client.get("/api/v1/knowledge").status_code == 403
    # The original bootstrap bearer cannot restore inactive membership either.
    assert client.get("/api/v1/me", headers=token("analyst")).status_code == 403


@pytest.mark.parametrize("changes", [{"use": "enc"}, {"alg": "RS512"}, {"key_ops": ["encrypt"]}])
def test_signing_keys_declared_for_other_algorithms_or_operations_cannot_sign_in(oidc_app, changes):
    client, token, issuer, _ = oidc_app
    assert review(client, token, submit(client, token)).status_code == 200
    issuer.jwk = deepcopy(issuer.jwk) | changes
    response = login(client, issuer)
    assert "sign_in_error=" in response.headers["location"]
    assert client.get("/api/v1/me").status_code == 401


def test_price_configuration_integrity_failure_cannot_become_an_active_rate(oidc_app):
    # This app includes the complete database bootstrap and review roles.
    client, token, _, _ = oidc_app
    proposal = client.put("/api/v1/telemetry/pricing", headers=token("admin"), json={
        "expected_revision": 0, "rates": {"test-model": {"input_per_million": 1, "output_per_million": 2}},
    }).json()
    from sqlalchemy import select, update
    from app.configuration.parameters import system_configurations
    async def corrupt():
        async with client.app.state.store.engine.begin() as connection:
            where = (system_configurations.c.config_type == "model_pricing", system_configurations.c.config_key == "rates")
            value = await connection.scalar(select(system_configurations.c.content_json).where(*where))
            value["proposal"]["rates"]["test-model"]["input_per_million"] = 999
            await connection.execute(update(system_configurations).where(*where).values(content_json=value))
    client.portal.call(corrupt)
    response = client.post("/api/v1/telemetry/pricing/approve", headers=token("reviewer"), json={
        "expected_hash": proposal["proposal"]["content_hash"], "reason": "Review exact submitted rates",
    })
    assert response.status_code == 409
