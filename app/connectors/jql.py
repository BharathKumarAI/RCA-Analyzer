"""Compile bounded, typed Jira filters; project scope comes only from the provider."""

import json
import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, model_validator

Scalar = StrictStr | StrictInt | StrictFloat


class JqlFilter(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    field: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,127}$")
    operator: Literal["=", "!=", "IN", "NOT IN", "~", "!~", ">", ">=", "<", "<=", "IS EMPTY", "IS NOT EMPTY"]
    value: Scalar | Annotated[list[Scalar], Field(min_length=1, max_length=50)] | None = None


class JqlSort(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,127}$")
    direction: Literal["ASC", "DESC"] = "ASC"


class JqlGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match: Literal["all", "any"] = "all"
    filters: list[JqlFilter] = Field(default_factory=list, max_length=30)
    groups: list["JqlGroup"] = Field(default_factory=list, max_length=10)


class JqlAssignees(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_ids: list[Annotated[str, Field(min_length=1, max_length=256)]] = Field(default_factory=list, max_length=50)
    role_ids: list[Literal["PROJECT_OWNER", "PROJECT_MANAGER", "PROJECT_ANALYST", "PROJECT_VIEWER"]] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def selected(self):
        if not self.member_ids and not self.role_ids:
            raise ValueError("Choose project members or project roles; an empty assignee selection cannot match everyone")
        return self


class JqlQuery(JqlGroup):
    order_by: list[JqlSort] = Field(default_factory=list, max_length=3)
    assignees: JqlAssignees | None = None

    @model_validator(mode="after")
    def bounded_groups(self):
        pending, total = [(self, 0)], 0
        while pending:
            group, depth = pending.pop()
            if depth > 4:
                raise ValueError("JQL groups support at most four nested levels")
            total += len(group.filters) + len(group.groups)
            if total > 30:
                raise ValueError("JQL supports at most 30 conditions and groups")
            for child in group.groups:
                if not child.filters and not child.groups:
                    raise ValueError("Nested JQL groups cannot be empty")
                pending.append((child, depth + 1))
        return self


class JqlTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: JqlQuery | None = None
    custom_jql: str | None = Field(default=None, min_length=1, max_length=4096)
    max_results: int = Field(default=20, ge=1, le=50, strict=True)

    @model_validator(mode="after")
    def one_query(self):
        if (self.query is None) == (self.custom_jql is None):
            raise ValueError("Supply either a structured query or custom JQL")
        return self


def validate_member_mapping(value: dict, members: list[dict]) -> dict[str, str]:
    if not isinstance(value, dict) or len(value) > 250:
        raise ValueError("Jira member mapping must contain at most 250 project members")
    active = {item["subject"] for item in members if item.get("status") == "active"}
    for subject, account in value.items():
        if subject not in active:
            raise ValueError("Jira account mappings require active members of this project")
        if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", account):
            raise ValueError("Use a canonical Jira account ID of at most 128 characters")
    return dict(value)


def resolve_member_accounts(selection: JqlAssignees, mapping: dict, members: list[dict]) -> list[str]:
    # Saved mappings are data, never membership authority. Recheck current membership.
    active = {item["subject"]: item for item in members if item.get("status") == "active"}
    selected = set(selection.member_ids)
    if not selected <= active.keys():
        raise ValueError("Selected Jira assignees must be active members of this project")
    selected.update(subject for subject, member in active.items()
                    if set(selection.role_ids) & set(member.get("roles") or []))
    if not selected:
        raise ValueError("The selected project roles have no active members")
    if len(selected) > 50 or any(subject not in mapping for subject in selected):
        raise ValueError("Select at most 50 members and save a Jira account mapping for every selected member")
    verified = validate_member_mapping({subject: mapping[subject] for subject in selected}, members)
    return sorted(set(verified.values()))


def _quote(value: str) -> str:
    if not value or len(value) > 512 or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Filter text must contain 1–512 printable characters")
    return json.dumps(value, ensure_ascii=False)


def field_contract(field: dict) -> dict | None:
    """Expose a conservative subset of the search types reported by Jira."""
    name = field.get("id", "")
    if name == "project" or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,127}", name) or field.get("searchable") is not True:
        return None
    schema = field.get("schema") or {}
    kind = schema.get("type")
    custom = schema.get("custom", "").rsplit(":", 1)[-1]
    text = name in {"summary", "description", "environment", "comment"} or custom in {"textfield", "textarea", "readonlyfield"}
    if text:
        kind = "text"
        operators = ["~", "!~", "IS EMPTY", "IS NOT EMPTY"]
    elif kind in {"date", "datetime", "number"}:
        operators = ["=", "!=", ">", ">=", "<", "<=", "IS EMPTY", "IS NOT EMPTY"]
    elif kind in {"option", "user", "status", "priority", "issuetype", "resolution", "version", "component"} or (
        kind == "array" and schema.get("items") in {"string", "option", "user", "version", "component"}
    ) or name == "key" or custom in {"select", "multiselect", "radiobuttons", "multicheckboxes"}:
        kind = "choice"
        operators = ["=", "!=", "IN", "NOT IN", "IS EMPTY", "IS NOT EMPTY"]
    else:
        return None
    operators = [operator for operator in operators if operator in field.get("operators", [])]
    if not operators:
        return None
    return {"id": name, "name": field["name"], "value_type": kind, "operators": operators,
            "sortable": kind != "text" and field.get("orderable") is True}


