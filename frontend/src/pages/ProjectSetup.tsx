import React, { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Workflow,
  Copy,
  Check,
  Save,
  Download,
  Database,
  Lock,
  CheckCircle2,
  AlertCircle,
  FolderGit2,
  Boxes,
  Search,
  X,
  ExternalLink,
  Edit3,
  ChevronRight,
  ChevronLeft,
  Info,
  Layers,
  Wrench,
  Link2,
  FileCode,
  SlidersHorizontal,
  CheckSquare,
  Users as UsersIcon,
  Trash2,
  Plus,
  Tag,
  ChevronDown,
  Code,
  Terminal,
} from 'lucide-react';
import {
  fetchProjectSetup,
  fetchProjectEditor,
  fetchProjectRedaction,
  previewProjectRedaction,
  fetchPrincipal,
  fetchConnectorTemplates,
  fetchProjectConnectors,
  deleteProjectConnector,
  validateProjectSetup,
  saveProjectSetup,
  saveProjectEditor,
  setParameterOverride,
  resetParameterOverride,
} from '../services/api';
import type {
  ProjectSetupResponse,
  ProjectValidationResult,
  ConnectorTemplateItem,
  ProjectConnectorInstanceItem,
  ProjectRedactionPolicy,
  RedactionPreviewResponse,
} from '../types/api';
import { ConnectorInstanceEditor } from '../components/ConnectorInstanceEditor';

import {
  ProjectEnvironment,
  TeamMember,
  ScheduleItem,
  ConnectorInstance,
  ToolItem,
  EnvironmentBinding,
  TeamScope,
  JqlScheduleConfig,
  JiraCustomFieldMapping,
  interpolateJql,
  toCfSyntax,
  PrismFullConfigurationData,
  buildPrismDocument,
  getContextualYaml,
  formatToYaml,
  buildProjectConfiguration,
} from '../utils/projectSetupConfig';
import '../styles/project-setup.css';
import { ParameterSettingsPanel } from '../components/ParameterSettingsPanel';


const STEPS = [
  { number: 1, id: 'basic', title: 'Basic Information', desc: 'Name, purpose, tags', icon: FolderGit2 },
  { number: 2, id: 'scope', title: 'Environments & Teams', desc: 'Environments, ownership', icon: Boxes },
  { number: 3, id: 'config', title: 'Configuration', desc: 'Resolution & policies', icon: SlidersHorizontal },
  { number: 4, id: 'time', title: 'Time & Scheduling', desc: 'Time policy, schedules', icon: Clock },
  { number: 5, id: 'connectors-tools', title: 'Connectors & Tools', desc: 'Instances, tools & mapping', icon: Database },
  { number: 6, id: 'review', title: 'Review & Save', desc: 'Validate and save', icon: CheckSquare },
];

// Rich Dark Editor YamlCodeViewer with syntax highlighting and line numbers
const YamlCodeViewer: React.FC<{ code: string; maxHeight?: number | string }> = ({ code, maxHeight = 250 }) => {
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div className="ps-preview-body-wrap" style={{ maxHeight }}>
      {lines.map((line, idx) => {
        let contentEl: React.ReactNode = line;
        const trimmed = line.trim();

        if (trimmed.startsWith('#')) {
          contentEl = <span className="ps-code-comment">{line}</span>;
        } else if (line.includes(':')) {
          const colonIdx = line.indexOf(':');
          const keyPart = line.slice(0, colonIdx);
          const afterColon = line.slice(colonIdx + 1);

          let valEl: React.ReactNode = afterColon;
          const trimmedVal = afterColon.trim();
          if (trimmedVal === 'true' || trimmedVal === 'false' || /^-?\d+(\.\d+)?$/.test(trimmedVal)) {
            valEl = (
              <>
                {afterColon.slice(0, afterColon.indexOf(trimmedVal))}
                <span className="ps-code-num">{trimmedVal}</span>
              </>
            );
          } else if (trimmedVal.length > 0) {
            valEl = (
              <>
                {afterColon.slice(0, afterColon.indexOf(trimmedVal))}
                <span className="ps-code-string">{trimmedVal}</span>
              </>
            );
          }

          contentEl = (
            <>
              <span className="ps-code-key">{keyPart}</span>
              <span style={{ color: '#94a3b8' }}>:</span>
              {valEl}
            </>
          );
        } else if (trimmed.startsWith('- ')) {
          const dashIdx = line.indexOf('- ');
          const indent = line.slice(0, dashIdx);
          const val = line.slice(dashIdx + 2);
          contentEl = (
            <>
              {indent}
              <span className="ps-code-key">- </span>
              <span className="ps-code-string">{val}</span>
            </>
          );
        }

        return (
          <div key={idx} className="ps-code-line">
            <span className="ps-code-gutter">{idx + 1}</span>
            <span className="ps-code-content">{contentEl}</span>
          </div>
        );
      })}
    </div>
  );
};

