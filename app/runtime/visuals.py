"""Bounded, evidence-cited visual data; never executable rendering instructions."""

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictStr, StringConstraints, model_validator

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$")]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
EvidenceId = Annotated[str, Field(min_length=1, max_length=128)]
Cell = Union[Annotated[StrictStr, Field(max_length=1000)], Annotated[StrictFloat, Field(allow_inf_nan=False)], StrictBool, None]


class VisualModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CitedDatum(VisualModel):
    basis: Literal["observed", "inferred"]
    evidence_ids: list[EvidenceId] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def unique_citations(self):
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("Visual citations must be unique")
        return self


class VisualBase(VisualModel):
    id: Identifier
    title: Label
    description: str = Field(default="", max_length=1000)


class ChartPoint(CitedDatum):
    label: Label
    # ADK omits null object fields when forwarding validated workflow output.
    # Missing therefore retains the same unknown meaning on the second validation.
    value: Annotated[StrictFloat, Field(allow_inf_nan=False)] | None = None


class ChartVisual(VisualBase):
    kind: Literal["chart"]
    chart_type: Literal["bar", "line"]
    x_label: Label
    y_label: Label
    unit: Annotated[str, Field(min_length=1, max_length=40)]
    points: list[ChartPoint] = Field(min_length=1, max_length=48)

    @model_validator(mode="after")
    def unique_labels(self):
        if len({point.label for point in self.points}) != len(self.points):
            raise ValueError("Chart point labels must be unique")
        return self


class TableColumn(VisualModel):
    id: Identifier
    label: Label
    data_type: Literal["text", "number", "boolean", "timestamp"]
    unit: Annotated[str, Field(min_length=1, max_length=40)] | None = None

    @model_validator(mode="after")
    def numeric_unit(self):
        if self.data_type == "number" and self.unit is None:
            raise ValueError("Numerical columns require units (use count or ratio when appropriate)")
        return self


class TableRow(CitedDatum):
    cells: list[Cell] = Field(min_length=1, max_length=8)


class TableVisual(VisualBase):
    kind: Literal["table"]
    columns: list[TableColumn] = Field(min_length=1, max_length=8)
    rows: list[TableRow] = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def consistent_rows(self):
        if len({column.id for column in self.columns}) != len(self.columns):
            raise ValueError("Table column IDs must be unique")
        for row in self.rows:
            if len(row.cells) != len(self.columns):
                raise ValueError("Table rows must match the column count")
            for column, value in zip(self.columns, row.cells, strict=True):
                if value is None:
                    continue
                valid = {"text": isinstance(value, str), "number": type(value) in (int, float),
                         "boolean": isinstance(value, bool), "timestamp": isinstance(value, str)}
                if not valid[column.data_type]:
                    raise ValueError("Table cells must match their column type")
                if column.data_type == "timestamp":
                    try:
                        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    except ValueError as exc:
                        raise ValueError("Timestamp cells require an ISO 8601 timestamp") from exc
                    if timestamp.tzinfo is None:
                        raise ValueError("Timestamp cells require a timezone")
        return self


class CodeVisual(VisualBase, CitedDatum):
    kind: Literal["code"]
    language: Literal["text", "json", "yaml", "sql", "python", "javascript", "typescript", "shell", "java", "xml", "diff", "mermaid"]
    code: str = Field(min_length=1, max_length=8000)


class GraphNode(CitedDatum):
    id: Identifier
    label: Label
    node_type: Literal["service", "database", "queue", "host", "deployment", "external", "other"]
    status: Literal["affected", "degraded", "healthy", "unknown"] = "unknown"


class GraphEdge(CitedDatum):
    id: Identifier
    source: Identifier
    target: Identifier
    label: Label


class GraphVisual(VisualBase):
    kind: Literal["graph", "service_map", "blast_radius"]
    nodes: list[GraphNode] = Field(min_length=1, max_length=30)
    edges: list[GraphEdge] = Field(default_factory=list, max_length=60)
    focus_node_ids: list[Identifier] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def valid_topology(self):
        node_ids = {node.id for node in self.nodes}
        if len(node_ids) != len(self.nodes) or len({edge.id for edge in self.edges}) != len(self.edges):
            raise ValueError("Graph node and edge IDs must be unique")
        if any(edge.source not in node_ids or edge.target not in node_ids for edge in self.edges):
            raise ValueError("Graph edges must reference existing nodes")
        if not set(self.focus_node_ids).issubset(node_ids) or len(set(self.focus_node_ids)) != len(self.focus_node_ids):
            raise ValueError("Graph focus nodes must be existing unique nodes")
        if self.kind == "blast_radius" and not self.focus_node_ids:
            raise ValueError("Blast radius requires an explicit focus node")
        return self


def compatible_union_schema(schema):
    """Gemini supports anyOf; distinct kind literals keep the branches exclusive."""
    schema.pop("discriminator", None)
    if "oneOf" in schema:
        schema["anyOf"] = schema.pop("oneOf")


Visual = Annotated[Union[ChartVisual, TableVisual, CodeVisual, GraphVisual],
                   Field(discriminator="kind", json_schema_extra=compatible_union_schema)]


def visual_citations(visual: VisualBase) -> set[str]:
    if isinstance(visual, ChartVisual):
        records = visual.points
    elif isinstance(visual, TableVisual):
        records = visual.rows
    elif isinstance(visual, GraphVisual):
        records = [*visual.nodes, *visual.edges]
    else:
        records = [visual]
    return {evidence_id for record in records for evidence_id in record.evidence_ids}
