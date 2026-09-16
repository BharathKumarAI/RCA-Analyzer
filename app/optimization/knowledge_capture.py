"""Bounded, resumable source capture. Recorded facts become drafts, never approvals."""

import asyncio
import calendar
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
import re
import time
from urllib.parse import quote

from sqlalchemy import func, select

from app.capabilities.resolver import CapabilityResolver
from app.configuration.knowledge import KnowledgeAssociations, KnowledgeConflict, documents
from app.configuration.knowledge_structure import structure_from_markdown
from app.connectors.base import ConnectorError
from app.connectors.providers.evidence import ConfluenceConnector
from app.connectors.providers.jira import JiraConnector, adf_to_text
from app.policy.redaction import redact
from app.runtime.run_contract import content_hash


SOURCE_ACCESS = {"closed_tickets": ("itsm", "itsm.get_ticket", JiraConnector),
                 "confluence": ("confluence", "confluence.read_evidence", ConfluenceConnector)}


def capture_source_id(selection, source_id):
    """Escape the environment separator so reconciliation cannot widen its scope."""
    return selection.instance_id + ":" + quote(selection.environment_id or "", safe="") + ":" + source_id


def feedback_capture_hash(row):
    payload = row.get("payload") or json.loads(row["payload_json"])
    verification = row.get("verification") or json.loads(row["verified_json"] or "null")
    return content_hash({"candidate_id": row["candidate_id"], "revision": row["revision"],
                         "source_run_id": row["source_run_id"], "source_snapshot_hash": payload["run_snapshot_hash"],
                         "verification": verification, "verifier_subject": row["verifier_subject"]})


def utc_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


def capture_window(months, now=None):
    end = now or datetime.now(timezone.utc)
    absolute = end.year * 12 + end.month - 1 - months
    year, month = divmod(absolute, 12)
    start = end.replace(year=year, month=month + 1, day=min(end.day, calendar.monthrange(year, month + 1)[1]))
    return start.isoformat(), end.isoformat()


class StorageText(HTMLParser):
    """Extract text only. No macro evaluation, assets, links, or remote expansion."""
    def __init__(self, maximum):
        super().__init__(convert_charrefs=True)
        self.parts, self.size, self.maximum, self.hidden = [], 0, maximum, []

    def append(self, text):
        self.size += len(text)
        if self.size > self.maximum:
            raise ValueError("Confluence page exceeds the configured text limit")
        self.parts.append(text)

    def handle_starttag(self, tag, attrs):
        if self.hidden or tag in {"script", "style", "iframe", "object", "ac:structured-macro"}:
            self.hidden.append(tag)
            return
        if re.fullmatch(r"h[1-6]", tag):
            self.append("\n" + "#" * int(tag[1]) + " ")
        elif tag in {"p", "div", "br", "li", "tr"}:
            self.append("\n")
        elif tag in {"td", "th"}:
            self.append(" | ")

    def handle_endtag(self, tag):
        if self.hidden:
            if tag in self.hidden:
                self.hidden = self.hidden[:self.hidden.index(tag)]
            return
        if tag in {"p", "div", "li", "tr", "pre"} or re.fullmatch(r"h[1-6]", tag):
            self.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.append(data)


def storage_text(value, maximum):
    if not isinstance(value, str) or len(value) > 4 * maximum:
        raise ValueError("Confluence storage body is unavailable or exceeds its bound")
    parser = StorageText(maximum)
    parser.feed(value)
    parser.close()
    return "".join(parser.parts).strip()