export const ProjectSetup: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ProjectSetupResponse | null>(null);
  const [redactionPolicy, setRedactionPolicy] = useState<ProjectRedactionPolicy | null>(null);
  const [redactionSample, setRedactionSample] = useState('');
  const [redactionPreview, setRedactionPreview] = useState<RedactionPreviewResponse | null>(null);
  const [redactionPreviewError, setRedactionPreviewError] = useState<string | null>(null);
  const [redactionPreviewLoading, setRedactionPreviewLoading] = useState(false);
  const [principal, setPrincipal] = useState<import('../types/api').Principal | null>(null);
  const [editorVersion, setEditorVersion] = useState<number>(0);
  const [viewFullYaml, setViewFullYaml] = useState<boolean>(false);
  const [showQuickYaml, setShowQuickYaml] = useState<boolean>(false);
  const [showSidebar, setShowSidebar] = useState<boolean>(() => window.innerWidth >= 1680);
  const [templateSearch, setTemplateSearch] = useState<string>('');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>('all');
  const [copied, setCopied] = useState<boolean>(false);

  // Status & Validation
  const [validating, setValidating] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<ProjectValidationResult | null>(null);
  const [statusNotice, setStatusNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Step 1: Basic Information
  const [projectId, setProjectId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [responsibility, setResponsibility] = useState<string>('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [objective, setObjective] = useState<string>('');
  const [timezone, setTimezone] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState<string>('');

  // Step 2: Environments & Teams
  const [environments, setEnvironments] = useState<ProjectEnvironment[]>([]);
  const [envSearch, setEnvSearch] = useState<string>('');
  const [isAddingEnv, setIsAddingEnv] = useState<boolean>(false);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
  const [envForm, setEnvForm] = useState<ProjectEnvironment>({
    id: '',
    displayName: '',
    description: '',
    enabled: true,
  });

  const [teamDl, setTeamDl] = useState<string>('');
  const [teamsChannel, setTeamsChannel] = useState<string>('');
  const [activeTeamTab, setActiveTeamTab] = useState<'managers' | 'owners' | 'analysts'>('managers');
  const [members, setMembers] = useState<{
    managers: TeamMember[];
    owners: TeamMember[];
    analysts: TeamMember[];
  }>({ managers: [], owners: [], analysts: [] });
  const [isAddingMember, setIsAddingMember] = useState<boolean>(false);
  const [memberForm, setMemberForm] = useState<{ name: string; email: string }>({ name: '', email: '' });

  // Step 2 addition: Jira Team Scope (cf[10290] Fix Team & cf[10366] Assigned Team)
  const [teamScope, setTeamScope] = useState<TeamScope>({ coreTeamValues: [], amdocsTeamValues: [], fixTeamField: '', assignedTeamField: '', environmentField: '' });
  const [newCoreTeamVal, setNewCoreTeamVal] = useState<string>('');
  const [newAmdocsTeamVal, setNewAmdocsTeamVal] = useState<string>('');

  const handleAddCoreTeamValue = () => {
    const trimmed = newCoreTeamVal.trim();
    if (!trimmed) return;
    if (!teamScope.coreTeamValues.includes(trimmed)) {
      setTeamScope(prev => ({
        ...prev,
        coreTeamValues: [...prev.coreTeamValues, trimmed],
      }));
    }
    setNewCoreTeamVal('');
  };

  const handleRemoveCoreTeamValue = (val: string) => {
    setTeamScope(prev => ({
      ...prev,
      coreTeamValues: prev.coreTeamValues.filter(v => v !== val),
    }));
  };

  const handleAddAmdocsTeamValue = () => {
    const trimmed = newAmdocsTeamVal.trim();
    if (!trimmed) return;
    if (!teamScope.amdocsTeamValues.includes(trimmed)) {
      setTeamScope(prev => ({
        ...prev,
        amdocsTeamValues: [...prev.amdocsTeamValues, trimmed],
      }));
    }
    setNewAmdocsTeamVal('');
  };

  const handleRemoveAmdocsTeamValue = (val: string) => {
    setTeamScope(prev => ({
      ...prev,
      amdocsTeamValues: prev.amdocsTeamValues.filter(v => v !== val),
    }));
  };

  // Step 3: Configuration (Resolution & Policies)
  const precedence = ['platform', 'project', 'environment', 'profile', 'run'];
  const [overrideRules, setOverrideRules] = useState({
    inheritPlatformDefaults: true,
    projectCanOverride: true,
    environmentCanOverride: true,
    profileCanOverride: true,
    runOverrideRequiresPolicy: true,
  });
  const [dataRetention, setDataRetention] = useState<string>('Standard (90 days)');
  const [accessControl, setAccessControl] = useState<string>('Project Members Only');
  const [auditLogging, setAuditLogging] = useState<string>('Enabled');
  const [projectCategory, setProjectCategory] = useState<string>('Incident Management');
  const [priority, setPriority] = useState<string>('Normal');
  const [enableAnalytics, setEnableAnalytics] = useState<boolean>(true);
  const [enableNotifications, setEnableNotifications] = useState<boolean>(true);
  const [showAdvancedOverrides, setShowAdvancedOverrides] = useState<boolean>(false);

  // Step 4: Time & Scheduling
  const [anchors, setAnchors] = useState<Array<{ source: string; priority: number; confidence: number; label: string }>>([]);
  const [fallbackAnchor, setFallbackAnchor] = useState<string>('');
  const [refinementEnabled, setRefinementEnabled] = useState<boolean>(false);
  const [neverReplaceWithLower, setNeverReplaceWithLower] = useState<boolean>(false);

  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [isAddingSchedule, setIsAddingSchedule] = useState<boolean>(false);
  const [scheduleForm, setScheduleForm] = useState<ScheduleItem>({
    id: '',
    name: '',
    capability: 'triage.poll',
    cron: '',
    timezone: '',
    enabled: false,
    executionType: 'jql',
    targetJqlId: 'polling',
    scriptPath: '',
    adminApproved: false,
    frequencyLabel: '',
    description: '',
  });

  // Step 4 addition: JQL Dynamic Query Builder & Clause Templates
  const [jqlConfig, setJqlConfig] = useState<JqlScheduleConfig>({ pollingTemplate: '', reportingTemplate: '', amdocsDailyTemplate: '', environmentFilterTemplate: '' });
  const [selectedEnvForJql, setSelectedEnvForJql] = useState<string>('');
  const [showJqlBuildSteps, setShowJqlBuildSteps] = useState<boolean>(true);

  // Step 4: Jira custom field mappings loaded from the saved project configuration
  const [jiraCustomFields, setJiraCustomFields] = useState<JiraCustomFieldMapping[]>([]);
  const [isAddingCustomField, setIsAddingCustomField] = useState<boolean>(false);
  const [customFieldSearch, setCustomFieldSearch] = useState<string>('');
  const [activeJqlTarget, setActiveJqlTarget] = useState<'polling' | 'reporting' | 'amdocs' | 'env'>('polling');
  const [newCustomFieldForm, setNewCustomFieldForm] = useState<JiraCustomFieldMapping>({
    logical_name: '',
    customfield_id: '',
    jira_name: '',
    type: 'select',
    mandatory: false,
    scope: 'triage_routing',
    description: '',
  });

  const handleAddCustomField = () => {
    if (!newCustomFieldForm.customfield_id.trim() || !newCustomFieldForm.logical_name.trim()) {
      setStatusNotice({ type: 'error', text: 'Field ID (e.g. customfield_10850) and Logical Name are required.' });
      return;
    }
    const sanitizedId = newCustomFieldForm.customfield_id.trim();
    const sanitizedName = newCustomFieldForm.logical_name.trim().toLowerCase().replace(/\s+/g, '_');
    const newField: JiraCustomFieldMapping = {
      ...newCustomFieldForm,
      customfield_id: sanitizedId,
      logical_name: sanitizedName,
      jira_name: newCustomFieldForm.jira_name.trim() || sanitizedName,
    };
    setJiraCustomFields(prev => [...prev, newField]);
    setIsAddingCustomField(false);
    setNewCustomFieldForm({
      logical_name: '',
      customfield_id: '',
      jira_name: '',
      type: 'select',
      mandatory: false,
      scope: 'triage_routing',
      description: '',
    });
    setStatusNotice({
      type: 'success',
      text: `Custom field '${newField.jira_name}' (${toCfSyntax(newField.customfield_id)}) registered! Available for dynamic JQL.`,
    });
  };

  const handleDeleteCustomField = (customfieldId: string) => {
    setJiraCustomFields(prev => prev.filter(f => f.customfield_id !== customfieldId));
    setStatusNotice({ type: 'info', text: `Custom field ${customfieldId} removed.` });
  };

  const handleInsertFieldIntoJql = (cfId: string) => {
    const cfSyntax = toCfSyntax(cfId);
    if (activeJqlTarget === 'polling') {
      setJqlConfig(prev => ({
        ...prev,
        pollingTemplate: `${prev.pollingTemplate} AND ${cfSyntax} is not EMPTY`,
      }));
    } else if (activeJqlTarget === 'reporting') {
      setJqlConfig(prev => ({
        ...prev,
        reportingTemplate: `${prev.reportingTemplate} AND ${cfSyntax} is not EMPTY`,
      }));
    } else if (activeJqlTarget === 'amdocs') {
      setJqlConfig(prev => ({
        ...prev,
        amdocsDailyTemplate: `${prev.amdocsDailyTemplate} AND ${cfSyntax} is not EMPTY`,
      }));
    } else if (activeJqlTarget === 'env') {
      setJqlConfig(prev => ({
        ...prev,
        environmentFilterTemplate: `${prev.environmentFilterTemplate} AND ${cfSyntax} is not EMPTY`,
      }));
    }
    setStatusNotice({ type: 'info', text: `Appended ${cfSyntax} condition to ${activeJqlTarget} query template` });
  };

  // Step 5: Connectors & Tools (3 Subtabs)
  const [step5Tab, setStep5Tab] = useState<'connectors' | 'tools' | 'mapping'>('connectors');
  const [tools, setTools] = useState<ToolItem[]>([]);

  // Step 5: Connectors & Tools Lifecycle Management
  const [persistedConnectors, setPersistedConnectors] = useState<ProjectConnectorInstanceItem[]>([]);
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplateItem[]>([]);
  const [editingConnector, setEditingConnector] = useState<{
    template?: ConnectorTemplateItem;
    instance?: ProjectConnectorInstanceItem;
  } | null>(null);
  const [isAddingConnector, setIsAddingConnector] = useState<boolean>(false);
  const [connectorSearch, setConnectorSearch] = useState<string>('');

  // Connector instances are owned by the project connector API. Keep the
  // legacy authoring model out of readiness, counts, and generated config.
  const persistedConnectorSummaries = useMemo<ConnectorInstance[]>(() => persistedConnectors.map(conn => ({
    id: conn.instance_id,
    name: conn.system_name,
    type: conn.template_id,
    scope: conn.environment_dependency === 'dependent' ? 'environment' : 'project',
    enabled: conn.enabled,
    endpoint: typeof conn.definition_json?.endpoint === 'string' ? conn.definition_json.endpoint : '',
    secretRef: '',
    timeoutSeconds: typeof conn.definition_json?.timeout_seconds === 'number' ? conn.definition_json.timeout_seconds : 0,
    rateLimitRpm: 0,
    healthStatus: 'UNKNOWN',
  })), [persistedConnectors]);

  const loadProjectConnectors = async (pid: string) => {
    if (!pid) return;
    try {
      const [conns, tmpls] = await Promise.all([
        fetchProjectConnectors(pid).catch(() => []),
        fetchConnectorTemplates().catch(() => []),
      ]);
      setPersistedConnectors(conns);
      setConnectorTemplates(tmpls);
    } catch (err) {
      console.error('Failed to load project connectors or templates', err);
    }
  };

  const handleDeleteConnector = async (instanceId: string) => {
    if (!projectId) return;
    if (!window.confirm(`Are you sure you want to delete connector instance '${instanceId}'?`)) return;
    try {
      await deleteProjectConnector(projectId, instanceId);
      setStatusNotice({ type: 'info', text: `Connector instance '${instanceId}' removed.` });
      await loadProjectConnectors(projectId);
    } catch (err: any) {
      setStatusNotice({ type: 'error', text: err.message || 'Failed to delete connector instance.' });
    }
  };

  // Initial Environment Bindings (Project Environment -> Tool Instances)
  const [environmentBindings, setEnvironmentBindings] = useState<EnvironmentBinding[]>([]);

  // Load initial backend setup
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, editor] = await Promise.all([fetchProjectSetup(), fetchProjectEditor()]);
      setPayload(data);
      // Redaction is a separate read-only policy surface. A policy read failure
      // should not hide the rest of the authenticated project configuration.
      void fetchProjectRedaction().then(setRedactionPolicy).catch(() => setRedactionPolicy(null));
      setEditorVersion(editor.version);
      const document = editor.document as Partial<PrismFullConfigurationData>;
      const metadata = document.metadata;
      if (metadata) {
        if (typeof metadata.name === 'string') setProjectName(metadata.name);
        if (Array.isArray(metadata.responsibility)) setResponsibility(typeof metadata.responsibility[0] === 'string' ? metadata.responsibility[0] : '');
        if (typeof metadata.status === 'string' && (metadata.status === 'active' || metadata.status === 'inactive')) setStatus(metadata.status);
        if (typeof metadata.objective === 'string') setObjective(metadata.objective);
        if (typeof metadata.timezone === 'string') setTimezone(metadata.timezone);
        if (Array.isArray(metadata.tags)) setTags(metadata.tags.filter((tag): tag is string => typeof tag === 'string'));
      }
      const projectScope = document.projectScope;
      const hasAuthoringEnvironments = Boolean(projectScope && Array.isArray(projectScope.environments));
      if (projectScope && Array.isArray(projectScope.environments)) {
        setEnvironments(projectScope.environments as ProjectEnvironment[]);
      }
      if (projectScope) {
        if (typeof projectScope.teamDl === 'string') setTeamDl(projectScope.teamDl);
        if (typeof projectScope.teamsChannel === 'string') setTeamsChannel(projectScope.teamsChannel);
        if (projectScope.members) setMembers(projectScope.members as typeof members);
        if (projectScope.teamScope) setTeamScope(projectScope.teamScope as TeamScope);
      }
      if (document.configurationResolution) {
        if (Array.isArray(document.configurationResolution.precedence)) {
          // Precedence is deployment-defined; the wizard displays the server order.
        }
        if (document.configurationResolution.rules) setOverrideRules(document.configurationResolution.rules as typeof overrideRules);
      }
      if (document.policies) {
        if (typeof document.policies.dataRetention === 'string') setDataRetention(document.policies.dataRetention);
        if (typeof document.policies.accessControl === 'string') setAccessControl(document.policies.accessControl);
        if (typeof document.policies.auditLogging === 'string') setAuditLogging(document.policies.auditLogging);
      }
      if (document.additionalSettings) {
        if (typeof document.additionalSettings.category === 'string') setProjectCategory(document.additionalSettings.category);
        if (typeof document.additionalSettings.priority === 'string') setPriority(document.additionalSettings.priority);
        if (typeof document.additionalSettings.enableAnalytics === 'boolean') setEnableAnalytics(document.additionalSettings.enableAnalytics);
        if (typeof document.additionalSettings.enableNotifications === 'boolean') setEnableNotifications(document.additionalSettings.enableNotifications);
      }
      const timePolicy = document.investigationTimePolicy;
      if (timePolicy) {
        if (Array.isArray(timePolicy.anchors)) setAnchors(timePolicy.anchors);
        if (typeof timePolicy.fallback === 'string') setFallbackAnchor(timePolicy.fallback);
        if (typeof timePolicy.refinementEnabled === 'boolean') setRefinementEnabled(timePolicy.refinementEnabled);
        if (typeof timePolicy.neverReplaceWithLowerConfidence === 'boolean') setNeverReplaceWithLower(timePolicy.neverReplaceWithLowerConfidence);
      }
      if (document.jqlConfiguration) setJqlConfig(document.jqlConfiguration);
      if (Array.isArray(document.jiraCustomFields)) setJiraCustomFields(document.jiraCustomFields);
      if (Array.isArray(document.schedules)) setSchedules(document.schedules);
      if (Array.isArray(document.tools)) setTools(document.tools);
      if (Array.isArray(document.environmentBindings)) setEnvironmentBindings(document.environmentBindings);
      if (data.scope.project_id) {
        setProjectId(data.scope.project_id);
        void loadProjectConnectors(data.scope.project_id);
      }
      // Populate backend environments if present
      if (!hasAuthoringEnvironments && Array.isArray(data.project_layer?.environments) && data.project_layer.environments.length > 0) {
        setEnvironments(
          data.project_layer.environments.map((e: any) => ({
            id: e.id,
            displayName: e.name || e.id,
            description: e.description || '',
            enabled: e.enabled !== false,
            host: e.host || null,
            namespace: e.namespace || null,
            cluster: e.cluster || null,
            splunk_index: e.splunk_index || null,
            jira_env_name: e.jira_env_name || null,
          }))
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load project configuration snapshot.');
    } finally {
      setLoading(false);
    }
  };

  const handleRedactionPreview = async () => {
    const sample = redactionSample.trim();
    if (!sample) return;
    setRedactionPreviewLoading(true);
    setRedactionPreviewError(null);
    try {
      setRedactionPreview(await previewProjectRedaction(sample));
    } catch (cause) {
      setRedactionPreviewError(cause instanceof Error ? cause.message : 'Redaction preview failed.');
    } finally {
      setRedactionPreviewLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void fetchPrincipal().then(setPrincipal).catch(() => setPrincipal(null));
  }, []);

  // Auto-dismiss success notices after 5 seconds to prevent permanent layout displacement
  useEffect(() => {
    if (statusNotice && (statusNotice.type === 'success' || statusNotice.type === 'info')) {
      const timer = setTimeout(() => {
        setStatusNotice(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [statusNotice]);

  // Construct comprehensive Prism full configuration data structure
  const prismFullConfig: PrismFullConfigurationData = useMemo(() => {
    return {
      metadata: {
        id: projectId,
        name: projectName,
        status,
        responsibility: [responsibility],
        objective,
        timezone,
        tags,
      },
      projectScope: {
        environments,
        teamDl,
        teamsChannel,
        members,
        teamScope,
      },
      configurationResolution: {
        precedence,
        rules: overrideRules,
      },
      policies: {
        dataRetention,
        accessControl,
        auditLogging,
      },
      additionalSettings: {
        category: projectCategory,
        priority,
        enableAnalytics,
        enableNotifications,
      },
      investigationTimePolicy: {
        timezone,
        anchors,
        fallback: fallbackAnchor,
        refinementEnabled,
        neverReplaceWithLowerConfidence: neverReplaceWithLower,
        windows: {
          jiraDiscoveryLookback: 'P7D',
          jiraAnalystLookback: 'P7D',
          jiraSimilarityLookback: 'P365D',
          splunkInitialLookback: 'PT1H',
          splunkInitialLookahead: 'PT1H',
          splunkMaxLookback: 'P1D',
          splunkAdaptive: ['PT4H', 'PT12H', 'P1D'],
        },
      },
      jqlConfiguration: jqlConfig,
      jiraCustomFields,
      schedules,
      connectors: persistedConnectorSummaries,
      tools,
      environmentBindings,
    };
  }, [
    projectId,
    projectName,
    status,
    responsibility,
    objective,
    timezone,
    tags,
    environments,
    teamDl,
    teamsChannel,
    members,
    teamScope,
    precedence,
    overrideRules,
    dataRetention,
    accessControl,
    auditLogging,
    projectCategory,
    priority,
    enableAnalytics,
    enableNotifications,
    anchors,
    fallbackAnchor,
    refinementEnabled,
    neverReplaceWithLower,
    jqlConfig,
    jiraCustomFields,
    schedules,
    persistedConnectorSummaries,
    tools,
    environmentBindings,
  ]);

  // Full YAML Document & Contextual YAML Slice
  const fullYamlDoc = useMemo(() => buildPrismDocument(prismFullConfig), [prismFullConfig]);
  const fullYamlText = useMemo(() => formatToYaml(fullYamlDoc), [fullYamlDoc]);
  const contextualYamlText = useMemo(
    () => getContextualYaml(currentStep, prismFullConfig, fullYamlDoc),
    [currentStep, prismFullConfig, fullYamlDoc]
  );

  const displayYaml = viewFullYaml ? fullYamlText : contextualYamlText;

  // Backend Persistence YAML (Formatted according to ProjectLayer constraints)
  const backendSaveYaml = useMemo(() => {
    return formatToYaml(
      buildProjectConfiguration(payload?.project_layer, {
        tenantId: payload?.scope.tenant_id || '',
        projectId: payload?.scope.project_id || projectId || '',
        allowUserPreferences: ['presentation', 'detail'],
        allowUserOverrides: ['incident-triage', 'log-correlation'],
        presentation: 'summary',
        detail: 'standard',
        disabledConnectors: persistedConnectorSummaries.filter(c => !c.enabled).map(c => c.type),
        capProfiles: {},
        maxLlmCalls: 12,
        maxToolCalls: 4,
        maxContextChars: 64000,
        runTimeoutSeconds: 120,
        workflow: { planning: true, attachments: true, specialists: true, parallel_evidence: true },
        prompts: {},
        skills: {},
        environments,
        delegatedSections: payload?.platform_policy?.project_sections,
      })
    );
  }, [payload, projectId, persistedConnectorSummaries, environments]);

  // Tag Handlers
  const handleAddTag = () => {
    const trimmed = newTagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // Environment Handlers
  const handleOpenAddEnv = () => {
    setEnvForm({ id: '', displayName: '', description: '', enabled: true });
    setEditingEnvId(null);
    setIsAddingEnv(true);
  };

  const handleOpenEditEnv = (env: ProjectEnvironment) => {
    setEnvForm({ ...env });
    setEditingEnvId(env.id);
    setIsAddingEnv(true);
  };

  const handleSaveEnv = () => {
    const cleanId = envForm.id.trim().toUpperCase();
    const cleanName = envForm.displayName.trim();
    if (!cleanId || !cleanName) {
      alert('Environment ID and Display Name are required.');
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(cleanId)) {
      alert('Environment ID must contain only alphanumeric characters, underscores, hyphens, and dots.');
      return;
    }
    const updated: ProjectEnvironment = {
      ...envForm,
      id: cleanId,
      displayName: cleanName,
    };
    if (editingEnvId) {
      setEnvironments(prev => prev.map(e => (e.id === editingEnvId ? updated : e)));
    } else {
      if (environments.some(e => e.id === cleanId)) {
        alert(`An environment with ID '${cleanId}' already exists.`);
        return;
      }
      setEnvironments(prev => [...prev, updated]);
    }
    setIsAddingEnv(false);
    setEditingEnvId(null);
  };

  const handleDeleteEnv = (id: string) => {
    setEnvironments(prev => prev.filter(e => e.id !== id));
  };

  const handleToggleEnv = (id: string) => {
    setEnvironments(prev =>
      prev.map(e => (e.id === id ? { ...e, enabled: !e.enabled } : e))
    );
  };

  const handleLoadExampleEnvs = () => {
    void refresh();
    setStatusNotice({
      text: 'Reloaded environments from the saved project configuration.',
      type: 'info',
    });
  };

  // Member Handlers
  const handleAddMember = () => {
    if (!memberForm.name.trim() || !memberForm.email.trim()) return;
    const roleMap: Record<'managers' | 'owners' | 'analysts', 'Manager' | 'Owner' | 'Analyst'> = {
      managers: 'Manager',
      owners: 'Owner',
      analysts: 'Analyst',
    };
    const newMember: TeamMember = {
      id: `${activeTeamTab}-${Date.now()}`,
      name: memberForm.name.trim(),
      email: memberForm.email.trim(),
      role: roleMap[activeTeamTab],
    };
    setMembers({
      ...members,
      [activeTeamTab]: [...members[activeTeamTab], newMember],
    });
    setMemberForm({ name: '', email: '' });
    setIsAddingMember(false);
  };

  const handleRemoveMember = (tab: 'managers' | 'owners' | 'analysts', id: string) => {
    setMembers({
      ...members,
      [tab]: members[tab].filter(m => m.id !== id),
    });
  };

  // Schedule Handlers
  const handleStartAddSchedule = () => {
    setEditingScheduleId(null);
    setScheduleForm({
      id: '',
      name: '',
      capability: 'triage.poll',
      cron: '',
      timezone: timezone || 'America/Chicago',
      enabled: true,
      executionType: 'jql',
      targetJqlId: 'polling',
      scriptPath: '',
      adminApproved: false,
      frequencyLabel: '',
      description: '',
    });
    setIsAddingSchedule(true);
  };

  const handleEditSchedule = (s: ScheduleItem) => {
    setEditingScheduleId(s.id);
    setScheduleForm({ ...s });
    setIsAddingSchedule(true);
  };

  const handleSaveSchedule = () => {
    if (!scheduleForm.id.trim() || !scheduleForm.name.trim()) {
      setStatusNotice({ text: 'Schedule ID and Job Name are required.', type: 'error' });
      return;
    }
    const cleanId = scheduleForm.id.trim();
    if (editingScheduleId) {
      setSchedules(prev => prev.map(s => (s.id === editingScheduleId ? { ...scheduleForm, id: cleanId } : s)));
      setStatusNotice({ text: `Schedule '${scheduleForm.name}' updated!`, type: 'success' });
    } else {
      if (schedules.some(s => s.id === cleanId)) {
        setStatusNotice({ text: `Schedule with ID '${cleanId}' already exists.`, type: 'error' });
        return;
      }
      setSchedules(prev => [...prev, { ...scheduleForm, id: cleanId }]);
      setStatusNotice({ text: `Schedule '${scheduleForm.name}' mapped and added!`, type: 'success' });
    }
    setIsAddingSchedule(false);
    setEditingScheduleId(null);
  };

  const handleToggleSchedule = (id: string) => {
    setSchedules(prev => prev.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const handleDeleteSchedule = (id: string) => {
    setSchedules(schedules.filter(s => s.id !== id));
    setStatusNotice({ text: `Schedule ${id} removed.`, type: 'info' });
  };

  // Copy & Download
  const handleCopyYaml = async () => {
    try {
      await navigator.clipboard.writeText(fullYamlText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([fullYamlText], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prism_${projectId || 'project'}_config.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 3-Tier Validation Checks
  const validationScores = useMemo(() => {
    // 1. Schema
    const hasMetadata = Boolean(projectId && projectName && responsibility);
    const schemaPass = hasMetadata && environments.length > 0;

    // 2. Governance
    const retentionValid = Boolean(dataRetention);
    const auditValid = auditLogging !== 'Disabled';
    const secretRefsValid = persistedConnectors.every(c =>
      Object.entries(c.definition_json?.credentials || {}).every(([key, value]) =>
        !value || !/(?:_ref|token|password|private_key|secret)/i.test(key) || String(value).startsWith('env://')
      )
    );
    const governancePass = retentionValid && auditValid && secretRefsValid;

    // 3. Operational
    const mappedEnvCount = environmentBindings.length;
    const allEnvsMapped = environments.length > 0 && mappedEnvCount >= Math.min(environments.length, 3);
    const enabledConnectorCount = persistedConnectors.filter(c => c.enabled).length;
    const hasOwners = members.owners.length > 0;
    const operationalPass = allEnvsMapped && hasOwners;

    // Overall Readiness Percentage
    let score = 0;
    if (schemaPass) score += 35;
    if (governancePass) score += 35;
    if (operationalPass) score += 30;

    return {
      schemaPass,
      governancePass,
      operationalPass,
      score,
      mappedEnvCount,
      enabledConnectorCount,
      hasOwners,
    };
  }, [projectId, projectName, responsibility, environments, dataRetention, auditLogging, persistedConnectors, environmentBindings, members]);

  const handleValidate = async () => {
    setValidating(true);
    setStatusNotice(null);
    try {
      const res = await validateProjectSetup(backendSaveYaml);
      setValidationResult(res);
      if (res.valid) {
        setStatusNotice({
          text: 'Configuration successfully passed all schema and platform policy checks!',
          type: 'success',
        });
      } else {
        setStatusNotice({
          text: `Validation failed with ${res.errors.length} error(s). Review stage inputs.`,
          type: 'error',
        });
      }
    } catch (cause) {
      setStatusNotice({
        text: cause instanceof Error ? cause.message : 'Validation request failed',
        type: 'error',
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusNotice(null);
    let operationalSaved = false;
    try {
      await saveProjectSetup(backendSaveYaml);
      operationalSaved = true;
      const { connectors: _connectors, ...authoringDocument } = prismFullConfig;
      const editor = await saveProjectEditor(authoringDocument as unknown as Record<string, unknown>, editorVersion);
      setEditorVersion(editor.version);
      setStatusNotice({
        text: `Project '${projectId}' saved. Runtime settings are active; saved editor content does not start schedules or grant access.`,
        type: 'success',
      });
      await refresh();
    } catch (cause) {
      setStatusNotice({
        text: `${operationalSaved ? 'Runtime settings saved, but the authoring draft was not saved. ' : ''}${cause instanceof Error ? cause.message : 'Failed to persist project configuration'}`,
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Filtered Environments for Step 2
  const filteredEnvironments = useMemo(() => {
    if (!envSearch.trim()) return environments;
    const q = envSearch.toLowerCase();
    return environments.filter(
      e => e.id.toLowerCase().includes(q) || e.displayName.toLowerCase().includes(q)
    );
  }, [environments, envSearch]);

  return (
    <div className="view-container project-setup-page">
      {/* Standard Hero Banner Aligned With Platform Pages */}
      <section className="hero-banner">
        <div className="hero-main">
          <div className="hero-eyebrow-row">
            <span className="hero-tag">PROJECT CONFIGURATION</span>
            <span className="hero-tag teal">CONFIGURATION SETUP</span>
          </div>
          <h1 className="hero-title">
            Project <span>Setup</span>
          </h1>
          <p className="hero-lede">
            Manage saved project settings. Scheduled work does not start automatically; access and connector permissions use their dedicated editors.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <ShieldCheck size={12} color="var(--ps-primary)" />
              <b>Progress:</b> Step {currentStep} of 6
            </span>
            <span className="hero-stat-chip">
              <Boxes size={12} color="var(--ps-primary)" />
              <b>Environments:</b> {environments.filter(e => e.enabled === true).length} Active
            </span>
            <span className="hero-stat-chip">
              <Database size={12} color="var(--ps-success)" />
              <b>Connectors:</b> {persistedConnectors.filter(c => c.enabled).length} Enabled
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSidebar(!showSidebar)}
              title="Toggle the configuration preview and status panel"
            >
              <Code size={13} /> {showSidebar ? 'Hide preview' : 'Show preview'}
            </button>
            {currentStep > 1 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
              >
                <ChevronLeft size={13} /> Previous
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refresh()}
              disabled={loading}
              title="Reload saved project configuration"
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'Loading…' : 'Reload'}
            </button>
            {currentStep < 6 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCurrentStep(prev => Math.min(6, prev + 1))}
              >
                Next <ChevronRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving || !principal?.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER'].includes(role))}
              >
                <Save size={13} /> {saving ? 'Saving…' : 'Save configuration'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="ps-redaction-panel" aria-labelledby="project-redaction-heading">
        <div className="ps-redaction-header">
          <div>
            <h2 id="project-redaction-heading">Project redaction</h2>
            <p>Effective protection applied before project evidence is shown to agents.</p>
          </div>
          <span className={`badge ${redactionPolicy?.enabled ? 'badge-active' : 'badge-neutral'}`}>
            {redactionPolicy ? (redactionPolicy.enabled ? 'ENABLED' : 'DISABLED') : 'LOADING'}
          </span>
        </div>
        {redactionPolicy ? (
          <>
            <div className="ps-redaction-summary">
              <span>{redactionPolicy.rules.filter(rule => rule.enabled).length} active built-in rules</span>
              <span>Source: <code>{redactionPolicy.source}</code></span>
              {redactionPolicy.configured_custom_rule_count ? <span>{redactionPolicy.configured_custom_rule_count} custom rules configured</span> : null}
              <details className="ps-redaction-details">
                <summary>View policy details and preview</summary>
                <div className="ps-redaction-meta">
                  <span>Policy <code>{redactionPolicy.policy_id}</code></span>
                  <span>Project <code>{redactionPolicy.project_id}</code></span>
                </div>
                <div className="ps-redaction-rules">
                  {redactionPolicy.rules.length > 0 ? redactionPolicy.rules.map(rule => (
                    <div className="ps-redaction-rule" key={rule.id}>
                      <span className={`ps-redaction-dot ${rule.enabled ? 'enabled' : ''}`} aria-hidden="true" />
                      <div><strong>{rule.label}</strong><span>{rule.description}</span></div>
                    </div>
                  )) : <span className="ps-redaction-muted">No configured rules were returned for this project.</span>}
                </div>
                {(redactionPolicy.limitations.length > 0 || redactionPolicy.custom_rules_enforced === false) && (
                  <div className="ps-redaction-limitations">
                    <strong>Coverage limits</strong>
                    {redactionPolicy.limitations.map(limit => <span key={limit}>{limit}</span>)}
                    {redactionPolicy.custom_rules_enforced === false && redactionPolicy.configured_custom_rule_count ? (
                      <span>{redactionPolicy.configured_custom_rule_count} custom rule(s) are configured but are not enforced by the current runtime.</span>
                    ) : null}
                  </div>
                )}
                <div className="ps-redaction-preview">
              <div>
                <strong>Preview the runtime policy</strong>
                <span>Submit only text you are authorized to inspect. This preview is not saved.</span>
              </div>
              <textarea
                value={redactionSample}
                onChange={event => { setRedactionSample(event.target.value); setRedactionPreview(null); setRedactionPreviewError(null); }}
                placeholder="Paste a short evidence excerpt to inspect its masking"
                maxLength={32000}
                rows={3}
                aria-label="Text to preview through the project redaction policy"
              />
              <div className="ps-redaction-preview-actions">
                <button type="button" className="btn btn-secondary" onClick={() => void handleRedactionPreview()} disabled={!redactionSample.trim() || redactionPreviewLoading}>
                  {redactionPreviewLoading ? 'Previewing…' : 'Preview redaction'}
                </button>
                {redactionPreviewError && <span className="ps-redaction-preview-error" role="alert">{redactionPreviewError}</span>}
              </div>
              {redactionPreview && (
                <pre className="ps-redaction-preview-result" aria-live="polite">{redactionPreview.redacted_text}</pre>
              )}
                </div>
              </details>
            </div>
          </>
        ) : (
          <p className="ps-redaction-muted">The project redaction policy could not be loaded from the authenticated backend.</p>
        )}
      </section>

      {/* Scope Banner */}
      <div className="ps-scope-banner">
        <div className="ps-scope-banner-left">
          <div className="ps-scope-icon-wrap">
            <FolderGit2 size={18} />
          </div>
          <div className="ps-scope-text">
            <div>
              <strong style={{ color: 'var(--ps-text-title)' }}>Configured deployment:</strong>{' '}
              <span className="ps-scope-tag">
                {payload?.scope?.tenant_id || 'Not configured'} / {payload?.scope?.project_id || projectId}
              </span>
            </div>
            <div className="ps-scope-desc">
              Parameters configured here apply exclusively to this tenant/project scope. Platform policies in <code>platform.yaml</code> dictate immutable security controls.
            </div>
          </div>
        </div>
        <a
          className="btn btn-secondary"
          href="/admin/#settings"
          style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
        >
          Project settings <ChevronRight size={13} />
        </a>
      </div>

      {/* Notices */}
      {error && (
        <div className="ps-alert-banner error" role="alert">
          <AlertCircle size={16} className="ps-alert-icon" />
          <span className="ps-alert-text">{error}</span>
          <button type="button" className="ps-alert-close" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      )}

      {statusNotice && (
        <div className={`ps-alert-banner ${statusNotice.type}`}>
          {statusNotice.type === 'success' ? (
            <CheckCircle2 size={16} className="ps-alert-icon" />
          ) : statusNotice.type === 'info' ? (
            <Info size={16} className="ps-alert-icon" />
          ) : (
            <AlertCircle size={16} className="ps-alert-icon" />
          )}
          <span className="ps-alert-text">{statusNotice.text}</span>
          <button type="button" className="ps-alert-close" onClick={() => setStatusNotice(null)} aria-label="Dismiss notice">×</button>
        </div>
      )}

      {/* Main Responsive Layout: 2-Column Default, 3-Column / Drawer when Blueprint is toggled */}
      <div className={`ps-wizard-grid ${showSidebar ? 'with-sidebar' : ''}`}>
        {/* Left Stepper Column */}
        <aside className="ps-stepper-col">
          {STEPS.map(step => {
            const isActive = currentStep === step.number;
            const isCompleted = currentStep > step.number;
            const StepIcon = step.icon;
            return (
              <button
                key={step.number}
                type="button"
                className={`ps-step-btn ${isActive ? 'active' : ''}`}
                onClick={() => setCurrentStep(step.number)}
              >
                <div className={`ps-step-badge ${isCompleted ? 'completed' : ''}`}>
                  {isCompleted ? <Check size={13} /> : step.number}
                </div>
                <div className="ps-step-info">
                  <span className="ps-step-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StepIcon size={13} style={{ color: isActive ? 'var(--ps-primary)' : 'var(--ps-text-muted)' }} />
                    {step.title}
                  </span>
                  <span className="ps-step-desc">{step.desc}</span>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Center Main Step Content */}
        <main className="ps-main-col">
          {/* STEP 1: BASIC INFORMATION */}
          {currentStep === 1 && (
            <div className="ps-card">
              <div className="ps-card-header">
                <div>
                  <h2 className="ps-card-title">Basic Information</h2>
                  <p className="ps-card-subtitle">Define the core details for this project.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void refresh()}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                >
                  Reload Saved Configuration
                </button>
              </div>

              <div className="ps-form-grid">
                <div className="ps-form-group">
                  <label className="ps-form-label" htmlFor="project-id">
                    Project ID <span className="ps-form-label-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="project-id"
                    value={projectId}
                    readOnly
                    aria-readonly="true"
                    className="ps-form-input mono"
                    placeholder="Project ID"
                  />
                  <span className="ps-form-hint">Verified project identity from your signed-in scope</span>
                </div>

                <div className="ps-form-group">
                  <label className="ps-form-label" htmlFor="project-name">
                    Project Name <span className="ps-form-label-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="project-name"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    className="ps-form-input"
                    placeholder="SAG"
                  />
                  <span className="ps-form-hint">Display name for the project</span>
                </div>
              </div>

              <div className="ps-form-grid">
                <div className="ps-form-group">
                  <label className="ps-form-label" htmlFor="project-responsibility">
                    Responsibility <span className="ps-form-label-required">*</span>
                  </label>
                  <select
                    id="project-responsibility"
                    value={responsibility}
                    onChange={e => setResponsibility(e.target.value)}
                    className="ps-form-select"
                  >
                    <option value="Triaging">Triaging</option>
                    <option value="Incident Investigation">Incident Investigation</option>
                    <option value="Root Cause Analysis">Root Cause Analysis</option>
                    <option value="Platform Reliability">Platform Reliability</option>
                  </select>
                  <span className="ps-form-hint">Primary responsibility for this project</span>
                </div>

                <div className="ps-form-group">
                  <span className="ps-form-label" id="project-status-label">Status</span>
                  <div className="ps-status-toggle-group" role="group" aria-labelledby="project-status-label">
                    <button
                      type="button"
                      className={`ps-status-pill-btn ${status === 'active' ? 'active' : ''}`}
                      aria-pressed={status === 'active'}
                      onClick={() => setStatus('active')}
                    >
                      {status === 'active' && <Check size={12} />} Active
                    </button>
                    <button
                      type="button"
                      className={`ps-status-pill-btn ${status === 'inactive' ? 'active' : ''}`}
                      aria-pressed={status === 'inactive'}
                      onClick={() => setStatus('inactive')}
                    >
                      {status === 'inactive' && <Check size={12} />} Inactive
                    </button>
                  </div>
                </div>
              </div>

              <div className="ps-form-group">
                <label className="ps-form-label" htmlFor="project-objective">
                  <span>Objective</span>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>{objective.length}/1000</span>
                </label>
                <textarea
                  id="project-objective"
                  rows={5}
                  value={objective}
                  maxLength={1000}
                  onChange={e => setObjective(e.target.value)}
                  className="ps-form-textarea"
                  placeholder="Describe the main initiative and objective..."
                />
              </div>

              <div className="ps-form-group">
                <label className="ps-form-label" htmlFor="project-timezone">
                  Timezone <span className="ps-form-label-required">*</span>
                </label>
                <select
                  id="project-timezone"
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="ps-form-select"
                >
                  <option value="America/Chicago">America/Chicago (Central Time)</option>
                  <option value="America/New_York">America/New_York (Eastern Time)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                  <option value="UTC">UTC (Universal Coordinated Time)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                </select>
                <span className="ps-form-hint">Wall-clock schedules use standard IANA timezones</span>
              </div>

              <div className="ps-form-group">
                <label className="ps-form-label" htmlFor="project-tags">Tags</label>
                <div className="ps-tags-container">
                  {tags.map(tag => (
                    <span key={tag} className="ps-tag-chip">
                      {tag}
                      <button
                        type="button"
                        className="ps-tag-remove-btn"
                        onClick={() => handleRemoveTag(tag)}
                        title="Remove tag"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    id="project-tags"
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    placeholder="Add a tag..."
                    className="ps-tag-input"
                  />
                </div>
                <span className="ps-form-hint">Type a tag and press Enter or comma to add</span>
              </div>
            </div>
          )}

          {/* STEP 2: ENVIRONMENTS & TEAMS */}
          {currentStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Environments Card */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Environments</h2>
                    <p className="ps-card-subtitle">
                      Add the environments for this project. These can be added, edited, or removed at any time.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleLoadExampleEnvs}
                      style={{ fontSize: 12 }}
                    >
                      Reload Saved Environments
                    </button>
                    {!isAddingEnv && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleOpenAddEnv}
                        style={{ fontSize: 12 }}
                      >
                        <Plus size={13} /> Add Environment
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Add / Edit Form */}
                {isAddingEnv && (
                  <div className="ps-inline-form-card">
                    <h3 className="ps-inline-form-title">
                      {editingEnvId ? `Edit Environment: ${editingEnvId}` : 'Add New Environment'}
                    </h3>
                    <div className="ps-form-grid">
                      <div className="ps-form-group">
                        <label className="ps-form-label">
                          Environment ID <span className="ps-form-label-required">*</span>
                        </label>
                        <input
                          type="text"
                          value={envForm.id}
                          disabled={Boolean(editingEnvId)}
                          onChange={e => setEnvForm({ ...envForm, id: e.target.value })}
                          placeholder="DEV01"
                          className="ps-form-input mono"
                        />
                      </div>
                      <div className="ps-form-group">
                        <label className="ps-form-label">
                          Display Name <span className="ps-form-label-required">*</span>
                        </label>
                        <input
                          type="text"
                          value={envForm.displayName}
                          onChange={e => setEnvForm({ ...envForm, displayName: e.target.value })}
                          placeholder="Development"
                          className="ps-form-input"
                        />
                      </div>
                    </div>

                    <div className="ps-form-group">
                      <label className="ps-form-label">Description (optional)</label>
                      <input
                        type="text"
                        value={envForm.description || ''}
                        onChange={e => setEnvForm({ ...envForm, description: e.target.value })}
                        placeholder="Development environment for testing"
                        className="ps-form-input"
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="ps-switch-label">
                        <span className="ps-switch">
                          <input
                            type="checkbox"
                            checked={envForm.enabled !== false}
                            onChange={e => setEnvForm({ ...envForm, enabled: e.target.checked })}
                          />
                          <span className="ps-slider" />
                        </span>
                        <span>Enabled for RCA Runs</span>
                      </label>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setIsAddingEnv(false);
                            setEditingEnvId(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button type="button" className="btn btn-primary" onClick={handleSaveEnv}>
                          {editingEnvId ? 'Update' : 'Add'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Table Actions */}
                <div className="ps-table-actions-bar">
                  <div className="ps-search-input-wrap">
                    <Search size={14} />
                    <input
                      type="text"
                      placeholder="Search environments..."
                      value={envSearch}
                      onChange={e => setEnvSearch(e.target.value)}
                      className="ps-search-input"
                    />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {filteredEnvironments.filter(e => e.enabled !== false).length} of {filteredEnvironments.length} environments enabled
                  </span>
                </div>

                {/* Environments Table */}
                {filteredEnvironments.length === 0 ? (
                  <div className="ps-empty-state">
                    <Boxes size={28} style={{ opacity: 0.5 }} />
                    <div className="ps-empty-title">No environments found</div>
                    <div className="ps-empty-desc">Add custom environments or click &apos;Reload Saved Environments&apos;.</div>
                  </div>
                ) : (
                  <div className="ps-table-container">
                    <table className="ps-table">
                      <thead>
                        <tr>
                          <th style={{ width: 36 }}>#</th>
                          <th>Environment ID</th>
                          <th>Display Name</th>
                          <th>Description</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEnvironments.map((env, idx) => (
                          <tr key={env.id}>
                            <td style={{ color: 'var(--ps-text-dim)', fontWeight: 600 }}>{idx + 1}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--ps-primary)' }}>
                              {env.id}
                            </td>
                            <td style={{ fontWeight: 600, color: 'var(--ps-text-title)' }}>{env.displayName}</td>
                            <td style={{ color: 'var(--ps-text-muted)' }}>{env.description || '—'}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleToggleEnv(env.id)}
                                className={env.enabled !== false ? 'ps-badge-enabled' : 'ps-badge-disabled'}
                                style={{ cursor: 'pointer', border: 'none' }}
                              >
                                <span className={env.enabled !== false ? 'ps-badge-enabled-dot' : 'ps-badge-disabled-dot'} />
                                {env.enabled !== false ? 'Enabled' : 'Disabled'}
                              </button>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => handleOpenEditEnv(env)}
                                  style={{ padding: '3px 8px', fontSize: 11 }}
                                  title="Edit environment"
                                >
                                  <Edit3 size={11} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => handleDeleteEnv(env.id)}
                                  style={{ padding: '3px 8px', fontSize: 11, color: '#ef4444' }}
                                  title="Delete environment"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Teams & Ownership Card */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Teams & Ownership</h2>
                    <p className="ps-card-subtitle">
                      Define the teams and individuals responsible for this project.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsAddingMember(!isAddingMember)}
                    style={{ fontSize: 12 }}
                  >
                    <Plus size={13} /> Add Member
                  </button>
                </div>

                <div className="ps-form-grid">
                  <div className="ps-form-group">
                    <label className="ps-form-label">Team Distribution List (DL)</label>
                    <input
                      type="text"
                      value={teamDl}
                      onChange={e => setTeamDl(e.target.value)}
                      placeholder="triage-leads@company.internal"
                      className="ps-form-input"
                    />
                  </div>
                  <div className="ps-form-group">
                    <label className="ps-form-label">Teams / Slack Notification Channel</label>
                    <input
                      type="text"
                      value={teamsChannel}
                      onChange={e => setTeamsChannel(e.target.value)}
                      placeholder="https://teams.microsoft.com/..."
                      className="ps-form-input"
                    />
                  </div>
                </div>

                {/* Subtabs for Managers, Owners, Analysts */}
                <div className="ps-subtabs">
                  <button
                    type="button"
                    className={`ps-subtab-btn ${activeTeamTab === 'managers' ? 'active' : ''}`}
                    onClick={() => setActiveTeamTab('managers')}
                  >
                    Managers <span className="ps-subtab-count">{members.managers.length}</span>
                  </button>
                  <button
                    type="button"
                    className={`ps-subtab-btn ${activeTeamTab === 'owners' ? 'active' : ''}`}
                    onClick={() => setActiveTeamTab('owners')}
                  >
                    Owners <span className="ps-subtab-count">{members.owners.length}</span>
                  </button>
                  <button
                    type="button"
                    className={`ps-subtab-btn ${activeTeamTab === 'analysts' ? 'active' : ''}`}
                    onClick={() => setActiveTeamTab('analysts')}
                  >
                    Analysts <span className="ps-subtab-count">{members.analysts.length}</span>
                  </button>
                </div>

                {/* Inline Add Member */}
                {isAddingMember && (
                  <div className="ps-inline-form-card">
                    <h4 className="ps-inline-form-title">
                      Add {activeTeamTab.slice(0, -1)} Member
                    </h4>
                    <div className="ps-form-grid">
                      <div className="ps-form-group">
                        <label className="ps-form-label">Full Name *</label>
                        <input
                          type="text"
                          value={memberForm.name}
                          onChange={e => setMemberForm({ ...memberForm, name: e.target.value })}
                          placeholder="Jane Doe"
                          className="ps-form-input"
                        />
                      </div>
                      <div className="ps-form-group">
                        <label className="ps-form-label">Email Address *</label>
                        <input
                          type="email"
                          value={memberForm.email}
                          onChange={e => setMemberForm({ ...memberForm, email: e.target.value })}
                          placeholder="jdoe@company.internal"
                          className="ps-form-input"
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setIsAddingMember(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={handleAddMember}>
                        Add to {activeTeamTab}
                      </button>
                    </div>
                  </div>
                )}

                {/* Member Table */}
                {members[activeTeamTab].length === 0 ? (
                  <div className="ps-empty-state">
                    <UsersIcon size={28} style={{ opacity: 0.5 }} />
                    <div className="ps-empty-title">No {activeTeamTab} added yet</div>
                    <div className="ps-empty-desc">
                      Add project {activeTeamTab} who will participate in this initiative.
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setIsAddingMember(true)}
                      style={{ fontSize: 12, marginTop: 6 }}
                    >
                      + Add {activeTeamTab.slice(0, -1)}
                    </button>
                  </div>
                ) : (
                  <div className="ps-table-container">
                    <table className="ps-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members[activeTeamTab].map(m => (
                          <tr key={m.id}>
                            <td style={{ fontWeight: 600 }}>{m.name}</td>
                            <td style={{ color: 'var(--muted)' }}>{m.email}</td>
                            <td>
                              <span className="badge badge-neutral">{m.role}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleRemoveMember(activeTeamTab, m.id)}
                                style={{ padding: '2px 8px', fontSize: 11, color: '#ef4444' }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Jira team scope and custom field bindings */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag size={16} style={{ color: 'var(--ps-primary)' }} />
                      Jira Team Scoping (cf[10290] Fix Team & cf[10366] Assigned Team)
                    </h2>
                    <p className="ps-card-subtitle">
                      Team option values used for automated ticket polling and reporting. JQL queries are built dynamically at runtime from these lists — never hardcode team strings directly into raw JQL.
                    </p>
                  </div>
                </div>

                <div className="ps-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {/* Core Team Values */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="ps-form-label" style={{ marginBottom: 0 }}>
                        Core Team Values (Fix/Assigned Team)
                      </label>
                      <span className="ps-cf-badge">cf[10290] / cf[10366]</span>
                    </div>
                    <div className="ps-tag-list">
                      {teamScope.coreTeamValues.map(val => (
                        <span key={val} className="ps-tag-chip">
                          {val}
                          <button
                            type="button"
                            className="ps-tag-remove"
                            onClick={() => handleRemoveCoreTeamValue(val)}
                            title={`Remove ${val}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {teamScope.coreTeamValues.length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--ps-text-dim)', fontStyle: 'italic' }}>
                          No core team values configured. Polling query will omit core team clause.
                        </span>
                      )}
                    </div>
                    <div className="ps-tag-input-row">
                      <input
                        type="text"
                        value={newCoreTeamVal}
                        onChange={e => setNewCoreTeamVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCoreTeamValue();
                          }
                        }}
                        placeholder="Add team option (e.g. SAG Triage)"
                        className="ps-form-input"
                        style={{ fontSize: 12 }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleAddCoreTeamValue}
                        style={{ fontSize: 12, padding: '6px 12px' }}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Vendor / Partner Team Values (Amdocs) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="ps-form-label" style={{ marginBottom: 0 }}>
                        Vendor / Partner Team Values (Amdocs Scope)
                      </label>
                      <span className="ps-cf-badge" style={{ color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                        amdocs_team_values
                      </span>
                    </div>
                    <div className="ps-tag-list">
                      {teamScope.amdocsTeamValues.map(val => (
                        <span key={val} className="ps-tag-chip vendor">
                          {val}
                          <button
                            type="button"
                            className="ps-tag-remove"
                            onClick={() => handleRemoveAmdocsTeamValue(val)}
                            title={`Remove ${val}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {teamScope.amdocsTeamValues.length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--ps-text-dim)', fontStyle: 'italic' }}>
                          No vendor team values configured. Amdocs daily reporting job will be paused per dynamic build rule 5.
                        </span>
                      )}
                    </div>
                    <div className="ps-tag-input-row">
                      <input
                        type="text"
                        value={newAmdocsTeamVal}
                        onChange={e => setNewAmdocsTeamVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddAmdocsTeamValue();
                          }
                        }}
                        placeholder="Add vendor option (e.g. Amdocs Core)"
                        className="ps-form-input"
                        style={{ fontSize: 12 }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleAddAmdocsTeamValue}
                        style={{ fontSize: 12, padding: '6px 12px' }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderRadius: 6,
                    background: 'var(--ps-card-bg)',
                    border: '1px solid var(--ps-border-subtle)',
                    marginTop: 8,
                    fontSize: 12,
                    color: 'var(--ps-text-muted)',
                  }}
                >
                  <Info size={15} style={{ color: 'var(--ps-primary)', flexShrink: 0 }} />
                  <div>
                    <strong>Query builder behavior:</strong> Option values are automatically quoted and joined into{' '}
                    <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ps-primary)' }}>IN (...)</code> clauses in Step 4. If any list is empty, that OR-branch is safely dropped rather than emitting invalid{' '}
                    <code style={{ fontFamily: 'var(--font-mono)' }}>in ()</code>.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CONFIGURATION (RESOLUTION & POLICIES) */}
          {currentStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Configuration priority</h2>
                    <p className="ps-card-subtitle">
                      Set the order used when more than one setting applies.
                    </p>
                  </div>
                </div>

                <div className="ps-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {/* Fixed Precedence Hierarchy */}
                  <div>
                    <label className="ps-form-label" style={{ marginBottom: 8 }}>
                      Priority order (set by platform)
                    </label>
                    <div className="ps-precedence-list">
                      <div className="ps-precedence-item locked">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="ps-precedence-rank">1</span>
                          <div>
                            <strong>Platform</strong>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Global platform defaults</div>
                          </div>
                        </div>
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                          <Lock size={10} /> Locked
                        </span>
                      </div>

                      <div className="ps-precedence-item">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="ps-precedence-rank">2</span>
                          <div>
                            <strong>Project</strong>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>↓ Overrides Platform defaults</div>
                          </div>
                        </div>
                        <span className="badge badge-active" style={{ fontSize: 10 }}>Project Scope</span>
                      </div>

                      <div className="ps-precedence-item">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="ps-precedence-rank">3</span>
                          <div>
                            <strong>Environment</strong>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>↓ Overrides Project defaults</div>
                          </div>
                        </div>
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>Target Env</span>
                      </div>

                      <div className="ps-precedence-item">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="ps-precedence-rank">4</span>
                          <div>
                            <strong>Profile</strong>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>↓ User profile settings</div>
                          </div>
                        </div>
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>User Tier</span>
                      </div>

                      <div className="ps-precedence-item">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="ps-precedence-rank">5</span>
                          <div>
                            <strong>Run</strong>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>↓ Policy controlled runtime override</div>
                          </div>
                        </div>
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>Runtime</span>
                      </div>
                    </div>
                  </div>

                  {/* Override Rules Toggles */}
                  <div>
                    <label className="ps-form-label" style={{ marginBottom: 8 }}>
                      Who can override values
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Inherit platform defaults</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Use platform defaults as base configuration</div>
                        </div>
                        <label className="ps-switch">
                          <input
                            type="checkbox"
                            checked={overrideRules.inheritPlatformDefaults}
                            onChange={e => setOverrideRules({ ...overrideRules, inheritPlatformDefaults: e.target.checked })}
                          />
                          <span className="ps-slider" />
                        </label>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Project can override</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Allow project level overrides for delegated sections</div>
                        </div>
                        <label className="ps-switch">
                          <input
                            type="checkbox"
                            checked={overrideRules.projectCanOverride}
                            onChange={e => setOverrideRules({ ...overrideRules, projectCanOverride: e.target.checked })}
                          />
                          <span className="ps-slider" />
                        </label>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Environment can override</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Allow environment level overrides for tools</div>
                        </div>
                        <label className="ps-switch">
                          <input
                            type="checkbox"
                            checked={overrideRules.environmentCanOverride}
                            onChange={e => setOverrideRules({ ...overrideRules, environmentCanOverride: e.target.checked })}
                          />
                          <span className="ps-slider" />
                        </label>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Profile can override</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Allow individual user profile overrides</div>
                        </div>
                        <label className="ps-switch">
                          <input
                            type="checkbox"
                            checked={overrideRules.profileCanOverride}
                            onChange={e => setOverrideRules({ ...overrideRules, profileCanOverride: e.target.checked })}
                          />
                          <span className="ps-slider" />
                        </label>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Run override requires policy</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Require explicit policy permission for runtime inputs</div>
                        </div>
                        <label className="ps-switch">
                          <input
                            type="checkbox"
                            checked={overrideRules.runOverrideRequiresPolicy}
                            onChange={e => setOverrideRules({ ...overrideRules, runOverrideRequiresPolicy: e.target.checked })}
                          />
                          <span className="ps-slider" />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Project Policies Card */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Project Policies</h2>
                    <p className="ps-card-subtitle">Configure project-specific policies and compliance controls.</p>
                  </div>
                </div>

                <div className="ps-form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div className="ps-form-group">
                    <label className="ps-form-label">Data Retention Policy</label>
                    <select
                      value={dataRetention}
                      onChange={e => setDataRetention(e.target.value)}
                      className="ps-form-select"
                    >
                      <option value="Standard (90 days)">Standard (90 days)</option>
                      <option value="30 days">30 days</option>
                      <option value="60 days">60 days</option>
                      <option value="180 days">180 days</option>
                      <option value="1 year">1 year</option>
                    </select>
                    <span className="ps-form-hint">How long to retain investigation data & artifacts</span>
                  </div>

                  <div className="ps-form-group">
                    <label className="ps-form-label">Access Control Policy</label>
                    <select
                      value={accessControl}
                      onChange={e => setAccessControl(e.target.value)}
                      className="ps-form-select"
                    >
                      <option value="Project Members Only">Project Members Only</option>
                      <option value="Organization">Organization Read</option>
                      <option value="Role-Based">Role-Based Access Control</option>
                    </select>
                    <span className="ps-form-hint">Who can view and trigger runs in this project</span>
                  </div>

                  <div className="ps-form-group">
                    <label className="ps-form-label">Audit Logging</label>
                    <select
                      value={auditLogging}
                      onChange={e => setAuditLogging(e.target.value)}
                      className="ps-form-select"
                    >
                      <option value="Enabled">Enabled (Standard)</option>
                      <option value="Verbose">Verbose (Full payloads)</option>
                      <option value="Minimal">Minimal</option>
                    </select>
                    <span className="ps-form-hint">Track all investigation queries and tool calls</span>
                  </div>
                </div>

                <div className="ps-form-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
                  <div className="ps-form-group">
                    <label className="ps-form-label">Project Category</label>
                    <select
                      value={projectCategory}
                      onChange={e => setProjectCategory(e.target.value)}
                      className="ps-form-select"
                    >
                      <option value="Incident Management">Incident Management</option>
                      <option value="Triage & Routing">Triage & Routing</option>
                      <option value="Platform Reliability">Platform Reliability</option>
                      <option value="Quality Engineering">Quality Engineering</option>
                    </select>
                  </div>

                  <div className="ps-form-group">
                    <label className="ps-form-label">Priority</label>
                    <select
                      value={priority}
                      onChange={e => setPriority(e.target.value)}
                      className="ps-form-select"
                    >
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Normal">Normal</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                </div>
              </div>

              <details
                className="ps-advanced-overrides"
                open={showAdvancedOverrides}
                onToggle={event => setShowAdvancedOverrides(event.currentTarget.open)}
              >
                <summary>
                  <span className="ps-advanced-overrides-summary">
                    <SlidersHorizontal size={15} />
                    <span>
                      <strong>Advanced overrides</strong>
                      <small>Optional project-level parameter values</small>
                    </span>
                  </span>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className="ps-advanced-overrides-body">
                  <div className="ps-advanced-overrides-intro">
                    <p>
                      Use these overrides only when a project needs a value different from the platform default. The full parameter catalog stays in Parameter Studio.
                    </p>
                    <a className="btn btn-secondary" href="#parameters?scope=project">
                      Open Parameter Studio <ExternalLink size={13} />
                    </a>
                  </div>
                  {principal && <ParameterSettingsPanel principal={principal} scope="project" />}
                </div>
              </details>
            </div>
          )}

          {/* STEP 4: TIME & SCHEDULING */}
          {currentStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Anchor Resolution Priority */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Investigation Time Policy</h2>
                    <p className="ps-card-subtitle">
                      Temporal policy used across all incident investigation capabilities. Anchors resolve incident discovery windows.
                    </p>
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--tx)' }}>
                    Anchor Resolution Priority & Confidence Rating
                  </h4>
                  <div className="ps-anchor-list">
                    {anchors.map(a => (
                      <div key={a.source} className="ps-anchor-item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className="ps-anchor-rank-badge">#{a.priority}</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{a.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                              {a.source}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`badge ${a.confidence >= 0.9 ? 'badge-active' : 'badge-neutral'}`}>
                            Confidence: {a.confidence}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ps-form-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
                  <div className="ps-form-group">
                    <label className="ps-form-label">Guaranteed Fallback Anchor</label>
                    <input
                      type="text"
                      value={fallbackAnchor}
                      disabled
                      className="ps-form-input mono"
                      style={{ background: 'var(--card-subtle)' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
                    <label className="ps-switch-label">
                      <span className="ps-switch">
                        <input
                          type="checkbox"
                          checked={refinementEnabled}
                          onChange={e => setRefinementEnabled(e.target.checked)}
                        />
                        <span className="ps-slider" />
                      </span>
                      <span>Temporal Refinement Enabled</span>
                    </label>

                    <label className="ps-switch-label">
                      <span className="ps-switch">
                        <input
                          type="checkbox"
                          checked={neverReplaceWithLower}
                          onChange={e => setNeverReplaceWithLower(e.target.checked)}
                        />
                        <span className="ps-slider" />
                      </span>
                      <span>Never replace with lower confidence anchor</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* JQL query builder and clause templates */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Code size={16} style={{ color: 'var(--ps-primary)' }} />
                      JQL Dynamic Query Builder & Clause Templates
                    </h2>
                    <p className="ps-card-subtitle">
                      Clause templates are assembled from saved team scope values, member account IDs, environment selection, and incident anchors.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowJqlBuildSteps(!showJqlBuildSteps)}
                      style={{ fontSize: 12 }}
                    >
                      {showJqlBuildSteps ? 'Hide Build Steps' : 'View Build Procedure'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setJqlConfig({ pollingTemplate: '', reportingTemplate: '', amdocsDailyTemplate: '', environmentFilterTemplate: '' })}
                      style={{ fontSize: 12 }}
                    >
                      Clear Templates
                    </button>
                  </div>
                </div>

                {/* 5-Step Dynamic Build Procedure Explanation */}
                {showJqlBuildSteps && (
                  <div className="ps-build-steps-box">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span className="ps-scope-tag" style={{ margin: 0 }}>jql_dynamic_build</span>
                      <strong style={{ fontSize: 12, color: 'var(--ps-text-title)' }}>
                        Runtime JQL Build Contract (5-Step Deterministic Sequence)
                      </strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--ps-text-muted)', lineHeight: 1.5 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className="ps-step-pill">1</span>
                        <div>
                          <strong style={{ color: 'var(--ps-text-body)' }}>Read Source Lists:</strong> Read fresh from config for this run:{' '}
                          <code className="mono">team_scope.core_team_values</code>,{' '}
                          <code className="mono">team_scope.amdocs_team_values</code>, and members (<code className="mono">owners + analysts</code>).
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className="ps-step-pill">2</span>
                        <div>
                          <strong style={{ color: 'var(--ps-text-body)' }}>Resolve Account IDs:</strong> For commentedBy/assignee scoping, resolve member emails to Jira accountIds via{' '}
                          <code className="mono">GET /rest/api/3/user/search?query=&#123;email&#125;</code>.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className="ps-step-pill">3</span>
                        <div>
                          <strong style={{ color: 'var(--ps-text-body)' }}>Build Quoted IN-Clauses:</strong> Quote and comma-join resolved values ({' '}
                          <code className="mono">&quot;SAG Triage&quot;, &quot;Digital Platform&quot;</code>). Never string-concatenate raw values without quoting.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className="ps-step-pill">4</span>
                        <div>
                          <strong style={{ color: 'var(--ps-text-body)' }}>Substitute Placeholders:</strong> Substitute built lists into clause template placeholders (<code className="mono">&#123;core_team_in_clause&#125;</code>, <code className="mono">&#123;owners_and_analysts_account_ids&#125;</code>).
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className="ps-step-pill">5</span>
                        <div>
                          <strong style={{ color: 'var(--ps-text-body)' }}>Drop Empty Branches:</strong> If any source list is empty, drop that OR-branch rather than emitting invalid{' '}
                          <code className="mono">in ()</code>.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 1. JIRA CUSTOM FIELDS: SCHEMA & DYNAMIC ROLE BINDINGS */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ps-text-title)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database size={15} style={{ color: 'var(--ps-primary)' }} />
                        1. Jira Custom Field Schema &amp; Dynamic Role Bindings (Configure Custom Fields First)
                      </h3>
                      <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--ps-text-muted)' }}>
                        Field IDs are instance-specific (<code className="mono">cf[10290]</code>, <code className="mono">cf[10366]</code>). Map which custom fields serve as Fix Team, Assigned Team, and Environment, or add new custom fields below. The dynamic queries below will immediately use these field IDs.
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setIsAddingCustomField(!isAddingCustomField)}
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        <Plus size={12} /> Add Custom Field
                      </button>
                    </div>
                  </div>

                  {/* Inline Add Custom Field Form */}
                  {isAddingCustomField && (
                    <div className="ps-inline-form-card" style={{ border: '1px solid var(--ps-primary-border)', background: 'var(--ps-card-bg)' }}>
                      <h4 className="ps-inline-form-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Plus size={14} style={{ color: 'var(--ps-primary)' }} />
                        Add New Jira Custom Field to Project Registry
                      </h4>
                      <div className="ps-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                        <div className="ps-form-group">
                          <label className="ps-form-label">
                            Field ID * <span style={{ fontSize: 10, color: 'var(--ps-text-dim)' }}>(e.g. customfield_10850 or cf[10850])</span>
                          </label>
                          <input
                            type="text"
                            value={newCustomFieldForm.customfield_id}
                            onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, customfield_id: e.target.value })}
                            placeholder="customfield_10850"
                            className="ps-form-input mono"
                            style={{ fontSize: 12 }}
                          />
                        </div>
                        <div className="ps-form-group">
                          <label className="ps-form-label">
                            Logical Name * <span style={{ fontSize: 10, color: 'var(--ps-text-dim)' }}>(platform-agnostic)</span>
                          </label>
                          <input
                            type="text"
                            value={newCustomFieldForm.logical_name}
                            onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, logical_name: e.target.value })}
                            placeholder="root_cause_subservice"
                            className="ps-form-input mono"
                            style={{ fontSize: 12 }}
                          />
                        </div>
                        <div className="ps-form-group">
                          <label className="ps-form-label">Jira Field Display Name</label>
                          <input
                            type="text"
                            value={newCustomFieldForm.jira_name}
                            onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, jira_name: e.target.value })}
                            placeholder="Root Cause Subservice"
                            className="ps-form-input"
                            style={{ fontSize: 12 }}
                          />
                        </div>
                        <div className="ps-form-group">
                          <label className="ps-form-label">Field Type</label>
                          <select
                            value={newCustomFieldForm.type}
                            onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, type: e.target.value })}
                            className="ps-form-select"
                            style={{ fontSize: 12 }}
                          >
                            <option value="select">select</option>
                            <option value="cascading_select">cascading_select</option>
                            <option value="text">text</option>
                            <option value="user">user</option>
                            <option value="date">date</option>
                            <option value="number">number</option>
                          </select>
                        </div>
                        <div className="ps-form-group">
                          <label className="ps-form-label">Scope</label>
                          <select
                            value={newCustomFieldForm.scope}
                            onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, scope: e.target.value })}
                            className="ps-form-select"
                            style={{ fontSize: 12 }}
                          >
                            <option value="triage_routing">triage_routing</option>
                            <option value="incident_scope">incident_scope</option>
                            <option value="investigation">investigation</option>
                            <option value="accountability">accountability</option>
                            <option value="quality_assurance">quality_assurance</option>
                            <option value="governance">governance</option>
                          </select>
                        </div>
                      </div>

                      <div className="ps-form-group">
                        <label className="ps-form-label">Description (Optional)</label>
                        <input
                          type="text"
                          value={newCustomFieldForm.description}
                          onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, description: e.target.value })}
                          placeholder="Describes the subservice or domain component responsible for incident"
                          className="ps-form-input"
                          style={{ fontSize: 12 }}
                        />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label className="ps-switch-label" style={{ fontSize: 11 }}>
                          <span className="ps-switch">
                            <input
                              type="checkbox"
                              checked={newCustomFieldForm.mandatory}
                              onChange={e => setNewCustomFieldForm({ ...newCustomFieldForm, mandatory: e.target.checked })}
                            />
                            <span className="ps-slider" />
                          </span>
                          <span>Mandatory Field for Triage</span>
                        </label>

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setIsAddingCustomField(false)}
                            style={{ fontSize: 11 }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleAddCustomField}
                            style={{ fontSize: 11 }}
                          >
                            Save &amp; Register Field
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Dynamic Role Mapping Selectors */}
                  <div className="ps-cf-role-grid">
                    {/* Fix Team Field Role */}
                    <div className="ps-cf-role-item">
                      <div className="ps-cf-role-header">
                        <span>Fix Team Field Role</span>
                        <span className="ps-cf-badge">{toCfSyntax(teamScope.fixTeamField)}</span>
                      </div>
                      <select
                        value={teamScope.fixTeamField}
                        onChange={e => setTeamScope({ ...teamScope, fixTeamField: e.target.value })}
                        className="ps-form-select"
                        style={{ fontSize: 11.5 }}
                      >
                        {jiraCustomFields.map(cf => (
                          <option key={cf.customfield_id} value={cf.customfield_id}>
                            {toCfSyntax(cf.customfield_id)} — {cf.jira_name} ({cf.logical_name})
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 10.5, color: 'var(--ps-text-muted)' }}>
                        Supplies <code className="mono">&#123;fix_team_field&#125;</code> in JQL
                      </span>
                    </div>

                    {/* Assigned Team Field Role */}
                    <div className="ps-cf-role-item">
                      <div className="ps-cf-role-header">
                        <span>Assigned Team Field Role</span>
                        <span className="ps-cf-badge">{toCfSyntax(teamScope.assignedTeamField)}</span>
                      </div>
                      <select
                        value={teamScope.assignedTeamField}
                        onChange={e => setTeamScope({ ...teamScope, assignedTeamField: e.target.value })}
                        className="ps-form-select"
                        style={{ fontSize: 11.5 }}
                      >
                        {jiraCustomFields.map(cf => (
                          <option key={cf.customfield_id} value={cf.customfield_id}>
                            {toCfSyntax(cf.customfield_id)} — {cf.jira_name} ({cf.logical_name})
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 10.5, color: 'var(--ps-text-muted)' }}>
                        Supplies <code className="mono">&#123;assigned_team_field&#125;</code> in JQL
                      </span>
                    </div>

                    {/* Environment Field Role */}
                    <div className="ps-cf-role-item">
                      <div className="ps-cf-role-header">
                        <span>Environment Field Role</span>
                        <span className="ps-cf-badge">{toCfSyntax(teamScope.environmentField)}</span>
                      </div>
                      <select
                        value={teamScope.environmentField}
                        onChange={e => setTeamScope({ ...teamScope, environmentField: e.target.value })}
                        className="ps-form-select"
                        style={{ fontSize: 11.5 }}
                      >
                        {jiraCustomFields.map(cf => (
                          <option key={cf.customfield_id} value={cf.customfield_id}>
                            {toCfSyntax(cf.customfield_id)} — {cf.jira_name} ({cf.logical_name})
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 10.5, color: 'var(--ps-text-muted)' }}>
                        Supplies <code className="mono">&#123;environment_field&#125;</code> in JQL
                      </span>
                    </div>
                  </div>

                  {/* Custom Fields Quick Insert Toolbar */}
                  <div
                    style={{
                      background: 'var(--ps-card-bg)',
                      border: '1px solid var(--ps-border-subtle)',
                      borderRadius: 'var(--radius-md, 8px)',
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag size={13} style={{ color: 'var(--ps-primary)' }} />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ps-text-title)' }}>
                          Registered Custom Fields ({jiraCustomFields.length})
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--ps-text-muted)' }}>
                          Click &apos;+ Insert&apos; to append field to target template
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--ps-text-muted)' }}>Target Template:</span>
                        <select
                          value={activeJqlTarget}
                          onChange={e => setActiveJqlTarget(e.target.value as any)}
                          className="ps-form-select"
                          style={{ fontSize: 11, padding: '2px 8px', width: 'auto' }}
                        >
                          <option value="polling">1. Polling Query</option>
                          <option value="reporting">2. Weekly Digest</option>
                          <option value="amdocs">3. Amdocs Vendor Report</option>
                          <option value="env">4. Environment Filter</option>
                        </select>
                      </div>
                    </div>

                    <div className="ps-cf-chip-container">
                      {jiraCustomFields.map(cf => {
                        const isFixTeam = cf.customfield_id === teamScope.fixTeamField;
                        const isAssignedTeam = cf.customfield_id === teamScope.assignedTeamField;
                        const isEnv = cf.customfield_id === teamScope.environmentField;
                        return (
                          <div key={cf.customfield_id} className="ps-cf-chip-pill">
                            <span className="ps-cf-badge" style={{ padding: '0 4px', fontSize: 10 }}>
                              {toCfSyntax(cf.customfield_id)}
                            </span>
                            <span style={{ fontWeight: 600 }}>{cf.jira_name}</span>
                            {isFixTeam && <span className="badge badge-active" style={{ fontSize: 9, padding: '1px 4px' }}>Fix Team</span>}
                            {isAssignedTeam && <span className="badge badge-active" style={{ fontSize: 9, padding: '1px 4px' }}>Assigned Team</span>}
                            {isEnv && <span className="badge badge-active" style={{ fontSize: 9, padding: '1px 4px' }}>Env</span>}
                            <button
                              type="button"
                              className="ps-cf-chip-btn"
                              onClick={() => handleInsertFieldIntoJql(cf.customfield_id)}
                              title={`Append ${toCfSyntax(cf.customfield_id)} is not EMPTY to ${activeJqlTarget} query`}
                            >
                              + Insert
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ height: 1, background: 'var(--ps-border-subtle)', margin: '8px 0' }} />

                {/* 2. DYNAMIC JQL CLAUSE TEMPLATES */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ps-text-title)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Code size={15} style={{ color: 'var(--ps-primary)' }} />
                    2. Dynamic JQL Clause Templates (Interpolated with Active Custom Fields)
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--ps-text-dim)' }}>
                    Auto-interpolated with {toCfSyntax(teamScope.fixTeamField)} and {toCfSyntax(teamScope.assignedTeamField)}
                  </span>
                </div>

                {/* Live Clause Templates */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Template 1: Polling */}
                  <div className="ps-jql-template-card">
                    <div className="ps-jql-card-header">
                      <div className="ps-jql-card-title">
                        <span>1. Incident Ticket Polling Job</span>
                        <span className="ps-jql-cron-pill">Draft clause · no scheduler</span>
                      </div>
                      <span className="badge badge-neutral" style={{ fontSize: 11 }}>Draft only</span>
                    </div>
                    <div className="ps-form-group" style={{ margin: 0 }}>
                      <label className="ps-form-label" style={{ fontSize: 11 }}>
                        Clause Template String
                      </label>
                      <input
                        type="text"
                        value={jqlConfig.pollingTemplate}
                        onChange={e => setJqlConfig({ ...jqlConfig, pollingTemplate: e.target.value })}
                        className="ps-form-input mono"
                        style={{ fontSize: 11.5 }}
                      />
                    </div>
                    <div>
                      <div className="ps-jql-preview-header">
                        <span className="ps-jql-preview-label">
                          <Info size={12} style={{ color: 'var(--ps-primary)' }} /> Interpolated JQL preview; not sent by this editor
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--ps-text-dim)' }}>
                          Dynamic evaluation from Step 2 teams & members
                        </span>
                      </div>
                      <div className="ps-jql-preview-box">
                        {interpolateJql(jqlConfig.pollingTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)}
                      </div>
                    </div>
                  </div>

                  {/* Template 2: Weekly Reporting */}
                  <div className="ps-jql-template-card">
                    <div className="ps-jql-card-header">
                      <div className="ps-jql-card-title">
                        <span>2. Weekly SRE Incident Digest</span>
                        <span className="ps-jql-cron-pill">0 17 * * 5 • Fri 5:00 PM CST</span>
                      </div>
                      <span className="badge badge-active" style={{ fontSize: 11 }}>Weekly Job</span>
                    </div>
                    <div className="ps-form-group" style={{ margin: 0 }}>
                      <label className="ps-form-label" style={{ fontSize: 11 }}>
                        Clause Template String
                      </label>
                      <input
                        type="text"
                        value={jqlConfig.reportingTemplate}
                        onChange={e => setJqlConfig({ ...jqlConfig, reportingTemplate: e.target.value })}
                        className="ps-form-input mono"
                        style={{ fontSize: 11.5 }}
                      />
                    </div>
                    <div>
                      <div className="ps-jql-preview-header">
                        <span className="ps-jql-preview-label">
                          <Info size={12} style={{ color: 'var(--ps-primary)' }} /> Interpolated JQL preview; not sent by this editor
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--ps-text-dim)' }}>
                          Includes native Jira commentedBy & updated &gt;= -7d filter
                        </span>
                      </div>
                      <div className="ps-jql-preview-box">
                        {interpolateJql(jqlConfig.reportingTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)}
                      </div>
                    </div>
                  </div>

                  {/* Template 3: Amdocs Daily Report */}
                  <div className="ps-jql-template-card">
                    <div className="ps-jql-card-header">
                      <div className="ps-jql-card-title">
                        <span>3. Amdocs Daily Vendor Status Report</span>
                        <span className="ps-jql-cron-pill">0 15 * * * • Daily 3:00 PM CST</span>
                      </div>
                      {teamScope.amdocsTeamValues.length > 0 ? (
                        <span className="badge badge-active" style={{ fontSize: 11 }}>Vendor Job</span>
                      ) : (
                        <span className="badge badge-neutral" style={{ fontSize: 11, color: '#f59e0b' }}>
                          Paused (No vendor values)
                        </span>
                      )}
                    </div>
                    <div className="ps-form-group" style={{ margin: 0 }}>
                      <label className="ps-form-label" style={{ fontSize: 11 }}>
                        Clause Template String
                      </label>
                      <input
                        type="text"
                        value={jqlConfig.amdocsDailyTemplate}
                        onChange={e => setJqlConfig({ ...jqlConfig, amdocsDailyTemplate: e.target.value })}
                        className="ps-form-input mono"
                        style={{ fontSize: 11.5 }}
                      />
                    </div>
                    <div>
                      <div className="ps-jql-preview-header">
                        <span className="ps-jql-preview-label">
                          <Info size={12} style={{ color: 'var(--ps-primary)' }} /> Interpolated JQL preview; not sent by this editor
                        </span>
                        {teamScope.amdocsTeamValues.length === 0 && (
                          <span style={{ fontSize: 10.5, color: '#f59e0b' }}>
                            ⚠ amdocs_team_values empty in Step 2: job drops execution rather than querying empty IN ()
                          </span>
                        )}
                      </div>
                      <div className="ps-jql-preview-box">
                        {interpolateJql(jqlConfig.amdocsDailyTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)}
                      </div>
                    </div>
                  </div>

                  {/* Template 4: Environment-Scoped Diagnostic Query */}
                  <div className="ps-jql-template-card">
                    <div className="ps-jql-card-header">
                      <div className="ps-jql-card-title">
                        <span>4. Cross-Service Environment Diagnostic Filter</span>
                        <span className="ps-jql-cron-pill">On-Demand • RCA Run Triggered</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--ps-text-muted)' }}>Target Env:</span>
                        <select
                          value={selectedEnvForJql}
                          onChange={e => setSelectedEnvForJql(e.target.value)}
                          className="ps-form-select"
                          style={{ fontSize: 11, padding: '2px 8px', width: 'auto' }}
                        >
                          {environments.map(env => (
                            <option key={env.id} value={env.id}>
                              {env.id} ({env.displayName})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="ps-form-group" style={{ margin: 0 }}>
                      <label className="ps-form-label" style={{ fontSize: 11 }}>
                        Clause Template String
                      </label>
                      <input
                        type="text"
                        value={jqlConfig.environmentFilterTemplate}
                        onChange={e => setJqlConfig({ ...jqlConfig, environmentFilterTemplate: e.target.value })}
                        className="ps-form-input mono"
                        style={{ fontSize: 11.5 }}
                      />
                    </div>
                    <div>
                      <div className="ps-jql-preview-header">
                        <span className="ps-jql-preview-label">
                          <Info size={12} style={{ color: 'var(--ps-primary)' }} /> Interpolated JQL preview; not sent by this editor
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--ps-text-dim)' }}>
                          Queries {teamScope.environmentField || 'customfield_10291'} for {selectedEnvForJql}
                        </span>
                      </div>
                      <div className="ps-jql-preview-box">
                        {interpolateJql(jqlConfig.environmentFilterTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Automated Schedules & Execution Mapping */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">3. Automated Schedules & Execution Mapping</h2>
                    <p className="ps-card-subtitle">
                      Record intended schedule mappings for review. This release has no durable background worker, so saved drafts do not start jobs.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      if (isAddingSchedule) {
                        setIsAddingSchedule(false);
                        setEditingScheduleId(null);
                      } else {
                        handleStartAddSchedule();
                      }
                    }}
                    style={{ fontSize: 12 }}
                  >
                    <Plus size={13} /> Add Schedule
                  </button>
                </div>

                {/* Inline Add/Edit Schedule Form */}
                {isAddingSchedule && (
                  <div className="ps-inline-form-card" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <h4 className="ps-inline-form-title" style={{ margin: 0 }}>
                        {editingScheduleId ? 'Edit Schedule & Execution Mapping' : 'Add Automated Schedule & Execution Mapping'}
                      </h4>
                      <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                        {scheduleForm.executionType.toUpperCase()} RUNNER
                      </span>
                    </div>

                    <div className="ps-form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 }}>
                      <div className="ps-form-group">
                        <label className="ps-form-label">Schedule ID *</label>
                        <input
                          type="text"
                          value={scheduleForm.id}
                          onChange={e => setScheduleForm({ ...scheduleForm, id: e.target.value })}
                          placeholder="weekly-report"
                          className="ps-form-input mono"
                        />
                      </div>
                      <div className="ps-form-group">
                        <label className="ps-form-label">Job Name *</label>
                        <input
                          type="text"
                          value={scheduleForm.name}
                          onChange={e => setScheduleForm({ ...scheduleForm, name: e.target.value })}
                          placeholder="Weekly SRE Incident Digest"
                          className="ps-form-input"
                        />
                      </div>
                      <div className="ps-form-group">
                        <label className="ps-form-label">Target Capability *</label>
                        <input
                          type="text"
                          value={scheduleForm.capability}
                          onChange={e => setScheduleForm({ ...scheduleForm, capability: e.target.value })}
                          placeholder="reporting.weekly"
                          className="ps-form-input mono"
                        />
                      </div>
                    </div>

                    {/* Execution Type Selector */}
                    <div style={{ padding: '12px', background: 'var(--ps-card-bg)', border: '1px solid var(--ps-border-subtle)', borderRadius: 'var(--radius-md, 8px)', marginBottom: 14 }}>
                      <label className="ps-form-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Workflow size={13} style={{ color: 'var(--ps-primary)' }} />
                        Execution Target (What executes on this schedule?)
                      </label>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="execType"
                            checked={scheduleForm.executionType === 'jql'}
                            onChange={() => setScheduleForm({ ...scheduleForm, executionType: 'jql' })}
                          />
                          <span><strong>Dynamic JQL Query</strong> (Direct Jira Search API)</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="execType"
                            checked={scheduleForm.executionType === 'script'}
                            onChange={() => setScheduleForm({ ...scheduleForm, executionType: 'script' })}
                          />
                          <span><strong>Custom Python Script</strong> (Admin Approved Runner)</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="execType"
                            checked={scheduleForm.executionType === 'capability'}
                            onChange={() => setScheduleForm({ ...scheduleForm, executionType: 'capability' })}
                          />
                          <span><strong>Platform Capability Probe</strong> (Diagnostic / Cache)</span>
                        </label>
                      </div>

                      {/* JQL Mapping Dropdown & Preview */}
                      {scheduleForm.executionType === 'jql' && (
                        <div>
                          <div className="ps-form-group" style={{ marginBottom: 8 }}>
                            <label className="ps-form-label" style={{ fontSize: 11 }}>Mapped JQL Template Clause</label>
                            <select
                              value={scheduleForm.targetJqlId || 'polling'}
                              onChange={e => setScheduleForm({ ...scheduleForm, targetJqlId: e.target.value })}
                              className="ps-form-select"
                            >
                              <option value="polling">Template 1: Polling Incident Ingestion</option>
                              <option value="reporting">Template 2: Weekly SRE Incident Digest</option>
                              <option value="amdocs">Template 3: Amdocs Daily Vendor Status Report</option>
                              <option value="env">Template 4: Cross-Service Environment Diagnostic Filter</option>
                            </select>
                          </div>
                          <div className="ps-jql-preview-box" style={{ fontSize: 11, padding: '6px 10px' }}>
                            <span style={{ color: 'var(--ps-text-dim)', fontSize: 10, display: 'block', marginBottom: 2 }}>
                              Live Clause that will execute on schedule:
                            </span>
                            {scheduleForm.targetJqlId === 'reporting'
                              ? interpolateJql(jqlConfig.reportingTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)
                              : scheduleForm.targetJqlId === 'amdocs'
                              ? interpolateJql(jqlConfig.amdocsDailyTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)
                              : scheduleForm.targetJqlId === 'env'
                              ? interpolateJql(jqlConfig.environmentFilterTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)
                              : interpolateJql(jqlConfig.pollingTemplate, teamScope, members, selectedEnvForJql, projectId.toUpperCase(), jiraCustomFields)}
                          </div>
                        </div>
                      )}

                      {/* Script Mapping Input */}
                      {scheduleForm.executionType === 'script' && (
                        <div className="ps-form-grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'flex-end' }}>
                          <div className="ps-form-group" style={{ margin: 0 }}>
                            <label className="ps-form-label" style={{ fontSize: 11 }}>Reference Python Script Path *</label>
                            <input
                              type="text"
                              value={scheduleForm.scriptPath || ''}
                              onChange={e => setScheduleForm({ ...scheduleForm, scriptPath: e.target.value })}
                              placeholder="scripts/sre_weekly_digest.py"
                              className="ps-form-input mono"
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={scheduleForm.adminApproved ?? false}
                                onChange={e => setScheduleForm({ ...scheduleForm, adminApproved: e.target.checked })}
                              />
                              <span>Admin Approved Script</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Capability Mapping Info */}
                      {scheduleForm.executionType === 'capability' && (
                        <div style={{ fontSize: 11.5, color: 'var(--ps-text-dim)', padding: '4px 0' }}>
                          Draft mapping for native ADK capability <code>{scheduleForm.capability || 'capability.run'}</code>; execution is not started by this editor.
                        </div>
                      )}
                    </div>

                    {/* Schedule Timing & Presets */}
                    <div style={{ marginBottom: 14 }}>
                      <label className="ps-form-label" style={{ fontSize: 11, marginBottom: 6 }}>
                        Frequency Presets (Click to populate cron)
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        <button
                          type="button"
                          className={`ps-sched-preset-btn ${scheduleForm.cron === '*/15 * * * *' ? 'active' : ''}`}
                          onClick={() => setScheduleForm({ ...scheduleForm, cron: '*/15 * * * *', frequencyLabel: 'Every 15 minutes' })}
                        >
                          Every 15 minutes (*/15 * * * *)
                        </button>
                        <button
                          type="button"
                          className={`ps-sched-preset-btn ${scheduleForm.cron === '0 15 * * *' ? 'active' : ''}`}
                          onClick={() => setScheduleForm({ ...scheduleForm, cron: '0 15 * * *', frequencyLabel: 'Daily (3:00 PM)' })}
                        >
                          Daily at 3:00 PM (0 15 * * *)
                        </button>
                        <button
                          type="button"
                          className={`ps-sched-preset-btn ${scheduleForm.cron === '0 17 * * 5' ? 'active' : ''}`}
                          onClick={() => setScheduleForm({ ...scheduleForm, cron: '0 17 * * 5', frequencyLabel: 'Weekly (Fri 5:00 PM)' })}
                        >
                          Weekly Friday at 5:00 PM (0 17 * * 5)
                        </button>
                        <button
                          type="button"
                          className={`ps-sched-preset-btn ${scheduleForm.cron === '0 21 * * *' ? 'active' : ''}`}
                          onClick={() => setScheduleForm({ ...scheduleForm, cron: '0 21 * * *', frequencyLabel: 'Daily (9:00 PM)' })}
                        >
                          Nightly at 9:00 PM (0 21 * * *)
                        </button>
                        <button
                          type="button"
                          className={`ps-sched-preset-btn ${scheduleForm.cron === '0 2 * * *' ? 'active' : ''}`}
                          onClick={() => setScheduleForm({ ...scheduleForm, cron: '0 2 * * *', frequencyLabel: 'Daily (2:00 AM)' })}
                        >
                          Daily at 2:00 AM (0 2 * * *)
                        </button>
                      </div>

                      <div className="ps-form-grid" style={{ gridTemplateColumns: '1fr 1fr 2fr' }}>
                        <div className="ps-form-group" style={{ margin: 0 }}>
                          <label className="ps-form-label">Cron Expression (5-field) *</label>
                          <input
                            type="text"
                            value={scheduleForm.cron}
                            onChange={e => setScheduleForm({ ...scheduleForm, cron: e.target.value })}
                            className="ps-form-input mono"
                          />
                        </div>
                        <div className="ps-form-group" style={{ margin: 0 }}>
                          <label className="ps-form-label">Human Frequency Label</label>
                          <input
                            type="text"
                            value={scheduleForm.frequencyLabel || ''}
                            onChange={e => setScheduleForm({ ...scheduleForm, frequencyLabel: e.target.value })}
                            placeholder="Every 15 minutes"
                            className="ps-form-input"
                          />
                        </div>
                        <div className="ps-form-group" style={{ margin: 0 }}>
                          <label className="ps-form-label">Description</label>
                          <input
                            type="text"
                            value={scheduleForm.description || ''}
                            onChange={e => setScheduleForm({ ...scheduleForm, description: e.target.value })}
                            placeholder="Job summary"
                            className="ps-form-input"
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setIsAddingSchedule(false);
                          setEditingScheduleId(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={handleSaveSchedule}>
                        {editingScheduleId ? 'Update Schedule' : 'Save Schedule'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Aligned Schedules Table */}
                <div className="ps-table-container">
                  <table className="ps-table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 190 }}>Job & Schedule ID</th>
                        <th style={{ minWidth: 170 }}>Trigger & Frequency</th>
                        <th style={{ minWidth: 240 }}>Execution Target (JQL / Script)</th>
                        <th style={{ minWidth: 130 }}>Capability</th>
                        <th style={{ width: 85, minWidth: 85, textAlign: 'center' }}>Status</th>
                        <th style={{ width: 90, minWidth: 90, textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map(s => (
                        <tr key={s.id}>
                          <td>
                            <div style={{ fontWeight: 650, color: 'var(--ps-text-title)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                              {s.name}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'nowrap' }}>
                              <span className="badge badge-neutral mono" style={{ fontSize: 10, padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {s.id}
                              </span>
                              {s.description && (
                                <span style={{ fontSize: 10.5, color: 'var(--ps-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }} title={s.description}>
                                  {s.description}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontSize: 12, fontWeight: 550, whiteSpace: 'nowrap' }}>
                              {s.frequencyLabel || (s.cron === '*/15 * * * *' ? 'Every 15 minutes' : 'Scheduled')}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'nowrap' }}>
                              <span className="badge badge-neutral mono" style={{ fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {s.cron}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--ps-text-dim)', whiteSpace: 'nowrap' }}>
                                {s.timezone || 'America/Chicago'}
                              </span>
                            </div>
                          </td>
                          <td>
                            {s.executionType === 'jql' && (
                              <div>
                                <span className="ps-sched-target-pill ps-sched-target-jql" style={{ whiteSpace: 'nowrap' }}>
                                  <Terminal size={11} />
                                  {s.targetJqlId === 'reporting'
                                    ? 'JQL: Weekly SRE Digest'
                                    : s.targetJqlId === 'amdocs'
                                    ? 'JQL: Amdocs Vendor Report'
                                    : s.targetJqlId === 'env'
                                    ? 'JQL: Environment Diagnostic'
                                    : 'JQL: Polling Incident Ingestion'}
                                </span>
                                {s.scriptPath && (
                                  <span className="ps-sched-admin-badge" title="Reference Script Attached" style={{ whiteSpace: 'nowrap' }}>
                                    <Check size={9} /> {s.scriptPath.split('/').pop()}
                                  </span>
                                )}
                                <div className="ps-sched-preview-snippet">
                                  {s.targetJqlId === 'reporting'
                                    ? jqlConfig.reportingTemplate
                                    : s.targetJqlId === 'amdocs'
                                    ? jqlConfig.amdocsDailyTemplate
                                    : s.targetJqlId === 'env'
                                    ? jqlConfig.environmentFilterTemplate
                                    : jqlConfig.pollingTemplate}
                                </div>
                              </div>
                            )}
                            {s.executionType === 'script' && (
                              <div>
                                <span className="ps-sched-target-pill ps-sched-target-script" style={{ whiteSpace: 'nowrap' }}>
                                  <Code size={11} />
                                  Script: {s.scriptPath || 'scripts/custom_job.py'}
                                </span>
                                {s.adminApproved && (
                                  <span className="ps-sched-admin-badge" style={{ whiteSpace: 'nowrap' }}>
                                    <Check size={9} /> Approved
                                  </span>
                                )}
                                <div className="ps-sched-preview-snippet" style={{ color: '#10b981' }}>
                                  Python Runner: python -m {s.scriptPath || 'scripts/custom_job.py'}
                                </div>
                              </div>
                            )}
                            {s.executionType === 'capability' && (
                              <div>
                                <span className="ps-sched-target-pill ps-sched-target-cap" style={{ whiteSpace: 'nowrap' }}>
                                  <Workflow size={11} />
                                  Probe: {s.capability}
                                </span>
                                <div className="ps-sched-preview-snippet">
                                  Native Google ADK diagnostic health probe
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="badge badge-neutral mono" style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {s.capability}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleToggleSchedule(s.id)}
                              className={`badge ${s.enabled ? 'badge-active' : 'badge-failed'}`}
                              style={{ cursor: 'pointer', border: 'none', whiteSpace: 'nowrap' }}
                              title="Click to toggle active state"
                            >
                              {s.enabled ? 'Active' : 'Disabled'}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleEditSchedule(s)}
                                style={{ padding: '2px 7px', fontSize: 11, whiteSpace: 'nowrap' }}
                                title="Edit schedule & execution mapping"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleDeleteSchedule(s.id)}
                                style={{ padding: '2px 7px', fontSize: 11, color: '#ef4444' }}
                                title="Remove schedule"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: CONNECTORS & TOOLS (EXPANDED WITH 3 TABS) */}
          {currentStep === 5 && (
            <div className="ps-card">
              <div className="ps-card-header">
                <div>
                  <h2 className="ps-card-title">Connectors & Tools</h2>
                  <p className="ps-card-subtitle">
                    Manage connector integration instances, tool capabilities, and interactive environment bindings.
                  </p>
                </div>
              </div>

              {/* Subtabs: Connectors | Tools | Environment Mapping */}
              <div className="ps-subtabs">
                <button
                  type="button"
                  className={`ps-subtab-btn ${step5Tab === 'connectors' ? 'active' : ''}`}
                  onClick={() => setStep5Tab('connectors')}
                >
                  <Database size={13} /> Connectors <span className="ps-subtab-count">{persistedConnectors.length}</span>
                </button>
                <button
                  type="button"
                  className={`ps-subtab-btn ${step5Tab === 'tools' ? 'active' : ''}`}
                  onClick={() => setStep5Tab('tools')}
                >
                  <Wrench size={13} /> Tools <span className="ps-subtab-count">{tools.length}</span>
                </button>
                <button
                  type="button"
                  className={`ps-subtab-btn ${step5Tab === 'mapping' ? 'active' : ''}`}
                  onClick={() => setStep5Tab('mapping')}
                >
                  <Link2 size={13} /> Environment Mapping <span className="ps-subtab-count">{environmentBindings.length}</span>
                </button>
              </div>

              {/* TAB 1: CONNECTORS */}
              {step5Tab === 'connectors' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {editingConnector ? (
                    <div className="ps-connector-focus-canvas">
                      <div className="ps-connector-breadcrumb-bar">
                        <button
                          type="button"
                          className="ps-breadcrumb-back-btn"
                          onClick={() => setEditingConnector(null)}
                        >
                          <ChevronLeft size={14} /> Back to Connectors &amp; Tools
                        </button>
                        <div className="ps-connector-editing-badge">
                          <span>Configuring:</span>
                          <code>{editingConnector.instance?.system_name || editingConnector.template?.name}</code>
                        </div>
                      </div>
                      <ConnectorInstanceEditor
                        projectId={projectId}
                        template={editingConnector.template}
                        instance={editingConnector.instance}
                        availableEnvironments={environments.map(e => ({ id: e.id, name: e.displayName || e.id }))}
                        principal={principal || undefined}
                        onCancel={() => setEditingConnector(null)}
                        onSave={saved => {
                          setEditingConnector(current => current ? { ...current, instance: saved } : current);
                          void loadProjectConnectors(projectId);
                          setStatusNotice({ type: 'success', text: `Connector instance '${saved.instance_id}' persisted.` });
                        }}
                      />
                    </div>
                  ) : isAddingConnector ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--ps-card-subtle)', padding: 20, borderRadius: 10, border: '1px solid var(--ps-border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ps-text-title)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Database size={16} style={{ color: 'var(--ps-primary)' }} />
                            <span>Platform Connector Marketplace</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ps-text-muted)', marginTop: 2 }}>
                            Select a published platform connector template to configure a scoped project integration.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 11.5, padding: '4px 10px' }}
                          onClick={() => { setIsAddingConnector(false); setTemplateSearch(''); }}
                        >
                          <X size={12} /> Close Marketplace
                        </button>
                      </div>

                      {/* Search and Category Filter Bar */}
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: '1 1 240px' }}>
                          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ps-text-dim)' }} />
                          <input
                            type="text"
                            placeholder="Filter connector templates…"
                            value={templateSearch}
                            onChange={e => setTemplateSearch(e.target.value)}
                            className="ps-form-input"
                            style={{ paddingLeft: 30, height: 34, fontSize: 12 }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {['all', 'itsm', 'telemetry', 'infra', 'mcp_a2a'].map(cat => (
                            <button
                              key={cat}
                              type="button"
                              className={`ps-sched-preset-btn ${templateCategoryFilter === cat ? 'active' : ''}`}
                              style={{ fontSize: 11, padding: '4px 10px' }}
                              onClick={() => setTemplateCategoryFilter(cat)}
                            >
                              {cat === 'all' ? 'All Integrations' : cat === 'itsm' ? 'ITSM' : cat === 'telemetry' ? 'Telemetry' : cat === 'infra' ? 'Infra / SCM' : 'MCP & A2A'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                        {connectorTemplates
                          .filter(tmpl => {
                            if (templateSearch) {
                              const q = templateSearch.toLowerCase();
                              if (!tmpl.name.toLowerCase().includes(q) && !tmpl.system_name.toLowerCase().includes(q) && !(tmpl.description || '').toLowerCase().includes(q)) {
                                return false;
                              }
                            }
                            if (templateCategoryFilter === 'itsm') {
                              return ['itsm', 'jira', 'confluence', 'qtest'].includes(tmpl.system_name);
                            }
                            if (templateCategoryFilter === 'telemetry') {
                              return ['log_search', 'splunk', 'signalfx'].includes(tmpl.system_name);
                            }
                            if (templateCategoryFilter === 'infra') {
                              return ['gitlab', 'oracle', 'kafka', 'unix', 'kubernetes'].includes(tmpl.system_name);
                            }
                            if (templateCategoryFilter === 'mcp_a2a') {
                              return ['mcp', 'a2a'].includes(tmpl.system_name);
                            }
                            return true;
                          })
                          .map(tmpl => {
                            const isBlocked = tmpl.availability === 'disabled_by_policy' || tmpl.system_name === 'oracle';
                            return (
                              <div
                                key={tmpl.template_id || tmpl.system_name}
                                className="ps-card"
                                style={{
                                  padding: 16,
                                  background: isBlocked ? '#fef2f2' : 'var(--ps-card-bg)',
                                  borderColor: isBlocked ? '#fca5a5' : 'var(--ps-border-subtle)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ fontWeight: 700, fontSize: 13.5, color: isBlocked ? '#991b1b' : 'var(--ps-text-title)' }}>
                                      {tmpl.name}
                                    </span>
                                    <span className={`badge ${isBlocked ? 'badge-failed' : tmpl.availability === 'published' ? 'badge-active' : 'badge-planned'}`} style={{ fontSize: 10 }}>
                                      {isBlocked ? 'BLOCKED' : tmpl.availability?.toUpperCase() || 'PUBLISHED'}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ps-text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>Key: <code>{tmpl.system_name}</code></span>
                                    <span>·</span>
                                    <span>v{tmpl.version || '1.0.0'}</span>
                                  </div>
                                  <p style={{ fontSize: 11.5, color: isBlocked ? '#7f1d1d' : 'var(--ps-text-muted)', margin: '8px 0 0', lineHeight: 1.45 }}>
                                    {isBlocked
                                      ? 'Database querying is disabled by platform governance policy.'
                                      : (tmpl.description || 'Platform connector integration.')}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  className={`btn ${isBlocked ? 'btn-secondary' : 'btn-primary'}`}
                                  style={{ fontSize: 11.5, padding: '6px 12px', width: '100%', justifyContent: 'center' }}
                                  disabled={isBlocked}
                                  onClick={() => {
                                    setEditingConnector({ template: tmpl });
                                    setIsAddingConnector(false);
                                  }}
                                >
                                  {isBlocked ? 'Disabled by Policy' : 'Configure New Instance'}
                                </button>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Project connectors provide typed credentials and bounded read-only queries for RCA investigations.
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => setIsAddingConnector(true)}
                          style={{ fontSize: 11.5, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Plus size={13} /> Add Connector Instance
                        </button>
                      </div>

                      {/* Display Persisted DB Connector Instances if available, or fallback */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14 }}>
                        {persistedConnectors.length > 0 ? (
                          persistedConnectors.map(conn => {
                            const matchingTmpl = connectorTemplates.find(
                              t => t.system_name === conn.system_name || t.template_id === conn.template_id
                            );
                            const isBlocked = conn.system_name === 'oracle' || matchingTmpl?.availability === 'disabled_by_policy';
                            return (
                              <div
                                key={conn.instance_id}
                                style={{
                                  padding: 16,
                                  border: '1px solid var(--line)',
                                  borderRadius: 8,
                                  background: isBlocked ? '#fef2f2' : 'var(--card-subtle)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 10,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: isBlocked ? '#991b1b' : 'var(--tx)' }}>
                                      {conn.system_name}
                                    </div>
                                    <div style={{ fontSize: 11.5, color: isBlocked ? '#7f1d1d' : 'var(--muted)', marginTop: 2 }}>
                                      Template: {matchingTmpl?.name || conn.template_id}
                                    </div>
                                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                                      ID: {conn.instance_id} · v{conn.template_version} · rev-{conn.revision}
                                    </div>
                                  </div>
                                  <span className={`badge ${conn.enabled ? 'badge-active' : 'badge-planned'}`}>
                                    {conn.enabled ? 'ENABLED' : 'DISABLED'}
                                  </span>
                                </div>

                                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div>Endpoint: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx)' }}>{conn.definition_json?.endpoint || 'Not configured'}</span></div>
                                  <div>Auth: <strong>{conn.definition_json?.auth_type || 'Not configured'}</strong></div>
                                  <div>Status: <strong>{conn.status}</strong></div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setEditingConnector({ instance: conn, template: matchingTmpl })}
                                    style={{ fontSize: 11, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                                  >
                                    <Edit3 size={11} /> Configure
                                  </button>

                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => void handleDeleteConnector(conn.instance_id)}
                                    style={{ fontSize: 11, padding: '3px 8px', color: '#dc2626' }}
                                    title="Delete connector instance"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="gate-callout warning" style={{ gridColumn: '1 / -1', marginTop: 0 }}>
                            <Info size={16} />
                            <div>No connector instances are persisted for this authenticated project. Choose <strong>Add Connector Instance</strong> to start from a published template.</div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                </div>
              )}

              {/* TAB 2: TOOLS */}
              {step5Tab === 'tools' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Tools represent discrete capabilities exposed by connectors. Project agents select tools dynamically based on incident context.
                  </div>

                  <div className="ps-table-container">
                    <table className="ps-table">
                      <thead>
                        <tr>
                          <th>Tool Capability</th>
                          <th>Connector Instance</th>
                          <th>Scope</th>
                          <th>Description</th>
                          <th>Enabled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tools.map(tool => (
                          <tr key={tool.id}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--acc)' }}>
                              {tool.id}
                            </td>
                            <td>
                              <span className="badge badge-neutral" style={{ fontFamily: 'var(--font-mono)' }}>
                                {tool.connectorId}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${tool.scope === 'project' ? 'badge-active' : 'badge-neutral'}`}>
                                {tool.scope}
                              </span>
                            </td>
                            <td style={{ color: 'var(--muted)', fontSize: 11 }}>{tool.description}</td>
                            <td>
                              <label className="ps-switch">
                                <input
                                  type="checkbox"
                                  checked={tool.enabled}
                                  onChange={e => {
                                    const val = e.target.checked;
                                    setTools(prev => prev.map(t => (t.id === tool.id ? { ...t, enabled: val } : t)));
                                  }}
                                />
                                <span className="ps-slider" />
                              </label>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: ENVIRONMENT MAPPING */}
              {step5Tab === 'mapping' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Interactive Environment Mapping: Maps each project environment to specific external tool environments and connector instances.
                  </div>

                  <div className="ps-env-mapping-tree">
                    {environmentBindings.map(eb => (
                      <div key={eb.projectEnvironment} className="ps-mapping-card">
                        <div className="ps-mapping-header">
                          <span className="ps-mapping-proj-badge">
                            <Boxes size={14} /> Project Environment: {eb.projectEnvironment}
                          </span>
                          <span className="badge badge-active">Mapped</span>
                        </div>

                        <div className="ps-mapping-bindings-grid">
                          {Object.entries(eb.bindings).map(([service, val]) => (
                            <div key={service} className="ps-binding-item">
                              <div className="ps-binding-service">
                                <span style={{ textTransform: 'capitalize' }}>{service}</span>
                                <span className="badge badge-neutral" style={{ fontSize: 10 }}>{val.connectorId}</span>
                              </div>
                              <div className="ps-binding-tool-env">
                                Tool Env: <strong style={{ color: 'var(--tx)' }}>{val.toolEnvironment}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 6: REVIEW & SAVE */}
          {currentStep === 6 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* 3-Tier Validation Scorecard */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Review configuration</h2>
                    <p className="ps-card-subtitle">
                      Check the saved configuration for structure, policy, and operational readiness before saving.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleValidate()}
                    disabled={validating}
                  >
                    <ShieldCheck size={13} /> {validating ? 'Validating…' : 'Run Validation'}
                  </button>
                </div>

                <div className="ps-scorecard-grid">
                  <div className="ps-scorecard-card">
                    <span className="ps-scorecard-label">Structure checks</span>
                    <span className={`ps-scorecard-status ${validationScores.schemaPass ? 'pass' : 'warn'}`}>
                      {validationScores.schemaPass ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {validationScores.schemaPass ? 'PASS' : 'PARTIAL'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Project metadata and at least one active environment</span>
                  </div>

                  <div className="ps-scorecard-card">
                    <span className="ps-scorecard-label">Policy checks</span>
                    <span className={`ps-scorecard-status ${validationScores.governancePass ? 'pass' : 'warn'}`}>
                      {validationScores.governancePass ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {validationScores.governancePass ? 'PASS' : 'PARTIAL'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Platform policies & secret refs</span>
                  </div>

                  <div className="ps-scorecard-card">
                    <span className="ps-scorecard-label">Operational checks</span>
                    <span className={`ps-scorecard-status ${validationScores.operationalPass ? 'pass' : 'warn'}`}>
                      <CheckCircle2 size={16} /> {validationScores.operationalPass ? 'PASS' : 'PARTIAL'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {validationScores.mappedEnvCount} mapped · {validationScores.enabledConnectorCount} enabled; health tests are separate
                    </span>
                  </div>

                  <div className="ps-scorecard-card">
                    <span className="ps-scorecard-label">Overall readiness</span>
                    <span className={`ps-scorecard-status ${validationScores.score === 100 ? 'pass' : 'warn'}`} style={{ color: 'var(--acc)' }}>
                      {validationScores.score}% CONFIGURATION SCORE
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Run backend validation before saving; this check does not test live connectors.</span>
                  </div>
                </div>
              </div>

              {/* Complete Full YAML Preview Card */}
              <div className="ps-card">
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Generated PRISM Project Configuration YAML</h2>
                    <p className="ps-card-subtitle">
                      Generated from the current saved project values and ready to validate before saving.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCopyYaml}
                      style={{ fontSize: 12 }}
                    >
                      {copied ? <Check size={13} style={{ color: 'var(--acc)' }} /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy YAML'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleDownloadYaml}
                      style={{ fontSize: 12 }}
                    >
                      <Download size={13} /> Download YAML
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleSave()}
                      disabled={saving || !principal?.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER'].includes(role))}
                      style={{ fontSize: 12 }}
                    >
                      <Save size={13} /> {saving ? 'Saving…' : 'Save configuration'}
                    </button>
                  </div>
                </div>

                <YamlCodeViewer code={fullYamlText} maxHeight={520} />
              </div>
            </div>
          )}
        </main>

        {/* Inline configuration preview panel */}
        {showSidebar && (
          <aside className="ps-sidebar-col">
            <div className="ps-sidebar-header-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: 'var(--ps-text-title)' }}>
                <Code size={14} style={{ color: 'var(--ps-primary)' }} />
                <span>Configuration preview &amp; status</span>
              </div>
              <button
                type="button"
                className="ps-panel-close-btn"
                onClick={() => setShowSidebar(false)}
                title="Close configuration preview"
                aria-label="Close configuration preview"
              >
                <X size={14} />
              </button>
            </div>
          {/* Live Contextual YAML Preview Card (Primary on Step 1, Step 6, or toggled on Steps 2-5) */}
          {(currentStep === 1 || currentStep === 6 || showQuickYaml) && (
            <div className="ps-preview-card">
              <div className="ps-preview-header">
                <span className="ps-preview-title">
                  <FileCode size={14} style={{ color: 'var(--ps-code-key)' }} />
                  Configuration Preview
                </span>
                <span className="ps-preview-badge">YAML</span>
              </div>
              <YamlCodeViewer code={displayYaml} maxHeight={currentStep === 1 ? 260 : 220} />
              <div className="ps-preview-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setViewFullYaml(!viewFullYaml)}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  {viewFullYaml ? 'Contextual Slice' : 'View Full YAML'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCopyYaml}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleDownloadYaml}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  title="Download configuration YAML"
                >
                  <Download size={11} /> Download
                </button>
              </div>
            </div>
          )}

          {/* Quick YAML Toggle for Steps 2 to 5 */}
          {currentStep >= 2 && currentStep <= 5 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowQuickYaml(prev => !prev)}
              style={{ fontSize: 11.5, width: '100%', justifyContent: 'center' }}
            >
              <FileCode size={12} /> {showQuickYaml ? 'Hide YAML Preview' : 'Show YAML Preview'}
            </button>
          )}

          {/* Contextual Guidelines Card */}
          {currentStep === 1 && (
            <div className="ps-guidelines-card">
              <div className="ps-guidelines-title">
                <Info size={14} style={{ color: 'var(--ps-primary)' }} /> Basic Info Guidelines
              </div>
              <ul className="ps-guidelines-list">
                <li>Project ID must be unique across all deployments.</li>
                <li>Display name is shown in headers and RCA report banners.</li>
                <li>IANA timezones ensure daylight saving time precision.</li>
                <li>Tags enrich automated routing and categorization.</li>
              </ul>
            </div>
          )}

          {currentStep === 2 && (
            <div className="ps-guidelines-card">
              <div className="ps-guidelines-title">
                <Info size={14} style={{ color: 'var(--ps-primary)' }} /> Environment Selection Guidelines
              </div>
              <ul className="ps-guidelines-list">
                <li>Select all environments where the project will be active.</li>
                <li>Environment-specific settings can override project defaults.</li>
                <li>You can modify environment selection later from project settings.</li>
                <li>Assign team members across Managers, Owners, and Analysts for clear governance.</li>
              </ul>
            </div>
          )}

          {currentStep === 3 && (
            <div className="ps-guidelines-card">
              <div className="ps-guidelines-title">
                <Info size={14} style={{ color: 'var(--ps-primary)' }} /> Configuration Guidelines
              </div>
              <ul className="ps-guidelines-list">
                <li>The precedence order determines which configuration takes priority when multiple settings exist.</li>
                <li>Platform policies define immutable security guardrails.</li>
                <li>Project settings can override platform defaults for delegated sections.</li>
                <li>Environment-specific settings allow for different configurations per environment.</li>
                <li>Runtime overrides should be strictly controlled through policies.</li>
              </ul>
            </div>
          )}

          {currentStep === 4 && (
            <div className="ps-guidelines-card">
              <div className="ps-guidelines-title">
                <Info size={14} style={{ color: 'var(--ps-primary)' }} /> Temporal Policy Guidelines
              </div>
              <ul className="ps-guidelines-list">
                <li>Anchors resolve the origin timestamp for root cause search windows.</li>
                <li>Explicit incident timestamps carry 1.0 confidence.</li>
                <li>Jira creation time serves as the guaranteed fallback.</li>
                <li>Automated background schedules execute using standard 5-field cron syntax.</li>
              </ul>
            </div>
          )}

          {currentStep === 5 && (
            <div className="ps-guidelines-card">
              <div className="ps-guidelines-title">
                <Info size={14} style={{ color: 'var(--ps-primary)' }} /> Connections and tools
              </div>
              <ul className="ps-guidelines-list">
                <li><b>Connector ≠ Tool ≠ Tool Env ≠ Project Env</b>.</li>
                <li>Secret references (<code>secret://...</code>) must be used instead of plaintext credentials.</li>
                <li>Tools expose capabilities to autonomous agent investigators.</li>
                <li>Environment mappings bind project envs to tool instances.</li>
              </ul>
            </div>
          )}

          {/* Configuration Progress Card */}
          <div className="ps-completeness-card">
            <div className="ps-completeness-header">
              <span>Configuration progress</span>
              <span style={{ fontWeight: 700 }}>Step {currentStep} of 6</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ps-text-dim)' }}>
              Use the stepper to move between sections. Save when the review is complete.
            </div>
          </div>

          {/* Next Step Action Card */}
          {currentStep < 6 && (
            <div className="ps-next-step-card">
              <div className="ps-next-step-header">
                <div className="ps-next-step-icon">
                  {React.createElement(STEPS[currentStep].icon, { size: 16 })}
                </div>
                <div>
                  <div className="ps-next-step-title">{STEPS[currentStep].title}</div>
                  <div className="ps-next-step-desc">{STEPS[currentStep].desc}</div>
                </div>
              </div>
              <button
                type="button"
                className="ps-next-step-btn"
                onClick={() => setCurrentStep(prev => Math.min(6, prev + 1))}
              >
                Next: {STEPS[currentStep].title} <ChevronRight size={14} />
              </button>
            </div>
          )}
        </aside>
      )}
      </div>

      {/* Bottom About Banner */}
      <footer className="ps-bottom-banner">
        <div className="ps-bottom-banner-left">
          <Info size={18} className="ps-bottom-banner-icon" />
          <div className="ps-bottom-banner-text">
            <strong>About Project Configuration:</strong> Project settings define how PRISM operates for this initiative,
            including environments, connectors, time policies, and routing rules. You can modify these settings later.
          </div>
        </div>
      </footer>
    </div>
  );
};
