import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  ShieldCheck,
  Clock,
  Workflow,
  Copy,
  Check,
  Save,
  Download,
  Database,
  CheckCircle2,
  AlertCircle,
  FolderGit2,
  Boxes,
  Search,
  X,
  Edit3,
  ChevronRight,
  ChevronLeft,
  Info,
  Wrench,
  Link2,
  SlidersHorizontal,
  CheckSquare,
  Users as UsersIcon,
  Trash2,
  Plus,
  Code,
} from 'lucide-react';
import {
  ApiError,
  fetchProjectSetup,
  fetchProjectEditor,
  fetchProjectRedaction,
  previewProjectRedaction,
  fetchPrincipal,
  fetchUsers,
  fetchConnectorTemplates,
  fetchProjectConnectors,
  deleteProjectConnector,
  validateProjectSetup,
  saveProjectSetup,
  saveProjectEditor,
} from '../services/api';
import type {
  ProjectSetupResponse,
  UserItem,
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
  ConnectorInstance,
  RcaAssistFullConfigurationData,
  formatToYaml,
} from '../utils/projectSetupConfig';
import '../styles/project-setup.css';
import { ProjectHarnessSetup } from '../components/ProjectHarnessSetup';
import { ParameterSettingsPanel } from '../components/ParameterSettingsPanel';
import { KnowledgeDocumentForm } from '../components/KnowledgeDocumentForm';


