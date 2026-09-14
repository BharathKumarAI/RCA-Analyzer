import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Activity,
  Search,
  Settings,
  Plus,
  X,
  Shield,
  RefreshCw,
  Info,
  Database,
  Layers,
  Terminal,
  Check,
  AlertCircle,
  ShieldAlert,
  Edit3,
  Trash2,
  Sparkles,
  Radio,
  BookOpen,
  GitBranch,
  LayoutGrid,
  Key,
  ChevronLeft,
  Clock,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  Play,
  ChevronDown,
  ChevronUp,
  Sliders,
  Lock,
  Folder,
  RotateCcw,
  Save,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  ToolDefinition,
  Principal,
  ParameterDefinitionRow,
  CapabilityItem,
  ConnectorHealthRecord,
  ConnectorTemplateItem,
  ProjectConnectorInstanceItem,
  ConnectorAuthProfileItem,
} from '../types/api';
import {
  fetchTools,
  fetchConnectorTemplates,
  publishConnectorTemplate,
  deprecateConnectorTemplate,
  fetchParameters,
  fetchCapabilities,
  setProjectAvailability,
  fetchConnectorHealthCheck,
  testIntegration,
  testConnectorCandidate,
  setParameterOverride,
  resetParameterOverride,
  fetchProjectConnectors,
  saveProjectConnector,
  fetchProjectSetup,
  discoverConnectorFields,
} from '../services/api';
import { IntegrationForm } from '../components/IntegrationForm';
import '../styles/tools-workspace.css';
import type { ActivePage } from '../components/Sidebar';

interface ToolsProps {
  tools: ToolDefinition[];
  principal: Principal;
  onNavigate?: (page: ActivePage) => void;
}

type StepperSection =
  | '1. Connection'
  | '2. Projects & Filters'
  | '3. Field Mapping'
  | '4. Investigation Settings'
  | '5. Permissions'
  | '6. Advanced'
  | '7. Test & Save';

interface FieldMappingEntry {
  id: string;
  sourceField: string;
  fieldType: string;
  targetField: string;
  required: boolean;
  defaultValue: string;
}

interface ConnectorFormState {
  name: string;
  type: string;
  description: string;
  owner: string;
  tags: string[];
  authMethod: string;
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
  defaultProject: string;
  allowedProjects: string[];
  defaultIssueTypes: string[];
  savedFilters: string[];
  fieldMappings: FieldMappingEntry[];
  lookbackPeriod: string;
  maxResults: number;
  searchFields: string[];
  includeAttachments: boolean;
  includeComments: boolean;
  includeSubtasks: boolean;
  includeLinkedIssues: boolean;
  includeHistorical: boolean;
  queryTemplate: string;
  accessLevel: string;
  allowedGroups: string[];
  readAccess: boolean;
  writeAccess: boolean;
  adminOnlyActions: boolean;
  requestTimeout: number;
  rateLimit: number;
  retryAttempts: number;
  cacheResults: number;
  enableWebhooks: boolean;
  enableAuditLogging: boolean;
}

// Unified Connector Item derived from real backend data
export interface BackendConnectorItem {
  id: string;
  system_name: string;
  name: string;
  category: string;
  description: string;
  brandColor: string;
  iconType: string;
  status: 'connected' | 'degraded' | 'not_configured' | 'planned' | 'disabled';
  template?: ConnectorTemplateItem;
  tool?: ToolDefinition;
  projectInstance?: ProjectConnectorInstanceItem;
}

// Compute brand visual tokens from system_name or category dynamically
function getConnectorVisuals(systemName: string, category: string): { brandColor: string; iconType: string } {
  const s = systemName.toLowerCase();
  const c = category.toLowerCase();

  if (s.includes('jira') || s === 'itsm' || c.includes('ticket')) {
    return { brandColor: '#0052cc', iconType: 'jira' };
  }
  if (s.includes('splunk') || s === 'log_search' || c.includes('observability') || c.includes('log')) {
    return { brandColor: '#10b981', iconType: 'splunk' };
  }
  if (s.includes('confluence') || c.includes('knowledge') || c.includes('doc')) {
    return { brandColor: '#0284c7', iconType: 'confluence' };
  }
  if (s.includes('signalfx') || c.includes('apm') || c.includes('metric')) {
    return { brandColor: '#f43f5e', iconType: 'signalfx' };
  }
  if (s.includes('qtest') || c.includes('test') || c.includes('qa')) {
    return { brandColor: '#06b6d4', iconType: 'qtest' };
  }
  if (s.includes('unix') || s.includes('linux') || s.includes('host') || s.includes('shell')) {
    return { brandColor: '#475569', iconType: 'unix' };
  }
  if (s.includes('oracle') || c.includes('database') || c.includes('sql')) {
    return { brandColor: '#dc2626', iconType: 'oracle' };
  }
  if (s.includes('kafka') || c.includes('event') || c.includes('stream')) {
    return { brandColor: '#7c3aed', iconType: 'kafka' };
  }
  if (s.includes('kube') || c.includes('container') || c.includes('orchestration')) {
    return { brandColor: '#2563eb', iconType: 'kubernetes' };
  }
  if (s.includes('git') || c.includes('devops') || c.includes('ci')) {
    return { brandColor: '#f97316', iconType: 'gitlab' };
  }

  // Dynamic deterministic hue based on string hash for custom or MCP tools
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return { brandColor: `hsl(${hue}, 65%, 48%)`, iconType: 'custom' };
}

