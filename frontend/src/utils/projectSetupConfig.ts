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

export const DEFAULT_TEAM_SCOPE: TeamScope = {
  coreTeamValues: ['SAG Triage', 'Digital Platform', 'Samson Core'],
  amdocsTeamValues: ['Amdocs Core', 'Partner Delivery'],
  fixTeamField: 'customfield_10290',
  assignedTeamField: 'customfield_10366',
  environmentField: 'customfield_10291',
};

export const DEFAULT_JQL_CONFIG: JqlScheduleConfig = {
  pollingTemplate:
    '({fix_team_field} in ({core_team_in_clause}) OR {assigned_team_field} in ({core_team_in_clause}) OR assignee in ({owners_and_analysts_account_ids})) ORDER BY updated DESC',
  reportingTemplate:
    '({fix_team_field} in ({core_team_in_clause}) OR {assigned_team_field} in ({core_team_in_clause})) AND (commentedBy in ({owners_and_analysts_account_ids}) OR assignee in ({owners_and_analysts_account_ids})) AND updated >= -7d ORDER BY updated DESC',
  amdocsDailyTemplate:
    'project = <JIRA_PROJECT_KEY> AND ({fix_team_field} in ({amdocs_team_in_clause}) OR {assigned_team_field} in ({amdocs_team_in_clause})) ORDER BY updated DESC',
  environmentFilterTemplate:
    "status != Closed AND {environment_field} ~ '{environment}'",
};

export const DEFAULT_JIRA_CUSTOM_FIELDS: JiraCustomFieldMapping[] = [
  { logical_name: 'fix_team', customfield_id: 'customfield_10290', jira_name: 'Fix Team', type: 'select', mandatory: true, scope: 'triage_routing', description: 'Team responsible for fixing the issue. Domain | Team | Specialty.' },
  { logical_name: 'environment', customfield_id: 'customfield_10291', jira_name: 'Environment', type: 'cascading_select', mandatory: true, scope: 'incident_scope', description: 'Parent-child environment hierarchy (QLAB -> QLAB01, QLAB02).' },
  { logical_name: 'fix_application', customfield_id: 'customfield_10292', jira_name: 'Fix Application', type: 'select', mandatory: true, scope: 'triage_routing', description: 'Application (AF ID) and platform service (APM ID) responsible for fix.' },
  { logical_name: 'fix_type_subtype', customfield_id: 'customfield_10298', jira_name: 'Fix Type/Subtype', type: 'cascading_select', mandatory: false, scope: 'incident_classification', description: 'Parent broad type (Bug, Environment, Config), child subtype.' },
  { logical_name: 'severity', customfield_id: 'customfield_10285', jira_name: 'Severity', type: 'select', mandatory: true, scope: 'priority_triage', description: '1 - Critical, 2 - High, 3 - Medium, 4 - Low impact level.' },
  { logical_name: 'fix_agent', customfield_id: 'customfield_10277', jira_name: 'Fix Agent', type: 'user', mandatory: true, scope: 'accountability', description: 'Individual owner responsible for implementing fix.' },
  { logical_name: 'reporting_team', customfield_id: 'customfield_10365', jira_name: 'Reporting Team', type: 'select', mandatory: true, scope: 'stakeholder_tracking', description: 'Team that discovered or reported the issue.' },
  { logical_name: 'assigned_team', customfield_id: 'customfield_10366', jira_name: 'Assigned Team', type: 'select', mandatory: true, scope: 'assignment_tracking', description: 'Team currently assigned during triage handoff.' },
  { logical_name: 'affected_application', customfield_id: 'customfield_10353', jira_name: 'Affected Application', type: 'select', mandatory: false, scope: 'incident_scope', description: 'Application impacted by the incident.' },
  { logical_name: 'root_cause_analysis', customfield_id: 'customfield_10320', jira_name: 'Root Cause Analysis', type: 'text', mandatory: false, scope: 'investigation', description: 'Detailed RCA narrative, contributing factors, resolution.' },
  { logical_name: 'estimated_build_date', customfield_id: 'customfield_10321', jira_name: 'Estimated Build Date', type: 'date', mandatory: false, scope: 'timeline', description: 'Expected date when fix will be built/deployed (YYYY-MM-DD).' },
  { logical_name: 'acceptance_criteria', customfield_id: 'customfield_10313', jira_name: 'Acceptance Criteria', type: 'text', mandatory: false, scope: 'verification', description: 'Definition of done condition to consider issue resolved.' },
  { logical_name: 'test_type', customfield_id: 'customfield_10355', jira_name: 'Test Type', type: 'select', mandatory: false, scope: 'quality_assurance', description: 'Functional, Integration, Performance, Regression, Smoke, UAT.' },
  { logical_name: 'test_levels', customfield_id: 'customfield_10317', jira_name: 'Test Levels', type: 'select', mandatory: false, scope: 'quality_assurance', description: 'Unit, Integration, System, Acceptance, Production.' },
  { logical_name: 'test_category', customfield_id: 'customfield_10318', jira_name: 'Test Category', type: 'select', mandatory: false, scope: 'quality_assurance', description: 'Progression, Regression, Performance, Security.' },
  { logical_name: 'originality', customfield_id: 'customfield_10357', jira_name: 'Originality', type: 'select', mandatory: false, scope: 'incident_classification', description: 'NEW issue vs RECURRENCE of known problem.' },
  { logical_name: 'platform_strategic_plan', customfield_id: 'customfield_10345', jira_name: 'Platform/Strategic Plan', type: 'select', mandatory: false, scope: 'strategic_alignment', description: 'Initiative or platform the fix aligns with.' },
  { logical_name: 'parent_key', customfield_id: 'customfield_11934', jira_name: 'Parent Key', type: 'text', mandatory: false, scope: 'hierarchy', description: 'Jira key of parent epic or story for grouping.' },
];

