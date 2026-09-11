"""Multidimensional connector health monitoring."""

from enum import Enum
import time
from typing import Dict
from pydantic import BaseModel, Field


class CheckStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNHEALTHY = "UNHEALTHY"
    AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR"
    AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR"
    RATE_LIMITED = "RATE_LIMITED"
    SCHEMA_MISMATCH = "SCHEMA_MISMATCH"


class ConnectorHealth(BaseModel):
    """Multidimensional health inspection record."""

    connector_id: str
    overall: CheckStatus
    latency_ms: float
    connectivity: CheckStatus = CheckStatus.HEALTHY
    authentication: CheckStatus = CheckStatus.HEALTHY
    authorization: CheckStatus = CheckStatus.HEALTHY
    rate_limit_status: CheckStatus = CheckStatus.HEALTHY
    schema_compatibility: CheckStatus = CheckStatus.HEALTHY
    capability_health: Dict[str, CheckStatus] = Field(default_factory=dict)
    last_probed_at: float = Field(default_factory=time.time)
    message: str = "Healthy"
