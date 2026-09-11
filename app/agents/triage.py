"""Fast triage stage; source content is data, never executable instructions."""

from google.adk.agents import LlmAgent


def build_triage(model, config, tools, governance, instruction):
    return LlmAgent(
        name="triage_agent",
        model=model,
        description="Retrieve the incident and extract its time window, impact and hypotheses.",
        instruction=instruction,
        tools=tools,
        output_key="triage_result",
        generate_content_config=config.generation_config(),
        before_tool_callback=governance.before_tool,
        after_tool_callback=governance.after_tool,
        on_tool_error_callback=governance.on_tool_error,
        after_model_callback=governance.after_model,
    )
