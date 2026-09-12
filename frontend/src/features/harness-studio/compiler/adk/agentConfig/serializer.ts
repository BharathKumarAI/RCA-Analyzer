import YAML from 'yaml';
import { AdkAgentComponent, AdkNodeReference } from '../../../types/harness';

export function serializeAgentToYaml(
  agent: AdkAgentComponent,
  options: { includeSchemaHeader?: boolean; disclaimer?: string } = {}
): string {
  const { includeSchemaHeader = true, disclaimer } = options;

  const data: Record<string, any> = {
    agent_class: agent.agentClass,
    name: agent.name,
  };

  if (agent.model) {
    data.model = agent.model;
  }

  if (agent.description) {
    data.description = agent.description.trim();
  }

  if (agent.instruction) {
    data.instruction = agent.instruction;
  }

  if (agent.sub_agents && agent.sub_agents.length > 0) {
    data.sub_agents = agent.sub_agents.map((sub: AdkNodeReference) => {
      if (sub.type === 'config_path') {
        return { config_path: sub.path };
      }
      if (sub.type === 'code') {
        return { code: sub.reference };
      }
      if (sub.type === 'registry') {
        return { component_id: sub.componentId };
      }
      if (sub.type === 'inline' && sub.node.kind === 'agent') {
        return {
          agent_class: sub.node.agentClass,
          name: sub.node.name,
          instruction: sub.node.instruction,
        };
      }
      return sub;
    });
  }

  if (agent.tools && agent.tools.length > 0) {
    data.tools = agent.tools.map(t => {
      if (t.args && Object.keys(t.args).length > 0) {
        return { name: t.name, args: t.args };
      }
      return { name: t.name };
    });
  }

  if (agent.generate_content_config && Object.keys(agent.generate_content_config).length > 0) {
    data.generate_content_config = agent.generate_content_config;
  }

  if (agent.custom_config && Object.keys(agent.custom_config).length > 0) {
    Object.assign(data, agent.custom_config);
  }

  const yamlBody = YAML.stringify(data);

  const headers: string[] = [];
  if (includeSchemaHeader) {
    headers.push(
      '# yaml-language-server: $schema=https://raw.githubusercontent.com/google/adk-python/refs/heads/main/src/google/adk/agents/config_schemas/AgentConfig.json'
    );
  }
  if (disclaimer) {
    headers.push(`# ${disclaimer}`);
  }

  if (headers.length > 0) {
    return `${headers.join('\n')}\n${yamlBody}`;
  }

  return yamlBody;
}
