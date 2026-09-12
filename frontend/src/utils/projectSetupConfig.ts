type ProjectConfig = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export interface ProjectSetupOverrides {
  tenantId: string; projectId: string; allowUserPreferences: string[]; allowUserOverrides: string[];
  presentation: string; detail: string; disabledConnectors: string[]; capProfiles: Record<string, string>;
  maxLlmCalls: number; maxToolCalls: number; maxContextChars: number; runTimeoutSeconds: number;
  workflow: Record<string, boolean>; prompts: Record<string, string>;
  skills: Record<string, { enabled: boolean; instruction: string }>; environments: unknown[]; delegatedSections?: readonly string[];
}

/** Merge form edits into the server snapshot without dropping governed fields. */
export function buildProjectConfiguration(existing: ProjectConfig | null | undefined, overrides: ProjectSetupOverrides): ProjectConfig {
  const config = clone(existing || {});
  config.tenant_id = overrides.tenantId;
  config.project_id = overrides.projectId;
  config.allow_user_preferences = [...overrides.allowUserPreferences];
  config.allow_user_overrides = [...overrides.allowUserOverrides];
  config.preferences = { ...(config.preferences || {}), presentation: overrides.presentation, detail: overrides.detail };
  config.disabled_connectors = [...overrides.disabledConnectors];
  config.limits = { ...(config.limits || {}), max_llm_calls: overrides.maxLlmCalls, max_tool_calls: overrides.maxToolCalls, max_context_chars: overrides.maxContextChars, run_timeout_seconds: overrides.runTimeoutSeconds };
  config.workflow = { ...(config.workflow || {}), ...overrides.workflow };
  config.prompts = { ...(config.prompts || {}), ...overrides.prompts };
  config.environments = clone(overrides.environments);
  if (!config.capabilities || typeof config.capabilities !== 'object') config.capabilities = {};
  if (Object.keys(overrides.capProfiles).length) {
    for (const [id, modelProfile] of Object.entries(overrides.capProfiles)) {
      if (config.capabilities[id] && typeof config.capabilities[id] === 'object') config.capabilities[id] = { ...config.capabilities[id], model_profile: modelProfile };
      else config.capabilities[id] = { model_profile: modelProfile };
    }
  }
  if (!config.skills || typeof config.skills !== 'object') config.skills = {};
  if (Object.keys(overrides.skills).length) {
    for (const [id, skill] of Object.entries(overrides.skills)) {
      if (config.skills[id] && typeof config.skills[id] === 'object') config.skills[id] = { ...config.skills[id], enabled: skill.enabled, instruction: skill.instruction || null };
      else config.skills[id] = { enabled: skill.enabled, instruction: skill.instruction || null };
    }
  }
  // Snapshots include model defaults even for sections the deployment has not delegated.
  // Those keys are rejected by the API, so only submit the editable project contract.
  if (overrides.delegatedSections) {
    const allowed = new Set([...overrides.delegatedSections, 'skills', 'tenant_id', 'project_id', 'allow_user_overrides', 'allow_user_preferences']);
    for (const section of Object.keys(config)) {
      if (!allowed.has(section)) delete config[section];
    }
  }
  return config;
}
