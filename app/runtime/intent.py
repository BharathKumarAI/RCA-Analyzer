"""Resolve natural requests against the current authorized capability catalog.

This is a bounded routing decision, not an evidence or language-model answer.
Unknown or ambiguous requests become persisted clarification turns. Execution
still enters the normal native ADK run with its original permission checks.
"""

from collections import Counter
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.capabilities.resolver import CapabilityResolver
from app.connectors.providers.registry import NATIVE_FACTORIES
from app.configuration.yaml_data import load_yaml_data
from app.persistence.chat_messages import save_exchange
from app.policy.redaction import redact


class IntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chat_id: str = Field(pattern=r"^chat_[0-9a-f]{32}$")
    prompt: str = Field(min_length=1, max_length=16000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=100)
    incident_id: str | None = Field(default=None, max_length=64)

    @field_validator("prompt")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Tell me what you want to investigate")
        return value.strip()


class IntentChoice(BaseModel):
    capability: str
    label: str
    prompt: str


class IntentResolution(BaseModel):
    status: Literal["ready", "clarification", "unsupported"]
    capability: str | None = None
    message: str
    reason_code: str
    catalog_hash: str
    choices: list[IntentChoice] = Field(default_factory=list)
    exchange_id: str | None = None
    message_id: str | None = None
    attachment_ids: list[str] = Field(default_factory=list)


STOP_WORDS = frozenset("a an and are as at be by can check could current data did do does explain for from have how i in is it me my of on or our please report review show summarize tell that the their these they this to use using was were what when where which who why with would you your".split())
# Source vocabulary only narrows a catalog candidate. It never defines tools or
# grants a capability absent from the authenticated, enabled catalog.
SOURCE_WORDS = {
    "itsm": {"jira", "ticket", "tickets", "issue", "issues"},
    "log_search": {"splunk", "log", "logs"},
    "confluence": {"confluence", "wiki"},
    "gitlab": {"gitlab", "commit", "commits", "pipeline", "pipelines"},
    "kubernetes": {"kubernetes", "k8s", "pod", "pods", "namespace"},
    "kafka": {"kafka", "topic", "topics"},
    "qtest": {"qtest"}, "signalfx": {"signalfx"},
    "oracle": {"oracle"}, "unix": {"unix", "sftp", "ssh"},
}
TICKET_KEY = re.compile(r"\b[A-Z][A-Z0-9_]{1,19}-[0-9]{1,12}\b", re.IGNORECASE)
WRITE_REQUEST = re.compile(
    r"^(?:(?:please|can you|could you|would you)\s+)*(?:"
    r"(?:create|update|delete|remove|restart|deploy)\s+(?:(?:a|an|the|this|that|new|existing|jira)\s+)*"
    r"(?:ticket|issue|record|database|service|pod|deployment|[a-z][a-z0-9_]{1,19}-[0-9]+)\b"
    r"|(?:execute|run)\s+(?:(?:a|an|the|this|that|new|existing|shell|python|bash)\s+)*"
    r"(?:sql|command|script)\b)", re.IGNORECASE,
)
FOLLOW_UP = re.compile(r"\b(?:that|those|these|it|same|again|rerun|more detail|what next|what should|next step)\b", re.IGNORECASE)


def words(text):
    return {word[:-1] if word.endswith("s") and len(word) > 4 else word
            for word in re.findall(r"[a-z][a-z0-9]{2,}", text.lower()) if word not in STOP_WORDS}


def declared_sources(capability):
    return {action.split(".", 1)[0] for action in capability.allowed_actions}


def metadata_words(registry, capability):
    parts = [capability.id.replace("_", " "), capability.name, capability.description]
    for skill_id in capability.skills:
        # Only attached skills reach this list; pending/revoked managed skills
        # have no capability binding and therefore cannot influence selection.
        content = registry.skill_contents.get(skill_id, "")
        end = content.find("\n---\n", 4) if content.startswith("---\n") else -1
        frontmatter = load_yaml_data(content[4:end]) if end >= 4 else {}
        if not isinstance(frontmatter, dict):
            frontmatter = {}
        parts += [str(frontmatter.get(key, "")) for key in ("name", "description", "summary")]
    return words(" ".join(parts))


def choices_for(candidates, prompt):
    return [IntentChoice(capability=cap.id, label=cap.name[:120], prompt=redact(prompt))
            for cap in candidates[:4]]


