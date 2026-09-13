"""Operational settings affect real admission and survive restart."""
from starlette.testclient import TestClient
from app.api.application import create_app
from tests.support import connectors, settings_for


def test_settings_reads_do_not_override_deployment_and_writes_survive(tmp_path):
    settings, token = settings_for(tmp_path)
    settings = settings.model_copy(update={"run_timeout_seconds": 210})
    headers = token('admin')
    path = '/api/v1/platform/settings'
    with TestClient(create_app(settings, connectors=connectors())) as client:
        assert client.get(path, headers=headers).json()['run_timeout_seconds'] == 210
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        current = client.get(path, headers=headers).json()
        assert current['run_timeout_seconds'] == 210
        payload = {key: current[key] for key in ('run_timeout_seconds', 'max_concurrent_runs', 'max_llm_calls', 'max_input_chars', 'max_context_chars', 'retention_days', 'mode')}
        payload.update(run_timeout_seconds=110, max_concurrent_runs=2)
        runner = app.state.runner
        client.portal.call(runner.run_limiter.acquire)
        assert client.put(path, headers=headers, json=payload).status_code == 409
        assert client.get(path, headers=headers).json()['run_timeout_seconds'] == 210
        client.portal.call(runner.run_limiter.release)
        assert client.put(path, headers=headers, json=payload).status_code == 200
        assert runner.settings.run_timeout_seconds == 110
        assert runner.run_limiter._value == 2
        assert client.put(path, headers=headers, json={**payload, 'mode': 'live'}).status_code == 409
        assert client.put(path, headers=headers, json={**payload, 'max_llm_calls': 0}).status_code == 422
    app = create_app(settings, connectors=connectors())
    with TestClient(app) as client:
        assert client.get(path, headers=headers).json()['run_timeout_seconds'] == 110
        assert app.state.runner.run_limiter._value == 2
