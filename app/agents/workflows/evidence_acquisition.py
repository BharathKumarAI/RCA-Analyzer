"""Independent source branches run in parallel with explicit state outputs."""

from google.adk.agents import LlmAgent


def build_log_investigator(model, config, tools, governance, instruction):
    return LlmAgent(
        name="logs_investigator",
        model=model,
        description="Gather log evidence in the incident time window.",
        instruction=instruction,
        tools=tools,
        output_key="logs_result",
        generate_content_config=config.generation_config(),
        before_tool_callback=governance.before_tool,
        after_tool_callback=governance.after_tool,
        on_tool_error_callback=governance.on_tool_error,
        after_model_callback=governance.after_model,
    )


def build_file_investigator(model, config, governance, instruction):
    return LlmAgent(
        name="file_investigator",
        model=model,
        description="Extract relevant observations from redacted attachment evidence.",
        instruction=instruction,
        output_key="file_result",
        include_contents="none",
        generate_content_config=config.generation_config(),
        after_model_callback=governance.after_model,
    )
