"""Abstract interface shared by external system connectors."""

from abc import ABC, abstractmethod
import httpx2
from app.connectors.health import ConnectorHealth


class ConnectorError(RuntimeError):
    """Safe connector failure without exposing URLs, response bodies, or credentials."""


class BaseConnector(ABC):
    """Base connector interface decoupled from concrete tool wrappers."""

    def __init__(self, connector_id: str, *, max_response_bytes: int = 1_048_576):
        self.connector_id = connector_id
        if max_response_bytes <= 0 or max_response_bytes > 16 * 1024 * 1024:
            raise ValueError("max_response_bytes exceeds safety bounds")
        self.max_response_bytes = max_response_bytes

    @abstractmethod
    async def probe_health(self) -> ConnectorHealth:
        """Execute a bounded health request against the external system."""
        raise NotImplementedError

    @abstractmethod
    async def aclose(self) -> None:
        """Close the connector's shared HTTP client."""
        raise NotImplementedError

    async def read_limited(
        self, response: httpx2.Response, limit: int | None = None
    ) -> bytes:
        """Read at most ``limit`` bytes from a response body."""
        limit = self.max_response_bytes if limit is None else limit
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise ConnectorError("connector response exceeded size limit")
            chunks.append(chunk)
        return b"".join(chunks)
