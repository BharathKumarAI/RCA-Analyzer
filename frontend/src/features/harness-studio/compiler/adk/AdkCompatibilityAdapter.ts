import { AdkCompatibility } from '../../types/harness';

export const CURRENT_ADK_VERSION = '2.9.0';

export class AdkCompatibilityAdapter {
  private compatibility: AdkCompatibility;

  constructor(version: string = CURRENT_ADK_VERSION) {
    this.compatibility = this.resolveCompatibility(version);
  }

  public getCompatibility(): AdkCompatibility {
    return this.compatibility;
  }

  public resolveCompatibility(version: string): AdkCompatibility {
    return {
      adkVersion: version,
      agentConfigSchemaVersion: 'https://raw.githubusercontent.com/google/adk-python/refs/heads/main/src/google/adk/agents/config_schemas/AgentConfig.json',
      features: {
        agentConfig: true,
        workflowRuntime: true,
        taskApi: false,
        plugins: false,
        a2a: false,
      },
    };
  }

  public isDeprecatedAgentClass(agentClass: string): { isDeprecated: boolean; recommendedAlternative?: string } {
    return { isDeprecated: false };
  }

  public isDeprecationWarningActive(): boolean {
    return false;
  }
}

export const defaultAdkAdapter = new AdkCompatibilityAdapter();