export function toCfSyntax(fieldId: string): string {
  if (!fieldId) return 'cf[10290]';
  if (fieldId.startsWith('cf[')) return fieldId;
  const match = fieldId.match(/\d+/);
  if (match) {
    return `cf[${match[0]}]`;
  }
  return fieldId;
}

export function buildInClause(values: string[]): string {
  if (!values || values.length === 0) return '';
  return values.map(v => `"${v.replace(/"/g, '\\"')}"`).join(', ');
}

export function interpolateJql(
  template: string,
  teamScope: TeamScope,
  members: { owners: TeamMember[]; analysts: TeamMember[] },
  environment?: string,
  projectKey: string = 'SAG',
  customFields?: JiraCustomFieldMapping[]
): string {
  const fixTeamSyntax = toCfSyntax(teamScope.fixTeamField);
  const assignedTeamSyntax = toCfSyntax(teamScope.assignedTeamField);
  const environmentSyntax = toCfSyntax(teamScope.environmentField);

  const coreTeamInClause = buildInClause(teamScope.coreTeamValues);
  const amdocsTeamInClause = buildInClause(teamScope.amdocsTeamValues);

  const memberAccounts = [...members.owners, ...members.analysts].map(m => m.email || m.name);
  const ownersAndAnalystsClause = buildInClause(
    memberAccounts.length > 0 ? memberAccounts : ['analyst@company.internal']
  );

  let jql = template;

  // Replace standard dynamic custom field placeholders
  jql = jql.replace(/\{fix_team_field\}/g, fixTeamSyntax);
  jql = jql.replace(/\{assigned_team_field\}/g, assignedTeamSyntax);
  jql = jql.replace(/\{environment_field\}/g, environmentSyntax);

  // Also replace cf[10290], cf[10366], customfield_10291 if template had literal default IDs
  if (teamScope.fixTeamField && toCfSyntax(teamScope.fixTeamField) !== 'cf[10290]') {
    jql = jql.replace(/cf\[10290\]/g, fixTeamSyntax);
  }
  if (teamScope.assignedTeamField && toCfSyntax(teamScope.assignedTeamField) !== 'cf[10366]') {
    jql = jql.replace(/cf\[10366\]/g, assignedTeamSyntax);
  }
  if (teamScope.environmentField && toCfSyntax(teamScope.environmentField) !== 'cf[10291]') {
    jql = jql.replace(/customfield_10291/g, environmentSyntax);
    jql = jql.replace(/cf\[10291\]/g, environmentSyntax);
  }

  // Replace team scope and member accounts
  jql = jql.replace(/<JIRA_PROJECT_KEY>/g, projectKey);
  jql = jql.replace(/\{core_team_in_clause\}/g, coreTeamInClause || '"SAG Triage"');
  jql = jql.replace(/\{amdocs_team_in_clause\}/g, amdocsTeamInClause || '"Amdocs Core"');
  jql = jql.replace(/\{owners_and_analysts_account_ids\}/g, ownersAndAnalystsClause);
  if (environment) {
    jql = jql.replace(/\{environment\}/g, environment);
  }

  // Replace any custom fields referenced by logical name or field ID
  if (customFields && customFields.length > 0) {
    for (const cf of customFields) {
      jql = jql.replace(new RegExp(`\\{${cf.logical_name}\\}`, 'g'), toCfSyntax(cf.customfield_id));
      jql = jql.replace(new RegExp(`\\{${cf.customfield_id}\\}`, 'g'), toCfSyntax(cf.customfield_id));
    }
  }

  return jql;
}

