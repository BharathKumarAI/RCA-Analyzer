import React, { useState, useEffect, useMemo } from 'react';
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
  Terminal,
  Info,
  X,
  Radio,
  Lock,
  Copy,
  RefreshCw,
  Plus,
  Check,
  Tag,
  Globe,
  Server,
  FileText,
  Cpu,
  RotateCcw,
} from 'lucide-react';
import type {
  ConnectorTemplateItem,
  ProjectConnectorInstanceItem,
  CandidateTestResponse,
  Principal,
  GovernanceTier,
} from '../types/api';
import { getFieldGovernanceTier } from '../types/api';
import {
  validateConnectorCandidate,
  testConnectorCandidate,
  saveProjectConnector,
  enableProjectConnector,
  disableProjectConnector,
} from '../services/api';
import '../styles/connector-editor.css';

interface ConnectorInstanceEditorProps {
  projectId: string;
  template?: ConnectorTemplateItem;
  instance?: ProjectConnectorInstanceItem;
  availableEnvironments?: Array<{ id: string; name: string }>;
  principal?: Principal;
  onSave?: (saved: ProjectConnectorInstanceItem) => void;
  onCancel?: () => void;
  readOnly?: boolean;
}

type SectionTab =
  | 'all'
  | 'connection'
  | 'authentication'
  | 'scope'
  | 'operations'
  | 'testing';

