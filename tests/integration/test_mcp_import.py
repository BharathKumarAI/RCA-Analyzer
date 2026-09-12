"""JSON/command import, persisted registrations and real MCP process initialization."""

import json
import sys

import pytest
from fastapi.testclient import TestClient

from app.api.application import create_app
from app.configuration.integrations import IntegrationDefinition
from app.configuration.mcp_import import parse_mcp_json, parse_mcp_command
from app.connectors.providers.integration_probe import probe_integration
from tests.support import settings_for


def test_json_and_command_produce_the_same_connection():
    source = json.dumps({"mcpServers": {"mcp-server": {"command": sys.executable, "args": ["-m", "mcp"]}}})
    parsed = parse_mcp_json(source)
    command = parse_mcp_command(f'"{sys.executable}" -m mcp')
    assert parsed == command
    assert parsed[0]["definition"]["transport"] == "stdio"
    assert parse_mcp_command('server " padded argument "')[0]["definition"]["args"] == [" padded argument "]


@pytest.mark.parametrize("reference", ["${MCP_TOKEN}", "${env:MCP_TOKEN}", "env://MCP_TOKEN"])
def test_remote_headers_are_converted_to_references(reference):
    source = json.dumps({"mcpServers": {"knowledge": {"url": "https://service.example.test/mcp", "headers": {"Authorization": f"Bearer {reference}"}}}})
    definition = parse_mcp_json(source)[0]["definition"]
    assert definition["secret_reference"] == "env://MCP_TOKEN"
    assert definition["transport"] == "streamable_http"


@pytest.mark.parametrize("source", [
    '{"mcpServers":{},"mcpServers":{}}',
    '{"command":"python","args":"-m mcp"}',
    '{"command":"python","env":{"TOKEN":"do-not-echo-this"}}',
    '{"url":"https://host.test","headers":{"Authorization":"Bearer do-not-echo-this"}}',
    '{"url":"https://host.test","type":[]}',
    '{"url":"http://host.test/mcp"}',
    '{"command":"python","url":"https://host.test/mcp"}',
])
def test_invalid_import_is_rejected_without_echoing_secrets(source):
    with pytest.raises(ValueError) as error:
        parse_mcp_json(source)
    assert "do-not-echo-this" not in str(error.value)


def test_preview_then_existing_save_persists_stdio_connection(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings)) as client:
        body = json.dumps({"mcpServers": {"local-reader": {"command": sys.executable, "args": ["-m", "mcp"], "env": {"TOKEN": "${env:MCP_TOKEN}"}}}})
        assert client.post('/api/v1/integrations/mcp/preview', content=body).status_code == 401
        assert client.post('/api/v1/integrations/mcp/preview', headers=token('analyst'), content=body).status_code == 403
        response = client.post('/api/v1/integrations/mcp/preview', headers=token('owner'), content=body)
        assert response.status_code == 200
        connection = response.json()['connections'][0]
        assert client.get('/api/v1/integrations', headers=token('owner')).json() == []
        saved = client.put('/api/v1/integrations/project/local-reader', headers=token('owner'), json={'definition': connection['definition']})
        assert saved.status_code == 200
        assert saved.json()[0]['definition']['env'] == {'TOKEN': 'env://MCP_TOKEN'}
        test = client.post('/api/v1/integrations/local-reader/test', headers=token('owner'))
        assert test.json()['status'] == 'blocked'
        too_large = client.post('/api/v1/integrations/mcp/preview', headers=token('owner'), content=' ' * 65537)
        assert too_large.status_code == 413


@pytest.mark.asyncio
async def test_approved_stdio_process_completes_real_mcp_handshake(tmp_path):
    server = tmp_path / 'mcp_reader.py'
    server.write_text('from mcp.server.fastmcp import FastMCP\nFastMCP("repository-reader").run(transport="stdio")\n')
    profile = {'command': sys.executable, 'args': [str(server)], 'env': {}}
    settings, _ = settings_for(tmp_path)
    definition = IntegrationDefinition(name='Repository reader', kind='mcp', transport='stdio', **profile)
    denied = await probe_integration(definition, settings)
    assert denied['status'] == 'blocked'
    settings = settings.model_copy(update={'mcp_stdio_allowlist': json.dumps([profile])})
    result = await probe_integration(definition, settings)
    assert result['status'] == 'reachable'
    changed = definition.model_copy(update={'args': (*definition.args, '--unexpected')})
    assert (await probe_integration(changed, settings))['status'] == 'blocked'
