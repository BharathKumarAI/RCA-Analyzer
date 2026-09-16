type ProjectConfig = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export interface ProjectEnvironment {
  id: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  cluster?: string | null;
  namespace?: string | null;
  host?: string | null;
  splunk_index?: string | null;
  jira_env_name?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Manager' | 'Owner' | 'Analyst';
}

export interface ScheduleItem {
  id: string;
  name: string;
  capability: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  description?: string;
  executionType: 'jql' | 'script' | 'capability';
  targetJqlId?: 'polling' | 'reporting' | 'amdocs' | 'env' | 'custom' | string;
  scriptPath?: string;
  adminApproved?: boolean;
  frequencyLabel?: string;
}

export interface ConnectorInstance {
  id: string;
  name: string;
  type: string;
  scope: 'project' | 'environment';
  enabled: boolean;
  endpoint: string;
  secretRef: string;
  timeoutSeconds: number;
  rateLimitRpm: number;
  healthStatus?: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
  latencyMs?: number;
}

export interface ToolItem {
  id: string;
  name: string;
  connectorId: string;
  connectorType: string;
  scope: 'project' | 'environment';
  enabled: boolean;
  description: string;
}

export interface EnvironmentBinding {
  projectEnvironment: string;
  bindings: Record<string, { connectorId: string; toolEnvironment: string }>;
}

export interface TeamScope {
  coreTeamValues: string[];
  amdocsTeamValues: string[];
  fixTeamField: string;
  assignedTeamField: string;
  environmentField: string;
}

export interface JqlScheduleConfig {
  pollingTemplate: string;
  reportingTemplate: string;
  amdocsDailyTemplate: string;
  environmentFilterTemplate: string;
}

export interface JiraCustomFieldMapping {
  logical_name: string;
  customfield_id: string;
  jira_name: string;
  type: string;
  mandatory: boolean;
  scope: string;
  description: string;
}

export interface RcaAssistFullConfigurationData {
  metadata: {
    id: string;
    name: string;
    status: 'active' | 'inactive';
    responsibility: string[];
    objective: string;
    timezone: string;
    tags: string[];
  };
  projectScope: {
    environments: ProjectEnvironment[];
    teamDl: string;
    teamsChannel: string;
    members: {
      managers: TeamMember[];
      owners: TeamMember[];
      analysts: TeamMember[];
    };
    teamScope?: TeamScope;
  };
  configurationResolution: {
    precedence: string[];
    rules: {
      inheritPlatformDefaults: boolean;
      projectCanOverride: boolean;
      environmentCanOverride: boolean;
      profileCanOverride: boolean;
      runOverrideRequiresPolicy: boolean;
    };
  };
  policies: {
    dataRetention: string;
    accessControl: string;
    auditLogging: string;
  };
  additionalSettings: {
    category: string;
    priority: string;
    enableAnalytics: boolean;
    enableNotifications: boolean;
  };
  investigationTimePolicy: {
    timezone: string;
    anchors: Array<{ source: string; priority: number; confidence: number; label: string }>;
    fallback: string;
    refinementEnabled: boolean;
    neverReplaceWithLowerConfidence: boolean;
    windows: {
      jiraDiscoveryLookback: string;
      jiraAnalystLookback: string;
      jiraSimilarityLookback: string;
      splunkInitialLookback: string;
      splunkInitialLookahead: string;
      splunkMaxLookback: string;
      splunkAdaptive: string[];
    };
  };
  jqlConfiguration?: JqlScheduleConfig;
  jiraCustomFields?: JiraCustomFieldMapping[];
  schedules: ScheduleItem[];
  connectors: ConnectorInstance[];
  tools: ToolItem[];
  environmentBindings: EnvironmentBinding[];
  runtimeLimits?: {
    maxLlmCalls?: number;
    maxToolCalls?: number;
    maxContextChars?: number;
    runTimeoutSeconds?: number;
  };
}

export interface ProjectSetupOverrides {
  tenantId: string;
  projectId: string;
  allowUserPreferences: string[];
  allowUserOverrides: string[];
  presentation: string;
  detail: string;
  disabledConnectors: string[];
  capProfiles: Record<string, string>;
  maxLlmCalls: number;
  maxToolCalls: number;
  maxContextChars: number;
  runTimeoutSeconds: number;
  workflow: Record<string, boolean>;
  prompts: Record<string, string>;
  skills: Record<string, { enabled: boolean; instruction: string }>;
  environments: ProjectEnvironment[];
  delegatedSections?: readonly string[];
}