interface CustomFieldRow {
  sourceField: string;
  fieldType: string;
  prismField: string;
  required: boolean;
  defaultValue: string;
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
}) => {
  const [activeSection, setActiveSection] = useState<SectionTab>('all');
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
    instance?.system_name || instance?.definition_json?.system_name || template?.name || template?.system_name || ''
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
    return (template?.auth_profiles || []).filter(p => p.status === 'active');
  }, [template]);

  const initialAuthType = useMemo(() => {
    if (instance?.definition_json?.auth_type) return instance.definition_json.auth_type;
    return activeProfiles[0]?.id || template?.auth_profiles?.[0]?.id || '';
  }, [instance, activeProfiles, template]);

  const [authType, setAuthType] = useState<string>(initialAuthType);

  const configuredEndpoint =
    template?.default_endpoint && !/[<>]/.test(template.default_endpoint)
      ? template.default_endpoint
      : '';
  const [endpoint, setEndpoint] = useState<string>(
    instance?.definition_json?.endpoint || configuredEndpoint || ''
  );

  const [credentials, setCredentials] = useState<Record<string, string>>(() => {
    const raw = (instance?.definition_json?.credentials as Record<string, string>) || {};
    if (Object.keys(raw).length > 0) return raw;
    if (template?.default_secret) {
      return { api_token_secret_ref: template.default_secret, token_secret_ref: template.default_secret };
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

  // Jira-specific scope
  const [jiraProjectKey, setJiraProjectKey] = useState<string>(
    instance?.definition_json?.project_key || (template?.default_config?.project_key as string) || ''
  );
  const [jiraIssueTypes, setJiraIssueTypes] = useState<string[]>(
    instance?.definition_json?.issue_types || []
  );
  const [attachmentProcessing, setAttachmentProcessing] = useState<'disabled' | 'local_upload'>(
    instance?.definition_json?.attachment_processing || 'disabled'
  );
  const [customFieldMappings, setCustomFieldMappings] = useState<CustomFieldRow[]>(() => {
    const saved = instance?.definition_json?.custom_field_mappings;
    return Array.isArray(saved) ? saved : [];
  });

  // Splunk-specific scope
  const [splunkIndex, setSplunkIndex] = useState<string>(
    instance?.definition_json?.index || (template?.default_config?.index as string) || ''
  );
  const [searchWindowSeconds, setSearchWindowSeconds] = useState<number>(
    instance?.definition_json?.search_window_seconds || 86400
  );

  // Confluence scope
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState<string>(
    instance?.definition_json?.space_key || ''
  );

  // Kafka scope
  const [kafkaTopics, setKafkaTopics] = useState<string[]>(
    instance?.definition_json?.topics || []
  );

  // Unix scope
  const [unixLogPath, setUnixLogPath] = useState<string>(
    instance?.definition_json?.log_path || ''
  );
  const [unixTailBytes, setUnixTailBytes] = useState<number>(
    instance?.definition_json?.max_tail_bytes || 32768
  );

  // Kubernetes scope
  const [k8sNamespace, setK8sNamespace] = useState<string>(
    instance?.definition_json?.namespace || ''
  );

  // Environment Mappings for Environment Dependent mode
  const initialMappings = useMemo(() => {
    if (instance?.definition_json?.environment_mappings && instance.definition_json.environment_mappings.length > 0) {
      return instance.definition_json.environment_mappings;
    }
    if (instance?.bindings && instance.bindings.length > 0) {
      return instance.bindings.map(b => ({
        project_env_id: b.project_env_id,
        external_resource: b.external_resource,
        tool_environment: b.tool_env_id || '',
        credential_binding: b.credential_binding_id || 'Inherit instance',
      }));
    }
    return [];
  }, [instance, availableEnvironments, configuredEndpoint]);

  const [environmentMappings, setEnvironmentMappings] = useState<
    Array<{
      project_env_id: string;
      external_resource: string;
      tool_environment: string;
      credential_binding?: string;
    }>
  >(initialMappings);

  // --------------------------------------------------------------------------
  // Operations & Bounds (1 <= timeout_seconds <= 120 per candidate_testing.py)
  // --------------------------------------------------------------------------
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(
    instance?.definition_json?.timeout_seconds || template?.default_timeout_seconds || 30
  );
  const [maxResults, setMaxResults] = useState<number>(
    instance?.definition_json?.max_results ||
      (typeof template?.default_config?.max_results === 'number' ? template.default_config.max_results : 100)
  );
  const [rateLimit] = useState<string>(
    instance?.definition_json?.rate_limit || template?.default_rate_limit || '100 req/min'
  );
  const [retryAttempts] = useState<number>(
    instance?.definition_json?.retry_attempts ?? template?.default_retry_attempts ?? 3
  );

  // --------------------------------------------------------------------------
  // Testing, Gate Status & Persistence State
  // --------------------------------------------------------------------------
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<CandidateTestResponse | null>(null);
  const [testedSnapshot, setTestedSnapshot] = useState('');
  const [candidateHash, setCandidateHash] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
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
            credential_binding_id:
              m.credential_binding && m.credential_binding !== 'Inherit instance' ? m.credential_binding : undefined,
            status: 'active' as const,
          }))
        : [];

    return {
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
      project_key: jiraProjectKey,
      issue_types: jiraIssueTypes,
      attachment_processing: attachmentProcessing,
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

  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(currentCandidate));
  const isDirty = !savedInstance || JSON.stringify(currentCandidate) !== savedSnapshot;
  const visibleTestResult = testedSnapshot === JSON.stringify(currentCandidate) ? testResult : null;

  // --------------------------------------------------------------------------
  // Governance Helper
  // --------------------------------------------------------------------------
  const getFieldTier = (fieldName: string): GovernanceTier => {
    // 3 Mandatory Identity fields are always Project-Owned
    if (['system_name', 'environment_dependency', 'tool_environment'].includes(fieldName)) {
      return 'project_editable';
    }
    const pf = template?.parameter_fields?.find(f => f.variable_name === fieldName);
    return getFieldGovernanceTier(pf);
  };

  const isFieldLocked = (fieldName: string): boolean => {
    if (isPlatformAdmin) return false;
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
          <Lock size={10} /> Platform Locked
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

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setActionError(null);
    setActionSuccess(null);
    if (isPolicyBlocked) {
      setActionError('This connector cannot be saved under the current platform policy or template lifecycle.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveProjectConnector(projectId, {
        instance_id: instanceId,
        template_id: template?.template_id || template?.system_name || savedInstance?.template_id || '',
        template_version: template?.version || savedInstance?.template_version || '1.0.0',
        system_name: systemName.trim(),
        environment_dependency: environmentDependency === '' ? 'independent' : environmentDependency,
        tool_environment: toolEnvironment.trim(),
        status: 'draft',
        expected_revision: savedInstance?.revision || 0,
        definition: currentCandidate,
        bindings: currentCandidate.bindings || [],
      });
      setSavedInstance(saved);
      setSavedSnapshot(JSON.stringify(currentCandidate));
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
      const res = await testConnectorCandidate(currentCandidate, 'test_connection');
      setTestResult(res);
      setTestedSnapshot(JSON.stringify(currentCandidate));
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

  const handleResetDefaults = () => {
    const saved = savedInstance?.definition_json;
    setSystemName(savedInstance?.system_name || template?.name || template?.system_name || '');
    setEnvironmentDependency(savedInstance?.environment_dependency || 'independent');
    setToolEnvironment(savedInstance?.tool_environment || 'Shared');
    setOwner(savedInstance?.owner || saved?.owner || principal?.subject || '');
    setDescription(savedInstance?.description || saved?.description || template?.description || '');
    setTags(savedInstance?.tags || saved?.tags || []);
    setUsage(savedInstance?.usage || saved?.usage || []);
    setAuthType(saved?.auth_type || initialAuthType);
    setEndpoint(saved?.endpoint || configuredEndpoint);
    setCredentials(saved?.credentials || (template?.default_secret ? { api_token_secret_ref: template.default_secret, token_secret_ref: template.default_secret } : {}));
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
    setTimeoutSeconds(saved?.timeout_seconds || template?.default_timeout_seconds || 30);
    setMaxResults(saved?.max_results || (typeof template?.default_config?.max_results === 'number' ? template.default_config.max_results : 100));
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
              <h1 className="prism-title">
                {systemName || template?.name || 'Connector Configuration'}
                <span className={`prism-status-pill ${savedInstance?.status === 'enabled' ? 'active' : 'draft'}`}>
                  <span className="dot" />
                  {savedInstance?.status === 'enabled' ? 'Active' : 'Draft'}
                </span>
                {isPolicyBlocked && (
                  <span className="prism-status-pill policy-blocked">
                    <ShieldAlert size={11} /> Unavailable for project setup
                  </span>
                )}
              </h1>
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
      <nav className="prism-nav-bar" aria-label="Connector Sections">
        <button
          type="button"
          className={`prism-nav-tab ${activeSection === 'all' ? 'active' : ''}`}
          onClick={() => setActiveSection('all')}
        >
          Overview & All Sections
        </button>
        <button
          type="button"
          className={`prism-nav-tab ${activeSection === 'connection' ? 'active' : ''}`}
          onClick={() => setActiveSection('connection')}
        >
          1. Connection
        </button>
        <button
          type="button"
          className={`prism-nav-tab ${activeSection === 'authentication' ? 'active' : ''}`}
          onClick={() => setActiveSection('authentication')}
        >
          2. Authentication
        </button>
        <button
          type="button"
          className={`prism-nav-tab ${activeSection === 'scope' ? 'active' : ''}`}
          onClick={() => setActiveSection('scope')}
        >
          3. Scope & Fields
        </button>
        <button
          type="button"
          className={`prism-nav-tab ${activeSection === 'operations' ? 'active' : ''}`}
          onClick={() => setActiveSection('operations')}
        >
          4. Operations
        </button>
        <button
          type="button"
          className={`prism-nav-tab ${activeSection === 'testing' ? 'active' : ''}`}
          onClick={() => setActiveSection('testing')}
        >
          5. Test & Save
        </button>
      </nav>

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
      <main className="prism-content-grid">
        {/* ------------------------------------------------------------------
            LEFT COLUMN: Connection, Authentication, Scope & Field Mapping
            ------------------------------------------------------------------ */}
        <div className="prism-grid-col">
          {/* Card 1: Basic Information & Project Identity */}
          {(activeSection === 'all' || activeSection === 'connection') && (
            <section className="prism-card" id="section-connection">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Tag size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Basic Information</h2>
                    <p className="prism-card-desc">General details and mandatory project-scoped identity.</p>
                  </div>
                </div>
                <div className="prism-brand-tag">
                  {template?.category || 'Core Service'}
                </div>
              </div>

              <div className="prism-card-body">
                <div className="prism-form-grid">
                  {/* System Name (Mandatory Project-Only) */}
                  <div className="prism-field-group">
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
                      value={systemName}
                      onChange={e => setSystemName(e.target.value)}
                      placeholder={template?.name || 'e.g. Jira Triage Service'}
                      disabled={readOnly}
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
                        disabled={readOnly}
                      >
                        Environment Independent (Shared target)
                      </button>
                      <button
                        type="button"
                        className={`prism-toggle-btn ${environmentDependency === 'dependent' ? 'active' : ''}`}
                        onClick={() => setEnvironmentDependency('dependent')}
                        disabled={readOnly}
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
                  <div className="prism-field-group">
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
                      value={toolEnvironment}
                      onChange={e => setToolEnvironment(e.target.value)}
                      placeholder={environmentDependency === 'independent' ? 'Shared' : 'e.g. AWS-Production'}
                      disabled={readOnly}
                      maxLength={128}
                      required
                    />
                  </div>

                  {/* Owner */}
                  <div className="prism-field-group">
                    <div className="prism-field-header">
                      <label htmlFor="owner-input" className="prism-field-label">Owner</label>
                      <span className="prism-gov-badge project-editable"><Check size={10} /> Project Editable</span>
                    </div>
                    <input
                      id="owner-input"
                      type="text"
                      className="prism-input"
                      value={owner}
                      onChange={e => setOwner(e.target.value)}
                      placeholder="e.g. SRE Platform Team"
                      disabled={readOnly}
                    />
                  </div>

                  {/* Description */}
                  <div className="prism-field-group full-width">
                    <div className="prism-field-header">
                      <label htmlFor="desc-input" className="prism-field-label">Description</label>
                      <span className="prism-gov-badge project-editable"><Check size={10} /> Project Editable</span>
                    </div>
                    <textarea
                      id="desc-input"
                      className="prism-textarea"
                      rows={2}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe what this connector is used for in this project..."
                      disabled={readOnly}
                    />
                  </div>

                  {/* Tags with Interactive Chip Management */}
                  <div className="prism-field-group full-width">
                    <label className="prism-field-label">Tags</label>
                    <div className="prism-chip-wrap">
                      {tags.map(t => (
                        <span key={t} className="prism-chip">
                          {t}
                          {!readOnly && (
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
                      {!readOnly && (
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
          {(activeSection === 'all' || activeSection === 'authentication') && (
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
                {/* Supported Auth Profiles Tabs */}
                <div className="prism-auth-tabs-row" role="tablist" aria-label="Authentication Profiles">
                  {(template?.auth_profiles || []).map(profile => {
                    const isActive = authType === profile.id;
                    const isSupported = profile.status === 'active';
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`prism-auth-tab ${isActive ? 'active' : ''} ${!isSupported ? 'disabled' : ''}`}
                        onClick={() => {
                          if (isSupported && !readOnly) {
                            setAuthType(profile.id);
                          }
                        }}
                        disabled={!isSupported || readOnly}
                      >
                        {profile.name}
                        {!isSupported && <span className="pill-planned">Planned</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="prism-form-grid" style={{ marginTop: '14px' }}>
                  {/* Endpoint URL */}
                  <div className="prism-field-group full-width">
                    <div className="prism-field-header">
                      <label htmlFor="endpoint-url" className="prism-field-label">
                        Service Endpoint URL <span className="req">*</span>
                      </label>
                      {renderGovernanceBadge('endpoint')}
                    </div>
                    <input
                      id="endpoint-url"
                      type="url"
                      className="prism-input mono"
                      value={endpoint}
                      onChange={e => setEndpoint(e.target.value)}
                      placeholder="https://service.example.internal/api"
                      disabled={isFieldLocked('endpoint') || readOnly}
                      required
                    />
                    <span className="prism-field-hint">HTTPS service base URL. Credential tokens are strictly forbidden in URL endpoints.</span>
                  </div>

                  {/* Account / Username (when applicable) */}
                  {authType.includes('basic') && (
                    <div className="prism-field-group">
                      <div className="prism-field-header">
                        <label htmlFor="service-user" className="prism-field-label">
                          Service Account Email / User <span className="req">*</span>
                        </label>
                        <span className="prism-gov-badge project-editable"><Check size={10} /> Project Editable</span>
                      </div>
                      <input
                        id="service-user"
                        type="text"
                        className="prism-input"
                        value={serviceUser}
                        onChange={e => setServiceUser(e.target.value)}
                        placeholder="triage-bot@organization.internal"
                        disabled={readOnly}
                        required
                      />
                    </div>
                  )}

                  {/* Credential Secret Reference (env:// only, never plaintext) */}
                  <div className="prism-field-group">
                    <div className="prism-field-header">
                      <label htmlFor="secret-ref-input" className="prism-field-label">
                        Credential Secret Reference <span className="req">*</span>
                      </label>
                      <span className="prism-gov-badge project-editable"><Check size={10} /> Secret Reference</span>
                    </div>
                    <input
                      id="secret-ref-input"
                      type="text"
                      className="prism-input mono"
                      value={credentials.api_token_secret_ref || credentials.token_secret_ref || ''}
                      onChange={e => {
                        const val = e.target.value.trim();
                        handleCredentialChange('api_token_secret_ref', val);
                        handleCredentialChange('token_secret_ref', val);
                      }}
                      placeholder="env://JIRA_API_TOKEN"
                      pattern="env://[A-Z][A-Z0-9_]{0,127}"
                      disabled={readOnly}
                      required
                    />
                    <span className="prism-field-hint">
                      References a deployment environment secret. Plaintext credentials are never saved or revealed.
                    </span>
                  </div>
                </div>

                {/* Inline Live Test Connection Status Bar */}
                <div className="prism-test-connection-strip">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestConnection}
                    disabled={testing || readOnly || isPolicyBlocked}
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

          {/* Card 3: Scope & Environment Mappings (Domain-Specific per docs/connector-forms.md) */}
          {(activeSection === 'all' || activeSection === 'scope') && (
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
                      <div className="prism-field-group">
                        <div className="prism-field-header">
                          <label className="prism-field-label">Authorized Jira Project Key <span className="req">*</span></label>
                          {renderGovernanceBadge('project_key')}
                        </div>
                        <input
                          type="text"
                          className="prism-input"
                          value={jiraProjectKey}
                          onChange={e => setJiraProjectKey(e.target.value.toUpperCase())}
                          placeholder="FE"
                          disabled={readOnly}
                        />
                      </div>

                      <div className="prism-field-group">
                        <div className="prism-field-header">
                          <label className="prism-field-label">Attachment Processing</label>
                          {renderGovernanceBadge('attachment_processing')}
                        </div>
                        <select
                          className="prism-select"
                          value={attachmentProcessing}
                          onChange={e => setAttachmentProcessing(e.target.value as 'disabled' | 'local_upload')}
                          disabled={readOnly}
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
                    <div className="prism-field-mapping-section" style={{ marginTop: '16px' }}>
                      <h4 className="prism-subheading">Jira Custom Field Mapping</h4>
                      <p className="prism-subheading-desc">Map verified Jira custom fields to standard incident investigation fields.</p>
                      <div className="prism-table-wrap">
                        <table className="prism-data-table">
                          <thead>
                            <tr>
                              <th>Jira Field</th>
                              <th>Field Type</th>
                              <th>PRISM / RCA Field</th>
                              <th>Required</th>
                              <th>Default Value</th>
                              {!readOnly && <th aria-label="Actions" />}
                            </tr>
                          </thead>
                          <tbody>
                            {customFieldMappings.map((row, idx) => (
                              <tr key={idx}>
                                <td><input className="prism-input-compact mono" aria-label={`Source field ${idx + 1}`} value={row.sourceField} readOnly={readOnly} onChange={e => setCustomFieldMappings(rows => rows.map((item, i) => i === idx ? { ...item, sourceField: e.target.value } : item))} /></td>
                                <td><select className="prism-select-compact" aria-label={`Field type ${idx + 1}`} value={row.fieldType} disabled={readOnly} onChange={e => setCustomFieldMappings(rows => rows.map((item, i) => i === idx ? { ...item, fieldType: e.target.value } : item))}>
                                  {['text', 'textarea', 'select', 'number', 'date', 'boolean'].map(type => <option key={type} value={type}>{type}</option>)}
                                </select></td>
                                <td><input className="prism-input-compact mono" aria-label={`Target field ${idx + 1}`} value={row.prismField} readOnly={readOnly} onChange={e => setCustomFieldMappings(rows => rows.map((item, i) => i === idx ? { ...item, prismField: e.target.value } : item))} /></td>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={row.required}
                                    onChange={e => {
                                      setCustomFieldMappings(rows => rows.map((item, i) => i === idx ? { ...item, required: e.target.checked } : item));
                                    }}
                                    disabled={readOnly}
                                  />
                                </td>
                                <td><input className="prism-input-compact" aria-label={`Default value ${idx + 1}`} value={row.defaultValue} readOnly={readOnly} onChange={e => setCustomFieldMappings(rows => rows.map((item, i) => i === idx ? { ...item, defaultValue: e.target.value } : item))} /></td>
                                {!readOnly && <td><button type="button" className="icon-btn-danger" aria-label={`Remove mapping ${idx + 1}`} onClick={() => setCustomFieldMappings(rows => rows.filter((_, i) => i !== idx))}><Trash2 size={13} /></button></td>}
                              </tr>
                            ))}
                            {customFieldMappings.length === 0 && <tr><td colSpan={readOnly ? 5 : 6}>No field mappings configured.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      {!readOnly && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCustomFieldMappings(rows => [...rows, { sourceField: '', fieldType: 'text', prismField: '', required: false, defaultValue: '' }])}><Plus size={13} /> Add field mapping</button>}
                    </div>
                  </div>
                )}

                {/* Domain Specific: Splunk */}
                {connectorType === 'log_search' && (
                  <div className="prism-domain-scope-box">
                    <div className="prism-form-grid">
                      <div className="prism-field-group">
                        <div className="prism-field-header">
                          <label className="prism-field-label">Authorized Splunk Index <span className="req">*</span></label>
                          {renderGovernanceBadge('index')}
                        </div>
                        <input
                          type="text"
                          className="prism-input"
                          value={splunkIndex}
                          onChange={e => setSplunkIndex(e.target.value)}
                          placeholder="main"
                          disabled={readOnly}
                        />
                        <span className="prism-field-hint">The current native client strictly accesses one authorized index.</span>
                      </div>

                      <div className="prism-field-group">
                        <div className="prism-field-header">
                          <label className="prism-field-label">Max Search Window (seconds)</label>
                          {renderGovernanceBadge('search_window_seconds')}
                        </div>
                        <input
                          type="number"
                          className="prism-input"
                          value={searchWindowSeconds}
                          onChange={e => setSearchWindowSeconds(Number(e.target.value))}
                          min={60}
                          max={86400}
                          disabled={readOnly}
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
                    <div className="prism-field-group">
                      <label className="prism-field-label">Authorized Space Key</label>
                      <input
                        type="text"
                        className="prism-input"
                        value={confluenceSpaceKey}
                        onChange={e => setConfluenceSpaceKey(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                )}

                {/* Domain Specific: Kafka */}
                {connectorType === 'kafka' && (
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

                {/* Domain Specific: Unix */}
                {connectorType === 'unix' && (
                  <div className="prism-form-grid">
                    <div className="prism-field-group full-width">
                      <label className="prism-field-label">Authorized Log File Path</label>
                      <input
                        type="text"
                        className="prism-input mono"
                        value={unixLogPath}
                        onChange={e => setUnixLogPath(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                    <div className="prism-field-group">
                      <label className="prism-field-label">Max Tail Bytes</label>
                      <input
                        type="number"
                        className="prism-input"
                        value={unixTailBytes}
                        onChange={e => setUnixTailBytes(Number(e.target.value))}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                )}

                {/* Domain Specific: Kubernetes */}
                {connectorType === 'kubernetes' && (
                  <div className="prism-form-grid">
                    <div className="prism-field-group full-width">
                      <label className="prism-field-label">Authorized Namespace</label>
                      <input
                        type="text"
                        className="prism-input"
                        value={k8sNamespace}
                        onChange={e => setK8sNamespace(e.target.value)}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                )}

                {/* Environment Mappings Table (if Environment Dependent) */}
                {environmentDependency === 'dependent' && (
                  <div className="prism-env-mappings-wrap" style={{ marginTop: '18px' }}>
                    <div className="prism-section-title-row">
                      <h4 className="prism-subheading">Environment Mappings</h4>
                      {!readOnly && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEnvironmentMappings([
                              ...environmentMappings,
                              {
                                project_env_id: availableEnvironments[0]?.id || '',
                                external_resource: configuredEndpoint || '',
                                tool_environment: '',
                                credential_binding: 'Inherit instance',
                              },
                            ]);
                          }}
                        >
                          <Plus size={11} /> Add Mapping Row
                        </button>
                      )}
                    </div>
                    <table className="prism-data-table">
                      <thead>
                        <tr>
                          <th>Project Env *</th>
                          <th>External Resource Endpoint *</th>
                          <th>Tool Environment *</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {environmentMappings.map((row, idx) => (
                          <tr key={idx}>
                            <td>
                              <select
                                className="prism-select-compact"
                                value={row.project_env_id}
                                onChange={e => {
                                  const next = [...environmentMappings];
                                  next[idx].project_env_id = e.target.value;
                                  setEnvironmentMappings(next);
                                }}
                                disabled={readOnly}
                              >
                                {availableEnvironments.map(env => (
                                  <option key={env.id} value={env.id}>{env.name || env.id}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                className="prism-input-compact mono"
                                value={row.external_resource}
                                onChange={e => {
                                  const next = [...environmentMappings];
                                  next[idx].external_resource = e.target.value;
                                  setEnvironmentMappings(next);
                                }}
                                placeholder="https://..."
                                disabled={readOnly}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="prism-input-compact"
                                value={row.tool_environment}
                                onChange={e => {
                                  const next = [...environmentMappings];
                                  next[idx].tool_environment = e.target.value;
                                  setEnvironmentMappings(next);
                                }}
                                placeholder="Tool-Env"
                                disabled={readOnly}
                              />
                            </td>
                            <td>
                              {environmentMappings.length > 1 && !readOnly && (
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
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ------------------------------------------------------------------
            RIGHT COLUMN: Operations & Limits, Test & Enablement Gate
            ------------------------------------------------------------------ */}
        <div className="prism-grid-col">
          {activeSection === 'all' && (
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
                  <div><dt>Allowed operations</dt><dd>{template?.supported_operations?.length ? template.supported_operations.join(', ') : 'No operations declared'}</dd></div>
                </dl>
                <p className="prism-field-hint">Connector permissions are enforced by the server. Write access is unavailable for read-only providers.</p>
              </div>
            </section>
          )}
          {/* Card 4: Operations, Limits & Governance Policy */}
          {(activeSection === 'all' || activeSection === 'operations') && (
            <section className="prism-card" id="section-operations">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><Activity size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Investigation Settings &amp; Limits</h2>
                    <p className="prism-card-desc">Bounded timeouts, rates, and template governance policies.</p>
                  </div>
                </div>
              </div>

              <div className="prism-card-body">
                {/* Supported Operations */}
                <div className="prism-ops-summary">
                  <label className="prism-field-label">Supported Read Operations</label>
                  <div className="prism-ops-chip-grid">
                    {(template?.supported_operations || ['get_ticket']).map(op => (
                      <span key={op} className="prism-op-chip">
                        <Check size={11} /> {op}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="prism-form-grid" style={{ marginTop: '16px' }}>
                  {/* Request Timeout (1-120s per candidate_testing.py:305) */}
                  <div className="prism-field-group">
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
                      value={timeoutSeconds}
                      onChange={e => setTimeoutSeconds(Number(e.target.value))}
                      min={1}
                      max={120}
                      disabled={isFieldLocked('timeout_seconds') || readOnly}
                      required
                    />
                    <span className="prism-field-hint">Enforced backend bound: 1 to 120 seconds.</span>
                  </div>

                  {/* Maximum Results */}
                  <div className="prism-field-group">
                    <div className="prism-field-header">
                      <label htmlFor="max-results-input" className="prism-field-label">Max Results</label>
                      {renderGovernanceBadge('max_results')}
                    </div>
                    <input
                      id="max-results-input"
                      type="number"
                      className="prism-input"
                      value={maxResults}
                      onChange={e => setMaxResults(Number(e.target.value))}
                      min={1}
                      max={1000}
                      disabled={isFieldLocked('max_results') || readOnly}
                    />
                    <span className="prism-field-hint">Result count bound capped per provider limit.</span>
                  </div>

                  {/* Rate Limit */}
                  <div className="prism-field-group">
                    <div className="prism-field-header">
                      <label className="prism-field-label">Rate Limit</label>
                      <span className="prism-gov-badge project-locked"><Lock size={10} /> Platform Locked</span>
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
                  <div className="prism-field-group">
                    <div className="prism-field-header">
                      <label className="prism-field-label">Retry Attempts</label>
                      <span className="prism-gov-badge project-locked"><Lock size={10} /> Platform Locked</span>
                    </div>
                    <input
                      type="number"
                      className="prism-input locked"
                      value={retryAttempts}
                      readOnly
                      disabled
                    />
                  </div>
                </div>

                {/* Template Governance Policy Summary */}
                <div className="prism-governance-summary-box">
                  <h4 className="prism-subheading">Template Governance Contract</h4>
                  <p className="prism-subheading-desc">
                    Field ownership is defined on the published template. Mutations to locked or platform-only settings are validated and rejected server-side.
                  </p>
                  <div className="prism-gov-legend">
                    <div className="legend-item">
                      <span className="prism-gov-badge platform-only"><Shield size={10} /> Platform Only</span>
                      <span className="legend-desc">Visible exclusively to Platform Administrators.</span>
                    </div>
                    <div className="legend-item">
                      <span className="prism-gov-badge project-locked"><Lock size={10} /> Platform Locked</span>
                      <span className="legend-desc">Visible to projects, but read-only / immutable by project roles.</span>
                    </div>
                    <div className="legend-item">
                      <span className="prism-gov-badge project-editable"><Check size={10} /> Project Editable</span>
                      <span className="legend-desc">Customizable and overridable at the project level.</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Card 5: Test & Enablement Gate (Exact Saved Instance & 15-Minute Activation Gate) */}
          {(activeSection === 'all' || activeSection === 'testing') && (
            <section className="prism-card" id="section-testing">
              <div className="prism-card-header">
                <div className="prism-card-title-wrap">
                  <div className="prism-card-icon"><ShieldCheck size={16} /></div>
                  <div>
                    <h2 className="prism-card-title">Test & Enablement Gate</h2>
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

                {/* Test Action */}
                <div className="prism-test-actions-box">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleTestConnection}
                    disabled={testing || readOnly || isPolicyBlocked || !savedInstance}
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
      </main>

      {/* ====================================================================
          4. STICKY ACTION FOOTER: Reset to Defaults, Cancel, Save Configuration
          ==================================================================== */}
      <footer className="prism-sticky-footer">
        <div className="prism-footer-left">
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
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || readOnly || isPolicyBlocked}
          >
            <Save size={14} />
            <span>{saving ? 'Saving Configuration...' : 'Save Configuration'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
