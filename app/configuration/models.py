"""Strict, data-only agent configuration models."""

from typing import Any, Annotated, Literal, Tuple
import re
from pydantic import BaseModel, ConfigDict, Field, field_validator, AfterValidator, model_validator
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
ConnectorFieldControl = Literal[
    "text",
    "number",
    "duration",
    "select",
    "multi_select",
    "toggle",
    "secret_picker",
    "json_editor",
]
ConnectorDefaultSource = Literal["static", "discovered", "computed", "none"]

IntegrationKind = Literal["native", "mcp", "a2a", "parser"]


ParameterValueType = Literal["string", "integer", "number", "boolean", "json", "secret_ref"]
KNOWN_PARAMETER_CATEGORIES = {
    "connectivity": (
        "authentication",
        "endpoint",
        "protocol",
        "rate_limit",
        "retry",
        "service_account",
        "timeouts",
    ),
    "identity": ("service_account", "authentication"),
    "performance": ("rate_limit", "retry", "timeouts"),
    "query": ("index_selection", "pagination", "field_mapping", "topic_selection", "path"),
    "schedules": ("environment", "schedule", "window", "polling_frequency", "max_window_seconds"),
    "security": ("auth", "oauth", "secret"),
    "runtime": ("operation", "deployment"),
    "operational": ("general", "attachments"),
}


def _normalize_category_value(category: str, subcategory: str | None) -> tuple[str, str | None]:
    category_key = category.strip().lower()
    if category_key not in KNOWN_PARAMETER_CATEGORIES:
        raise ValueError(f"Unknown parameter category '{category}'")
    if subcategory is None:
        return category_key, None
    subcategory_value = subcategory.strip().lower()
    if not subcategory_value:
        raise ValueError("Subcategory cannot be empty when provided")
    return category_key, subcategory_value


def _validate_parameter_typed_value(
    value_type: ParameterValueType, value: Any, *, nullable: bool = False
) -> None:
    if value is None:
        if nullable:
            return
        raise ValueError("Value cannot be null unless nullable is enabled")
    if value_type == "string":
        if not isinstance(value, str):
            raise ValueError("Default value must be a string")
    elif value_type == "integer":
        if type(value) is not int:
            raise ValueError("Default value must be an integer")
    elif value_type == "number":
        if type(value) is not int and not (
            type(value) is float and value == value and value != float("inf") and value != float("-inf")
        ):
            raise ValueError("Default value must be a finite number")
    elif value_type == "boolean":
        if type(value) is not bool:
            raise ValueError("Default value must be boolean")
    elif value_type == "json":
        if not isinstance(value, (dict, list)):
            raise ValueError("JSON value type requires a dict or list")
    elif value_type == "secret_ref":
        if not isinstance(value, str) or not re.fullmatch(
            r"env://[A-Z][A-Z0-9_]{0,127}", value
        ):
            raise ValueError("secret_ref must be env://TOKEN_REFERENCE")


