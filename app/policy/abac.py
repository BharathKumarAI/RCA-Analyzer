"""Attribute-Based Access Control (ABAC) evaluation context and rules."""

from typing import Dict, Any
from pydantic import BaseModel, ConfigDict, Field
from app.identity.principals import UserPrincipal


class AuthorizationContext(BaseModel):
    """Context passed to the policy engine for fine-grained authorization."""

    principal: UserPrincipal
    tenant_id: str
    project_id: str
    capability_id: str
    action: str  # e.g., "itsm.add_comment", "database.query_readonly"
    resource_type: str  # e.g., "incident_ticket", "database_table"
    resource_id: str
    environment: str  # e.g., "PROD", "QLAB01"
    data_classification: str = "OPERATIONAL"  # OPERATIONAL, CONFIDENTIAL, RESTRICTED
    is_mutation: bool = False
    attributes: Dict[str, Any] = Field(default_factory=dict)
    model_config = ConfigDict(extra="forbid")
