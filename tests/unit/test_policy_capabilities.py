import unittest
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from pydantic import ValidationError

from app.capabilities.registry import CapabilityRegistry
from app.capabilities.resolver import CapabilityResolver
from app.identity.principals import Role, UserPrincipal
from app.policy.abac import AuthorizationContext
from app.policy.engine import PolicyDecisionType, PolicyEngine


def principal(tenant="t1", project="p1", roles=None):
    return UserPrincipal(
        subject="s1",
        username="u1",
        tenant_id=tenant,
        project_id=project,
        roles=roles or [Role.PROJECT_ANALYST],
    )


class PolicyCapabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = CapabilityRegistry()

    def test_manifest_permissions_and_hash_are_loaded(self):
        cap = self.registry.get("incident_triage")
        self.assertEqual(
            cap.allowed_roles,
            (
                Role.PLATFORM_ADMIN,
                Role.PROJECT_OWNER,
                Role.PROJECT_ANALYST,
                Role.PROJECT_MANAGER,
                Role.PROJECT_VIEWER,
            ),
        )
        self.assertTrue(self.registry.content_hash.startswith("sha256:"))
        with self.assertRaises(ValidationError):
            cap.skills += ("another",)

    def test_disabled_capability_is_denied(self):
        result = CapabilityResolver(self.registry).resolve("database_rca", principal())
        self.assertFalse(result.is_authorized)
        self.assertIn("disabled", result.rejection_reason)

    def test_allowlist_and_connector_health_are_fail_closed(self):
        resolver = CapabilityResolver(self.registry, {"itsm": {"overall": "HEALTHY"}})
        self.assertTrue(resolver.resolve("incident_triage", principal()).is_authorized)
        self.assertFalse(
            CapabilityResolver(self.registry)
            .resolve("incident_triage", principal())
            .is_authorized
        )
        self.assertTrue(
            resolver.resolve(
                "incident_triage", principal(roles=[Role.PROJECT_MANAGER])
            ).is_authorized
        )

    def test_policy_checks_tenant_project_and_action(self):
        ctx = AuthorizationContext(
            principal=principal(),
            tenant_id="t2",
            project_id="p1",
            capability_id="incident_triage",
            action="itsm.get_ticket",
            resource_type="ticket",
            resource_id="T-1",
            environment="QLAB01",
            attributes={"allowed_actions": ["itsm.get_ticket"]},
        )
        self.assertEqual(PolicyEngine().evaluate(ctx).decision, PolicyDecisionType.DENY)
        ctx.tenant_id = "t1"
        ctx.attributes["allowed_actions"] = []
        self.assertEqual(PolicyEngine().evaluate(ctx).decision, PolicyDecisionType.DENY)

    def test_mutations_are_denied(self):
        ctx = AuthorizationContext(
            principal=principal(),
            tenant_id="t1",
            project_id="p1",
            capability_id="incident_triage",
            action="itsm.add_comment",
            resource_type="ticket",
            resource_id="T-1",
            environment="QLAB01",
            is_mutation=True,
            attributes={"allowed_actions": ["itsm.add_comment"]},
        )
        self.assertEqual(PolicyEngine().evaluate(ctx).decision, PolicyDecisionType.DENY)

    def test_registry_default_is_independent_of_cwd_and_skill_bytes_are_hashed(self):
        original = os.getcwd()
        try:
            os.chdir(Path(__file__).resolve().parents[2] / "tests")
            self.assertEqual(
                CapabilityRegistry().content_hash, self.registry.content_hash
            )
        finally:
            os.chdir(original)

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "capabilities").mkdir()
            (root / "skills" / "x").mkdir(parents=True)
            (root / "skills" / "x" / "SKILL.md").write_text("one", encoding="utf-8")
            (root / "capabilities" / "x.yaml").write_text(
                "id: x\nversion: '1'\nname: x\ndescription: x\ncategory: x\nskills: [x]\n",
                encoding="utf-8",
            )
            first = CapabilityRegistry(str(root / "capabilities")).content_hash
            (root / "skills" / "x" / "SKILL.md").write_text("two", encoding="utf-8")
            self.assertNotEqual(
                first, CapabilityRegistry(str(root / "capabilities")).content_hash
            )


if __name__ == "__main__":
    unittest.main()
