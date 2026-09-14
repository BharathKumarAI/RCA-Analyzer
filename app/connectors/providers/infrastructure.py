"""Native Kafka metadata and AsyncSSH SFTP evidence; no commands or writes."""

import asyncio
import json
import os
import ssl
import time
from pathlib import PurePosixPath

import asyncssh
from aiokafka.admin import AIOKafkaAdminClient
from aiokafka.errors import KafkaError

from app.connectors.base import BaseConnector, ConnectorError
from app.connectors.health import ConnectorHealth, CheckStatus


class InfrastructureConnector(BaseConnector):
    def __init__(self, connector_id, *, timeout_s=5, max_response_bytes=1048576, max_results=100, **kwargs):
        super().__init__(connector_id, max_response_bytes=max_response_bytes)
        self.timeout_s, self.max_results = timeout_s, max_results

    async def probe_health(self):
        started = time.monotonic()
        try:
            await self.read_evidence()
            status = CheckStatus.HEALTHY
        except ConnectorError:
            status = CheckStatus.UNHEALTHY
        return ConnectorHealth(connector_id=self.connector_id, overall=status,
                               latency_ms=(time.monotonic() - started) * 1000,
                               capability_health={"read_evidence": status}, message="Scoped infrastructure read probe completed")

    async def aclose(self):
        pass  # Each operation owns its bounded connection lifetime.


class KafkaConnector(InfrastructureConnector):
    def __init__(self, *, bootstrap_servers=None, topic=None, username=None,
                 password=None, topic_filter=None, **kwargs):
        super().__init__("kafka", **kwargs)
        self.bootstrap = bootstrap_servers or os.getenv("KAFKA_BOOTSTRAP_SERVERS")
        self.topic = topic or os.getenv("KAFKA_SCOPE")
        self.username = username or os.getenv("KAFKA_USERNAME")
        self.password = password or os.getenv("KAFKA_PASSWORD")
        self.topic_filter = topic_filter or os.getenv("KAFKA_TOPIC_FILTER")
        if not all((self.bootstrap, self.topic, self.username, self.password)):
            raise ValueError("Kafka brokers, topic and SASL credentials are required")
        if self.topic_filter and not isinstance(self.topic_filter, str):
            raise ValueError("Kafka topic filter must be a string")
        self.ssl_context = ssl.create_default_context(cafile=os.getenv("KAFKA_CA_FILE") or None)

    async def read_evidence(self):
        consumer = AIOKafkaAdminClient(
            bootstrap_servers=self.bootstrap,
            security_protocol="SASL_SSL", ssl_context=self.ssl_context,
            sasl_mechanism="SCRAM-SHA-512", sasl_plain_username=self.username,
            sasl_plain_password=self.password, request_timeout_ms=int(self.timeout_s * 1000),
        )
        try:
            async with asyncio.timeout(self.timeout_s):
                await consumer.start()
                topic = self.topic
                if self.topic_filter and not _topic_matches(topic, self.topic_filter):
                    return {"topic": topic, "items": [], "possibly_truncated": False,
                            "limitation": "Configured topic excluded by the project topic filter"}
                topics = await consumer.describe_topics([topic])
                if len(topics) != 1 or topics[0].get("topic") != topic or topics[0].get("error_code"):
                    raise ConnectorError("Configured Kafka topic is unavailable")
                partitions = topics[0].get("partitions", [])
                result = {"topic": topic, "items": partitions[:self.max_results],
                          "possibly_truncated": len(partitions) > self.max_results,
                          "limitation": "Partition metadata only; no messages consumed and no consumer-group lag measured"}
                if len(json.dumps(result).encode()) > self.max_response_bytes:
                    raise ConnectorError("Kafka evidence exceeded size limit")
                return result
        except (KafkaError, TimeoutError, OSError):
            raise ConnectorError("Kafka scoped metadata read failed") from None
        finally:
            async with asyncio.timeout(self.timeout_s):
                await consumer.close()


def _topic_matches(topic: str, pattern: str) -> bool:
    """Match one configured topic against a bounded glob-style filter."""
    import fnmatch

    if len(pattern) > 256 or any(char in pattern for char in ("\x00", "\n", "\r")):
        raise ValueError("Kafka topic filter is invalid")
    return fnmatch.fnmatchcase(topic, pattern)


class UnixConnector(InfrastructureConnector):
    def __init__(self, *, host=None, port=None, username=None, private_key_path=None,
                 known_hosts=None, path=None, password=None, private_key_passphrase=None,
                 auth_method=None, **kwargs):
        super().__init__("unix", **kwargs)
        self.host = host or os.getenv("UNIX_HOST")
        self.port = int(port or os.getenv("UNIX_PORT", "22"))
        if not 1 <= self.port <= 65535:
            raise ValueError("Invalid SSH port")
        self.user = username or os.getenv("UNIX_USER")
        self.key = private_key_path or os.getenv("UNIX_CLIENT_KEY")
        self.auth_method = auth_method or ("ssh_password" if password is not None else "ssh_private_key")
        self.password = password
        self.passphrase = private_key_passphrase
        if self.auth_method not in {"ssh_password", "ssh_private_key"}:
            raise ValueError("Unsupported Unix authentication method")
        self.known_hosts = known_hosts or os.getenv("UNIX_KNOWN_HOSTS")
        self.path = path or os.getenv("UNIX_LOG_PATH", "")
        credential = self.password if self.auth_method == "ssh_password" else self.key
        if not all((self.host, self.user, credential, self.known_hosts)) or not self.path.startswith("/") or ".." in PurePosixPath(self.path).parts:
            raise ValueError("Unix host, account, selected credential, known-hosts file and absolute log path are required")

    async def read_evidence(self):
        try:
            async with asyncio.timeout(self.timeout_s):
                async with asyncssh.connect(self.host, port=self.port, username=self.user,
                                            client_keys=[self.key] if self.auth_method == "ssh_private_key" else [],
                                            password=self.password if self.auth_method == "ssh_password" else None,
                                            passphrase=self.passphrase if self.auth_method == "ssh_private_key" else None,
                                            preferred_auth="password" if self.auth_method == "ssh_password" else "publickey",
                                            known_hosts=self.known_hosts,
                                            agent_path=None, config=None, connect_timeout=self.timeout_s) as connection:
                    async with connection.start_sftp_client() as sftp:
                        async with sftp.open(self.path, "rb") as handle:
                            info = await handle.stat()
                            offset = max(0, (info.size or 0) - self.max_response_bytes)
                            body = await handle.read(self.max_response_bytes, offset)
                            return {"text": body.decode("utf-8", errors="replace"), "truncated": offset > 0,
                                    "limitation": "Tail of the deployment-configured log file; no shell commands executed"}
        except (asyncssh.Error, OSError, TimeoutError):
            raise ConnectorError("Unix scoped SFTP log read failed") from None
