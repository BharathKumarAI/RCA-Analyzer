import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Search, ShieldCheck, CheckCircle2,
  RefreshCw, Copy, Check, FileText, Lock,
  Sparkles, Layers, Sliders, RotateCcw, AlertCircle,
  BarChart2, Activity, ChevronRight, ArrowUpRight,
  TrendingUp, CornerDownRight, CheckSquare, Edit3,
  Shield, Code, List, Eye, ExternalLink, Cpu,
  Terminal, AlertTriangle, GitCompare, Info
} from 'lucide-react';
import {
  ApiError, fetchSkills, saveProjectSkill, resetProjectSkill, fetchCapabilities
} from '../services/api';
import { SkillItem, SkillMlflowReport, CapabilityItem, Principal } from '../types/api';
import type { ActivePage } from '../components/Sidebar';
import '../styles/skills-studio.css';

interface SkillsProps {
  principal?: Principal | null;
  onNavigate?: (page: ActivePage) => void;
}

type StudioTab = 'overview' | 'studio' | 'markdown' | 'mlflow' | 'capabilities';
type StatusFilter = 'all' | 'custom' | 'baseline' | 'locked';

export const Skills: React.FC<SkillsProps> = ({ principal, onNavigate }) => {
  const [skills, setSkills] = useState<SkillItem[] | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Studio & Editor state
  const [editorText, setEditorText] = useState('');
  const [diffViewMode, setDiffViewMode] = useState<'editor' | 'diff'>('editor');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedRunId, setCopiedRunId] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<Record<string, SkillMlflowReport>>({});
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Permission check from authentic user principal roles
  const canEdit = useMemo(() => {
    if (!principal?.roles) return false;
    const allowed = new Set(['PLATFORM_ADMIN', 'PROJECT_OWNER', 'PROJECT_MANAGER']);
    return principal.roles.some(role => allowed.has(role));
  }, [principal]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [skillsData, capsData] = await Promise.all([
        fetchSkills(),
        fetchCapabilities().catch(() => [] as CapabilityItem[]),
      ]);
      setSkills(skillsData);
      setCapabilities(capsData);
      setSelectedId(current => {
        if (current && skillsData.some(s => s.id === current)) return current;
        return skillsData[0]?.id || null;
      });
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to load platform skills from catalog.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Selected skill
  const selected = useMemo(() => {
    if (!skills || !skills.length) return null;
    return skills.find(s => s.id === selectedId) || skills[0] || null;
  }, [skills, selectedId]);

  // Sync editor text when selected skill changes
  useEffect(() => {
    if (selected) {
      const textToLoad = selected.project_instruction || selected.instruction_body || selected.content || '';
      setEditorText(textToLoad);
      setDiffViewMode('editor');
    }
  }, [selected]);

  // Derived Stages
  const stages = useMemo(() => {
    if (!skills) return ['all'];
    const set = new Set<string>();
    skills.forEach(s => {
      if (s.stage) set.add(s.stage);
    });
    return ['all', ...Array.from(set).sort()];
  }, [skills]);

  // Derived Categories
  const categories = useMemo(() => {
    if (!skills) return ['ALL'];
    const set = new Set<string>();
    skills.forEach(s => {
      const cat = s.frontmatter?.category || 'general';
      set.add(cat.toUpperCase());
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [skills]);

  // Filtered skills
  const filteredSkills = useMemo(() => {
    if (!skills) return [];
    return skills.filter(skill => {
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery = !q || (
        skill.id.toLowerCase().includes(q) ||
        (skill.name && skill.name.toLowerCase().includes(q)) ||
        (skill.frontmatter?.summary && skill.frontmatter.summary.toLowerCase().includes(q)) ||
        (skill.stage && skill.stage.toLowerCase().includes(q)) ||
        (skill.frontmatter?.entrypoints && skill.frontmatter.entrypoints.some((e: string) => e.toLowerCase().includes(q))) ||
        (skill.allowed_actions && skill.allowed_actions.some(a => a.toLowerCase().includes(q)))
      );

      const skillCat = (skill.frontmatter?.category || 'general').toUpperCase();
      const matchesCat = categoryFilter === 'ALL' || skillCat === categoryFilter;

      const matchesStage = stageFilter === 'all' || skill.stage === stageFilter;

      let matchesStatus = true;
      if (statusFilter === 'custom') {
        matchesStatus = Boolean(skill.is_overridden_in_project);
      } else if (statusFilter === 'baseline') {
        matchesStatus = !skill.is_overridden_in_project && !skill.immutable;
      } else if (statusFilter === 'locked') {
        matchesStatus = Boolean(skill.immutable);
      }

      return matchesQuery && matchesCat && matchesStage && matchesStatus;
    });
  }, [skills, searchQuery, categoryFilter, stageFilter, statusFilter]);

  // Associated capabilities for selected skill
  const associatedCapabilities = useMemo(() => {
    if (!selected || !capabilities.length) return [];
    return capabilities.filter(cap => (cap.skills || []).includes(selected.id));
  }, [selected, capabilities]);

  // Statistics
  const activeOverridesCount = useMemo(() => {
    return (skills || []).filter(s => s.is_overridden_in_project).length;
  }, [skills]);

  const customizableCount = useMemo(() => {
    return (skills || []).filter(s => s.project_override && !s.immutable).length;
  }, [skills]);

  // Real-time linting assertions
  const lintCheck = useMemo(() => {
    const textLower = editorText.toLowerCase();
    const hasEvidenceCitation = textLower.includes('evidence') || textLower.includes('[evd-');
    const hasTemporalAnchor = textLower.includes('anchor') || textLower.includes('time') || textLower.includes('utc') || textLower.includes('timestamp');
    const hasSecretPattern = /bearer\s+[a-z0-9_.-]+|ghp_[a-z0-9]+|ak_[a-z0-9]+|password\s*[:=]/i.test(editorText);
    const charCount = editorText.length;
    const isOverLimit = charCount > 16000;
    const isNearLimit = charCount > 13000;

    return {
      hasEvidenceCitation,
      hasTemporalAnchor,
      hasSecretPattern,
      charCount,
      isOverLimit,
      isNearLimit,
      isValid: hasEvidenceCitation && !hasSecretPattern && !isOverLimit && charCount > 0,
    };
  }, [editorText]);

  // Diff lines generator between baseline and candidate instructions
  const diffLines = useMemo(() => {
    if (!selected) return [];
    const baseline = (selected.instruction_body || selected.content || '').split('\n');
    const candidate = editorText.split('\n');

    const maxLen = Math.max(baseline.length, candidate.length);
    const result: Array<{ type: 'same' | 'del' | 'add'; baseText?: string; candText?: string }> = [];

    for (let i = 0; i < maxLen; i++) {
      const bLine = baseline[i];
      const cLine = candidate[i];

      if (bLine === cLine) {
        result.push({ type: 'same', baseText: bLine, candText: cLine });
      } else {
        result.push({ type: 'del', baseText: bLine, candText: cLine });
      }
    }
    return result;
  }, [selected, editorText]);

  // Handle Save & Evaluate
  const handleSaveAndEvaluate = async () => {
    if (!selected || !canEdit) return;
    setSaving(true);
    setActionNotice(null);
    try {
      const res = await saveProjectSkill(selected.id, {
        instruction: editorText,
        enabled: selected.project_enabled ?? true,
        ...(selected.project_actions != null ? { actions: selected.project_actions } : {}),
      });

      setSkills(prev => {
        if (!prev) return prev;
        return prev.map(s => {
          if (s.id === selected.id) {
            return {
              ...s,
              is_overridden_in_project: true,
              project_instruction: editorText,
              project_enabled: selected.project_enabled ?? true,
            };
          }
          return s;
        });
      });

      if (res.mlflow) {
        setEvaluationResult(prev => ({
          ...prev,
          [selected.id]: res.mlflow,
        }));
      }

      setActionNotice({
        type: 'success',
        message: `Skill '${selected.id}' saved successfully to project configuration. Offline instruction checks completed for '${res.stage}'.`,
      });
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Failed to save project skill override.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Handle Reset to Baseline
  const handleResetToBaseline = async () => {
    if (!selected || !canEdit) return;
    if (!window.confirm(`Reset '${selected.id}' to platform baseline? All project custom instructions will be removed.`)) {
      return;
    }
    setResetting(true);
    setActionNotice(null);
    try {
      await resetProjectSkill(selected.id);
      setSkills(prev => {
        if (!prev) return prev;
        return prev.map(s => {
          if (s.id === selected.id) {
            return {
              ...s,
              is_overridden_in_project: false,
              project_instruction: null,
              project_enabled: true,
              project_actions: null,
            };
          }
          return s;
        });
      });

      const baselineText = selected.instruction_body || selected.content || '';
      setEditorText(baselineText);

      setEvaluationResult(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });

      setActionNotice({
        type: 'success',
        message: `Skill '${selected.id}' reverted to platform baseline.`,
      });
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Failed to reset project skill.',
      });
    } finally {
      setResetting(false);
    }
  };

  const copyText = async (text: string, setter: (val: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      setActionNotice({ type: 'error', message: 'Unable to copy text. Select manually.' });
    }
  };

  const getStageColorClass = (stage?: string) => {
    switch ((stage || '').toLowerCase()) {
      case 'triage': return 'stage-triage';
      case 'logs': return 'stage-logs';
      case 'extraction': return 'stage-extraction';
      case 'synthesis': return 'stage-synthesis';
      case 'database': return 'stage-database';
      default: return 'stage-default';
    }
  };

  const activeEvaluation = selected ? evaluationResult[selected.id] : null;

  return (
    <div className="view-container skills-page">
      {/* Standard Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            <BookOpen size={22} color="var(--acc)" />
            Skill Studio & <span>Governance</span>
          </h1>
          <p className="hero-lede">
            Governed registry of platform baseline agent skills, declarative prompt workflow templates,
            connector action ceilings, and project-level instruction tuning with deterministic offline MLflow validation.
          </p>

          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <BookOpen size={12} /> Platform baseline: <b>{skills?.length ?? 0}</b> skills
            </span>
            <span className="hero-stat-chip">
              <Sliders size={12} /> Customizable: <b>{customizableCount}</b> skills
            </span>
            <span className={`hero-stat-chip ${activeOverridesCount > 0 ? 'highlight' : ''}`}>
              <Sparkles size={12} /> Project overrides: <b>{activeOverridesCount}</b>
            </span>
            <span className="hero-stat-chip">
              <Activity size={12} /> Offline checks: <b>Deterministic MLflow</b>
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadData()}
              disabled={loading}
              title="Reload skills and manifests from platform registry"
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              {loading ? 'Refreshing...' : 'Reload Catalog'}
            </button>
          </div>
        </div>
      </section>

      {/* Action Notification Alert */}
      {actionNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            border: actionNotice.type === 'success' ? '1px solid var(--acc)' : '1px solid var(--danger)',
            background: actionNotice.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: actionNotice.type === 'success' ? 'var(--tx)' : 'var(--danger)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {actionNotice.type === 'success' ? <CheckCircle2 size={16} color="var(--acc)" /> : <AlertCircle size={16} />}
            <span>{actionNotice.message}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setActionNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="card" style={{ color: 'var(--danger)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
          <button className="btn btn-secondary" onClick={() => void loadData()}>Retry</button>
        </div>
      )}

      {/* Workspace 3-Column Layout */}
      <div className="skills-workspace-layout">
        {/* =================================================================
            COLUMN 1: Skill Catalog Navigator (Left)
            ================================================================= */}
        <aside className="skills-catalog-column">
          <div className="skills-catalog-header">
            <div className="skills-catalog-title-row">
              <h2>
                <Layers size={14} color="var(--acc)" />
                Skill Catalog
              </h2>
              <span className="skills-catalog-count-badge">
                {filteredSkills.length} of {skills?.length ?? 0}
              </span>
            </div>

            {/* Search Input */}
            <div className="skills-search-wrap">
              <Search size={13} />
              <input
                type="search"
                className="skills-search-input"
                placeholder="Search skills, stages, tools..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Filter Row */}
            <div className="skills-filter-row" style={{ marginBottom: '6px' }}>
              <button
                type="button"
                className={`skills-filter-pill ${statusFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`skills-filter-pill ${statusFilter === 'custom' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('custom')}
              >
                Overrides ({activeOverridesCount})
              </button>
              <button
                type="button"
                className={`skills-filter-pill ${statusFilter === 'baseline' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('baseline')}
              >
                Baseline
              </button>
              <button
                type="button"
                className={`skills-filter-pill ${statusFilter === 'locked' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('locked')}
              >
                Locked
              </button>
            </div>

            {/* Stage Filter Row */}
            <div className="skills-filter-row">
              {stages.map(st => (
                <button
                  key={st}
                  type="button"
                  className={`skills-filter-pill ${stageFilter === st ? 'is-active' : ''}`}
                  onClick={() => setStageFilter(st)}
                >
                  {st === 'all' ? 'All Stages' : st}
                </button>
              ))}
            </div>
          </div>

          {/* Catalog Items List */}
          <div className="skills-items-list">
            {loading && !skills ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                Loading skills catalog...
              </div>
            ) : filteredSkills.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                No skills match active filters.
              </div>
            ) : (
              filteredSkills.map(skill => {
                const isSelected = skill.id === selected?.id;
                const isOverridden = Boolean(skill.is_overridden_in_project);
                const isImmutable = Boolean(skill.immutable);
                const colorClass = getStageColorClass(skill.stage);
                const qScore = evaluationResult[skill.id]?.candidate_metrics?.quality_score;

                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={`skill-list-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedId(skill.id)}
                  >
                    <div className={`skill-avatar-icon ${colorClass}`}>
                      {skill.id.substring(0, 2).toUpperCase()}
                    </div>

                    <div className="skill-card-content">
                      <div className="skill-card-header-row">
                        <span className="skill-card-title">{skill.id}</span>
                        {isImmutable ? (
                          <span className="badge-skill locked" title="Immutable Platform Baseline">
                            Locked
                          </span>
                        ) : isOverridden ? (
                          <span className="badge-skill override-active" title="Project override active">
                            Custom
                          </span>
                        ) : (
                          <span className="badge-skill baseline" title="Inheriting platform baseline">
                            Baseline
                          </span>
                        )}
                      </div>

                      <div className="skill-card-summary">
                        {skill.frontmatter?.summary || 'No summary declared in manifest.'}
                      </div>

                      <div className="skill-card-badges">
                        <span className="badge-stage">{skill.stage || 'synthesis'}</span>
                        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                          {(skill.size_bytes || 0)} B
                        </span>
                        {qScore !== undefined && (
                          <span style={{ fontSize: '10px', color: 'var(--acc)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <TrendingUp size={10} />
                            {(Number(qScore) * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* =================================================================
            COLUMN 2: Skill Studio Center Workspace
            ================================================================= */}
        <main className="skills-studio-column">
          {selected ? (
            <div className="skill-workspace-card">
              {/* Skill Hero Header */}
              <div className="skill-hero-header">
                <div className="skill-hero-main">
                  <div className={`skill-hero-icon ${getStageColorClass(selected.stage)}`}>
                    <Code size={22} />
                  </div>
                  <div className="skill-hero-meta">
                    <h2>
                      {selected.id}
                      <span className="badge-stage" style={{ fontSize: '11px', padding: '2px 8px' }}>
                        Stage: {selected.stage}
                      </span>
                    </h2>
                    <div className="skill-hero-specs">
                      <span>Category: <strong style={{ color: 'var(--tx)' }}>{selected.frontmatter?.category || 'general'}</strong></span>
                      <span>•</span>
                      <span>Version: <strong style={{ color: 'var(--tx)' }}>{selected.frontmatter?.version ? `v${selected.frontmatter.version}` : 'shipped'}</strong></span>
                      <span>•</span>
                      <span>Status: <strong style={{ color: 'var(--acc)' }}>{selected.frontmatter?.status || selected.status || 'configured'}</strong></span>
                      <span>•</span>
                      <span>Hash: <strong className="mono" style={{ color: 'var(--tx)' }}>sha256:{selected.sha256?.substring(0, 10)}…</strong></span>
                    </div>
                    <div className="skill-hero-desc">
                      {selected.frontmatter?.summary || 'Declarative platform skill specification.'}
                    </div>
                  </div>
                </div>

                <div className="skill-hero-actions">
                  {selected.is_overridden_in_project ? (
                    <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Sparkles size={11} /> Project Custom Active
                    </span>
                  ) : selected.immutable ? (
                    <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Lock size={11} color="var(--danger)" /> Immutable Baseline
                    </span>
                  ) : (
                    <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={11} color="var(--acc)" /> Baseline Template
                    </span>
                  )}
                </div>
              </div>

              {/* Subtabs Navigation */}
              <nav className="skills-subtabs-nav">
                <button
                  type="button"
                  className={`skills-subtab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  <Eye size={13} />
                  Overview & Manifest
                </button>
                <button
                  type="button"
                  className={`skills-subtab-btn ${activeTab === 'studio' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('studio')}
                >
                  <Edit3 size={13} />
                  Instruction Studio & Diff
                  {selected.is_overridden_in_project && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--acc)' }} />
                  )}
                </button>
                <button
                  type="button"
                  className={`skills-subtab-btn ${activeTab === 'markdown' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('markdown')}
                >
                  <FileText size={13} />
                  Raw SKILL.md
                </button>
                <button
                  type="button"
                  className={`skills-subtab-btn ${activeTab === 'mlflow' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('mlflow')}
                >
                  <BarChart2 size={13} />
                  Offline Checks & MLflow
                  {activeEvaluation && (
                    <span className="badge badge-active" style={{ fontSize: '9px', padding: '1px 5px' }}>
                      Report
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`skills-subtab-btn ${activeTab === 'capabilities' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('capabilities')}
                >
                  <Cpu size={13} />
                  Capabilities & Bindings ({associatedCapabilities.length})
                </button>
              </nav>

              {/* ================= TAB 1: OVERVIEW & MANIFEST ================= */}
              {activeTab === 'overview' && (
                <div className="skills-tab-pane">
                  <div className="skills-manifest-grid">
                    <div className="skill-spec-card">
                      <dt>Input Schema Contract</dt>
                      <dd className="mono">{selected.frontmatter?.input_schema || 'None'}</dd>
                    </div>
                    <div className="skill-spec-card">
                      <dt>Output Schema Contract</dt>
                      <dd className="mono">{selected.frontmatter?.output_schema || 'None'}</dd>
                    </div>
                    <div className="skill-spec-card">
                      <dt>Execution Stage</dt>
                      <dd>{selected.stage}</dd>
                    </div>
                    <div className="skill-spec-card">
                      <dt>Project Override Permitted</dt>
                      <dd style={{ color: selected.project_override && !selected.immutable ? 'var(--acc)' : 'var(--danger)' }}>
                        {selected.project_override && !selected.immutable ? 'Yes (Project Scope)' : 'No (Immutable Baseline)'}
                      </dd>
                    </div>
                  </div>

                  {/* Entrypoints */}
                  <div className="skill-badge-group">
                    <div className="skill-badge-group-title">
                      <ChevronRight size={13} /> Declared Entrypoint Routines
                    </div>
                    <div className="skill-badge-wrap">
                      {(selected.frontmatter?.entrypoints || []).length > 0 ? (
                        selected.frontmatter!.entrypoints!.map((ep: string) => (
                          <span key={ep} className="skill-entrypoint-chip">
                            <Terminal size={11} color="var(--muted)" /> {ep}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>No custom entrypoints declared.</span>
                      )}
                    </div>
                  </div>

                  {/* Permitted Connector Actions */}
                  <div className="skill-badge-group">
                    <div className="skill-badge-group-title">
                      <ShieldCheck size={13} color="var(--acc)" /> Permitted Connector Actions (Tool Ceilings)
                    </div>
                    <div className="skill-badge-wrap">
                      {(selected.allowed_actions || []).length > 0 ? (
                        selected.allowed_actions!.map(action => (
                          <span key={action} className="skill-action-chip">
                            <Shield size={11} /> {action}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          No connector actions permitted.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Forbidden Tools */}
                  {(selected.frontmatter?.forbidden_tools || []).length > 0 && (
                    <div className="skill-badge-group">
                      <div className="skill-badge-group-title">
                        <Lock size={13} color="var(--danger)" /> Explicitly Forbidden Tools (Safety Gate)
                      </div>
                      <div className="skill-badge-wrap">
                        {selected.frontmatter!.forbidden_tools!.map((tool: string) => (
                          <span key={tool} className="skill-forbidden-chip">
                            <Lock size={10} /> {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Workflow Instructions Preview */}
                  <div style={{ marginTop: '18px' }}>
                    <div className="skill-badge-group-title">
                      <List size={13} /> Platform Workflow Instructions (Standard Baseline)
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '14px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--line)',
                        borderRadius: '6px',
                        fontSize: '12.5px',
                        lineHeight: 1.55,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--tx)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: '260px',
                        overflowY: 'auto',
                      }}
                    >
                      {selected.instruction_body || selected.content}
                    </pre>
                  </div>
                </div>
              )}

              {/* ================= TAB 2: INSTRUCTION STUDIO & DIFF ================= */}
              {activeTab === 'studio' && (
                <div className="skills-tab-pane">
                  {/* Studio Toolbar */}
                  <div className="studio-toolbar">
                    <div className="studio-toolbar-left">
                      <div className="studio-view-toggle">
                        <button
                          type="button"
                          className={`studio-view-btn ${diffViewMode === 'editor' ? 'is-active' : ''}`}
                          onClick={() => setDiffViewMode('editor')}
                        >
                          <Edit3 size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                          Prompt Editor
                        </button>
                        <button
                          type="button"
                          className={`studio-view-btn ${diffViewMode === 'diff' ? 'is-active' : ''}`}
                          onClick={() => setDiffViewMode('diff')}
                        >
                          <GitCompare size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                          Diff vs Baseline
                        </button>
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '11px' }}
                        disabled={!canEdit || selected.immutable}
                        onClick={() => {
                          const baselineText = selected.instruction_body || selected.content || '';
                          setEditorText(baselineText);
                        }}
                        title="Load the platform baseline instruction into editor"
                      >
                        <CornerDownRight size={11} /> Load Baseline Template
                      </button>
                    </div>

                    <div className="studio-toolbar-right">
                      <span
                        style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: lintCheck.isOverLimit ? 'rgba(239,68,68,0.1)' : 'var(--card-subtle)',
                          color: lintCheck.isOverLimit ? 'var(--danger)' : lintCheck.isNearLimit ? '#d97706' : 'var(--muted)',
                          border: '1px solid var(--line)',
                        }}
                      >
                        <b>{lintCheck.charCount.toLocaleString()}</b> / 16,000 chars
                      </span>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '11px' }}
                        onClick={() => void copyText(editorText, setCopiedPrompt)}
                      >
                        {copiedPrompt ? <Check size={11} color="var(--acc)" /> : <Copy size={11} />}
                        {copiedPrompt ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* Mode 1: Editor */}
                  {diffViewMode === 'editor' && (
                    <div>
                      {selected.immutable && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 14px',
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '6px',
                            marginBottom: '10px',
                            fontSize: '12px',
                            color: 'var(--tx)',
                          }}
                        >
                          <Lock size={14} color="var(--danger)" />
                          <span>
                            This skill is marked <strong>immutable</strong> by platform policy. Project-level prompt customizations cannot be applied.
                          </span>
                        </div>
                      )}

                      {!canEdit && !selected.immutable && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 14px',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.25)',
                            borderRadius: '6px',
                            marginBottom: '10px',
                            fontSize: '12px',
                            color: 'var(--tx)',
                          }}
                        >
                          <Info size={14} color="#d97706" />
                          <span>
                            Read-only view. Customizing project prompt instructions requires <strong>PLATFORM_ADMIN</strong>, <strong>PROJECT_OWNER</strong>, or <strong>PROJECT_MANAGER</strong> role.
                          </span>
                        </div>
                      )}

                      <div className="studio-textarea-wrap">
                        <textarea
                          className="studio-textarea"
                          rows={14}
                          value={editorText}
                          disabled={selected.immutable || !canEdit}
                          onChange={e => setEditorText(e.target.value)}
                          placeholder="Enter customized workflow instructions for this skill..."
                        />
                      </div>
                    </div>
                  )}

                  {/* Mode 2: Diff View */}
                  {diffViewMode === 'diff' && (
                    <div className="studio-diff-container">
                      <div className="studio-diff-pane">
                        <div className="studio-diff-pane-header">
                          <span>Platform Baseline Template</span>
                          <span className="badge badge-neutral" style={{ fontSize: '9.5px' }}>Immutable Source</span>
                        </div>
                        <pre className="studio-diff-code">
                          {(selected.instruction_body || selected.content || '').split('\n').map((line, idx) => (
                            <span key={`base-${idx}`} className="diff-line-same">
                              {line || ' '}
                            </span>
                          ))}
                        </pre>
                      </div>

                      <div className="studio-diff-pane">
                        <div className="studio-diff-pane-header">
                          <span>Project Candidate Prompt</span>
                          <span className="badge badge-active" style={{ fontSize: '9.5px' }}>Custom Draft</span>
                        </div>
                        <pre className="studio-diff-code">
                          {diffLines.map((d, idx) => {
                            if (d.type === 'del') {
                              return (
                                <span key={`cand-${idx}`} className="diff-line-add">
                                  + {d.candText || ' '}
                                </span>
                              );
                            }
                            return (
                              <span key={`cand-${idx}`} className="diff-line-same">
                                  {d.candText || ' '}
                              </span>
                            );
                          })}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Real-time Lint & Safety Bar */}
                  <div className="studio-lint-strip">
                    <div className="studio-lint-checklist">
                      <span className={`studio-lint-item ${lintCheck.hasEvidenceCitation ? 'is-valid' : ''}`}>
                        <CheckSquare size={12} color={lintCheck.hasEvidenceCitation ? 'var(--acc)' : 'var(--muted)'} />
                        Evidence IDs ([EVD-...])
                      </span>
                      <span className={`studio-lint-item ${lintCheck.hasTemporalAnchor ? 'is-valid' : ''}`}>
                        <CheckSquare size={12} color={lintCheck.hasTemporalAnchor ? 'var(--acc)' : 'var(--muted)'} />
                        UTC Temporal Anchor
                      </span>
                      <span className={`studio-lint-item ${!lintCheck.hasSecretPattern ? 'is-valid' : 'is-danger'}`}>
                        <CheckSquare size={12} color={!lintCheck.hasSecretPattern ? 'var(--acc)' : 'var(--danger)'} />
                        {lintCheck.hasSecretPattern ? 'Secret/Token detected!' : 'Redaction Gate'}
                      </span>
                      <span className="studio-lint-item is-valid">
                        <CheckSquare size={12} color="var(--acc)" />
                        Stage Schema Contract
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {selected.is_overridden_in_project && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={resetting || saving || !canEdit}
                          onClick={() => void handleResetToBaseline()}
                          style={{ fontSize: '11.5px', padding: '6px 12px' }}
                          title={!canEdit ? 'Administrative role required' : 'Revert to baseline'}
                        >
                          <RotateCcw size={12} className={resetting ? 'spin' : ''} />
                          {resetting ? 'Reverting...' : 'Revert to Baseline'}
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={saving || resetting || !editorText.trim() || selected.immutable || lintCheck.isOverLimit || !canEdit}
                        onClick={() => void handleSaveAndEvaluate()}
                        style={{ fontSize: '11.5px', padding: '6px 14px' }}
                        title={!canEdit ? 'Administrative role required' : 'Save and run instruction assertions'}
                      >
                        <Sparkles size={13} className={saving ? 'spin' : ''} />
                        {saving ? 'Saving & Checking…' : 'Save & Check Instructions'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ================= TAB 3: RAW SKILL.MD ================= */}
              {activeTab === 'markdown' && (
                <div className="skills-tab-pane">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                      <FileText size={14} color="var(--acc)" />
                      <span>SKILL.md Source (Frontmatter + Instructions)</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      onClick={() => void copyText(selected.content || '', setCopiedRaw)}
                    >
                      {copiedRaw ? <Check size={11} color="var(--acc)" /> : <Copy size={11} />}
                      {copiedRaw ? 'Copied' : 'Copy File Content'}
                    </button>
                  </div>

                  <pre
                    style={{
                      margin: 0,
                      padding: '16px',
                      background: 'rgba(0,0,0,0.35)',
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--tx)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '440px',
                      overflowY: 'auto',
                    }}
                  >
                    {selected.content}
                  </pre>
                </div>
              )}

              {/* ================= TAB 4: OFFLINE CHECKS & MLFLOW ================= */}
              {activeTab === 'mlflow' && (
                <div className="skills-tab-pane">
                  {activeEvaluation ? (
                    <div className="mlflow-report-card">
                      <div className="mlflow-report-header">
                        <div>
                          <h3>
                            <BarChart2 size={16} color="var(--acc)" />
                            Offline Instruction Check Report: {activeEvaluation.stage_executed}
                          </h3>
                          <p>
                            Deterministic text assertions; not live model quality. Experiment: <b>{activeEvaluation.experiment_name}</b> • Status: <span style={{ color: 'var(--acc)', fontWeight: 600 }}>{activeEvaluation.status}</span>
                          </p>
                        </div>

                        <span className="badge badge-active" style={{ fontSize: '11px' }}>
                          <TrendingUp size={12} style={{ marginRight: '4px' }} />
                          {activeEvaluation.improvement.status}
                        </span>
                      </div>

                      {/* Run ID Strip */}
                      <div className="mlflow-run-strip">
                        <span>
                          Run ID: <strong style={{ color: 'var(--tx)' }}>{activeEvaluation.run_id}</strong>
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '10px' }}
                          onClick={() => void copyText(activeEvaluation.run_id, setCopiedRunId)}
                        >
                          {copiedRunId ? <Check size={10} color="var(--acc)" /> : <Copy size={10} />}
                          {copiedRunId ? 'Copied' : 'Copy Run ID'}
                        </button>
                      </div>

                      {/* Summary */}
                      <p style={{ fontSize: '12.5px', color: 'var(--tx)', margin: '8px 0 14px' }}>
                        {activeEvaluation.improvement.summary}
                      </p>

                      {/* Scorecards */}
                      <div className="mlflow-scorecards-grid">
                        <div className="mlflow-stat-card">
                          <small>Contract Compliance</small>
                          <strong>
                            {activeEvaluation.candidate_metrics.contract_status !== undefined
                              ? `${(activeEvaluation.candidate_metrics.contract_status * 100).toFixed(0)}%`
                              : '—'}
                          </strong>
                        </div>
                        <div className="mlflow-stat-card">
                          <small>Citation Rate</small>
                          <strong>
                            {activeEvaluation.candidate_metrics.citation_rate !== undefined
                              ? activeEvaluation.candidate_metrics.citation_rate.toFixed(2)
                              : '—'}
                          </strong>
                        </div>
                        <div className="mlflow-stat-card">
                          <small>Temporal Precision</small>
                          <strong>
                            {activeEvaluation.candidate_metrics.temporal_precision !== undefined
                              ? `${(activeEvaluation.candidate_metrics.temporal_precision * 100).toFixed(0)}%`
                              : '—'}
                          </strong>
                        </div>
                        <div className="mlflow-stat-card">
                          <small>Redaction Gate</small>
                          <strong style={{
                            color: activeEvaluation.candidate_metrics.secrets_absent === 1
                              ? 'var(--acc)'
                              : activeEvaluation.candidate_metrics.secrets_absent === 0
                                ? 'var(--danger)'
                                : 'var(--muted)'
                          }}>
                            {activeEvaluation.candidate_metrics.secrets_absent === 1
                              ? 'PASS'
                              : activeEvaluation.candidate_metrics.secrets_absent === 0
                                ? 'FAIL'
                                : '—'}
                          </strong>
                        </div>
                        <div className="mlflow-stat-card">
                          <small>Quality Score</small>
                          <strong style={{ color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            {activeEvaluation.candidate_metrics.quality_score !== undefined ? (
                              <>
                                <ArrowUpRight size={13} />
                                {`${(activeEvaluation.candidate_metrics.quality_score * 100).toFixed(1)}%`}
                              </>
                            ) : '—'}
                          </strong>
                        </div>
                      </div>

                      {/* Metrics Comparison Table */}
                      <div className="table-wrap">
                        <table className="data-table" style={{ fontSize: '12px' }}>
                          <thead>
                            <tr>
                              <th>Metric Assertion</th>
                              <th>Platform Baseline</th>
                              <th>Project Candidate</th>
                              <th>Status / Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Estimated Quality Score</td>
                              <td>{activeEvaluation.baseline_metrics.quality_score !== undefined ? `${(activeEvaluation.baseline_metrics.quality_score * 100).toFixed(1)}%` : '—'}</td>
                              <td><strong>{activeEvaluation.candidate_metrics.quality_score !== undefined ? `${(activeEvaluation.candidate_metrics.quality_score * 100).toFixed(1)}%` : '—'}</strong></td>
                              <td style={{ color: activeEvaluation.improvement.delta >= 0 ? 'var(--acc)' : 'var(--danger)' }}>
                                {activeEvaluation.improvement.delta >= 0 ? `+${(activeEvaluation.improvement.delta * 100).toFixed(1)}%` : `${(activeEvaluation.improvement.delta * 100).toFixed(1)}%`}
                              </td>
                            </tr>
                            <tr>
                              <td>Instruction Characters</td>
                              <td>{activeEvaluation.baseline_metrics.instruction_chars ?? '—'}</td>
                              <td>{activeEvaluation.candidate_metrics.instruction_chars ?? '—'}</td>
                              <td>
                                {activeEvaluation.candidate_metrics.instruction_chars !== undefined && activeEvaluation.baseline_metrics.instruction_chars !== undefined
                                  ? `${activeEvaluation.candidate_metrics.instruction_chars - activeEvaluation.baseline_metrics.instruction_chars} chars`
                                  : '—'}
                              </td>
                            </tr>
                            <tr>
                              <td>Contract Status Check</td>
                              <td>{activeEvaluation.baseline_metrics.contract_status !== undefined ? `${(activeEvaluation.baseline_metrics.contract_status * 100).toFixed(0)}%` : '—'}</td>
                              <td>{activeEvaluation.candidate_metrics.contract_status !== undefined ? `${(activeEvaluation.candidate_metrics.contract_status * 100).toFixed(0)}%` : '—'}</td>
                              <td style={{ color: (activeEvaluation.candidate_metrics.contract_status ?? 0) >= (activeEvaluation.baseline_metrics.contract_status ?? 0) ? 'var(--acc)' : 'var(--danger)' }}>
                                {(activeEvaluation.candidate_metrics.contract_status ?? 0) >= (activeEvaluation.baseline_metrics.contract_status ?? 0) ? 'Satisfied' : 'Degraded'}
                              </td>
                            </tr>
                            <tr>
                              <td>Evidence Citation Validity</td>
                              <td>{activeEvaluation.baseline_metrics.citation_rate !== undefined ? activeEvaluation.baseline_metrics.citation_rate.toFixed(2) : '—'}</td>
                              <td>{activeEvaluation.candidate_metrics.citation_rate !== undefined ? activeEvaluation.candidate_metrics.citation_rate.toFixed(2) : '—'}</td>
                              <td style={{ color: (activeEvaluation.candidate_metrics.citation_rate ?? 0) >= (activeEvaluation.baseline_metrics.citation_rate ?? 0) ? 'var(--acc)' : 'var(--danger)' }}>
                                {(activeEvaluation.candidate_metrics.citation_rate ?? 0) >= (activeEvaluation.baseline_metrics.citation_rate ?? 0) ? 'Verified' : 'Unverified'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--card-subtle)', borderRadius: '8px', border: '1px dashed var(--line)' }}>
                      <Activity size={32} color="var(--muted)" style={{ margin: '0 auto 10px', opacity: 0.6 }} />
                      <h4 style={{ margin: '0 0 6px', fontSize: '14px', color: 'var(--tx)' }}>
                        No offline instruction checks recorded yet for {selected.id}
                      </h4>
                      <p style={{ color: 'var(--muted)', fontSize: '12px', maxWidth: '480px', margin: '0 auto 14px' }}>
                        Modify the project prompt instructions in the Instruction Studio tab and click <strong>'Save & Check Instructions'</strong> to run deterministic text assertions through the platform's MLflow tracking engine.
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setActiveTab('studio')}
                        style={{ fontSize: '12px' }}
                      >
                        Open Instruction Studio
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ================= TAB 5: CAPABILITIES & BINDINGS ================= */}
              {activeTab === 'capabilities' && (
                <div className="skills-tab-pane">
                  <div style={{ marginBottom: '14px' }}>
                    <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: 'var(--tx)' }}>
                      Associated Platform Capabilities
                    </h3>
                    <p style={{ color: 'var(--muted)', fontSize: '12px', margin: 0 }}>
                      The following registered capabilities declare <code>{selected.id}</code> in their manifests:
                    </p>
                  </div>

                  {associatedCapabilities.length === 0 ? (
                    <div style={{ padding: '24px', background: 'var(--card-subtle)', borderRadius: '6px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                      No declared capabilities directly reference this skill in their manifest.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                      {associatedCapabilities.map(cap => (
                        <div key={cap.id} className="skill-spec-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <strong style={{ fontSize: '13px', color: 'var(--tx)' }}>{cap.name || cap.id}</strong>
                              <span className="badge badge-neutral" style={{ fontSize: '9.5px' }}>v{cap.version || '1.0'}</span>
                            </div>
                            <p style={{ color: 'var(--muted)', fontSize: '11.5px', margin: '4px 0 8px', lineHeight: 1.4 }}>
                              {cap.description || 'Declared capability.'}
                            </p>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--line)', marginTop: '8px', fontSize: '11px' }}>
                            <span style={{ color: 'var(--muted)' }}>
                              Category: <strong style={{ color: 'var(--tx)' }}>{cap.category || 'general'}</strong>
                            </span>
                            {onNavigate && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '2px 8px', fontSize: '10.5px' }}
                                onClick={() => onNavigate('capabilities')}
                              >
                                View Capability <ExternalLink size={10} style={{ marginLeft: '3px' }} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="card empty-state">Select a skill from the catalog to inspect.</div>
          )}
        </main>

        {/* =================================================================
            COLUMN 3: Governance & Ceiling Inspector (Right)
            ================================================================= */}
        <aside className="skills-inspector-panel">
          {selected && (
            <>
              {/* Governance & Policy Card */}
              <div className="inspector-section-card">
                <div className="inspector-title">
                  <span>Governance & Scope</span>
                  <span className="badge">Platform</span>
                </div>

                <div className="inspector-specs-list">
                  <div className="inspector-spec-item">
                    <span className="label">Skill Identifier</span>
                    <span className="value mono">{selected.id}</span>
                  </div>
                  <div className="inspector-spec-item">
                    <span className="label">Tenant / Project</span>
                    <span className="value">{principal ? `${principal.tenant_id} / ${principal.project_id}` : '—'}</span>
                  </div>
                  <div className="inspector-spec-item">
                    <span className="label">ADK Stage Mapped</span>
                    <span className="value">{selected.stage}</span>
                  </div>
                  <div className="inspector-spec-item">
                    <span className="label">Immutability</span>
                    <span className="value" style={{ color: selected.immutable ? 'var(--danger)' : 'var(--acc)' }}>
                      {selected.immutable ? 'Immutable (Locked)' : 'Customizable'}
                    </span>
                  </div>
                  <div className="inspector-spec-item">
                    <span className="label">Project Delegation</span>
                    <span className="value" style={{ color: selected.project_override ? 'var(--acc)' : 'var(--muted)' }}>
                      {selected.project_override ? 'Permitted' : 'Disabled'}
                    </span>
                  </div>
                  <div className="inspector-spec-item">
                    <span className="label">Active State</span>
                    <span className="value">
                      {selected.is_overridden_in_project ? (
                        <span style={{ color: 'var(--acc)', fontWeight: 600 }}>Custom Active</span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Platform Baseline</span>
                      )}
                    </span>
                  </div>
                  <div className="inspector-spec-item">
                    <span className="label">Manifest Size</span>
                    <span className="value">{selected.size_bytes} bytes</span>
                  </div>
                </div>
              </div>

              {/* Tool Ceilings & Connectors Card */}
              <div className="inspector-section-card">
                <div className="inspector-title">
                  <span>Connector Ceilings</span>
                  <span className="badge">Policy</span>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px', fontSize: '11px' }}>
                    Allowed Connector Actions:
                  </small>
                  {(selected.allowed_actions || []).length > 0 ? (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {selected.allowed_actions!.map(act => (
                        <span key={act} className="badge badge-active" style={{ fontSize: '10px' }}>
                          {act}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>No connector actions granted.</span>
                  )}
                </div>

                <div>
                  <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px', fontSize: '11px' }}>
                    Required Tools:
                  </small>
                  {(selected.frontmatter?.required_tools || []).length > 0 ? (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {selected.frontmatter!.required_tools!.map((tool: string) => (
                        <span key={tool} className="badge badge-neutral" style={{ fontSize: '10px' }}>
                          {tool}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>None required.</span>
                  )}
                </div>
              </div>

              {/* Associated Capabilities Quick Links */}
              <div className="inspector-section-card">
                <div className="inspector-title">
                  <span>Mapped Capabilities</span>
                  <span className="badge">{associatedCapabilities.length}</span>
                </div>

                {associatedCapabilities.length === 0 ? (
                  <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                    No capabilities directly bound.
                  </span>
                ) : (
                  <div className="capabilities-links-list">
                    {associatedCapabilities.map(cap => (
                      <div key={cap.id} className="capability-link-item">
                        <span className="cap-name">
                          <Cpu size={12} color="var(--acc)" />
                          {cap.name || cap.id}
                        </span>
                        {onNavigate && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '2px 6px', fontSize: '10px' }}
                            onClick={() => onNavigate('capabilities')}
                            title="Navigate to Capabilities"
                          >
                            <ExternalLink size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
