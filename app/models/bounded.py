"""Native ADK model wrapper enforcing shared request concurrency and call limits."""

from typing import Any
import asyncio
import time
import uuid

from google.adk.models.base_llm import BaseLlm
from pydantic import Field


class BoundedModel(BaseLlm):
    delegate: BaseLlm
    limiter: Any = Field(exclude=True)
    budget: dict = Field(exclude=True)
    prepare_request: Any = Field(default=None, exclude=True)
    record_call: Any = Field(default=None, exclude=True)

    @property
    def capabilities(self):
        return self.delegate.capabilities

    async def generate_content_async(self, llm_request, stream=False):
        queued_at = time.perf_counter()
        async with self.limiter:
            if self.prepare_request is not None:
                llm_request = await self.prepare_request(llm_request)
            if self.budget["calls"] >= self.budget["limit"]:
                raise RuntimeError("Model call budget exceeded")
            self.budget["calls"] += 1
            started = time.perf_counter()
            call_id = "model_" + uuid.uuid4().hex
            details = {"call_id": call_id, "model": self.model,
                       "queue_ms": (started - queued_at) * 1000}
            if self.record_call:
                await self.record_call("model_started", details)
            usage = None
            kind, error_type = "model_completed", None
            try:
                async for response in self.delegate.generate_content_async(llm_request, stream=stream):
                    if response.usage_metadata is not None:
                        # Streaming providers report cumulative usage; retain the
                        # last report once per invocation, never sum chunks.
                        metadata = response.usage_metadata
                        # Credential redaction intentionally masks "token" keys.
                        # Preserve only validated numerical usage counters under
                        # neutral names; never exempt raw provider metadata.
                        usage = {key: value for key, field in {
                            "input_count": "prompt_token_count", "output_count": "candidates_token_count",
                            "thinking_count": "thoughts_token_count", "total_count": "total_token_count",
                            "cached_input_count": "cached_content_token_count",
                        }.items() if type(value := getattr(metadata, field, None)) is int and 0 <= value <= 2**63 - 1}
                    if response.error_code:
                        kind, error_type = "model_failed", "ProviderError"
                    yield response
            except BaseException as exc:
                if kind != "model_failed":
                    kind = "model_cancelled" if isinstance(exc, (asyncio.CancelledError, GeneratorExit)) else "model_failed"
                    error_type = type(exc).__name__
                raise
            finally:
                if self.record_call:
                    await self.record_call(kind, details | {
                        "duration_ms": (time.perf_counter() - started) * 1000,
                        "usage_counts": usage, "error_type": error_type,
                    })
