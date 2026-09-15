import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Key,
  Save,
  Trash2,
  Layers,
  Activity,
  Info,
  X,
  Lock,
  RefreshCw,
  Plus,
  Check,
  Tag,
  Globe,
  Server,
  RotateCcw,
} from 'lucide-react';
import type {
  ConnectorTemplateItem,
  ProjectConnectorInstanceItem,
  CandidateTestResponse,
  Principal,
  GovernanceTier,
  ConnectorAuthProfileItem,
  EnvironmentConnectionItem,
  ToolAccessRuleItem,
} from '../types/api';
import { getFieldGovernanceTier } from '../types/api';
import {
  validateConnectorCandidate,
  testSavedProjectConnector,
  environmentConnectionDraft,
  saveProjectConnector,
  enableProjectConnector,
  disableProjectConnector,
  listEnvironmentConnections,
  saveEnvironmentConnection,
  deleteEnvironmentConnection,
  testEnvironmentConnection,
  enableEnvironmentConnection,
} from '../services/api';
import '../styles/connector-editor.css';
import { ConnectorProjectPolicy } from './connectors/ConnectorProjectPolicy';
import {
  ConnectorAuthProfilesCard,
  JiraFieldMappingCard,
} from './connectors';

interface ConnectorInstanceEditorProps {
  projectId: string;
  template?: ConnectorTemplateItem;
  instance?: ProjectConnectorInstanceItem;
  availableEnvironments?: Array<{ id: string; name: string }>;
  principal?: Principal;
  onSave?: (saved: ProjectConnectorInstanceItem) => void;
  onCancel?: () => void;
  readOnly?: boolean;
  templateDefaults?: React.ReactNode;
  templateDirty?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

interface CustomFieldRow {
  sourceField: string;
  fieldType: string;
  prismField: string;
  required: boolean;
  defaultValue: string;
}

const SECRET_REFERENCE_FIELD = /(?:^|_)(?:secret|token|api[_-]?key|private[_-]?key|password|passphrase|known_hosts)(?:_ref)?$/i;

function credentialFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    account_identifier: 'Account identifier',
    username: 'Username',
    password_secret_ref: 'Password secret reference',
    api_token_secret_ref: 'API token secret reference',
    token_secret_ref: 'Token secret reference',
    api_key_secret_ref: 'API key secret reference',
    private_key_ref: 'Private key secret reference',
    private_key_passphrase_ref: 'Private key passphrase secret reference',
    known_hosts_ref: 'Known hosts secret reference',
    oauth_provider_profile: 'OAuth provider profile',
    client_id: 'OAuth client ID',
    client_secret_ref: 'OAuth client secret reference',
    audience: 'Audience',
    scopes: 'Scopes',
    app_id: 'Application ID',
    webhook_url: 'Webhook URL',
    secret_token_ref: 'Webhook secret reference',
    ca_bundle_ref: 'CA bundle secret reference',
  };
  return labels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function profileCredentialFields(profile?: ConnectorAuthProfileItem | null): string[] {
  if (!profile) return [];
  return Array.from(new Set([...(profile.required_fields || []), ...(profile.optional_fields || [])]));
}

function isSecretReferenceField(field: string): boolean {
  return SECRET_REFERENCE_FIELD.test(field) || /(?:secret|token|api[_-]?key|private[_-]?key|password)/i.test(field);
}

function canonicalAuthProfileId(profileId: string, profiles: ConnectorAuthProfileItem[]): string {
  if (profileId === 'basic_api_token' && profiles.some(profile => profile.id === 'basic_auth')) return 'basic_auth';
  if (profileId === 'basic_auth' && profiles.some(profile => profile.id === 'basic_api_token')) return 'basic_api_token';
  return profileId;
}

function templateParameter<T>(template: ConnectorTemplateItem | undefined, name: string, fallback: T): T {
  const row = template?.shared_parameters?.find(parameter => parameter.variable_name === name);
  return (row?.active_value ?? row?.effective_value ?? row?.default_value ?? fallback) as T;
}

function configurationSnapshot(candidate: Record<string, unknown>): string {
  // Test timestamps and enablement are server evidence, not unsaved form edits.
  const connections = candidate.environment_connections as EnvironmentConnectionItem[] | undefined;
  return JSON.stringify({ ...candidate, environment_connections: connections?.map(environmentConnectionDraft) });
}

