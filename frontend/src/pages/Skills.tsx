import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  FileCode,
  Workflow,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Lock,
  Sliders,
  ArrowRight,
  ExternalLink,
  AlertCircle,
  Edit3,
  RotateCcw,
  Sparkles,
  Plug,
  X,
  Play,
  Clock,
  User,
} from 'lucide-react';
import {
  ApiError,
  createSkill,
  fetchCapabilities,
  fetchConfig,
  fetchPrincipal,
  fetchSkills,
  resetProjectSkill,
  reviewSkill,
  saveProjectSkill,
  setProjectAvailability,
} from '../services/api';
import type {
  CapabilityItem,
  Principal,
  RuntimeConfig,
  SkillCreatePayload,
  SkillItem,
} from '../types/api';
import type { ActivePage } from '../components/Sidebar';
import '../styles/skills-studio.css';

interface SkillsProps {
  principal?: Principal | null;
  onNavigate?: (page: ActivePage) => void;
}

type TabKey = 'instructions' | 'capabilities' | 'governance' | 'manifest';
type ViewMode = 'catalog' | 'matrix';

const instructionLimit = 16_000;

const skillFromLocation = () =>
  new URLSearchParams(window.location.search).get('skill') ||
  new URLSearchParams(window.location.hash.split('?')[1] || '').get('skill') ||
  '';

const emptyDraft = (): SkillCreatePayload => ({
  id: '',
  name: '',
  description: '',
  instruction: '',
  capabilities: [],
  actions: [],
  project_override: false,
});

const instructionFor = (skill: SkillItem) =>
  skill.project_instruction ?? skill.instruction_body ?? skill.content ?? '';

const skillLabel = (skill: SkillItem) =>
  skill.name && skill.name !== skill.id
    ? skill.name
    : skill.id.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase());

const isActiveSkill = (skill: SkillItem) =>
  skill.status === 'configured' || skill.status === 'APPROVED';

const statusFor = (skill: SkillItem) => {
  const lifecycle: Record<string, string> = {
    PENDING: 'Awaiting Approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    REVOKED: 'Revoked',
  };
  if (skill.status && lifecycle[skill.status]) {
    return lifecycle[skill.status];
  }
  if (skill.project_enabled === false) {
    return 'Disabled in Project';
  }
  if (skill.immutable) {
    return 'Protected';
  }
  if (skill.is_overridden_in_project) {
    return 'Customized';
  }
  return 'Platform Baseline';
};

function availableSkillActions(capabilities: CapabilityItem[], selected: string[]): string[] {
  if (!selected.length) return [];
  const chosen = selected.map(id => capabilities.find(cap => cap.id === id));
  if (chosen.some(cap => !cap || !cap.enabled || !cap.is_authorized || cap.project_enabled === false)) {
    return [];
  }
  return [...new Set(chosen[0]?.permissions?.allowed_actions ?? [])]
    .filter(action => chosen.every(cap => cap?.permissions?.allowed_actions?.includes(action)))
    .sort();
}