export interface PrismFullConfigurationData {
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

/** Build complete PrismProjectConfiguration document */
export function buildPrismDocument(data: PrismFullConfigurationData): Record<string, any> {
  const teamScope = data.projectScope.teamScope || DEFAULT_TEAM_SCOPE;
  const jqlConfig = data.jqlConfiguration || DEFAULT_JQL_CONFIG;
  const jiraFields = data.jiraCustomFields || DEFAULT_JIRA_CUSTOM_FIELDS;

  return {
    schema_version: '1.0',
    kind: 'PrismProjectConfiguration',
    metadata: {
      project_id: data.metadata.id || 'sag',
      project_name: data.metadata.name || 'SAG',
      status: data.metadata.status,
      responsibility: data.metadata.responsibility,
      objective: data.metadata.objective,
      timezone: data.metadata.timezone,
      tags: data.metadata.tags,
    },
    project_scope: {
      environments: data.projectScope.environments.map(env => ({
        id: env.id,
        display_name: env.displayName,
        description: env.description || undefined,
        enabled: env.enabled !== false,
      })),
      team_dl: data.projectScope.teamDl || '',
      teams_channel: data.projectScope.teamsChannel || '',
      members: {
        managers: data.projectScope.members.managers.map(m => ({ name: m.name, email: m.email })),
        owners: data.projectScope.members.owners.map(m => ({ name: m.name, email: m.email })),
        analysts: data.projectScope.members.analysts.map(m => ({ name: m.name, email: m.email })),
      },
      team_scope: {
        _description:
          'Team values this project polls/reports on. Populate with the actual Jira option strings for cf[10290] (Fix Team) / cf[10366] (Assigned Team). Every JQL is built dynamically from these lists at query time.',
        core_team_values: teamScope.coreTeamValues,
        amdocs_team_values: teamScope.amdocsTeamValues,
        customfield_fix_team: teamScope.fixTeamField,
        customfield_assigned_team: teamScope.assignedTeamField,
        customfield_environment: teamScope.environmentField,
      },
    },
    configuration_resolution: {
      precedence: data.configurationResolution.precedence,
      rules: {
        inherit_platform_defaults: data.configurationResolution.rules.inheritPlatformDefaults,
        project_can_override: data.configurationResolution.rules.projectCanOverride,
        environment_can_override: data.configurationResolution.rules.environmentCanOverride,
        profile_can_override: data.configurationResolution.rules.profileCanOverride,
        run_override_requires_policy: data.configurationResolution.rules.runOverrideRequiresPolicy,
      },
    },
    policies: {
      data_retention: data.policies.dataRetention,
      access_control: data.policies.accessControl,
      audit_logging: data.policies.auditLogging,
    },
    governance: {
      action_policy: {
        read: { approval: 'none', identity: 'platform_or_project_service_identity' },
        write: { approval: 'explicit_user', identity: 'delegated_user_identity' },
        destructive: { approval: 'admin', default_enabled: false },
        approval_context_fields: [
          'connector',
          'operation',
          'target',
          'proposed_changes',
          'reason',
          'evidence',
          'impact',
        ],
      },
      database_policy: {
        read_only: true,
        allowed_statement_types: ['SELECT'],
        default_row_limit: 1000,
        timeout_seconds: 30,
      },
      secret_policy: {
        reject_plaintext_secrets: true,
        use_secret_references: true,
      },
    },
    additional_settings: {
      category: data.additionalSettings.category,
      priority: data.additionalSettings.priority,
      analytics_enabled: data.additionalSettings.enableAnalytics,
      notifications_enabled: data.additionalSettings.enableNotifications,
    },
    investigation_time_policy: {
      timezone: data.investigationTimePolicy.timezone,
      anchor_resolution: {
        priority: data.investigationTimePolicy.anchors.map(a => ({
          source: a.source,
          confidence: a.confidence,
        })),
        fallback: data.investigationTimePolicy.fallback,
        refinement_enabled: data.investigationTimePolicy.refinementEnabled,
        never_replace_with_lower_confidence_anchor: data.investigationTimePolicy.neverReplaceWithLowerConfidence,
      },
      connectors: {
        jira: {
          discovery: { anchor: 'current_time', lookback: data.investigationTimePolicy.windows.jiraDiscoveryLookback, field: 'updated' },
          analyst_activity: { anchor: 'current_time', lookback: data.investigationTimePolicy.windows.jiraAnalystLookback, comment_author_match: true },
          historical_similarity: { anchor: 'incident_anchor', lookback: data.investigationTimePolicy.windows.jiraSimilarityLookback, adaptive: true },
        },
        splunk: {
          initial_window: {
            lookback: data.investigationTimePolicy.windows.splunkInitialLookback,
            lookahead: data.investigationTimePolicy.windows.splunkInitialLookahead,
          },
          maximum_window: {
            lookback: data.investigationTimePolicy.windows.splunkMaxLookback,
            lookahead: 'PT2H',
          },
          adaptive_expansion: data.investigationTimePolicy.windows.splunkAdaptive,
        },
        signalfx: {
          window: { lookback: 'PT2H', lookahead: 'PT2H' },
          max_lookback: 'P1D',
        },
        oracle: {
          window: { lookback: 'P1D', lookahead: 'PT2H' },
          freshness_probe: 'PT1H',
        },
        kafka: {
          window: { lookback: 'PT2H', lookahead: 'PT1H' },
          max_records: 500,
        },
        kubernetes: {
          events_window: { lookback: 'P1D', lookahead: 'PT2H' },
        },
      },
    },
    jql_dynamic_build: {
      _description:
        'How every JQL query is assembled at runtime. Queries reuse this build procedure over dynamic config inputs.',
      build_steps: [
        '1. Read source lists fresh from config: team_scope.core_team_values / amdocs_team_values and members (owners + analysts).',
        '2. For commentedBy/assignee scoping: resolve members emails to Jira accountIds via GET /rest/api/3/user/search?query={email}.',
        '3. Build each IN-clause value list by quoting and comma-joining: build_in_clause(values) -> \'"v1", "v2"\'.',
        "4. Substitute into that job's clause_template placeholders to produce the final executable JQL.",
        '5. Drop empty OR-branches rather than emitting invalid in () clauses.',
      ],
      schedules: {
        polling: {
          enabled: data.schedules.find(s => s.targetJqlId === 'polling' || s.id === 'polling')?.enabled ?? true,
          frequency: data.schedules.find(s => s.targetJqlId === 'polling' || s.id === 'polling')?.frequencyLabel || 'Every 15 minutes',
          cron: data.schedules.find(s => s.targetJqlId === 'polling' || s.id === 'polling')?.cron || '*/15 * * * *',
          clause_template: jqlConfig.pollingTemplate,
          built_from: {
            core_team_in_clause: 'team_scope.core_team_values, quoted/joined per jql_dynamic_build step 3',
            owners_and_analysts_account_ids: 'members.owners + members.analysts, resolved to Jira accountIds',
          },
        },
        reporting: {
          enabled: data.schedules.find(s => s.targetJqlId === 'reporting' || s.id === 'weekly-report')?.enabled ?? true,
          schedule: data.schedules.find(s => s.targetJqlId === 'reporting' || s.id === 'weekly-report')?.frequencyLabel || 'Every Friday at 5:00 PM Central Time',
          frequency: 'weekly',
          cron: data.schedules.find(s => s.targetJqlId === 'reporting' || s.id === 'weekly-report')?.cron || '0 17 * * 5',
          timezone: data.schedules.find(s => s.targetJqlId === 'reporting' || s.id === 'weekly-report')?.timezone || data.metadata.timezone || 'America/Chicago',
          clause_template: jqlConfig.reportingTemplate,
          built_from: {
            core_team_in_clause: 'team_scope.core_team_values, quoted/joined per jql_dynamic_build step 3',
            owners_and_analysts_account_ids: 'members.owners + members.analysts, resolved to Jira accountIds',
          },
          reference_script: data.schedules.find(s => s.targetJqlId === 'reporting' || s.id === 'weekly-report')?.scriptPath || 'scripts/sre_weekly_digest.py',
          admin_approved: data.schedules.find(s => s.targetJqlId === 'reporting' || s.id === 'weekly-report')?.adminApproved ?? true,
        },
        amdocs_daily_report: {
          enabled: data.schedules.find(s => s.targetJqlId === 'amdocs' || s.id === 'daily-report')?.enabled ?? true,
          schedule: data.schedules.find(s => s.targetJqlId === 'amdocs' || s.id === 'daily-report')?.frequencyLabel || 'Daily at 3:00 PM Central Time',
          frequency: 'daily',
          cron: data.schedules.find(s => s.targetJqlId === 'amdocs' || s.id === 'daily-report')?.cron || '0 15 * * *',
          timezone: data.schedules.find(s => s.targetJqlId === 'amdocs' || s.id === 'daily-report')?.timezone || data.metadata.timezone || 'America/Chicago',
          clause_template: jqlConfig.amdocsDailyTemplate,
          built_from: {
            amdocs_team_in_clause: 'team_scope.amdocs_team_values, quoted/joined per jql_dynamic_build step 3',
          },
          reference_script: data.schedules.find(s => s.targetJqlId === 'amdocs' || s.id === 'daily-report')?.scriptPath || 'scripts/amdocs_vendor_sync.py',
          admin_approved: data.schedules.find(s => s.targetJqlId === 'amdocs' || s.id === 'daily-report')?.adminApproved ?? true,
        },
        environment_filter: {
          description: 'Environment-scoped incident ticket filter for cross-service diagnosis',
          clause_template: jqlConfig.environmentFilterTemplate,
        },
      },
    },
    schedules: data.schedules.map(s => {
      const schedDoc: Record<string, any> = {
        id: s.id,
        name: s.name,
        capability: s.capability,
        frequency: s.frequencyLabel || (s.cron === '*/15 * * * *' ? 'Every 15 minutes' : 'Scheduled Job'),
        cron: s.cron,
        timezone: s.timezone || data.metadata.timezone || 'America/Chicago',
        enabled: s.enabled,
        execution_type: s.executionType || 'jql',
      };
      if (s.executionType === 'jql') {
        schedDoc.target_jql_template = s.targetJqlId || 'polling';
        if (s.targetJqlId === 'polling') schedDoc.clause_template = jqlConfig.pollingTemplate;
        else if (s.targetJqlId === 'reporting') schedDoc.clause_template = jqlConfig.reportingTemplate;
        else if (s.targetJqlId === 'amdocs') schedDoc.clause_template = jqlConfig.amdocsDailyTemplate;
        else if (s.targetJqlId === 'env') schedDoc.clause_template = jqlConfig.environmentFilterTemplate;
      }
      if (s.scriptPath) {
        schedDoc.reference_script = s.scriptPath;
        schedDoc.admin_approved = s.adminApproved !== false;
      }
      if (s.description) schedDoc.description = s.description;
      return schedDoc;
    }),
    connector_bindings: {
      project_scoped: {
        Jira: {
          system_name: 'jira',
          endpoint: data.connectors.find(c => c.type === 'jira')?.endpoint || 'https://atlassian.company.net',
          authentication: {
            method: 'Bearer Token',
            token_reference: data.connectors.find(c => c.type === 'jira')?.secretRef || 'secret://jira/api_token',
          },
          process_attachments: true,
          timeout_seconds: data.connectors.find(c => c.type === 'jira')?.timeoutSeconds || 30,
          rate_limit_rpm: data.connectors.find(c => c.type === 'jira')?.rateLimitRpm || 120,
          custom_fields: {
            _description:
              'Jira custom field mappings for PRISM/SAG ingestion. Field IDs are Jira-instance-specific; logical names are platform-agnostic.',
            field_mapping: jiraFields.reduce((acc, f) => {
              acc[f.logical_name] = {
                customfield_id: f.customfield_id,
                jira_name: f.jira_name,
                type: f.type,
                mandatory: f.mandatory,
                scope: f.scope,
                description: f.description,
              };
              return acc;
            }, {} as Record<string, any>),
          },
        },
        Confluence: {
          system_name: 'confluence',
          endpoint: data.connectors.find(c => c.type === 'confluence')?.endpoint || 'https://atlassian.company.net/wiki',
          authentication: {
            method: 'Bearer Token',
            token_reference: data.connectors.find(c => c.type === 'confluence')?.secretRef || 'secret://confluence/api_token',
          },
          timeout_seconds: data.connectors.find(c => c.type === 'confluence')?.timeoutSeconds || 30,
          rate_limit_rpm: data.connectors.find(c => c.type === 'confluence')?.rateLimitRpm || 90,
          knowledge_refresh: {
            enabled: data.schedules.find(s => s.capability === 'knowledge.refresh')?.enabled ?? true,
            cron: data.schedules.find(s => s.capability === 'knowledge.refresh')?.cron ?? '0 21 * * *',
            schedule: 'Daily at 9:00 PM Central Time',
          },
        },
        Splunk: {
          system_name: 'splunk',
          endpoint: data.connectors.find(c => c.type === 'splunk')?.endpoint || 'https://splunk.company.net:8089',
          authentication: {
            method: 'Bearer Token',
            token_reference: data.connectors.find(c => c.type === 'splunk')?.secretRef || 'secret://splunk/qa_token',
          },
          timeout_seconds: data.connectors.find(c => c.type === 'splunk')?.timeoutSeconds || 45,
          rate_limit_rpm: data.connectors.find(c => c.type === 'splunk')?.rateLimitRpm || 60,
          note: 'Splunk is queried when the investigator agent needs logs/alerts for a specific incident.',
        },
        SignalFx: {
          system_name: 'signalfx',
          endpoint: data.connectors.find(c => c.type === 'signalfx')?.endpoint || 'https://api.signalfx.com',
          authentication: {
            method: 'Bearer Token',
            token_reference: data.connectors.find(c => c.type === 'signalfx')?.secretRef || 'secret://signalfx/ingest_token',
          },
          timeout_seconds: data.connectors.find(c => c.type === 'signalfx')?.timeoutSeconds || 25,
          rate_limit_rpm: data.connectors.find(c => c.type === 'signalfx')?.rateLimitRpm || 120,
        },
        Oracle: {
          system_name: 'oracle',
          endpoint: data.connectors.find(c => c.type === 'oracle')?.endpoint || 'jdbc:oracle:thin:@db-qlab01:1521/XEPDB1',
          authentication: {
            method: 'Database Credential',
            secret_reference: data.connectors.find(c => c.type === 'oracle')?.secretRef || 'secret://oracle/qlab01',
          },
          timeout_seconds: data.connectors.find(c => c.type === 'oracle')?.timeoutSeconds || 30,
          rate_limit_rpm: data.connectors.find(c => c.type === 'oracle')?.rateLimitRpm || 30,
        },
        Kafka: {
          system_name: 'kafka',
          endpoint: data.connectors.find(c => c.type === 'kafka')?.endpoint || 'kafka-qat91.company.net:9092',
          authentication: {
            method: 'TLS Certificate',
            secret_reference: data.connectors.find(c => c.type === 'kafka')?.secretRef || 'secret://kafka/qat91_cert',
          },
          timeout_seconds: data.connectors.find(c => c.type === 'kafka')?.timeoutSeconds || 20,
          rate_limit_rpm: data.connectors.find(c => c.type === 'kafka')?.rateLimitRpm || 200,
        },
        Kubernetes: {
          system_name: 'kubernetes',
          endpoint: data.connectors.find(c => c.type === 'kubernetes')?.endpoint || 'https://k8s-qa.company.net:6443',
          authentication: {
            method: 'Service Account Token',
            token_reference: data.connectors.find(c => c.type === 'kubernetes')?.secretRef || 'secret://k8s/sa_token',
          },
          timeout_seconds: data.connectors.find(c => c.type === 'kubernetes')?.timeoutSeconds || 15,
          rate_limit_rpm: data.connectors.find(c => c.type === 'kubernetes')?.rateLimitRpm || 180,
        },
      },
      connectors: data.connectors.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        scope: c.scope,
        enabled: c.enabled,
        endpoint: c.endpoint,
        auth: {
          secret_ref: c.secretRef,
        },
        timeout_seconds: c.timeoutSeconds,
        rate_limit_rpm: c.rateLimitRpm,
        health_status: c.healthStatus || 'HEALTHY',
      })),
    },
    tools: data.tools.map(t => ({
      id: t.id,
      connector: t.connectorId,
      scope: t.scope,
      enabled: t.enabled,
    })),
    environment_bindings: data.environmentBindings.map(b => ({
      project_environment: b.projectEnvironment,
      bindings: b.bindings,
    })),
    runtime: {
      orchestration: 'google-adk',
      execution_mode: 'evidence_driven',
      tool_selection: {
        strategy: 'dynamic',
        minimum_required_tools: true,
        avoid_calling_all_connectors_by_default: true,
        plan_from_ticket_context: true,
      },
      limits: {
        max_llm_calls: data.runtimeLimits?.maxLlmCalls ?? 12,
        max_tool_calls: data.runtimeLimits?.maxToolCalls ?? 4,
        max_context_chars: data.runtimeLimits?.maxContextChars ?? 64000,
        run_timeout_seconds: data.runtimeLimits?.runTimeoutSeconds ?? 120,
      },
    },
  };
}

/** Return contextual YAML slice for a given step */
export function getContextualYaml(step: number, data: PrismFullConfigurationData, fullDoc?: Record<string, any>): string {
  const doc = fullDoc || buildPrismDocument(data);
  switch (step) {
    case 1:
      return formatToYaml({
        schema_version: doc.schema_version,
        kind: doc.kind,
        metadata: doc.metadata,
      });
    case 2:
      return formatToYaml({
        project_scope: doc.project_scope,
      });
    case 3:
      return formatToYaml({
        configuration_resolution: doc.configuration_resolution,
        policies: doc.policies,
        governance: doc.governance,
        additional_settings: doc.additional_settings,
      });
    case 4:
      return formatToYaml({
        investigation_time_policy: doc.investigation_time_policy,
        jql_dynamic_build: doc.jql_dynamic_build,
        schedules: doc.schedules,
      });
    case 5:
      return formatToYaml({
        connector_bindings: doc.connector_bindings,
        tools: doc.tools,
        environment_bindings: doc.environment_bindings,
      });
    case 6:
    default:
      return formatToYaml(doc);
  }
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