const STEPS = [
  { number: 1, id: 'basic', title: 'Basic information', desc: 'Name and purpose', icon: FolderGit2 },
  { number: 2, id: 'scope', title: 'Setup', desc: 'Environments, people and policies', icon: Boxes },
  { number: 3, id: 'connectors-tools', title: 'Connectors & tools', desc: 'Connect your sources', icon: Database },
  { number: 4, id: 'parameters', title: 'Parameter setup', desc: 'Review inherited settings', icon: SlidersHorizontal },
  { number: 5, id: 'time', title: 'Monitoring setup', desc: 'Queries and availability', icon: Clock },
  { number: 6, id: 'agents', title: 'Agent setup', desc: 'Choose the project harness', icon: Workflow },
  { number: 7, id: 'review', title: 'Review & apply', desc: 'Validate and start investigating', icon: CheckSquare },
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

export const ProjectSetup: React.FC<{ onNewInvestigation?: () => void; onOverview: () => void; onApplied?: () => void }> = ({ onNewInvestigation, onOverview, onApplied }) => {
  const [applied, setApplied] = useState(false);
  const [validatedSnapshot, setValidatedSnapshot] = useState('');
  const [conflictDraft, setConflictDraft] = useState<Record<string, unknown> | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [savedDraft, setSavedDraft] = useState('');
  const needsDraftBaseline = useRef(true);
  const [initialDraft, setInitialDraft] = useState<Record<string, unknown>>({});
  const [currentStep, setCurrentStep] = useState<number>(() => STEPS.find(step => step.id === new URLSearchParams(window.location.search).get('step'))?.number || 1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ProjectSetupResponse | null>(null);
  const [redactionPolicy, setRedactionPolicy] = useState<ProjectRedactionPolicy | null>(null);
  const [redactionSample, setRedactionSample] = useState('');
  const [redactionPreview, setRedactionPreview] = useState<RedactionPreviewResponse | null>(null);
  const [redactionPreviewError, setRedactionPreviewError] = useState<string | null>(null);
  const [redactionPreviewLoading, setRedactionPreviewLoading] = useState(false);
  const [principal, setPrincipal] = useState<import('../types/api').Principal | null>(null);
  const [editorVersion, setEditorVersion] = useState<number>(0);
  const [showSidebar, setShowSidebar] = useState<boolean>(false);
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
  const [memberId, setMemberId] = useState('');
  const [projectUsers, setProjectUsers] = useState<UserItem[]>([]);
  const [membersError, setMembersError] = useState('');

  const [step5Tab, setStep5Tab] = useState<'connectors' | 'tools' | 'mapping'>('connectors');

  // Step 5: Connectors & Tools Lifecycle Management
  const [persistedConnectors, setPersistedConnectors] = useState<ProjectConnectorInstanceItem[]>([]);
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplateItem[]>([]);
  const [editingConnector, setEditingConnector] = useState<{
    template?: ConnectorTemplateItem;
    instance?: ProjectConnectorInstanceItem;
  } | null>(null);
  const [isAddingConnector, setIsAddingConnector] = useState<boolean>(false);

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
        fetchProjectConnectors(pid),
        fetchConnectorTemplates(),
      ]);
      setPersistedConnectors(conns);
      setConnectorTemplates(tmpls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load connections. Reload to try again.');
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

  // Load initial backend setup
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, editor] = await Promise.all([fetchProjectSetup(), fetchProjectEditor()]);
      needsDraftBaseline.current = true;
      setPayload(data);
      setHasConflict(false);
      setConflictDraft(null);
      // Redaction is a separate read-only policy surface. A policy read failure
      // should not hide the rest of the authenticated project configuration.
      void fetchProjectRedaction().then(setRedactionPolicy).catch(() => setRedactionPolicy(null));
      setEditorVersion(editor.version);
      setInitialDraft(editor.document);
      setSavedDraft(JSON.stringify(editor.document));
      const document = editor.document as Partial<RcaAssistFullConfigurationData>;
      setProjectName(''); setResponsibility(''); setStatus('active'); setObjective(''); setTimezone(''); setTags([]);
      setEnvironments([]); setTeamDl(''); setTeamsChannel(''); setMembers({ managers: [], owners: [], analysts: [] });
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
      }
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
    void fetchUsers().then(setProjectUsers).catch(() => setMembersError('Could not load project members. Reload to try again.'));
    void fetchPrincipal().then(setPrincipal).catch(() => setPrincipal(null));
  }, []);

  const rca_assistFullConfig = useMemo(() => ({
    metadata: { ...((initialDraft.metadata || {}) as object), id: projectId, name: projectName, status, responsibility: [responsibility], objective, timezone, tags },
    projectScope: { ...((initialDraft.projectScope || {}) as object), environments, teamDl, teamsChannel, members },
    connectors: persistedConnectorSummaries,
  }), [initialDraft, projectId, projectName, status, responsibility, objective, timezone, tags, environments, teamDl, teamsChannel, members, persistedConnectorSummaries]);

  // Backend Persistence YAML (Formatted according to ProjectLayer constraints)
  const backendSaveYaml = useMemo(() => {
    const allowed = new Set([...(payload?.platform_policy?.project_sections || []), 'skills', 'tenant_id', 'project_id', 'allow_user_preferences', 'allow_user_overrides', 'project_template']);
    const candidate: Record<string, unknown> = Object.fromEntries(Object.entries(payload?.project_layer || {}).filter(([key]) => allowed.has(key)));
    candidate.tenant_id = payload?.scope.tenant_id;
    candidate.project_id = payload?.scope.project_id;
    if (allowed.has('environments')) candidate.environments = environments.map(env => ({
      id: env.id, name: env.displayName, enabled: env.enabled,
      host: env.host || null, namespace: env.namespace || null, cluster: env.cluster || null,
      splunk_index: env.splunk_index || null, jira_env_name: env.jira_env_name || null,
    }));
    return formatToYaml(candidate);
  }, [payload, environments]);

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
    const cleanId = editingEnvId || envForm.id.trim();
    const cleanName = envForm.displayName.trim();
    if (!cleanId || !cleanName) {
      setStatusNotice({ type: 'error', text: 'Environment ID and display name are required.' });
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(cleanId)) {
      setStatusNotice({ type: 'error', text: 'Use letters, numbers, underscores, hyphens or dots for the environment ID.' });
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
        setStatusNotice({ type: 'error', text: `Environment '${cleanId}' already exists.` });
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
    const member = projectUsers.find(user => user.id === memberId && user.status === 'active');
    if (!member || members[activeTeamTab].some(item => item.id === member.id)) return;
    const roleMap: Record<'managers' | 'owners' | 'analysts', 'Manager' | 'Owner' | 'Analyst'> = {
      managers: 'Manager',
      owners: 'Owner',
      analysts: 'Analyst',
    };
    const newMember: TeamMember = {
      id: member.id,
      name: member.name,
      email: member.email || '',
      role: roleMap[activeTeamTab],
    };
    setMembers({
      ...members,
      [activeTeamTab]: [...members[activeTeamTab], newMember],
    });
    setMemberId('');
    setIsAddingMember(false);
  };

  const handleRemoveMember = (tab: 'managers' | 'owners' | 'analysts', id: string) => {
    setMembers({
      ...members,
      [tab]: members[tab].filter(m => m.id !== id),
    });
  };

  // Copy & Download
  const handleCopyYaml = async () => {
    try {
      await navigator.clipboard.writeText(backendSaveYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatusNotice({ type: 'error', text: 'Could not copy the settings. Use Download YAML instead.' });
    }
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([backendSaveYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rca_assist_${projectId || 'project'}_config.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleValidate = async () => {
    const snapshot = backendSaveYaml + draftText;
    setValidating(true);
    setStatusNotice(null);
    try {
      const editor = await saveProjectEditor(draftDocument as unknown as Record<string, unknown>, editorVersion);
      setEditorVersion(editor.version);
      setSavedDraft(JSON.stringify(editor.document));
      const res = await validateProjectSetup(backendSaveYaml, editor.version);
      setValidationResult(res);
      setValidatedSnapshot(snapshot);
      if (res.valid) {
        setStatusNotice({
          text: 'Runtime settings passed schema and platform policy checks.',
          type: 'success',
        });
      } else {
        setStatusNotice({
          text: `Validation failed with ${res.errors.length} error(s). Review stage inputs.`,
          type: 'error',
        });
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setHasConflict(true);
      setStatusNotice({
        text: cause instanceof Error ? cause.message : 'Validation request failed',
        type: 'error',
      });
    } finally {
      setValidating(false);
    }
  };

  const canEdit = Boolean(principal?.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER'].includes(role)));
  const { connectors: _connectors, ...authoringDocument } = rca_assistFullConfig;
  const draftDocument = { ...initialDraft, ...authoringDocument };
  delete (draftDocument as Record<string, unknown>).connectors;
  const draftText = JSON.stringify(draftDocument);
  const dirty = savedDraft !== draftText;
  useEffect(() => {
    if (!loading && needsDraftBaseline.current) {
      needsDraftBaseline.current = false;
      setSavedDraft(draftText);
    }
  }, [loading, draftText, savedDraft]);
  const validationCurrent = Boolean(validationResult?.valid && validatedSnapshot === backendSaveYaml + draftText);
  const setupIssues = [
    ...(!projectName.trim() ? [{ step: 1, field: 'project-name', message: 'Enter a project name' }] : []),
    ...(!responsibility ? [{ step: 1, field: 'project-responsibility', message: 'Choose a responsibility' }] : []),
    ...(!objective.trim() ? [{ step: 1, field: 'project-objective', message: 'Describe the project objective' }] : []),
    ...(!timezone ? [{ step: 1, field: 'project-timezone', message: 'Choose a timezone' }] : []),
    ...(!members.owners.length || members.owners.some(owner => !projectUsers.some(user => user.id === owner.id && user.status === 'active')) ? [{ step: 2, field: 'setup-member', message: 'Select active project owners and remove unavailable members' }] : []),
  ];
  const goToField = (step: number, field: string) => {
    setCurrentStep(step);
    if (field === 'setup-member') { setActiveTeamTab('owners'); setIsAddingMember(true); }
    requestAnimationFrame(() => document.getElementById(field)?.focus());
  };
  useEffect(() => {
    const confirmNavigation = (event: Event) => {
      if (dirty && !window.confirm('Leave without saving your draft? Choose Cancel, then Save draft to keep your changes.')) event.preventDefault();
    };
    let acceptedUrl = window.location.href;
    const guardHistory = (event: Event) => {
      if (!event.isTrusted || window.location.href === acceptedUrl) return;
      const navigation = new Event('rca:history-navigation', { cancelable: true });
      confirmNavigation(navigation);
      if (navigation.defaultPrevented) {
        event.stopImmediatePropagation();
        window.history.pushState(null, '', acceptedUrl);
      } else { acceptedUrl = window.location.href; }
    };
    window.addEventListener('rca:before-navigation', confirmNavigation);
    window.addEventListener('popstate', guardHistory, true);
    window.addEventListener('hashchange', guardHistory, true);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('rca:before-navigation', confirmNavigation); window.removeEventListener('popstate', guardHistory, true); window.removeEventListener('hashchange', guardHistory, true); };
  }, [dirty]);

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const editor = await saveProjectEditor(draftDocument as unknown as Record<string, unknown>, editorVersion);
      setEditorVersion(editor.version);
      setSavedDraft(JSON.stringify(editor.document));
      setStatusNotice({ type: 'success', text: 'Draft saved. You can return to these steps later. Runtime settings have not changed.' });
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setHasConflict(true);
      setStatusNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Could not save your draft. Your entries are still here.' });
      return false;
    } finally { setSaving(false); }
  };

  const handleSave = async () => {
    if (!validationCurrent || !canEdit) return;
    setSaving(true);
    setStatusNotice(null);
    try {
      // Check draft concurrency before changing the runtime configuration.
      const editor = await saveProjectEditor(draftDocument as unknown as Record<string, unknown>, editorVersion);
      setEditorVersion(editor.version);
      setSavedDraft(JSON.stringify(editor.document));
      const result = await saveProjectSetup(backendSaveYaml, payload?.project_revision, editor.version);
      setPayload(result);
      setApplied(true);
      onApplied?.();
      setStatusNotice({ text: 'Project settings applied. New investigations use the saved environments and configured harness. Monitoring drafts do not start automatic work.', type: 'success' });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setHasConflict(true);
      setStatusNotice({ text: `${cause instanceof Error ? cause.message : 'Could not apply project settings'}. Your form entries are preserved.`, type: 'error' });
    } finally { setSaving(false); }
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
          <h1 className="hero-title">{projectName || 'Create your project'}</h1>
          <p className="hero-lede">Follow the seven steps, save your progress, then review the settings used for investigations.</p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <ShieldCheck size={12} color="var(--ps-primary)" />
              <b>Progress:</b> Step {currentStep} of 7
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
            <button type="button" className="btn btn-secondary" onClick={onOverview}>Back to overview</button>
            <button type="button" className="btn btn-secondary" disabled={saving || loading || !canEdit} onClick={() => void handleSaveDraft()}>
              <Save size={13} />{saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>
      </section>

      {currentStep === 2 && (
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
      )}

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

      {validationResult && <div className={`ps-alert-banner ${validationResult.valid ? 'success' : 'error'}`} role="status">
        <div><strong>{validationResult.valid ? 'Runtime configuration checks passed' : 'Review these configuration errors'}</strong>
          <ul>{validationResult.errors.map((message, index) => <li key={index}>{message}</li>)}
          {validationResult.warnings.map((message, index) => <li key={`warning-${index}`}>{message}</li>)}</ul>
          <p>These checks validate the runtime settings below. They do not run a live investigation.</p>
        </div>
      </div>}
      {applied && <section className="ps-card" role="status"><h2>Ready for an investigation</h2>
        <p>Your saved project settings will be used for new runs. Choose real incident details to check the result.</p>
        <button className="btn btn-primary" onClick={onNewInvestigation}>Start investigation <ChevronRight size={16} /></button>
      </section>}
      {hasConflict && <section className="ps-card" role="alert"><h2>Another saved version is available</h2><p>Your entries are still here. Compare both versions or download your draft before reloading.</p>
        <div className="ps-review-sections"><button className="btn btn-secondary" onClick={() => void fetchProjectEditor().then(editor => setConflictDraft(editor.document)).catch(cause => setStatusNotice({ type: 'error', text: cause.message }))}>Compare saved draft</button>
        <button className="btn btn-secondary" onClick={() => { const url = URL.createObjectURL(new Blob([formatToYaml(draftDocument)], { type: 'text/yaml' })); const link = document.createElement('a'); link.href = url; link.download = 'project-draft.yaml'; link.click(); URL.revokeObjectURL(url); }}>Download my draft</button>
        <button className="btn btn-secondary" onClick={() => { if (window.confirm('Replace your entries with the latest saved draft?')) void refresh(); }}>Reload saved settings</button></div>
        {conflictDraft && <div className="ps-draft-comparison"><div><h3>Your entries</h3><pre>{formatToYaml(draftDocument)}</pre></div><div><h3>Latest saved draft</h3><pre>{formatToYaml(conflictDraft)}</pre></div></div>}
      </section>}
      {canEdit && principal && <details className="ps-card project-knowledge-panel">
        <summary>Add project knowledge</summary>
        <p>Upload runbooks and reference documents for <strong>{principal.project_id}</strong> during setup or at any time afterward. Documents save separately from the setup draft and require approval before investigations use them.</p>
        <KnowledgeDocumentForm onSaved={item => setStatusNotice({ type: 'success', text: `${item.title} saved as a knowledge draft. Open Project knowledge to review it and request approval.` })} />
        <p><a href="#knowledge">Open project knowledge to review documents and approvals</a></p>
      </details>}
      {/* Main Responsive Layout: 2-Column Default, 3-Column / Drawer when Blueprint is toggled */}
      <div className="ps-wizard-grid">
        {/* Left Stepper Column */}
        <aside className="ps-stepper-col">
          {STEPS.map(step => {
            const isActive = currentStep === step.number;
            const isCompleted = (step.number === 1 || step.number === 2) && !setupIssues.some(issue => issue.step === step.number);
            const StepIcon = step.icon;
            return (
              <button
                key={step.number}
                type="button"
                className={`ps-step-btn ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'step' : undefined}
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
                  onClick={() => { if (!dirty || window.confirm('Reload saved settings and replace your unsaved entries?')) void refresh(); }}
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
                    required maxLength={200}
                    aria-invalid={!projectName.trim()}
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    className="ps-form-input"
                    placeholder="Enter a project name"
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
                    required aria-invalid={!responsibility}
                    value={responsibility}
                    onChange={e => setResponsibility(e.target.value)}
                    className="ps-form-select"
                  >
                    <option value="">Choose a responsibility</option>
                    <option value="Generic">Generic</option>
                    <option value="Triaging">Triaging</option>
                    <option value="Incident Investigation">Incident Investigation</option>
                    <option value="Root Cause Analysis">Root Cause Analysis</option>
                    <option value="Platform Reliability">Platform Reliability</option>
                  </select>
                  <span className="ps-form-hint">Primary responsibility for this project</span>
                </div>

                <div className="ps-form-group">
                  <span className="ps-form-label">Configuration state</span>
                  <p>Draft revision {editorVersion || 'not yet saved'}</p>
                  <span className="ps-form-hint">Apply supported settings after reviewing all steps.</span>
                </div>
              </div>

              <div className="ps-form-group">
                <label className="ps-form-label" htmlFor="project-objective">
                  <span>Objective <span className="ps-form-label-required">*</span></span>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>{objective.length}/1000</span>
                </label>
                <textarea
                  id="project-objective"
                  required aria-invalid={!objective.trim()}
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
                  required aria-invalid={!timezone}
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="ps-form-select"
                >
                  <option value="">Choose a timezone</option>
                  {[...new Set(['UTC', ...Intl.supportedValuesOf('timeZone'), ...(timezone ? [timezone] : [])])].sort().map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
                </select>
                <span className="ps-form-hint">Timezone for project context. Automatic scheduling is unavailable.</span>
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
                    <h2 className="ps-card-title" id="project-owners-heading" tabIndex={-1}>Teams &amp; ownership</h2>
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
                    <label className="ps-form-label">Team channel reference (contact information only)</label>
                    <input
                      type="text"
                      value={teamsChannel}
                      onChange={e => setTeamsChannel(e.target.value)}
                      placeholder="Channel name or reference"
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
                    <label className="ps-form-label" htmlFor="setup-member">Project member</label>
                    {membersError && <p role="alert">{membersError}</p>}
                    <select id="setup-member" className="ps-form-select" value={memberId} onChange={event => setMemberId(event.target.value)}>
                      <option value="">Choose an active project member</option>
                      {projectUsers.filter(user => user.status === 'active' && !members[activeTeamTab].some(member => member.id === user.id)).map(user => <option key={user.id} value={user.id}>{user.name}{user.email ? ` (${user.email})` : ''}</option>)}
                    </select>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setIsAddingMember(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={handleAddMember} disabled={!memberId}>
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

            </div>
          )}

          {currentStep === 2 && <section className="ps-card">
            <h2 className="ps-card-title">Policies and project knowledge</h2>
            <p>Access and retention are managed by the platform. Project contact information does not grant access or send notifications.</p>
            <p>Parameters use the most specific permitted value: project, connection and environment together, then project and connection, then project and environment, then project, then the platform default.</p>
            <div className="ps-review-sections"><a className="btn btn-secondary" href="#policy">Review policies</a><a className="btn btn-secondary" href="#roles">Manage project access</a><a className="btn btn-secondary" href="#knowledge">Open knowledge library</a></div>
          </section>}

          {currentStep === 4 && <section className="ps-card">
            <h2 className="ps-card-title">Parameter setup</h2>
            <p>Start with the platform settings. Change a value only when this project needs something different.</p>
            <p className="ps-form-hint">Parameter changes are saved immediately by their own controls. They are separate from your project draft.</p>
            {principal && <ParameterSettingsPanel principal={principal} scope="project" />}
          </section>}
          {currentStep === 6 && <ProjectHarnessSetup canEdit={canEdit} onApplied={async () => {
            setPayload(await fetchProjectSetup());
            setApplied(false);
          }} />}

          {currentStep === 5 && <section className="ps-card">
            <h2 className="ps-card-title">Monitoring setup</h2>
            <p>Investigations run on demand with real inputs. Automatic schedules, data refresh jobs, notifications and custom scripts are unavailable in this release.</p>
            <p>Check your configured sources in the connection editor before starting an investigation. Previously saved monitoring plans are preserved in your draft.</p>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(3)}>Review connections</button>
          </section>}

          {/* STEP 5: CONNECTORS & TOOLS (EXPANDED WITH 3 TABS) */}
          {currentStep === 3 && (
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
                  <Wrench size={13} /> Tools
                </button>
                <button
                  type="button"
                  className={`ps-subtab-btn ${step5Tab === 'mapping' ? 'active' : ''}`}
                  onClick={() => setStep5Tab('mapping')}
                >
                  <Link2 size={13} /> Environment Mapping
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
                        projectContext
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

              {step5Tab === 'tools' && <section className="ps-card"><h2 className="ps-card-title">Available tools and capabilities</h2>
                <p>Tools come from published connectors and the approved harness. Review capabilities to see which operations this project can run.</p>
                <a className="btn btn-secondary" href="#capabilities">Review project capabilities</a>
              </section>}
              {step5Tab === 'mapping' && <section className="ps-card"><h2 className="ps-card-title">Environment connections</h2>
                <p>Each connector's connection editor owns its environment mappings. Save project environments in Review &amp; apply before selecting them in a connector.</p>
                {persistedConnectors.length ? persistedConnectors.map(conn => <div className="ps-connection-row" key={conn.instance_id}><span>{conn.system_name}</span><button className="btn btn-secondary" onClick={() => { setStep5Tab('connectors'); setEditingConnector({ instance: conn, template: connectorTemplates.find(template => template.template_id === conn.template_id) }); }}>Edit connections</button></div>) : <p>Add a connector first to configure its environment connections.</p>}
              </section>}
            </div>
          )}

          {/* STEP 6: REVIEW & SAVE */}
          {currentStep === 7 && (
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

                <dl className="ps-review-summary">
                  <div><dt>Project</dt><dd>{projectName || 'Name needed'} · {projectId}</dd></div>
                  <div><dt>Purpose</dt><dd>{objective || 'Objective needed'}</dd></div>
                  <div><dt>Timezone</dt><dd>{timezone || 'Timezone needed'}</dd></div>
                  <div><dt>Owners</dt><dd>{members.owners.map(member => member.name).join(', ') || 'Owner needed'}</dd></div>
                  <div><dt>Environments to apply</dt><dd>{environments.map(env => `${env.displayName} (${env.enabled ? 'enabled' : 'disabled'})`).join(', ') || 'None configured'}</dd></div>
                  <div><dt>Saved connections</dt><dd>{persistedConnectors.map(conn => `${conn.system_name} (${conn.status})`).join(', ') || 'None configured'}</dd></div>
                  <div><dt>Harness</dt><dd>Uses the current saved selection shown in Agent setup. Templates and parameters apply through their own controls.</dd></div>
                </dl>
                {setupIssues.length > 0 && <div role="alert"><h3>Complete these details</h3><ul>{setupIssues.map(issue => <li key={issue.field}><button className="ps-issue-link" onClick={() => goToField(issue.step, issue.field)}>{issue.message}</button></li>)}</ul></div>}
                <p>Save a draft at any time. Applying updates the supported runtime settings shown below. Contacts, policies and monitoring plans remain setup notes unless their dedicated editor provides an active setting.</p>
                <div className="ps-review-sections">{STEPS.slice(0, -1).map(step => <button key={step.id} className="btn btn-secondary" onClick={() => setCurrentStep(step.number)}>Review {step.title}<ChevronRight size={14} /></button>)}</div>
              </div>

              {/* Complete Full YAML Preview Card */}
              <details className="ps-card"><summary>Advanced: runtime settings and YAML export</summary>
                <div className="ps-card-header">
                  <div>
                    <h2 className="ps-card-title">Runtime settings to apply</h2>
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
                      disabled={saving || !canEdit || !validationCurrent}
                      style={{ fontSize: 12 }}
                    >
                      <Save size={13} /> {saving ? 'Saving…' : 'Apply project settings'}
                    </button>
                  </div>
                </div>

                <YamlCodeViewer code={backendSaveYaml} maxHeight={520} />
              </details>
            </div>
          )}
        </main>

      </div>
      {showSidebar && <section className="ps-card"><h2 className="ps-card-title">Runtime settings preview</h2><YamlCodeViewer code={backendSaveYaml} maxHeight={320} /></section>}
      <footer className="ps-wizard-footer">
        <span role="status">{dirty ? 'Unsaved draft changes' : editorVersion ? `Draft saved · revision ${editorVersion}` : 'Draft not saved yet'}</span>
        <div className="ps-review-sections"><button className="btn btn-secondary" disabled={currentStep === 1} onClick={() => setCurrentStep(step => step - 1)}><ChevronLeft size={16} />Back</button>
        {currentStep < 7 ? <button className="btn btn-primary" onClick={() => setCurrentStep(step => step + 1)}>Continue to {STEPS[currentStep].title}<ChevronRight size={16} /></button> : <><button className="btn btn-secondary" disabled={!canEdit || saving || validating} onClick={() => void handleValidate()}>{validating ? 'Checking…' : 'Save draft and validate'}</button><button className="btn btn-primary" disabled={!validationCurrent || saving || !canEdit} onClick={() => void handleSave()}>Apply project settings</button></>}</div>
      </footer>
      {/* Bottom About Banner */}
      <footer className="ps-bottom-banner">
        <div className="ps-bottom-banner-left">
          <Info size={18} className="ps-bottom-banner-icon" />
          <div className="ps-bottom-banner-text">
            <strong>Project setup:</strong> Drafts keep your planning details. Apply updates the supported runtime settings; connections, parameters and harness templates use their own save controls.
          </div>
        </div>
      </footer>
    </div>
  );
};