/** Format JavaScript data structure to clean, readable YAML */
export function formatToYaml(data: any, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'boolean') return data ? 'true' : 'false';
  if (typeof data === 'number') return String(data);
  if (typeof data === 'string') {
    if (data.includes('\n')) {
      const lines = data.trim().split('\n');
      return '|\n' + lines.map(line => pad + '  ' + line).join('\n');
    }
    if (data === '' || /[:#\[\]{},&*?|<>=!%@`]/.test(data) || data === 'true' || data === 'false') {
      return JSON.stringify(data);
    }
    return data;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    return data
      .map(item => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const innerEntries = Object.entries(item).filter(([, v]) => v !== undefined);
          if (innerEntries.length === 0) return `${pad}- {}`;
          const [firstKey, firstVal] = innerEntries[0];
          const firstLine = `${pad}- ${firstKey}: ${formatToYaml(firstVal, indent + 2).trimStart()}`;
          const restLines = innerEntries
            .slice(1)
            .map(([k, v]) => {
              if (typeof v === 'object' && v !== null) {
                return `${pad}  ${k}:\n${formatToYaml(v, indent + 2)}`;
              }
              return `${pad}  ${k}: ${formatToYaml(v, indent + 2)}`;
            });
          return [firstLine, ...restLines].join('\n');
        }
        return `${pad}- ${formatToYaml(item, indent + 1)}`;
      })
      .join('\n');
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, val]) => {
        if (typeof val === 'object' && val !== null) {
          if (Array.isArray(val)) {
            if (val.length === 0) return `${pad}${key}: []`;
            return `${pad}${key}:\n${formatToYaml(val, indent + 1)}`;
          }
          if (Object.keys(val).length === 0) return `${pad}${key}: {}`;
          return `${pad}${key}:\n${formatToYaml(val, indent + 1)}`;
        }
        return `${pad}${key}: ${formatToYaml(val, indent)}`;
      })
      .join('\n');
  }
  return String(data);
}

/** Merge form edits into the server snapshot without dropping governed fields. */
export function buildProjectConfiguration(
  existing: ProjectConfig | null | undefined,
  overrides: ProjectSetupOverrides
): ProjectConfig {
  const config = clone(existing || {});
  config.tenant_id = overrides.tenantId;
  config.project_id = overrides.projectId;
  config.allow_user_preferences = [...overrides.allowUserPreferences];
  config.allow_user_overrides = [...overrides.allowUserOverrides];
  config.preferences = { ...(config.preferences || {}), presentation: overrides.presentation, detail: overrides.detail };
  config.disabled_connectors = [...overrides.disabledConnectors];
  config.limits = {
    ...(config.limits || {}),
    max_llm_calls: overrides.maxLlmCalls,
    max_tool_calls: overrides.maxToolCalls,
    max_context_chars: overrides.maxContextChars,
    run_timeout_seconds: overrides.runTimeoutSeconds,
  };
  config.workflow = { ...(config.workflow || {}), ...overrides.workflow };
  config.prompts = { ...(config.prompts || {}), ...overrides.prompts };
  config.environments = overrides.environments.map(env => ({
    id: env.id,
    name: env.displayName || env.id,
    enabled: env.enabled !== false,
    cluster: env.cluster || null,
    namespace: env.namespace || null,
    host: env.host || null,
    splunk_index: env.splunk_index || null,
    jira_env_name: env.jira_env_name || null,
  }));
  if (!config.capabilities || typeof config.capabilities !== 'object') config.capabilities = {};
  if (Object.keys(overrides.capProfiles).length) {
    for (const [id, modelProfile] of Object.entries(overrides.capProfiles)) {
      if (config.capabilities[id] && typeof config.capabilities[id] === 'object') {
        config.capabilities[id] = { ...config.capabilities[id], model_profile: modelProfile };
      } else {
        config.capabilities[id] = { model_profile: modelProfile };
      }
    }
  }
  if (!config.skills || typeof config.skills !== 'object') config.skills = {};
  if (Object.keys(overrides.skills).length) {
    for (const [id, skill] of Object.entries(overrides.skills)) {
      if (config.skills[id] && typeof config.skills[id] === 'object') {
        config.skills[id] = { ...config.skills[id], enabled: skill.enabled, instruction: skill.instruction || null };
      } else {
        config.skills[id] = { enabled: skill.enabled, instruction: skill.instruction || null };
      }
    }
  }

  // Snapshots include model defaults even for sections the deployment has not delegated.
  // Those keys are rejected by the API, so only submit the editable project contract.
  if (overrides.delegatedSections) {
    const allowed = new Set([
      ...overrides.delegatedSections,
      'skills',
      'tenant_id',
      'project_id',
      'allow_user_overrides',
      'allow_user_preferences',
    ]);
    for (const section of Object.keys(config)) {
      if (!allowed.has(section)) delete config[section];
    }
  }
  return config;
}
