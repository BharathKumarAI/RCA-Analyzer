"""Request planning for the multi-purpose ADK entrypoint."""

from typing import Literal

from google.adk.agents import LlmAgent
from pydantic import BaseModel, ConfigDict, Field


class RequestPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_types: list[
        Literal[
            "triage",
            "root_cause_analysis",
            "tool_data_request",
            "metrics",
            "sanity_check",
            "project_knowledge",
            "generic_answer",
            "follow_up",
            "rerun",
        ]
    ] = Field(default_factory=lambda: ["generic_answer"], max_length=4)
    goals: list[str] = Field(default_factory=list, max_length=8)
    data_needed: list[str] = Field(default_factory=list, max_length=12)
    follow_up_questions: list[str] = Field(default_factory=list, max_length=8)
    presentation: Literal["summary", "table", "timeline", "dashboard", "report"] = (
        "summary"
    )


def build_orchestrator(model, config, governance, instruction):
    return LlmAgent(
        name="request_orchestrator",
        model=model,
        description="Classify a request, select bounded work, and choose a presentation format.",
        instruction=instruction,
        output_key="request_plan",
        output_schema=RequestPlan,
        include_contents="none",
        generate_content_config=config.generation_config(),
        after_model_callback=governance.after_model,
    )