async def resolve_intent(state, principal, request: IntentRequest):
    await state.store.require_chat(request.chat_id, principal)
    if len(request.prompt) > state.settings.max_input_chars:
        raise ValueError("Question exceeds the configured size limit")
    if request.attachment_ids:
        runtime = state.registry.inheritance.runtime(principal, state.settings, state.platform.prompts)
        if not runtime["workflow"].attachments:
            raise PermissionError("Attachments are disabled for this project")
        files = await state.store.get_attachments(request.attachment_ids, principal)
        if any(item.get("chat_id") != request.chat_id for item in files):
            raise PermissionError("Attachments must belong to this conversation")

    registry = state.registry
    candidates = []
    unsupported = []
    supported_sources = set(NATIVE_FACTORIES) | set(state.runner.connectors)
    for definition in registry.list_all():
        resolved = CapabilityResolver(registry).resolve(definition.id, principal, check_health=False)
        if not resolved.is_authorized:
            continue
        capability = resolved.capability
        if set(capability.requires.connectors) <= supported_sources:
            candidates.append(capability)
        else:
            unsupported.append(capability)

    def answer(status, message, reason, capability=None, options=()):
        return IntentResolution(status=status, capability=capability.id if capability else None,
            message=message, reason_code=reason, catalog_hash=registry.content_hash,
            choices=choices_for(options, request.prompt), attachment_ids=request.attachment_ids)

    async def finish(result):
        if result.status != "ready":
            result.exchange_id, result.message_id = await save_exchange(
                state.store, principal, request.chat_id, request.prompt, result)
        return result

    if WRITE_REQUEST.search(request.prompt):
        return await finish(answer("unsupported",
            "I can inspect evidence and suggest next steps. I cannot change tickets, run commands, or modify systems.",
            "mutation_not_supported"))
    if not candidates:
        return await finish(answer("unsupported",
            "No investigation is available for your access in this project. Ask the project owner to enable an approved workflow.",
            "no_authorized_capability"))

    query = words(request.prompt)
    ticket = bool(request.incident_id or TICKET_KEY.search(request.prompt))
    raw_words = set(re.findall(r"[a-z0-9]+", request.prompt.lower()))
    sources = {source for source, aliases in SOURCE_WORDS.items() if raw_words & aliases}
    if ticket:
        sources.add("itsm")
    # Generic words like "logs" and "ticket" also describe local files. An
    # explicit provider name or ticket key still selects external evidence.
    local_file_request = (not ticket and bool(raw_words & {"attached", "attachment", "attachments", "file", "files"})
                          and sources <= {"itsm", "log_search"} and not raw_words & {"jira", "splunk"})
    if request.attachment_ids and (not sources or local_file_request):
        local = [cap for cap in candidates if not cap.allowed_actions and "file" in cap.agent_stages]
        if local:
            chosen = min(local, key=lambda cap: (len(cap.agent_stages), cap.id))
            return answer("ready", "I’ll review the files attached to this conversation.", "local_attachments", chosen)

    if not sources:
        local = [cap for cap in candidates if not cap.allowed_actions]
        knowledge = getattr(state, "knowledge", None)
        references = await knowledge.relevant(principal, request.prompt, max_items=1, max_chars=1024) if knowledge else []
        if local and references:
            return answer("ready", "I’ll use the approved project guidance and cite the source.",
                          "approved_project_knowledge", min(local, key=lambda cap: cap.id))

    available = [cap for cap in candidates if not sources or sources <= declared_sources(cap)]
    if sources and not available:
        known_but_unavailable = any(sources <= declared_sources(cap) for cap in unsupported)
        return await finish(answer("unsupported" if known_but_unavailable else "clarification",
            "That source is not supported by an available workflow in this project." if known_but_unavailable
            else "I cannot combine those sources with your available workflows. Which source should I inspect first?",
            "source_not_supported" if known_but_unavailable else "source_not_available",
            options=[cap for cap in candidates if declared_sources(cap) & sources]))

    if "itsm" in sources and not ticket:
        return await finish(answer("clarification",
            "Which incident should I review? Paste its ticket key, or attach the incident details.", "incident_reference_required"))
    if not sources and not request.attachment_ids and FOLLOW_UP.search(request.prompt):
        previous = await state.store.list_chat_runs(request.chat_id, principal, limit=1)
        if previous:
            previous_capability = previous[0].capability
            chosen = next((cap for cap in candidates if cap.id == previous_capability), None)
            if chosen:
                return answer("ready", "I’ll continue this investigation and check the evidence again.", "conversation_follow_up", chosen)

    vocabulary = {cap.id: metadata_words(registry, cap) for cap in available}
    frequencies = Counter(word for terms in vocabulary.values() for word in terms)
    ranked = sorted(available, key=lambda cap: (
        -sum(1 / frequencies[word] for word in query & vocabulary[cap.id]),
        len(cap.allowed_actions), len(cap.requires.connectors), cap.id,
    ))
    if ranked:
        def score(cap):
            return sum(1 / frequencies[word] for word in query & vocabulary[cap.id])
        top = score(ranked[0])
        unique = len(ranked) == 1 or top > score(ranked[1]) + 0.2
        if (sources and (unique or ticket or len(ranked) == 1)) or (unique and len(query & vocabulary[ranked[0].id]) >= 2):
            return answer("ready", "I’ll check the evidence available for that question.", "catalog_match", ranked[0])
        if sources:
            # Same source, no distinct task cue: take the existing workflow with
            # the fewest granted actions, preserving the narrowest permission set.
            narrow = min(ranked, key=lambda cap: (len(cap.allowed_actions), len(cap.requires.connectors), cap.id))
            return answer("ready", "I’ll review the requested source within this project.", "source_match", narrow)
    # A question with no catalog match should expose familiar starting points.
    # This affects suggestion order only; every choice was authorized above and
    # custom catalog entries remain the fallback if these workflows are absent.
    common = {name: index for index, name in enumerate((
        "incident_triage", "ticket_review", "log_correlation", "attachment_review"))}
    suggestions = ranked if ranked and score(ranked[0]) > 0 else sorted(
        candidates, key=lambda cap: (common.get(cap.id, len(common)), cap.name))
    return await finish(answer("clarification",
        "Tell me what you want to understand. You can include an incident ticket key, describe the logs to check, or attach a file.",
        "intent_unclear", options=suggestions))
