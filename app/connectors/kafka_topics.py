"""Bounded topic-name selection within a saved connection's authorized resources."""

import fnmatch
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

TopicName = Annotated[str, Field(min_length=1, max_length=249, pattern=r"^[A-Za-z0-9._-]+$")]


class TopicCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operator: Literal["equals", "starts_with", "contains", "glob"]
    value: str = Field(min_length=1, max_length=249, pattern=r"^[A-Za-z0-9._*?-]+$")

    @model_validator(mode="after")
    def wildcard_only_in_glob(self):
        if self.operator != "glob" and any(char in self.value for char in "*?"):
            raise ValueError("Wildcards require the Glob operator")
        return self

    def matches(self, topic):
        return {"equals": lambda: topic == self.value, "starts_with": lambda: topic.startswith(self.value),
                "contains": lambda: self.value in topic, "glob": lambda: fnmatch.fnmatchcase(topic, self.value)}[self.operator]()


class KafkaTopicSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["explicit", "filters"]
    topics: list[TopicName] = Field(default_factory=list, max_length=50)
    include: list[TopicCondition] = Field(default_factory=list, max_length=20)
    exclude: list[TopicCondition] = Field(default_factory=list, max_length=20)
    max_matched_topics: int = Field(default=10, ge=1, le=50, strict=True)

    @model_validator(mode="after")
    def coherent(self):
        if self.mode == "explicit" and (not self.topics or self.include or self.exclude):
            raise ValueError("Explicit selection requires topics and excludes name filters")
        if self.mode == "filters" and (self.topics or not self.include):
            raise ValueError("Filter selection requires an include condition and no explicit topics")
        if len(set(self.topics)) != len(self.topics) or any(topic in {".", ".."} for topic in self.topics):
            raise ValueError("Topic names must be unique valid Kafka names")
        return self


def authorized_topics(definition):
    """Never trust a caller's resource_scope field: use the selected saved record."""
    connection_id = definition.get("connection_id")
    if connection_id:
        records = [row for row in definition.get("environment_connections", []) if row.get("connection_id") == connection_id]
        if len(records) != 1:
            raise ValueError("Kafka topic selection requires its saved environment connection")
        return records[0].get("resource_scope_json", records[0].get("resource_scope", []))
    return [definition.get("external_resource") or definition.get("topic")]


def select_topics(allowed, selection: KafkaTopicSelection):
    import re

    if not isinstance(allowed, list) or not allowed or len(allowed) > 1000 or any(
        not isinstance(topic, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,249}", topic) or topic in {".", ".."}
        for topic in allowed
    ):
        raise ValueError("The saved connection must authorize 1–1000 explicit Kafka topic names")
    if selection.mode == "explicit":
        if not set(selection.topics) <= set(allowed):
            raise ValueError("Selected topics are outside the saved connection's resource scope")
        matched = sorted(selection.topics)
    else:
        matched = sorted(topic for topic in set(allowed)
                         if any(condition.matches(topic) for condition in selection.include)
                         and not any(condition.matches(topic) for condition in selection.exclude))
    if len(matched) > selection.max_matched_topics:
        raise ValueError("Too many authorized topics match; narrow the selection before reading")
    return matched
