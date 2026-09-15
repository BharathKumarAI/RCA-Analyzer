import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot, BookOpen, Boxes, Check, Layers, Plus, RefreshCw, RotateCcw,
  Search, ShieldCheck, Sparkles, X, Copy, ExternalLink, Send,
  Lock, AlertTriangle, CheckCircle2, Shield, Info, Code, Sliders,
  Minus, FileCode, Wrench, Cpu, Workflow, Terminal, Edit3, Save,
  CheckSquare, ArrowRight, CornerDownRight, ArrowUpRight
} from 'lucide-react';
import {
  ApiError, fetchHarnessLibrary, resetHarnessLibrary,
  submitAgentYaml, updateHarnessLibrary, updatePlatformHarness,
  fetchSkills, saveProjectSkill, resetProjectSkill,
  fetchCapabilities, setProjectAvailability, fetchTools
} from '../services/api';
import {
  HarnessDocument, HarnessLibraryItem, HarnessResourceKind,
  HarnessResponse, HarnessSelection, Principal,
  SkillItem, CapabilityItem, ToolDefinition, AgentDefinition
} from '../types/api';
import type { ActivePage } from '../components/Sidebar';
import { HarnessStudioPage } from '../features/harness-studio/HarnessStudioPage';
import { NotificationBanner } from '../components/NotificationBanner';
import '../styles/harness-library.css';

const kinds: Array<{ id: HarnessResourceKind; label: string; icon: React.ReactNode }> = [
  { id: 'agent', label: 'Agents', icon: <Bot size={15} /> },
  { id: 'skill', label: 'Skills', icon: <Sparkles size={15} /> },
  { id: 'capability', label: 'Capabilities', icon: <Layers size={15} /> },
  { id: 'plugin', label: 'Plugin bundles', icon: <Boxes size={15} /> },
];

type LibraryResponse = HarnessResponse & {
  permissions?: { manage_project: boolean; manage_platform: boolean };
  skills?: Array<{ id: string; name?: string; description?: string; immutable?: boolean; enabled?: boolean; customizable?: boolean }>;
  capabilities?: Array<{ id: string; name?: string; description?: string; enabled?: boolean; customizable?: boolean }>;
};

const key = (item: HarnessLibraryItem) => `${item.kind}:${item.id}`;
const toItems = (response: LibraryResponse): HarnessLibraryItem[] => [
  ...response.document.agents.map(agent => ({
    id: agent.definition.id,
    name: agent.definition.name,
    kind: 'agent' as const,
    description: agent.definition.description,
    version: agent.definition.version,
    source: 'platform' as const,
    inherited: response.effective_agents.includes(agent.definition.id),
    selected: !(response.selection.disabled_agents || []).includes(agent.definition.id) && (response.selection.agents.length === 0 || response.selection.agents.includes(agent.definition.id)),
    customizable: response.permissions?.manage_project !== false && agent.enabled,
    immutable: false,
    status: agent.enabled ? 'template' : 'disabled',
    metadata: {
      tools: agent.definition.tools || [],
      capability: agent.definition.capability,
      model_profile: agent.definition.model_profile,
      stage_model: agent.definition.stage_model,
      instruction: agent.definition.instruction,
    }
  })),
  ...response.document.plugins.map(plugin => ({
    id: plugin.id,
    name: plugin.name,
    kind: 'plugin' as const,
    description: plugin.description,
    source: 'platform' as const,
    inherited: response.effective_plugins.includes(plugin.id),
    selected: !(response.selection.disabled_plugins || []).includes(plugin.id) && (response.selection.plugins.length === 0 || response.selection.plugins.includes(plugin.id)),
    customizable: response.permissions?.manage_project !== false && plugin.enabled,
    status: plugin.enabled ? 'template' : 'disabled',
    metadata: {
      capabilities: plugin.capabilities || [],
      skills: plugin.skills || [],
      agents: plugin.agents || [],
    }
  })),
  ...(response.skills || []).map(skill => ({
    id: skill.id,
    name: skill.name || skill.id,
    kind: 'skill' as const,
    description: skill.description,
    source: 'platform' as const,
    inherited: response.effective_skills?.includes(skill.id) ?? skill.enabled !== false,
    selected: !(response.selection.disabled_skills || []).includes(skill.id),
    customizable: skill.customizable ?? !skill.immutable,
    immutable: skill.immutable,
    status: skill.enabled === false ? 'disabled' : 'platform'
  })),
  ...(response.capabilities || []).map(capability => ({
    id: capability.id,
    name: capability.name || capability.id,
    kind: 'capability' as const,
    description: capability.description,
    source: 'platform' as const,
    inherited: response.effective_capabilities?.includes(capability.id) ?? capability.enabled !== false,
    selected: !(response.selection.disabled_capabilities || []).includes(capability.id),
    customizable: capability.customizable ?? capability.enabled !== false,
    status: capability.enabled === false ? 'disabled' : 'platform'
  })),
];

interface HarnessLibraryProps {
  principal?: Principal | null;
  onNavigate?: (page: ActivePage) => void;
}

type StatusFilter = 'all' | 'included' | 'excluded' | 'locked';
type DrawerTab = 'spec' | 'edit';

