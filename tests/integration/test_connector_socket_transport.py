"""Native providers over real TLS sockets against explicitly local mock servers."""

import ssl

import httpx2
import pytest

from app.connectors.health import CheckStatus
from app.connectors.base import ConnectorError
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector
from scripts.dev_connector_servers import ConnectorMockServer


@pytest.mark.asyncio
async def test_native_jira_and_splunk_use_real_tls_auth_scope_and_failures(tmp_path):
    with ConnectorMockServer(tmp_path) as server:
        trust = ssl.create_default_context(cafile=str(server.cert_path))
        jira = JiraConnector(base_url=server.endpoint, project_key="LOCAL", user_email=server.account, api_token=server.token,
            custom_field_mapping={"customfield_10290": "Support Queue", "customfield_999": "Unassigned Field"},
            client=httpx2.AsyncClient(base_url=server.endpoint, verify=trust, trust_env=False))
        splunk = SplunkConnector(endpoint=server.endpoint, token=server.token, index="local_test",
            client=httpx2.AsyncClient(base_url=server.endpoint, verify=trust, trust_env=False))
        try:
            assert (await jira.probe_health()).overall == CheckStatus.HEALTHY
            assert (await splunk.probe_health()).overall == CheckStatus.HEALTHY
            ticket = await jira.get_ticket("LOCAL-1")
            assert ticket["custom_fields"] == {"customfield_10290": "Local queue"}
            assert ticket["mapped_custom_fields"] == {"Support Queue": "Local queue"}
            assert ticket["unavailable_mapped_fields"] == ["customfield_999"]
            assert await jira.discover_fields() == [{"id": "customfield_10290", "name": "Support Queue"}]
            rows = await splunk.query_logs("ERROR", "-15m")
            assert rows[0]["source"] == "local-mock"
            before = len(server.requests)
            with pytest.raises(ConnectorError):
                await jira.get_ticket("OTHER-1")
            assert len(server.requests) == before
            server.forced_status = 403
            assert (await jira.probe_health()).overall == CheckStatus.AUTHORIZATION_ERROR
            with pytest.raises(ConnectorError, match="project access"):
                await jira.discover_fields()
            server.forced_status = 429
            assert (await splunk.probe_health()).overall == CheckStatus.RATE_LIMITED
            server.forced_status = None
            splunk._client.headers["Authorization"] = "Bearer incorrect-test-credential"
            assert (await splunk.probe_health()).overall == CheckStatus.AUTHENTICATION_ERROR
        finally:
            await jira.aclose()
            await splunk.aclose()