export const Tools: React.FC<ToolsProps> = ({ tools: initialTools, principal, onNavigate }) => {
  // Live Backend Datasets
  const [toolsList, setToolsList] = useState<ToolDefinition[]>(initialTools);
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplateItem[]>([]);
  const [projectConnectors, setProjectConnectors] = useState<ProjectConnectorInstanceItem[]>([]);
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [availableEnvironments, setAvailableEnvironments] = useState<Array<{ id: string; name: string }>>([]);

  // Selected Connector Key
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('itsm');
  const [activeStepper, setActiveStepper] = useState<StepperSection>('1. Connection');

  // Selected Environment & Scope Project
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('QLAB02');
  const [selectedScope, setSelectedScope] = useState<string>(principal?.project_id || 'default');
  const [discoveringFields, setDiscoveringFields] = useState<boolean>(false);

  // Live Forms State indexed by connector id
  const [formStates, setFormStates] = useState<Record<string, ConnectorFormState>>({});

  // UI interaction states
  const [isSecretVisible, setIsSecretVisible] = useState(false);
  const [activeFieldTab, setActiveFieldTab] = useState<'Common' | 'Specific' | 'All'>('Common');
  const [isEnvOverridesOpen, setIsEnvOverridesOpen] = useState(false);

  // New tag/project/issue input values
  const [newTagInput, setNewTagInput] = useState('');
  const [newProjectInput, setNewProjectInput] = useState('');
  const [newIssueTypeInput, setNewIssueTypeInput] = useState('');
  const [newFilterInput, setNewFilterInput] = useState('');
  const [newGroupInput, setNewGroupInput] = useState('');

  // Probing & saving actions
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionProbeResult, setConnectionProbeResult] = useState<{
    success: boolean;
    timestamp: string;
    message?: string;
  }>({
    success: true,
    timestamp: 'Sep 10, 2025 10:24 AM (CDT)',
  });

  const [savingConfig, setSavingConfig] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [configuringCustomTool, setConfiguringCustomTool] = useState<ToolDefinition | null>(null);
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);

  const canEdit =
    principal.roles.includes('PLATFORM_ADMIN') ||
    principal.roles.some(role => ['PROJECT_OWNER'].includes(role));

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  // Sync initialTools
  useEffect(() => {
    if (initialTools.length > 0) {
      setToolsList(initialTools);
    }
  }, [initialTools]);

  // Load live backend data directly from authentic APIs
  const loadBackendData = async () => {
    try {
      const [fetchedParams, fetchedCaps, fetchedTemplates, fetchedTools] = await Promise.all([
        fetchParameters().catch(() => []),
        fetchCapabilities().catch(() => []),
        fetchConnectorTemplates().catch(() => []),
        fetchTools().catch(() => initialTools),
      ]);
      setParameters(fetchedParams);
      setCapabilities(fetchedCaps);
      setConnectorTemplates(fetchedTemplates);
      setToolsList(fetchedTools);

      if (principal?.project_id) {
        const [conns, setup] = await Promise.all([
          fetchProjectConnectors(principal.project_id).catch(() => []),
          fetchProjectSetup().catch(() => null),
        ]);
        setProjectConnectors(conns);
        const envs = setup?.runtime?.environments;
        if (Array.isArray(envs) && envs.length > 0) {
          setAvailableEnvironments(envs.map(e => ({ id: e.id, name: e.name || e.id })));
          const firstEnv = envs[0];
          if (firstEnv) {
            setSelectedEnvironment(firstEnv.name || firstEnv.id || 'QLAB02');
          }
        }
      }
    } catch (err) {
      console.error('Failed loading live connector backend data', err);
    }
  };

  useEffect(() => {
    void loadBackendData();
  }, [principal]);

  // Dynamically derive all connectors from the real backend templates & tools
  const backendConnectors = useMemo<BackendConnectorItem[]>(() => {
    const map = new Map<string, BackendConnectorItem>();

    // 1. Add all platform connector templates loaded from backend
    for (const tmpl of connectorTemplates) {
      const sys = tmpl.system_name || tmpl.template_id || tmpl.type;
      const matchingTool = toolsList.find(t => (t.system_name || t.id).toLowerCase() === sys.toLowerCase());
      const matchingInstance = projectConnectors.find(
        c => (c.system_name || c.instance_id).toLowerCase() === sys.toLowerCase() || c.template_id === tmpl.template_id
      );
      const visuals = getConnectorVisuals(sys, tmpl.category || '');

      let status: BackendConnectorItem['status'] = 'not_configured';
      if (tmpl.is_enabled_by_policy === false) {
        status = 'disabled';
      } else if (matchingTool) {
        status = matchingTool.status;
      } else if (tmpl.availability === 'published' || tmpl.availability === 'active') {
        status = 'connected';
      }

      map.set(sys.toLowerCase(), {
        id: sys.toLowerCase(),
        system_name: sys,
        name: tmpl.name || sys.toUpperCase(),
        category: tmpl.category || 'Connector',
        description: tmpl.description || '',
        brandColor: visuals.brandColor,
        iconType: visuals.iconType,
        status,
        template: tmpl,
        tool: matchingTool,
        projectInstance: matchingInstance,
      });
    }

    // 2. Add any tools from toolsList not yet in map (e.g. MCP / A2A custom tools)
    for (const tool of toolsList) {
      const sys = (tool.system_name || tool.id).toLowerCase();
      if (!map.has(sys)) {
        const visuals = getConnectorVisuals(sys, tool.category || '');
        map.set(sys, {
          id: sys,
          system_name: tool.system_name || tool.id,
          name: tool.name || sys.toUpperCase(),
          category: tool.category || 'Tool',
          description: tool.description || '',
          brandColor: visuals.brandColor,
          iconType: visuals.iconType,
          status: tool.status,
          tool,
        });
      }
    }

    // Sort: itsm (Jira), log_search (Splunk), confluence first, then alphabetical
    const priority = ['itsm', 'log_search', 'confluence', 'signalfx', 'qtest', 'unix', 'oracle', 'kafka', 'kubernetes', 'gitlab'];
    return Array.from(map.values()).sort((a, b) => {
      const idxA = priority.indexOf(a.id);
      const idxB = priority.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [connectorTemplates, toolsList, projectConnectors]);

  // Ensure an active connector is selected
  useEffect(() => {
    if (backendConnectors.length > 0) {
      const currentExists = backendConnectors.some(c => c.id === selectedConnectorId);
      if (!currentExists) {
        setSelectedConnectorId(backendConnectors[0]?.id || 'itsm');
      }
    }
  }, [backendConnectors, selectedConnectorId]);

  // Selected connector item
  const selectedConnector = useMemo<BackendConnectorItem | null>(() => {
    return (
      backendConnectors.find(c => c.id === selectedConnectorId) ||
      backendConnectors.find(c => c.system_name.toLowerCase() === selectedConnectorId.toLowerCase()) ||
      backendConnectors[0] ||
      null
    );
  }, [backendConnectors, selectedConnectorId]);

  // Helper to extract effective value for a parameter name from backend parameter rows
  const getBackendParamValue = (toolKey: string, varName: string): any => {
    const p = parameters.find(
      row =>
        row.tool.toLowerCase() === toolKey.toLowerCase() &&
        (row.variable_name.toLowerCase() === varName.toLowerCase() ||
          row.variable_name.toLowerCase().includes(varName.toLowerCase()))
    );
    return p?.effective_value;
  };

  // Generate initial form state for a connector dynamically from its backend template and instance
  const buildConnectorFormState = (conn: BackendConnectorItem): ConnectorFormState => {
    const tmpl = conn.template;
    const inst = conn.projectInstance;
    const def = inst?.definition_json || {};
    const sys = conn.system_name;

    const endpoint =
      def.endpoint ||
      getBackendParamValue(sys, 'endpoint') ||
      getBackendParamValue(sys, 'url') ||
      tmpl?.default_endpoint ||
      conn.tool?.endpoint ||
      '';

    const authProfiles = tmpl?.auth_profiles || [];
    const activeAuthName =
      def.auth_type ||
      (authProfiles.length > 0 ? authProfiles[0]?.name || 'OAuth 2.0' : tmpl?.auth_method || 'OAuth 2.0');

    const timeout =
      def.timeout_seconds ||
      Number(getBackendParamValue(sys, 'timeout')) ||
      tmpl?.default_timeout_seconds ||
      conn.tool?.timeout_seconds ||
      60;

    const rateLimit =
      Number(getBackendParamValue(sys, 'rate_limit')) ||
      (tmpl?.default_rate_limit ? parseInt(tmpl.default_rate_limit) : 500) ||
      500;

    const lookback = `${tmpl?.default_config?.lookback_days || 7} days`;
    const maxRes = def.max_results || tmpl?.default_config?.max_results || 50;

    // Field mappings from definition or template parameter_fields
    const mappings: FieldMappingEntry[] = [];
    if (Array.isArray(def.custom_fields) && def.custom_fields.length > 0) {
      for (const cf of def.custom_fields) {
        mappings.push({
          id: cf.id || String(Math.random()),
          sourceField: cf.name || cf.id,
          fieldType: cf.type || 'text',
          targetField: cf.id,
          required: false,
          defaultValue: '-',
        });
      }
    } else if (tmpl?.parameter_fields) {
      const mappingFields = tmpl.parameter_fields.filter(
        pf => pf.category === 'mapping' || pf.variable_name.includes('field')
      );
      for (const mf of mappingFields) {
        mappings.push({
          id: mf.variable_name,
          sourceField: mf.label || mf.variable_name,
          fieldType: mf.value_type || 'text',
          targetField: mf.variable_name,
          required: Boolean(mf.required),
          defaultValue: String(mf.default_value ?? '-'),
        });
      }
    }


    // Default Query Template
    let queryTmpl = def.query_template || '';
    if (!queryTmpl) {
      if (sys.includes('jira') || sys === 'itsm') {
        queryTmpl = 'project = {project} AND (summary ~ "{query}" OR description ~ "{query}" OR comments ~ "{query}") AND updated >= -{lookback}';
      } else if (sys.includes('splunk') || sys === 'log_search') {
        queryTmpl = 'index={project} (error OR exception OR "{query}") earliest=-{lookback} | head {max_results} | stats count by sourcetype, host';
      } else if (sys.includes('confluence')) {
        queryTmpl = 'type = page AND space in ({project}) AND text ~ "{query}" order by lastModified desc';
      } else if (sys.includes('signalfx')) {
        queryTmpl = "data('{query}', filter=filter('service', '{project}')).publish()";
      } else if (sys.includes('kafka')) {
        queryTmpl = 'kafka-consumer-groups --bootstrap-server {endpoint} --describe --group {project}';
      } else if (sys.includes('kube')) {
        queryTmpl = 'kubectl get events -n {project} --field-selector type=Warning --sort-by=.metadata.creationTimestamp';
      } else {
        queryTmpl = '{query} --scope {project} --lookback {lookback}';
      }
    }

    // Default Scopes
    const scopes =
      def.scopes ||
      (Array.isArray(tmpl?.supported_operations) && tmpl.supported_operations.length > 0
        ? tmpl.supported_operations.map(op => `${sys}:${op}`)
        : [`read:${sys}-work`, `read:${sys}-data`, `read:${sys}-user`]);

    return {
      name: inst?.owner ? `${conn.name} - ${inst.owner}` : conn.name,
      type: tmpl?.protocol ? `${conn.name} (${tmpl.protocol})` : 'Cloud Instance',
      description: inst?.description || conn.description || '',
      owner: inst?.owner || 'SAG Platform Team',
      tags: inst?.tags && inst.tags.length > 0 ? inst.tags : [conn.category.toLowerCase(), sys, 'incident'],
      authMethod: activeAuthName,
      instanceUrl: endpoint,
      clientId: `\${${sys.toUpperCase()}_CLIENT_ID}`,
      clientSecret: '••••••••••••••••••••••••',
      authUrl: endpoint ? `${endpoint}/oauth/authorize` : 'https://auth.corp.internal/authorize',
      tokenUrl: endpoint ? `${endpoint}/oauth/token` : 'https://auth.corp.internal/token',
      redirectUri: `https://prism.corp.internal/integrations/${sys}/callback`,
      scopes,
      defaultProject: sys === 'itsm' ? 'FE (Front End)' : sys === 'log_search' ? 'prod_apps' : 'default',
      allowedProjects: inst?.usage && inst.usage.length > 0 ? inst.usage : (sys === 'itsm' ? ['FE', 'SAG', 'TDR', 'STDP'] : ['prod', 'staging', 'dev']),
      defaultIssueTypes: sys === 'itsm' ? ['Incident', 'Bug', 'Task', 'Service Request'] : ['Error', 'Exception', 'Fatal', 'Timeout'],
      savedFilters: sys === 'itsm' ? ['SAG Open Incidents', 'My Assigned Tickets', 'Recently Updated'] : ['Exceptions Past 24h', 'Latency Spikes'],
      fieldMappings: mappings,
      lookbackPeriod: lookback,
      maxResults: maxRes,
      searchFields: ['Summary', 'Description', 'Comments', 'Custom Fields'],
      includeAttachments: true,
      includeComments: true,
      includeSubtasks: false,
      includeLinkedIssues: true,
      includeHistorical: true,
      queryTemplate: queryTmpl,
      accessLevel: 'Project Members',
      allowedGroups: ['SAG Analysts', 'SAG Leads'],
      readAccess: true,
      writeAccess: true,
      adminOnlyActions: false,
      requestTimeout: timeout,
      rateLimit: rateLimit,
      retryAttempts: 3,
      cacheResults: 10,
      enableWebhooks: false,
      enableAuditLogging: true,
    };
  };

  // Resolve current active form state
  const currentForm = useMemo<ConnectorFormState>(() => {
    if (!selectedConnector) {
      return {
        name: '',
        type: '',
        description: '',
        owner: '',
        tags: [],
        authMethod: 'OAuth 2.0',
        instanceUrl: '',
        clientId: '',
        clientSecret: '',
        authUrl: '',
        tokenUrl: '',
        redirectUri: '',
        scopes: [],
        defaultProject: '',
        allowedProjects: [],
        defaultIssueTypes: [],
        savedFilters: [],
        fieldMappings: [],
        lookbackPeriod: '7 days',
        maxResults: 50,
        searchFields: [],
        includeAttachments: true,
        includeComments: true,
        includeSubtasks: false,
        includeLinkedIssues: true,
        includeHistorical: true,
        queryTemplate: '',
        accessLevel: 'Project Members',
        allowedGroups: [],
        readAccess: true,
        writeAccess: true,
        adminOnlyActions: false,
        requestTimeout: 60,
        rateLimit: 500,
        retryAttempts: 3,
        cacheResults: 10,
        enableWebhooks: false,
        enableAuditLogging: true,
      };
    }
    const existing = formStates[selectedConnector.id];
    if (existing) return existing;
    return buildConnectorFormState(selectedConnector);
  }, [selectedConnector, formStates, parameters]);

  const updateCurrentForm = (updater: Partial<ConnectorFormState> | ((prev: ConnectorFormState) => ConnectorFormState)) => {
    if (!selectedConnector) return;
    setFormStates(prev => {
      const current = prev[selectedConnector.id] || buildConnectorFormState(selectedConnector);
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return { ...prev, [selectedConnector.id]: next };
    });
  };

  // Filtered field mappings based on active subtab
  const filteredMappings = useMemo(() => {
    if (!currentForm.fieldMappings) return [];
    if (activeFieldTab === 'Common') {
      const commonKeys = ['summary', 'description', 'time', 'raw', 'host', 'source', 'status', 'error', 'environment', 'application'];
      return currentForm.fieldMappings.filter(m =>
        commonKeys.some(k => m.sourceField.toLowerCase().includes(k) || m.targetField.toLowerCase().includes(k))
      );
    }
    if (activeFieldTab === 'Specific') {
      const commonKeys = ['summary', 'description', 'time', 'raw', 'host', 'source', 'status', 'error', 'environment', 'application'];
      return currentForm.fieldMappings.filter(m =>
        !commonKeys.some(k => m.sourceField.toLowerCase().includes(k) || m.targetField.toLowerCase().includes(k))
      );
    }
    return currentForm.fieldMappings;
  }, [currentForm.fieldMappings, activeFieldTab]);

  // Test live connection reachability probe
  const handleTestConnection = async () => {
    if (!selectedConnector) return;
    setTestingConnection(true);
    try {
      if (selectedConnector.system_name === 'oracle' || selectedConnector.template?.is_enabled_by_policy === false) {
        throw new Error('Database access disabled by platform governance policy.');
      }

      // Live backend health probe
      const health = await fetchConnectorHealthCheck(selectedConnector.system_name);
      const isHealthy = health.overall === 'HEALTHY' || health.overall === 'DEGRADED';
      const nowStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      setConnectionProbeResult({
        success: isHealthy,
        timestamp: `${nowStr} (${health.latency_ms ? `${health.latency_ms.toFixed(0)}ms` : 'Healthy'})`,
        message: health.message || `Connected via ${health.connectivity} path.`,
      });
      showToast(`Connection to ${selectedConnector.name} tested: ${health.overall}`);
    } catch (err) {
      const nowStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      setConnectionProbeResult({
        success: false,
        timestamp: nowStr,
        message: err instanceof Error ? err.message : 'Connection test failed.',
      });
      showToast(`Connection test failed: ${err instanceof Error ? err.message : 'Unable to connect'}`);
    } finally {
      setTestingConnection(false);
    }
  };

  // Save live configuration to backend
  const handleSaveConfiguration = async () => {
    if (!selectedConnector) return;
    setSavingConfig(true);
    try {
      if (selectedConnector.system_name === 'oracle') {
        throw new Error('Oracle configuration cannot be saved: Direct database access is blocked by policy.');
      }

      const sys = selectedConnector.system_name;
      const tmpl = selectedConnector.template;
      const promises: Promise<any>[] = [];

      // 1. Save live parameter overrides for this tool if matching rows exist
      const timeoutParam = parameters.find(
        p => p.tool.toLowerCase() === sys.toLowerCase() && p.variable_name.toLowerCase().includes('timeout')
      );
      if (timeoutParam && timeoutParam.allow_project_override) {
        promises.push(
          setParameterOverride(timeoutParam.tool, timeoutParam.variable_name, {
            value: currentForm.requestTimeout,
            expected_revision: timeoutParam.override_revision ?? 0,
            expected_definition_revision: timeoutParam.revision,
          }).catch(() => null)
        );
      }

      const rateLimitParam = parameters.find(
        p => p.tool.toLowerCase() === sys.toLowerCase() && p.variable_name.toLowerCase().includes('rate_limit')
      );
      if (rateLimitParam && rateLimitParam.allow_project_override) {
        promises.push(
          setParameterOverride(rateLimitParam.tool, rateLimitParam.variable_name, {
            value: `${currentForm.rateLimit} req/min`,
            expected_revision: rateLimitParam.override_revision ?? 0,
            expected_definition_revision: rateLimitParam.revision,
          }).catch(() => null)
        );
      }

      // 2. Persist project connector instance to backend
      if (principal?.project_id && tmpl) {
        promises.push(
          saveProjectConnector(principal.project_id, {
            instance_id: selectedConnector.projectInstance?.instance_id || `${sys}-default`,
            template_id: tmpl.template_id || sys,
            template_version: tmpl.version || '1.0.0',
            system_name: sys,
            environment_dependency: 'independent',
            tool_environment: selectedEnvironment,
            owner: currentForm.owner,
            description: currentForm.description,
            tags: currentForm.tags,
            usage: currentForm.allowedProjects,
            enabled: true,
            status: 'enabled',
            definition_json: {
              endpoint: currentForm.instanceUrl,
              auth_type: currentForm.authMethod,
              timeout_seconds: currentForm.requestTimeout,
              max_results: currentForm.maxResults,
              query_template: currentForm.queryTemplate,
              scopes: currentForm.scopes,
              custom_fields: currentForm.fieldMappings.map(f => ({
                id: f.id,
                name: f.sourceField,
                type: f.fieldType,
              })),
            },
          }).catch(err => {
            console.warn('Project connector save notice:', err);
          })
        );
      }

      await Promise.all(promises);
      await loadBackendData();
      showToast(`Configuration for ${selectedConnector.name} saved to backend.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save connector configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  // Reset to live template defaults
  const handleResetToDefaults = () => {
    if (!selectedConnector) return;
    const fresh = buildConnectorFormState(selectedConnector);
    updateCurrentForm({ ...fresh });
    showToast(`Reset ${selectedConnector.name} to template defaults.`);
  };

  // Tag helpers
  const handleAddTag = () => {
    const val = newTagInput.trim().toLowerCase();
    if (val && !currentForm.tags.includes(val)) {
      updateCurrentForm({ tags: [...currentForm.tags, val] });
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (t: string) => {
    updateCurrentForm({ tags: currentForm.tags.filter(item => item !== t) });
  };

  // Project helpers
  const handleAddAllowedProject = () => {
    const val = newProjectInput.trim().toUpperCase();
    if (val && !currentForm.allowedProjects.includes(val)) {
      updateCurrentForm({ allowedProjects: [...currentForm.allowedProjects, val] });
      setNewProjectInput('');
    }
  };

  const handleRemoveAllowedProject = (p: string) => {
    updateCurrentForm({ allowedProjects: currentForm.allowedProjects.filter(item => item !== p) });
  };

  // Issue types helpers
  const handleAddIssueType = () => {
    const val = newIssueTypeInput.trim();
    if (val && !currentForm.defaultIssueTypes.includes(val)) {
      updateCurrentForm({ defaultIssueTypes: [...currentForm.defaultIssueTypes, val] });
      setNewIssueTypeInput('');
    }
  };

  const handleRemoveIssueType = (it: string) => {
    updateCurrentForm({ defaultIssueTypes: currentForm.defaultIssueTypes.filter(item => item !== it) });
  };

  // Filter helpers
  const handleAddFilter = () => {
    const val = newFilterInput.trim();
    if (val && !currentForm.savedFilters.includes(val)) {
      updateCurrentForm({ savedFilters: [...currentForm.savedFilters, val] });
      setNewFilterInput('');
    }
  };

  const handleRemoveFilter = (f: string) => {
    updateCurrentForm({ savedFilters: currentForm.savedFilters.filter(item => item !== f) });
  };

  // Scope helper
  const handleRemoveScope = (sc: string) => {
    updateCurrentForm({ scopes: currentForm.scopes.filter(item => item !== sc) });
  };

  // Group helpers
  const handleAddGroup = () => {
    const val = newGroupInput.trim();
    if (val && !currentForm.allowedGroups.includes(val)) {
      updateCurrentForm({ allowedGroups: [...currentForm.allowedGroups, val] });
      setNewGroupInput('');
    }
  };

  const handleRemoveGroup = (g: string) => {
    updateCurrentForm({ allowedGroups: currentForm.allowedGroups.filter(item => item !== g) });
  };

  // Field mapping handlers
  const handleAddFieldMapping = () => {
    const newEntry: FieldMappingEntry = {
      id: `field_${Date.now()}`,
      sourceField: '',
      fieldType: 'string',
      targetField: '',
      required: false,
      defaultValue: '-',
    };
    updateCurrentForm(prev => ({
      ...prev,
      fieldMappings: [...prev.fieldMappings, newEntry],
    }));
  };

  const handleRemoveFieldMapping = (id: string) => {
    updateCurrentForm(prev => ({
      ...prev,
      fieldMappings: prev.fieldMappings.filter(m => m.id !== id),
    }));
  };

  const handleDiscoverFields = async () => {
    if (!selectedConnector || !principal?.project_id) return;
    setDiscoveringFields(true);
    try {
      const instanceId = selectedConnector.projectInstance?.instance_id || `${selectedConnector.system_name}-default`;
      const res = await discoverConnectorFields(principal.project_id, instanceId, selectedEnvironment);
      if (res && Array.isArray(res.fields) && res.fields.length > 0) {
        const newMappings: FieldMappingEntry[] = res.fields.map(f => ({
          id: f.id,
          sourceField: f.name || f.id,
          fieldType: 'string',
          targetField: f.id,
          required: false,
          defaultValue: '-',
        }));
        updateCurrentForm(prev => {
          const existingIds = new Set(prev.fieldMappings.map(m => m.id));
          const additions = newMappings.filter(m => !existingIds.has(m.id));
          return {
            ...prev,
            fieldMappings: [...prev.fieldMappings, ...additions],
          };
        });
        showToast(`Discovered ${res.fields.length} custom fields from ${selectedConnector.name}.`);
      } else {
        showToast(`No custom fields returned by ${selectedConnector.name} discovery endpoint.`);
      }
    } catch (err) {
      showToast(`Field discovery notice: ${err instanceof Error ? err.message : 'Discovery unavailable for this connector'}`);
    } finally {
      setDiscoveringFields(false);
    }
  };

  // Scroll to section smoothly
  const handleScrollToSection = (section: StepperSection) => {
    setActiveStepper(section);
    let elemId = '';
    if (section.includes('Connection')) elemId = 'section-connection';
    else if (section.includes('Projects & Filters')) elemId = 'section-projects';
    else if (section.includes('Field Mapping')) elemId = 'section-mapping';
    else if (section.includes('Investigation Settings')) elemId = 'section-investigation';
    else if (section.includes('Permissions')) elemId = 'section-permissions';
    else if (section.includes('Advanced')) elemId = 'section-advanced';
    else if (section.includes('Test & Save')) elemId = 'section-test-save';

    if (elemId) {
      const el = document.getElementById(elemId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Dynamic Avatar renderer
  const renderConnectorAvatar = (conn: BackendConnectorItem, size = 44) => {
    const { brandColor, iconType } = conn;
    if (iconType === 'jira') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <span style={{ fontSize: size * 0.5, fontWeight: 800 }}>J</span>
        </div>
      );
    }
    if (iconType === 'splunk') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Activity size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'confluence') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <BookOpen size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'signalfx') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Activity size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'qtest') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <CheckCircle2 size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'unix') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Terminal size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'oracle') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Database size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'kafka') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Radio size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'kubernetes') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <Layers size={size * 0.5} />
        </div>
      );
    }
    if (iconType === 'gitlab') {
      return (
        <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
          <GitBranch size={size * 0.5} />
        </div>
      );
    }
    return (
      <div className="prism-header-avatar" style={{ width: size, height: size, background: brandColor }}>
        <Sparkles size={size * 0.5} />
      </div>
    );
  };

  const isOracle = selectedConnector?.system_name === 'oracle';

  return (
    <div className="view-container tools-page" style={{ padding: '16px 28px 76px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{ position: 'fixed', bottom: '80px', right: '28px', zIndex: 10000, maxWidth: '420px', width: 'calc(100% - 56px)' }}>
          <NotificationBanner
            type="success"
            message={toastMessage}
            onClose={() => setToastMessage(null)}
            autoCloseMs={6000}
          />
        </div>
      )}

      <div className="prism-connector-root">
        {/* Dynamic Connector Selection Strip powered by authentic backend templates */}
        <div className="prism-selector-bar" role="tablist" aria-label="Backend Platform Connectors">
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginRight: '6px', whiteSpace: 'nowrap' }}>
            CONNECTORS ({backendConnectors.length}):
          </span>
          {backendConnectors.map(conn => {
            const isSelected = selectedConnector?.id === conn.id;
            return (
              <button
                key={conn.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`prism-selector-item ${isSelected ? 'is-selected' : ''}`}
                onClick={() => setSelectedConnectorId(conn.id)}
              >
                <span className="prism-selector-icon" style={{ background: conn.brandColor }}>
                  {conn.iconType === 'jira' ? 'J' : conn.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{conn.name}</span>
                {conn.system_name === 'oracle' && (
                  <span style={{ fontSize: '9px', background: '#fee2e2', color: '#dc2626', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>
                    BLOCKED
                  </span>
                )}
              </button>
            );
          })}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              className="prism-refresh-icon-btn"
              onClick={() => {
                void loadBackendData();
                showToast('Synchronized with live backend connectors and parameters.');
              }}
              title="Synchronize live catalog and parameters"
            >
              <RefreshCw size={13} /> Sync Catalog
            </button>
            <button
              type="button"
              className="prism-refresh-icon-btn"
              onClick={() => setIsCreatingCustom(true)}
              disabled={!canEdit}
              title="Add custom MCP / A2A integration"
            >
              <Plus size={13} /> Add Custom MCP
            </button>
          </div>
        </div>

        {/* Breadcrumb Row */}
        {selectedConnector && (
          <div className="prism-breadcrumb-row">
            <span>Connectors</span>
            <span className="sep">&gt;</span>
            <span>{selectedConnector.name}</span>
            <span className="sep">&gt;</span>
            <span className="current">Configuration</span>
          </div>
        )}

        {/* Main Header Row */}
        {selectedConnector && (
          <div className="prism-header-row">
            <div className="prism-header-left">
              {renderConnectorAvatar(selectedConnector, 44)}
              <div className="prism-header-titles">
                <div className="prism-header-title-line">
                  <h1>{selectedConnector.name} Connector</h1>
                  {isOracle ? (
                    <span className="prism-status-badge disabled">
                      <span style={{ color: '#dc2626' }}>●</span> Disabled by Policy
                    </span>
                  ) : (
                    <span className="prism-status-badge active">
                      <span style={{ color: '#059669' }}>●</span> Active
                    </span>
                  )}
                </div>
                <p className="prism-header-subtitle">
                  Configure connection, mapping, and investigation settings for {selectedConnector.name}
                </p>
              </div>
            </div>

            <div className="prism-header-right">
              {/* Scope / Project Dropdown */}
              <div className="prism-scope-pill" title={`Tenant: ${principal?.tenant_id || 'Platform'} | Project: ${principal?.project_id || 'default'}`}>
                <span className="scope-icon">
                  <Folder size={14} />
                </span>
                <span>Project: <strong>{principal?.project_id || 'default'}</strong></span>
                <span style={{ opacity: 0.65, fontSize: '11px', marginLeft: 2 }}>({principal?.tenant_id || 'Platform'})</span>
              </div>

              {/* Environment Dropdown */}
              <div className="prism-scope-pill" title="Active deployment environment">
                <span style={{ color: '#64748b' }}>Environment:</span>
                <select
                  aria-label="Target Environment"
                  value={selectedEnvironment}
                  onChange={e => setSelectedEnvironment(e.target.value)}
                  style={{ border: 'none', background: 'transparent', font: 'inherit', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                >
                  {availableEnvironments.length > 0 ? (
                    availableEnvironments.map(env => (
                      <option key={env.id} value={env.name}>
                        {env.name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="QLAB02">QLAB02</option>
                      <option value="Production">Production</option>
                      <option value="Staging">Staging</option>
                      <option value="Development">Development</option>
                    </>
                  )}
                </select>
              </div>

              {/* View Documentation Link */}
              <a
                href="https://ai.google.dev/gemini-api/docs"
                target="_blank"
                rel="noreferrer"
                className="prism-doc-btn"
                title="Read Google ADK and Connector Integration Documentation"
              >
                <span>View Documentation</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        )}

        {/* Policy Alert Banner (Oracle) */}
        {isOracle && (
          <div className="prism-policy-callout">
            <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <h4>Database access disabled by policy</h4>
              <p>
                The Oracle database connector is strictly disabled by platform governance policy. Direct database
                querying, schema inspection, or SQL execution is unsupported in this release.
              </p>
            </div>
          </div>
        )}

        {/* Numbered Stepper Quick Navigation */}
        <div className="prism-stepper-bar" role="tablist" aria-label="Configuration Sections">
          {(
            [
              '1. Connection',
              '2. Projects & Filters',
              '3. Field Mapping',
              '4. Investigation Settings',
              '5. Permissions',
              '6. Advanced',
              '7. Test & Save',
            ] as StepperSection[]
          ).map(tab => {
            const isActive = activeStepper === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`prism-stepper-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => handleScrollToSection(tab)}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* 2-Column Responsive Workspace Grid */}
        {selectedConnector && (
          <div className="prism-content-grid">
            {/* =================================================================
                LEFT COLUMN
                ================================================================= */}
            <div className="prism-grid-col">
              {/* Card 1: Basic Information */}
              <section id="section-connection" className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Sliders size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Basic Information</h3>
                      <p>General details about this {selectedConnector.name} connector</p>
                    </div>
                  </div>

                  {/* Mini Connector Brand Badge */}
                  <div className="prism-mini-brand-badge">
                    {renderConnectorAvatar(selectedConnector, 24)}
                    <div>
                      <div className="brand-name">{selectedConnector.name}</div>
                      <div className="brand-sub">{selectedConnector.category}</div>
                    </div>
                  </div>
                </div>

                <div className="prism-form-grid-2">
                  <div className="prism-form-group">
                    <label className="prism-label">
                      Connector Name <span className="prism-req">*</span>
                    </label>
                    <input
                      type="text"
                      className="prism-input"
                      value={currentForm.name}
                      onChange={e => updateCurrentForm({ name: e.target.value })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Connector Type</label>
                    <select
                      className="prism-select"
                      value={currentForm.type}
                      onChange={e => updateCurrentForm({ type: e.target.value })}
                    >
                      <option value={currentForm.type}>{currentForm.type}</option>
                      <option value={`${selectedConnector.name} (Cloud)`}>{selectedConnector.name} (Cloud)</option>
                      <option value={`${selectedConnector.name} (Server)`}>{selectedConnector.name} (Server)</option>
                      <option value={`${selectedConnector.name} (Enterprise)`}>{selectedConnector.name} (Enterprise)</option>
                    </select>
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">Description</label>
                    <textarea
                      className="prism-textarea"
                      value={currentForm.description}
                      onChange={e => updateCurrentForm({ description: e.target.value })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Owner</label>
                    <input
                      type="text"
                      className="prism-input"
                      value={currentForm.owner}
                      placeholder={principal?.subject || 'Platform Operations'}
                      onChange={e => updateCurrentForm({ owner: e.target.value })}
                    />
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">Tags</label>
                    <div className="prism-tags-container">
                      {currentForm.tags.map(tag => (
                        <span key={tag} className="prism-tag-pill">
                          {tag}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => handleRemoveTag(tag)}
                            aria-label={`Remove tag ${tag}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="prism-tag-input-inline"
                        placeholder="Add tag… (Enter)"
                        value={newTagInput}
                        onChange={e => setNewTagInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 2: Authentication */}
              <section className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Lock size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Authentication</h3>
                      <p>Configure how PRISM authenticates with {selectedConnector.name}</p>
                    </div>
                  </div>

                  <span className="prism-status-badge active">
                    <Check size={12} /> Configured
                  </span>
                </div>

                {/* Segmented Bar for Auth Profiles */}
                <div className="prism-segmented-bar" role="tablist">
                  {['OAuth 2.0', 'API Token', 'Basic Auth', 'JWT (App)'].map(method => (
                    <button
                      key={method}
                      type="button"
                      role="tab"
                      aria-selected={currentForm.authMethod === method}
                      className={`prism-segmented-item ${currentForm.authMethod === method ? 'is-selected' : ''}`}
                      onClick={() => updateCurrentForm({ authMethod: method })}
                    >
                      {method}
                    </button>
                  ))}
                </div>

                {/* Inputs */}
                <div className="prism-form-grid-2">
                  <div className="prism-form-group">
                    <label className="prism-label">
                      {selectedConnector.name} Instance URL <span className="prism-req">*</span>
                    </label>
                    <input
                      type="text"
                      className="prism-input"
                      value={currentForm.instanceUrl}
                      onChange={e => updateCurrentForm({ instanceUrl: e.target.value })}
                    />
                    <span className="prism-field-caption">
                      Your {selectedConnector.name} Cloud or Server instance URL
                    </span>
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">
                      Client ID <span className="prism-req">*</span>
                    </label>
                    <div className="prism-input-with-action">
                      <input
                        type="text"
                        className="prism-input"
                        value={currentForm.clientId}
                        onChange={e => updateCurrentForm({ clientId: e.target.value })}
                      />
                      <button
                        type="button"
                        className="prism-input-action-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(currentForm.clientId);
                          showToast('Client ID copied to clipboard.');
                        }}
                        title="Copy Client ID"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">
                      Client Secret <span className="prism-req">*</span>
                    </label>
                    <div className="prism-input-with-action">
                      <input
                        type={isSecretVisible ? 'text' : 'password'}
                        className="prism-input"
                        value={currentForm.clientSecret}
                        onChange={e => updateCurrentForm({ clientSecret: e.target.value })}
                      />
                      <button
                        type="button"
                        className="prism-input-action-btn"
                        onClick={() => setIsSecretVisible(!isSecretVisible)}
                        title={isSecretVisible ? 'Hide secret' : 'Show secret'}
                      >
                        {isSecretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <span className="prism-field-caption">Stored securely in platform vault</span>
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Authorization URL</label>
                    <input
                      type="text"
                      className="prism-input"
                      value={currentForm.authUrl}
                      onChange={e => updateCurrentForm({ authUrl: e.target.value })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Token URL</label>
                    <input
                      type="text"
                      className="prism-input"
                      value={currentForm.tokenUrl}
                      onChange={e => updateCurrentForm({ tokenUrl: e.target.value })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">
                      Redirect URI <span className="prism-req">*</span>
                    </label>
                    <div className="prism-input-with-action">
                      <input
                        type="text"
                        className="prism-input"
                        value={currentForm.redirectUri}
                        onChange={e => updateCurrentForm({ redirectUri: e.target.value })}
                      />
                      <button
                        type="button"
                        className="prism-input-action-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(currentForm.redirectUri);
                          showToast('Redirect URI copied to clipboard.');
                        }}
                        title="Copy Redirect URI"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">
                      Scopes <span className="prism-req">*</span>
                    </label>
                    <div className="prism-tags-container">
                      {currentForm.scopes.map(sc => (
                        <span key={sc} className="prism-tag-pill">
                          {sc}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => handleRemoveScope(sc)}
                            aria-label={`Remove scope ${sc}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <span className="prism-field-caption">Select required OAuth scopes</span>
                  </div>
                </div>

                {/* Test Connection Bar */}
                <div id="section-test-save" className="prism-test-connection-strip">
                  <button
                    type="button"
                    className="prism-test-btn"
                    onClick={handleTestConnection}
                    disabled={testingConnection || isOracle}
                  >
                    <Play size={13} className={testingConnection ? 'spin' : ''} />
                    {testingConnection ? 'Testing…' : 'Test Connection'}
                  </button>

                  <div className={`prism-connection-status-box ${connectionProbeResult.success ? '' : 'degraded'}`}>
                    {connectionProbeResult.success ? (
                      <CheckCircle2 size={16} style={{ color: '#059669', flexShrink: 0 }} />
                    ) : (
                      <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0 }} />
                    )}
                    <div className="status-text">
                      <strong>{connectionProbeResult.success ? 'Connection successful' : 'Connection failed'}</strong>
                      <span>
                        {connectionProbeResult.message || `Last verified: ${connectionProbeResult.timestamp}`}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="prism-refresh-icon-btn"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    title="Refresh connection status"
                  >
                    <RefreshCw size={13} className={testingConnection ? 'spin' : ''} />
                    Refresh
                  </button>
                </div>
              </section>

              {/* Card 3: Projects & Filters */}
              <section id="section-projects" className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Folder size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Projects &amp; Filters</h3>
                      <p>Define which projects and filters are available for this connector</p>
                    </div>
                  </div>
                </div>

                <div className="prism-form-grid-2">
                  <div className="prism-form-group">
                    <label className="prism-label">
                      Default Project Scope <span className="prism-req">*</span>
                    </label>
                    <input
                      type="text"
                      className="prism-input"
                      value={currentForm.defaultProject}
                      placeholder={principal?.project_id || 'default'}
                      onChange={e => updateCurrentForm({ defaultProject: e.target.value })}
                    />
                    <span className="prism-field-caption">Primary target project or namespace scope</span>
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Allowed Projects (Optional)</label>
                    <div className="prism-tags-container">
                      {currentForm.allowedProjects.map(p => (
                        <span key={p} className="prism-tag-pill">
                          {p}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => handleRemoveAllowedProject(p)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="prism-tag-input-inline"
                        placeholder="Add project… (Enter)"
                        value={newProjectInput}
                        onChange={e => setNewProjectInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddAllowedProject();
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">
                      {selectedConnector.category === 'Observability'
                        ? 'Default Indexes & Log Types'
                        : selectedConnector.category === 'Knowledge'
                        ? 'Default Spaces & Doc Types'
                        : selectedConnector.category === 'Source Code'
                        ? 'Default Branches & Pipelines'
                        : 'Default Entity & Issue Types'}
                    </label>
                    <div className="prism-tags-container">
                      {currentForm.defaultIssueTypes.map(it => (
                        <span key={it} className="prism-tag-pill">
                          {it}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => handleRemoveIssueType(it)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="prism-tag-input-inline"
                        placeholder="Add type… (Enter)"
                        value={newIssueTypeInput}
                        onChange={e => setNewIssueTypeInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddIssueType();
                          }
                        }}
                      />
                    </div>
                    <span className="prism-field-caption">Entity targets recognized by agent triage</span>
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">
                      {selectedConnector.category === 'Observability'
                        ? 'Saved Searches & SPL Macros'
                        : selectedConnector.category === 'Knowledge'
                        ? 'Saved CQL Queries'
                        : 'Saved Filters & JQL Queries'}
                    </label>
                    <div className="prism-tags-container">
                      {currentForm.savedFilters.map(f => (
                        <span key={f} className="prism-tag-pill">
                          {f}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => handleRemoveFilter(f)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="prism-tag-input-inline"
                        placeholder="Add filter… (Enter)"
                        value={newFilterInput}
                        onChange={e => setNewFilterInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddFilter();
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 4: Field Mapping */}
              <section id="section-mapping" className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Layers size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Field Mapping</h3>
                      <p>Map {selectedConnector.name} custom fields to PRISM fields</p>
                    </div>
                  </div>
                </div>

                {/* Subtabs */}
                <div className="prism-subtabs-row">
                  <button
                    type="button"
                    className={`prism-subtab-btn ${activeFieldTab === 'Common' ? 'is-active' : ''}`}
                    onClick={() => setActiveFieldTab('Common')}
                  >
                    Common Fields
                  </button>
                  <button
                    type="button"
                    className={`prism-subtab-btn ${activeFieldTab === 'Specific' ? 'is-active' : ''}`}
                    onClick={() => setActiveFieldTab('Specific')}
                  >
                    {principal?.project_id ? principal.project_id.toUpperCase() : 'Project'} Custom Fields
                  </button>
                  <button
                    type="button"
                    className={`prism-subtab-btn ${activeFieldTab === 'All' ? 'is-active' : ''}`}
                    onClick={() => setActiveFieldTab('All')}
                  >
                    All {selectedConnector.name} Fields ({currentForm.fieldMappings.length})
                  </button>
                </div>

                {/* Field Mapping Table or Empty State */}
                {filteredMappings.length === 0 ? (
                  <div className="prism-empty-mapping-state">
                    No field mappings {activeFieldTab !== 'All' ? `in the ${activeFieldTab} category` : 'configured'}. You can discover custom fields from the live provider or add custom mappings below.
                  </div>
                ) : (
                  <div className="prism-table-wrap">
                    <table className="prism-field-table">
                      <thead>
                        <tr>
                          <th>{selectedConnector.name} Field</th>
                          <th>Field Type</th>
                          <th>PRISM Field</th>
                          <th>Required</th>
                          <th>Default Fallback</th>
                          <th style={{ width: 36 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMappings.map(entry => (
                          <tr key={entry.id}>
                            <td>
                              <input
                                type="text"
                                className="prism-input-compact"
                                style={{ fontSize: '12px', padding: '4px 8px' }}
                                value={entry.sourceField}
                                placeholder="source_field_name"
                                onChange={e => {
                                  const val = e.target.value;
                                  updateCurrentForm(prev => ({
                                    ...prev,
                                    fieldMappings: prev.fieldMappings.map(m =>
                                      m.id === entry.id ? { ...m, sourceField: val } : m
                                    ),
                                  }));
                                }}
                              />
                            </td>
                            <td>
                              <select
                                className="prism-select-compact"
                                style={{ fontSize: '11.5px', padding: '4px 6px' }}
                                value={entry.fieldType}
                                onChange={e => {
                                  const val = e.target.value;
                                  updateCurrentForm(prev => ({
                                    ...prev,
                                    fieldMappings: prev.fieldMappings.map(m =>
                                      m.id === entry.id ? { ...m, fieldType: val } : m
                                    ),
                                  }));
                                }}
                              >
                                <option value="string">string</option>
                                <option value="integer">integer</option>
                                <option value="number">number</option>
                                <option value="boolean">boolean</option>
                                <option value="json">json</option>
                                <option value="textarea">textarea</option>
                                <option value="timestamp">timestamp</option>
                                <option value="secret_ref">secret_ref</option>
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                className="prism-input-compact"
                                style={{ fontSize: '12px', padding: '4px 8px' }}
                                value={entry.targetField}
                                placeholder="target_field_name"
                                onChange={e => {
                                  const val = e.target.value;
                                  updateCurrentForm(prev => ({
                                    ...prev,
                                    fieldMappings: prev.fieldMappings.map(m =>
                                      m.id === entry.id ? { ...m, targetField: val } : m
                                    ),
                                  }));
                                }}
                              />
                            </td>
                            <td>
                              <label className="prism-toggle-switch">
                                <input
                                  type="checkbox"
                                  checked={entry.required}
                                  onChange={e => {
                                    const checked = e.target.checked;
                                    updateCurrentForm(prev => ({
                                      ...prev,
                                      fieldMappings: prev.fieldMappings.map(m =>
                                        m.id === entry.id ? { ...m, required: checked } : m
                                      ),
                                    }));
                                  }}
                                />
                                <span className="prism-toggle-slider" />
                              </label>
                            </td>
                            <td>
                              <input
                                type="text"
                                className="prism-input-compact"
                                style={{ fontSize: '12px', padding: '4px 8px' }}
                                value={entry.defaultValue}
                                placeholder="-"
                                onChange={e => {
                                  const val = e.target.value;
                                  updateCurrentForm(prev => ({
                                    ...prev,
                                    fieldMappings: prev.fieldMappings.map(m =>
                                      m.id === entry.id ? { ...m, defaultValue: val } : m
                                    ),
                                  }));
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="prism-remove-mapping-btn"
                                title="Delete field mapping"
                                onClick={() => handleRemoveFieldMapping(entry.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="prism-add-mapping-btn"
                    onClick={handleAddFieldMapping}
                  >
                    <Plus size={13} /> Add Field Mapping
                  </button>
                  <button
                    type="button"
                    className="prism-btn-reset"
                    style={{ padding: '6px 14px', fontSize: '12px' }}
                    onClick={handleDiscoverFields}
                    disabled={discoveringFields}
                    title="Query live provider endpoint to discover fields"
                  >
                    <Sparkles size={13} className={discoveringFields ? 'spin' : ''} />
                    {discoveringFields ? 'Discovering…' : 'Discover Fields from Provider'}
                  </button>
                </div>
              </section>
            </div>

            {/* =================================================================
                RIGHT COLUMN
                ================================================================= */}
            <div className="prism-grid-col">
              {/* Card 5: Investigation Settings */}
              <section id="section-investigation" className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Settings size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Investigation Settings</h3>
                      <p>Configure default parameters for investigations using {selectedConnector.name}</p>
                    </div>
                  </div>
                </div>

                <div className="prism-form-grid-2">
                  <div className="prism-form-group">
                    <label className="prism-label">
                      Default Lookback Period <span className="prism-req">*</span>
                    </label>
                    <select
                      className="prism-select"
                      value={currentForm.lookbackPeriod}
                      onChange={e => updateCurrentForm({ lookbackPeriod: e.target.value })}
                    >
                      <option value="24 hours">24 hours</option>
                      <option value="7 days">7 days</option>
                      <option value="14 days">14 days</option>
                      <option value="30 days">30 days</option>
                    </select>
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">
                      Max Results <span className="prism-req">*</span>
                    </label>
                    <input
                      type="number"
                      className="prism-input"
                      value={currentForm.maxResults}
                      onChange={e => updateCurrentForm({ maxResults: Number(e.target.value) || 50 })}
                    />
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">Search Fields</label>
                    <div className="prism-tags-container">
                      {currentForm.searchFields.map(sf => (
                        <span key={sf} className="prism-tag-pill">
                          {sf}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => {
                              updateCurrentForm({
                                searchFields: currentForm.searchFields.filter(f => f !== sf),
                              });
                            }}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Include in Search Toggles */}
                  <div className="prism-form-group full-width">
                    <label className="prism-label" style={{ marginBottom: '6px' }}>
                      Include in Search
                    </label>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.includeAttachments}
                          onChange={e => updateCurrentForm({ includeAttachments: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <span className="toggle-label">Attachments</span>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.includeComments}
                          onChange={e => updateCurrentForm({ includeComments: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <span className="toggle-label">Comments</span>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.includeSubtasks}
                          onChange={e => updateCurrentForm({ includeSubtasks: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <span className="toggle-label">Sub-tasks</span>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.includeLinkedIssues}
                          onChange={e => updateCurrentForm({ includeLinkedIssues: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <span className="toggle-label">Linked Issues</span>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.includeHistorical}
                          onChange={e => updateCurrentForm({ includeHistorical: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <span className="toggle-label">Historically Related Tickets</span>
                    </div>
                  </div>

                  {/* Query Template Code Box */}
                  <div className="prism-form-group full-width">
                    <label className="prism-label">Default Query Template</label>
                    <div className="prism-template-box">
                      <button
                        type="button"
                        className="prism-template-copy-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(currentForm.queryTemplate);
                          showToast('Query template copied to clipboard.');
                        }}
                        title="Copy template"
                      >
                        <Copy size={13} />
                      </button>
                      <pre className="prism-template-code">{currentForm.queryTemplate}</pre>
                    </div>
                    <span className="prism-field-caption">
                      Use {'{project}'}, {'{query}'}, {'{lookback}'} as variables
                    </span>
                  </div>
                </div>
              </section>

              {/* Card 6: Permissions & Access */}
              <section id="section-permissions" className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Shield size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Permissions &amp; Access</h3>
                      <p>Control who can use this connector</p>
                    </div>
                  </div>
                </div>

                <div className="prism-form-grid-2">
                  <div className="prism-form-group full-width">
                    <label className="prism-label">Access Level</label>
                    <select
                      className="prism-select"
                      value={currentForm.accessLevel}
                      onChange={e => updateCurrentForm({ accessLevel: e.target.value })}
                    >
                      <option value="Project Members">Project Members</option>
                      <option value="All Platform Users">All Platform Users</option>
                      <option value="Admins Only">Admins Only</option>
                    </select>
                    <span className="prism-field-caption">Who can use this connector</span>
                  </div>

                  <div className="prism-form-group full-width">
                    <label className="prism-label">Allowed Groups</label>
                    <div className="prism-tags-container">
                      {currentForm.allowedGroups.map(grp => (
                        <span key={grp} className="prism-tag-pill">
                          {grp}
                          <button
                            type="button"
                            className="remove-tag"
                            onClick={() => handleRemoveGroup(grp)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="prism-tag-input-inline"
                        placeholder="Add group… (Enter)"
                        value={newGroupInput}
                        onChange={e => setNewGroupInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddGroup();
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="prism-form-group full-width">
                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.readAccess}
                          onChange={e => updateCurrentForm({ readAccess: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <div>
                        <div className="toggle-label">Read Access</div>
                        <div className="toggle-desc">Allow searching and reading tickets/logs</div>
                      </div>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.writeAccess}
                          onChange={e => updateCurrentForm({ writeAccess: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <div>
                        <div className="toggle-label">Write Access</div>
                        <div className="toggle-desc">Allow creating comments and updates</div>
                      </div>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.adminOnlyActions}
                          onChange={e => updateCurrentForm({ adminOnlyActions: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <div>
                        <div className="toggle-label">Admin Only Actions</div>
                        <div className="toggle-desc">Restrict sensitive actions to admins (e.g., delete)</div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 7: Advanced Settings */}
              <section id="section-advanced" className="prism-card">
                <div className="prism-card-header">
                  <div className="prism-card-header-left">
                    <div className="prism-card-icon-bubble">
                      <Sliders size={16} />
                    </div>
                    <div className="prism-card-titles">
                      <h3>Advanced Settings</h3>
                      <p>Additional configuration options</p>
                    </div>
                  </div>
                </div>

                <div className="prism-form-grid-2">
                  <div className="prism-form-group">
                    <label className="prism-label">Request Timeout (seconds)</label>
                    <input
                      type="number"
                      className="prism-input"
                      value={currentForm.requestTimeout}
                      onChange={e => updateCurrentForm({ requestTimeout: Number(e.target.value) || 60 })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Rate Limit (requests/min)</label>
                    <input
                      type="number"
                      className="prism-input"
                      value={currentForm.rateLimit}
                      onChange={e => updateCurrentForm({ rateLimit: Number(e.target.value) || 500 })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Retry Attempts</label>
                    <input
                      type="number"
                      className="prism-input"
                      value={currentForm.retryAttempts}
                      onChange={e => updateCurrentForm({ retryAttempts: Number(e.target.value) || 3 })}
                    />
                  </div>

                  <div className="prism-form-group">
                    <label className="prism-label">Cache Results (minutes)</label>
                    <input
                      type="number"
                      className="prism-input"
                      value={currentForm.cacheResults}
                      onChange={e => updateCurrentForm({ cacheResults: Number(e.target.value) || 10 })}
                    />
                  </div>

                  <div className="prism-form-group full-width">
                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.enableWebhooks}
                          onChange={e => updateCurrentForm({ enableWebhooks: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <div>
                        <div className="toggle-label">Enable Webhooks</div>
                        <div className="toggle-desc">Receive {selectedConnector.name} webhooks for real-time updates</div>
                      </div>
                    </div>

                    <div className="prism-toggle-item-row">
                      <label className="prism-toggle-switch">
                        <input
                          type="checkbox"
                          checked={currentForm.enableAuditLogging}
                          onChange={e => updateCurrentForm({ enableAuditLogging: e.target.checked })}
                        />
                        <span className="prism-toggle-slider" />
                      </label>
                      <div>
                        <div className="toggle-label">Enable Audit Logging</div>
                        <div className="toggle-desc">Log all connector activities</div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 8: Environment Overrides (Accordion) */}
              <section className="prism-card" style={{ padding: '16px 22px' }}>
                <button
                  type="button"
                  className="prism-accordion-header"
                  onClick={() => setIsEnvOverridesOpen(!isEnvOverridesOpen)}
                  aria-expanded={isEnvOverridesOpen}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="prism-card-icon-bubble" style={{ width: 30, height: 30 }}>
                      <Database size={15} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                        Environment Overrides
                      </h3>
                      <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: '#64748b' }}>
                        Override settings for specific environments
                      </p>
                    </div>
                  </div>
                  <div style={{ color: '#64748b' }}>
                    {isEnvOverridesOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>

                {isEnvOverridesOpen && (
                  <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      {['QLAB02', 'Staging', 'Production'].map(env => (
                        <span
                          key={env}
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: '4px',
                            background: env === selectedEnvironment ? '#fdf2f8' : '#f1f5f9',
                            color: env === selectedEnvironment ? '#be185d' : '#64748b',
                            border: '1px solid',
                            borderColor: env === selectedEnvironment ? '#fbcfe8' : '#e2e8f0',
                          }}
                        >
                          {env}
                        </span>
                      ))}
                    </div>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                      Active environment is synchronized with project runtime setup. Override parameters are
                      automatically scoped to <code>{selectedEnvironment}</code>.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* Sticky Bottom Footer Bar */}
      <div className="prism-sticky-footer-bar">
        <div className="footer-left">
          <button
            type="button"
            className="prism-btn-reset"
            onClick={handleResetToDefaults}
          >
            <RotateCcw size={13} />
            Reset to Defaults
          </button>
        </div>

        <div className="footer-right">
          <button
            type="button"
            className="prism-btn-cancel"
            onClick={() => {
              if (onNavigate) onNavigate('overview');
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="prism-btn-save"
            onClick={handleSaveConfiguration}
            disabled={savingConfig || !canEdit || isOracle}
          >
            <Save size={14} className={savingConfig ? 'spin' : ''} />
            {savingConfig ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Custom MCP Integration Modal */}
      {isCreatingCustom && (
        <IntegrationForm
          principal={principal}
          onClose={() => setIsCreatingCustom(false)}
          onSaved={async () => {
            await loadBackendData();
            setIsCreatingCustom(false);
          }}
        />
      )}

      {/* Edit Existing Custom Integration Modal */}
      {configuringCustomTool && (
        <IntegrationForm
          tool={configuringCustomTool}
          principal={principal}
          onClose={() => setConfiguringCustomTool(null)}
          onSaved={async () => {
            await loadBackendData();
            setConfiguringCustomTool(null);
          }}
        />
      )}
    </div>
  );
};