def build_jql(project_key: str, query: JqlQuery, fields: list[dict], *, member_accounts: list[str] | None = None) -> str:
    query = JqlQuery.model_validate(query.model_dump())
    available = {item["id"]: item for field in fields if (item := field_contract(field)) is not None}

    def resolve(name):
        if name not in available:
            raise ValueError(f"Field '{name}' is not a supported searchable field in this Jira instance")
        reference = f"cf[{name.removeprefix('customfield_')}]" if re.fullmatch(r"customfield_[0-9]+", name) else _quote(name)
        return reference, available[name]

    def render_condition(condition):
        reference, field = resolve(condition.field)
        operator, value = condition.operator, condition.value
        if operator not in field["operators"]:
            raise ValueError(f"Operator '{operator}' is unsupported for field '{condition.field}'")
        if operator in {"IS EMPTY", "IS NOT EMPTY"}:
            if value is not None:
                raise ValueError("Empty checks cannot include a value")
            return f"{reference} {operator}"
        multiple = operator in {"IN", "NOT IN"}
        if multiple != isinstance(value, list) or value is None:
            raise ValueError("IN/NOT IN require a list; other operators require one value")
        rendered = []
        for item in value if multiple else [value]:
            if field["value_type"] == "number":
                if type(item) not in {int, float}:
                    raise ValueError("Numeric fields require numeric values")
                rendered.append(json.dumps(item, allow_nan=False))
            else:
                if not isinstance(item, str):
                    raise ValueError("This field requires text values")
                if field["value_type"] in {"date", "datetime"}:
                    if not re.fullmatch(r"-?[0-9]{1,5}[mhdw]", item):
                        try:
                            datetime.strptime(item, "%Y-%m-%d" if len(item) == 10 else "%Y-%m-%d %H:%M")
                        except ValueError:
                            raise ValueError("Dates require YYYY-MM-DD, YYYY-MM-DD HH:MM, or a relative duration such as -7d") from None
                if field["value_type"] == "text":
                    # Treat text as a literal phrase, not a user-authored Lucene expression.
                    _quote(item)
                    item = '"' + re.sub(r'([+\-!(){}\[\]^"~*?:\\/&|])', r'\\\1', item) + '"'
                rendered.append(_quote(item))
        operand = "(" + ", ".join(rendered) + ")" if multiple else rendered[0]
        return f"{reference} {operator} {operand}"

    def render_group(group):
        clauses = [render_condition(condition) for condition in group.filters]
        clauses.extend("(" + render_group(child) + ")" for child in group.groups)
        return (" AND " if group.match == "all" else " OR ").join(clauses)

    result = f"project = {_quote(project_key)}"
    expression = render_group(query)
    if expression:
        result += " AND (" + expression + ")"
    if query.assignees is not None:
        if not member_accounts or len(member_accounts) > 50:
            raise ValueError("Member-based queries require a nonempty resolved Jira account selection")
        result += " AND (" + render_condition(JqlFilter(field="assignee", operator="IN", value=member_accounts)) + ")"
    sorts = []
    for sort in query.order_by:
        reference, field = resolve(sort.field)
        if not field["sortable"]:
            raise ValueError(f"Field '{sort.field}' cannot be sorted by this builder")
        sorts.append(f"{reference} {sort.direction}")
    if sorts:
        result += " ORDER BY " + ", ".join(sorts)
    if len(result) > 4096:
        raise ValueError("Generated JQL exceeds 4096 characters")
    return result


def scope_jql_expression(jql: str, project_key: str) -> str:
    """Wrap only the expression, keeping a validated ORDER BY outside the scope guard."""
    clean = (jql or "").strip()
    if len(clean) > 4096 or any(ord(char) < 32 and char not in "\n\r\t" for char in clean):
        raise ValueError("Custom JQL exceeds its text bounds")
    if not clean:
        return f"project = {_quote(project_key)}"
    quote_char, escaped, depth, sort_at = None, False, 0, None
    for index, char in enumerate(clean):
        if escaped:
            escaped = False
            continue
        if quote_char:
            if char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = None
            continue
        if char in {"'", '"'}:
            quote_char = char
        elif char == "(":
            depth += 1
            if depth > 32:
                raise ValueError("JQL parentheses exceed the nesting limit")
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise ValueError("JQL parentheses are unbalanced")
        elif depth == 0 and (index == 0 or not clean[index - 1].isalnum()) and re.match(r"ORDER\s+BY\b", clean[index:], re.I):
            sort_at = index
            break
    if quote_char or depth:
        raise ValueError("JQL quotes or parentheses are unbalanced")
    expression = clean if sort_at is None else clean[:sort_at].strip()
    if not expression:
        raise ValueError("Custom JQL must include a filter before ORDER BY")
    result = f"project = {_quote(project_key)} AND ({expression})"
    if sort_at is not None:
        sort = re.sub(r"^ORDER\s+BY\s*", "", clean[sort_at:], flags=re.I)
        # Sort fields cannot carry new clauses, functions or an expression escape.
        field = r'(?:[A-Za-z][A-Za-z0-9_]*|cf\[[0-9]+\]|"[^"\\\r\n]+")'
        if not re.fullmatch(rf"{field}(?:\s+(?:ASC|DESC))?(?:\s*,\s*{field}(?:\s+(?:ASC|DESC))?){{0,2}}", sort, re.I):
            raise ValueError("ORDER BY requires at most three field names and optional ASC/DESC directions")
        result += " ORDER BY " + sort
    return result
