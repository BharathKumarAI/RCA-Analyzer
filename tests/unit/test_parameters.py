import pytest
from pydantic import ValidationError
from sqlalchemy import insert, select

from app.configuration.database_bundle import validate_files
from app.configuration.parameters import (
    ParameterConflict,
    ParameterDefinition,
    ParameterOverride,
    ParameterStore,
    audit,
    projects,
    validate_value,
)
from app.connectors.providers.secrets import environment_secret
from app.identity.principals import Role, UserPrincipal
from app.persistence.store import InvestigationStore


@pytest.mark.parametrize(
    "kind,value",
    [
        ("integer", True),
        ("boolean", 1),
        ("number", float("nan")),
        ("number", float("inf")),
        ("string", 10),
        ("json", None),
        ("json", {"nested": object()}),
        ("secret_ref", "actual-secret"),
        ("secret_ref", "env://"),
    ],
)
def test_invalid_parameter_types(kind, value):
    with pytest.raises(ValueError):
        validate_value(kind, value)


def test_large_json_integer_does_not_require_float_conversion():
    validate_value("integer", 10**400)


def test_secret_reference_resolution_and_safe_bundle_paths(monkeypatch):
    monkeypatch.setenv("TEST_CONNECTOR_TOKEN", "test-value")
    assert environment_secret("env://TEST_CONNECTOR_TOKEN") == "test-value"
    with pytest.raises(ValueError):
        environment_secret("env://DOES_NOT_EXIST")
    for path in (
        "../evil.yaml",
        "config/../../evil.yaml",
        "/config/a.yaml",
        "config/x.py",
        "config//a.yaml",
        "config/./a.yaml",
        "",
        123,
    ):
        with pytest.raises(ValueError):
            validate_files({path: "data"})
    with pytest.raises(ValidationError):
        ParameterDefinition(
            value_type="integer", default_value=1, description="test", tenant_id="other"
        )


@pytest.mark.asyncio
async def test_store_revalidates_copied_definitions_and_guards_secret_reset():
    database = InvestigationStore("sqlite+aiosqlite:///:memory:")
    store = ParameterStore(database.engine)
    await store.initialize()
    admin = UserPrincipal(
        subject="admin",
        username="admin",
        tenant_id="acme",
        project_id="p1",
        roles=(Role.PLATFORM_ADMIN,),
    )
    owner = admin.model_copy(update={"roles": (Role.PROJECT_OWNER,)})
    try:
        async with store.engine.begin() as c:
            await c.execute(
                insert(projects).values(
                    tenant_id="acme", project_id="p1", project_name="First"
                )
            )
        definition = ParameterDefinition(
            value_type="integer", default_value=4, description="Capacity"
        )
        with pytest.raises(ValueError):
            await store.define(
                admin,
                "custom",
                "capacity",
                definition.model_copy(update={"default_value": "not-an-integer"}),
            )
        with pytest.raises(ValueError):
            await store.define(
                admin,
                "runtime",
                "max_concurrent_runs",
                ParameterDefinition(
                    value_type="string", default_value="4", description="Capacity"
                ),
            )
        assert await store.resolve("acme", "p1") == []
        await store.define(
            admin,
            "jira",
            "api_token",
            ParameterDefinition(
                value_type="secret_ref",
                default_value="env://DEFAULT_TOKEN",
                description="Token reference",
                allow_project_override=True,
            ),
        )
        await store.set_override(
            admin,
            "jira",
            "api_token",
            ParameterOverride(
                value="env://PROJECT_TOKEN",
                expected_revision=0,
                expected_definition_revision=1,
            ),
        )
        with pytest.raises(PermissionError):
            await store.reset_override(owner, "jira", "api_token", 1)
        assert (await store.resolve("acme", "p1"))[0][
            "effective_value"
        ] == "env://PROJECT_TOKEN"
        await store.reset_override(admin, "jira", "api_token", 1)
        assert (await store.resolve("acme", "p1"))[0][
            "effective_value"
        ] == "env://DEFAULT_TOKEN"
    finally:
        await database.aclose()


@pytest.mark.asyncio
async def test_parameter_governance_inheritance_and_revisions():
    database = InvestigationStore("sqlite+aiosqlite:///:memory:")
    store = ParameterStore(database.engine)
    await store.initialize()
    admin = UserPrincipal(
        subject="admin",
        username="admin",
        tenant_id="acme",
        project_id="p1",
        roles=(Role.PLATFORM_ADMIN,),
    )
    owner = admin.model_copy(
        update={"subject": "owner", "roles": (Role.PROJECT_OWNER,)}
    )
    viewer = owner.model_copy(update={"roles": (Role.PROJECT_VIEWER,)})
    async with store.engine.begin() as c:
        await c.execute(
            insert(projects).values(
                tenant_id="acme", project_id="p1", project_name="First"
            )
        )
    try:
        definition = ParameterDefinition(
            value_type="integer",
            description="Run capacity",
            default_value=4,
            allow_project_override=True,
        )
        with pytest.raises(PermissionError):
            await store.define(owner, "runtime", "max_concurrent_runs", definition)
        await store.define(admin, "runtime", "max_concurrent_runs", definition)
        body = ParameterOverride(
            value=2, expected_revision=0, expected_definition_revision=1
        )
        with pytest.raises(PermissionError):
            await store.set_override(viewer, "runtime", "max_concurrent_runs", body)
        await store.set_override(owner, "runtime", "max_concurrent_runs", body)
        assert (await store.resolve("acme", "p1"))[0]["effective_value"] == 2
        assert (await store.resolve("acme", "p2"))[0]["effective_value"] == 4
        assert await store.resolve("other", "p1") == []
        with pytest.raises(ParameterConflict):
            await store.set_override(owner, "runtime", "max_concurrent_runs", body)
        with pytest.raises(ParameterConflict):
            await store.define(
                admin,
                "runtime",
                "max_concurrent_runs",
                definition.model_copy(
                    update={"expected_revision": 1, "allow_project_override": False}
                ),
            )
        await store.reset_override(owner, "runtime", "max_concurrent_runs", 1)
        assert (await store.resolve("acme", "p1"))[0]["source"] == "platform"
        # A reset/recreate cannot recycle a version and accept an old client's write.
        new = await store.set_override(owner, "runtime", "max_concurrent_runs", body)
        assert new["revision"] == 2
        with pytest.raises(ParameterConflict):
            await store.set_override(
                owner,
                "runtime",
                "max_concurrent_runs",
                body.model_copy(update={"expected_revision": 1}),
            )
        await store.reset_override(owner, "runtime", "max_concurrent_runs", 2)
        await store.define(
            admin,
            "runtime",
            "max_concurrent_runs",
            definition.model_copy(
                update={"expected_revision": 1, "allow_project_override": False}
            ),
        )
        with pytest.raises(PermissionError):
            await store.set_override(
                owner,
                "runtime",
                "max_concurrent_runs",
                body.model_copy(update={"expected_definition_revision": 2}),
            )
        with pytest.raises(ValueError):
            await store.define(admin, "runtime", "tenant_id", definition)
        with pytest.raises(ValueError):
            await store.define(
                admin,
                "runtime",
                "max_concurrent_runs",
                definition.model_copy(
                    update={"default_value": 10000, "expected_revision": 2}
                ),
            )
        async with store.engine.connect() as c:
            events = (await c.execute(select(audit))).all()
        assert [e.action for e in events] == [
            "define",
            "override",
            "reset",
            "override",
            "reset",
            "define",
        ]
    finally:
        await database.aclose()
