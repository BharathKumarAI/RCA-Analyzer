import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from sqlalchemy import select, update

from app.persistence.store import InvestigationStore, attachments
from app.identity.principals import Role, UserPrincipal
from app.runtime.run_contract import RunContract, RunRequest


def make_contract(principal):
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
        model_config_json="{}",
        data_scope=f"tenant:{principal.tenant_id}/project:{principal.project_id}",
        mode="demo",
    )


class StoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = InvestigationStore(
            f"sqlite+aiosqlite:///{Path(self.tmp.name) / 'runs.db'}"
        )
        await self.store.initialize()
        self.principal = UserPrincipal(
            subject="s1",
            username="u",
            tenant_id="t1",
            project_id="p1",
            roles=(Role.PROJECT_ANALYST,),
        )

    async def asyncTearDown(self):
        await self.store.aclose()
        self.tmp.cleanup()

    async def test_idempotency_and_scope(self):
        contract = make_contract(self.principal)
        first, created = await self.store.create_run(
            contract, "key", "request-a", 9999999999
        )
        again, created_again = await self.store.create_run(
            contract.model_copy(update={"run_id": "run_other"}),
            "key",
            "request-a",
            9999999999,
        )
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first.run_id, again.run_id)
        with self.assertRaises(ValueError):
            await self.store.create_run(
                contract.model_copy(update={"run_id": "run_third"}),
                "key",
                "request-b",
                9999999999,
            )
        self.assertIsNone(
            await self.store.get_run(
                first.run_id, self.principal.model_copy(update={"project_id": "other"})
            )
        )

    async def test_expiry_cannot_be_overwritten(self):
        contract = make_contract(self.principal)
        response, _ = await self.store.create_run(contract, None, "request", 1)
        await asyncio.sleep(0.01)
        expired = await self.store.get_run(response.run_id, self.principal)
        self.assertEqual(expired.status, "FAILED")
        unchanged = await self.store.update_run(
            response.run_id, self.principal, status="CANCELLED"
        )
        self.assertEqual(unchanged.status, "FAILED")

    async def test_attachment_isolation_and_expiry(self):
        aid = await self.store.save_attachment(
            {
                "filename": "a.txt",
                "media_type": "text/plain",
                "text": "safe",
                "sha256": "x",
            },
            self.principal,
            ttl_seconds=1,
        )
        self.assertEqual(
            (await self.store.get_attachments([aid], self.principal))[0]["filename"],
            "a.txt",
        )
        other = self.principal.model_copy(update={"subject": "s2"})
        with self.assertRaises(PermissionError):
            await self.store.get_attachments([aid], other)

    async def test_attachment_blob_restart_integrity_and_cleanup(self):
        payload = {"filename": "a.txt", "sha256": "x", "text": "blob-only content"}
        aid = await self.store.save_attachment(payload, self.principal)
        async with self.store.engine.connect() as connection:
            stored = json.loads(
                await connection.scalar(select(attachments.c.payload_json))
            )
        self.assertNotIn("text", stored)
        self.assertNotIn(payload["text"], json.dumps(stored))
        reopened = InvestigationStore(str(self.store.engine.url))
        try:
            self.assertEqual(
                (await reopened.get_attachments([aid], self.principal))[0]["text"],
                payload["text"],
            )
        finally:
            await reopened.aclose()
        blobs = self.store._attachment_blobs(aid, stored, ("t1", "p1"))
        path = next(blobs._root.glob("*.json"))
        path.write_text("tampered")
        with self.assertRaisesRegex(ValueError, "integrity"):
            await self.store.get_attachments([aid], self.principal)
        async with self.store.engine.begin() as connection:
            await connection.execute(update(attachments).values(expires_at=0))
        with patch.object(
            self.store, "_attachment_blobs", side_effect=OSError("unavailable")
        ):
            with self.assertRaises(OSError):
                await self.store.delete_expired(86400)
        async with self.store.engine.connect() as connection:
            self.assertEqual(
                await connection.scalar(select(attachments.c.attachment_id)), aid
            )
        self.assertEqual(await self.store.delete_expired(86400), 1)
        self.assertFalse(path.exists())

    async def test_in_memory_attachment_blobs_are_removed_on_close(self):
        store = InvestigationStore("sqlite+aiosqlite:///:memory:")
        try:
            await store.initialize()
            aid = await store.save_attachment(
                {"filename": "a.txt", "sha256": "x", "text": "content"}, self.principal
            )
            self.assertEqual(
                (await store.get_attachments([aid], self.principal))[0]["text"],
                "content",
            )
            root = Path(store._temporary_attachment_root.name)
            self.assertTrue(root.exists())
        finally:
            await store.aclose()
        self.assertFalse(root.exists())

    async def test_listing_batches_expired_runs_without_per_row_reads(self):
        from sqlalchemy import event
        from app.persistence.store import runs

        contracts = [make_contract(self.principal) for _ in range(4)]
        for contract in contracts:
            await self.store.create_run(contract, None, "request", 9999999999)
        statements = []

        def capture(connection, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(self.store.engine.sync_engine, "before_cursor_execute", capture)
        try:
            listed = await self.store.list_runs(self.principal)
            self.assertEqual(len(listed), 4)
            self.assertEqual(len(statements), 1)
            async with self.store.engine.begin() as connection:
                await connection.execute(
                    update(runs)
                    .where(runs.c.run_id.in_([c.run_id for c in contracts[:2]]))
                    .values(deadline=0)
                )
            statements.clear()
            listed = await self.store.list_runs(self.principal)
            self.assertEqual(sum(run.status == "FAILED" for run in listed), 2)
            self.assertEqual(len(statements), 3)
            self.assertEqual(
                await self.store.list_runs(
                    self.principal.model_copy(update={"project_id": "other"})
                ),
                [],
            )
        finally:
            event.remove(
                self.store.engine.sync_engine, "before_cursor_execute", capture
            )


if __name__ == "__main__":
    unittest.main()
