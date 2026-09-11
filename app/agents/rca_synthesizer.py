"""Final structured synthesis consumes only the run's captured evidence."""

from google.adk.agents import LlmAgent
from app.runtime.run_contract import InvestigationResult


def build_synthesizer(model, config, governance, instruction):
    return LlmAgent(
        name="rca_synthesizer",
        model=model,
        description="Synthesize evidence and safe proposed next steps with explicit uncertainty.",
        instruction=instruction,
        output_schema=InvestigationResult,
        output_key="investigation_result",
        include_contents="none",
        generate_content_config=config.generation_config(),
        after_model_callback=governance.after_model,
    )
