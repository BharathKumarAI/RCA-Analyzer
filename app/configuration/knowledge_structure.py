"""Human-readable knowledge blocks; source excerpts remain data, never executable tools."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class KnowledgeBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    kind: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=16000)

    @field_validator("kind", "title", "content")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Knowledge blocks cannot be blank")
        return value.strip()


class KnowledgeStructure(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    topic: str = Field(min_length=1, max_length=128)
    summary: str = Field(default="", max_length=2000)
    blocks: list[KnowledgeBlock] = Field(min_length=1, max_length=40)

    @field_validator("topic")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("A project topic is required")
        return value.strip()

    @model_validator(mode="after")
    def unique_blocks(self):
        self.blocks = list({(block.kind, block.title, block.content): block for block in self.blocks}.values())
        return self

    def markdown(self):
        # Collapse heading line breaks; block bodies are still rendered as safe Markdown.
        def heading(text):
            return " ".join(text.splitlines())
        sections = [f"# {heading(self.topic)}"]
        if self.summary.strip():
            sections.append(self.summary.strip())
        sections.extend(f"## {heading(block.title)}\n\nType: {heading(block.kind)}\n\n{block.content}" for block in self.blocks)
        return "\n\n".join(sections)


class KnowledgeCaptureSource(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    kind: Literal["document", "jira_ticket", "confluence", "feedback"]
    id: str = Field(min_length=1, max_length=512)
    content_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    metadata: dict = Field(default_factory=dict)


def structure_from_markdown(title: str, text: str, topic: str | None = None) -> KnowledgeStructure:
    """Split actual headings and bounded excerpts without inventing causes or instructions."""
    kinds = {"error": ("error", "symptom", "issue", "problem"),
             "system": ("system", "environment", "component", "architecture"),
             "responsibility": ("responsib", "owner", "role", "contact"),
             "process": ("process", "procedure", "workflow", "steps"),
             "query": ("query", "queries", "sql", "jql"),
             "sanity": ("sanity",), "check": ("check", "validat", "verif", "diagnos"),
             "resolution": ("resolution", "solution", "recovery", "remediat")}
    sections, heading, lines, fence = [], title, [], None
    for line in text.splitlines():
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            if fence is None:
                fence = marker[1]
            elif marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not line[marker.end():].strip():
                fence = None
        match = re.match(r"^#{1,6}\s+(.+?)\s*#*\s*$", line) if fence is None and not marker else None
        if match:
            if "\n".join(lines).strip():
                sections.append((heading, "\n".join(lines).strip()))
            heading, lines = match[1], []
        else:
            lines.append(line)
    if "\n".join(lines).strip():
        sections.append((heading, "\n".join(lines).strip()))
    blocks = []
    for heading, body in sections:
        kind = next((kind for kind, words in kinds.items() if any(word in heading.casefold() for word in words)), "reference")
        for start in range(0, len(body), 16000):
            blocks.append(KnowledgeBlock(kind=kind, title=heading[:256], content=body[start:start + 16000]))
    # Oversized sources must fail visibly, never silently drop their remaining sections.
    return KnowledgeStructure(topic=(topic or title)[:128], blocks=blocks)
