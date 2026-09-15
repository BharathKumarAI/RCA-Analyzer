"""Unit tests for scoped HTTP connectors; all requests use MockTransport."""

import asyncio
import json
import unittest

import httpx2

from app.connectors.health import CheckStatus
from app.connectors.base import ConnectorError
from app.connectors.providers.jira import JiraConnector, adf_to_text
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
                "path": "/rest/api/3/issue/PAY-1",
                "auth": "Basic dXNlckBleGFtcGxlLmNvbTpzZWNyZXQ=",
            },
        )

    def test_jira_adf_description_and_comments_parsing(self):
        adf_doc = {
            "version": 1,
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "Database connection pool exhausted during peak load."}
                    ],
                }
            ],
        }

        async def handler(request):
            return httpx2.Response(
                200,
                json={
                    "key": "PAY-100",
                    "fields": {
                        "summary": "High Latency Incident",
                        "status": {"name": "Investigating"},
                        "description": adf_doc,
                        "comment": {
                            "comments": [
                                {
                                    "id": "1001",
                                    "author": {"displayName": "SRE Engineer"},
                                    "created": "2026-01-01T12:00:00Z",
                                    "body": {
                                        "version": 1,
                                        "type": "doc",
                                        "content": [
                                            {
                                                "type": "paragraph",
                                                "content": [{"type": "text", "text": "Scaled pods up to 20."}],
                                            }
                                        ],
                                    },
                                }
                            ]
                        },
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
            result = await connector.get_ticket("PAY-100")
            await connector.aclose()
            return result

        ticket = asyncio.run(run())
        self.assertIn("Database connection pool exhausted", ticket["description"])
        self.assertEqual(len(ticket["comments"]), 1)
        self.assertIn("Scaled pods up to 20", ticket["comments"][0]["body"])

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
            self.assertEqual(request.url.path, "/rest/api/3/project/PAY")
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

    def test_jira_strictly_read_only_contract(self):
        self.assertFalse(hasattr(JiraConnector, "create_issue"))
        self.assertFalse(hasattr(JiraConnector, "update_issue"))
        self.assertFalse(hasattr(JiraConnector, "delete_issue"))
        import app.connectors.providers.jira as jira_mod
        self.assertFalse(hasattr(jira_mod, "text_to_adf"))

    def test_adf_budgeted_parsing(self):
        # Character budget cap
        deep_doc = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "A" * 200}]}
            ],
        }
        res = adf_to_text(deep_doc, max_chars=50)
        self.assertLessEqual(len(res), 50)

        # Node budget cap
        many_nodes_doc = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": f"item {i}"}]}
                for i in range(100)
            ],
        }
        res_nodes = adf_to_text(many_nodes_doc, max_nodes=5)
        self.assertIn("item 0", res_nodes)
        self.assertNotIn("item 50", res_nodes)

    def test_adf_table_and_media_handling(self):
        doc = {
            "type": "doc",
            "content": [
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableHeader", "content": [{"type": "text", "text": "Col 1"}]},
                                {"type": "tableHeader", "content": [{"type": "text", "text": "Col 2"}]},
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "content": [{"type": "text", "text": "Val 1"}]},
                                {"type": "tableCell", "content": [{"type": "text", "text": "Val 2"}]},
                            ],
                        },
                    ],
                },
                {
                    "type": "mediaSingle",
                    "attrs": {"alt": "stacktrace screenshot"},
                },
            ],
        }
        parsed = adf_to_text(doc)
        self.assertIn("| Col 1 | Col 2 |", parsed)
        self.assertIn("| Val 1 | Val 2 |", parsed)
        self.assertIn("[Attachment: stacktrace screenshot]", parsed)

    def test_jira_search_issues_cursor_pagination_and_cycle_detection(self):
        page_calls = []

        async def handler(request):
            body = json.loads(request.content.decode("utf-8"))
            page_calls.append(body)
            # Cycle token simulation on page 2
            if body.get("nextPageToken") == "page2_token":
                return httpx2.Response(
                    200,
                    json={
                        "issues": [{"key": "PAY-2", "fields": {"summary": "Issue 2"}}],
                        "nextPageToken": "page2_token",  # cycle!
                    },
                )
            return httpx2.Response(
                200,
                json={
                    "issues": [{"key": "PAY-1", "fields": {"summary": "Issue 1"}}],
                    "nextPageToken": "page2_token",
                },
            )

        async def run():
            client = httpx2.AsyncClient(
                base_url="http://jira.test",
                transport=httpx2.MockTransport(handler),
            )
            connector = JiraConnector(
                "http://jira.test",
                "PAY",
                "user@example.com",
                "secret",
                client=client,
                allow_insecure=True,
            )
            with self.assertRaises(ConnectorError) as ctx:
                await connector.search_issues("status = Open", max_results=50)
            self.assertIn("Pagination cycle detected", str(ctx.exception))
            await connector.aclose()

        asyncio.run(run())
        self.assertEqual(len(page_calls), 2)
        # Verify server-side JQL scoping was applied
        self.assertIn('project = "PAY"', page_calls[0]["jql"])


if __name__ == "__main__":
    unittest.main()
