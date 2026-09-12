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
    const isV2OrHigher = !version.startsWith('1.');
    return {
      adkVersion: version,
      agentConfigSchemaVersion: 'https://raw.githubusercontent.com/google/adk-python/refs/heads/main/src/google/adk/agents/config_schemas/AgentConfig.json',
      features: {
        agentConfig: true,
        workflowRuntime: isV2OrHigher,
        taskApi: isV2OrHigher,
        plugins: isV2OrHigher,
        a2a: isV2OrHigher,
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