export const ConnectorInstanceEditor: React.FC<ConnectorInstanceEditorProps> = ({
  projectId,
  template,
  instance,
  availableEnvironments = [],
  principal,
  onSave,
  onCancel,
  readOnly = false,
  templateDefaults,
  templateDirty = false,
  onDirtyChange,
}) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const mcpMappingInput = useRef<HTMLTextAreaElement>(null);
  const [savedInstance, setSavedInstance] = useState(instance);
  const [instanceId] = useState(
    () =>
      instance?.instance_id ||
      `${(template?.system_name || 'connector').slice(0, 45)}-${crypto.randomUUID().slice(0, 8)}`
  );

  const isPlatformAdmin = Boolean(principal?.roles?.includes('PLATFORM_ADMIN'));

  // --------------------------------------------------------------------------
  // Mandatory Project-Owned Identity (Always Project-Owned & Editable)
  // --------------------------------------------------------------------------
  const [systemName, setSystemName] = useState<string>(
    instance?.system_name || instance?.definition_json?.system_name || template?.system_name || template?.name || ''
  );
  const [environmentDependency, setEnvironmentDependency] = useState<'' | 'dependent' | 'independent'>(
    instance?.environment_dependency ||
      instance?.definition_json?.environment_dependency ||
      (instance ? (instance.bindings && instance.bindings.length > 0 ? 'dependent' : 'independent') : 'independent')
  );
  const [toolEnvironment, setToolEnvironment] = useState<string>(
    instance?.tool_environment || instance?.definition_json?.tool_environment || 'Shared'
  );
  const [owner, setOwner] = useState<string>(
    instance?.owner || instance?.definition_json?.owner || principal?.subject || ''
  );
  const [description, setDescription] = useState<string>(
    instance?.description || instance?.definition_json?.description || template?.description || ''
  );
  const [tags, setTags] = useState<string[]>(() => {
    const raw = instance?.tags || instance?.definition_json?.tags;
    if (Array.isArray(raw)) return raw;
    return [];
  });
  const [newTagInput, setNewTagInput] = useState('');
  const [usage, setUsage] = useState<string[]>(
    instance?.usage || instance?.definition_json?.usage || []
  );

  // --------------------------------------------------------------------------
  // Authentication State (Truthful Active Profiles, env:// Secret References)
  // --------------------------------------------------------------------------
  const activeProfiles = useMemo(() => {
    const profiles = (template?.auth_profiles || []).filter(p => p.status === 'active');
    const nativeProfileIds = template?.native_auth_profile_ids;
    if (nativeProfileIds === undefined) return profiles;
    const available = new Set(nativeProfileIds);
    return profiles.filter(profile => available.has(profile.id));
  }, [template]);

  const initialAuthType = useMemo(() => {
    if (instance?.definition_json?.auth_type) {
      return canonicalAuthProfileId(instance.definition_json.auth_type, template?.auth_profiles || []);
    }
    return activeProfiles[0]?.id || '';
  }, [instance, activeProfiles, template]);

  const [authType, setAuthType] = useState<string>(initialAuthType);

  const initialAuthProfile = useMemo(
    () => (template?.auth_profiles || []).find(profile => profile.id === initialAuthType),
    [template, initialAuthType],
  );

  const selectedAuthProfile = useMemo(
    () => (template?.auth_profiles || []).find(profile => profile.id === authType) || null,
    [template, authType],
  );

  const selectedCredentialFields = useMemo(
    () => profileCredentialFields(selectedAuthProfile),
    [selectedAuthProfile],
  );

  const configuredEndpoint =
    template?.default_endpoint && !/[<>]/.test(template.default_endpoint)
      ? template.default_endpoint
      : '';
  const [endpoint, setEndpoint] = useState<string>(
    instance?.definition_json?.endpoint || configuredEndpoint || ''
  );

  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const raw = (instance?.definition_json?.credentials as Record<string, string>) || {};
    const initialFields = profileCredentialFields(initialAuthProfile);
    const allowed = new Set(initialFields);
    const configured = Object.fromEntries(
      Object.entries(raw).filter(([field]) => allowed.has(field)),
    );
    if (Object.keys(configured).length > 0) return configured;
    const defaultSecretField = initialFields.find(isSecretReferenceField);
    if (defaultSecretField && template?.default_secret) {
      return { [defaultSecretField]: template.default_secret };
    }
    return {};
  });

  const [serviceUser, setServiceUser] = useState<string>(
    instance?.definition_json?.service_user || template?.default_service_user || ''
  );

  // --------------------------------------------------------------------------
  // Scope, Filtering & Domain Custom Fields per docs/connector-forms.md
  // --------------------------------------------------------------------------
  const connectorType = template?.provider_adapter_id || template?.system_name || template?.type || 'generic';
  const endpointFieldLabel = connectorType === 'unix'
    ? 'SSH / SFTP Host'
    : connectorType === 'kafka'
      ? 'Kafka Broker List'
      : 'Service Endpoint URL';
  const endpointInputType = connectorType === 'unix' || connectorType === 'kafka' ? 'text' : 'url';
  const endpointPlaceholder = connectorType === 'unix'
    ? 'sftp://host:22'
    : connectorType === 'kafka'
      ? 'broker-1:9092,broker-2:9092'
      : 'https://service.example.internal/api';
  const endpointHint = connectorType === 'unix'
    ? 'SSH/SFTP host only. Credential material belongs in the selected profile secret references.'
    : connectorType === 'kafka'
      ? 'Comma-separated broker host:port values. Do not include credentials or query parameters.'
      : 'HTTPS service base URL. Credential tokens are strictly forbidden in URL endpoints.';

  // Jira-specific scope
  const [jiraProjectKey, setJiraProjectKey] = useState<string>(
    instance?.definition_json?.project_key || instance?.definition_json?.external_resource || (template?.default_config?.project_key as string) || ''
  );
  const [jiraIssueTypes, setJiraIssueTypes] = useState<string[]>(
    instance?.definition_json?.issue_types || []
  );
  const [attachmentProcessing, setAttachmentProcessing] = useState<'disabled' | 'local_upload'>(
    instance?.definition_json?.attachment_processing ?? templateParameter<'disabled' | 'local_upload'>(template, 'attachment_processing', 'disabled')
  );
  const [customFieldMappings, setCustomFieldMappings] = useState<CustomFieldRow[]>(() => {
    const mapping = instance?.definition_json?.custom_field_mapping ?? templateParameter(template, 'custom_field_mapping', {});
    if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) return Object.entries(mapping).map(([id, label]) => ({ sourceField: id, prismField: String(label), fieldType: 'string', required: false, defaultValue: '' }));
    const saved = instance?.definition_json?.custom_field_mappings;
    return Array.isArray(saved) ? saved : [];
  });

  // Splunk-specific scope
  const [splunkIndex, setSplunkIndex] = useState<string>(
    instance?.definition_json?.index || instance?.definition_json?.external_resource || (template?.default_config?.index as string) || ''
  );
  const [searchWindowSeconds, setSearchWindowSeconds] = useState<number>(
    instance?.definition_json?.max_window_seconds || instance?.definition_json?.search_window_seconds || 86400
  );

  // Confluence scope
  const [resourceScope, setResourceScope] = useState<string>(instance?.definition_json?.external_resource || instance?.definition_json?.scope || '');
  const [customJql, setCustomJql] = useState<string>(instance?.definition_json?.custom_jql ?? templateParameter(template, 'custom_jql', ''));
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState<string>(
    instance?.definition_json?.external_resource || instance?.definition_json?.space_key || ''
  );

  // Kafka scope
  const [kafkaTopics, setKafkaTopics] = useState<string[]>(
    instance?.definition_json?.topics || (instance?.definition_json?.topic ? [instance.definition_json.topic] : [])
  );

  // Unix scope
  const [unixLogPath, setUnixLogPath] = useState<string>(
    instance?.definition_json?.path || instance?.definition_json?.log_path || instance?.definition_json?.external_resource || ''
  );
  const [unixTailBytes, setUnixTailBytes] = useState<number>(
    instance?.definition_json?.max_tail_bytes || 32768
  );

  // Kubernetes scope
  const [k8sNamespace, setK8sNamespace] = useState<string>(
    instance?.definition_json?.namespace || instance?.definition_json?.external_resource || ''
  );

  // Environment Mappings for Environment Dependent mode
  const initialMappings = useMemo(() => {
    if (instance?.definition_json?.environment_mappings && instance.definition_json.environment_mappings.length > 0) {
      return instance.definition_json.environment_mappings.map(m => ({
        project_env_id: m.project_env_id,
        external_resource: m.external_resource,
        tool_environment: m.tool_environment,
        credential_binding: m.credential_binding || '',
        connection_id: (m as any).connection_id || '',
      }));
    }
    if (instance?.bindings && instance.bindings.length > 0) {
      return instance.bindings.map(b => ({
        project_env_id: b.project_env_id,
        external_resource: b.external_resource,
        tool_environment: b.tool_env_id || '',
        credential_binding: b.credential_binding_id || '',
        connection_id: b.connection_id || '',
      }));
    }
    return [];
  }, [instance]);

  const [environmentMappings, setEnvironmentMappings] = useState<
    Array<{
      project_env_id: string;
      external_resource: string;
      tool_environment: string;
      credential_binding?: string;
      connection_id?: string;
    }>
  >(initialMappings);

  // --------------------------------------------------------------------------
  // Environment connections (Repeatable records per environment)
  // --------------------------------------------------------------------------
  const [connections, setConnections] = useState<EnvironmentConnectionItem[]>(() => {
    if (instance?.environment_connections && instance.environment_connections.length > 0) {
      return instance.environment_connections;
    }
    return [];
  });
  const [testingConnId, setTestingConnId] = useState<string | null>(null);
  const [enablingConnId, setEnablingConnId] = useState<string | null>(null);
  const [editingConn, setEditingConn] = useState<Partial<EnvironmentConnectionItem> | null>(null);
  const [isConnModalOpen, setIsConnModalOpen] = useState(false);

  // --------------------------------------------------------------------------
  // Per-Operation Hybrid Routing & Tool Access Rules
  // --------------------------------------------------------------------------
  const defaultToolRules = useMemo<ToolAccessRuleItem[]>(() => {
    if (instance?.tool_access_rules && instance.tool_access_rules.length > 0) {
      return instance.tool_access_rules;
    }
    const ops = template?.supported_operations || [];
    return ops.map(op => ({
      tool_id: op,
      capability: template?.category || 'diagnostic',
      access_route: 'direct' as const,
      allowed_roles: [],
      allowed_environments: availableEnvironments.map(environment => environment.id),
    }));
  }, [instance, template, availableEnvironments]);

  const [toolAccessRules, setToolAccessRules] = useState<ToolAccessRuleItem[]>(defaultToolRules);

  // Sync backend connections on mount or saved instance change
  useEffect(() => {
    if (!savedInstance?.instance_id) return;
    let active = true;
    listEnvironmentConnections(projectId, savedInstance.instance_id)
      .then(conns => {
        if (active && Array.isArray(conns)) {
          setConnections(conns);
        }
      })
      .catch(error => { if (active) setActionError(error instanceof Error ? error.message : 'Unable to load environment connections.'); });
    return () => {
      active = false;
    };
  }, [projectId, savedInstance?.instance_id]);

  // Connection Handlers
  const handleTestConnectionRecord = async (conn: EnvironmentConnectionItem) => {
    setActionError(null);
    setActionSuccess(null);
    if (!savedInstance?.instance_id) {
      setActionError('Save this connector as a draft before testing individual environment connections.');
      return;
    }
    setTestingConnId(conn.connection_id);
    try {
      const res = await testEnvironmentConnection(projectId, savedInstance.instance_id, conn.connection_id);
      setConnections(await listEnvironmentConnections(projectId, savedInstance.instance_id));
      if (res.overall_result === 'PASSED') {
        setActionSuccess(`Connection '${conn.connection_name}' passed candidate test (${res.latency_ms}ms).`);
      } else {
        setActionError(`Connection '${conn.connection_name}' test failed: ${res.error_message || 'Diagnostic stages failed.'}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Connection test request failed.');
    } finally {
      setTestingConnId(null);
    }
  };

  const handleToggleConnectionEnabled = async (conn: EnvironmentConnectionItem) => {
    setActionError(null);
    setActionSuccess(null);
    const targetState = !conn.enabled;
    if (!savedInstance?.instance_id) {
      setActionError('Save and test this connection before enabling it.');
      return;
    }
    setEnablingConnId(conn.connection_id);
    try {
      const updated = await enableEnvironmentConnection(projectId, savedInstance.instance_id, conn.connection_id, targetState);
      setConnections(prev =>
        prev.map(c => (c.connection_id === conn.connection_id ? updated : c)),
      );
      setActionSuccess(`Connection '${conn.connection_name}' ${targetState ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update connection enabled status. Ensure passing test within last 15 minutes.');
    } finally {
      setEnablingConnId(null);
    }
  };

  const handleDeleteConnectionRecord = async (connectionId: string) => {
    setActionError(null);
    setActionSuccess(null);
    if (savedInstance?.instance_id) {
      try {
        await deleteEnvironmentConnection(projectId, savedInstance.instance_id, connectionId);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to delete connection.');
        return;
      }
    }
    setConnections(prev => prev.filter(c => c.connection_id !== connectionId));
    setEnvironmentMappings(prev =>
      prev.map(m => (m.connection_id === connectionId ? { ...m, connection_id: undefined } : m)),
    );
    setActionSuccess('Connection record deleted.');
  };

  const handleSaveConnectionRecord = async (newOrUpdated: Partial<EnvironmentConnectionItem>) => {
    setActionError(null);
    setActionSuccess(null);
    if (!newOrUpdated.environment_name?.trim() || !newOrUpdated.connection_name?.trim()) {
      setActionError('Enter a connection name and environment name.'); return;
    }
    if (mcpMappingInput.current && newOrUpdated.routing_mode !== 'direct') {
      try {
        const mapping: unknown = JSON.parse(mcpMappingInput.current.value);
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error();
        newOrUpdated = { ...newOrUpdated, mcp_configuration: { ...newOrUpdated.mcp_configuration, mcp_tools: mapping } };
      } catch { setActionError('MCP operation mapping must be a valid JSON object.'); return; }
    }
    const connId = newOrUpdated.connection_id || `conn-${crypto.randomUUID().slice(0, 8)}`;
    const fullRecord: EnvironmentConnectionItem = {
      connection_id: connId,
      connection_name: newOrUpdated.connection_name || `${systemName} ${newOrUpdated.environment_name || 'Connection'}`,
      environment_name: newOrUpdated.environment_name || '',
      enabled: false,
      status: 'draft',
      routing_mode: newOrUpdated.routing_mode || 'direct',
      auth_profile_id: newOrUpdated.auth_profile_id || authType,
      target: newOrUpdated.target || { endpoint },
      credentials: newOrUpdated.credentials || credentials,
      mcp_configuration: newOrUpdated.mcp_configuration || {},
      resource_scope: (newOrUpdated.resource_scope || []).map(value => value.trim()).filter(Boolean),
      test_status: 'not_tested',
      last_tested_at: null,
    };

    if (savedInstance?.instance_id) {
      try {
        const saved = await saveEnvironmentConnection(projectId, savedInstance.instance_id, fullRecord);
        setConnections(prev => {
          const idx = prev.findIndex(c => c.connection_id === connId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = saved;
            return next;
          }
          return [...prev, saved];
        });
        setActionSuccess(`Connection '${saved.connection_name}' saved.`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to save connection to backend.');
        return;
      }
    } else {
      setConnections(prev => {
        const idx = prev.findIndex(c => c.connection_id === connId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = fullRecord;
          return next;
        }
        return [...prev, fullRecord];
      });
      setActionSuccess(`Connection '${fullRecord.connection_name}' added to draft.`);
    }
    setIsConnModalOpen(false);
    setEditingConn(null);
  };

  // --------------------------------------------------------------------------
  // Operations & Bounds (1 <= timeout_seconds <= 120 per candidate_testing.py)
  // --------------------------------------------------------------------------
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(
    instance?.definition_json?.timeout_seconds ?? templateParameter(template, 'timeout_seconds', template?.default_timeout_seconds || 30)
  );
  const [maxResults, setMaxResults] = useState<number>(
    instance?.definition_json?.max_results ||
      (typeof template?.default_config?.max_results === 'number' ? template.default_config.max_results : 100)
  );
  const [rateLimit] = useState<string>(
    instance?.definition_json?.rate_limit || template?.default_rate_limit || 'Not configured'
  );
  const [retryAttempts] = useState<number | string>(
    instance?.definition_json?.retry_attempts ?? template?.default_retry_attempts ?? 'Not configured'
  );

  // --------------------------------------------------------------------------
  // Testing, Gate Status & Persistence State
  // --------------------------------------------------------------------------
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<CandidateTestResponse | null>(null);
  const [testedSnapshot, setTestedSnapshot] = useState('');
  const [candidateHash, setCandidateHash] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Policy-blocked check (e.g. Oracle execution disallowed)
  const isPolicyBlocked = useMemo(() => {
    return (
      template?.availability === 'disabled_by_policy' ||
      (template?.availability !== undefined && !['published', 'active'].includes(template.availability)) ||
      template?.is_enabled_by_policy === false ||
      template?.system_name === 'oracle' ||
      instance?.template_id === 'oracle'
    );
  }, [template, instance]);

  // --------------------------------------------------------------------------
  // Candidate Payload Builder
  // --------------------------------------------------------------------------
  const currentCandidate = useMemo(() => {
    const effectiveBindings =
      environmentDependency === 'dependent'
        ? environmentMappings.map(m => ({
            project_env_id: m.project_env_id,
            tool_env_id: m.tool_environment,
            external_resource: m.external_resource,
            credential_binding_id: m.credential_binding || undefined,
            connection_id: m.connection_id || undefined,
            status: 'active' as const,
          }))
        : [];

    return {
      ...savedInstance?.definition_json,
      instance_id: instanceId,
      template_id: template?.template_id || template?.system_name || savedInstance?.template_id || '',
      template_version: template?.version || savedInstance?.template_version || '1.0.0',
      system_name: systemName.trim(),
      environment_dependency: environmentDependency,
      tool_environment: toolEnvironment.trim(),
      endpoint: endpoint.trim(),
      auth_type: authType,
      credentials,
      service_user: serviceUser,
      timeout_seconds: Number(timeoutSeconds),
      max_results: Number(maxResults),
      external_resource: connectorType === 'itsm' ? jiraProjectKey : connectorType === 'log_search' ? splunkIndex : connectorType === 'confluence' ? confluenceSpaceKey : connectorType === 'kafka' ? (kafkaTopics[0] || '') : connectorType === 'unix' ? unixLogPath : connectorType === 'kubernetes' ? k8sNamespace : resourceScope,
      custom_jql: customJql,
      max_window_seconds: searchWindowSeconds,
      path: unixLogPath,
      topic: kafkaTopics[0] || '',
      project_key: jiraProjectKey,
      issue_types: jiraIssueTypes,
      attachment_processing: attachmentProcessing,
      custom_field_mapping: Object.fromEntries(customFieldMappings.map(field => [field.sourceField, field.prismField])),
      custom_field_mappings: customFieldMappings,
      index: splunkIndex,
      search_window_seconds: searchWindowSeconds,
      space_key: confluenceSpaceKey,
      topics: kafkaTopics,
      log_path: unixLogPath,
      max_tail_bytes: unixTailBytes,
      namespace: k8sNamespace,
      owner,
      description,
      tags,
      usage,
      bindings: effectiveBindings,
      environment_mappings: environmentMappings,
      environment_connections: connections,
      tool_access_rules: toolAccessRules,
    };
  }, [
    instanceId,
    template,
    savedInstance,
    systemName,
    environmentDependency,
    toolEnvironment,
    endpoint,
    authType,
    credentials,
    serviceUser,
    timeoutSeconds,
    maxResults,
    jiraProjectKey,
    connectorType,
    resourceScope,
    customJql,
    jiraIssueTypes,
    attachmentProcessing,
    customFieldMappings,
    splunkIndex,
    searchWindowSeconds,
    confluenceSpaceKey,
    kafkaTopics,
    unixLogPath,
    unixTailBytes,
    k8sNamespace,
    owner,
    description,
    tags,
    usage,
    environmentMappings,
    connections,
    toolAccessRules,
  ]);

  // Track Candidate Hash & Validation
  useEffect(() => {
    let active = true;
    validateConnectorCandidate(currentCandidate)
      .then(res => {
        if (active) {
          setCandidateHash(res.candidate_hash);
        }
      })
      .catch(() => {
        // Incomplete drafts may have partial validation
      });
    return () => {
      active = false;
    };
  }, [currentCandidate]);

  const [savedSnapshot, setSavedSnapshot] = useState(() => configurationSnapshot(currentCandidate));
  const isDirty = configurationSnapshot(currentCandidate) !== savedSnapshot;
  useEffect(() => { onDirtyChange?.(isDirty || isConnModalOpen); }, [isDirty, isConnModalOpen, onDirtyChange]);
  const visibleTestResult = testedSnapshot === configurationSnapshot(currentCandidate) ? testResult : null;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  // --------------------------------------------------------------------------
  // Governance Helper
  // --------------------------------------------------------------------------
  const getFieldTier = (fieldName: string): GovernanceTier => {
    const aliases: Record<string, string> = { project_key: 'external_resource', index: 'external_resource', space_key: 'external_resource', topics: 'external_resource', path: 'external_resource', namespace: 'external_resource', custom_field_mappings: 'custom_field_mapping', search_window_seconds: 'max_window_seconds' };
    const name = aliases[fieldName] || fieldName;
    const policy = template?.field_governance?.find(field => field.variable_name === name);
    if (policy) return policy.tier;
    const pf = template?.parameter_fields?.find(f => f.variable_name === fieldName);
    return getFieldGovernanceTier(pf);
  };

  const isFieldLocked = (fieldName: string): boolean => {
    if (isPlatformAdmin) return false;
    if (['endpoint', 'credentials', 'auth_type', 'mcp_configuration', 'access_mode'].includes(fieldName)) return true;
    const tier = getFieldTier(fieldName);
    return tier === 'project_locked' || tier === 'platform_only';
  };

  const renderGovernanceBadge = (fieldName: string) => {
    const tier = getFieldTier(fieldName);
    if (tier === 'platform_only') {
      return (
        <span className="prism-gov-badge platform-only" title="Platform Only — Invisible to standard project users">
          <Shield size={10} /> Platform Only
        </span>
      );
    }
    if (tier === 'project_locked') {
      return (
        <span className="prism-gov-badge project-locked" title="Locked by Platform — Inherited & read-only for project users">
          <Lock size={10} /> Project Non-Editable
        </span>
      );
    }
    return (
      <span className="prism-gov-badge project-editable" title="Project Editable — Overridable in project setup">
        <Check size={10} /> Project Editable
      </span>
    );
  };

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------
  const handleAddTag = () => {
    if (newTagInput.trim() && !tags.includes(newTagInput.trim())) {
      setTags([...tags, newTagInput.trim().toLowerCase()]);
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleAuthProfileChange = (profileId: string) => {
    setAuthType(profileId);
    const nextProfile = (template?.auth_profiles || []).find(profile => profile.id === profileId);
    const allowed = new Set(profileCredentialFields(nextProfile));
    setCredentials(previous =>
      Object.fromEntries(Object.entries(previous).filter(([field]) => allowed.has(field))),
    );
  };

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setActionError(null);
    setActionSuccess(null);
    if (isConnModalOpen) { setActionError('Save or close the environment connection form before saving this project connection.'); return; }
    if (templateDirty) { setActionError('Save or discard shared template changes before saving this project connection.'); return; }
    if (isPolicyBlocked) {
      setActionError('This connector cannot be saved under the current platform policy or template lifecycle.');
      return;
    }
    if (customFieldMappings.some(field => !/^customfield_[0-9]{1,12}$/.test(field.sourceField) || !field.prismField.trim()) || new Set(customFieldMappings.map(field => field.sourceField)).size !== customFieldMappings.length || new Set(customFieldMappings.map(field => field.prismField.trim().toLowerCase())).size !== customFieldMappings.length) {
      setActionError('Each field mapping needs a verified customfield_ ID and a unique evidence label. Duplicate IDs are not allowed.'); return;
    }
    setSaving(true);
    try {
      const saved = await saveProjectConnector(projectId, {
        instance_id: instanceId,
        template_id: template?.template_id || template?.system_name || savedInstance?.template_id || '',
        template_version: template?.version || savedInstance?.template_version || '1.0.0',
        system_name: isFieldLocked('system_name') ? undefined : systemName.trim(),
        environment_dependency: isFieldLocked('environment_dependency') ? undefined : environmentDependency === '' ? 'independent' : environmentDependency,
        tool_environment: isFieldLocked('tool_environment') ? undefined : toolEnvironment.trim(),
        status: 'draft',
        expected_revision: savedInstance?.revision || 0,
        definition: isPlatformAdmin ? currentCandidate : Object.fromEntries(Object.entries(currentCandidate).filter(([key]) =>
          !['endpoint', 'credentials', 'auth_type', 'mcp_configuration', 'access_mode', 'environment_connections', 'service_user'].includes(key) && !isFieldLocked(key))),
        bindings: isFieldLocked('bindings') ? undefined : currentCandidate.bindings || [],
        ...(isPlatformAdmin ? { environment_connections: connections.map(environmentConnectionDraft) } : {}),
        tool_access_rules: toolAccessRules,
      });
      setSavedInstance(saved);
      setConnections(saved.environment_connections || []);
      setSavedSnapshot(configurationSnapshot({ ...currentCandidate, environment_connections: saved.environment_connections || [] }));
      setActionSuccess('Configuration saved successfully.');
      if (onSave) onSave(saved);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save connector configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setActionError(null);
    setActionSuccess(null);
    if (!savedInstance) {
      setActionError('Save this connector as a draft before testing its connection.');
      return;
    }
    setTesting(true);
    try {
      if (isDirty) throw new Error('Save your changes before testing the connection.');
      const res = await testSavedProjectConnector(projectId, savedInstance.instance_id);
      setTestResult(res);
      setTestedSnapshot(configurationSnapshot(currentCandidate));
      if (res.overall_result === 'PASSED') {
        setActionSuccess(`Connection test passed (${res.latency_ms}ms) across target environments.`);
      } else {
        setActionError(res.error_message || 'Connection test did not pass all diagnostic checks.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Connection test request failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleToggleInstance = async () => {
    if (!savedInstance || isDirty) return;
    setSaving(true); setActionError(null); setActionSuccess(null);
    try {
      const saved = await (savedInstance.enabled ? disableProjectConnector : enableProjectConnector)(projectId, savedInstance.instance_id);
      setSavedInstance(saved);
      setActionSuccess(saved.enabled ? 'Connection enabled.' : 'Connection disabled.');
      onSave?.(saved);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to update connection status.'); }
    finally { setSaving(false); }
  };

  const handleResetDefaults = () => {
    setResourceScope(savedInstance?.definition_json?.external_resource || savedInstance?.definition_json?.scope || '');
    setCustomJql(savedInstance?.definition_json?.custom_jql || template?.default_config?.custom_jql || '');
    const saved = savedInstance?.definition_json;
    setSystemName(savedInstance?.system_name || template?.system_name || template?.name || '');
    setEnvironmentDependency(savedInstance?.environment_dependency || 'independent');
    setToolEnvironment(savedInstance?.tool_environment || 'Shared');
    setOwner(savedInstance?.owner || saved?.owner || principal?.subject || '');
    setDescription(savedInstance?.description || saved?.description || template?.description || '');
    setTags(savedInstance?.tags || saved?.tags || []);
    setUsage(savedInstance?.usage || saved?.usage || []);
    const resetAuthType = canonicalAuthProfileId(saved?.auth_type || initialAuthType, template?.auth_profiles || []);
    const resetProfile = (template?.auth_profiles || []).find(profile => profile.id === resetAuthType);
    const resetFields = profileCredentialFields(resetProfile);
    const resetAllowed = new Set(resetFields);
    const savedCredentials = (saved?.credentials as Record<string, string>) || {};
    const resetCredentials = Object.fromEntries(
      Object.entries(savedCredentials).filter(([field]) => resetAllowed.has(field)),
    );
    if (Object.keys(resetCredentials).length === 0) {
      const defaultSecretField = resetFields.find(isSecretReferenceField);
      if (defaultSecretField && template?.default_secret) resetCredentials[defaultSecretField] = template.default_secret;
    }
    setAuthType(resetAuthType);
    setEndpoint(saved?.endpoint || configuredEndpoint);
    setCredentials(resetCredentials);
    setServiceUser(saved?.service_user || template?.default_service_user || '');
    setJiraProjectKey(saved?.project_key || (template?.default_config?.project_key as string) || '');
    setJiraIssueTypes(saved?.issue_types || []);
    setAttachmentProcessing(saved?.attachment_processing || 'disabled');
    setCustomFieldMappings(saved?.custom_field_mappings || []);
    setSplunkIndex(saved?.index || (template?.default_config?.index as string) || '');
    setSearchWindowSeconds(saved?.search_window_seconds || 86400);
    setConfluenceSpaceKey(saved?.space_key || '');
    setKafkaTopics(saved?.topics || []);
    setUnixLogPath(saved?.log_path || '');
    setUnixTailBytes(saved?.max_tail_bytes || 32768);
    setK8sNamespace(saved?.namespace || '');
    setEnvironmentMappings(saved?.environment_mappings || initialMappings);
    setTimeoutSeconds(saved?.timeout_seconds ?? templateParameter(template, 'timeout_seconds', template?.default_timeout_seconds || 30));
    setMaxResults(saved?.max_results || (typeof template?.default_config?.max_results === 'number' ? template.default_config.max_results : 100));
    setConnections(savedInstance?.environment_connections || []);
    setToolAccessRules(savedInstance?.tool_access_rules || defaultToolRules);
    setActionError(null);
    setActionSuccess('Form restored to saved or template values.');
  };

  return (
    <div className="prism-connector-container" role="region" aria-label="Connector Configuration Studio">
      {/* ====================================================================
          1. HEADER: Title, Breadcrumbs, Status, Project Scope & Env Display
          ==================================================================== */}
      <header className="prism-header">
        <div className="prism-header-main">
          <div className="prism-breadcrumbs">
            <span>Connectors</span>
            <span className="sep">/</span>
            <span>{template?.category || 'Integrations'}</span>
            <span className="sep">/</span>
            <span className="active-crumb">{template?.name || systemName}</span>
          </div>

          <div className="prism-title-row">
            <div className="prism-icon-badge">
              <Database size={20} />
            </div>
            <div>
              <h2 className="prism-title">
                {systemName || template?.name || 'Connector Configuration'}
                <span className={`prism-status-pill ${savedInstance?.status === 'enabled' ? 'active' : 'draft'}`}>
                  <span className="dot" />
                  {savedInstance?.status || 'draft'}
                </span>
                {isPolicyBlocked && (
                  <span className="prism-status-pill policy-blocked">
                    <ShieldAlert size={11} /> Unavailable for project setup
                  </span>
                )}
              </h2>
              <p className="prism-subtitle">
                Configure connection, authentication, scope, and investigation settings for {template?.name || 'this connector'}.
              </p>
            </div>
          </div>
        </div>

        <div className="prism-header-controls">
          <div className="prism-scope-pill" title="Server-authenticated project scope">
            <ShieldCheck size={12} />
            <span>Scope: <b>{projectId}</b></span>
          </div>

          <div className="prism-env-badge" title="Selected runtime environment">
            <Globe size={12} />
            <span>Env: <b>{toolEnvironment || 'Shared'}</b></span>
          </div>

          <span className="prism-scope-pill">{template?.protocol || 'Connector'} · v{template?.version || '1.0.0'}</span>
        </div>
      </header>

      {/* ====================================================================
          2. HORIZONTAL SECTION NAVIGATION TABS (Connection, Auth, Scope, Ops, Test)
          ==================================================================== */}
      {/* Banner Notifications */}
      {actionError && (
        <div className="prism-alert-banner error" role="alert">
          <AlertCircle size={15} />
          <span>{actionError}</span>
        </div>
      )}
      {actionSuccess && (
        <div className="prism-alert-banner success" role="status">
          <CheckCircle2 size={15} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* ====================================================================
          3. TWO-COLUMN RESPONSIVE SRE CARD GRID
          ==================================================================== */}
      <div className="prism-content-grid">
        {/* ------------------------------------------------------------------
            LEFT COLUMN: Connection, Authentication, Scope & Field Mapping
            ------------------------------------------------------------------ */}
        <div className="prism-grid-col">
          {/* Card 1: Basic Information & Project Identity */}
          {(
            <section className="prism-card" id="section-connection">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Tag size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Basic Information</h2>
                    <p className="prism-card-desc">Name, target, ownership, and environment settings for this project connection.</p>
                  </div>
                </div>
                <div className="prism-brand-tag">
                  {template?.category || 'Core Service'}
                </div>
              </div>

              <div className="prism-card-body">
                <div className="prism-form-grid">
                  {/* System Name (Mandatory Project-Only) */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('system_name') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="system-name-input" className="prism-field-label">
                        System Name <span className="req">*</span>
                      </label>
                      {renderGovernanceBadge('system_name')}
                    </div>
                    <input
                      id="system-name-input"
                      type="text"
                      className="prism-input"
                      disabled={readOnly || isFieldLocked('system_name')} value={systemName}
                      onChange={e => setSystemName(e.target.value)}
                      placeholder={template?.name || 'e.g. Jira Triage Service'}

                      maxLength={128}
                      required
                    />
                    <span className="prism-field-hint">Project-owned runtime identity. Persisted independently of template renames.</span>
                  </div>

                  {/* Connector Type (Template-Derived) */}
                  <div className="prism-field-group">
                    <div className="prism-field-header">
                      <label className="prism-field-label">Connector Type</label>
                      <span className="prism-gov-badge project-locked"><Lock size={10} /> Platform Managed</span>
                    </div>
                    <input
                      type="text"
                      className="prism-input locked"
                      value={`${template?.name || 'Standard'} (${template?.protocol || 'HTTPS'})`}
                      readOnly
                      disabled
                    />
                  </div>

                  {/* Endpoint URL */}
                  <div className="prism-field-group full-width" hidden={!isPlatformAdmin && getFieldTier('endpoint') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="endpoint-url" className="prism-field-label">
                        {endpointFieldLabel} <span className="req">*</span>
                      </label>
                      {renderGovernanceBadge('endpoint')}
                    </div>
                    <input
                      id="endpoint-url"
                      type={endpointInputType}
                      className="prism-input mono"
                      disabled={readOnly || isFieldLocked('endpoint')} value={endpoint}
                      onChange={e => setEndpoint(e.target.value)}
                      placeholder={endpointPlaceholder}

                      required
                    />
                    <span className="prism-field-hint">{endpointHint}</span>
                  </div>

                  {/* Environment Dependency Segmented Control */}
                  <div className="prism-field-group full-width">
                    <div className="prism-field-header">
                      <label className="prism-field-label">
                        Environment Dependency <span className="req">*</span>
                      </label>
                      {renderGovernanceBadge('environment_dependency')}
                    </div>
                    <div className="prism-toggle-group">
                      <button
                        type="button"
                        className={`prism-toggle-btn ${environmentDependency === 'independent' ? 'active' : ''}`}
                        onClick={() => setEnvironmentDependency('independent')}
                        disabled={readOnly || isFieldLocked('environment_dependency')}
                      >
                        Environment Independent (Shared target)
                      </button>
                      <button
                        type="button"
                        className={`prism-toggle-btn ${environmentDependency === 'dependent' ? 'active' : ''}`}
                        onClick={() => setEnvironmentDependency('dependent')}
                        disabled={readOnly || isFieldLocked('environment_dependency')}
                      >
                        Environment Dependent (Mapped per env)
                      </button>
                    </div>
                    <span className="prism-field-hint">
                      {environmentDependency === 'dependent'
                        ? 'Connects to distinct external resources per project environment (prod, staging, dev).'
                        : 'Single shared external resource utilized across all project investigations.'}
                    </span>
                  </div>

                  {/* Tool Environment */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('tool_environment') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="tool-env-input" className="prism-field-label">
                        Tool Environment <span className="req">*</span>
                      </label>
                      {renderGovernanceBadge('tool_environment')}
                    </div>
                    <input
                      id="tool-env-input"
                      type="text"
                      className="prism-input"
                      disabled={readOnly || isFieldLocked('tool_environment')} value={toolEnvironment}
                      onChange={e => setToolEnvironment(e.target.value)}
                      placeholder={environmentDependency === 'independent' ? 'Shared' : 'e.g. AWS-Production'}

                      maxLength={128}
                      required
                    />
                  </div>

                  {/* Owner */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('owner') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="owner-input" className="prism-field-label">Owner</label>
                      {renderGovernanceBadge('owner')}
                    </div>
                    <input
                      id="owner-input"
                      type="text"
                      className="prism-input"
                      disabled={readOnly || isFieldLocked('owner')} value={owner}
                      onChange={e => setOwner(e.target.value)}
                      placeholder="e.g. SRE Platform Team"

                    />
                  </div>

                  {/* Description */}
                  <div className="prism-field-group full-width" hidden={!isPlatformAdmin && getFieldTier('description') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="desc-input" className="prism-field-label">Description</label>
                      {renderGovernanceBadge('description')}
                    </div>
                    <textarea
                      id="desc-input"
                      className="prism-textarea"
                      rows={2}
                      disabled={readOnly || isFieldLocked('description')} value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe what this connector is used for in this project..."

                    />
                  </div>

                  {/* Tags with Interactive Chip Management */}
                  <div className="prism-field-group full-width" hidden={!isPlatformAdmin && getFieldTier('tags') === 'platform_only'}>
                    <label className="prism-field-label">Tags</label>
                    <div className="prism-chip-wrap">
                      {tags.map(t => (
                        <span key={t} className="prism-chip">
                          {t}
                          {!readOnly && !isFieldLocked('tags') && (
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(t)}
                              className="prism-chip-remove"
                              aria-label={`Remove tag ${t}`}
                            >
                              <X size={11} />
                            </button>
                          )}
                        </span>
                      ))}
                      {!readOnly && !isFieldLocked('tags') && (
                        <div className="prism-chip-input-wrap">
                          <input
                            type="text"
                            value={newTagInput}
                            onChange={e => setNewTagInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddTag();
                              }
                            }}
                            placeholder="Add tag..."
                            className="prism-chip-input"
                          />
                          <button
                            type="button"
                            onClick={handleAddTag}
                            className="prism-chip-add-btn"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Card 2: Authentication (Supported Active Profiles Only, env:// Secrets) */}
          {(
            <section className="prism-card" id="section-authentication">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Key size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Authentication</h2>
                    <p className="prism-card-desc">Supported credential references and secure provider protocols.</p>
                  </div>
                </div>
                <div className="prism-card-action">
                  {visibleTestResult?.overall_result === 'PASSED' ? (
                    <span className="prism-badge-configured"><CheckCircle2 size={12} /> Verified</span>
                  ) : (
                    <span className="prism-badge-unverified"><Clock size={12} /> Unverified</span>
                  )}
                </div>
              </div>

              <div className="prism-card-body">
                {/* Supported Auth Profiles */}
                {(isPlatformAdmin || getFieldTier('auth_type') !== 'platform_only') && <ConnectorAuthProfilesCard
                  authProfiles={template?.auth_profiles || []}
                  selectedProfileId={authType}
                  onSelectProfile={handleAuthProfileChange}
                  connectorType={connectorType}
                  selectableProfileIds={template?.native_auth_profile_ids}
                  readOnly={readOnly || !isPlatformAdmin}
                />}

                <div className="prism-form-grid" style={{ marginTop: '14px' }}>
                  {/* Credential fields are declared by the selected profile. */}
                  {selectedCredentialFields.length > 0 ? selectedCredentialFields.filter(field => isPlatformAdmin || (getFieldTier('credentials') !== 'platform_only' && getFieldTier(field) !== 'platform_only')).map(field => {
                    const required = selectedAuthProfile?.required_fields?.includes(field) || false;
                    const secretReference = isSecretReferenceField(field);
                    const fieldId = `credential-${field}`;
                    return (
                      <div className="prism-field-group" key={field}>
                        <div className="prism-field-header">
                          <label htmlFor={fieldId} className="prism-field-label">
                            {credentialFieldLabel(field)} {required && <span className="req">*</span>}
                          </label>
                          {renderGovernanceBadge(field)}
                        </div>
                        <input
                          id={fieldId}
                          type="text"
                          className={`prism-input ${secretReference ? 'mono' : ''}`}
                          value={credentials[field] || ''}
                          onChange={e => handleCredentialChange(field, e.target.value)}
                          placeholder={secretReference ? 'env://SECRET_NAME' : credentialFieldLabel(field)}
                          pattern={secretReference ? 'env://[A-Z][A-Z0-9_]{0,127}' : undefined}
                          autoComplete="off"
                          disabled={readOnly || !isPlatformAdmin}
                          required={required}
                        />
                        <span className="prism-field-hint">
                          {secretReference
                            ? 'References a deployment environment secret. Plaintext credentials are never saved or revealed.'
                            : `Declared by the ${selectedAuthProfile?.name || authType} profile.`}
                        </span>
                      </div>
                    );
                  }) : (
                    <div className="prism-empty-state full-width">
                      <Info size={14} /> No credential fields are declared for the selected authentication profile.
                    </div>
                  )}
                </div>

                {/* Inline Live Test Connection Status Bar */}
                <div className="prism-test-connection-strip">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestConnection}
                    disabled={testing || saving || readOnly || isPolicyBlocked || !savedInstance || isDirty}
                  >
                    {testing ? <RefreshCw size={13} className="spin" /> : <Activity size={13} />}
                    <span>{testing ? 'Testing Reachability...' : 'Test Connection'}</span>
                  </button>

                  <div className="prism-test-result-indicator">
                    {visibleTestResult?.overall_result === 'PASSED' ? (
                      <span className="prism-test-success">
                        <CheckCircle2 size={13} />
                        <span>Connection successful ({visibleTestResult.latency_ms}ms)</span>
                      </span>
                    ) : visibleTestResult?.overall_result === 'FAILED' ? (
                      <span className="prism-test-failure">
                        <AlertTriangle size={13} />
                        <span>Verification failed</span>
                      </span>
                    ) : (
                      <span className="prism-test-idle">
                        <Clock size={13} />
                        <span>Connection not tested in this session</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Card: Environment connections */}
          {(
            <section className="prism-card" id="section-environments" hidden={!isPlatformAdmin && getFieldTier('environment_connections') === 'platform_only'}>
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Server size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Environment connections</h2>
                    <p className="prism-card-desc">
                      Independent connection profiles with distinct targets, credentials, routing modes, and reachability tests per environment.
                    </p>
                  </div>
                </div>
                {isPlatformAdmin && !readOnly && !isConnModalOpen && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setEditingConn({
                        connection_id: `conn-${crypto.randomUUID().slice(0, 8)}`,
                        connection_name: `${systemName || 'Connector'} Connection`,
                        environment_name: availableEnvironments[0]?.name || availableEnvironments[0]?.id || '',
                        routing_mode: 'direct',
                        auth_profile_id: authType,
                        target: { endpoint },
                        credentials: { ...credentials },
                        enabled: false,
                        test_status: 'NOT_RUN',
                      });
                      setIsConnModalOpen(true);
                    }}
                  >
                    <Plus size={12} /> Add Environment Connection
                  </button>
                )}
              </div>

              <div className="prism-card-body">
                {/* Modal / Inline Connection Editor Form */}
                {isConnModalOpen && editingConn && (
                  <div className="prism-conn-form-card" role="region" aria-label="Connection Form">
                    <div className="prism-conn-form-header">
                      <div className="prism-conn-form-title">
                        <Server size={14} />
                        <span>{editingConn.connection_id ? `Configure Connection: ${editingConn.connection_name || editingConn.connection_id}` : 'New Environment Connection'}</span>
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => {
                          setIsConnModalOpen(false);
                          setEditingConn(null);
                        }}
                        aria-label="Close form"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="prism-form-grid">
                      <div className="prism-field-group">
                        <label className="prism-field-label" htmlFor="env-connection-name">Connection Name <span className="req">*</span></label>
                        <input id="env-connection-name"
                          type="text"
                          className="prism-input"
                          value={editingConn.connection_name || ''}
                          onChange={e => setEditingConn({ ...editingConn, connection_name: e.target.value })}
                          placeholder="e.g. Production Primary Jira"
                          required
                        />
                      </div>

                      <div className="prism-field-group">
                        <label className="prism-field-label" htmlFor="env-connection-environment">Target Environment <span className="req">*</span></label>
                        <input id="env-connection-environment"
                          type="text"
                          className="prism-input"
                          list="available-envs-list"
                          value={editingConn.environment_name || ''}
                          onChange={e => setEditingConn({ ...editingConn, environment_name: e.target.value })}
                          placeholder="e.g. prod, staging, dev"
                          required
                        />
                        <datalist id="available-envs-list">
                          {availableEnvironments.map(env => (
                            <option key={env.id} value={env.id}>{env.name || env.id}</option>
                          ))}
                        </datalist>
                      </div>

                      <div className="prism-field-group full-width">
                        <label className="prism-field-label">Routing Mode <span className="req">*</span></label>
                        <div className="prism-toggle-group">
                          <button
                            type="button"
                            className={`prism-toggle-btn ${editingConn.routing_mode === 'direct' ? 'active' : ''}`}
                            onClick={() => setEditingConn({ ...editingConn, routing_mode: 'direct' })}
                          >
                            Direct (Native REST/SDK)
                          </button>
                          <button
                            type="button"
                            className={`prism-toggle-btn ${editingConn.routing_mode === 'mcp' ? 'active' : ''}`}
                            onClick={() => setEditingConn({ ...editingConn, routing_mode: 'mcp' })}
                          >
                            MCP (Model Context Protocol)
                          </button>
                          <button
                            type="button"
                            className={`prism-toggle-btn ${editingConn.routing_mode === 'hybrid' ? 'active' : ''}`}
                            onClick={() => setEditingConn({ ...editingConn, routing_mode: 'hybrid' })}
                          >
                            Hybrid (Split Direct &amp; MCP)
                          </button>
                        </div>
                        <span className="prism-field-hint">
                          {editingConn.routing_mode === 'direct'
                            ? 'Connects directly using built-in read-only provider adapters.'
                            : editingConn.routing_mode === 'mcp'
                              ? 'Routes all tool invocations through a standard Model Context Protocol server.'
                              : 'Splits execution: some operations route via native direct while others route via MCP.'}
                        </span>
                      </div>

                      <div className="prism-field-group full-width">
                        <label className="prism-field-label" htmlFor="env-connection-auth">Authentication Profile <span className="req">*</span></label>
                        <select id="env-connection-auth"
                          className="prism-select"
                          value={editingConn.auth_profile_id || authType}
                          onChange={e => {
                            const pId = e.target.value;
                            const prof = (template?.auth_profiles || []).find(p => p.id === pId);
                            const allowedFields = profileCredentialFields(prof);
                            const prevCreds = editingConn.credentials || {};
                            const nextCreds = Object.fromEntries(
                              Object.entries(prevCreds).filter(([k]) => allowedFields.includes(k))
                            );
                            setEditingConn({
                              ...editingConn,
                              auth_profile_id: pId,
                              credentials: nextCreds,
                            });
                          }}
                        >
                          {activeProfiles.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.transport_compatibility || 'HTTPS'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="prism-field-group full-width">
                        <label className="prism-field-label">Target Endpoint / URL <span className="req">*</span></label>
                        <input
                          type={endpointInputType}
                          className="prism-input mono"
                          value={editingConn.target?.endpoint || ''}
                          onChange={e =>
                            setEditingConn({
                              ...editingConn,
                              target: { ...(editingConn.target || {}), endpoint: e.target.value },
                            })
                          }
                          placeholder={endpointPlaceholder}
                        />
                        <span className="prism-field-hint">Environment-specific service URL. Secrets and tokens are strictly forbidden in URL endpoints.</span>
                      </div>

                      {/* Credentials Configuration for Selected Profile */}
                      {profileCredentialFields(
                        (template?.auth_profiles || []).find(p => p.id === (editingConn.auth_profile_id || authType))
                      ).map(field => {
                        const isSecret = isSecretReferenceField(field);
                        return (
                          <div key={field} className="prism-field-group">
                            <label className="prism-field-label">
                              {credentialFieldLabel(field)}
                              {isSecret && <span className="prism-gov-badge project-locked"><Lock size={10} /> Secret Ref</span>}
                            </label>
                            <input
                              type={isSecret ? 'password' : 'text'}
                              className="prism-input mono"
                              value={editingConn.credentials?.[field] || ''}
                              onChange={e => {
                                const nextCreds = { ...(editingConn.credentials || {}), [field]: e.target.value };
                                setEditingConn({ ...editingConn, credentials: nextCreds });
                              }}
                              placeholder={isSecret ? 'env://SECRET_VAR_NAME' : `e.g. ${field}`}
                            />
                            {isSecret && (
                              <span className="prism-field-hint">Use an approved environment variable reference (env://NAME).</span>
                            )}
                          </div>
                        );
                      })}

                      <div className="prism-field-group full-width">
                        <label className="prism-field-label" htmlFor="connection-resource-scope">Allowed resources</label>
                        <textarea id="connection-resource-scope" className="prism-input" rows={3}
                          value={(editingConn.resource_scope || []).join('\n')}
                          onChange={event => setEditingConn({ ...editingConn, resource_scope: event.target.value.split('\n') })} />
                        <span className="prism-field-hint">One project, index, namespace, topic or path per line. Environment assignments must use one of these resources.</span>
                      </div>
                      {(editingConn.routing_mode === 'mcp' || editingConn.routing_mode === 'hybrid') && <>
                        <div className="prism-field-group">
                          <label className="prism-field-label" htmlFor="connection-mcp-endpoint">MCP endpoint</label>
                          <input id="connection-mcp-endpoint" type="url" className="prism-input" value={editingConn.mcp_configuration?.endpoint || ''}
                            onChange={event => setEditingConn({ ...editingConn, mcp_configuration: { ...editingConn.mcp_configuration, endpoint: event.target.value } })} />
                        </div>
                        <div className="prism-field-group">
                          <label className="prism-field-label" htmlFor="connection-mcp-token">MCP token reference</label>
                          <input id="connection-mcp-token" className="prism-input" placeholder="env://MCP_TOKEN" value={editingConn.mcp_configuration?.token_secret_ref || ''}
                            onChange={event => setEditingConn({ ...editingConn, mcp_configuration: { ...editingConn.mcp_configuration, token_secret_ref: event.target.value } })} />
                        </div>
                        <div className="prism-field-group full-width">
                          <label className="prism-field-label" htmlFor="connection-mcp-tools">MCP operation mapping (JSON)</label>
                          <textarea ref={mcpMappingInput} id="connection-mcp-tools" className="prism-input mono" rows={5} defaultValue={JSON.stringify(editingConn.mcp_configuration?.mcp_tools || {}, null, 2)}
                            onBlur={event => { try { const mapping = JSON.parse(event.target.value); setEditingConn({ ...editingConn, mcp_configuration: { ...editingConn.mcp_configuration, mcp_tools: mapping } }); event.target.setCustomValidity(''); } catch { event.target.setCustomValidity('Enter valid JSON.'); event.target.reportValidity(); } }} />
                          <span className="prism-field-hint">Map each operation to its server tool name, scope argument, arguments and argument map.</span>
                        </div>
                        {editingConn.routing_mode === 'hybrid' && <div className="prism-field-group full-width">
                          <label className="prism-field-label" htmlFor="connection-mcp-route">Evidence route</label>
                          <select id="connection-mcp-route" className="prism-select" value={editingConn.mcp_configuration?.operation_routes?.[template?.system_name === 'itsm' ? 'get_ticket' : template?.system_name === 'log_search' ? 'query_range' : 'read_evidence'] || ''}
                            onChange={event => setEditingConn({ ...editingConn, mcp_configuration: { ...editingConn.mcp_configuration, operation_routes: { [template?.system_name === 'itsm' ? 'get_ticket' : template?.system_name === 'log_search' ? 'query_range' : 'read_evidence']: event.target.value } } })}>
                            <option value="">Choose route</option><option value="direct">Direct</option><option value="mcp">MCP</option>
                          </select>
                        </div>}
                      </>}
                    </div>

                    <div className="prism-conn-form-footer">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setIsConnModalOpen(false);
                          setEditingConn(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleSaveConnectionRecord(editingConn)}
                        disabled={!editingConn.connection_name?.trim() || !editingConn.environment_name?.trim()}
                      >
                        <Save size={13} /> Save Connection
                      </button>
                    </div>
                  </div>
                )}

                {/* Connections Table */}
                {connections.length === 0 ? (
                  <div className="prism-empty-state" style={{ padding: '24px 16px', textAlign: 'center' }}>
                    <Server size={28} style={{ color: 'var(--muted, #64748b)', margin: '0 auto 8px auto', display: 'block' }} />
                    <strong style={{ color: 'var(--tx, #f8fafc)', fontSize: 13 }}>No Environment connections</strong>
                    <p style={{ color: 'var(--muted, #64748b)', fontSize: 11.5, marginTop: 4, maxWidth: 440, marginInline: 'auto' }}>
                      Add repeatable connection records to configure distinct URLs, secret references, and routing modes for production, staging, and development environments.
                    </p>
                  </div>
                ) : (
                  <div className="prism-conn-table-wrap">
                    <table className="prism-conn-table">
                      <thead>
                        <tr>
                          <th>Connection / ID</th>
                          <th>Environment</th>
                          <th>Routing</th>
                          <th>Auth Profile</th>
                          <th>Target URL</th>
                          <th>Diagnostics</th>
                          <th>State</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {connections.map(conn => {
                          const isTestingThis = testingConnId === conn.connection_id;
                          const isEnablingThis = enablingConnId === conn.connection_id;
                          return (
                            <tr key={conn.connection_id}>
                              <td>
                                <div className="prism-conn-name-col">
                                  <span className="prism-conn-name-text">{conn.connection_name}</span>
                                  <span className="prism-conn-id-sub">{conn.connection_id}</span>
                                </div>
                              </td>
                              <td>
                                <span className="prism-env-badge" style={{ fontSize: 11 }}>
                                  {conn.environment_name}
                                </span>
                              </td>
                              <td>
                                <span className={`prism-routing-tag ${conn.routing_mode || 'direct'}`}>
                                  {conn.routing_mode || 'direct'}
                                </span>
                              </td>
                              <td>
                                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
                                  {conn.auth_profile_id || 'default'}
                                </span>
                              </td>
                              <td>
                                <code style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>
                                  {conn.target?.endpoint || conn.target?.url || conn.target?.host || '—'}
                                </code>
                              </td>
                              <td>
                                {conn.test_status === 'passed' ? (
                                  <span className="prism-conn-status passed" title={conn.last_tested_at ? `Tested at ${new Date(conn.last_tested_at * 1000).toLocaleTimeString()}` : 'Passed'}>
                                    <CheckCircle2 size={12} /> Passed
                                  </span>
                                ) : conn.test_status === 'failed' ? (
                                  <span className="prism-conn-status failed">
                                    <AlertTriangle size={12} /> Failed
                                  </span>
                                ) : (
                                  <span className="prism-conn-status not-run">
                                    <Clock size={12} /> Not Tested
                                  </span>
                                )}
                              </td>
                              <td>
                                <span className={`prism-status-pill ${conn.enabled ? 'active' : 'draft'}`}>
                                  <span className="dot" />
                                  {conn.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </td>
                              <td>
                                <div className="prism-conn-actions">
                                  <button
                                    type="button"
                                    className="prism-conn-btn test"
                                    onClick={() => handleTestConnectionRecord(conn)}
                                    disabled={isTestingThis || readOnly || !isPlatformAdmin || isDirty}
                                    title="Run Reachability & Candidate Diagnostic Test"
                                  >
                                    {isTestingThis ? <RefreshCw size={11} className="spin" /> : <Activity size={11} />}
                                    <span>{isTestingThis ? 'Testing...' : 'Test'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`prism-conn-btn ${conn.enabled ? 'disable' : 'enable'}`}
                                    onClick={() => handleToggleConnectionEnabled(conn)}
                                    disabled={isEnablingThis || readOnly || !isPlatformAdmin || isDirty}
                                    title={conn.enabled ? 'Disable connection' : 'Enable connection (requires passing test within 15 mins)'}
                                  >
                                    {isEnablingThis ? <RefreshCw size={11} className="spin" /> : <Check size={11} />}
                                    <span>{conn.enabled ? 'Disable' : 'Enable'}</span>
                                  </button>
                                  {isPlatformAdmin && !readOnly && (
                                    <>
                                      <button
                                        type="button"
                                        className="icon-btn"
                                        onClick={() => {
                                          setEditingConn({ ...conn });
                                          setIsConnModalOpen(true);
                                        }}
                                        title="Edit connection"
                                      >
                                        <Layers size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-btn-danger"
                                        onClick={() => { if (window.confirm(`Delete connection ${conn.connection_name}? Environment assignments using it will need updating.`)) void handleDeleteConnectionRecord(conn.connection_id); }}
                                        title="Delete connection"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Card 4: Scope & Environment Mappings (Domain-Specific per docs/connector-forms.md) */}
          {(
            <section className="prism-card" id="section-scope">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Layers size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Scope & Filters</h2>
                    <p className="prism-card-desc">Domain-specific scope and environment mapping configurations.</p>
                  </div>
                </div>
              </div>

              <div className="prism-card-body">
                {/* Domain Specific: Jira */}
                {connectorType === 'itsm' && (
                  <div className="prism-domain-scope-box">
                    <div className="prism-form-grid">
                      <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('external_resource') === 'platform_only'}>
                        <div className="prism-field-header">
                          <label className="prism-field-label">Authorized Jira Project Key <span className="req">*</span></label>
                          {renderGovernanceBadge('project_key')}
                        </div>
                        <input
                          type="text"
                          className="prism-input"
                          disabled={readOnly || isFieldLocked('external_resource')} value={jiraProjectKey}
                          onChange={e => setJiraProjectKey(e.target.value.toUpperCase())}
                          placeholder="FE"

                        />
                      </div>

                      <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('attachment_processing') === 'platform_only'}>
                        <div className="prism-field-header">
                          <label className="prism-field-label">Attachment Processing</label>
                          {renderGovernanceBadge('attachment_processing')}
                        </div>
                        <select
                          className="prism-select"
                          disabled={readOnly || isFieldLocked('attachment_processing')} value={attachmentProcessing}
                          onChange={e => setAttachmentProcessing(e.target.value as 'disabled' | 'local_upload')}

                        >
                          <option value="disabled">Disabled (Metadata only)</option>
                          <option value="local_upload">Local File Uploads for Issue</option>
                        </select>
                      </div>

                      <div className="prism-field-group full-width">
                        <label className="prism-field-label">Default Issue Types</label>
                        <div className="prism-chip-wrap">
                          {jiraIssueTypes.map(t => (
                            <span key={t} className="prism-chip">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Jira Custom Field Mapping Table */}
                    <div style={{ marginTop: '16px' }} hidden={!isPlatformAdmin && getFieldTier('custom_field_mapping') === 'platform_only'}>
                      <JiraFieldMappingCard
                        connectorName="Jira"
                        mappings={customFieldMappings.map((m, idx) => ({
                          id: String(idx),
                          sourceField: m.sourceField,
                          fieldType: m.fieldType,
                          targetField: m.prismField,
                          required: m.required,
                          defaultValue: m.defaultValue,
                        }))}
                        onChange={updated => {
                          setCustomFieldMappings(
                            updated.map(u => ({
                              sourceField: u.sourceField,
                              fieldType: u.fieldType,
                              prismField: u.targetField,
                              required: u.required,
                              defaultValue: u.defaultValue,
                            }))
                          );
                        }}
                        readOnly={readOnly || isFieldLocked('custom_field_mapping')}
                      />
                    </div>
                  </div>
                )}

                {connectorType === 'itsm' && <div className="prism-field-group full-width" style={{ marginTop: 20 }} hidden={!isPlatformAdmin && getFieldTier('custom_jql') === 'platform_only'}>
                  <label htmlFor="connector-custom-jql" className="prism-field-label">Custom JQL filter</label>
                  <textarea id="connector-custom-jql" className="prism-input mono" rows={4} maxLength={4096} disabled={readOnly || isFieldLocked('custom_jql')} value={customJql} onChange={event => setCustomJql(event.target.value)}  />
                  <span className="prism-field-hint">Saved filter configuration. Scheduled polling and dynamic queue execution are unavailable.</span>
                </div>}
                {/* Domain Specific: Splunk */}
                {connectorType === 'log_search' && (
                  <div className="prism-domain-scope-box">
                    <div className="prism-form-grid">
                      <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('external_resource') === 'platform_only'}>
                        <div className="prism-field-header">
                          <label className="prism-field-label">Authorized Splunk Index <span className="req">*</span></label>
                          {renderGovernanceBadge('index')}
                        </div>
                        <input
                          type="text"
                          className="prism-input"
                          disabled={readOnly || isFieldLocked('external_resource')} value={splunkIndex}
                          onChange={e => setSplunkIndex(e.target.value)}
                          placeholder="main"

                        />
                        <span className="prism-field-hint">The current native client strictly accesses one authorized index.</span>
                      </div>

                      <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('max_window_seconds') === 'platform_only'}>
                        <div className="prism-field-header">
                          <label className="prism-field-label">Max Search Window (seconds)</label>
                          {renderGovernanceBadge('search_window_seconds')}
                        </div>
                        <input
                          type="number"
                          className="prism-input"
                          disabled={readOnly || isFieldLocked('max_window_seconds')} value={searchWindowSeconds}
                          onChange={e => setSearchWindowSeconds(Number(e.target.value))}
                          min={60}
                          max={86400}

                        />
                        <span className="prism-field-hint">Bounded time window capped at 86,400s (24 hours).</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Domain Specific: Oracle (Policy Blocked) */}
                {connectorType === 'oracle' && (
                  <div className="prism-policy-callout" role="alert">
                    <ShieldAlert size={18} />
                    <div>
                      <strong>Policy-Restricted Integration</strong>
                      <p>
                        Database querying and Oracle execution are blocked by organizational governance policy.
                        Project instances cannot be saved or tested while this connector is blocked.
                      </p>
                    </div>
                  </div>
                )}

                {/* Domain Specific: Confluence */}
                {connectorType === 'confluence' && (
                  <div className="prism-form-grid">
                    <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('external_resource') === 'platform_only'}>
                      <label className="prism-field-label">Authorized Space Key</label>
                      <input
                        type="text"
                        className="prism-input"
                        disabled={readOnly || isFieldLocked('external_resource')} value={confluenceSpaceKey}
                        onChange={e => setConfluenceSpaceKey(e.target.value)}

                      />
                    </div>
                  </div>
                )}

                {/* Domain Specific: Kafka */}
                {connectorType === 'kafka' && (isPlatformAdmin || getFieldTier('external_resource') !== 'platform_only') && (
                  <div className="prism-form-grid">
                    <div className="prism-field-group full-width">
                      <label className="prism-field-label">Authorized Topics</label>
                      <div className="prism-chip-wrap">
                        {kafkaTopics.map(t => (
                          <span key={t} className="prism-chip">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {['qtest', 'signalfx', 'gitlab'].includes(connectorType) && <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('external_resource') === 'platform_only'}>
                  <label htmlFor="connector-resource-scope" className="prism-field-label">{connectorType === 'signalfx' ? 'Detector ID' : 'Project ID'}</label>
                  <input id="connector-resource-scope" className="prism-input" disabled={readOnly || isFieldLocked('external_resource')} value={resourceScope} onChange={event => setResourceScope(event.target.value)}  />
                  <span className="prism-field-hint">The exact authorized resource used for evidence retrieval. Use environment assignments below for different resources per environment.</span>
                </div>}
                {/* Domain Specific: Unix */}
                {connectorType === 'unix' && (
                  <div className="prism-form-grid">
                    <div className="prism-field-group full-width" hidden={!isPlatformAdmin && getFieldTier('external_resource') === 'platform_only'}>
                      <label className="prism-field-label">Authorized Log File Path</label>
                      <input
                        type="text"
                        className="prism-input mono"
                        disabled={readOnly || isFieldLocked('external_resource')} value={unixLogPath}
                        onChange={e => setUnixLogPath(e.target.value)}

                      />
                    </div>
                    <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('max_tail_bytes') === 'platform_only'}>
                      <label className="prism-field-label">Max Tail Bytes</label>
                      <input
                        type="number"
                        className="prism-input"
                        disabled={readOnly || isFieldLocked('max_tail_bytes')} value={unixTailBytes}
                        onChange={e => setUnixTailBytes(Number(e.target.value))}

                      />
                    </div>
                  </div>
                )}

                {/* Domain Specific: Kubernetes */}
                {connectorType === 'kubernetes' && (
                  <div className="prism-form-grid">
                    <div className="prism-field-group full-width" hidden={!isPlatformAdmin && getFieldTier('external_resource') === 'platform_only'}>
                      <label className="prism-field-label">Authorized Namespace</label>
                      <input
                        type="text"
                        className="prism-input"
                        disabled={readOnly || isFieldLocked('external_resource')} value={k8sNamespace}
                        onChange={e => setK8sNamespace(e.target.value)}

                      />
                    </div>
                  </div>
                )}

                {/* Environment Mappings Table (if Environment Dependent) */}
                {environmentDependency === 'dependent' && (isPlatformAdmin || getFieldTier('bindings') !== 'platform_only') && (
                  <div className="prism-env-mappings-wrap" style={{ marginTop: '18px' }}>
                    <div className="prism-section-title-row">
                      <h4 className="prism-subheading">Environment Mappings &amp; Approved Connections</h4>
                      {!readOnly && !isFieldLocked('bindings') && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEnvironmentMappings([
                              ...environmentMappings,
                              {
                                project_env_id: '',
                                external_resource: '',
                                tool_environment: '',
                                credential_binding: '',
                                connection_id: '',
                              },
                            ]);
                          }}
                        >
                          <Plus size={11} /> Add Mapping Row
                        </button>
                      )}
                    </div>
                    <p className="prism-field-hint">
                      Bind project environments to approved repeatable connection records or specify custom external resource identifiers.
                    </p>
                    <table className="prism-data-table">
                      <thead>
                        <tr>
                          <th>Project Env *</th>
                          <th>Approved Connection</th>
                          <th>Authorized Resource *</th>
                          <th>Credential Binding ID</th>
                          <th>Tool Environment *</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {environmentMappings.map((row, idx) => {
                          const linkedConn = connections.find(c => c.connection_id === row.connection_id);
                          return (
                            <tr key={idx}>
                              <td>
                                <select
                                  className="prism-select-compact"
                                  aria-label={`Project environment for mapping ${idx + 1}`}
                                  value={row.project_env_id}
                                  onChange={e => {
                                    const next = [...environmentMappings];
                                    next[idx].project_env_id = e.target.value;
                                    setEnvironmentMappings(next);
                                  }}
                                  disabled={readOnly || isFieldLocked('bindings')}
                                >
                                  <option value="" disabled>Select an environment</option>
                                  {availableEnvironments.map(env => (
                                    <option key={env.id} value={env.id}>{env.name || env.id}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <select
                                  className="prism-select-compact"
                                  aria-label={`Approved connection for mapping ${idx + 1}`}
                                  value={row.connection_id || ''}
                                  onChange={e => {
                                    const selectedId = e.target.value;
                                    const next = [...environmentMappings];
                                    next[idx].connection_id = selectedId || undefined;
                                    const conn = connections.find(c => c.connection_id === selectedId);
                                    if (conn) {
                                      if (!next[idx].external_resource) {
                                        next[idx].external_resource = conn.target?.endpoint || conn.environment_name;
                                      }
                                      if (!next[idx].tool_environment) {
                                        next[idx].tool_environment = conn.environment_name;
                                      }
                                    }
                                    setEnvironmentMappings(next);
                                  }}
                                  disabled={readOnly || isFieldLocked('bindings')}
                                >
                                  <option value="">Default Instance Target</option>
                                  {connections.map(conn => (
                                    <option key={conn.connection_id} value={conn.connection_id}>
                                      {conn.connection_name} ({conn.environment_name}) {conn.test_status === 'passed' ? '✓' : ''}
                                    </option>
                                  ))}
                                </select>
                                {linkedConn && (
                                  <span style={{ display: 'block', marginTop: 2 }}>
                                    {linkedConn.test_status === 'passed' ? (
                                      <span className="prism-conn-status passed" style={{ fontSize: 9.5, padding: '1px 5px' }}>
                                        <CheckCircle2 size={10} /> Passed
                                      </span>
                                    ) : linkedConn.test_status === 'failed' ? (
                                      <span className="prism-conn-status failed" style={{ fontSize: 9.5, padding: '1px 5px' }}>
                                        <AlertTriangle size={10} /> Failed
                                      </span>
                                    ) : (
                                      <span className="prism-conn-status not-run" style={{ fontSize: 9.5, padding: '1px 5px' }}>
                                        <Clock size={10} /> Not Tested
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="prism-input-compact mono"
                                  aria-label={`Authorized resource for mapping ${idx + 1}`}
                                  value={row.external_resource}
                                  onChange={e => {
                                    const next = [...environmentMappings];
                                    next[idx].external_resource = e.target.value;
                                    setEnvironmentMappings(next);
                                  }}
                                  placeholder="Authorized resource identifier"
                                  disabled={readOnly || isFieldLocked('bindings')}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="prism-input-compact mono"
                                  value={row.credential_binding || ''}
                                  aria-label={`Saved credential binding for mapping ${idx + 1}`}
                                  placeholder="Not assigned"
                                  readOnly
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="prism-input-compact"
                                  aria-label={`Tool environment for mapping ${idx + 1}`}
                                  value={row.tool_environment}
                                  onChange={e => {
                                    const next = [...environmentMappings];
                                    next[idx].tool_environment = e.target.value;
                                    setEnvironmentMappings(next);
                                  }}
                                  placeholder="Tool-Env"
                                  disabled={readOnly || isFieldLocked('bindings')}
                                />
                              </td>
                              <td>
                                {environmentMappings.length > 1 && !readOnly && !isFieldLocked('bindings') && (
                                  <button
                                    type="button"
                                    className="icon-btn-danger"
                                    onClick={() => {
                                      setEnvironmentMappings(environmentMappings.filter((_, i) => i !== idx));
                                    }}
                                    aria-label="Remove row"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ------------------------------------------------------------------
            RIGHT COLUMN: Operations & Limits, Test & enable
            ------------------------------------------------------------------ */}
        <div className="prism-grid-col">
          <ConnectorProjectPolicy connectorId={connectorType} readOnly={readOnly} />
          <section className="prism-card" aria-labelledby="connector-runtime-support-title">
            <header className="prism-card-header"><div><h2 id="connector-runtime-support-title" className="prism-card-title">Features &amp; availability</h2><p className="prism-card-desc">What this installed connector can do in an investigation.</p></div></header>
            <div className="prism-card-body">
              {(template?.runtime_support || []).map(feature => <div className="connector-feature-row" key={feature.name}><div><strong>{feature.name}</strong><p>{feature.detail}</p></div><span className={`connector-feature-status ${feature.status}`}>{feature.status}</span></div>)}

            </div>
          </section>
          {templateDefaults && <section className="prism-card connector-shared-defaults">{templateDefaults}</section>}

          {(
            <section className="prism-card" aria-labelledby="connector-access-title">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Shield size={16} /></div>
                  <div>
                    <h2 id="connector-access-title" className="prism-card-title">Permissions &amp; Access</h2>
                    <p className="prism-card-desc">Server-enforced project scope and connector operations.</p>
                  </div>
                </div>
              </div>
              <div className="prism-card-body">
                <dl className="prism-access-summary">
                  <div><dt>Project scope</dt><dd>{projectId}</dd></div>
                  <div><dt>Your roles</dt><dd>{principal?.roles?.join(', ') || 'No project role'}</dd></div>
                  <div><dt>Data source</dt><dd>Read-only investigation evidence</dd></div>
                  <div><dt>Generic viewer access</dt><dd>Controlled by authenticated project membership and capability permissions</dd></div>
                  <div><dt>Allowed operations</dt><dd>{template?.supported_operations?.length ? template.supported_operations.join(', ') : 'No operations declared'}</dd></div>
                </dl>
                <p className="prism-field-hint">Connector permissions are enforced by the server. Write access is unavailable for read-only providers.</p>
              </div>
            </section>
          )}
          {/* Card 4: Operations, Limits & Governance Policy */}
          {(
            <section className="prism-card" id="section-operations">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Activity size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Advanced settings</h2>
                    <p className="prism-card-desc">Bounded timeouts, rates, and template governance policies.</p>
                  </div>
                </div>
              </div>

              <div className="prism-card-body">
                <div className="prism-form-grid" style={{ marginTop: '16px' }}>
                  {/* Request Timeout (1-120s per candidate_testing.py:305) */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('timeout_seconds') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="timeout-input" className="prism-field-label">
                        Request Timeout (seconds) <span className="req">*</span>
                      </label>
                      {renderGovernanceBadge('timeout_seconds')}
                    </div>
                    <input
                      id="timeout-input"
                      type="number"
                      className="prism-input"
                      disabled={readOnly || isFieldLocked('timeout_seconds')} value={timeoutSeconds}
                      onChange={e => setTimeoutSeconds(Number(e.target.value))}
                      min={1}
                      max={template?.parameter_fields?.find(field => field.variable_name === 'timeout_seconds')?.maximum ?? 120}

                      required
                    />
                    <span className="prism-field-hint">Request timeout is validated against the published connector limits.</span>
                  </div>

                  {/* Maximum Results */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('max_results') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label htmlFor="max-results-input" className="prism-field-label">Max Results</label>
                      {renderGovernanceBadge('max_results')}
                    </div>
                    <input
                      id="max-results-input"
                      type="number"
                      className="prism-input"
                      disabled={readOnly || isFieldLocked('max_results')} value={maxResults}
                      onChange={e => setMaxResults(Number(e.target.value))}
                      min={1}
                      max={1000}

                    />
                    <span className="prism-field-hint">Result count bound capped per provider limit.</span>
                  </div>

                  {/* Rate Limit */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('rate_limit') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label className="prism-field-label">Rate Limit</label>
                      {renderGovernanceBadge('rate_limit')}
                    </div>
                    <input
                      type="text"
                      className="prism-input locked"
                      value={rateLimit}
                      readOnly
                      disabled
                    />
                  </div>

                  {/* Retry Attempts */}
                  <div className="prism-field-group" hidden={!isPlatformAdmin && getFieldTier('retry_attempts') === 'platform_only'}>
                    <div className="prism-field-header">
                      <label className="prism-field-label">Retry Attempts</label>
                      {renderGovernanceBadge('retry_attempts')}
                    </div>
                    <input
                      type="text"
                      className="prism-input locked"
                      value={retryAttempts}
                      readOnly
                      disabled
                    />
                  </div>
                </div>

                {/* Repository Release Policy Banner */}
                <div className="prism-policy-safeguard-banner" role="alert" style={{ marginTop: '16px' }}>
                  <ShieldAlert size={18} style={{ color: '#f07891', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Repository Release Policy Enforcement</strong>
                    <p>
                      Jira write mutations (issue creation, modification, transitions), database querying, and arbitrary command execution are strictly disabled by repository policy. All active tools execute in read-only diagnostic mode.
                    </p>
                  </div>
                </div>

                <div className="connector-scope-facts">
                  <div hidden={!isPlatformAdmin && getFieldTier('retry_backoff') === 'platform_only'}><span>Retry backoff</span><strong>{template?.default_retry_backoff == null ? 'Not declared' : `${template.default_retry_backoff} seconds`}</strong></div>
                  <div hidden={!isPlatformAdmin && getFieldTier('ui_base_url') === 'platform_only'}><span>Presentation URL</span><strong>{template?.default_ui_base_url || 'Not declared'}</strong></div>
                  <div hidden={!isPlatformAdmin && getFieldTier('protocol') === 'platform_only'}><span>Transport</span><strong>{template?.protocol || 'Not declared'}</strong></div>
                </div>
                <p className="prism-field-hint">Direct and MCP routes are configured and tested on each environment connection.</p>
              </div>
            </section>
          )}

          {/* Card 5: Test & enable (Exact Saved Instance & 15-Minute Activation Gate) */}
          {(
            <section className="prism-card" id="section-testing">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><ShieldCheck size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Test & enable</h2>
                    <p className="prism-card-desc">15-minute isolated candidate activation gate and reachability tests.</p>
                  </div>
                </div>
              </div>

              <div className="prism-card-body">
                {/* 15-Minute Gate Callout */}
                <div className="prism-gate-banner">
                  <Clock size={16} />
                  <div>
                    <strong>15-Minute Activation Gate Enforced</strong>
                    <p>
                      Enabling a connector requires a passing live candidate test within the last 15 minutes.
                      Modifying settings resets the test gate.
                    </p>
                  </div>
                </div>

                {/* Candidate Hash & Dirty Indicators */}
                <div className="prism-meta-status-row">
                  <div className="prism-candidate-hash-pill">
                    <span>Candidate Hash:</span>
                    <code>{candidateHash ? candidateHash.slice(0, 16) + '...' : 'computing...'}</code>
                  </div>
                  {isDirty && (
                    <span className="prism-dirty-pill">
                      <AlertTriangle size={11} /> Unsaved edits
                    </span>
                  )}
                </div>

                {/* Candidate Stage Results Timeline */}
                {visibleTestResult && (
                  <div className="prism-stage-results-panel">
                    <h4 className="prism-subheading">Validation Stage Results</h4>
                    <div className="prism-stages-grid">
                      {Object.entries(visibleTestResult.stage_results || {}).map(([stage, res]) => (
                        <div key={stage} className={`prism-stage-pill ${res.status.toLowerCase()}`}>
                          <span className="stage-name">{stage.replace(/_/g, ' ')}</span>
                          <span className="stage-status">{res.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Saved instance lifecycle is enforced by the backend. */}
                {savedInstance && !readOnly && <button type="button" className="btn btn-secondary" disabled={saving || testing || isDirty || isPolicyBlocked} onClick={handleToggleInstance}>
                  {savedInstance.enabled ? 'Disable connection' : 'Enable connection'}
                </button>}
                {/* Test Action */}
                <div className="prism-test-actions-box">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleTestConnection}
                    disabled={testing || saving || readOnly || isPolicyBlocked || !savedInstance || isDirty}
                  >
                    {testing ? <RefreshCw size={14} className="spin" /> : <Activity size={14} />}
                    <span>{testing ? 'Testing Saved Connection...' : 'Test Saved Connection'}</span>
                  </button>
                  <span className="prism-field-hint">
                    Save a draft first, then test the exact candidate configuration across mapped environments.
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ====================================================================
          4. STICKY ACTION FOOTER: Reset to Defaults, Cancel, Save Configuration
          ==================================================================== */}
      <footer className="prism-sticky-footer">
        <div className="prism-footer-left">
          {templateDirty && <span className="prism-field-hint">Save or discard shared template changes first.</span>}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetDefaults}
            disabled={saving || readOnly}
          >
            <RotateCcw size={13} />
            <span>Discard Changes</span>
          </button>
        </div>

        <div className="prism-footer-right">
          {onCancel && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { if (!isDirty || window.confirm('Discard unsaved connection changes?')) onCancel?.(); }}
              disabled={saving}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || readOnly || isPolicyBlocked || templateDirty}
          >
            <Save size={14} />
            <span>{saving ? 'Saving Configuration...' : 'Save Configuration'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
