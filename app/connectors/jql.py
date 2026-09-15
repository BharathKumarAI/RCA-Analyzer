"""Compile bounded, typed Jira filters; project scope comes only from the provider."""

import json
import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr

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


class JqlQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match: Literal["all", "any"] = "all"
    filters: list[JqlFilter] = Field(default_factory=list, max_length=30)
    order_by: list[JqlSort] = Field(default_factory=list, max_length=3)


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


def build_jql(project_key: str, query: JqlQuery, fields: list[dict]) -> str:
    query = JqlQuery.model_validate(query.model_dump())
    available = {item["id"]: item for field in fields if (item := field_contract(field)) is not None}

    def resolve(name):
        if name not in available:
            raise ValueError(f"Field '{name}' is not a supported searchable field in this Jira instance")
        reference = f"cf[{name.removeprefix('customfield_')}]" if re.fullmatch(r"customfield_[0-9]+", name) else _quote(name)
        return reference, available[name]

    clauses = []
    for condition in query.filters:
        reference, field = resolve(condition.field)
        operator, value = condition.operator, condition.value
        if operator not in field["operators"]:
            raise ValueError(f"Operator '{operator}' is unsupported for field '{condition.field}'")
        if operator in {"IS EMPTY", "IS NOT EMPTY"}:
            if value is not None:
                raise ValueError("Empty checks cannot include a value")
            clauses.append(f"{reference} {operator}")
            continue
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
        clauses.append(f"{reference} {operator} {operand}")
    result = f"project = {_quote(project_key)}"
    if clauses:
        result += " AND (" + (" AND " if query.match == "all" else " OR ").join(clauses) + ")"
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
    """Enforce strict project boundary on a dynamic JQL expression without boolean escape risks."""
    clean = (jql or "").strip()
    if not clean:
        return f'project = {_quote(project_key)}'

    # Reject unparenthesized cross-project overrides
    # Search for project = "OTHER" or project != "KEY" or project in (...)
    proj_pattern = re.compile(
        r'\bproject\s*(?:=|!=|IN|NOT\s+IN)\s*(?:([A-Za-z][A-Za-z0-9_]*)|"([^"]+)"|\(([^)]+)\))',
        re.IGNORECASE,
    )
    for match in proj_pattern.finditer(clean):
        single_bare, single_quoted, multiple = match.groups()
        if single_bare and single_bare.upper() != project_key.upper():
            raise ValueError(f"Cross-project query rejected: project '{single_bare}' differs from scoped project '{project_key}'")
        if single_quoted and single_quoted.upper() != project_key.upper():
            raise ValueError(f"Cross-project query rejected: project '{single_quoted}' differs from scoped project '{project_key}'")
        if multiple:
            keys = [k.strip().strip('"\'').upper() for k in multiple.split(",") if k.strip()]
            if any(k != project_key.upper() for k in keys):
                raise ValueError(f"Cross-project query rejected: project list [{multiple}] includes projects outside '{project_key}'")

    # If the expression already explicitly starts with project = "KEY" and has no outer OR operator, ensure safe grouping
    # Always parenthesize user expression so top-level OR cannot escape the project condition:
    # e.g., (project = "A") AND (status = Open OR project = "B")
    return f'project = {_quote(project_key)} AND ({clean})'

