"""Per-run tool policy, bounded evidence capture, and output redaction."""

import json
import uuid
from datetime import datetime, timezone

from app.policy.abac import AuthorizationContext
from app.policy.engine import PolicyDecisionType
from app.policy.redaction import exceeds_bounds, redact
from app.runtime.run_contract import content_hash
from app.schemas.evidence import EvidenceBundle, EvidenceSource

from app.tools.catalog import TOOL_ACTIONS


class RunGovernance:
    def __init__(self, contract, capability, policy, store, settings, tool_limit):
        self.contract = contract
        self.capability = capability
        self.policy = policy
        self.store = store
        self.settings = settings
        self.tool_limit = tool_limit
        self.tool_calls = 0
        self.evidence: list[dict] = []
        self.failures: list[str] = []
        self.truncated = False

    async def check_tool_budget(self):
        self.tool_calls += 1
        if self.tool_calls > self.tool_limit:
            raise PermissionError("Run tool-call limit exceeded")
        current = await self.store.get_run(
            self.contract.run_id, self.contract.principal
        )
        if not current or current.status != "RUNNING":
            raise PermissionError("Run is no longer active")

    async def before_tool(self, tool, args, tool_context):
        await self.check_tool_budget()
        action = TOOL_ACTIONS.get(tool.name)
        if action is None:
            raise PermissionError("Tool is not registered for governed execution")
        plan = getattr(tool_context, "state", {}).get("request_plan", {})
        request_types = set(
            plan.get("request_types", [])
            if isinstance(plan, dict)
            else getattr(plan, "request_types", [])
        )
        permitted_intents = {
            "itsm.get_ticket": {
                "triage",
                "root_cause_analysis",
                "tool_data_request",
                "sanity_check",
                "follow_up",
                "rerun",
            },
            "log_search.query_range": {
                "root_cause_analysis",
                "tool_data_request",
                "metrics",
                "sanity_check",
                "follow_up",
                "rerun",
            },
        }
        if request_types and not request_types.intersection(
            permitted_intents.get(action, set())
        ):
            raise PermissionError(f"Tool action is not relevant to the request intent: {action}")
        ctx = AuthorizationContext(
            principal=self.contract.principal,
            tenant_id=self.contract.tenant_id,
            project_id=self.contract.project_id,
            capability_id=self.contract.capability,
            action=action,
            resource_type="incident" if tool.name == "get_ticket" else "logs",
            resource_id=str(args.get("ticket_id", self.contract.project_id)),
            environment="PRODUCTION",
            is_mutation=False,
            attributes={"allowed_actions": self.capability.allowed_actions},
        )
        if self.policy.evaluate(ctx).decision not in {
            PolicyDecisionType.ALLOW,
            PolicyDecisionType.REDACT,
        }:
            raise PermissionError("Tool action denied by policy")
        return None

    async def after_tool(self, tool, args, tool_context, tool_response):
        if isinstance(tool_response, dict) and "error" in tool_response:
            return redact(tool_response)
        return await self.capture(
            TOOL_ACTIONS[tool.name].split(".")[0], tool.name, args, tool_response
        )

    async def on_tool_error(self, tool, args, tool_context, error):
        # Provider messages and exception bodies can contain credential-bearing
        # URLs or raw payloads. Expose only stable names, never exception text.
        self.failures.append(f"{tool.name} did not complete ({type(error).__name__})")
        return {
            "error": "The connector operation could not complete. Treat this source as unavailable."
        }

    async def capture(self, connector, operation, query, data):
        if len(self.evidence) >= self.settings.max_evidence_items:
            raise PermissionError("Evidence item limit exceeded")
        self.truncated |= exceeds_bounds(
            data, max_text=self.settings.max_evidence_chars
        )
        clean = redact(data, max_text=self.settings.max_evidence_chars)
        serialized = json.dumps(clean, ensure_ascii=False)
        if len(serialized) > self.settings.max_evidence_chars:
            clean = {
                "excerpt": serialized[: self.settings.max_evidence_chars],
                "truncated": True,
            }
            self.truncated = True
        evidence_id = "ev_" + uuid.uuid4().hex
        bundle = EvidenceBundle(
            evidence_id=evidence_id,
            run_id=self.contract.run_id,
            tenant_id=self.contract.tenant_id,
            project_id=self.contract.project_id,
            source=EvidenceSource(connector=connector, system=operation),
            query_json=json.dumps(redact(query), sort_keys=True),
            observed_at=datetime.now(timezone.utc).isoformat(),
            content_json=json.dumps(clean, ensure_ascii=False, sort_keys=True),
            content_hash=content_hash(clean),
        )
        await self.store.save(bundle, self.contract.principal)
        result = {"evidence_id": evidence_id, "source": connector, "data": clean}
        self.evidence.append(result)
        return result

    def context(self) -> str:
        included = []
        size = 0
        for item in self.evidence:
            encoded = json.dumps(item, ensure_ascii=False)
            if size + len(encoded) > self.settings.max_context_chars:
                self.truncated = True
                break
            included.append(item)
            size += len(encoded)
        return json.dumps(
            {
                "evidence": included,
                "unavailable_sources": self.failures,
                "truncated": self.truncated,
            },
            ensure_ascii=False,
        )

    async def after_model(self, callback_context, llm_response):
        if llm_response.content:
            for part in llm_response.content.parts or []:
                if part.text and not part.thought:
                    part.text = redact(part.text)
                if part.function_call and part.function_call.args:
                    part.function_call.args = redact(part.function_call.args)
        return llm_response
