import hashlib
import tempfile
import unittest
from pathlib import Path

from sqlalchemy.ext.asyncio import create_async_engine

from app.capabilities.registry import CapabilityRegistry
from app.configuration.service import AgentConfigurationService
from app.identity.principals import Role, UserPrincipal


class Blob:
    def __init__(self):
        self.data = {}

    async def put(self, value):
        digest = "sha256:" + hashlib.sha256(value).hexdigest()
        self.data[digest] = value
        return digest

    async def get(self, digest):
        return self.data[digest]


def principal(subject, role=Role.PROJECT_OWNER):
    return UserPrincipal(
        subject=subject,
        username=subject,
        tenant_id="t1",
        project_id="p1",
        roles=(role,),
    )


class AgentConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        engine = create_async_engine(
            "sqlite+aiosqlite:///" + str(Path(self.tmp.name) / "config.db")
        )
        self.service = AgentConfigurationService(
            engine, Blob(), CapabilityRegistry(), {"balanced-investigation": {}}
        )
        await self.service.initialize()

    async def asyncTearDown(self):
        await self.service.engine.dispose()
        self.tmp.cleanup()

    def yaml(self, tools="[itsm.get_ticket]"):
        return f"""id: checkout_agent\nversion: 1.0.0\nname: Checkout\ndescription: Investigates checkout incidents\ninstruction: Read the evidence and summarize findings.\ncapability: incident_triage\nmodel_profile: balanced-investigation\ntools: {tools}\nstage_model: logs\n"""

    async def test_deployment_defined_stage_catalog(self):
        from app.models.profiles import ModelProfiles

        profiles = ModelProfiles.load()
        self.service.profiles = profiles.model_copy(
            update={
                "stages": {
                    **profiles.stages,
                    "custom_inspector": profiles.stages["logs"],
                }
            }
        )
        draft = await self.service.submit(
            self.yaml().replace("stage_model: logs", "stage_model: custom_inspector"),
            principal("author"),
        )
        self.assertEqual(draft.definition.stage_model, "custom_inspector")

    async def test_pending_self_approval_and_invalid_tool(self):
        draft = await self.service.submit(self.yaml(), principal("author"))
        with self.assertRaises(PermissionError):
            await self.service.approve(
                draft.draft_id,
                principal("author", Role.PLATFORM_ADMIN),
                draft.content_hash,
                "ok",
            )
        with self.assertRaises(ValueError):
            await self.service.submit(
                self.yaml("[database.query_readonly]"), principal("author")
            )

    async def test_approval_requires_hash_and_is_visible_only_after_approval(self):
        draft = await self.service.submit(self.yaml(), principal("author"))
        self.assertEqual(
            len(
                await self.service.approved(
                    principal("reviewer", Role.PLATFORM_ADMIN), "incident_triage"
                )
            ),
            0,
        )
        with self.assertRaises(ValueError):
            await self.service.approve(
                draft.draft_id,
                principal("reviewer", Role.PLATFORM_ADMIN),
                "sha256:bad",
                "ok",
            )
        approved = await self.service.approve(
            draft.draft_id,
            principal("reviewer", Role.PLATFORM_ADMIN),
            draft.content_hash,
            "reviewed",
        )
        self.assertEqual(approved.status, "APPROVED")
        self.assertEqual(
            len(
                await self.service.approved(
                    principal("reviewer", Role.PLATFORM_ADMIN), "incident_triage"
                )
            ),
            1,
        )

    async def test_duplicate_yaml_keys_are_rejected(self):
        with self.assertRaises(ValueError):
            await self.service.submit(self.yaml() + "id: forged\n", principal("author"))

    async def test_cross_tenant_admin_cannot_review_project_draft(self):
        draft = await self.service.submit(self.yaml(), principal("author"))
        foreign = principal("reviewer", Role.PLATFORM_ADMIN).model_copy(
            update={"tenant_id": "other"}
        )
        self.assertIsNone(
            await self.service.approve(
                draft.draft_id, foreign, draft.content_hash, "review"
            )
        )

    async def test_revoking_old_approved_version_keeps_new_active(self):
        author = principal("author")
        reviewer = principal("reviewer", Role.PLATFORM_ADMIN)
        first = await self.service.submit(self.yaml(), author)
        await self.service.approve(
            first.draft_id, reviewer, first.content_hash, "first"
        )
        second = await self.service.submit(
            self.yaml().replace("version: 1.0.0", "version: 1.0.1"), author
        )
        await self.service.approve(
            second.draft_id, reviewer, second.content_hash, "second"
        )
        await self.service.revoke(first.draft_id, reviewer, "superseded")
        active = await self.service.approved(reviewer, "incident_triage")
        self.assertEqual([item.draft_id for item in active], [second.draft_id])


if __name__ == "__main__":
    unittest.main()
