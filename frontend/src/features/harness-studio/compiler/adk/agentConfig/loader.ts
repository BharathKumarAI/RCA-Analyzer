import YAML from 'yaml';
import {
  AdkAgentComponent,
  AdkComponent,
  AdkNodeReference,
  ConfigFileDefinition,
} from '../../../types/harness';
import { COMPONENT_REGISTRY } from '../../registry';

export interface ParseResult {
  rootReference: AdkNodeReference;
  components: Record<string, AdkComponent>;
  errors: string[];
}

export function parseAgentYaml(
  content: string,
  filePath: string,
  allFiles?: Record<string, string>
): { component: AdkComponent; errors: string[] } {
  const errors: string[] = [];
  let parsed: any;
  try {
    parsed = YAML.parse(content);
  } catch (err: any) {
    return {
      component: createFallbackAgent(filePath, `YAML Syntax Error: ${err.message}`),
      errors: [`Error in ${filePath}: ${err.message}`],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      component: createFallbackAgent(filePath, 'Empty or non-object YAML content'),
      errors: [`Error in ${filePath}: Expected YAML object`],
    };
  }

  const agentClass = parsed.agent_class || 'LlmAgent';
  const name = parsed.name || filePath.split('/').pop()?.replace(/\.ya?ml$/, '') || 'agent';
  const id = parsed.id || name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const subAgents: AdkNodeReference[] = [];
  if (Array.isArray(parsed.sub_agents)) {
    for (const sub of parsed.sub_agents) {
      if (!sub || typeof sub !== 'object') continue;
      if (sub.config_path) {
        subAgents.push({ type: 'config_path', path: sub.config_path });
      } else if (sub.code) {
        subAgents.push({ type: 'code', reference: sub.code });
      } else if (sub.registry_id || sub.component_id) {
        subAgents.push({ type: 'registry', componentId: sub.registry_id || sub.component_id });
      } else if (sub.name || sub.agent_class) {
        subAgents.push({
          type: 'inline',
          node: {
            kind: 'agent',
            id: sub.id || sub.name?.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'inline_subagent',
            agentClass: sub.agent_class || 'LlmAgent',
            name: sub.name || 'Inline Subagent',
            instruction: sub.instruction,
            description: sub.description,
            origin: { source: 'adk_yaml', editable: true, filePath },
          },
        });
      }
    }
  }

  const tools: Array<{ name: string; args?: Record<string, unknown> }> = [];
  if (Array.isArray(parsed.tools)) {
    for (const tool of parsed.tools) {
      if (typeof tool === 'string') {
        tools.push({ name: tool });
      } else if (tool && typeof tool === 'object' && tool.name) {
        tools.push({ name: tool.name, args: tool.args || tool.configuration });
      }
    }
  }

  // Determine schema provider if registered
  const registryEntry = COMPONENT_REGISTRY[id];
  const schemaDescriptor = registryEntry?.configuration?.schema
    ? { source: 'prism_registry' as const, schema: registryEntry.configuration.schema }
    : undefined;

  const agentComponent: AdkAgentComponent = {
    kind: 'agent',
    id,
    agentClass,
    name,
    model: parsed.model || 'gemini-2.5-flash',
    description: parsed.description,
    instruction: parsed.instruction,
    sub_agents: subAgents.length > 0 ? subAgents : undefined,
    tools: tools.length > 0 ? tools : undefined,
    generate_content_config: parsed.generate_content_config,
    config_path: filePath,
    schemaDescriptor,
    origin: {
      source: parsed.is_custom_class ? 'python' : 'adk_yaml',
      editable: true,
      filePath,
      componentId: id,
    },
  };

  return { component: agentComponent, errors };
}

export function loadMultiFileHarness(
  files: ConfigFileDefinition[],
  rootPath: string = 'root_agent.yaml'
): ParseResult {
  const components: Record<string, AdkComponent> = {};
  const errors: string[] = [];
  const fileMap: Record<string, string> = {};

  for (const f of files) {
    fileMap[f.path] = f.content;
  }

  // Parse all files
  for (const f of files) {
    if (f.kind === 'adk_agent') {
      const { component, errors: fileErrors } = parseAgentYaml(f.content, f.path, fileMap);
      components[component.id] = component;
      errors.push(...fileErrors);
    }
  }

  // Find root
  let rootRef: AdkNodeReference = { type: 'config_path', path: rootPath };
  const rootComp = Object.values(components).find(
    c => c.origin.filePath === rootPath || c.id === 'root_agent' || c.name.toLowerCase().includes('root')
  );

  if (rootComp) {
    rootRef = { type: 'config_path', path: rootComp.origin.filePath || rootPath };
  } else if (Object.keys(components).length > 0) {
    const first = Object.values(components)[0];
    rootRef = { type: 'config_path', path: first.origin.filePath || rootPath };
  }

  return { rootReference: rootRef, components, errors };
}

function createFallbackAgent(filePath: string, desc: string): AdkAgentComponent {
  const id = filePath.split('/').pop()?.replace(/\.ya?ml$/, '') || 'invalid_agent';
  return {
    kind: 'agent',
    id,
    agentClass: 'LlmAgent',
    name: id,
    description: desc,
    instruction: 'Fallback due to loading error',
    origin: { source: 'adk_yaml', editable: false, filePath },
  };
}
