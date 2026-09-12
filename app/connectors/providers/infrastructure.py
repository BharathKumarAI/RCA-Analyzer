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
    def __init__(self, **kwargs):
        super().__init__("kafka", **kwargs)
        self.bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS")
        self.topic = os.getenv("KAFKA_SCOPE")
        self.username = os.getenv("KAFKA_USERNAME")
        self.password = os.getenv("KAFKA_PASSWORD")
        if not all((self.bootstrap, self.topic, self.username, self.password)):
            raise ValueError("Kafka brokers, topic and SASL credentials are required")
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
                topics = await consumer.describe_topics([self.topic])
                if len(topics) != 1 or topics[0].get("topic") != self.topic or topics[0].get("error_code"):
                    raise ConnectorError("Configured Kafka topic is unavailable")
                partitions = topics[0].get("partitions", [])
                result = {"topic": self.topic, "items": partitions[:self.max_results],
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


class UnixConnector(InfrastructureConnector):
    def __init__(self, **kwargs):
        super().__init__("unix", **kwargs)
        self.host = os.getenv("UNIX_HOST")
        self.port = int(os.getenv("UNIX_PORT", "22"))
        if not 1 <= self.port <= 65535:
            raise ValueError("Invalid SSH port")
        self.user = os.getenv("UNIX_USER")
        self.key = os.getenv("UNIX_CLIENT_KEY")
        self.known_hosts = os.getenv("UNIX_KNOWN_HOSTS")
        self.path = os.getenv("UNIX_LOG_PATH", "")
        if not all((self.host, self.user, self.key, self.known_hosts)) or not self.path.startswith("/") or ".." in PurePosixPath(self.path).parts:
            raise ValueError("Unix host, account, key, known-hosts file and absolute log path are required")

    async def read_evidence(self):
        try:
            async with asyncio.timeout(self.timeout_s):
                async with asyncssh.connect(self.host, port=self.port, username=self.user,
                                            client_keys=[self.key], known_hosts=self.known_hosts,
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
