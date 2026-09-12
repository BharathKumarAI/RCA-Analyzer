import React, { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Clock,
  Workflow,
  Sliders,
  FileCode,
  Copy,
  Check,
  PlayCircle,
  Save,
  Download,
  Database,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  SlidersHorizontal,
  FolderGit2,
  FileText,
  Boxes,
} from 'lucide-react';
import {
  fetchProjectSetup,
  fetchConnectorHealthCheck,
  validateProjectSetup,
  saveProjectSetup,
} from '../services/api';
import type {
  ProjectSetupResponse,
  ProjectValidationResult,
  ConnectorHealthRecord,
  ConnectorParameterField,
  EnvironmentConfig,
} from '../types/api';

import { buildProjectConfiguration } from '../utils/projectSetupConfig';

type SetupStage =
  | 'identity'
  | 'governance'
  | 'temporal'
  | 'workflow'
  | 'capabilities'
  | 'connectors'
  | 'template';

const STAGES: Array<{ id: SetupStage; label: string; number: number; icon: React.FC<{ size?: number; color?: string }> }> = [
  { id: 'identity', label: 'Identity & Scope', number: 1, icon: FolderGit2 },
  { id: 'governance', label: 'Governance & Rules', number: 2, icon: Shield },
  { id: 'temporal', label: 'Investigation Policy', number: 3, icon: Clock },
  { id: 'workflow', label: 'ADK Workflow', number: 4, icon: Workflow },
  { id: 'capabilities', label: 'Capabilities & Skills', number: 5, icon: Layers },
  { id: 'connectors', label: 'Connectors & Health', number: 6, icon: Database },
  { id: 'template', label: 'Template & Export', number: 7, icon: FileCode },
];

const formatConnectorValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const ProjectSetup: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ProjectSetupResponse | null>(null);
  const [activeStage, setActiveStage] = useState<SetupStage>('identity');
  const [connectorHealth, setConnectorHealth] = useState<Record<string, ConnectorHealthRecord>>({});
  const [testingConnector, setTestingConnector] = useState<string | null>(null);
  const [showPlatformHiddenConnectorFields, setShowPlatformHiddenConnectorFields] = useState(false);

  // NO DEFAULT ENVIRONMENTS: User configures target environments dynamically
  const [environments, setEnvironments] = useState<EnvironmentConfig[]>([]);
  const [isAddingEnv, setIsAddingEnv] = useState(false);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
  const [envForm, setEnvForm] = useState<EnvironmentConfig>({
    id: '',
    name: '',
    enabled: true,
    cluster: '',
    namespace: '',
    host: '',
    splunk_index: '',
    jira_env_name: '',
  });

  // Governance delegation
  const [allowUserPreferences, setAllowUserPreferences] = useState<string[]>(['presentation', 'detail']);
  const [allowUserOverrides, setAllowUserOverrides] = useState<string[]>(['incident-triage', 'log-correlation']);

  // Direct YAML editor state
  const [customYaml, setCustomYaml] = useState<string | null>(null);

  // Workflow options
  const [workflowPlanning, setWorkflowPlanning] = useState(true);
  const [workflowAttachments, setWorkflowAttachments] = useState(true);
  const [workflowSpecialists, setWorkflowSpecialists] = useState(true);
  const [workflowParallelEvidence, setWorkflowParallelEvidence] = useState(true);

  // Selected stage prompt editor
  const [selectedPromptStage, setSelectedPromptStage] = useState<string>('orchestrator');
  const [stagePrompts, setStagePrompts] = useState<Record<string, string>>({});

  // Only saved overrides and explicit edits belong in the project layer.
  const [skillOverrides, setSkillOverrides] = useState<Record<string, { enabled: boolean; instruction: string }>>({});
  const [capProfiles, setCapProfiles] = useState<Record<string, string>>({});

  const delegatedSections = payload?.platform_policy?.project_sections
    ?? (Array.isArray(payload?.policy.project_sections) ? payload.policy.project_sections as string[] : []);
  const canEditEnvironments = delegatedSections.includes('environments');

  // Disabled connectors
  const [disabledConnectors, setDisabledConnectors] = useState<string[]>([]);

  // Execution limits
  const [maxLlmCalls, setMaxLlmCalls] = useState(12);
  const [maxToolCalls, setMaxToolCalls] = useState(4);
  const [runTimeoutSeconds, setRunTimeoutSeconds] = useState(120);
  const [maxContextChars, setMaxContextChars] = useState(64000);

  // Preferences
  const [presentationPref, setPresentationPref] = useState<'summary' | 'table' | 'timeline' | 'dashboard' | 'report'>('summary');
  const [detailPref, setDetailPref] = useState<'concise' | 'standard' | 'detailed'>('standard');

  // Validation & Persistence state
  const [validationResult, setValidationResult] = useState<ProjectValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copied, setCopied] = useState(false);

  // Load initial setup from backend
  const refresh = async (savedPayload?: ProjectSetupResponse) => {
    setLoading(true);
    setError(null);
    setStatusNotice(null);
    try {
      const data = savedPayload ?? await fetchProjectSetup();
      setPayload(data);
      setCustomYaml(null);
      setValidationResult(null);
      setConnectorHealth(data.connector_health || {});

      setSkillOverrides({});
      setCapProfiles({});

      // Populate workflow flags
      if (data.runtime.workflow) {
        setWorkflowPlanning(data.runtime.workflow.planning ?? true);
        setWorkflowAttachments(data.runtime.workflow.attachments ?? true);
        setWorkflowSpecialists(data.runtime.workflow.specialists ?? true);
        setWorkflowParallelEvidence(data.runtime.workflow.parallel_evidence ?? true);
      }

      // Populate prompts
      if (data.runtime.prompts) {
        setStagePrompts(data.runtime.prompts);
      }

      const projectLayer = data.project_layer;
      if (projectLayer?.skills && typeof projectLayer.skills === 'object') {
        setSkillOverrides(Object.fromEntries(Object.entries(projectLayer.skills).map(([id, skill]) => [id, {
          enabled: (skill as { enabled?: boolean }).enabled !== false,
          instruction: (skill as { instruction?: string }).instruction || '',
        }])));
      }
      if (projectLayer?.capabilities && typeof projectLayer.capabilities === 'object') {
        setCapProfiles(Object.fromEntries(Object.entries(projectLayer.capabilities)
          .filter(([, capability]) => typeof capability === 'object' && typeof (capability as { model_profile?: string }).model_profile === 'string')
          .map(([id, capability]) => [id, (capability as { model_profile: string }).model_profile])));
      }

      // Populate disabled connectors
      if (data.runtime.disabled_connectors) {
        setDisabledConnectors([...data.runtime.disabled_connectors]);
      }

      // Populate preferences
      if (data.runtime.preferences) {
        if (data.runtime.preferences.presentation) {
          setPresentationPref(data.runtime.preferences.presentation as any);
        }
        if (data.runtime.preferences.detail) {
          setDetailPref(data.runtime.preferences.detail as any);
        }
      }

      // Populate limits
      const settings = data.runtime.settings;
      if (settings) {
        if (typeof settings.max_llm_calls === 'number') setMaxLlmCalls(settings.max_llm_calls);
        if (typeof settings.max_tool_calls === 'number') setMaxToolCalls(settings.max_tool_calls);
        if (typeof settings.run_timeout_seconds === 'number') setRunTimeoutSeconds(settings.run_timeout_seconds);
        if (typeof settings.max_context_chars === 'number') setMaxContextChars(settings.max_context_chars);
      }
      // A saved project override is the authoritative value; runtime is only the fallback.
      const projectLimits = data.project_layer?.limits as Record<string, unknown> | undefined;
      if (projectLimits && typeof projectLimits === 'object') {
        if (typeof projectLimits.max_llm_calls === 'number') setMaxLlmCalls(projectLimits.max_llm_calls);
        if (typeof projectLimits.max_tool_calls === 'number') setMaxToolCalls(projectLimits.max_tool_calls);
        if (typeof projectLimits.max_context_chars === 'number') setMaxContextChars(projectLimits.max_context_chars);
        if (typeof projectLimits.run_timeout_seconds === 'number') setRunTimeoutSeconds(projectLimits.run_timeout_seconds);
      }

      // Populate environments - NO DEFAULT ENVIRONMENTS
      const projectEnvs = data.project_layer?.environments;
      const runtimeEnvs = data.runtime?.environments;
      if (Array.isArray(projectEnvs)) {
        setEnvironments(projectEnvs as EnvironmentConfig[]);
      } else if (Array.isArray(runtimeEnvs) && runtimeEnvs.length > 0) {
        setEnvironments(runtimeEnvs as EnvironmentConfig[]);
      } else {
        setEnvironments([]);
      }

      // Populate governance delegations
      if (data.project_layer?.allow_user_preferences && Array.isArray(data.project_layer.allow_user_preferences)) {
        setAllowUserPreferences(data.project_layer.allow_user_preferences as string[]);
      }
      if (data.project_layer?.allow_user_overrides && Array.isArray(data.project_layer.allow_user_overrides)) {
        setAllowUserOverrides(data.project_layer.allow_user_overrides as string[]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load project setup snapshot.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Compute live project YAML strictly respecting platform-governed sections
  const generatedYaml = useMemo(() => {
    // JSON is valid YAML and preserves multiline strings and arbitrary configured entries.
    return JSON.stringify(buildProjectConfiguration(payload?.project_layer, {
      tenantId: payload?.scope.tenant_id || 'YOUR_TENANT_ID',
      projectId: payload?.scope.project_id || 'YOUR_PROJECT_ID',
      allowUserPreferences, allowUserOverrides,
      presentation: presentationPref, detail: detailPref, disabledConnectors, capProfiles,
      maxLlmCalls, maxToolCalls, maxContextChars, runTimeoutSeconds,
      workflow: { planning: workflowPlanning, attachments: workflowAttachments,
        specialists: workflowSpecialists, parallel_evidence: workflowParallelEvidence },
      prompts: stagePrompts, skills: skillOverrides, environments,
      delegatedSections,
    }), null, 2);
  }, [
    payload,
    delegatedSections,
    allowUserPreferences,
    allowUserOverrides,
    presentationPref,
    detailPref,
    disabledConnectors,
    capProfiles,
    maxLlmCalls,
    maxToolCalls,
    maxContextChars,
    runTimeoutSeconds,
    workflowPlanning,
    workflowAttachments,
    workflowSpecialists,
    workflowParallelEvidence,
    stagePrompts,
    skillOverrides,
    environments,
  ]);

  const activeYaml = customYaml !== null ? customYaml : generatedYaml;

  useEffect(() => {
    setValidationResult(null);
    setStatusNotice(current => current?.text.includes('platform policy checks') || current?.text.startsWith('Validation failed') ? null : current);
  }, [activeYaml]);

  const handleValidate = async () => {
    setValidating(true);
    setStatusNotice(null);
    try {
      const res = await validateProjectSetup(activeYaml);
      setValidationResult(res);
      if (res.valid) {
        setStatusNotice({
          text: 'Configuration successfully passed all platform policy checks!',
          type: 'success',
        });
      } else {
        setStatusNotice({
          text: `Validation failed with ${res.errors.length} error(s). See stage details below.`,
          type: 'error',
        });
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Validation request failed';
      setStatusNotice({ text: msg, type: 'error' });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusNotice(null);
    try {
      const updated = await saveProjectSetup(activeYaml);
      // Hydrate every control from the saved response, including direct YAML edits.
      await refresh(updated);
      setCustomYaml(null);
      setStatusNotice({
        text: 'Project configuration saved and verified against platform policy!',
        type: 'success',
      });
      setTimeout(() => setStatusNotice(null), 4000);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Failed to save configuration';
      setStatusNotice({ text: msg, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyYaml = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(activeYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([activeYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project_${payload?.scope.project_id || 'setup'}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Environment Management Handlers
  const handleOpenAddEnv = () => {
    setEnvForm({
      id: '',
      name: '',
      enabled: true,
      cluster: '',
      namespace: '',
      host: '',
      splunk_index: '',
      jira_env_name: '',
    });
    setEditingEnvId(null);
    setIsAddingEnv(true);
  };

  const handleOpenEditEnv = (env: EnvironmentConfig) => {
    setEnvForm({ ...env });
    setEditingEnvId(env.id);
    setIsAddingEnv(true);
  };

  const handleSaveEnv = () => {
    const cleanId = envForm.id.trim();
    const cleanName = envForm.name.trim();
    if (!cleanId || !cleanName) {
      alert('Environment ID and Display Name are required.');
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(cleanId)) {
      alert('Environment ID must contain only alphanumeric characters, underscores, hyphens, and dots.');
      return;
    }
    const updated: EnvironmentConfig = {
      ...envForm,
      id: cleanId,
      name: cleanName,
      cluster: envForm.cluster?.trim() || null,
      namespace: envForm.namespace?.trim() || null,
      host: envForm.host?.trim() || null,
      splunk_index: envForm.splunk_index?.trim() || null,
      jira_env_name: envForm.jira_env_name?.trim() || null,
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

  const handleToggleEnvEnabled = (id: string) => {
    setEnvironments(prev =>
      prev.map(e => (e.id === id ? { ...e, enabled: e.enabled === false ? true : false } : e))
    );
  };

  const toggleConnectorDisabled = (connector: string) => {
    setDisabledConnectors(curr =>
      curr.includes(connector) ? curr.filter(c => c !== connector) : [...curr, connector]
    );
  };

  const availableSkills = payload?.available_skills || [];
  const availableCaps = payload?.available_capabilities || [];
  const stageDefs = payload?.stage_definitions || [];
  const modelProfiles = payload?.platform_policy?.model_profiles || [
    'balanced-investigation',
    'fast-investigation',
    'high-reasoning-synthesis',
  ];
  const connectorFieldGroups: Record<string, ConnectorParameterField[]> = useMemo(() => {
    const map: Record<string, ConnectorParameterField[]> = {};
    for (const field of payload?.connector_fields || []) {
      if (!field.tool) continue;
      if (!map[field.tool]) map[field.tool] = [];
      map[field.tool].push(field);
    }
    return map;
  }, [payload]);
  const connectorHealthOrder = useMemo(
    () => [
      ...new Set([
        ...Object.keys(connectorHealth),
        ...Object.keys(connectorFieldGroups),
      ]),
    ].sort(),
    [connectorHealth, connectorFieldGroups]
  );

  const handleTestConnector = async (connector: string) => {
    setTestingConnector(connector);
    setStatusNotice({
      text: `Testing ${connector} connectivity…`,
      type: 'info',
    });
    try {
      const probe = await fetchConnectorHealthCheck(connector);
      setConnectorHealth(current => ({ ...current, [connector]: probe }));
      setStatusNotice({
        text: `${connector} probe completed with status ${probe.overall}.`,
        type: probe.overall === 'HEALTHY' ? 'success' : 'error',
      });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Connector test failed';
      setStatusNotice({ text: msg, type: 'error' });
    } finally {
      setTestingConnector(null);
    }
  };

  return (
    <div className="view-container">
      {/* Page Header */}
      <header className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h1 style={{ margin: 0 }}>Project <span>Settings &amp; Scoped Configuration</span></h1>
            <span className="badge badge-active" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Project Scope
            </span>
          </div>
          <p className="lede">
            Configure project-specific parameters stage by stage. Governed by rules enabled at the platform level (<code>platform.yaml</code>).
          </p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-outline"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh setup snapshot from server"
          >
            <RefreshCw size={13} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => void handleValidate()}
            disabled={validating || !payload}
            title="Validate configuration against platform policy"
          >
            <ShieldCheck size={13} /> {validating ? 'Validating…' : 'Validate Rules'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || !payload}
            title="Save project configuration to server"
          >
            <Save size={13} /> {saving ? 'Saving…' : 'Save Setup'}
          </button>
          <button
            className="btn btn-outline"
            onClick={handleCopyYaml}
            title="Copy configured YAML template"
          >
            {copied ? <Check size={13} style={{ color: 'var(--acc)' }} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy YAML'}
          </button>
          <button
            className="btn btn-outline"
            onClick={handleDownloadYaml}
            title="Download YAML template for multi-project replication"
          >
            <Download size={13} /> Download
          </button>
        </div>
      </header>

      {/* Scope Clarification Alert */}
      <div
        style={{
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FolderGit2 size={18} style={{ color: 'var(--green, #10b981)', flexShrink: 0 }} />
          <div style={{ fontSize: '13px' }}>
            <strong style={{ color: 'var(--tx, #f8fafc)' }}>
              Project Scope: <code>{payload?.scope.tenant_id || 'tenant'} / {payload?.scope.project_id || 'project'}</code>
            </strong>
            <span style={{ color: 'var(--muted, #cbd5e1)', marginLeft: '8px' }}>
              These parameters configure project-specific capability overrides, custom stage prompts, and delegated rules. Governed by <strong>Platform Settings</strong> (<code>platform.yaml</code>).
            </span>
          </div>
        </div>
        <a
          className="btn btn-outline"
          href="#settings"
          style={{ fontSize: '12px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          View Platform Settings →
        </a>
      </div>

      {/* Notices */}
      {error && (
        <div className="notice-banner red" role="alert">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {statusNotice && (
        <div
          className={`notice-banner ${statusNotice.type === 'error' ? 'red' : ''}`}
          style={{
            borderColor: statusNotice.type === 'success' ? 'var(--acc)' : undefined,
            color: statusNotice.type === 'success' ? 'var(--acc)' : undefined,
          }}
        >
          {statusNotice.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {statusNotice.text}
        </div>
      )}

      {loading && !payload && (
        <div className="notice-banner">Loading live project setup & platform policy…</div>
      )}

      {payload && (
        <>
          {/* Top Scope Metrics */}
          <section className="metric-grid" style={{ marginBottom: 20 }}>
            <div className="metric-card">
              <div className="metric-label-row">
                <span>Scope & Mode</span>
                <FolderGit2 size={15} />
              </div>
              <div className="metric-value" style={{ fontSize: 16, wordBreak: 'break-all' }}>
                {payload.scope.tenant_id} / {payload.scope.project_id}
              </div>
              <p className="metric-meta">
                Mode: <span className="meta-pill">{payload.scope.mode.toUpperCase()}</span> · Subject: <strong>{payload.scope.subject}</strong>
              </p>
            </div>

            <div className="metric-card">
              <div className="metric-label-row">
                <span>Platform Delegation</span>
                <ShieldCheck size={15} />
              </div>
              <div className="metric-value">
                {payload.platform_policy?.project_sections.length || 7} Sections
              </div>
              <p className="metric-meta">
                Delegated: {payload.platform_policy?.project_sections.slice(0, 4).join(', ')}…
              </p>
            </div>

            <div className="metric-card">
              <div className="metric-label-row">
                <span>Platform Skill Rules</span>
                <ShieldAlert size={15} />
              </div>
              <div className="metric-value">
                {availableSkills.filter(s => s.immutable).length} Locked · {availableSkills.filter(s => !s.immutable).length} Overridable
              </div>
              <p className="metric-meta">
                Immutable: {availableSkills.filter(s => s.immutable).map(s => s.id).join(', ') || 'none'}
              </p>
            </div>

            <div className="metric-card">
              <div className="metric-label-row">
                <span>Connectors & Probes</span>
                <Database size={15} />
              </div>
              <div className="metric-value">
                {Object.keys(payload.connector_health).length} Active
              </div>
              <p className="metric-meta">
                Disabled: {disabledConnectors.length > 0 ? disabledConnectors.join(', ') : 'none'}
              </p>
            </div>
          </section>

          {/* Stepper Navigation Bar */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              overflowX: 'auto',
              paddingBottom: 6,
              marginBottom: 20,
              borderBottom: '1px solid var(--line)',
            }}
          >
            {STAGES.map(stage => {
              const Icon = stage.icon;
              const isActive = activeStage === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => setActiveStage(stage.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? 'var(--tx)' : 'var(--muted)',
                    background: isActive ? 'var(--card-subtle)' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--acc)' : '2px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: isActive ? 'var(--acc)' : 'var(--line)',
                      color: isActive ? '#000' : 'var(--muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {stage.number}
                  </span>
                  <Icon size={14} color={isActive ? 'var(--acc)' : 'var(--muted)'} />
                  {stage.label}
                </button>
              );
            })}
          </div>

          {/* STAGE 1: IDENTITY & SCOPE */}
          {activeStage === 'identity' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FolderGit2 size={16} style={{ color: 'var(--acc)' }} /> Stage 1: Project Identity & Deployment Scope
                    </h3>
                    <p className="card-desc">
                      Defines project identifiers, target environments, and organizational boundaries.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div style={{ gridColumn: '1 / -1' }} className="notice-banner" role="note">
                    Tenant and project identity are fixed by the deployment. Display metadata and operational timezone are not exposed by the project configuration API.
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                      TENANT IDENTIFIER (IMMUTABLE SERVER SCOPE)
                    </label>
                    <input
                      type="text"
                      value={payload.scope.tenant_id}
                      disabled
                      style={{ width: '100%', padding: 9, background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 6 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                      PROJECT IDENTIFIER (IMMUTABLE SERVER SCOPE)
                    </label>
                    <input
                      type="text"
                      value={payload.scope.project_id}
                      disabled
                      style={{ width: '100%', padding: 9, background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 6 }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'block' }}>
                        TARGET ENVIRONMENTS & CONNECTOR MAPPINGS
                      </label>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                        No default environments are assumed. Add deployment environments (e.g. Production, Staging) with their corresponding host, namespace, cluster, and log index. Triage and log search agents use these details to target the correct infrastructure.
                      </p>
                    </div>
                    {!isAddingEnv && canEditEnvironments && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleOpenAddEnv}
                        style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                      >
                        + Add Environment
                      </button>
                    )}
                  </div>

                  {/* Add / Edit Form Modal/Card */}
                  {!canEditEnvironments && environments.length > 0 && (
                    <p className="metric-meta">Environment settings are read-only because this deployment has not delegated them to projects.</p>
                  )}
                  {isAddingEnv && canEditEnvironments && (
                    <div style={{ padding: 16, border: '1px solid var(--acc)', borderRadius: 8, background: 'var(--card-subtle)', marginBottom: 16 }}>
                      <h4 style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--acc)', fontWeight: 700 }}>
                        {editingEnvId ? `Edit Environment: ${editingEnvId}` : 'Add New Target Environment'}
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            ENVIRONMENT ID * (e.g. prod, staging, dev-us)
                          </label>
                          <input
                            type="text"
                            value={envForm.id}
                            disabled={!!editingEnvId}
                            onChange={e => setEnvForm({ ...envForm, id: e.target.value })}
                            placeholder="prod"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            DISPLAY NAME * (e.g. Production US-East)
                          </label>
                          <input
                            type="text"
                            value={envForm.name}
                            onChange={e => setEnvForm({ ...envForm, name: e.target.value })}
                            placeholder="Production Cluster"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            HOST / DOMAIN (e.g. checkout.prod.internal)
                          </label>
                          <input
                            type="text"
                            value={envForm.host || ''}
                            onChange={e => setEnvForm({ ...envForm, host: e.target.value })}
                            placeholder="api.company.internal"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            K8S NAMESPACE (e.g. payments, default)
                          </label>
                          <input
                            type="text"
                            value={envForm.namespace || ''}
                            onChange={e => setEnvForm({ ...envForm, namespace: e.target.value })}
                            placeholder="payments"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            CLUSTER (e.g. k8s-prod-us-east-1)
                          </label>
                          <input
                            type="text"
                            value={envForm.cluster || ''}
                            onChange={e => setEnvForm({ ...envForm, cluster: e.target.value })}
                            placeholder="k8s-prod-01"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            SPLUNK LOG INDEX (e.g. app_prod_logs)
                          </label>
                          <input
                            type="text"
                            value={envForm.splunk_index || ''}
                            onChange={e => setEnvForm({ ...envForm, splunk_index: e.target.value })}
                            placeholder="app_prod_logs"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                            JIRA ENVIRONMENT NAME (e.g. Production)
                          </label>
                          <input
                            type="text"
                            value={envForm.jira_env_name || ''}
                            onChange={e => setEnvForm({ ...envForm, jira_env_name: e.target.value })}
                            placeholder="Production"
                            style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={envForm.enabled !== false}
                              onChange={e => setEnvForm({ ...envForm, enabled: e.target.checked })}
                            />
                            <span>Enabled for Investigation Runs</span>
                          </label>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn btn-primary" onClick={handleSaveEnv} style={{ fontSize: 12 }}>
                          {editingEnvId ? 'Update Environment' : 'Save Environment'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => { setIsAddingEnv(false); setEditingEnvId(null); }}
                          style={{ fontSize: 12 }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* List of Configured Environments */}
                  {environments.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', background: 'var(--bg)', border: '1px dashed var(--line)', borderRadius: 8, color: 'var(--muted)' }}>
                      <Boxes size={28} style={{ margin: '0 auto 8px', opacity: 0.5, display: 'block' }} />
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>No environments configured</div>
                      <div style={{ fontSize: 12 }}>{canEditEnvironments ? 'Use Add Environment to connect your cluster, namespace, host, and Splunk index.' : 'Environment configuration is not delegated by this deployment. Contact a platform administrator to manage its policy.'}</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {environments.map(env => (
                        <div
                          key={env.id}
                          style={{
                            padding: 14,
                            border: `1px solid ${env.enabled !== false ? 'var(--line)' : 'rgba(239,68,68,0.3)'}`,
                            borderRadius: 6,
                            background: 'var(--card-subtle)',
                            opacity: env.enabled !== false ? 1 : 0.7,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong style={{ fontSize: 13 }}>{env.name}</strong>
                              <code style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg)', borderRadius: 4 }}>{env.id}</code>
                              <span className={`badge ${env.enabled !== false ? 'badge-active' : 'badge-failed'}`}>
                                {env.enabled !== false ? 'ACTIVE' : 'DISABLED'}
                              </span>
                            </div>
                            <fieldset disabled={!canEditEnvironments} style={{ display: 'flex', gap: 6, border: 0, padding: 0, margin: 0 }}>
                              <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => handleOpenEditEnv(env)}
                                style={{ fontSize: 11, padding: '3px 8px' }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => handleToggleEnvEnabled(env.id)}
                                style={{ fontSize: 11, padding: '3px 8px' }}
                              >
                                {env.enabled !== false ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => handleDeleteEnv(env.id)}
                                style={{ fontSize: 11, padding: '3px 8px', color: '#ef4444' }}
                              >
                                Remove
                              </button>
                            </fieldset>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                            <div>Host: <strong style={{ color: 'var(--text)' }}>{env.host || 'unspecified'}</strong></div>
                            <div>Namespace: <strong style={{ color: 'var(--text)' }}>{env.namespace || 'unspecified'}</strong></div>
                            <div>Cluster: <strong style={{ color: 'var(--text)' }}>{env.cluster || 'unspecified'}</strong></div>
                            <div>Splunk Index: <strong style={{ color: 'var(--text)' }}>{env.splunk_index || 'default'}</strong></div>
                            <div>Jira Env: <strong style={{ color: 'var(--text)' }}>{env.jira_env_name || env.id}</strong></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="card" style={{ padding: 20 }}>
                <h4 style={{ fontSize: 13, margin: '0 0 12px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  Server Principals for this Project Scope
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {Object.entries(payload.runtime.settings?.principals || {}).map(([sub, p]: [string, any]) => (
                    <div key={sub} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--card-subtle)' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{p.username || sub}</span>
                        <span className="meta-pill">{(p.roles || []).join(', ')}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        Subject: {sub} · Authn: {p.authn_method || 'token'}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* STAGE 2: GOVERNANCE & PLATFORM DELEGATION */}
          {activeStage === 'governance' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Shield size={16} style={{ color: 'var(--acc)' }} /> Stage 2: Governance & Platform Delegation Rules
                    </h3>
                    <p className="card-desc">
                      Rules defined in <code>platform.yaml</code> dictate exactly which sections and capabilities can be configured.
                    </p>
                  </div>
                </div>

                <div style={{ padding: 14, background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--acc)' }}>
                    Platform Section Delegation Matrix
                  </h4>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                    A project cannot declare sections outside this delegated set. Attempting to introduce arbitrary root keys will be rejected.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {(payload.platform_policy?.project_sections || []).map(sec => (
                      <span key={sec} className="badge badge-active" style={{ fontSize: 11 }}>
                        ✓ {sec}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                  <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Lock size={14} style={{ color: '#ef4444' }} /> Read-Only Enforcement
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                      Live connectors (Jira, Splunk) operate strictly in bounded read-only mode. Database writes and shell execution are denied.
                    </p>
                  </div>

                  <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <ShieldCheck size={14} style={{ color: '#10b981' }} /> Secret Reference Policy
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                      Plaintext secrets are forbidden. Credentials must resolve through environment variable references (e.g. <code>env://TOKEN</code>).
                    </p>
                  </div>

                  <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <SlidersHorizontal size={14} style={{ color: 'var(--acc)' }} /> Precedence Hierarchy
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                      Resolution precedence: <code>Platform &gt; Project &gt; Environment &gt; Profile &gt; Run</code>. Platform defaults fail closed.
                    </p>
                  </div>
                </div>

                <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                  <div style={{ padding: 16, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card-subtle)' }}>
                    <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>
                      Delegated User Preferences (allow_user_preferences)
                    </h4>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
                      Allow individual users to override these display preferences in their personal profiles.
                    </p>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {(payload.platform_policy?.user_preferences || ['presentation', 'detail']).map(pref => {
                        const checked = allowUserPreferences.includes(pref);
                        return (
                          <label key={pref} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => {
                                if (e.target.checked) {
                                  setAllowUserPreferences(prev => [...prev, pref]);
                                } else {
                                  setAllowUserPreferences(prev => prev.filter(p => p !== pref));
                                }
                              }}
                            />
                            <span><code>{pref}</code> preference delegation</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ padding: 16, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card-subtle)' }}>
                    <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>
                      Delegated User Skill Overrides (allow_user_overrides)
                    </h4>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
                      Allow users to customize instructions for non-immutable skills.
                    </p>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {availableSkills.map(skill => {
                        const checked = allowUserOverrides.includes(skill.id);
                        const isImmutable = skill.immutable;
                        return (
                          <label
                            key={skill.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 12,
                              cursor: isImmutable ? 'not-allowed' : 'pointer',
                              opacity: isImmutable ? 0.6 : 1,
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="checkbox"
                                disabled={isImmutable}
                                checked={!isImmutable && checked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setAllowUserOverrides(prev => [...prev, skill.id]);
                                  } else {
                                    setAllowUserOverrides(prev => prev.filter(s => s !== skill.id));
                                  }
                                }}
                              />
                              <code>{skill.name || skill.id}</code>
                            </span>
                            {isImmutable ? (
                              <span className="badge badge-failed" style={{ fontSize: 10 }}>
                                <Lock size={10} /> PLATFORM IMMUTABLE
                              </span>
                            ) : (
                              <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                                USER OVERRIDE PERMITTED
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* STAGE 3: INVESTIGATION TIME POLICY */}
          {activeStage === 'temporal' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Clock size={16} style={{ color: 'var(--acc)' }} /> Stage 3: Investigation Time & Temporal Policy
                    </h3>
                    <p className="card-desc">
                      Controls incident time anchor resolution, source confidence ranking, and connector search windows.
                    </p>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                    OPERATIONAL TIMEZONE (IANA FORMAT)
                  </label>
                  <p className="metric-meta">Not exposed by the deployment API. Investigation timestamps must include their timezone.</p>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Anchor Resolution Priority & Confidence Ranking
                  </h4>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {[
                      { source: 'explicit_incident_timestamp', confidence: '1.0', desc: 'Analyst or ticket header explicitly specifies incident time' },
                      { source: 'transaction_timestamp', confidence: '0.95', desc: 'Failed transaction event timestamp in payload' },
                      { source: 'qtest_failure_timestamp', confidence: '0.90', desc: 'Automated test suite failure event' },
                      { source: 'trace_error_timestamp', confidence: '0.90', desc: 'APM or distributed trace exception event' },
                      { source: 'jira_description_reported_time', confidence: '0.85', desc: 'Regex-extracted time from issue narrative' },
                      { source: 'jira_created (Fallback)', confidence: '0.70', desc: 'Ticket creation timestamp (guaranteed fallback)' },
                    ].map((row, idx) => (
                      <div
                        key={row.source}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          background: 'var(--card-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontWeight: 700, color: 'var(--acc)', fontSize: 12 }}>#{idx + 1}</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{row.source}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.desc}</div>
                          </div>
                        </div>
                        <span className="meta-pill" style={{ fontWeight: 600 }}>Confidence: {row.confidence}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Connector Time Windows (Bounded Extraction)
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Jira ITSM Discovery</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Lookback: <strong>7 Days (P7D)</strong></div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Historical Search: Up to 365 Days</div>
                    </div>
                    <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Splunk Log Correlation</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Initial Window: <strong>±1 Hour (PT1H)</strong></div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Adaptive Max: 1 Day (P1D)</div>
                    </div>
                    <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Distributed Tracing</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Trace Window: <strong>±2 Hours (PT2H)</strong></div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Max Lookback: 1 Day (P1D)</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* STAGE 4: ADK WORKFLOW & STAGES */}
          {activeStage === 'workflow' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Workflow size={16} style={{ color: 'var(--acc)' }} /> Stage 4: ADK Workflow & Stage Prompt Configuration
                    </h3>
                    <p className="card-desc">
                      Configure native Google ADK graph orchestration flags and custom stage system instructions.
                    </p>
                  </div>
                </div>

                {/* Workflow Toggles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={workflowPlanning}
                      onChange={e => setWorkflowPlanning(e.target.checked)}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Planning Stage</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Classifies request & bounds tools</div>
                    </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={workflowAttachments}
                      onChange={e => setWorkflowAttachments(e.target.checked)}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Attachments Extraction</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Document & image OCR parsing</div>
                    </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={workflowSpecialists}
                      onChange={e => setWorkflowSpecialists(e.target.checked)}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Approved Specialists</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Dispatches project domain agents</div>
                    </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={workflowParallelEvidence}
                      onChange={e => setWorkflowParallelEvidence(e.target.checked)}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Parallel Evidence</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Runs ITSM & Logs concurrently</div>
                    </div>
                  </label>
                </div>

                {/* Stage Prompts Selector */}
                <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  Stage System Prompt Instructions
                </h4>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {stageDefs.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedPromptStage(s.id)}
                      className={`btn ${selectedPromptStage === s.id ? 'btn-primary' : 'btn-outline'}`}
                      style={{ fontSize: 11, padding: '5px 10px' }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {stageDefs.find(s => s.id === selectedPromptStage)?.name || selectedPromptStage}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Default Profile: <strong>{stageDefs.find(s => s.id === selectedPromptStage)?.default_model || 'configured'}</strong>
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    value={stagePrompts[selectedPromptStage] || ''}
                    onChange={e =>
                      setStagePrompts({ ...stagePrompts, [selectedPromptStage]: e.target.value })
                    }
                    style={{
                      width: '100%',
                      padding: 10,
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  />
                </div>
              </section>
            </div>
          )}

          {/* STAGE 5: CAPABILITIES & SKILLS (PLATFORM GOVERNED) */}
          {activeStage === 'capabilities' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Layers size={16} style={{ color: 'var(--acc)' }} /> Stage 5: Capabilities & Skills (Platform Governed)
                    </h3>
                    <p className="card-desc">
                      <strong>Platform Enforcement:</strong> Only rules enabled on the platform level are available for projects. Immutable platform skills cannot be altered.
                    </p>
                  </div>
                </div>

                {/* Platform Skills Rule Table */}
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Platform Skill Immutability & Override Matrix
                  </h4>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {availableSkills.map(skill => (
                      <div
                        key={skill.id}
                        style={{
                          padding: 14,
                          border: `1px solid ${skill.immutable ? 'rgba(239,68,68,0.3)' : 'var(--line)'}`,
                          borderRadius: 6,
                          background: skill.immutable ? 'rgba(239,68,68,0.02)' : 'var(--card-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {skill.immutable ? (
                              <Lock size={15} style={{ color: '#ef4444' }} />
                            ) : (
                              <Unlock size={15} style={{ color: '#10b981' }} />
                            )}
                            <strong style={{ fontSize: 13 }}>{skill.name}</strong>
                            <span
                              className={`badge ${skill.immutable ? 'badge-failed' : 'badge-active'}`}
                              style={{ fontSize: 10 }}
                            >
                              {skill.immutable ? 'PLATFORM IMMUTABLE' : 'PROJECT OVERRIDABLE'}
                            </span>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            Actions: {skill.actions.join(', ') || 'none'}
                          </span>
                        </div>

                        {skill.immutable ? (
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                            This skill is locked by platform policy. Projects cannot modify its actions, override instructions, or disable it.
                          </p>
                        ) : (
                          <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                              CUSTOM PROJECT INSTRUCTION OVERRIDE
                            </label>
                            <input
                              type="text"
                              value={skillOverrides[skill.id]?.instruction || ''}
                              onChange={e =>
                                setSkillOverrides({
                                  ...skillOverrides,
                                  [skill.id]: {
                                    enabled: skillOverrides[skill.id]?.enabled ?? true,
                                    instruction: e.target.value,
                                  },
                                })
                              }
                              placeholder="Project-specific guidance for this skill…"
                              style={{
                                width: '100%',
                                padding: 8,
                                background: 'var(--bg)',
                                color: 'var(--text)',
                                border: '1px solid var(--line)',
                                borderRadius: 6,
                                fontSize: 12,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Capabilities Configuration */}
                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Configured Capabilities & Model Profiles
                  </h4>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {availableCaps.map(cap => (
                      <div
                        key={cap.id}
                        style={{
                          padding: 14,
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          background: 'var(--card-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <strong style={{ fontSize: 13 }}>{cap.name}</strong>{' '}
                            <span className="meta-pill">{cap.id}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Model Profile:</label>
                            <select
                              value={capProfiles[cap.id] || cap.model_profile || 'balanced-investigation'}
                              onChange={e =>
                                setCapProfiles({ ...capProfiles, [cap.id]: e.target.value })
                              }
                              style={{
                                padding: '4px 8px',
                                background: 'var(--bg)',
                                color: 'var(--text)',
                                border: '1px solid var(--line)',
                                borderRadius: 4,
                                fontSize: 11,
                              }}
                            >
                              {modelProfiles.map(p => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                          {cap.description}
                        </p>
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                          Allowed Actions: <strong>{(cap.permissions?.allowed_actions || []).join(', ')}</strong> · Allowed Roles: <strong>{(cap.permissions?.allowed_roles || []).join(', ')}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* STAGE 6: CONNECTORS & HEALTH */}
          {activeStage === 'connectors' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Database size={16} style={{ color: 'var(--acc)' }} /> Stage 6: Connectors & Live Health Snapshot
                    </h3>
                    <p className="card-desc">
                      Configure connector enablement for this project scope and inspect real-time connector probe diagnostics.
                    </p>
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Active Connector Health Checks
                  </h4>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={showPlatformHiddenConnectorFields}
                      onChange={e => setShowPlatformHiddenConnectorFields(e.target.checked)}
                    />
                    <span>Show platform-only fields in connector panels</span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                    {connectorHealthOrder.length === 0 && (
                      <p>No connector definitions are currently loaded for this project scope.</p>
                    )}
                    {connectorHealthOrder.map((name) => {
                      const probe = connectorHealth[name];
                      const fields = connectorFieldGroups[name] || [];
                      const visibleFields = showPlatformHiddenConnectorFields
                        ? fields
                        : fields.filter(field => field.project_visible);
                      return (
                        <div
                          key={name}
                          style={{
                            padding: 14,
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            background: 'var(--card-subtle)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <strong style={{ fontSize: 13, textTransform: 'uppercase' }}>{name}</strong>
                            {probe ? (
                              <span
                                className={`badge ${
                                  probe.overall === 'HEALTHY'
                                    ? 'badge-active'
                                    : probe.overall === 'DEGRADED'
                                    ? 'badge-pending'
                                    : 'badge-failed'
                                }`}
                              >
                                {probe.overall}
                              </span>
                            ) : (
                              <span className="badge badge-pending">NO PROBE</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'grid', gap: 4 }}>
                            <div>Latency: <strong>{probe?.latency_ms ?? 'n/a'} ms</strong></div>
                            <div>Authentication: {probe?.authentication ?? 'unknown'}</div>
                            <div>Schema Compatibility: {probe?.schema_compatibility ?? 'unknown'}</div>
                            {probe?.message && <div style={{ fontSize: 11, color: 'var(--acc)' }}>{probe.message}</div>}
                          </div>
                          <div style={{ marginTop: 10, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <button
                              className="btn btn-outline"
                              onClick={() => void handleTestConnector(name)}
                              disabled={testingConnector === name}
                              style={{ fontSize: 11 }}
                            >
                              {testingConnector === name ? 'Testing…' : 'Test connector'}
                            </button>
                          </div>
                          <div style={{ display: 'grid', gap: 10 }}>
                            <strong style={{ fontSize: 12, color: 'var(--muted)' }}>Connector Parameters</strong>
                            {visibleFields.length === 0 && (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                                No project-visible parameters are defined for this connector.
                              </span>
                            )}
                            {visibleFields.map(field => (
                              <div
                                key={`${name}.${field.variable_name}`}
                                style={{ borderTop: '1px dashed var(--line)', paddingTop: 10 }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <strong style={{ fontSize: 12 }}>{field.variable_name}</strong>
                                  <span className="settings-tags" style={{ display: 'inline-flex', gap: 6 }}>
                                    <span className="badge badge-neutral">{field.value_type}</span>
                                    <span className="badge badge-neutral">rev {field.revision}</span>
                                    <span className={`badge ${field.allow_project_override ? 'badge-active' : 'badge-failed'}`}>
                                      {field.allow_project_override ? 'Override allowed' : 'Locked'}
                                    </span>
                                    {!field.project_visible && <span className="badge badge-pending">Platform-only</span>}
                                    <span className="badge badge-neutral">{field.source}</span>
                                  </span>
                                </div>
                                <p style={{ marginTop: 0, marginBottom: 6, fontSize: 11, color: 'var(--muted)' }}>{field.description}</p>
                                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
                                  Default: <code>{formatConnectorValue(field.default_value)}</code>
                                </p>
                                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
                                  Effective: <code>{formatConnectorValue(field.effective_value)}</code>
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Project Connector Disablement Toggles
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                    Projects can explicitly disable platform connectors when not needed for this scope.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {connectorHealthOrder.map(conn => {
                      const isDisabled = disabledConnectors.includes(conn);
                      return (
                        <button
                          key={conn}
                          type="button"
                          onClick={() => toggleConnectorDisabled(conn)}
                          className={`btn ${isDisabled ? 'btn-outline' : 'btn-primary'}`}
                          style={{ fontSize: 12 }}
                        >
                          {conn.toUpperCase()}: {isDisabled ? 'DISABLED' : 'ENABLED'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* STAGE 7: LIMITS, PREFERENCES & TEMPLATE WORKBENCH */}
          {activeStage === 'template' && (
            <div style={{ display: 'grid', gap: 20 }}>
              <section className="card" style={{ padding: 20 }}>
                <div className="card-top" style={{ marginBottom: 16 }}>
                  <div className="card-main">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileCode size={16} style={{ color: 'var(--acc)' }} /> Stage 7: Execution Limits, Preferences & Canonical Template
                    </h3>
                    <p className="card-desc">
                      Configure resource guardrails and inspect the live-generated multi-project template. Validate directly with platform rules.
                    </p>
                  </div>
                  <div className="card-actions" style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => void handleValidate()}
                      disabled={validating}
                    >
                      <ShieldCheck size={13} /> {validating ? 'Validating…' : 'Validate YAML'}
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={() => void handleSave()}
                      disabled={saving}
                    >
                      <Save size={13} /> {saving ? 'Saving…' : 'Save to Project'}
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={handleCopyYaml}
                    >
                      {copied ? <Check size={13} style={{ color: 'var(--acc)' }} /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={handleDownloadYaml}
                    >
                      <Download size={13} /> Download
                    </button>
                  </div>
                </div>

                {/* Execution Limits & Preferences Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      MAX LLM CALLS (1-100)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={maxLlmCalls}
                      onChange={e => setMaxLlmCalls(parseInt(e.target.value, 10) || 12)}
                      style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      MAX TOOL CALLS (1-100)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={maxToolCalls}
                      onChange={e => setMaxToolCalls(parseInt(e.target.value, 10) || 4)}
                      style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      RUN TIMEOUT (SECONDS)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={900}
                      value={runTimeoutSeconds}
                      onChange={e => setRunTimeoutSeconds(parseInt(e.target.value, 10) || 120)}
                      style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      MAX CONTEXT CHARS (1,000-256,000)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      max={256000}
                      value={maxContextChars}
                      onChange={e => setMaxContextChars(parseInt(e.target.value, 10) || 64000)}
                      style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      PRESENTATION PREFERENCE
                    </label>
                    <select
                      value={presentationPref}
                      onChange={e => setPresentationPref(e.target.value as any)}
                      style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                    >
                      <option value="summary">Summary</option>
                      <option value="table">Table</option>
                      <option value="timeline">Timeline</option>
                      <option value="dashboard">Dashboard</option>
                      <option value="report">Report</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      DETAIL PREFERENCE
                    </label>
                    <select
                      value={detailPref}
                      onChange={e => setDetailPref(e.target.value as any)}
                      style={{ width: '100%', padding: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6 }}
                    >
                      <option value="concise">Concise</option>
                      <option value="standard">Standard</option>
                      <option value="detailed">Detailed</option>
                    </select>
                  </div>
                </div>

                {/* Validation Feedback */}
                {validationResult && (
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 6,
                      marginBottom: 16,
                      border: `1px solid ${validationResult.valid ? '#10b981' : '#ef4444'}`,
                      background: validationResult.valid ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: validationResult.valid ? '#10b981' : '#ef4444' }}>
                      {validationResult.valid ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                      {validationResult.valid
                        ? 'Platform Policy Validation Passed'
                        : `Platform Policy Rejected Configuration (${validationResult.errors.length} error(s))`}
                    </div>
                    {validationResult.errors.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12, color: '#ef4444' }}>
                        {validationResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Live Editable Multi-Project YAML */}
                <div className="prompt-panel">
                  <div className="prompt-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>Project YAML Configuration & Template</span>
                      {customYaml !== null && (
                        <span className="badge badge-pending" style={{ fontSize: 10 }}>CUSTOM EDITS ACTIVE</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {customYaml !== null && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => setCustomYaml(null)}
                          style={{ fontSize: 11, padding: '2px 8px' }}
                        >
                          Reset to Form-Generated YAML
                        </button>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Path: {payload.project_file.path || 'project.yaml'}</span>
                    </div>
                  </div>
                  <textarea
                    value={activeYaml}
                    onChange={e => setCustomYaml(e.target.value)}
                    rows={24}
                    style={{
                      width: '100%',
                      padding: 12,
                      fontFamily: 'monospace',
                      fontSize: 12,
                      lineHeight: 1.5,
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      resize: 'vertical',
                      whiteSpace: 'pre',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                    <span>You can edit this YAML directly above, or tweak parameters across Stages 1–6. Validation and Save actions use the active YAML content.</span>
                    <span>{activeYaml.split('\n').length} lines</span>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
};
