"""Project bounded evidence into a complete, size-checked ADK request."""

import json
from collections import defaultdict
from itertools import zip_longest

from pydantic import BaseModel
from google.adk.models.llm_request import LlmRequest


class ContextLimitExceeded(ValueError):
    """Required model input cannot fit without dropping instructions."""


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def request_size(request: LlmRequest) -> int:
    config = request.config.model_dump(
        mode="json", exclude_none=True, exclude={"response_schema"}
    )
    schema = request.config.response_schema
    if schema is not None:
        config["response_schema"] = (
            schema.model_json_schema()
            if isinstance(schema, type) and issubclass(schema, BaseModel)
            else schema.model_dump(mode="json", exclude_none=True)
            if isinstance(schema, BaseModel)
            else schema
        )
    return len(encoded({
        "contents": [c.model_dump(mode="json", exclude_none=True) for c in request.contents],
        "config": config,
    }))


def evidence_context(evidence: list[dict], failures: list[str], limit: int) -> str:
    """Round-robin sources, then expand excerpts equally within the JSON budget."""
    sources = defaultdict(list)
    serialized = {item["evidence_id"]: encoded(item["data"]) for item in evidence}
    for item in sorted(evidence, key=lambda item: (item["source"], serialized[item["evidence_id"]], item["evidence_id"])):
        sources[item["source"]].append(item)
    ordered = [item for row in zip_longest(*sources.values()) for item in row if item]
    selected = []

    def render(excerpt_chars):
        items = []
        truncated = len(selected) != len(ordered)
        for item in selected:
            text = serialized[item["evidence_id"]]
            data = item["data"]
            if len(text) > excerpt_chars:
                data = {"excerpt": text[:excerpt_chars], "truncated": True}
                truncated = True
            items.append({**item, "data": data})
        return encoded({
            "evidence": items,
            "unavailable_sources": failures,
            "omitted_evidence_count": len(ordered) - len(selected),
            "truncated": truncated,
        })

    # Keep metadata and a small excerpt before enlarging any individual source.
    for item in ordered:
        selected.append(item)
        if len(render(80)) > limit:
            selected.pop()
    low, high = 80, max((len(serialized[i["evidence_id"]]) for i in selected), default=80)
    high = max(low, high)
    while low < high:
        middle = (low + high + 1) // 2
        if len(render(middle)) <= limit:
            low = middle
        else:
            high = middle - 1
    return render(low)


def fit_evidence(
    request: LlmRequest, contexts: dict[str, list[dict]], failures: list[str], limit: int
) -> tuple[LlmRequest, list[dict]]:
    """Expand only server-owned markers; never edit required instructions/history."""
    request = request.model_copy(update={
        "contents": [c.model_copy(deep=True) for c in request.contents],
        "config": request.config.model_copy(deep=True),
    })
    slots = [(part, part.text) for content in request.contents
             for part in content.parts or [] if part.text]
    instruction = request.config.system_instruction
    if isinstance(instruction, str):
        slots.append((request.config, instruction))
    elif instruction is not None:
        slots.extend((part, part.text) for part in instruction.parts or [] if part.text)
    active = {marker: items for marker, items in contexts.items()
              if any(marker in text for _, text in slots)}

    def render(budget):
        projected = {marker: evidence_context(items, failures, budget)
                     for marker, items in active.items()}
        for target, original in slots:
            text = original
            for marker, value in projected.items():
                text = text.replace(marker, value)
            if target is request.config:
                target.system_instruction = text
            else:
                target.text = text
        return projected

    # Required content includes schema, tool declarations, history, and metadata.
    render(0)
    if request_size(request) > limit:
        raise ContextLimitExceeded("Required model context exceeds the configured character limit")
    if not active:
        return request, []
    low, high = 0, limit
    while low < high:
        middle = (low + high + 1) // 2
        render(middle)
        if request_size(request) <= limit:
            low = middle
        else:
            high = middle - 1
    projected = render(low)
    return request, [json.loads(value) for value in projected.values()]
