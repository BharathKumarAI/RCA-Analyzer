"""Oracle project resolution reaches only the bounded, fixed diagnostic read."""

from copy import deepcopy

import pytest

from app.configuration.platform import PlatformConfiguration
from app.connectors.candidate_testing import execute_candidate_test, validate_candidate_configuration
from app.connectors.providers.oracle import OracleConnector, validate_oracle_endpoint
from app.connectors.providers.registry import resolve_connector_provider
from app.settings import Settings


def candidate():
    return {
        "template_id": "oracle", "template_version": "1.0.0", "system_name": "payments-db",
        "environment_dependency": "independent", "tool_environment": "Shared",
        "endpoint": "tcps://db.example:1522/payments", "external_resource": "PAYMENTS",
        "auth_type": "database_password", "max_results": 2, "max_response_bytes": 2048,
        "credentials": {"database_username": "RCA_READER", "password_secret_ref": "env://PROJECT_ORACLE_PASSWORD"},
    }


def template():
    return next(item.model_dump(mode="json") for item in PlatformConfiguration.load(Settings()).connector_templates
                if item.type == "oracle")


def test_oracle_resolution_uses_project_credentials_scope_and_limits(monkeypatch):
    monkeypatch.setenv("PROJECT_ORACLE_PASSWORD", "project-password")
    monkeypatch.setenv("ORACLE_SCOPE", "GLOBAL")
    monkeypatch.setenv("ORACLE_PASSWORD", "global-password")
    definition = candidate()
    assert validate_candidate_configuration(definition, template()) == (True, [])
    provider = resolve_connector_provider(
        "oracle", instance_definition=definition, allowed_hosts={"db.example"},
        allowed_secret_references={"env://PROJECT_ORACLE_PASSWORD"},
    )
    assert isinstance(provider, OracleConnector)
    assert (provider.scope, provider.user, provider.password) == ("PAYMENTS", "RCA_READER", "project-password")
    assert (provider.max_results, provider.max_response_bytes) == (2, 2048)
    with pytest.raises(ValueError, match="host is not authorized"):
        resolve_connector_provider("oracle", instance_definition=definition, allowed_hosts={"other.example"})
    with pytest.raises(ValueError, match="secret reference is not authorized"):
        resolve_connector_provider("oracle", instance_definition=definition, allowed_secret_references=set())
    definition.pop("external_resource")
    with pytest.raises(ValueError, match="resource scope is required"):
        resolve_connector_provider("oracle", instance_definition=definition)


@pytest.mark.parametrize("endpoint", [
    "db_alias", "jdbc:oracle:thin:@db.example:1521/payments", "tcp://db.example:1521",
    "tcp://user:password@db.example:1521/payments", "tcp://db.example:1521/payments?wallet_location=/tmp",
    "tcp://db.example:1521/payments#hidden", "tcp://db.example:70000/payments",
    "tcp://db.example,other.example:1521/payments", "tcp://db%2Eexample:1521/payments",
])
def test_oracle_rejects_hidden_or_ambiguous_destinations(endpoint):
    with pytest.raises(ValueError):
        validate_oracle_endpoint(endpoint)


@pytest.mark.parametrize("updates", [
    {"driver_mode": "thick"}, {"connection_format": "tns_alias"}, {"max_results": 1001},
    {"max_response_bytes": -1}, {"max_response_bytes": True}, {"external_resource": ""},
    {"credentials": {"database_username": "RCA_READER", "password": "plaintext"}},
])
def test_oracle_candidate_rejects_unsupported_or_unbounded_configuration(updates):
    valid, errors = validate_candidate_configuration({**candidate(), **updates}, template())
    assert not valid and errors


@pytest.mark.asyncio
async def test_oracle_candidate_and_runtime_execute_fixed_read_with_bound_scope(monkeypatch):
    monkeypatch.setenv("PROJECT_ORACLE_PASSWORD", "project-password")
    calls = []

    class Cursor:
        description = [(name,) for name in ("SID", "SERIAL#", "STATUS", "EVENT", "WAIT_CLASS", "SECONDS_IN_WAIT", "BLOCKING_SESSION")]

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        async def execute(self, sql, **bindings):
            calls.append((sql, bindings))

        async def fetchmany(self, count):
            assert count == 3
            return [(sid, 10, "ACTIVE", "db file read", "User I/O", 1, None) for sid in range(count)]

    class Connection:
        call_timeout = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            calls.append(("closed", self.call_timeout))

        def cursor(self):
            return Cursor()

    def connect(**kwargs):
        assert kwargs == {"user": "RCA_READER", "password": "project-password",
                          "dsn": "tcps://db.example:1522/payments", "tcp_connect_timeout": 10}
        return Connection()

    monkeypatch.setattr("app.connectors.providers.oracle.oracledb.connect_async", connect)
    result = await execute_candidate_test(candidate(), template(), operation="test_scoped_read",
                                          allowed_endpoint_hosts={"db.example"},
                                          allowed_secret_references={"env://PROJECT_ORACLE_PASSWORD"})
    assert result["overall_result"] == "PASSED"
    provider = resolve_connector_provider("oracle", instance_definition=candidate())
    evidence = await provider.read_evidence()
    assert len(evidence["items"]) == 2 and evidence["possibly_truncated"]
    for offset in (0, 3):
        assert calls[offset] == ("SET TRANSACTION READ ONLY", {})
        assert calls[offset + 1][0].endswith("FROM v$session WHERE username = :scope AND ROWNUM <= :limit")
        assert calls[offset + 1][1] == {"scope": "PAYMENTS", "limit": 3}
        assert calls[offset + 2] == ("closed", 10000)
    forbidden = deepcopy(candidate())
    forbidden["endpoint"] = "tcps://other.example:1522/payments"
    assert (await execute_candidate_test(forbidden, template(), allowed_endpoint_hosts={"db.example"}))["overall_result"] == "FAILED"
    assert len(calls) == 6