class KnowledgeCaptureService:
    def __init__(self, improvement):
        self.service = improvement
        self.knowledge, self.runner = improvement.knowledge, improvement.runner

    async def validate(self, payload, principal):
        for source in payload.source_capabilities:
            adapter, action, _ = SOURCE_ACCESS[source]
            resolved = CapabilityResolver(self.service.optimizations.registry).resolve(payload.source_capabilities[source], principal, check_health=False)
            if not resolved.is_authorized or action not in resolved.capability.allowed_actions or adapter not in set(resolved.required_connectors + resolved.optional_connectors):
                raise PermissionError("Capture capability does not authorize the selected source")
            if self.runner is None:
                raise ValueError("Live capture runtime is unavailable")
            identities, _ = await self.runner._connectors_for_run(principal, {adapter}, {adapter}, {adapter: payload.connector_selections[adapter]}, identities_only=True)
            if identities.get(adapter) != payload.connector_selections[adapter]:
                raise PermissionError("Capture requires the exact saved connector scope")

    @asynccontextmanager
    async def provider(self, principal, source, payload):
        await self.validate(payload, principal)
        adapter, _, provider_type = SOURCE_ACCESS[source]
        async with self.runner._run_slot():
            providers, created = await self.runner._connectors_for_run(principal, {adapter}, {adapter}, {adapter: payload.connector_selections[adapter]})
            try:
                provider = providers.get(adapter)
                if not isinstance(provider, provider_type):
                    raise ValueError("This capture source requires its native paginated read-only provider")
                async with asyncio.timeout(120):
                    yield provider, payload.connector_selections[adapter]
            finally:
                await asyncio.gather(*(item.aclose() for item in created), return_exceptions=True)

    def associations(self, selection, capability):
        return KnowledgeAssociations(capability_ids=[capability], connector_instance_ids=[selection.instance_id],
                                     environment_ids=[selection.environment_id] if selection.environment_id else [])

    async def ingest(self, principal, source, title, text, topic=None, associations=None):
        maximum = self.service.max_capture_text_chars
        if not maximum:
            raise ValueError("Knowledge capture text limit is not configured")
        if not isinstance(text, str) or len(text) > maximum:
            raise ValueError("Capture content exceeds the configured text limit")
        text = redact(text, max_text=maximum)
        if not text.strip():
            return None
        return await self.knowledge.ingest_capture(principal, source=source, title=title[:256],
            structure=structure_from_markdown(title, text, topic), max_text_chars=maximum, associations=associations)

    async def capture_ticket(self, principal, issue, selection, capability, topic=None, *, observed_at):
        """Shared closure hook accepts scoped Jira search records or normalized get_ticket."""
        fields = issue.get("fields")
        if fields is None:
            fields = {**issue, "resolutiondate": issue.get("resolved")}
        if not isinstance(fields, dict) or not utc_timestamp(fields.get("resolutiondate")):
            return None
        status = fields.get("status")
        category = (status.get("statusCategory") or {}).get("key") if isinstance(status, dict) else fields.get("status_category")
        if category != "done":
            return None
        modified = utc_timestamp(fields.get("updated"))
        if modified is None:
            raise ValueError("Jira capture requires an authoritative modification timestamp")
        key = issue.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*-[0-9]+", key):
            raise ConnectorError("Jira capture ticket identity is invalid")
        description = fields.get("description") or ""
        if isinstance(description, (dict, list)):
            description = adf_to_text(description, max_chars=self.service.max_capture_text_chars)
        components = [item.get("name", "") if isinstance(item, dict) else item for item in fields.get("components", []) if isinstance(item, (dict, str))]
        resolution = fields.get("resolution")
        resolution = resolution.get("name", "") if isinstance(resolution, dict) else resolution or ""
        title = key + " — " + str(fields.get("summary") or key)
        comments = fields.get("comments") or []
        if not isinstance(comments, list):
            raise ValueError("Jira capture comments are invalid")
        comment_text = []
        for comment in comments[:50]:
            if not isinstance(comment, dict):
                raise ValueError("Jira capture comment is invalid")
            body = comment.get("body") or ""
            if isinstance(body, (dict, list)):
                body = adf_to_text(body, max_chars=self.service.max_capture_text_chars)
            comment_text.append("Recorded comment " + str(comment.get("id") or "") + " (" + str(comment.get("created") or "time unavailable") + "):\n" + str(body))
        mapped = fields.get("mapped_custom_fields") or {}
        if not isinstance(mapped, dict):
            raise ValueError("Jira capture mapped fields are invalid")
        mapped_text = []
        for label, value in mapped.items():
            value = adf_to_text(value, max_chars=self.service.max_capture_text_chars) if isinstance(value, dict) and value.get("type") == "doc" else value
            mapped_text.append(str(label) + ": " + (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)))
        partial_comments = bool(fields.get("comments_truncated")) or len(comments) > 50
        notes = "Recorded comments are source statements, not independently confirmed causes. Attachments are not included."
        if partial_comments:
            notes += " Comment history is partial: " + str(min(len(comments), 50)) + " returned of " + str(fields.get("comments_count", "unknown")) + "."
        text = "\n\n".join(["## Recorded issue\n" + str(description),
            "## Recorded resolution\n" + (str(resolution) or "No resolution description was supplied by the source."),
            "## Mapped source fields\n" + ("\n".join(mapped_text) or "No mapped fields were returned."),
            "## Recorded discussion\n" + ("\n\n".join(comment_text) or "No comments were returned."),
            "## Source record\nTicket: " + key + "\nResolved: " + fields["resolutiondate"] +
            ("\nComponents: " + ", ".join(components) if components else "") + "\n" + notes])
        # The immutable draft clearly declares excerpts; no hidden truncation or
        # inference converts an incomplete discussion into a confirmed cause.
        budget = max(1, self.service.max_capture_text_chars - 2000)
        partial_text = len(text) > budget
        if partial_text:
            text = text[:budget] + "\n\n## Extraction limits\nSource content is partial because it exceeded the configured text limit. " + notes
        text = redact(text, max_text=self.service.max_capture_text_chars)
        snapshot = {"key": key, "title": redact(title), "text": text}
        source = {"kind": "jira_ticket", "id": capture_source_id(selection, key),
                  "content_hash": content_hash(snapshot), "metadata": {"ticket_id": key, "capability": capability,
                  "instance_id": selection.instance_id, "environment_id": selection.environment_id,
                  "resolved_at": fields["resolutiondate"], "modified_at": modified.timestamp(), "observed_at": observed_at,
                  "comments_returned": min(len(comments), 50), "comments_total": fields.get("comments_count"),
                  "partial_comments": partial_comments, "partial_text": partial_text,
                  "extraction": "recorded_fields_mapped_fields_and_returned_comments_without_attachments"}}
        return await self.ingest(principal, source, title, text, topic or (components[0] if components else None), self.associations(selection, capability))

    async def reconcile_confluence(self, payload, principal, state):
        # Only a fully traversed authorized inventory reaches this phase. A
        # concurrent newer observation wins over this scan's start timestamp.
        from app.configuration.knowledge import knowledge_captures
        selected = payload.connector_selections["confluence"]
        prefix = capture_source_id(selected, "")
        scan_start = datetime.fromisoformat(state["window_end"]).timestamp()
        statement = select(knowledge_captures.c.source_id).where(
            self.service.scope(knowledge_captures, principal), knowledge_captures.c.source_kind == "confluence",
            knowledge_captures.c.source_id.startswith(prefix, autoescape=True),
        ).group_by(knowledge_captures.c.source_id).having(func.max(knowledge_captures.c.last_seen_at) < scan_start)
        if state.get("cursor"):
            statement = statement.where(knowledge_captures.c.source_id > state["cursor"])
        async with self.service.engine.connect() as connection:
            identifiers = list((await connection.execute(statement.order_by(knowledge_captures.c.source_id).limit(payload.limit + 1))).scalars())
        for identifier in identifiers[:payload.limit]:
            await self.knowledge.mark_source_unavailable(principal, "confluence", identifier, observed_at=scan_start)
            state["unavailable"] = state.get("unavailable", 0) + 1
        return identifiers[payload.limit - 1] if len(identifiers) > payload.limit else None

    async def page(self, payload, principal, state):
        source = payload.sources[state["source_index"]]
        cursor, limit = state.get("cursor"), payload.limit
        if source == "feedback" and state.get("phase") != "verified":
            from app.optimization.improvement_models import ImprovementJob
            prepared = await self.service.prepare(ImprovementJob(kind="prepare_feedback", limit=limit), principal,
                after_source_key=cursor, before=datetime.fromisoformat(state["window_end"]).timestamp())
            state["feedback_candidates_created"] = state.get("feedback_candidates_created", 0) + prepared["created"]
            state["feedback_signals_inspected"] = state.get("feedback_signals_inspected", 0) + prepared["inspected"]
            state["feedback_signals_unavailable"] = state.get("feedback_signals_unavailable", 0) + len(prepared["skipped"]) + prepared["unauthorized"]
            if not prepared["next_cursor"]:
                state["phase"] = "verified"
            return [], prepared["next_cursor"], 0, False
        if source == "confluence" and state.get("phase") == "reconcile":
            next_cursor = await self.reconcile_confluence(payload, principal, state)
            return [], next_cursor, 0, next_cursor is None
        outcomes, next_cursor, seen = [], None, 0
        if source in {"documents", "feedback"}:
            from app.optimization.improvement import candidates
            table, key = (documents, documents.c.doc_id) if source == "documents" else (candidates, candidates.c.candidate_id)
            condition = table.c.status == ("approved" if source == "documents" else "VERIFIED")
            statement = select(table).where(self.service.scope(table, principal), condition, table.c.updated_at <= datetime.fromisoformat(state["window_end"]).timestamp())
            if cursor:
                statement = statement.where(key > cursor)
            async with self.service.engine.connect() as connection:
                rows = (await connection.execute(statement.order_by(key).limit(limit + 1))).mappings().all()
            has_more, rows = len(rows) > limit, rows[:limit]
            next_cursor = rows[-1][key.name] if has_more else None
            for row in rows:
                seen += 1
                if source == "documents":
                    if row.get("capture"):
                        continue
                    try:
                        original = (await self.knowledge.frozen_corpus(principal, document_ids=[row["doc_id"]], max_documents=1))[0]
                    except KnowledgeConflict:
                        continue
                    outcomes.append(await self.ingest(principal, {"kind": "document", "id": original["doc_id"], "content_hash": original["content_hash"], "metadata": {"revision": original["revision"]}}, original["title"], original["content"], payload.topic or original["category"], KnowledgeAssociations.model_validate(original["associations"]) if original.get("associations") else None))
                else:
                    if not row["verifier_subject"] or row["verifier_subject"] in {row["author_subject"], row["source_subject"]}:
                        continue
                    resolved = CapabilityResolver(self.service.optimizations.registry).resolve(row["capability"], principal, check_health=False)
                    if not resolved.is_authorized:
                        continue
                    candidate = self.service.view(row)
                    case = self.service.case(candidate)
                    scope = candidate["payload"].get("knowledge_scope") or {}
                    associations = KnowledgeAssociations(capability_ids=[row["capability"]], environment_ids=scope.get("environment_ids", []), connector_instance_ids=scope.get("instance_ids", []))
                    text = "## Verified observations\n" + "\n".join("- " + fact for fact in case.expected_facts) + "\n\n## Source record\nOutcome: " + case.expected_outcome + "\nInvestigation: " + row["source_run_id"]
                    outcomes.append(await self.ingest(principal, {"kind": "feedback", "id": row["candidate_id"], "content_hash": feedback_capture_hash(row), "metadata": case.provenance | {"modified_at": row["updated_at"]}}, "Verified feedback: " + (case.incident_id or row["source_run_id"]), text, payload.topic, associations))
        else:
            async with self.provider(principal, source, payload) as (provider, selection):
                if source == "closed_tickets":
                    start, end = datetime.fromisoformat(state["window_start"]), datetime.fromisoformat(state["window_end"])
                    # Jira date literals use the account timezone. Broaden the query,
                    # then enforce the exact UTC half-open interval on recorded fields.
                    query = 'statusCategory = Done AND resolved >= "' + (start - timedelta(days=1)).strftime("%Y-%m-%d") + '" AND resolved <= "' + (end + timedelta(days=1)).strftime("%Y-%m-%d") + '" ORDER BY resolved ASC, key ASC'
                    result = await provider.search_issues(query, max_results=min(limit, 50), next_page_token=cursor,
                        fields=["summary", "status", "description", "resolutiondate", "resolution", "components", "updated"])
                    next_cursor = result.get("nextPageToken")
                    if result.get("possibly_truncated") and not next_cursor:
                        raise ConnectorError("Jira capture is incomplete and supplied no continuation cursor")
                    for issue in result["issues"]:
                        seen += 1
                        resolved = utc_timestamp(issue.get("fields", {}).get("resolutiondate"))
                        if resolved and start <= resolved < end:
                            # Both backfill and closure watches use the same normalized
                            # bounded record, including governed mapped fields/comments.
                            observed_at = time.time()
                            ticket = await provider.get_ticket(issue["key"])
                            actual_resolution = utc_timestamp(ticket.get("resolved"))
                            if actual_resolution and start <= actual_resolution < end:
                                outcomes.append(await self.capture_ticket(principal, ticket, selection, payload.source_capabilities[source], payload.topic, observed_at=observed_at))
                else:
                    observed_at = time.time()
                    result = await provider.read_capture_page(cursor=cursor, limit=limit)
                    next_cursor = result["next_cursor"]
                    for page in result["items"]:
                        seen += 1
                        if page.get("status") != "current":
                            continue
                        version = page.get("version") or {}
                        modified = utc_timestamp(version.get("createdAt") or version.get("when")) if isinstance(version, dict) else None
                        if modified is None:
                            raise ValueError("Confluence capture requires an authoritative version timestamp")
                        text = storage_text((page.get("body") or {}).get("storage", {}).get("value"), self.service.max_capture_text_chars)
                        title = str(page.get("title") or page["id"])
                        snapshot = redact({"id": page["id"], "title": title, "text": text, "version": page.get("version"), "status": page["status"]}, max_text=self.service.max_capture_text_chars)
                        record = {"kind": "confluence", "id": capture_source_id(selection, str(page["id"])), "content_hash": content_hash(snapshot), "metadata": {"page_id": str(page["id"]), "modified_at": modified.timestamp(), "observed_at": observed_at, "space_id": str(page["spaceId"]), "version": page.get("version"), "instance_id": selection.instance_id, "environment_id": selection.environment_id, "capability": payload.source_capabilities[source], "extraction": "storage_text_without_macros_or_assets"}}
                        outcomes.append(await self.ingest(principal, record, title, text, payload.topic, self.associations(selection, payload.source_capabilities[source])))
        complete = next_cursor is None
        if source == "confluence" and complete:
            state["phase"] = "reconcile"
            complete = False
        return outcomes, next_cursor, seen, complete

    async def execute(self, payload, principal, checkpoint=None, progress=None):
        await self.validate(payload, principal)
        if checkpoint:
            state = dict(checkpoint)
        else:
            months = payload.lookback_months or (await self.knowledge.capture_settings(principal))["lookback_months"]
            start, end = capture_window(months)
            state = {"status": "CONTINUE", "window_start": start, "window_end": end, "source_index": 0, "cursor": None,
                     "created": 0, "unchanged": 0, "skipped": 0, "processed": 0, "document_ids": [], "pages": 0, "cursor_hashes": []}
            if progress:
                await progress(state)
        if state["source_index"] >= len(payload.sources):
            return state | {"status": "COMPLETE", "possibly_truncated": False}
        if state["pages"] >= 1000:
            raise ValueError("Capture reached its 1000-page bound; narrow the sources before restarting")
        outcomes, cursor, seen, complete_source = await self.page(payload, principal, state)
        completed = [row for row in outcomes if row is not None]
        state["processed"] += seen
        state["skipped"] += seen - len(completed)
        for outcome in completed:
            state[outcome["capture_outcome"]] += 1
            if outcome["doc_id"] not in state["document_ids"] and len(state["document_ids"]) < 100:
                state["document_ids"].append(outcome["doc_id"])
        state["document_ids_limited"] = state["created"] + state["unchanged"] > len(state["document_ids"])
        state["pages"] += 1
        if cursor:
            fingerprint = content_hash(cursor)
            if fingerprint in state["cursor_hashes"]:
                raise ConnectorError("Capture pagination repeated a cursor")
            state["cursor_hashes"] = [*state["cursor_hashes"], fingerprint]
            state["cursor"] = cursor
        elif complete_source:
            state["source_index"] += 1
            state.pop("phase", None)
            state["cursor"], state["cursor_hashes"] = None, []
        else:
            state["cursor"], state["cursor_hashes"] = None, []
        state["status"] = "COMPLETE" if state["source_index"] >= len(payload.sources) else "CONTINUE"
        state["possibly_truncated"] = state["status"] != "COMPLETE"
        if progress:
            await progress(state)
        return state
