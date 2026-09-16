import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import update

from app.api.routes.runs import _stream_run, run_trace, run_trace_events
from app.identity.principals import Role, UserPrincipal
from app.persistence.run_events import RunEventStore
from app.persistence.store import InvestigationStore, runs
from app.runtime.run_contract import RunContract, RunRequest


def contract(principal):
    return RunContract(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        principal=principal,
        request=RunRequest(text="investigate"),
        capability="incident_triage",
        capability_version="1",
        capability_hash="sha256:cap",
        policy_hash="sha256:pol",
        model_profile="test",
        model_config_json=json.dumps({"resolved_graph": {"nodes": ["triage"]}}),
        data_scope=f"tenant:{principal.tenant_id}/project:{principal.project_id}",
        mode="demo",
    )


async def _false():
    return False


class RunEventStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = InvestigationStore(
            f"sqlite+aiosqlite:///{Path(self.tmp.name) / 'runs.db'}"
        )
        await self.store.initialize()
        self.events = RunEventStore(self.store.engine)
        await self.events.initialize()
        self.principal = UserPrincipal(
            subject="s1",
            username="user",
            tenant_id="t1",
            project_id="p1",
            roles=(Role.PROJECT_ANALYST,),
        )
        self.run, _ = await self.store.create_run(
            contract(self.principal), None, "request", 9999999999
        )

    async def asyncTearDown(self):
        await self.store.aclose()
        self.tmp.cleanup()

    async def test_redacts_details_and_scopes_reads(self):
        event = await self.events.append(
            self.run.run_id,
            self.principal,
            "triage",
            "tool",
            {"token": "secret-value", "message": "owner@example.com"},
        )
        self.assertEqual(event["sequence"], 1)
        self.assertEqual(event["details"]["token"], "[REDACTED]")
        self.assertEqual(event["details"]["message"], "[EMAIL]")
        self.assertEqual(
            await self.events.list(
                self.run.run_id,
                self.principal.model_copy(update={"project_id": "other"}),
            ),
            [],
        )

    async def test_sequence_is_monotonic_and_bounded(self):
        with patch("app.persistence.run_events.MAX_EVENTS_PER_RUN", 2):
            for index in range(3):
                await self.events.append(
                    self.run.run_id, self.principal, "node", "progress", {"i": index}
                )
        events = await self.events.list(self.run.run_id, self.principal)
        self.assertEqual([event["sequence"] for event in events], [2, 3])
        self.assertEqual(events[0]["details"], {"i": 1})

    async def test_parallel_appends_use_distinct_sequences(self):
        records = await asyncio.gather(
            *(
                self.events.append(
                    self.run.run_id, self.principal, "node", "progress", {"i": i}
                )
                for i in range(32)
            )
        )
        self.assertEqual(
            sorted(record["sequence"] for record in records), list(range(1, 33))
        )
        self.assertFalse(self.events._run_locks)

    async def test_rejects_unknown_run(self):
        with self.assertRaises(PermissionError):
            await self.events.append(
                "run_missing", self.principal, "node", "progress", {}
            )

    async def test_retention_removes_trace_children_with_runs(self):
        await self.events.append(
            self.run.run_id, self.principal, "node", "progress", {"ok": True}
        )
        await self.store.update_run(
            self.run.run_id, self.principal, status="SUCCEEDED", stage="completed"
        )
        async with self.store.engine.begin() as connection:
            await connection.execute(
                update(runs)
                .where(runs.c.run_id == self.run.run_id)
                .values(updated_at=0)
            )
        self.assertEqual(await self.store.delete_expired(0), 1)
        self.assertEqual(await self.events.list(self.run.run_id, self.principal), [])

    async def test_trace_endpoint_and_stream_replay_persisted_events(self):
        state = SimpleNamespace(
            store=self.store,
            run_events=self.events,
            settings=SimpleNamespace(progress_poll_seconds=0.01),
        )
        request = SimpleNamespace(app=SimpleNamespace(state=state))

        trace = await run_trace(self.run.run_id, request, self.principal)
        self.assertEqual(trace["graph"], {"nodes": ["triage"]})
        self.assertEqual(trace["events"], [])

        await self.events.append(
            self.run.run_id, self.principal, "triage", "started", {"ok": True}
        )
        await self.store.update_run(
            self.run.run_id, self.principal, status="SUCCEEDED", stage="completed"
        )
        request.is_disconnected = lambda: _false()
        response = await run_trace_events(self.run.run_id, request, self.principal)
        body = "".join([chunk async for chunk in response.body_iterator])
        self.assertIn("event: trace", body)
        self.assertIn('"sequence":1', body)

    async def test_stream_emits_run_progress_trace_and_complete(self):
        from app.api.schemas import RunExecutionRequest
        state = SimpleNamespace(
            store=self.store,
            run_events=self.events,
            settings=SimpleNamespace(progress_poll_seconds=0.01),
        )
        request = SimpleNamespace(app=SimpleNamespace(state=state))

        class Runner:
            async def execute(self, principal, request, capability, key, *, on_created):
                await on_created(self_response)
                await self.events.append(
                    self_response.run_id,
                    principal,
                    "triage",
                    "started",
                    {"state": "ready"},
                )
                return await state.store.update_run(
                    self_response.run_id,
                    principal,
                    status="SUCCEEDED",
                    stage="completed",
                )

        self_response = self.run
        Runner.events = self.events
        state.runner = Runner()
        response = await _stream_run(
            request,
            self.principal,
            RunExecutionRequest(
                prompt="Investigate",
                chat_id=None,
                incident_id=None,
                attachment_ids=[],
                capability="incident_triage",
            ),
            None,
        )
        body = "".join([chunk async for chunk in response.body_iterator])
        self.assertIn("event: run", body)
        self.assertIn("event: progress", body)
        self.assertIn("event: trace", body)
        self.assertIn("event: complete", body)

    async def test_stream_waits_for_terminal_cleanup_events(self):
        from app.api.schemas import RunExecutionRequest

        state = SimpleNamespace(store=self.store, run_events=self.events,
                                settings=SimpleNamespace(progress_poll_seconds=0.001))
        request = SimpleNamespace(app=SimpleNamespace(state=state))
        cleanup_finished = asyncio.Event()
        release_cleanup = asyncio.Event()
        response_id = self.run.run_id

        class Runner:
            async def execute(self, principal, request, capability, key, *, on_created):
                await on_created(response_id)
                result = await state.store.update_run(response_id, principal, status="CANCELLED")
                # Keep cleanup pending while the stream observes the terminal row.
                asyncio.get_running_loop().call_later(0.03, release_cleanup.set)
                await release_cleanup.wait()
                await state.run_events.append(response_id, principal, "tool", "tool_cancelled", {})
                cleanup_finished.set()
                return result

        state.runner = Runner()
        response = await _stream_run(request, self.principal, RunExecutionRequest(prompt="Investigate"), None)
        body = "".join([chunk async for chunk in response.body_iterator])
        self.assertTrue(cleanup_finished.is_set())
        self.assertIn('"kind":"tool_cancelled"', body)
        self.assertLess(body.index('"kind":"tool_cancelled"'), body.index("event: complete"))

    async def test_active_replay_polls_at_configured_interval(self):
        from app.api.schemas import RunExecutionRequest

        state = SimpleNamespace(store=self.store, run_events=self.events,
                                settings=SimpleNamespace(progress_poll_seconds=0.01))
        request = SimpleNamespace(app=SimpleNamespace(state=state))
        response_id = self.run.run_id

        class Runner:
            async def execute(self, principal, request, capability, key, *, on_created):
                existing = await state.store.get_run(response_id, principal)
                await on_created(existing)
                return existing

        async def advance_run(delay):
            self.assertEqual(delay, state.settings.progress_poll_seconds)
            await state.store.update_run(response_id, self.principal, status="SUCCEEDED")

        state.runner = Runner()
        response = await _stream_run(request, self.principal, RunExecutionRequest(prompt="Investigate"), "existing")
        with patch("app.api.routes.runs.asyncio.sleep", side_effect=advance_run) as sleep:
            body = "".join([chunk async for chunk in response.body_iterator])
        self.assertTrue(sleep.called)
        self.assertIn("event: complete", body)


if __name__ == "__main__":
    unittest.main()
