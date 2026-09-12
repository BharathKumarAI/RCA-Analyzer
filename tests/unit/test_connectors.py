"""Unit tests for scoped HTTP connectors; all requests use MockTransport."""

import asyncio
import unittest

import httpx2

from app.connectors.health import CheckStatus
from app.connectors.base import ConnectorError
from app.connectors.providers.jira import JiraConnector
from app.connectors.providers.splunk import SplunkConnector
from app.tools.catalog import ALLOWED_ACTIONS
from app.tools.domain.itsm import create_tools as create_itsm_tools


class ConnectorTests(unittest.TestCase):
    def test_jira_get_ticket_is_scoped_and_parsed(self):
        seen = {}

        async def handler(request):
            seen["path"] = request.url.path
            seen["auth"] = request.headers["authorization"]
            return httpx2.Response(
                200,
                json={
                    "key": "PAY-1",
                    "fields": {
                        "summary": "Outage",
                        "status": {"name": "Open"},
                        "created": "2026-01-01T00:00:00Z",
                        "description": "details",
                        "components": [{"name": "Checkout"}],
                    },
                },
            )

        async def run():
            client = httpx2.AsyncClient(
                base_url="http://jira.test", transport=httpx2.MockTransport(handler)
            )
            connector = JiraConnector(
                "http://jira.test",
                "PAY",
                "user@example.com",
                "secret",
                client=client,
                allow_insecure=True,
            )
            result = await connector.get_ticket("PAY-1")
            await connector.aclose()
            return result

        self.assertEqual(asyncio.run(run())["summary"], "Outage")
        self.assertEqual(
            seen,
            {
                "path": "/rest/api/2/issue/PAY-1",
                "auth": "Basic dXNlckBleGFtcGxlLmNvbTpzZWNyZXQ=",
            },
        )

    def test_jira_rejects_wrong_project_issue_key(self):
        async def run():
            client = httpx2.AsyncClient(
                base_url="http://jira.test",
                transport=httpx2.MockTransport(lambda request: httpx2.Response(200)),
            )
            connector = JiraConnector(
                "http://jira.test",
                "PAY",
                "user@example.com",
                "secret",
                client=client,
                allow_insecure=True,
            )
            with self.assertRaises(ConnectorError):
                await connector.get_ticket("OTHER-1")
            await connector.aclose()

        asyncio.run(run())

    def test_health_maps_auth_failure(self):
        async def handler(request):
            return httpx2.Response(401)

        async def run():
            client = httpx2.AsyncClient(
                base_url="http://jira.test", transport=httpx2.MockTransport(handler)
            )
            connector = JiraConnector(
                "http://jira.test",
                "PAY",
                "user@example.com",
                "secret",
                client=client,
                allow_insecure=True,
            )
            health = await connector.probe_health()
            await connector.aclose()
            return health

        health = asyncio.run(run())
        self.assertEqual(health.overall, CheckStatus.AUTHENTICATION_ERROR)

    def test_health_checks_scoped_jira_project(self):
        async def handler(request):
            self.assertEqual(request.url.path, "/rest/api/2/project/PAY")
            return httpx2.Response(200, json={"key": "PAY", "name": "Payments"})

        async def run():
            client = httpx2.AsyncClient(
                base_url="http://jira.test", transport=httpx2.MockTransport(handler)
            )
            connector = JiraConnector(
                "http://jira.test",
                "PAY",
                "user@example.com",
                "secret",
                client=client,
                allow_insecure=True,
            )
            health = await connector.probe_health()
            await connector.aclose()
            return health

        health = asyncio.run(run())
        self.assertEqual(health.overall, CheckStatus.HEALTHY)

    def test_splunk_injects_server_scoped_index(self):
        seen = {}

        async def handler(request):
            seen.update(dict(request.url.params))
            return httpx2.Response(200, content=b'{"result":{"_raw":"error"}}\n')

        async def run():
            client = httpx2.AsyncClient(
                base_url="http://splunk.test", transport=httpx2.MockTransport(handler)
            )
            connector = SplunkConnector(
                "http://splunk.test",
                "secret",
                index="prod_logs",
                client=client,
                allow_insecure=True,
            )
            result = await connector.query_logs("status=500", "-15m")
            await connector.aclose()
            return result

        self.assertEqual(asyncio.run(run()), [{"_raw": "error"}])
        self.assertIn("index=prod_logs", seen["search"])
        self.assertNotIn("index=other", seen["search"])

    def test_splunk_rejects_index_override(self):
        async def run():
            client = httpx2.AsyncClient(
                base_url="http://splunk.test",
                transport=httpx2.MockTransport(lambda request: httpx2.Response(200)),
            )
            connector = SplunkConnector(
                "http://splunk.test",
                "secret",
                index="prod_logs",
                client=client,
                allow_insecure=True,
            )
            with self.assertRaises(ValueError):
                await connector.query_logs("index=other status=500", "-15m")
            await connector.aclose()

        asyncio.run(run())

    def test_splunk_rejects_unbounded_window_and_oversized_body(self):
        async def oversized(request):
            return httpx2.Response(
                200, content=b'{"result":{}}\n' + b"x" * (1_048_576 + 1)
            )

        async def run():
            client = httpx2.AsyncClient(
                base_url="http://splunk.test", transport=httpx2.MockTransport(oversized)
            )
            connector = SplunkConnector(
                "http://splunk.test",
                "secret",
                index="prod_logs",
                client=client,
                allow_insecure=True,
            )
            with self.assertRaises(ValueError):
                await connector.query_logs("ERROR", "-2d1h")
            with self.assertRaises(ConnectorError):
                await connector.query_logs("ERROR", "-15m")
            await connector.aclose()

        asyncio.run(run())

    def test_missing_credentials_and_insecure_urls_are_rejected(self):
        with self.assertRaises(ValueError):
            JiraConnector("https://jira.test")
        with self.assertRaises(ValueError):
            JiraConnector("http://jira.test", "PAY", "user@example.com", "secret")
        with self.assertRaises(ValueError):
            SplunkConnector("https://splunk.test", "secret")

    def test_writes_and_database_queries_are_denied(self):
        async def run():
            client = httpx2.AsyncClient(
                base_url="http://jira.test",
                transport=httpx2.MockTransport(lambda request: httpx2.Response(200)),
            )
            connector = JiraConnector(
                "http://jira.test",
                "PAY",
                "user@example.com",
                "secret",
                client=client,
                allow_insecure=True,
            )
            tools = create_itsm_tools(connector)
            self.assertEqual(set(tools), {"get_ticket"})
            await connector.aclose()

        asyncio.run(run())
        self.assertNotIn("database.query_readonly", ALLOWED_ACTIONS)
        self.assertNotIn("itsm.add_comment", ALLOWED_ACTIONS)
        self.assertTrue({"itsm.get_ticket", "log_search.query_range"} <= ALLOWED_ACTIONS)


if __name__ == "__main__":
    unittest.main()
