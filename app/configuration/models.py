"""Strict, data-only agent configuration models."""

from typing import Any, Annotated, Literal, Tuple
from pydantic import BaseModel, ConfigDict, Field, field_validator, AfterValidator
from app.tools.catalog import ALLOWED_ACTIONS
from app.capabilities.models import StrictModel
from app.identity.principals import Role


class AgentDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=1000)
    instruction: str = Field(min_length=1, max_length=12000)
    capability: str = Field(min_length=1, max_length=128)
    model_profile: str = "balanced-investigation"
    tools: Tuple[str, ...] = ()
    stage_model: str = "logs"

    @field_validator("tools")
    @classmethod
    def unique_tools(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("tools must be unique")
        return value


class AgentDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    draft_id: str
    tenant_id: str
    project_id: str
    author_subject: str
    definition: AgentDefinition
    content_hash: str
    status: Literal["PENDING", "APPROVED", "REJECTED", "REVOKED"]
    created_at: float
    reviewed_at: float | None = None
    reviewer_subject: str | None = None
    review_reason: str | None = None


SkillId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,63}$")]
def registered_action(value: str) -> str:
    if value not in ALLOWED_ACTIONS | {"database.query_readonly"}:
        raise ValueError("Unknown tool action")
    return value


Action = Annotated[str, AfterValidator(registered_action)]


class SkillRule(StrictModel):
    immutable: bool = True
    project_override: bool = False
    user_override: bool = False
    actions: tuple[Action, ...] = ()


PreferenceName = Literal["presentation", "detail"]
ProjectSection = Literal[
    "skills",
    "capabilities",
    "disabled_connectors",
    "limits",
    "workflow",
    "prompts",
    "preferences",
    "environments",
    "harness",
]
StageName = Literal[
    "orchestrator", "triage", "logs", "extraction", "router", "synthesis"
]
ConnectorName = Literal["itsm", "log_search", "confluence", "signalfx", "qtest", "gitlab", "oracle", "kafka", "unix", "kubernetes"]

ConnectorValueType = Literal["string", "integer", "number", "boolean", "json", "secret_ref"]

IntegrationKind = Literal["native", "mcp", "a2a", "parser"]


class ConnectorTemplateField(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    variable_name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    description: str = Field(min_length=1, max_length=2048)
    value_type: ConnectorValueType
    default_value: Any
    allow_project_override: bool = True
    visible_in_project: bool = True
    icon: str = Field(default="settings", pattern=r"^[a-z0-9_-]{1,64}$")


class ConnectorTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    type: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    name: str = Field(min_length=1, max_length=200)
    system_name: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    category: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=2048)
    integration_kind: IntegrationKind = "native"
    protocol: str = Field(min_length=1, max_length=120)
    auth_method: str = Field(min_length=1, max_length=120)
    default_endpoint: str = Field(min_length=1, max_length=256)
    default_ui_base_url: str | None = None
    default_secret: str = Field(min_length=1, max_length=120)
    secret_variable: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,63}$")
    default_service_user: str | None = None
    default_scope: Literal["platform_default", "project_override", "project_only"]
    can_override: bool = True
    default_timeout_seconds: int = Field(default=30, ge=1, le=120)
    default_retry_attempts: int = Field(default=3, ge=0, le=20)
    default_retry_backoff: int = Field(default=1, ge=0, le=120)
    default_rate_limit: str = "100 req/min"
    default_config: dict[str, Any] = Field(default_factory=dict)
    default_mcp: dict[str, Any] | None = None
    default_a2a: dict[str, Any] | None = None
    parameter_fields: Tuple[ConnectorTemplateField, ...] = Field(default_factory=tuple)


class PlatformRules(StrictModel):
    skills: dict[SkillId, SkillRule] = Field(default_factory=dict)
    project_sections: tuple[ProjectSection, ...] = ()
    model_profiles: tuple[str, ...] = ()
    user_preferences: tuple[PreferenceName, ...] = ()


class CapabilityOverride(StrictModel):
    enabled: bool = True
    allowed_actions: tuple[Action, ...] | None = None
    allowed_roles: tuple[Role, ...] | None = None
    model_profile: str | None = None


class ExecutionLimits(StrictModel):
    max_llm_calls: int | None = Field(default=None, ge=1, le=100)
    max_tool_calls: int | None = Field(default=None, ge=1, le=100)
    max_context_chars: int | None = Field(default=None, ge=1000, le=256000)
    max_evidence_items: int | None = Field(default=None, ge=1, le=100)
    max_evidence_chars: int | None = Field(default=None, ge=100, le=16000)
    run_timeout_seconds: float | None = Field(default=None, ge=1, le=900)

    def apply(self, settings):
        updates = {
            name: min(getattr(settings, name), value)
            for name, value in self.model_dump(exclude_none=True).items()
            if name != "max_tool_calls"
        }
        return settings.model_copy(update=updates)


class WorkflowOptions(StrictModel):
    planning: bool = True
    attachments: bool = True
    specialists: bool = True
    parallel_evidence: bool = True


class PresentationPreferences(StrictModel):
    presentation: Literal["summary", "table", "timeline", "dashboard", "report"] = (
        "summary"
    )
    detail: Literal["concise", "standard", "detailed"] = "standard"


class SkillOverride(StrictModel):
    instruction: str | None = Field(default=None, min_length=1, max_length=16000)
    enabled: bool = True
    actions: tuple[Action, ...] | None = None


class EnvironmentConfig(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str | None = Field(default=None, max_length=200)
    enabled: bool = True
    cluster: str | None = Field(default=None, max_length=128)
    namespace: str | None = Field(default=None, max_length=128)
    host: str | None = Field(default=None, max_length=256)
    splunk_index: str | None = Field(default=None, max_length=128)
    jira_env_name: str | None = Field(default=None, max_length=128)


class HarnessSelection(StrictModel):
    agents: tuple[str, ...] = ()
    disabled_agents: tuple[str, ...] = ()
    plugins: tuple[str, ...] = ()
    disabled_plugins: tuple[str, ...] = ()
    disabled_skills: tuple[SkillId, ...] = ()
    disabled_capabilities: tuple[str, ...] = ()


class ProjectLayer(StrictModel):
    tenant_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    allow_user_overrides: tuple[SkillId, ...] = ()
    skills: dict[SkillId, SkillOverride] = Field(default_factory=dict)
    capabilities: dict[str, CapabilityOverride] = Field(default_factory=dict)
    disabled_connectors: tuple[ConnectorName, ...] = ()
    limits: ExecutionLimits = Field(default_factory=ExecutionLimits)
    workflow: WorkflowOptions = Field(default_factory=WorkflowOptions)
    prompts: dict[StageName, Annotated[str, Field(min_length=1, max_length=16000)]] = (
        Field(default_factory=dict)
    )
    preferences: PresentationPreferences = Field(
        default_factory=PresentationPreferences
    )
    allow_user_preferences: tuple[PreferenceName, ...] = ()
    environments: tuple[EnvironmentConfig, ...] = ()
    harness: HarnessSelection = Field(default_factory=HarnessSelection)


class UserLayer(StrictModel):
    tenant_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    skills: dict[SkillId, SkillOverride] = Field(default_factory=dict)
    preferences: PresentationPreferences = Field(
        default_factory=PresentationPreferences
    )