class ConnectorTemplateField(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    variable_name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    description: str = Field(min_length=1, max_length=2048)
    value_type: ConnectorValueType
    default_value: Any
    allow_project_override: bool = True
    visible_in_project: bool = True
    icon: str = Field(default="settings", pattern=r"^[a-z0-9_-]{1,64}$")
    category: str = Field(default="operational", min_length=1, max_length=120)
    subcategory: str | None = Field(default=None, max_length=120)
    allowed_values: tuple[Any, ...] | None = None
    key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_.-]{0,127}$")
    label: str | None = Field(default=None, min_length=1, max_length=200)
    required_when: str | None = Field(default=None, min_length=1, max_length=512)
    nullable: bool = False
    required: bool = False
    disableable: bool = False
    default_source: ConnectorDefaultSource = "static"
    ui_control: ConnectorFieldControl | None = None
    ui_metadata: dict[str, Any] = Field(default_factory=dict)
    validation_schema: dict[str, Any] | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    ownership: Literal[
        "platform_locked",
        "project_override_allowed",
        "project_only",
        "derived",
        "secret_reference",
    ] = "project_override_allowed"
    sensitivity: Literal["normal", "masked", "secret_reference"] = "normal"
    runtime_binding: str | None = None
    template_editable: bool = False
    minimum: float | None = Field(default=None, allow_inf_nan=False)
    maximum: float | None = Field(default=None, allow_inf_nan=False)
    max_length: int | None = Field(default=None, ge=1, le=100000)
    visibility_condition: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_field_contract(self):
        _normalize_category_value(self.category, self.subcategory)
        _validate_parameter_typed_value(
            self.value_type, self.default_value, nullable=self.nullable
        )
        if self.required and self.default_value is None and self.default_source == "static":
            raise ValueError("Required connector fields need a static default or a provider default")
        if self.default_source != "static" and self.default_value is not None:
            raise ValueError("Non-static connector defaults cannot include default_value")
        if self.default_source == "static" and self.default_value is None and not self.nullable:
            raise ValueError("Static connector defaults cannot be null")
        if self.allowed_values is not None:
            if not self.allowed_values:
                raise ValueError("allowed_values cannot be empty when provided")
            for item in self.allowed_values:
                _validate_parameter_typed_value(
                    self.value_type, item, nullable=self.nullable
                )
            if self.default_value is not None and self.default_value not in self.allowed_values:
                raise ValueError("Default value must be one of allowed_values")
        if self.value_type == "secret_ref" and self.sensitivity != "secret_reference":
            raise ValueError("secret_ref fields must use secret_reference sensitivity")
        if self.sensitivity == "secret_reference" and self.value_type != "secret_ref":
            raise ValueError("secret_reference sensitivity requires a secret_ref field")
        if self.ownership == "secret_reference" and self.value_type != "secret_ref":
            raise ValueError("secret_reference ownership requires a secret_ref field")
        if self.ownership == "project_only" and not self.allow_project_override:
            raise ValueError("project_only fields must allow project overrides")
        if self.ui_control in {"select", "multi_select"} and not self.allowed_values:
            raise ValueError("Select controls require allowed_values")
        if self.template_editable and (
            self.ownership not in {"platform_locked", "project_override_allowed"}
            or self.sensitivity != "normal" or self.value_type == "secret_ref"
            or self.default_source != "static" or self.nullable
        ):
            raise ValueError("Shared template fields require nonsecret static defaults and shared ownership")
        if (self.minimum is not None or self.maximum is not None) and self.value_type not in {"integer", "number"}:
            raise ValueError("Numeric bounds require a numeric field")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Minimum cannot exceed maximum")
        if self.max_length is not None and self.value_type != "string":
            raise ValueError("Text bounds require a string field")
        self.validate_parameter_value(self.default_value)
        if self.validation_schema is not None and not isinstance(self.validation_schema, dict):
            raise ValueError("validation_schema must be an object")
        return self

    def validate_parameter_value(self, value: Any) -> None:
        _validate_parameter_typed_value(self.value_type, value, nullable=self.nullable)
        if value is None:
            return
        if self.allowed_values is not None and value not in self.allowed_values:
            raise ValueError("Value is not in allowed_values")
        if self.minimum is not None and value < self.minimum:
            raise ValueError("Value is below minimum")
        if self.maximum is not None and value > self.maximum:
            raise ValueError("Value exceeds maximum")
        if self.max_length is not None and len(value) > self.max_length:
            raise ValueError("Value exceeds maximum length")


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
    default_mcp_url: str | None = None
    default_a2a: dict[str, Any] | None = None
    parameter_fields: Tuple[ConnectorTemplateField, ...] = Field(default_factory=tuple)
    version: str = "1.0.0"
    availability: Literal["draft", "published", "deprecated", "retired"] = "published"
    platform_enabled: bool = True
    is_enabled_by_policy: bool = True
    provider_adapter_id: str | None = None
    supported_operations: tuple[str, ...] = ()
    known_limitations: tuple[str, ...] = ()
    auth_profiles: tuple[dict[str, Any], ...] = ()
    scope_operations: dict[str, Any] = Field(default_factory=dict)
    project_form: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_template_contract(self):
        names = [field.variable_name for field in self.parameter_fields]
        if len(names) != len(set(names)):
            raise ValueError("Connector template parameter_fields must use unique variable_name values")
        fields = {field.variable_name: field for field in self.parameter_fields}
        if any(field.template_editable for field in self.parameter_fields) and not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", self.system_name):
            raise ValueError("Shared parameter system names must use lowercase letters, digits and underscores")
        if self.availability == "published":
            required_project_fields = {
                "system_name": ("string", "project_only"),
                "environment_dependency": ("string", "project_only"),
                "tool_environment": ("string", "project_only"),
            }
            missing = set(required_project_fields) - fields.keys()
            if missing:
                raise ValueError(
                    "Published connector templates require project fields: "
                    + ", ".join(sorted(missing))
                )
            for name, (value_type, ownership) in required_project_fields.items():
                field = fields[name]
                if field.value_type != value_type or field.ownership != ownership:
                    raise ValueError(f"{name} must be a project-only string field")
                if not field.required or not field.allow_project_override or not field.visible_in_project:
                    raise ValueError(f"{name} must be required and editable in project setup")
            if fields["system_name"].default_value != self.name:
                raise ValueError("system_name must default to the connector display name")
            if fields["environment_dependency"].allowed_values != ("dependent", "independent"):
                raise ValueError(
                    "environment_dependency must allow dependent and independent choices"
                )
            if fields["tool_environment"].default_value is None:
                raise ValueError("tool_environment must have an explicit project default")
        profile_ids = set()
        for profile in self.auth_profiles:
            if not isinstance(profile, dict):
                raise ValueError("auth_profiles entries must be objects")
            allowed = {
                "id",
                "name",
                "status",
                "transport_compatibility",
                "required_fields",
                "optional_fields",
                "hidden_fields",
            }
            unknown = set(profile) - allowed
            if unknown:
                raise ValueError(f"Unknown auth profile fields: {', '.join(sorted(unknown))}")
            profile_id = profile.get("id")
            if not isinstance(profile_id, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{1,63}", profile_id):
                raise ValueError("Auth profile id must be a lowercase identifier")
            if profile_id in profile_ids:
                raise ValueError("Auth profile ids must be unique")
            profile_ids.add(profile_id)
            if not isinstance(profile.get("name"), str) or not profile["name"].strip():
                raise ValueError("Auth profiles require a display name")
            required_profile_keys = {
                "name",
                "status",
                "transport_compatibility",
                "required_fields",
                "optional_fields",
                "hidden_fields",
            }
            if required_profile_keys - profile.keys():
                raise ValueError("Auth profiles must declare transport and conditional fields")
            if not isinstance(profile["transport_compatibility"], str) or not profile["transport_compatibility"].strip():
                raise ValueError("Auth profiles require a transport compatibility label")
            protocol = self.protocol.lower()
            transport = profile["transport_compatibility"].lower()
            compatible = transport in protocol
            compatible = compatible or (
                protocol == "native or mcp" and transport in {"mcp", "sasl_ssl"}
            )
            compatible = compatible or (
                protocol == "sftp/ssh" and transport in {"sftp", "ssh"}
            )
            if not compatible:
                raise ValueError(
                    f"Auth profile transport '{profile['transport_compatibility']}' "
                    f"is incompatible with protocol '{self.protocol}'"
                )
            if profile.get("status") not in {"active", "planned", "disabled_by_policy", "retired"}:
                raise ValueError("Auth profile status is invalid")
            required = profile.get("required_fields", [])
            optional = profile.get("optional_fields", [])
            hidden = profile.get("hidden_fields", [])
            if any(not isinstance(items, list) for items in (required, optional, hidden)):
                raise ValueError("Auth profile field lists must be arrays")
            if any(
                any(
                    not isinstance(item, str)
                    or not re.fullmatch(r"[a-z][a-z0-9_]{1,127}", item)
                    for item in items
                )
                for items in (required, optional, hidden)
            ):
                raise ValueError("Auth profile fields must be lowercase identifiers")
            if any(len(items) != len(set(items)) for items in (required, optional, hidden)):
                raise ValueError("Auth profile field lists must not contain duplicates")
            groups = [set(required), set(optional), set(hidden)]
            if groups[0] & groups[1] or groups[0] & groups[2] or groups[1] & groups[2]:
                raise ValueError("Auth profile fields cannot be both required, optional, or hidden")
        if (
            self.availability == "published"
            and self.is_enabled_by_policy
            and self.auth_profiles
            and not any(profile.get("status") == "active" for profile in self.auth_profiles)
        ):
            raise ValueError("An enabled published connector needs an active authentication profile")
        return self


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


class EnvironmentConnectionRecord(StrictModel):
    connection_id: str = Field(pattern=r"^[a-z0-9_-]{1,64}$")
    connection_name: str = Field(min_length=1, max_length=128)
    environment_name: str = Field(min_length=1, max_length=64)
    enabled: bool = False
    routing_mode: Literal["direct", "mcp", "hybrid"] = "direct"
    auth_profile_id: str | None = None
    target: dict[str, Any] = Field(default_factory=dict)
    credentials: dict[str, Any] = Field(default_factory=dict)
    mcp_configuration: dict[str, Any] = Field(default_factory=dict)
    resource_scope: tuple[str, ...] = ()
    status: Literal["draft", "active", "inactive"] = "draft"
    test_status: Literal["not_tested", "passed", "failed", "missing_permissions", "expired"] = "not_tested"
    last_tested_at: float | None = None


class ToolAccessRule(StrictModel):
    logical_capability: str = Field(min_length=1, max_length=128)
    tool_id: str = Field(min_length=1, max_length=128)
    tool_enabled: bool = False
    access_route: Literal["direct", "mcp"] = "direct"
    read_access: bool = False
    write_access: bool = False
    execution_access: bool = False
    allowed_roles: tuple[Role, ...] = ()
    allowed_environment_connections: tuple[str, ...] = ()
    default_environment_connection: str | None = None
    resource_scope: tuple[str, ...] = ()


class HarnessSelection(StrictModel):
    agents: tuple[str, ...] = ()
    disabled_agents: tuple[str, ...] = ()
    plugins: tuple[str, ...] = ()
    disabled_plugins: tuple[str, ...] = ()
    disabled_skills: tuple[SkillId, ...] = ()
    disabled_capabilities: tuple[str, ...] = ()


class ProjectTemplateProvenance(StrictModel):
    """Server-owned record of the managed template that produced a project layer."""

    source: Literal["platform.project_templates"] = "platform.project_templates"
    template_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    template_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    template_checksum: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    template_revision: int = Field(ge=1)
    project_revision: str = Field(pattern=r"^(?:|sha256:[0-9a-f]{64})$")
    harness_revision: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    parameter_source: Literal["/api/v1/parameters"] = "/api/v1/parameters"
    applied_at: float = Field(gt=0)
    applied_by: str = Field(min_length=1, max_length=256)


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
    # This is written only by the managed project-template apply path.  It is
    # persisted with the effective layer so provenance cannot get out of sync
    # with the Harness selection or project policy.
    project_template: ProjectTemplateProvenance | None = None


class UserLayer(StrictModel):
    tenant_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    skills: dict[SkillId, SkillOverride] = Field(default_factory=dict)
    preferences: PresentationPreferences = Field(
        default_factory=PresentationPreferences
    )