export const Skills: React.FC<SkillsProps> = ({ principal: initialPrincipal, onNavigate }) => {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(initialPrincipal ?? null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string>(skillFromLocation);
  const [activeTab, setActiveTab] = useState<TabKey>('instructions');
  const [viewMode, setViewMode] = useState<ViewMode>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [copied, setCopied] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);

  // Modals & Editing
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [draft, setDraft] = useState<SkillCreatePayload>(emptyDraft);
  const [customId, setCustomId] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);

  const [reviewModalAction, setReviewModalAction] = useState<'approve' | 'reject' | 'revoke' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editBusy, setEditBusy] = useState(false);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const canCreate = principal?.roles?.includes('PLATFORM_ADMIN') ?? false;
  const canCustomize =
    principal?.roles?.some(role => role === 'PLATFORM_ADMIN' || role === 'PROJECT_OWNER') ?? false;

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [skillsData, capabilitiesData, configData, meData] = await Promise.all([
        fetchSkills(),
        fetchCapabilities(true),
        fetchConfig(),
        fetchPrincipal().catch(() => initialPrincipal ?? null),
      ]);

      setSkills(skillsData);
      setCapabilities(capabilitiesData);
      setConfig(configData);
      if (meData) setPrincipal(meData);

      if (skillsData.length > 0) {
        setSelectedSkillId(current =>
          skillsData.some(s => s.id === current) ? current : skillsData[0].id
        );
      }
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to load skills catalog.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const selectLinkedSkill = () => {
      const id = skillFromLocation();
      if (id && skills.some(s => s.id === id)) {
        setSelectedSkillId(id);
        setViewMode('catalog');
      }
    };
    window.addEventListener('hashchange', selectLinkedSkill);
    window.addEventListener('popstate', selectLinkedSkill);
    return () => {
      window.removeEventListener('hashchange', selectLinkedSkill);
      window.removeEventListener('popstate', selectLinkedSkill);
    };
  }, [skills]);

  // Extract unique categories dynamically from frontmatter
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    skills.forEach(skill => {
      const cat = skill.frontmatter?.category || skill.stage;
      if (cat) cats.add(cat);
    });
    return Array.from(cats).sort();
  }, [skills]);

  // Filter skills by search query, category, and status
  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return skills.filter(skill => {
      const skillCat = skill.frontmatter?.category || skill.stage || '';
      if (selectedCategory !== 'all' && skillCat !== selectedCategory) {
        return false;
      }
      if (statusFilter === 'active' && !isActiveSkill(skill)) return false;
      if (statusFilter === 'customized' && !skill.is_overridden_in_project) return false;
      if (statusFilter === 'pending' && skill.status !== 'PENDING') return false;
      if (statusFilter === 'disabled' && skill.project_enabled !== false) return false;
      if (statusFilter === 'immutable' && !skill.immutable) return false;

      if (!q) return true;
      const haystack = [
        skill.id,
        skill.name || '',
        skill.frontmatter?.summary || '',
        skillCat,
        skill.author_subject || '',
        skill.reviewer_subject || '',
        ...(skill.capabilities || []),
        ...(skill.allowed_actions || []),
        ...(skill.project_actions || []),
        ...(skill.frontmatter?.forbidden_tools || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [skills, searchQuery, selectedCategory, statusFilter]);

  const selectedSkill = useMemo(() => {
    if (!skills.length) return null;
    return (
      skills.find(s => s.id === selectedSkillId) ||
      filteredSkills[0] ||
      skills[0]
    );
  }, [skills, selectedSkillId, filteredSkills]);

  // Associated capabilities
  const boundCapabilities = useMemo(() => {
    if (!selectedSkill) return [];
    return capabilities.filter(
      cap =>
        cap.skills?.includes(selectedSkill.id) ||
        selectedSkill.capabilities?.includes(cap.id)
    );
  }, [selectedSkill, capabilities]);

  const isSkillEditable =
    canCustomize &&
    Boolean(selectedSkill?.project_override) &&
    !selectedSkill?.immutable &&
    Boolean(selectedSkill && isActiveSkill(selectedSkill));

  // Switch skill and reset editing
  const selectSkill = (id: string) => {
    setSelectedSkillId(id);
    setIsEditing(false);
    setConfirmResetOpen(false);
    setNotice(null);
  };

  // Copy manifest
  const handleCopyManifest = async () => {
    if (!selectedSkill) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            id: selectedSkill.id,
            name: selectedSkill.name,
            status: selectedSkill.status,
            category: selectedSkill.frontmatter?.category || selectedSkill.stage,
            summary: selectedSkill.frontmatter?.summary,
            capabilities: selectedSkill.capabilities,
            allowed_actions: selectedSkill.allowed_actions,
            forbidden_tools: selectedSkill.frontmatter?.forbidden_tools,
            immutable: selectedSkill.immutable,
            sha256: selectedSkill.sha256,
            effective_hash: selectedSkill.effective_hash,
            content: selectedSkill.content,
          },
          null,
          2
        )
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Unable to copy manifest. Select text directly.');
    }
  };

  // Toggle Project Availability
  const handleToggleAvailability = async () => {
    if (!selectedSkill || availabilityBusy) return;
    const currentEnabled = selectedSkill.project_enabled !== false;
    const newEnabled = !currentEnabled;
    setAvailabilityBusy(true);
    setNotice(null);
    try {
      await setProjectAvailability(
        'skills',
        selectedSkill.id,
        newEnabled,
        currentEnabled
      );
      setSkills(prev =>
        prev.map(s =>
          s.id === selectedSkill.id ? { ...s, project_enabled: newEnabled } : s
        )
      );
      setNotice({
        error: false,
        message: newEnabled
          ? `Skill '${skillLabel(selectedSkill)}' enabled for new project investigations.`
          : `Skill '${skillLabel(selectedSkill)}' disabled for new project investigations.`,
      });
    } catch (cause: unknown) {
      setNotice({
        error: true,
        message: cause instanceof ApiError ? cause.message : 'Failed to update project availability.',
      });
    } finally {
      setAvailabilityBusy(false);
    }
  };

  // Start Customize Instructions
  const startEditInstructions = () => {
    if (!selectedSkill) return;
    setEditInstruction(instructionFor(selectedSkill));
    setEditEnabled(selectedSkill.project_enabled ?? true);
    setIsEditing(true);
    setNotice(null);
  };

  // Save Project Instructions
  const handleSaveProjectInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSkill || editBusy || !editInstruction.trim()) return;
    setEditBusy(true);
    setNotice(null);
    try {
      const saved = await saveProjectSkill(selectedSkill.id, {
        instruction: editInstruction.trim(),
        enabled: editEnabled,
        expected_hash: selectedSkill.effective_hash,
      });
      setSkills(prev =>
        prev.map(s =>
          s.id === selectedSkill.id
            ? {
                ...s,
                is_overridden_in_project: true,
                project_instruction: saved.project_instruction,
                project_enabled: saved.project_enabled,
                effective_hash: saved.effective_hash,
              }
            : s
        )
      );
      setIsEditing(false);
      setNotice({
        error: false,
        message: `Project instructions for '${skillLabel(selectedSkill)}' saved successfully.`,
      });
    } catch (cause: unknown) {
      setNotice({
        error: true,
        message: cause instanceof ApiError ? cause.message : 'Unable to save project instructions.',
      });
    } finally {
      setEditBusy(false);
    }
  };

  // Reset to Platform Baseline
  const handleResetBaseline = async () => {
    if (!selectedSkill || resetBusy) return;
    setResetBusy(true);
    setNotice(null);
    try {
      await resetProjectSkill(selectedSkill.id, selectedSkill.effective_hash);
      setSkills(prev =>
        prev.map(s =>
          s.id === selectedSkill.id
            ? {
                ...s,
                is_overridden_in_project: false,
                project_instruction: null,
                project_enabled: true,
                project_actions: null,
                effective_hash: undefined,
              }
            : s
        )
      );
      setConfirmResetOpen(false);
      setIsEditing(false);
      setNotice({
        error: false,
        message: `Project customization removed. Skill now uses platform instructions.`,
      });
      void loadAll();
    } catch (cause: unknown) {
      setNotice({
        error: true,
        message: cause instanceof ApiError ? cause.message : 'Failed to restore platform instructions.',
      });
    } finally {
      setResetBusy(false);
    }
  };

  // Review Skill (Approve / Reject / Revoke)
  const handleReviewSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSkill?.content_hash || !reviewModalAction || reviewBusy || !reviewReason.trim()) return;
    setReviewBusy(true);
    setNotice(null);
    try {
      const reviewed = await reviewSkill(
        selectedSkill.id,
        reviewModalAction,
        selectedSkill.content_hash,
        reviewReason.trim()
      );
      setSkills(prev => prev.map(s => (s.id === reviewed.id ? reviewed : s)));
      setReviewModalAction(null);
      setReviewReason('');
      setNotice({
        error: false,
        message:
          reviewed.status === 'APPROVED'
            ? `Skill '${skillLabel(reviewed)}' approved. Ready for investigation runs.`
            : reviewed.status === 'REVOKED'
            ? `Skill '${skillLabel(reviewed)}' revoked.`
            : `Skill '${skillLabel(reviewed)}' rejected.`,
      });
      void loadAll();
    } catch (cause: unknown) {
      setNotice({
        error: true,
        message: cause instanceof ApiError ? cause.message : 'Failed to submit review.',
      });
    } finally {
      setReviewBusy(false);
    }
  };

  // Create Skill
  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate || draftBusy) return;
    if (
      !draft.name.trim() ||
      !draft.description.trim() ||
      !draft.instruction.trim() ||
      !draft.capabilities.length
    ) {
      setNotice({
        error: true,
        message: 'Fill all required fields and select at least one capability.',
      });
      return;
    }
    setDraftBusy(true);
    setNotice(null);
    try {
      const created = await createSkill({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        instruction: draft.instruction.trim(),
      });
      setSkills(prev => [...prev, created].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)));
      setSelectedSkillId(created.id);
      setCreateModalOpen(false);
      setDraft(emptyDraft());
      setNotice({
        error: false,
        message: `Skill '${skillLabel(created)}' created and awaiting independent administrator approval.`,
      });
    } catch (cause: unknown) {
      setNotice({
        error: true,
        message: cause instanceof ApiError ? cause.message : 'Unable to create skill.',
      });
    } finally {
      setDraftBusy(false);
    }
  };

  // Toggle Capability selection in create draft
  const toggleDraftCapability = (capId: string) => {
    setDraft(current => {
      const nextCaps = current.capabilities.includes(capId)
        ? current.capabilities.filter(id => id !== capId)
        : [...current.capabilities, capId];
      const allowedActions = availableSkillActions(capabilities, nextCaps);
      return {
        ...current,
        capabilities: nextCaps,
        actions: current.actions.filter(a => allowedActions.includes(a)),
      };
    });
  };

  // Toggle Tool Action in create draft
  const toggleDraftAction = (action: string) => {
    setDraft(current => ({
      ...current,
      actions: current.actions.includes(action)
        ? current.actions.filter(a => a !== action)
        : [...current.actions, action],
    }));
  };

  // Open capability in Capabilities page
  const openCapability = (capId: string) => {
    if (onNavigate) {
      const url = new URL(window.location.href);
      url.searchParams.delete('skill');
      url.searchParams.set('capability', capId);
      window.history.replaceState({}, '', url);
      onNavigate('capabilities');
    } else {
      window.location.href = `/admins/capabilities?capability=${encodeURIComponent(capId)}`;
    }
  };

  // Launch chat with this skill
  const launchInvestigationWithSkill = (capId: string) => {
    if (onNavigate) {
      const url = new URL(window.location.href);
      url.searchParams.set('capability', capId);
      url.searchParams.set('skill', selectedSkill?.id || '');
      window.history.replaceState({}, '', url);
      onNavigate('chat');
    } else {
      window.location.href = `/workspace?capability=${encodeURIComponent(capId)}&skill=${encodeURIComponent(selectedSkill?.id || '')}`;
    }
  };

  const availableDraftCapabilities = capabilities.filter(
    cap => cap.enabled && cap.is_authorized && cap.project_enabled !== false
  );
  const availableDraftActions = availableSkillActions(capabilities, draft.capabilities);

  // Matrix View Data
  const matrixData = useMemo(() => {
    return capabilities.map(cap => {
      const bound = skills.filter(
        s => cap.skills?.includes(s.id) || s.capabilities?.includes(cap.id)
      );
      return {
        capability: cap,
        skills: bound,
        allowedActions: cap.permissions?.allowed_actions || [],
      };
    });
  }, [capabilities, skills]);

  return (
    <div className="view-container skills-page">
      {/* Breadcrumbs */}
      <nav className="skills-breadcrumbs" aria-label="Breadcrumbs">
        <span>Admin</span>
        <span className="separator">/</span>
        <span className="active-crumb">Knowledge & Instruction Skills</span>
      </nav>

      {/* Hero Banner matching Capabilities style */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            <BookOpen size={22} color="var(--acc)" />
            Knowledge & Instruction Skills <span>Execution Contracts</span>
          </h1>
          <p className="hero-lede">
            Declarative domain guidance, triage workflows, and reasoning boundaries attached to investigation capabilities, evaluated database-first.
          </p>

          <div className="hero-meta-strip">
            <span className="hero-stat-chip highlight">
              <Layers size={12} /> Skills: <b>{skills.length}</b>
            </span>
            <span className="hero-stat-chip">
              <Workflow size={12} /> Workflows: <b>{capabilities.length}</b>
            </span>
            <span className="hero-stat-chip">
              <Sparkles size={12} /> Customized: <b>{skills.filter(s => s.is_overridden_in_project).length}</b>
            </span>
            <span className="hero-stat-chip">
              <Clock size={12} /> Pending: <b>{skills.filter(s => s.status === 'PENDING').length}</b>
            </span>
            <span className="hero-stat-chip">
              Mode: <b>{config?.mode || 'demo'}</b>
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <div className="skills-view-switcher" role="tablist" aria-label="Skills View Mode">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'catalog'}
                className={`skills-view-btn ${viewMode === 'catalog' ? 'is-active' : ''}`}
                onClick={() => setViewMode('catalog')}
              >
                <BookOpen size={13} />
                Catalog ({skills.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'matrix'}
                className={`skills-view-btn ${viewMode === 'matrix' ? 'is-active' : ''}`}
                onClick={() => setViewMode('matrix')}
              >
                <Sliders size={13} />
                Capability Matrix ({capabilities.length})
              </button>
            </div>

            {canCreate && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setDraft(emptyDraft());
                  setCustomId(false);
                  setCreateModalOpen(true);
                }}
                disabled={loading}
              >
                <Plus size={13} />
                Add Skill
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadAll()}
              title="Reload from server"
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Notice & Error Banners */}
      {error && (
        <div
          className="card"
          style={{
            color: 'var(--danger, #ef4444)',
            borderColor: 'var(--danger, #ef4444)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void loadAll()}>
            Retry
          </button>
        </div>
      )}

      {notice && (
        <div
          className="card"
          style={{
            color: notice.error ? 'var(--acc-rose)' : 'var(--acc-teal)',
            borderColor: notice.error ? 'var(--acc-rose)' : 'var(--acc-teal)',
            background: notice.error ? 'rgba(244, 63, 94, 0.08)' : 'rgba(91, 192, 158, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {notice.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{notice.message}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '2px 6px', height: 'auto', minHeight: 'unset' }}
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* VIEW 1: MASTER-DETAIL SKILLS CATALOG */}
      {viewMode === 'catalog' && (
        <div className="skills-workspace-layout">
          {/* Column 1: Skills Catalog Panel (Left) */}
          <section className="skills-catalog-column" aria-label="Skills Catalog">
            <div className="skills-catalog-header">
              <div className="skills-catalog-title-row">
                <h2>
                  <BookOpen size={15} color="var(--acc)" />
                  Skills Library
                </h2>
                <span className="skills-catalog-count-badge">
                  {filteredSkills.length} / {skills.length}
                </span>
              </div>

              {/* Search Box */}
              <div className="skills-search-wrap">
                <Search size={13} />
                <input
                  type="search"
                  className="skills-search-input"
                  placeholder="Search skills, tools, workflows…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Category Filter Tabs */}
              <div className="skills-filter-tabs">
                <button
                  type="button"
                  className={`skills-filter-tab ${selectedCategory === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  All ({skills.length})
                </button>
                {availableCategories.map(cat => {
                  const catCount = skills.filter(
                    s => (s.frontmatter?.category || s.stage) === cat
                  ).length;
                  return (
                    <button
                      type="button"
                      key={cat}
                      className={`skills-filter-tab ${selectedCategory === cat ? 'is-active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {cat} ({catCount})
                    </button>
                  );
                })}
              </div>

              {/* Status Filter Row */}
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px', overflowX: 'auto', scrollbarWidth: 'none' }}>
                {[
                  { id: 'all', label: 'All Statuses' },
                  { id: 'active', label: 'Active' },
                  { id: 'customized', label: 'Customized' },
                  { id: 'pending', label: 'Pending' },
                  { id: 'disabled', label: 'Disabled' },
                ].map(item => (
                  <button
                    key={item.id}
                    type="button"
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: statusFilter === item.id ? 'var(--acc)' : 'var(--line)',
                      background: statusFilter === item.id ? 'var(--card-active)' : 'transparent',
                      color: statusFilter === item.id ? 'var(--acc)' : 'var(--muted)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => setStatusFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bounded Items List */}
            <div className="skills-items-list" role="listbox" aria-label="Available Skills">
              {loading && !skills.length ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                  <RefreshCw size={18} className="spin" style={{ margin: '0 auto 8px auto', color: 'var(--acc)' }} />
                  Loading skills catalog…
                </div>
              ) : filteredSkills.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                  <BookOpen size={20} style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
                  <div>No skills match filters.</div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('all');
                      setStatusFilter('all');
                    }}
                    style={{ marginTop: '10px', fontSize: '11px', padding: '4px 10px' }}
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                filteredSkills.map(skill => {
                  const isSelected = selectedSkill?.id === skill.id;
                  const isEnabled = skill.project_enabled !== false;
                  const isPending = skill.status === 'PENDING';
                  const isCustom = skill.is_overridden_in_project;
                  const skillCategory = skill.frontmatter?.category || skill.stage || 'workflow';
                  const boundCount = (skill.capabilities || []).length;
                  const actionsCount = (skill.project_actions ?? skill.allowed_actions ?? []).length;

                  return (
                    <button
                      key={skill.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectSkill(skill.id)}
                      className={`skill-item-card ${isSelected ? 'is-selected' : ''}`}
                    >
                      {/* Avatar Icon */}
                      <div
                        className={`skill-avatar-icon ${
                          !isEnabled ? 'disabled' : isPending ? 'pending' : isCustom ? 'customized' : ''
                        }`}
                      >
                        {skill.immutable ? (
                          <Lock size={15} />
                        ) : isCustom ? (
                          <Sparkles size={15} />
                        ) : skillCategory === 'triage' ? (
                          <Layers size={15} />
                        ) : (
                          <FileCode size={15} />
                        )}
                      </div>

                      {/* Content Body */}
                      <div className="skill-item-body">
                        <div className="skill-item-header">
                          <span className="skill-item-title" title={skill.name || skill.id}>
                            {skillLabel(skill)}
                          </span>
                          {!isEnabled ? (
                            <span className="badge badge-neutral" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                              Disabled
                            </span>
                          ) : isPending ? (
                            <span
                              className="badge"
                              style={{
                                fontSize: '9.5px',
                                padding: '1px 5px',
                                background: 'rgba(245, 158, 11, 0.1)',
                                color: 'var(--acc-amber, #f59e0b)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                              }}
                            >
                              Review
                            </span>
                          ) : isCustom ? (
                            <span
                              className="badge"
                              style={{
                                fontSize: '9.5px',
                                padding: '1px 5px',
                                background: 'rgba(91, 192, 158, 0.1)',
                                color: 'var(--acc-teal)',
                                border: '1px solid rgba(91, 192, 158, 0.3)',
                              }}
                            >
                              Custom
                            </span>
                          ) : (
                            <span className="badge badge-active" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                              Active
                            </span>
                          )}
                        </div>

                        <span className="skill-item-id">{skill.id}</span>

                        <div className="skill-item-summary">
                          {skill.frontmatter?.summary || 'Reusable domain guidance for investigations.'}
                        </div>

                        <div className="skill-item-chips">
                          <span className="skill-chip">{skillCategory}</span>
                          {boundCount > 0 && (
                            <span className="skill-chip cap" title={`${boundCount} bound workflows`}>
                              <Workflow size={9} /> {boundCount}
                            </span>
                          )}
                          {actionsCount > 0 && (
                            <span className="skill-chip act" title={`${actionsCount} allowed tool actions`}>
                              <Plug size={9} /> {actionsCount} tools
                            </span>
                          )}
                          {skill.immutable && (
                            <span className="skill-chip" title="Protected platform skill">
                              <Lock size={9} /> Protected
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Column 2: Deep Skill Inspector (Right) */}
          {selectedSkill && (
            <article className="skills-inspector-column" aria-label="Skill Inspector">
              {/* Sticky Header */}
              <div className="skills-inspector-header">
                <div className="skills-inspector-title-row">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                        {skillLabel(selectedSkill)}
                      </h2>

                      {/* Status Badges */}
                      <span
                        className={`badge ${
                          selectedSkill.project_enabled !== false ? 'badge-active' : 'badge-neutral'
                        }`}
                        style={{ fontSize: '11px' }}
                      >
                        {statusFor(selectedSkill)}
                      </span>

                      <span className="brand-badge" style={{ fontSize: '11px' }}>
                        {selectedSkill.frontmatter?.category || selectedSkill.stage || 'workflow'}
                      </span>

                      {selectedSkill.frontmatter?.version && (
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                          v{selectedSkill.frontmatter.version}
                        </span>
                      )}
                    </div>
                    <code style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                      id: {selectedSkill.id}
                    </code>
                  </div>

                  {/* Inspector Action Buttons */}
                  <div className="skills-inspector-actions">
                    {/* Project Availability Toggle */}
                    {canCustomize && (
                      selectedSkill.immutable ? (
                        <span
                          className="badge badge-neutral"
                          title="Platform manifests take precedence over project availability"
                          style={{
                            fontSize: '11px',
                            padding: '5px 10px',
                            height: '28px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Lock size={11} /> Protected
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          role="switch"
                          aria-label="Available for project"
                          aria-checked={selectedSkill.project_enabled !== false}
                          disabled={availabilityBusy}
                          style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                          onClick={handleToggleAvailability}
                          title={
                            selectedSkill.project_enabled !== false
                              ? 'Click to disable in this project'
                              : 'Click to enable in this project'
                          }
                        >
                          {selectedSkill.project_enabled !== false ? (
                            <CheckCircle2 size={12} color="var(--acc-teal)" />
                          ) : (
                            <XCircle size={12} color="var(--muted)" />
                          )}
                          {selectedSkill.project_enabled !== false ? 'Project: Enabled' : 'Project: Disabled'}
                        </button>
                      )
                    )}

                    {/* Customize Instructions Button */}
                    {isSkillEditable && !isEditing && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={startEditInstructions}
                        style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                      >
                        <Edit3 size={12} />
                        Customize
                      </button>
                    )}

                    {/* Revert to Baseline Button */}
                    {selectedSkill.is_overridden_in_project && !isEditing && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setConfirmResetOpen(true)}
                        style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px', color: 'var(--acc-rose)' }}
                        title="Revert project customization to platform baseline"
                      >
                        <RotateCcw size={12} />
                        Restore Baseline
                      </button>
                    )}

                    {/* Review Actions (Approve / Reject / Revoke) */}
                    {canCreate && selectedSkill.content_hash && (
                      <>
                        {selectedSkill.status === 'PENDING' && selectedSkill.author_subject !== principal?.subject && (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => {
                                setReviewModalAction('approve');
                                setReviewReason('Approved for workflow execution.');
                              }}
                              style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                            >
                              <CheckCircle2 size={12} />
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => {
                                setReviewModalAction('reject');
                                setReviewReason('Rejected: does not satisfy team requirements.');
                              }}
                              style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                            >
                              <XCircle size={12} />
                              Reject
                            </button>
                          </>
                        )}
                        {selectedSkill.status === 'APPROVED' && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setReviewModalAction('revoke');
                              setReviewReason('Revoked by administrator.');
                            }}
                            style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                          >
                            Revoke
                          </button>
                        )}
                      </>
                    )}

                    {/* Copy Manifest */}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleCopyManifest()}
                      title="Copy skill contract JSON"
                      style={{ fontSize: '11.5px', padding: '5px 11px', height: '28px' }}
                    >
                      {copied ? <Check size={12} color="var(--acc-teal)" /> : <Copy size={12} />}
                      {copied ? 'Copied' : 'Manifest'}
                    </button>
                  </div>
                </div>

                <p className="skills-desc-text">
                  {selectedSkill.frontmatter?.summary || 'No summary declared in manifest.'}
                </p>

                {/* Overridden Banner */}
                {selectedSkill.is_overridden_in_project && (
                  <div
                    style={{
                      marginTop: '10px',
                      background: 'rgba(91, 192, 158, 0.08)',
                      border: '1px solid var(--acc-teal)',
                      borderRadius: '6px',
                      padding: '7px 12px',
                      fontSize: '12px',
                      color: 'var(--acc-teal)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={14} />
                      <span>
                        <b>Project Customized:</b> This skill overrides platform instructions for current project runs.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Inspector Tabs Bar */}
              <div className="skills-tabs-bar" role="tablist">
                {[
                  { key: 'instructions' as TabKey, label: 'Instructions & Prompt', icon: FileCode },
                  { key: 'capabilities' as TabKey, label: `Bound Workflows (${boundCapabilities.length})`, icon: Workflow },
                  { key: 'governance' as TabKey, label: 'Governance & Tools', icon: ShieldCheck },
                  { key: 'manifest' as TabKey, label: 'Manifest & Audit', icon: Layers },
                ].map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.key)}
                      className={`skills-tab-item ${isActive ? 'is-active' : ''}`}
                    >
                      <Icon size={13} color={isActive ? 'var(--acc)' : 'var(--muted)'} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab Body */}
              <div className="skills-tab-body">
                {/* TAB 1: Instructions & Content */}
                {activeTab === 'instructions' && (
                  <div className="skills-instruction-container">
                    {isEditing ? (
                      <form onSubmit={handleSaveProjectInstructions} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div className="skills-instruction-header">
                          <label htmlFor="skill-edit-textarea" style={{ fontSize: '13px', fontWeight: 600 }}>
                            Custom Project Instructions
                          </label>
                          <span
                            className={`char-counter ${
                              editInstruction.length > instructionLimit * 0.9 ? 'warning' : ''
                            }`}
                          >
                            {editInstruction.length.toLocaleString()} / {instructionLimit.toLocaleString()} characters
                          </span>
                        </div>

                        <textarea
                          id="skill-edit-textarea"
                          className="skills-instruction-textarea"
                          rows={14}
                          required
                          maxLength={instructionLimit}
                          disabled={editBusy}
                          value={editInstruction}
                          onChange={e => setEditInstruction(e.target.value)}
                          placeholder="Write the specific investigation instructions..."
                        />

                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '12.5px',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={editEnabled}
                            onChange={e => setEditEnabled(e.target.checked)}
                            disabled={editBusy}
                            style={{ accentColor: 'var(--acc)' }}
                          />
                          <span>Use this skill in new project investigations</span>
                        </label>

                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={
                              editBusy ||
                              !editInstruction.trim() ||
                              editInstruction.length > instructionLimit
                            }
                          >
                            {editBusy ? 'Saving…' : 'Save Project Instructions'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={editBusy}
                            onClick={() => setIsEditing(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="skills-instruction-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FileCode size={14} color="var(--acc)" />
                            <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                              {selectedSkill.is_overridden_in_project
                                ? 'Effective Project Instructions'
                                : 'Platform Instructions'}
                            </span>
                          </div>
                          <span className="char-counter">
                            {instructionFor(selectedSkill).length.toLocaleString()} characters
                          </span>
                        </div>

                        <pre className="skills-instructions-pre">
                          {instructionFor(selectedSkill) || 'No instruction body defined for this skill.'}
                        </pre>

                        {!isSkillEditable && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '11.5px',
                              color: 'var(--muted)',
                            }}
                          >
                            <Lock size={12} />
                            <span>
                              {selectedSkill.immutable
                                ? 'These instructions are immutable and governed by platform security policy.'
                                : !isActiveSkill(selectedSkill)
                                ? 'This skill must be approved before it can be customized or executed.'
                                : 'Project Owner or Platform Admin permissions required to customize instructions.'}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* TAB 2: Bound Workflows */}
                {activeTab === 'capabilities' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Workflow size={15} color="var(--acc)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                          Connected Investigation Workflows ({boundCapabilities.length})
                        </h4>
                      </div>
                      <a
                        href="/admins/capabilities"
                        onClick={e => {
                          if (onNavigate) {
                            e.preventDefault();
                            onNavigate('capabilities');
                          }
                        }}
                        style={{
                          fontSize: '11px',
                          color: 'var(--acc)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        Open Capabilities Studio <ExternalLink size={10} />
                      </a>
                    </div>

                    {boundCapabilities.length === 0 ? (
                      <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                        <Workflow size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                        <p style={{ margin: 0 }}>This skill is not currently connected to any active capability.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                        {boundCapabilities.map(cap => (
                          <div key={cap.id} className="skill-capability-link">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <strong style={{ fontSize: '12.5px', color: 'var(--tx)' }}>{cap.name || cap.id}</strong>
                                <span
                                  className={`badge ${cap.enabled !== false ? 'badge-active' : 'badge-neutral'}`}
                                  style={{ fontSize: '9.5px', padding: '1px 5px' }}
                                >
                                  {cap.category || 'workflow'}
                                </span>
                              </div>

                              <code style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                                {cap.id}
                              </code>

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {(cap.requires?.connectors || []).map(conn => (
                                  <span key={conn} className="skill-chip cap" title={`Requires connector: ${conn}`}>
                                    <Plug size={9} /> {conn}
                                  </span>
                                ))}
                                <span className="skill-chip">
                                  {cap.project_enabled !== false ? 'Enabled in project' : 'Disabled in project'}
                                </span>
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '10px' }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => openCapability(cap.id)}
                                style={{ fontSize: '11px', padding: '4px 8px', height: '26px' }}
                                title="Inspect in Capabilities Studio"
                              >
                                View <ArrowRight size={11} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => launchInvestigationWithSkill(cap.id)}
                                style={{ fontSize: '11px', padding: '4px 8px', height: '26px' }}
                                title="Launch Investigation Run"
                              >
                                <Play size={10} /> Test
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: Tool Governance & Security */}
                {activeTab === 'governance' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Security Boundary Card */}
                    <div className="card" style={{ padding: '16px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <ShieldCheck size={16} color="var(--acc-teal)" />
                        <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                          Security Ceiling & Execution Sandbox
                        </h4>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                        This skill operates strictly within the ADK capability permission ceiling. It cannot install packages, invoke shell commands, query databases directly, or perform write mutations to Jira/Splunk.
                      </p>
                    </div>

                    {/* Permitted Tool Actions */}
                    <div className="card" style={{ padding: '16px', border: '1px solid var(--line)' }}>
                      <h4 style={{ fontSize: '12.5px', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--tx)' }}>
                        Permitted Tool Actions ({(selectedSkill.project_actions ?? selectedSkill.allowed_actions ?? []).length})
                      </h4>
                      {(selectedSkill.project_actions ?? selectedSkill.allowed_actions ?? []).length === 0 ? (
                        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                          No specific tool actions granted. Instructions rely purely on workflow context and evidence summarization.
                        </p>
                      ) : (
                        <div className="tools-grid">
                          {(selectedSkill.project_actions ?? selectedSkill.allowed_actions ?? []).map(action => (
                            <div key={action} className="tool-badge-card">
                              <CheckCircle2 size={13} color="var(--acc-teal)" />
                              <code>{action}</code>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Forbidden Tools */}
                    {(selectedSkill.frontmatter?.forbidden_tools || []).length > 0 && (
                      <div className="card" style={{ padding: '16px', border: '1px solid var(--line)' }}>
                        <h4 style={{ fontSize: '12.5px', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--acc-rose)' }}>
                          Explicitly Forbidden Tools ({selectedSkill.frontmatter?.forbidden_tools?.length})
                        </h4>
                        <div className="tools-grid">
                          {(selectedSkill.frontmatter?.forbidden_tools || []).map(tool => (
                            <div key={tool} className="forbidden-tool-card">
                              <XCircle size={13} color="var(--acc-rose)" />
                              <code>{tool}</code>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: Manifest & Audit Trail */}
                {activeTab === 'manifest' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Integrity Hashes & Metadata */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '10px',
                      }}
                    >
                      <div className="card" style={{ padding: '12px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                        <div style={{ fontSize: '10.5px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          SHA-256 Fingerprint
                        </div>
                        <code style={{ fontSize: '11px', color: 'var(--tx)', wordBreak: 'break-all' }}>
                          {selectedSkill.sha256 || '—'}
                        </code>
                      </div>

                      <div className="card" style={{ padding: '12px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                        <div style={{ fontSize: '10.5px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          Effective Hash
                        </div>
                        <code style={{ fontSize: '11px', color: 'var(--tx)', wordBreak: 'break-all' }}>
                          {selectedSkill.effective_hash || '—'}
                        </code>
                      </div>

                      <div className="card" style={{ padding: '12px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                        <div style={{ fontSize: '10.5px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          Governance Source
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          {selectedSkill.managed_in_database
                            ? 'Database Managed (Platform Admin Created)'
                            : 'Platform YAML Catalog'}
                        </span>
                      </div>
                    </div>

                    {/* Author & Review Trail */}
                    {selectedSkill.author_subject && (
                      <div className="card" style={{ padding: '14px 16px', border: '1px solid var(--line)' }}>
                        <h4 style={{ fontSize: '12.5px', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--tx)' }}>
                          Approval Trail
                        </h4>
                        <div style={{ fontSize: '12px', color: 'var(--tx)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div>
                            Author: <strong>{selectedSkill.author_subject}</strong>
                            {selectedSkill.created_at && (
                              <span style={{ color: 'var(--muted)', marginLeft: '6px' }}>
                                ({new Date(selectedSkill.created_at * 1000).toLocaleString()})
                              </span>
                            )}
                          </div>
                          {selectedSkill.reviewer_subject && (
                            <div>
                              Reviewer: <strong>{selectedSkill.reviewer_subject}</strong>
                              {selectedSkill.reviewed_at && (
                                <span style={{ color: 'var(--muted)', marginLeft: '6px' }}>
                                  ({new Date(selectedSkill.reviewed_at * 1000).toLocaleString()})
                                </span>
                              )}
                            </div>
                          )}
                          {selectedSkill.review_reason && (
                            <div style={{ marginTop: '4px', fontStyle: 'italic', color: 'var(--muted)' }}>
                              "{selectedSkill.review_reason}"
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Raw YAML / Content Block */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx)' }}>
                          Skill Specification & Frontmatter
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void handleCopyManifest()}
                          style={{ fontSize: '11px', padding: '3px 8px', height: '24px' }}
                        >
                          {copied ? <Check size={11} /> : <Copy size={11} />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="manifest-code-block">
                        {selectedSkill.content || JSON.stringify(selectedSkill, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </article>
          )}
        </div>
      )}

      {/* VIEW 2: CAPABILITY BINDINGS MATRIX */}
      {viewMode === 'matrix' && (
        <div className="skills-matrix-view">
          <div className="skills-matrix-card">
            <div className="skills-matrix-header">
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--tx)' }}>
                  Capability to Skills Cross-Reference Matrix
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0 0 0' }}>
                  Complete mapping of registered investigation capabilities, bound domain skills, and inherited tool execution permissions.
                </p>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Showing <b>{matrixData.length}</b> capabilities
              </div>
            </div>

            <div className="skills-matrix-table-wrap">
              <table className="skills-matrix-table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Category</th>
                    <th>Bound Skills</th>
                    <th>Stage</th>
                    <th>Inherited Tools</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData.map(({ capability, skills: capSkills, allowedActions }) => (
                    <tr key={capability.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--tx)' }}>{capability.name || capability.id}</div>
                        <code style={{ fontSize: '10.5px', color: 'var(--muted)' }}>{capability.id}</code>
                      </td>
                      <td>
                        <span className="brand-badge" style={{ fontSize: '10px' }}>
                          {capability.category || 'workflow'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {capSkills.length === 0 ? (
                            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>None</span>
                          ) : (
                            capSkills.map(s => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setSelectedSkillId(s.id);
                                  setViewMode('catalog');
                                }}
                                className="skill-chip cap"
                                style={{ cursor: 'pointer' }}
                                title={`Inspect '${skillLabel(s)}'`}
                              >
                                <BookOpen size={9} /> {skillLabel(s)}
                              </button>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                          {capability.model_profile || 'default'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '240px' }}>
                          {allowedActions.length === 0 ? (
                            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>read-only</span>
                          ) : (
                            allowedActions.map(action => (
                              <span key={action} className="skill-chip act">
                                {action}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            capability.enabled !== false && capability.project_enabled !== false
                              ? 'badge-active'
                              : 'badge-neutral'
                          }`}
                          style={{ fontSize: '10px', padding: '1px 5px' }}
                        >
                          {capability.enabled === false
                            ? 'Disabled'
                            : capability.project_enabled === false
                            ? 'Project Disabled'
                            : 'Active'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openCapability(capability.id)}
                          style={{ fontSize: '11px', padding: '3px 8px', height: '24px' }}
                        >
                          Details <ArrowRight size={10} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CREATE SKILL MODAL */}
      {createModalOpen && (
        <div className="skills-modal-backdrop" onClick={() => !draftBusy && setCreateModalOpen(false)}>
          <div className="skills-modal-card" onClick={e => e.stopPropagation()}>
            <div className="skills-modal-header">
              <h3>
                <Plus size={16} color="var(--acc)" />
                Create New Domain Skill
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => !draftBusy && setCreateModalOpen(false)}
                disabled={draftBusy}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateSkill}>
              <div className="skills-modal-body">
                <div className="form-group">
                  <label htmlFor="draft-name">Skill Display Name *</label>
                  <input
                    id="draft-name"
                    className="form-input"
                    required
                    maxLength={120}
                    placeholder="e.g. Kafka Lag Investigation"
                    value={draft.name}
                    onChange={e => {
                      const name = e.target.value;
                      setDraft(curr => ({
                        ...curr,
                        name,
                        id: customId
                          ? curr.id
                          : name
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')
                              .replace(/^-+|-+$/g, '')
                              .slice(0, 64),
                      }));
                    }}
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="draft-id">Skill Identifier (Slug) *</label>
                  <input
                    id="draft-id"
                    className="form-input"
                    required
                    pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
                    maxLength={64}
                    placeholder="e.g. kafka-lag-investigation"
                    value={draft.id}
                    onChange={e => {
                      setCustomId(true);
                      setDraft(curr => ({ ...curr, id: e.target.value }));
                    }}
                  />
                  <p className="field-help">
                    Unique lowercase alphanumeric identifier with hyphens. Cannot be changed once created.
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="draft-description">Summary / Job Description *</label>
                  <textarea
                    id="draft-description"
                    className="form-textarea"
                    required
                    rows={2}
                    maxLength={1000}
                    placeholder="Describe when the agent should apply this skill..."
                    value={draft.description}
                    onChange={e => setDraft(curr => ({ ...curr, description: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label htmlFor="draft-instruction">Working Instructions *</label>
                    <span
                      className={`char-counter ${
                        draft.instruction.length > instructionLimit * 0.9 ? 'warning' : ''
                      }`}
                    >
                      {draft.instruction.length.toLocaleString()} / {instructionLimit.toLocaleString()}
                    </span>
                  </div>
                  <textarea
                    id="draft-instruction"
                    className="form-textarea"
                    required
                    rows={6}
                    maxLength={instructionLimit}
                    placeholder="Step-by-step instructions, reasoning rules, and required evidence to inspect..."
                    value={draft.instruction}
                    onChange={e => setDraft(curr => ({ ...curr, instruction: e.target.value }))}
                  />
                  <p className="field-help">
                    Instructions must specify steps and analysis rules. They cannot install tools or run remote commands.
                  </p>
                </div>

                {/* Target Capabilities Multi-Select */}
                <div className="form-group">
                  <label>Connected Workflows * (Choose at least one)</label>
                  <div className="choices-scroll-area">
                    {availableDraftCapabilities.map(cap => (
                      <label key={cap.id} className="choice-item-row">
                        <input
                          type="checkbox"
                          checked={draft.capabilities.includes(cap.id)}
                          onChange={() => toggleDraftCapability(cap.id)}
                          disabled={
                            !draft.capabilities.includes(cap.id) && draft.capabilities.length >= 32
                          }
                        />
                        <span style={{ fontWeight: 600 }}>{cap.name || cap.id}</span>
                        <code style={{ fontSize: '10px', color: 'var(--muted)', marginLeft: 'auto' }}>
                          {cap.id}
                        </code>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Optional Allowed Tool Actions */}
                {availableDraftActions.length > 0 && (
                  <div className="form-group">
                    <label>Permitted Tool Actions (Shared among selected workflows)</label>
                    <div className="choices-scroll-area">
                      {availableDraftActions.map(action => (
                        <label key={action} className="choice-item-row">
                          <input
                            type="checkbox"
                            checked={draft.actions.includes(action)}
                            onChange={() => toggleDraftAction(action)}
                          />
                          <code>{action}</code>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="skills-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={draftBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    draftBusy ||
                    !draft.name.trim() ||
                    !draft.description.trim() ||
                    !draft.instruction.trim() ||
                    !draft.capabilities.length
                  }
                >
                  {draftBusy ? 'Saving Skill…' : 'Save for Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REVIEW SKILL MODAL */}
      {reviewModalAction && selectedSkill && (
        <div className="skills-modal-backdrop" onClick={() => !reviewBusy && setReviewModalAction(null)}>
          <div className="skills-modal-card" onClick={e => e.stopPropagation()}>
            <div className="skills-modal-header">
              <h3>
                {reviewModalAction === 'approve' ? (
                  <CheckCircle2 size={16} color="var(--acc-teal)" />
                ) : (
                  <XCircle size={16} color="var(--acc-rose)" />
                )}
                {reviewModalAction === 'approve'
                  ? `Approve Skill: ${skillLabel(selectedSkill)}`
                  : reviewModalAction === 'reject'
                  ? `Reject Skill: ${skillLabel(selectedSkill)}`
                  : `Revoke Skill: ${skillLabel(selectedSkill)}`}
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => !reviewBusy && setReviewModalAction(null)}
                disabled={reviewBusy}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleReviewSkill}>
              <div className="skills-modal-body">
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
                  {reviewModalAction === 'approve'
                    ? 'Approving this skill authorizes it for use in new investigation workflow runs.'
                    : reviewModalAction === 'reject'
                    ? 'Rejecting this skill prevents it from being used in any investigation runs.'
                    : 'Revoking this skill immediately suspends it from being used in new investigation runs.'}
                </p>

                <div className="form-group">
                  <label htmlFor="review-reason">Review Rationale / Notes *</label>
                  <textarea
                    id="review-reason"
                    className="form-textarea"
                    required
                    rows={3}
                    maxLength={2000}
                    placeholder="Document your review assessment and rationale..."
                    value={reviewReason}
                    onChange={e => setReviewReason(e.target.value)}
                    autoFocus
                  />
                  <p className="field-help">
                    This review rationale will be logged permanently in the platform audit trail.
                  </p>
                </div>
              </div>

              <div className="skills-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReviewModalAction(null)}
                  disabled={reviewBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`btn ${reviewModalAction === 'approve' ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={reviewBusy || !reviewReason.trim()}
                  style={
                    reviewModalAction !== 'approve'
                      ? { color: 'var(--acc-rose)', borderColor: 'var(--acc-rose)' }
                      : {}
                  }
                >
                  {reviewBusy
                    ? 'Submitting…'
                    : reviewModalAction === 'approve'
                    ? 'Approve Skill'
                    : reviewModalAction === 'reject'
                    ? 'Reject Skill'
                    : 'Revoke Skill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM RESET MODAL */}
      {confirmResetOpen && selectedSkill && (
        <div className="skills-modal-backdrop" onClick={() => !resetBusy && setConfirmResetOpen(false)}>
          <div className="skills-modal-card" style={{ maxWidth: '460px' }} onClick={e => e.stopPropagation()}>
            <div className="skills-modal-header">
              <h3>
                <RotateCcw size={16} color="var(--acc-rose)" />
                Restore Platform Baseline
              </h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => !resetBusy && setConfirmResetOpen(false)}
                disabled={resetBusy}
              >
                <X size={16} />
              </button>
            </div>

            <div className="skills-modal-body">
              <p style={{ fontSize: '13px', color: 'var(--tx)', margin: 0 }}>
                Are you sure you want to remove the project instructions for <b>{skillLabel(selectedSkill)}</b>?
              </p>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                This will delete your project-specific customization and restore the default platform instructions for subsequent investigations.
              </p>
            </div>

            <div className="skills-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmResetOpen(false)}
                disabled={resetBusy}
              >
                Keep Customization
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleResetBaseline}
                disabled={resetBusy}
                style={{ background: 'var(--acc-rose)', borderColor: 'var(--acc-rose)' }}
              >
                {resetBusy ? 'Restoring…' : 'Restore Baseline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
