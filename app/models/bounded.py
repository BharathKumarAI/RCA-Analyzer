"""Native ADK model wrapper enforcing shared request concurrency and call limits."""

from typing import Any

from google.adk.models.base_llm import BaseLlm
from pydantic import Field


class BoundedModel(BaseLlm):
    delegate: BaseLlm
    limiter: Any = Field(exclude=True)
    budget: dict = Field(exclude=True)
    prepare_request: Any = Field(default=None, exclude=True)

    @property
    def capabilities(self):
        return self.delegate.capabilities

    async def generate_content_async(self, llm_request, stream=False):
        async with self.limiter:
            if self.prepare_request is not None:
                llm_request = await self.prepare_request(llm_request)
            if self.budget["calls"] >= self.budget["limit"]:
                raise RuntimeError("Model call budget exceeded")
            self.budget["calls"] += 1
            async for response in self.delegate.generate_content_async(
                llm_request, stream=stream
            ):
                yield response