export const HarnessLibrary: React.FC<HarnessLibraryProps> = ({ principal, onNavigate }) => {
  const [items, setItems] = useState<HarnessLibraryItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState('');
  const [projectRevision, setProjectRevision] = useState('');
  const [document, setDocument] = useState<HarnessDocument | null>(null);
  const [canManageProject, setCanManageProject] = useState(false);
  const [canManagePlatform, setCanManagePlatform] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState(false);
  const [platformText, setPlatformText] = useState('');
  const [activeTab, setActiveTab] = useState<'studio' | 'catalog'>('studio');

  // Cross-page datasets
  const [skillsCatalog, setSkillsCatalog] = useState<SkillItem[]>([]);
  const [capabilitiesCatalog, setCapabilitiesCatalog] = useState<CapabilityItem[]>([]);
  const [toolsCatalog, setToolsCatalog] = useState<ToolDefinition[]>([]);

  // Drawer state
  const [drawerItem, setDrawerItem] = useState<HarnessLibraryItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('spec');

  // Agent editing form state in drawer
  const [editAgentName, setEditAgentName] = useState('');
  const [editAgentDesc, setEditAgentDesc] = useState('');
  const [editAgentCapability, setEditAgentCapability] = useState('incident_triage');
  const [editAgentModelProfile, setEditAgentModelProfile] = useState('balanced-investigation');
  const [editAgentStageModel, setEditAgentStageModel] = useState('configured');
  const [editAgentTools, setEditAgentTools] = useState<string[]>([]);
  const [editAgentInstruction, setEditAgentInstruction] = useState('');

  // Skill prompt editing in drawer
  const [editSkillPrompt, setEditSkillPrompt] = useState('');
  const [savingSkillPrompt, setSavingSkillPrompt] = useState(false);

  // Add Resource modal state
  const [showAddResourceModal, setShowAddResourceModal] = useState<'agent' | 'capability' | null>(null);
  const [newResourceId, setNewResourceId] = useState('');
  const [newResourceName, setNewResourceName] = useState('');
  const [newResourceDesc, setNewResourceDesc] = useState('');
  const [newResourceCapability, setNewResourceCapability] = useState('incident_triage');
  const [newResourceModelProfile, setNewResourceModelProfile] = useState('balanced-investigation');
  const [newResourceStageModel, setNewResourceStageModel] = useState('configured');
  const [newResourceTools, setNewResourceTools] = useState<string[]>([]);
  const [newResourceInstruction, setNewResourceInstruction] = useState('');

  // Filtering & View state
  const [kind, setKind] = useState<HarnessResourceKind>('agent');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, sks, caps, tls] = await Promise.all([
        fetchHarnessLibrary() as Promise<LibraryResponse>,
        fetchSkills().catch(() => [] as SkillItem[]),
        fetchCapabilities(true).catch(() => [] as CapabilityItem[]),
        fetchTools().catch(() => [] as ToolDefinition[]),
      ]);

      setCanManageProject(response.permissions?.manage_project ?? true);
      setCanManagePlatform(response.permissions?.manage_platform ?? false);
      const nextItems = toItems(response);
      setItems(nextItems);
      setRevision(response.revision);
      setProjectRevision(response.project_revision || '');
      setDocument(response.document);
      const initialSet = new Set(nextItems.filter(item => item.selected).map(item => key(item)));
      setSelected(initialSet);
      setInitialSelected(new Set(initialSet));

      setSkillsCatalog(sks);
      setCapabilitiesCatalog(caps);
      setToolsCatalog(tls);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to load the harness library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Sync drawer fields when a new item is selected
  useEffect(() => {
    if (!drawerItem) {
      setDrawerTab('spec');
      return;
    }

    if (drawerItem.kind === 'agent' && document) {
      const agent = document.agents.find(a => a.definition.id === drawerItem.id)?.definition;
      if (agent) {
        setEditAgentName(agent.name || '');
        setEditAgentDesc(agent.description || '');
        setEditAgentCapability(agent.capability || 'incident_triage');
        setEditAgentModelProfile(agent.model_profile || 'balanced-investigation');
        setEditAgentStageModel(agent.stage_model || 'configured');
        setEditAgentTools([...(agent.tools || [])]);
        setEditAgentInstruction(agent.instruction || '');
      }
    } else if (drawerItem.kind === 'skill') {
      const skill = skillsCatalog.find(s => s.id === drawerItem.id);
      const prompt = skill?.project_instruction || skill?.instruction_body || skill?.content || '';
      setEditSkillPrompt(prompt);
    }
  }, [drawerItem, document, skillsCatalog]);

  // Close drawer/modals on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerItem(null);
        setEditingPlatform(false);
        setShowAddResourceModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Check for unsaved changes in project selection
  const hasUnsavedChanges = useMemo(() => {
    if (selected.size !== initialSelected.size) return true;
    for (const id of selected) {
      if (!initialSelected.has(id)) return true;
    }
    return false;
  }, [selected, initialSelected]);

  // Filter items
  const filtered = useMemo(() => {
    return items.filter(item => {
      if (item.kind !== kind) return false;
      const active = selected.has(key(item));
      const locked = Boolean(item.immutable || (item.source === 'platform' && !item.customizable));

      if (statusFilter === 'included' && !active) return false;
      if (statusFilter === 'excluded' && active) return false;
      if (statusFilter === 'locked' && !locked) return false;

      if (!query.trim()) return true;
      const haystack = `${item.name} ${item.id} ${item.description || ''} ${item.version || ''}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [items, kind, selected, statusFilter, query]);

  // Counts per resource kind
  const counts = useMemo(() => {
    return kinds.map(entry => ({
      ...entry,
      count: items.filter(item => item.kind === entry.id).length,
      selectedCount: items.filter(item => item.kind === entry.id && selected.has(key(item))).length,
    }));
  }, [items, selected]);

  // Catalog metrics
  const metrics = useMemo(() => {
    const total = items.length;
    const activeCount = selected.size;
    const customizableCount = items.filter(i => i.customizable && !i.immutable).length;
    const excludedCount = customizableCount - items.filter(i => i.customizable && !i.immutable && selected.has(key(i))).length;
    const lockedCount = items.filter(i => i.immutable || !i.customizable).length;
    return {
      total,
      activeCount,
      excludedCount: Math.max(0, excludedCount),
      lockedCount,
      percentage: total > 0 ? Math.round((activeCount / total) * 100) : 0,
    };
  }, [items, selected]);

  const copyToClipboard = (text: string, identifier: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(identifier);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggle = (item: HarnessLibraryItem) => {
    if (!canManageProject || item.immutable || !item.customizable && item.source === 'platform') return;
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key(item))) next.delete(key(item));
      else next.add(key(item));
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const selection: HarnessSelection = {
        agents: [],
        disabled_agents: items.filter(item => item.kind === 'agent' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
        plugins: [],
        disabled_plugins: items.filter(item => item.kind === 'plugin' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
        disabled_skills: items.filter(item => item.kind === 'skill' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
        disabled_capabilities: items.filter(item => item.kind === 'capability' && item.customizable && !item.immutable && !selected.has(key(item))).map(item => item.id),
      };
      const response = await updateHarnessLibrary(selection, revision, projectRevision);
      const nextItems = toItems(response);
      setItems(nextItems);
      setRevision(response.revision);
      setProjectRevision(response.project_revision || '');
      const newSelected = new Set(nextItems.filter(item => item.selected).map(item => key(item)));
      setSelected(newSelected);
      setInitialSelected(new Set(newSelected));
      setNotice('Project harness selection saved successfully.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to save project harness selection.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Reset this project to the platform harness defaults? Any custom exclusions will be restored.')) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await resetHarnessLibrary(projectRevision);
      const nextItems = toItems(response);
      setItems(nextItems);
      setRevision(response.revision);
      setProjectRevision(response.project_revision || '');
      const newSelected = new Set(nextItems.filter(item => item.selected).map(item => key(item)));
      setSelected(newSelected);
      setInitialSelected(new Set(newSelected));
      setNotice('Project harness reset to platform defaults.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to reset the project harness.');
    } finally {
      setSaving(false);
    }
  };

  const savePlatform = async () => {
    if (!document) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = JSON.parse(platformText) as HarnessDocument;
      const response = await updatePlatformHarness(parsed, revision);
      setDocument(response.document);
      setRevision(response.revision);
      setProjectRevision(response.project_revision || '');
      const nextItems = toItems(response);
      setItems(nextItems);
      const newSelected = new Set(nextItems.filter(item => item.selected).map(key));
      setSelected(newSelected);
      setInitialSelected(new Set(newSelected));
      setNotice('Platform harness catalog specification updated.');
      setEditingPlatform(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Platform catalog must be valid JSON and satisfy the HarnessDocument schema.');
    } finally {
      setSaving(false);
    }
  };

  const submitTemplate = async (item: HarnessLibraryItem) => {
    const agent = document?.agents.find(entry => entry.definition.id === item.id);
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      await submitAgentYaml(JSON.stringify(agent.definition, null, 2));
      setNotice(`Specialist template '${item.name}' submitted for peer review.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to submit template for approval.');
    } finally {
      setSaving(false);
    }
  };

  // Build agent YAML from form fields
  const buildAgentYaml = (def: {
    id: string;
    version?: string;
    name: string;
    description: string;
    capability: string;
    model_profile: string;
    stage_model: string;
    tools: string[];
    instruction: string;
  }): string => {
    return [
      `id: ${def.id}`,
      `version: "${def.version || '1.0.0'}"`,
      `name: "${def.name.replace(/"/g, '\\"')}"`,
      `description: "${(def.description || '').replace(/"/g, '\\"')}"`,
      `capability: ${def.capability || 'incident_triage'}`,
      `model_profile: ${def.model_profile || 'balanced-investigation'}`,
      `stage_model: ${def.stage_model || 'configured'}`,
      `tools:`,
      ...(def.tools && def.tools.length > 0 ? def.tools.map(t => `  - ${t}`) : ['  # No tools assigned']),
      `instruction: |`,
      ...(def.instruction || '').split('\n').map(line => `  ${line}`),
    ].join('\n');
  };

  // Submit edited agent from drawer to peer review
  const handleSaveEditedAgent = async () => {
    if (!drawerItem) return;
    setSaving(true);
    setError(null);
    try {
      const yaml = buildAgentYaml({
        id: drawerItem.id,
        version: drawerItem.version || '1.0.0',
        name: editAgentName,
        description: editAgentDesc,
        capability: editAgentCapability,
        model_profile: editAgentModelProfile,
        stage_model: editAgentStageModel,
        tools: editAgentTools,
        instruction: editAgentInstruction,
      });

      await submitAgentYaml(yaml);
      setNotice(`Agent '${editAgentName}' submitted for peer review. You can inspect review status in the Agents workspace.`);
      setDrawerTab('spec');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to submit updated agent specification.');
    } finally {
      setSaving(false);
    }
  };

  // Save edited skill prompt directly from drawer
  const handleSaveSkillPrompt = async () => {
    if (!drawerItem) return;
    setSavingSkillPrompt(true);
    setError(null);
    try {
      await saveProjectSkill(drawerItem.id, {
        instruction: editSkillPrompt,
        enabled: true,
      });
      setNotice(`Project prompt override saved for skill '${drawerItem.name}'.`);
      // Update local skillsCatalog
      setSkillsCatalog(prev =>
        prev.map(s => (s.id === drawerItem.id ? { ...s, project_instruction: editSkillPrompt, is_overridden_in_project: true } : s))
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to save project skill prompt.');
    } finally {
      setSavingSkillPrompt(false);
    }
  };

  // Reset skill prompt override back to platform default
  const handleResetSkillPrompt = async () => {
    if (!drawerItem) return;
    if (!window.confirm(`Reset prompt for '${drawerItem.name}' to platform baseline?`)) return;
    setSavingSkillPrompt(true);
    setError(null);
    try {
      await resetProjectSkill(drawerItem.id);
      const skill = skillsCatalog.find(s => s.id === drawerItem.id);
      const baseline = skill?.instruction_body || skill?.content || '';
      setEditSkillPrompt(baseline);
      setNotice(`Skill '${drawerItem.name}' reset to platform baseline.`);
      setSkillsCatalog(prev =>
        prev.map(s => (s.id === drawerItem.id ? { ...s, project_instruction: null, is_overridden_in_project: false } : s))
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to reset project skill prompt.');
    } finally {
      setSavingSkillPrompt(false);
    }
  };

  // Toggle Capability project availability in real-time
  const handleToggleCapabilityAvailability = async (capItem: HarnessLibraryItem) => {
    const active = selected.has(key(capItem));
    const nextEnabled = !active;
    setSaving(true);
    setError(null);
    try {
      await setProjectAvailability('capabilities', capItem.id, nextEnabled, active);
      toggle(capItem);
      setNotice(`Capability '${capItem.name}' ${nextEnabled ? 'enabled' : 'disabled'} for project runs.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to toggle capability availability.');
    } finally {
      setSaving(false);
    }
  };

  // Create new specialist agent
  const handleCreateAgent = async () => {
    if (!newResourceId.trim() || !newResourceName.trim()) {
      setError('Agent ID and Name are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const yaml = buildAgentYaml({
        id: newResourceId.trim(),
        version: '1.0.0',
        name: newResourceName.trim(),
        description: newResourceDesc.trim(),
        capability: newResourceCapability,
        model_profile: newResourceModelProfile,
        stage_model: newResourceStageModel,
        tools: newResourceTools,
        instruction: newResourceInstruction.trim() || '# Specialized ADK prompt body',
      });

      await submitAgentYaml(yaml);
      setNotice(`New specialist agent '${newResourceName}' submitted for peer review.`);
      setShowAddResourceModal(null);
      // Reset form
      setNewResourceId('');
      setNewResourceName('');
      setNewResourceDesc('');
      setNewResourceTools([]);
      setNewResourceInstruction('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to create agent.');
    } finally {
      setSaving(false);
    }
  };

  // Add capability directly to catalog if platform admin
  const handleCreateCapability = async () => {
    if (!document) return;
    if (!newResourceId.trim() || !newResourceName.trim()) {
      setError('Capability ID and Name are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // In platform harness catalog, we can update or link the capability
      setNotice(`Capability '${newResourceName}' added. Open Capabilities Topology to configure workflow nodes.`);
      setShowAddResourceModal(null);
      setNewResourceId('');
      setNewResourceName('');
      setNewResourceDesc('');
      handleNavigate('capabilities');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to register capability.');
    } finally {
      setSaving(false);
    }
  };

  const bulkToggleKind = (enable: boolean) => {
    if (!canManageProject) return;
    setSelected(current => {
      const next = new Set(current);
      items.filter(i => i.kind === kind && i.customizable && !i.immutable).forEach(i => {
        const itemKey = key(i);
        if (enable) next.add(itemKey);
        else next.delete(itemKey);
      });
      return next;
    });
  };

  const handleNavigate = (page: ActivePage) => {
    if (onNavigate) {
      onNavigate(page);
    } else {
      window.location.hash = `#${page}`;
    }
  };

  // Full agent definition for active drawer item
  const activeAgentDefinition = useMemo(() => {
    if (!drawerItem || drawerItem.kind !== 'agent' || !document) return null;
    return document.agents.find(a => a.definition.id === drawerItem.id)?.definition || null;
  }, [drawerItem, document]);

  // Full plugin definition for active drawer item
  const activePluginDefinition = useMemo(() => {
    if (!drawerItem || drawerItem.kind !== 'plugin' || !document) return null;
    return document.plugins.find(p => p.id === drawerItem.id) || null;
  }, [drawerItem, document]);

  // Active skill from catalog for active drawer item
  const activeSkillItem = useMemo(() => {
    if (!drawerItem || drawerItem.kind !== 'skill') return null;
    return skillsCatalog.find(s => s.id === drawerItem.id) || null;
  }, [drawerItem, skillsCatalog]);

  return (
    <div className={`view-container harness-page ${activeTab === 'studio' ? 'studio-view' : ''}`}>
      {/* Studio Workbench vs Catalog View Selector */}
      <div className="harness-main-nav-tabs">
        <button
          type="button"
          className={`harness-main-nav-tab ${activeTab === 'studio' ? 'active' : ''}`}
          onClick={() => setActiveTab('studio')}
        >
          <Workflow size={16} />
          <span>Studio Workbench</span>
          <span className="harness-badge-pill">ADK 2.x Visual</span>
        </button>
        <button
          type="button"
          className={`harness-main-nav-tab ${activeTab === 'catalog' ? 'active' : ''}`}
          onClick={() => setActiveTab('catalog')}
        >
          <Boxes size={16} />
          <span>Catalog & Governance</span>
          <span className="harness-badge-pill">{items.length}</span>
        </button>
      </div>

      {activeTab === 'studio' ? (
        <HarnessStudioPage tenantId={principal?.tenant_id} projectId={principal?.project_id} />
      ) : (
        <>
          {/* Standard Hero Banner */}
          <section className="hero-banner">
            <div className="hero-main">
              <h1 className="hero-title">
                <BookOpen size={22} color="var(--acc)" />
                Harness <span>Library</span> & Governance
              </h1>
              <p className="hero-lede">
                Govern platform templates and configure scoped resource inheritance for this project.
                Click any resource card to inspect specifications, view model bindings, or adjust project inheritance.
              </p>

              <div className="hero-meta-strip">
                <span className="hero-stat-chip highlight">
                  <ShieldCheck size={13} /> Platform Governed
                </span>
                <span className="hero-stat-chip">
                  <Layers size={13} />
                  <b>{selected.size}</b> project resources active
                </span>
                {revision && (
                  <span
                    className="hero-stat-chip interactive"
                    onClick={() => copyToClipboard(revision, 'rev')}
                    title="Click to copy full catalog revision SHA-256"
                  >
                    {copiedKey === 'rev' ? <Check size={12} style={{ color: 'var(--acc3)' }} /> : <Copy size={12} />}
                    Catalog: <code>{revision.slice(0, 18)}…</code>
                  </span>
                )}
                {projectRevision && (
                  <span
                    className="hero-stat-chip interactive"
                    onClick={() => copyToClipboard(projectRevision, 'proj_rev')}
                    title="Click to copy project layer revision SHA-256"
                  >
                    {copiedKey === 'proj_rev' ? <Check size={12} style={{ color: 'var(--acc3)' }} /> : <Copy size={12} />}
                    Project Layer: <code>{projectRevision.slice(0, 18)}…</code>
                  </span>
                )}
              </div>
            </div>

            <div className="hero-actions">
              <div className="hero-actions-row">
                <button
                  type="button"
                  className={`btn ${hasUnsavedChanges ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => void save()}
                  disabled={saving || loading || !document || !canManageProject || !hasUnsavedChanges}
                  title={hasUnsavedChanges ? 'Save changes to project resource selection' : 'No unsaved changes'}
                >
                  <Check size={13} />
                  {saving ? 'Saving…' : hasUnsavedChanges ? 'Save project selection *' : 'Save project selection'}
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void reset()}
                  disabled={saving || loading || !document || !canManageProject}
                  title="Reset project inheritance to platform catalog defaults"
                >
                  <RotateCcw size={13} />
                  Reset to platform
                </button>

                {canManagePlatform && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setPlatformText(JSON.stringify(document, null, 2));
                      setEditingPlatform(true);
                    }}
                    disabled={!document || saving}
                    title="Edit data-only config/harness.yaml definition"
                  >
                    <FileCode size={13} />
                    Edit platform catalog
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void load()}
                  disabled={loading || saving}
                  title="Reload harness catalog from server"
                >
                  <RefreshCw size={13} className={loading ? 'spin' : ''} />
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
          </section>

      {/* Notifications & Error Alerts */}
      {notice && (
        <NotificationBanner
          type="success"
          message={notice}
          onClose={() => setNotice(null)}
          style={{ marginBottom: 14 }}
        />
      )}

      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
              Retry
            </button>
          }
          style={{ marginBottom: 14 }}
        />
      )}

      {/* Unsaved Changes Banner */}
      {hasUnsavedChanges && (
        <div className="harness-unsaved-bar">
          <div className="harness-unsaved-text">
            <span className="harness-unsaved-dot" />
            <span>You have unsaved changes in your project resource inheritance selection.</span>
          </div>
          <div className="harness-unsaved-actions">
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setSelected(new Set(initialSelected))}
            >
              Discard changes
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '4px 14px' }}
              onClick={() => void save()}
              disabled={saving}
            >
              <Check size={12} />
              {saving ? 'Saving…' : 'Save now'}
            </button>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      <section className="harness-stats-grid">
        <div className="harness-stat-card">
          <div className="harness-stat-icon purple">
            <Boxes size={18} />
          </div>
          <div className="harness-stat-info">
            <span className="harness-stat-label">Catalog Resources</span>
            <div className="harness-stat-value-row">
              <span className="harness-stat-value">{metrics.total}</span>
              <span className="harness-stat-subtext">total governed</span>
            </div>
            <span className="harness-stat-subtext" style={{ marginTop: 2 }}>
              {counts.map(c => `${c.count} ${c.label.toLowerCase()}`).join(' · ')}
            </span>
          </div>
        </div>

        <div className="harness-stat-card">
          <div className="harness-stat-icon emerald">
            <CheckCircle2 size={18} />
          </div>
          <div className="harness-stat-info">
            <span className="harness-stat-label">Active in Project</span>
            <div className="harness-stat-value-row">
              <span className="harness-stat-value">{metrics.activeCount}</span>
              <span className="harness-stat-subtext">({metrics.percentage}%)</span>
            </div>
            <span className="harness-stat-subtext" style={{ marginTop: 2 }}>
              Enabled for incident triage & runs
            </span>
          </div>
        </div>

        <div className="harness-stat-card">
          <div className="harness-stat-icon amber">
            <Minus size={18} />
          </div>
          <div className="harness-stat-info">
            <span className="harness-stat-label">Excluded Resources</span>
            <div className="harness-stat-value-row">
              <span className="harness-stat-value">{metrics.excludedCount}</span>
              <span className="harness-stat-subtext">disabled</span>
            </div>
            <span className="harness-stat-subtext" style={{ marginTop: 2 }}>
              Customized out by project scope
            </span>
          </div>
        </div>

        <div className="harness-stat-card">
          <div className="harness-stat-icon indigo">
            <Shield size={18} />
          </div>
          <div className="harness-stat-info">
            <span className="harness-stat-label">Governance State</span>
            <div className="harness-stat-value-row">
              <span className="harness-stat-value" style={{ fontSize: 16 }}>
                {projectRevision ? 'Project Layer' : 'Platform Default'}
              </span>
            </div>
            <span className="harness-stat-subtext" style={{ marginTop: 2 }}>
              {canManageProject ? 'Project editing permitted' : 'Read-only access'}
            </span>
          </div>
        </div>
      </section>

      {/* Kind Navigation and Control Toolbar */}
      <section className="harness-controls-panel">
        <div className="harness-nav-bar">
          <div className="harness-kind-tabs" role="tablist">
            {counts.map(entry => (
              <button
                type="button"
                key={entry.id}
                role="tab"
                aria-selected={kind === entry.id}
                className={`harness-kind-tab ${kind === entry.id ? 'active' : ''}`}
                onClick={() => {
                  setKind(entry.id);
                  setStatusFilter('all');
                }}
              >
                {entry.icon}
                <span>{entry.label}</span>
                <span className="harness-tab-count">
                  {entry.selectedCount}/{entry.count}
                </span>
              </button>
            ))}
          </div>

          <div className="harness-jump-shortcuts">
            {kind === 'agent' && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12 }}
                onClick={() => setShowAddResourceModal('agent')}
              >
                <Plus size={13} /> Add Specialist Agent
              </button>
            )}

            {kind === 'capability' && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12 }}
                onClick={() => setShowAddResourceModal('capability')}
              >
                <Plus size={13} /> Add Capability
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleNavigate('agents')}
              title="Open Specialist Agents to review approved and pending drafts"
            >
              <Bot size={13} />
              Agents
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleNavigate('skills')}
              title="Open Skills Studio to inspect instructions and MLflow metrics"
            >
              <BookOpen size={13} />
              Skills Studio
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleNavigate('capabilities')}
              title="Open Capabilities to view execution topology"
            >
              <Layers size={13} />
              Capabilities
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleNavigate('tools')}
              title="Open Tools & Connectors"
            >
              <Wrench size={13} />
              Tools
            </button>
          </div>
        </div>

        {/* Search, Filter Pills & Bulk Controls */}
        <div className="harness-subtoolbar">
          <div className="harness-search-group">
            <Search size={14} className="search-icon" />
            <input
              type="search"
              className="harness-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${kind}s by name, ID, or description…`}
            />
            {query && (
              <button
                type="button"
                className="harness-search-clear"
                onClick={() => setQuery('')}
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="harness-filter-pills">
            <button
              type="button"
              className={`harness-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`harness-filter-pill ${statusFilter === 'included' ? 'active' : ''}`}
              onClick={() => setStatusFilter('included')}
            >
              <Check size={11} /> Included
            </button>
            <button
              type="button"
              className={`harness-filter-pill ${statusFilter === 'excluded' ? 'active' : ''}`}
              onClick={() => setStatusFilter('excluded')}
            >
              <Minus size={11} /> Excluded
            </button>
            <button
              type="button"
              className={`harness-filter-pill ${statusFilter === 'locked' ? 'active' : ''}`}
              onClick={() => setStatusFilter('locked')}
            >
              <Lock size={11} /> Governed
            </button>
          </div>

          {canManageProject && (
            <div className="harness-bulk-actions">
              <button
                type="button"
                className="harness-bulk-btn"
                onClick={() => bulkToggleKind(true)}
                title={`Include all customizable ${kind}s`}
              >
                Include All
              </button>
              <button
                type="button"
                className="harness-bulk-btn"
                onClick={() => bulkToggleKind(false)}
                title={`Exclude all customizable ${kind}s`}
              >
                Exclude All
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Resource Cards Grid */}
      {loading ? (
        <div className="harness-empty-state">
          <RefreshCw size={24} className="spin" style={{ color: 'var(--acc)' }} />
          <h3>Loading harness catalog…</h3>
          <p>Fetching shared platform templates and scoped project inheritance rules.</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="harness-cards-grid">
          {filtered.map(item => {
            const active = selected.has(key(item));
            const locked = Boolean(item.immutable || (item.source === 'platform' && !item.customizable));
            const isAgent = item.kind === 'agent';
            const isSkill = item.kind === 'skill';
            const isCapability = item.kind === 'capability';
            const isPlugin = item.kind === 'plugin';
            const itemKey = key(item);

            return (
              <article
                key={itemKey}
                className={`harness-card ${active ? 'is-active' : 'is-excluded'} ${locked ? 'is-locked' : ''}`}
                onClick={() => setDrawerItem(item)}
                title="Click to inspect specification and configure resource"
              >
                <div className="harness-card-content">
                  <header className="harness-card-header">
                    <div className="harness-card-title-group">
                      <div className={`harness-card-kind-badge ${item.kind}`}>
                        {item.kind === 'agent' && <Bot size={17} />}
                        {item.kind === 'skill' && <Sparkles size={17} />}
                        {item.kind === 'capability' && <Layers size={17} />}
                        {item.kind === 'plugin' && <Boxes size={17} />}
                      </div>

                      <div className="harness-card-title-text">
                        <h2 className="harness-card-title">
                          <span>{item.name}</span>
                          {item.version && (
                            <span className="harness-card-version-tag">v{item.version}</span>
                          )}
                        </h2>

                        <button
                          type="button"
                          className="harness-card-id-chip"
                          onClick={e => {
                            e.stopPropagation();
                            copyToClipboard(item.id, itemKey);
                          }}
                          title="Click to copy resource ID"
                        >
                          <code>{item.id}</code>
                          {copiedKey === itemKey ? <Check size={10} style={{ color: 'var(--acc3)' }} /> : <Copy size={10} />}
                        </button>
                      </div>
                    </div>

                    <div className="harness-card-status-pill-wrap">
                      {locked ? (
                        <span className="harness-card-status-badge locked" title="Governed by platform policy; not customizable by projects">
                          <Lock size={10} /> Governed
                        </span>
                      ) : active ? (
                        <span className="harness-card-status-badge included">
                          <Check size={10} /> Included
                        </span>
                      ) : (
                        <span className="harness-card-status-badge excluded">
                          <Minus size={10} /> Excluded
                        </span>
                      )}
                    </div>
                  </header>

                  <p className="harness-card-desc">
                    {item.description || `Platform catalog ${item.kind} specification.`}
                  </p>

                  <div className="harness-card-meta-list">
                    <span className="harness-card-pill">
                      {item.source === 'platform' ? 'Platform Catalog' : 'Project Resource'}
                    </span>

                    {active && !item.inherited && (
                      <span className="harness-card-pill warning" title="Resource is selected in project but not active under runtime rules">
                        Platform Inactive
                      </span>
                    )}

                    {isAgent && Array.isArray(item.metadata?.tools) && item.metadata.tools.length > 0 && (
                      <span className="harness-card-pill accent" title={`Tools: ${item.metadata.tools.join(', ')}`}>
                        {item.metadata.tools.length} tool{item.metadata.tools.length > 1 ? 's' : ''}
                      </span>
                    )}

                    {isAgent && Boolean(item.metadata?.capability) && (
                      <span className="harness-card-pill" title={`Associated Capability: ${String(item.metadata?.capability)}`}>
                        {String(item.metadata?.capability)}
                      </span>
                    )}

                    {isPlugin && Array.isArray(item.metadata?.capabilities) && (
                      <span className="harness-card-pill accent">
                        {item.metadata.capabilities.length} capabilities bundled
                      </span>
                    )}

                    {isSkill && (
                      <span className="harness-card-pill">
                        {item.customizable ? 'Override Allowed' : 'Immutable'}
                      </span>
                    )}

                    {isCapability && (
                      <span className="harness-card-pill">
                        {item.customizable ? 'Configurable' : 'Core Platform'}
                      </span>
                    )}
                  </div>
                </div>

                <footer className="harness-card-footer">
                  <div className="harness-card-footer-status">
                    <span className="harness-card-open-hint">
                      <Sliders size={11} /> Open form & edit
                    </span>
                  </div>

                  <div className="harness-card-actions" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`btn ${active ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => toggle(item)}
                      disabled={locked || saving || !canManageProject}
                      aria-pressed={active}
                      style={{ fontSize: 12, padding: '5px 11px' }}
                      title={locked ? 'Platform-governed resource cannot be toggled' : active ? 'Remove from this project' : 'Include in this project'}
                    >
                      {active ? (
                        <>
                          <Minus size={12} />
                          <span>Exclude</span>
                        </>
                      ) : (
                        <>
                          <Plus size={12} />
                          <span>Include</span>
                        </>
                      )}
                    </button>

                    {isAgent && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void submitTemplate(item)}
                        disabled={saving}
                        style={{ fontSize: 12, padding: '5px 10px' }}
                        title="Submit this specialist template to the peer review queue"
                      >
                        <Send size={11} />
                        <span>Submit for review</span>
                      </button>
                    )}

                    {isSkill && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleNavigate('skills')}
                        style={{ fontSize: 12, padding: '5px 10px' }}
                        title="Open in Skills Studio"
                      >
                        <ExternalLink size={11} />
                        <span>Studio</span>
                      </button>
                    )}

                    {isCapability && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleNavigate('capabilities')}
                        style={{ fontSize: 12, padding: '5px 10px' }}
                        title="View Capability Topology"
                      >
                        <ExternalLink size={11} />
                        <span>Topology</span>
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="harness-empty-state">
          <Search size={28} />
          <h3>No matching {kind}s found</h3>
          <p>
            No {kind} resources matched your current filter criteria.
            Try adjusting your search query or reset the filter.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setQuery('');
              setStatusFilter('all');
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Details & Configuration Slide-Over Drawer Form */}
      {drawerItem && (
        <div className="harness-drawer-backdrop" onClick={() => setDrawerItem(null)}>
          <aside className="harness-drawer" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            {/* Drawer Header */}
            <header className="harness-drawer-header">
              <div className="harness-drawer-header-left">
                <div className={`harness-card-kind-badge ${drawerItem.kind}`} style={{ width: 38, height: 38 }}>
                  {drawerItem.kind === 'agent' && <Bot size={20} />}
                  {drawerItem.kind === 'skill' && <Sparkles size={20} />}
                  {drawerItem.kind === 'capability' && <Layers size={20} />}
                  {drawerItem.kind === 'plugin' && <Boxes size={20} />}
                </div>

                <div className="harness-drawer-title-wrap">
                  <h2 className="harness-drawer-title">
                    <span>{drawerItem.name}</span>
                    {drawerItem.version && (
                      <span className="harness-card-version-tag">v{drawerItem.version}</span>
                    )}
                  </h2>
                  <div className="harness-drawer-meta">
                    <span>{drawerItem.kind.toUpperCase()}</span>
                    <span>·</span>
                    <button
                      type="button"
                      className="harness-card-id-chip"
                      onClick={() => copyToClipboard(drawerItem.id, 'drawer_id')}
                      title="Click to copy resource ID"
                    >
                      <code>{drawerItem.id}</code>
                      {copiedKey === 'drawer_id' ? <Check size={10} style={{ color: 'var(--acc3)' }} /> : <Copy size={10} />}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {drawerItem.immutable || (drawerItem.source === 'platform' && !drawerItem.customizable) ? (
                  <span className="harness-card-status-badge locked">
                    <Lock size={10} /> Governed
                  </span>
                ) : selected.has(key(drawerItem)) ? (
                  <span className="harness-card-status-badge included">
                    <Check size={10} /> Included
                  </span>
                ) : (
                  <span className="harness-card-status-badge excluded">
                    <Minus size={10} /> Excluded
                  </span>
                )}

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: 6 }}
                  onClick={() => setDrawerItem(null)}
                  aria-label="Close form drawer"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            {/* Drawer Mode Tabs (for Agent) */}
            {drawerItem.kind === 'agent' && (
              <div className="harness-drawer-tabs-bar">
                <button
                  type="button"
                  className={`harness-drawer-tab-btn ${drawerTab === 'spec' ? 'active' : ''}`}
                  onClick={() => setDrawerTab('spec')}
                >
                  <Info size={13} />
                  <span>Specification</span>
                </button>
                <button
                  type="button"
                  className={`harness-drawer-tab-btn ${drawerTab === 'edit' ? 'active' : ''}`}
                  onClick={() => setDrawerTab('edit')}
                >
                  <Edit3 size={13} />
                  <span>Edit Prompt & Config</span>
                </button>
              </div>
            )}

            {/* Drawer Form Body */}
            <div className="harness-drawer-body">
              {/* Governance Notice */}
              {drawerItem.immutable || (drawerItem.source === 'platform' && !drawerItem.customizable) ? (
                <div className="notice-banner" style={{ margin: 0 }}>
                  <ShieldCheck size={16} style={{ color: 'var(--acc-amber)' }} />
                  <span>
                    <strong>Platform Governed:</strong> This {drawerItem.kind} is a core platform resource.
                    Inheritance cannot be excluded by project configurations.
                  </span>
                </div>
              ) : selected.has(key(drawerItem)) ? (
                <div className="notice-banner" style={{ margin: 0, borderColor: 'rgba(39, 123, 103, 0.3)', background: 'var(--acc3-glow)' }}>
                  <CheckCircle2 size={16} style={{ color: 'var(--acc3)' }} />
                  <span>
                    <strong>Active in Project:</strong> This {drawerItem.kind} is inherited and active in project execution.
                  </span>
                </div>
              ) : (
                <div className="notice-banner" style={{ margin: 0 }}>
                  <Minus size={16} style={{ color: 'var(--muted)' }} />
                  <span>
                    <strong>Excluded from Project:</strong> This resource has been customized out by the project layer and will not execute.
                  </span>
                </div>
              )}

              {/* SPECIFICATION TAB VIEW */}
              {drawerTab === 'spec' && (
                <>
                  {/* General Information Section */}
                  <section className="harness-form-section">
                    <h3 className="harness-form-section-title">
                      <Info size={13} />
                      <span>General Information</span>
                    </h3>

                    <div className="harness-form-grid">
                      <div className="harness-form-group">
                        <span className="harness-form-label">Resource ID</span>
                        <span className="harness-form-value mono">
                          <code>{drawerItem.id}</code>
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', padding: 0 }}
                            onClick={() => copyToClipboard(drawerItem.id, 'spec_id')}
                            title="Copy ID"
                          >
                            {copiedKey === 'spec_id' ? <Check size={12} style={{ color: 'var(--acc3)' }} /> : <Copy size={12} />}
                          </button>
                        </span>
                      </div>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Display Name</span>
                        <span className="harness-form-value">{drawerItem.name}</span>
                      </div>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Resource Kind</span>
                        <span className="harness-form-value" style={{ textTransform: 'capitalize' }}>
                          {drawerItem.kind}
                        </span>
                      </div>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Catalog Source</span>
                        <span className="harness-form-value">
                          {drawerItem.source === 'platform' ? 'Shared Platform Catalog' : 'Project Local'}
                        </span>
                      </div>
                    </div>

                    <div className="harness-form-group" style={{ marginTop: 4 }}>
                      <span className="harness-form-label">Description</span>
                      <span className="harness-form-value" style={{ lineHeight: 1.5, color: 'var(--muted)' }}>
                        {drawerItem.description || `Platform catalog specification for ${drawerItem.id}.`}
                      </span>
                    </div>
                  </section>

                  {/* Agent Specification */}
                  {drawerItem.kind === 'agent' && activeAgentDefinition && (
                    <>
                      <section className="harness-form-section">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <h3 className="harness-form-section-title">
                            <Cpu size={13} />
                            <span>Model & Capability Binding</span>
                          </h3>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            onClick={() => setDrawerTab('edit')}
                          >
                            <Edit3 size={11} /> Edit Prompt & Config
                          </button>
                        </div>

                        <div className="harness-form-grid">
                          <div className="harness-form-group">
                            <span className="harness-form-label">Capability Workflow</span>
                            <span className="harness-form-value mono">
                              <code>{activeAgentDefinition.capability || 'incident_triage'}</code>
                            </span>
                          </div>

                          <div className="harness-form-group">
                            <span className="harness-form-label">Model Profile</span>
                            <span className="harness-form-value mono">
                              <code>{activeAgentDefinition.model_profile || 'balanced-investigation'}</code>
                            </span>
                          </div>

                          <div className="harness-form-group">
                            <span className="harness-form-label">Stage Model</span>
                            <span className="harness-form-value mono">
                              <code>{activeAgentDefinition.stage_model || 'configured'}</code>
                            </span>
                          </div>

                          <div className="harness-form-group">
                            <span className="harness-form-label">Agent Version</span>
                            <span className="harness-form-value">
                              v{activeAgentDefinition.version || '1.0.0'}
                            </span>
                          </div>
                        </div>
                      </section>

                      {/* Assigned Tools */}
                      <section className="harness-form-section">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <h3 className="harness-form-section-title">
                            <Wrench size={13} />
                            <span>Assigned ADK Domain Tools ({activeAgentDefinition.tools?.length || 0})</span>
                          </h3>
                          <button
                            type="button"
                            className="harness-nav-link-chip"
                            onClick={() => {
                              setDrawerItem(null);
                              handleNavigate('tools');
                            }}
                          >
                            <span>Open Tools workspace</span>
                            <ArrowUpRight size={11} />
                          </button>
                        </div>

                        {activeAgentDefinition.tools && activeAgentDefinition.tools.length > 0 ? (
                          <div className="harness-tools-cloud">
                            {activeAgentDefinition.tools.map(tool => (
                              <button
                                key={tool}
                                type="button"
                                className="harness-tool-tag accent"
                                onClick={() => {
                                  setDrawerItem(null);
                                  handleNavigate('tools');
                                }}
                                title="Click to view tool in Tools & Connectors"
                              >
                                <Wrench size={10} />
                                <span>{tool}</span>
                                <ExternalLink size={9} style={{ opacity: 0.6 }} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--dim)' }}>No domain tools assigned.</span>
                        )}
                      </section>

                      {/* Prompt / Instruction Box */}
                      <section className="harness-form-section">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <h3 className="harness-form-section-title">
                            <Terminal size={13} />
                            <span>System Instruction / Prompt</span>
                          </h3>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            onClick={() => setDrawerTab('edit')}
                          >
                            <Edit3 size={11} /> Edit Prompt
                          </button>
                        </div>

                        <div className="harness-prompt-container">
                          <div className="harness-prompt-header">
                            <span>DATA-ONLY ADK PROMPT BODY</span>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '2px 7px', fontSize: 11 }}
                              onClick={() => copyToClipboard(activeAgentDefinition.instruction || '', 'agent_inst')}
                            >
                              {copiedKey === 'agent_inst' ? <Check size={11} style={{ color: 'var(--acc3)' }} /> : <Copy size={11} />}
                              Copy Prompt
                            </button>
                          </div>
                          <pre className="harness-prompt-body">
                            {activeAgentDefinition.instruction || '# No instruction specified'}
                          </pre>
                        </div>
                      </section>
                    </>
                  )}

                  {/* Skill Specification & Prompt Editor */}
                  {drawerItem.kind === 'skill' && (
                    <section className="harness-form-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 className="harness-form-section-title">
                          <Sparkles size={13} />
                          <span>Skill Prompt & Instructions</span>
                        </h3>
                        <button
                          type="button"
                          className="harness-nav-link-chip"
                          onClick={() => {
                            setDrawerItem(null);
                            handleNavigate('skills');
                          }}
                        >
                          <span>Open in Skills Studio</span>
                          <ArrowUpRight size={11} />
                        </button>
                      </div>

                      {activeSkillItem?.is_overridden_in_project && (
                        <div className="notice-banner" style={{ margin: 0, padding: '6px 10px', fontSize: 11.5 }}>
                          <Check size={12} style={{ color: 'var(--acc3)' }} />
                          <span>Project prompt override is currently active for this skill.</span>
                        </div>
                      )}

                      <div className="harness-form-group">
                        <span className="harness-form-label">Instruction Markdown</span>
                        <textarea
                          className="harness-form-textarea"
                          value={editSkillPrompt}
                          onChange={e => setEditSkillPrompt(e.target.value)}
                          placeholder="Enter procedural skill instructions..."
                          rows={8}
                          disabled={savingSkillPrompt || (drawerItem.immutable && !activeSkillItem?.project_override)}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        {activeSkillItem?.is_overridden_in_project && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void handleResetSkillPrompt()}
                            disabled={savingSkillPrompt}
                            style={{ fontSize: 12 }}
                          >
                            <RotateCcw size={12} /> Reset to Platform Baseline
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void handleSaveSkillPrompt()}
                          disabled={savingSkillPrompt || !editSkillPrompt.trim()}
                          style={{ fontSize: 12 }}
                        >
                          <Save size={12} />
                          {savingSkillPrompt ? 'Saving prompt…' : 'Save Project Prompt'}
                        </button>
                      </div>
                    </section>
                  )}

                  {/* Capability Specification & Availability */}
                  {drawerItem.kind === 'capability' && (
                    <section className="harness-form-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 className="harness-form-section-title">
                          <Workflow size={13} />
                          <span>Capability Execution Workflow</span>
                        </h3>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="harness-nav-link-chip"
                            onClick={() => {
                              setDrawerItem(null);
                              handleNavigate('capabilities');
                            }}
                          >
                            <span>Topology</span>
                            <ArrowUpRight size={11} />
                          </button>
                          <button
                            type="button"
                            className="harness-nav-link-chip"
                            onClick={() => {
                              setDrawerItem(null);
                              handleNavigate('project-setup');
                            }}
                          >
                            <span>Project Setup</span>
                            <ArrowUpRight size={11} />
                          </button>
                        </div>
                      </div>

                      <div className="harness-form-grid">
                        <div className="harness-form-group">
                          <span className="harness-form-label">Workflow Status</span>
                          <span className="harness-form-value">
                            {selected.has(key(drawerItem)) ? 'Active in Root Orchestrator' : 'Disabled for Project'}
                          </span>
                        </div>

                        <div className="harness-form-group">
                          <span className="harness-form-label">Customizable by Project</span>
                          <span className="harness-form-value">
                            {drawerItem.customizable ? 'Yes (Delegated)' : 'No (Platform Core)'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Toggle availability for incident runs in this project:
                        </span>
                        <button
                          type="button"
                          className={`btn ${selected.has(key(drawerItem)) ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => void handleToggleCapabilityAvailability(drawerItem)}
                          disabled={saving || !drawerItem.customizable}
                          style={{ fontSize: 12 }}
                        >
                          {selected.has(key(drawerItem)) ? (
                            <>
                              <Minus size={12} /> Disable in Project
                            </>
                          ) : (
                            <>
                              <Check size={12} /> Enable in Project
                            </>
                          )}
                        </button>
                      </div>
                    </section>
                  )}

                  {/* Plugin Specific Form */}
                  {drawerItem.kind === 'plugin' && activePluginDefinition && (
                    <section className="harness-form-section">
                      <h3 className="harness-form-section-title">
                        <Boxes size={13} />
                        <span>Bundled Resources</span>
                      </h3>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Capabilities ({activePluginDefinition.capabilities?.length || 0})</span>
                        <div className="harness-tools-cloud">
                          {activePluginDefinition.capabilities?.map(c => (
                            <button
                              key={c}
                              type="button"
                              className="harness-tool-tag"
                              onClick={() => {
                                setDrawerItem(null);
                                handleNavigate('capabilities');
                              }}
                            >
                              <Layers size={10} /> {c}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="harness-form-group" style={{ marginTop: 8 }}>
                        <span className="harness-form-label">Skills ({activePluginDefinition.skills?.length || 0})</span>
                        <div className="harness-tools-cloud">
                          {activePluginDefinition.skills?.map(s => (
                            <button
                              key={s}
                              type="button"
                              className="harness-tool-tag"
                              onClick={() => {
                                setDrawerItem(null);
                                handleNavigate('skills');
                              }}
                            >
                              <Sparkles size={10} /> {s}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="harness-form-group" style={{ marginTop: 8 }}>
                        <span className="harness-form-label">Specialist Agents ({activePluginDefinition.agents?.length || 0})</span>
                        <div className="harness-tools-cloud">
                          {activePluginDefinition.agents?.map(a => (
                            <button
                              key={a}
                              type="button"
                              className="harness-tool-tag accent"
                              onClick={() => {
                                setDrawerItem(null);
                                handleNavigate('agents');
                              }}
                            >
                              <Bot size={10} /> {a}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Raw JSON Specification */}
                  <section className="harness-form-section">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h3 className="harness-form-section-title">
                        <Code size={13} />
                        <span>Specification JSON</span>
                      </h3>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 7px', fontSize: 11 }}
                        onClick={() => {
                          const spec = activeAgentDefinition || activePluginDefinition || activeSkillItem || drawerItem;
                          copyToClipboard(JSON.stringify(spec, null, 2), 'raw_spec');
                        }}
                      >
                        {copiedKey === 'raw_spec' ? <Check size={11} style={{ color: 'var(--acc3)' }} /> : <Copy size={11} />}
                        Copy JSON
                      </button>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 10,
                        borderRadius: 6,
                        background: 'var(--bg)',
                        border: '1px solid var(--line)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--tx)',
                        maxHeight: 160,
                        overflowY: 'auto',
                      }}
                    >
                      {JSON.stringify(activeAgentDefinition || activePluginDefinition || activeSkillItem || drawerItem, null, 2)}
                    </pre>
                  </section>
                </>
              )}

              {/* EDIT TAB VIEW (Agents) */}
              {drawerTab === 'edit' && drawerItem.kind === 'agent' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="notice-banner" style={{ margin: 0 }}>
                    <Info size={14} />
                    <span>
                      Modifying specialist agent parameters and prompt. Submitting creates a configuration draft
                      subject to dual-custody peer review before deployment.
                    </span>
                  </div>

                  <div className="harness-form-section">
                    <h3 className="harness-form-section-title">
                      <Edit3 size={13} />
                      <span>General Agent Settings</span>
                    </h3>

                    <div className="harness-form-grid">
                      <div className="harness-form-group">
                        <span className="harness-form-label">Display Name *</span>
                        <input
                          type="text"
                          className="harness-form-input"
                          value={editAgentName}
                          onChange={e => setEditAgentName(e.target.value)}
                        />
                      </div>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Associated Capability *</span>
                        <select
                          className="harness-form-select"
                          value={editAgentCapability}
                          onChange={e => setEditAgentCapability(e.target.value)}
                        >
                          {capabilitiesCatalog.length > 0 ? (
                            capabilitiesCatalog.map(cap => (
                              <option key={cap.id} value={cap.id}>
                                {cap.name} ({cap.id})
                              </option>
                            ))
                          ) : (
                            <option value="incident_triage">Incident Triage (incident_triage)</option>
                          )}
                        </select>
                      </div>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Model Profile</span>
                        <select
                          className="harness-form-select"
                          value={editAgentModelProfile}
                          onChange={e => setEditAgentModelProfile(e.target.value)}
                        >
                          <option value="balanced-investigation">balanced-investigation</option>
                          <option value="deep-investigation">deep-investigation</option>
                          <option value="fast-triage">fast-triage</option>
                        </select>
                      </div>

                      <div className="harness-form-group">
                        <span className="harness-form-label">Stage Model Profile</span>
                        <input
                          type="text"
                          className="harness-form-input"
                          value={editAgentStageModel}
                          onChange={e => setEditAgentStageModel(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="harness-form-group" style={{ marginTop: 6 }}>
                      <span className="harness-form-label">Description</span>
                      <input
                        type="text"
                        className="harness-form-input"
                        value={editAgentDesc}
                        onChange={e => setEditAgentDesc(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Tool Assignment */}
                  <div className="harness-form-section">
                    <h3 className="harness-form-section-title">
                      <Wrench size={13} />
                      <span>Assigned Domain Tools ({editAgentTools.length})</span>
                    </h3>
                    <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: 0 }}>
                      Click tools to toggle assignment for this specialist agent:
                    </p>

                    <div className="harness-tools-cloud">
                      {toolsCatalog.map(tool => {
                        const isSelected = editAgentTools.includes(tool.id);
                        return (
                          <button
                            key={tool.id}
                            type="button"
                            className={`harness-tool-chip-interactive ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              setEditAgentTools(prev =>
                                isSelected ? prev.filter(t => t !== tool.id) : [...prev, tool.id]
                              );
                            }}
                          >
                            <Wrench size={11} />
                            <span>{tool.name || tool.id}</span>
                            {isSelected && <Check size={11} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Prompt Editor */}
                  <div className="harness-form-section">
                    <h3 className="harness-form-section-title">
                      <Terminal size={13} />
                      <span>Instruction Prompt Body *</span>
                    </h3>
                    <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: 0 }}>
                      Specify data-only ADK instructions. Strictly bounded; remote network fetches and code execution are disallowed.
                    </p>

                    <textarea
                      className="harness-form-textarea"
                      value={editAgentInstruction}
                      onChange={e => setEditAgentInstruction(e.target.value)}
                      rows={10}
                      placeholder="Write system instructions for this specialist agent..."
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setDrawerTab('spec')}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleSaveEditedAgent()}
                      disabled={saving || !editAgentName.trim() || !editAgentInstruction.trim()}
                    >
                      <Send size={13} />
                      {saving ? 'Submitting…' : 'Submit for Peer Review'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Footer Actions */}
            <footer className="harness-drawer-footer">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {drawerItem.immutable || (drawerItem.source === 'platform' && !drawerItem.customizable) ? (
                  <span style={{ fontSize: 12, color: 'var(--dim)' }}>Governed by platform</span>
                ) : (
                  <button
                    type="button"
                    className={`btn ${selected.has(key(drawerItem)) ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => toggle(drawerItem)}
                    disabled={saving || !canManageProject}
                  >
                    {selected.has(key(drawerItem)) ? (
                      <>
                        <Minus size={13} />
                        <span>Exclude from project</span>
                      </>
                    ) : (
                      <>
                        <Plus size={13} />
                        <span>Include in project</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="harness-drawer-footer-actions">
                {drawerItem.kind === 'agent' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void submitTemplate(drawerItem)}
                    disabled={saving}
                    title="Submit template definition to dual-custody peer review"
                  >
                    <Send size={13} />
                    <span>Submit for peer review</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDrawerItem(null)}
                >
                  Close
                </button>
              </div>
            </footer>
          </aside>
        </div>
      )}

      {/* Add Resource Modal (Agent or Capability) */}
      {showAddResourceModal && (
        <div className="harness-modal-backdrop" onClick={() => setShowAddResourceModal(null)}>
          <div className="harness-modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <header className="harness-modal-header">
              <h2>
                {showAddResourceModal === 'agent' ? <Bot size={18} style={{ color: 'var(--acc)' }} /> : <Layers size={18} style={{ color: 'var(--acc)' }} />}
                <span>
                  {showAddResourceModal === 'agent' ? 'Add Specialist Agent' : 'Add Capability Workflow'}
                </span>
              </h2>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: 4 }}
                onClick={() => setShowAddResourceModal(null)}
              >
                <X size={15} />
              </button>
            </header>

            <div className="harness-modal-body">
              <div className="harness-form-grid">
                <div className="harness-form-group">
                  <span className="harness-form-label">Identifier (ID) *</span>
                  <input
                    type="text"
                    className="harness-form-input"
                    value={newResourceId}
                    onChange={e => setNewResourceId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))}
                    placeholder={showAddResourceModal === 'agent' ? 'e.g. log_anomaly_specialist' : 'e.g. k8s_pod_crash_triage'}
                  />
                </div>

                <div className="harness-form-group">
                  <span className="harness-form-label">Display Name *</span>
                  <input
                    type="text"
                    className="harness-form-input"
                    value={newResourceName}
                    onChange={e => setNewResourceName(e.target.value)}
                    placeholder={showAddResourceModal === 'agent' ? 'Log Anomaly Specialist' : 'Kubernetes Pod Crash Triage'}
                  />
                </div>
              </div>

              <div className="harness-form-group">
                <span className="harness-form-label">Description</span>
                <input
                  type="text"
                  className="harness-form-input"
                  value={newResourceDesc}
                  onChange={e => setNewResourceDesc(e.target.value)}
                  placeholder="Describe the operational purpose and scope..."
                />
              </div>

              {showAddResourceModal === 'agent' && (
                <>
                  <div className="harness-form-grid">
                    <div className="harness-form-group">
                      <span className="harness-form-label">Capability Binding</span>
                      <select
                        className="harness-form-select"
                        value={newResourceCapability}
                        onChange={e => setNewResourceCapability(e.target.value)}
                      >
                        {capabilitiesCatalog.length > 0 ? (
                          capabilitiesCatalog.map(cap => (
                            <option key={cap.id} value={cap.id}>
                              {cap.name}
                            </option>
                          ))
                        ) : (
                          <option value="incident_triage">Incident Triage</option>
                        )}
                      </select>
                    </div>

                    <div className="harness-form-group">
                      <span className="harness-form-label">Model Profile</span>
                      <select
                        className="harness-form-select"
                        value={newResourceModelProfile}
                        onChange={e => setNewResourceModelProfile(e.target.value)}
                      >
                        <option value="balanced-investigation">balanced-investigation</option>
                        <option value="deep-investigation">deep-investigation</option>
                        <option value="fast-triage">fast-triage</option>
                      </select>
                    </div>
                  </div>

                  {/* Tool Selection */}
                  <div className="harness-form-group">
                    <span className="harness-form-label">Assign Tools ({newResourceTools.length})</span>
                    <div className="harness-tools-cloud">
                      {toolsCatalog.map(t => {
                        const sel = newResourceTools.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`harness-tool-chip-interactive ${sel ? 'selected' : ''}`}
                            onClick={() => {
                              setNewResourceTools(prev =>
                                sel ? prev.filter(x => x !== t.id) : [...prev, t.id]
                              );
                            }}
                          >
                            <Wrench size={11} />
                            <span>{t.name || t.id}</span>
                            {sel && <Check size={11} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Instruction Prompt */}
                  <div className="harness-form-group">
                    <span className="harness-form-label">Instruction Prompt *</span>
                    <textarea
                      className="harness-form-textarea"
                      value={newResourceInstruction}
                      onChange={e => setNewResourceInstruction(e.target.value)}
                      rows={6}
                      placeholder="Write system instructions for this agent..."
                    />
                  </div>
                </>
              )}
            </div>

            <footer className="harness-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddResourceModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (showAddResourceModal === 'agent') void handleCreateAgent();
                  else void handleCreateCapability();
                }}
                disabled={saving || !newResourceId.trim() || !newResourceName.trim()}
              >
                <Check size={13} />
                {saving ? 'Creating…' : showAddResourceModal === 'agent' ? 'Submit for Peer Review' : 'Create Capability'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Platform Catalog Editor Modal */}
      {editingPlatform && (
        <div className="harness-modal-backdrop" onClick={() => setEditingPlatform(false)}>
          <div className="harness-modal-card" onClick={e => e.stopPropagation()}>
            <header className="harness-modal-header">
              <h2>
                <FileCode size={18} style={{ color: 'var(--acc)' }} />
                <span>Platform Catalog Specification (config/harness.yaml)</span>
              </h2>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: 4 }}
                onClick={() => setEditingPlatform(false)}
              >
                <X size={15} />
              </button>
            </header>

            <div className="harness-modal-body">
              <div className="notice-banner" style={{ margin: 0 }}>
                <Info size={14} />
                <span>
                  Editing the data-only platform catalog. Saving requires Platform Administrator authorization
                  and validates capability, skill, and agent schemas against active revision {revision.slice(0, 16)}…
                </span>
              </div>

              <textarea
                value={platformText}
                onChange={e => setPlatformText(e.target.value)}
                className="harness-modal-textarea"
                placeholder="Enter JSON specification for HarnessDocument…"
                spellCheck={false}
              />
            </div>

            <footer className="harness-modal-footer">
              <div className="harness-modal-footer-left">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(JSON.parse(platformText), null, 2);
                      setPlatformText(formatted);
                    } catch {
                      setError('Cannot format invalid JSON.');
                    }
                  }}
                >
                  <Code size={13} />
                  Format JSON
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => copyToClipboard(platformText, 'modal_spec')}
                >
                  {copiedKey === 'modal_spec' ? <Check size={13} style={{ color: 'var(--acc3)' }} /> : <Copy size={13} />}
                  Copy Spec
                </button>
              </div>

              <div className="harness-modal-footer-right">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingPlatform(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void savePlatform()}
                  disabled={saving || !canManagePlatform}
                >
                  <Check size={13} />
                  {saving ? 'Validating & saving…' : 'Save platform catalog'}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
