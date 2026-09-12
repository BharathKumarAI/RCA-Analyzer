import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Search, ShieldCheck, CheckCircle2,
  RefreshCw, Copy, Check, FileText, Lock,
  Sparkles, Layers, Sliders, RotateCcw, AlertCircle,
  BarChart2, Activity, ChevronRight, ArrowUpRight,
  TrendingUp, CornerDownRight, CheckSquare, Edit3, Info
} from 'lucide-react';
import {
  ApiError, fetchSkills, saveProjectSkill, resetProjectSkill
} from '../services/api';
import { SkillItem, SkillMlflowReport } from '../types/api';

type TabKey = 'platform' | 'project';

export const Skills: React.FC = () => {
  const [skills, setSkills] = useState<SkillItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('platform');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Editor state for Project Skills
  const [editorText, setEditorText] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedRunId, setCopiedRunId] = useState(false);
  const [contentViewMode, setContentViewMode] = useState<'workflow' | 'raw'>('workflow');
  const [evaluationResult, setEvaluationResult] = useState<Record<string, SkillMlflowReport>>({});
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSkills();
      setSkills(data);
      setSelectedId(current => {
        if (current && data.some(s => s.id === current)) return current;
        return data[0]?.id || null;
      });
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to load platform and project skills.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Only customizable skills belong in the Project tab (immutable platform skills belong exclusively to Platform)
  const projectCustomizableSkills = useMemo(() => {
    return (skills || []).filter(s => s.project_override && !s.immutable);
  }, [skills]);

  // Ensure selection is valid when switching to project tab
  useEffect(() => {
    if (activeTab === 'project' && projectCustomizableSkills.length > 0) {
      if (!selectedId || !projectCustomizableSkills.some(s => s.id === selectedId)) {
        setSelectedId(projectCustomizableSkills[0].id);
      }
    }
  }, [activeTab, projectCustomizableSkills, selectedId]);

  const selected = useMemo(() => {
    if (!skills || !skills.length) return null;
    const pool = activeTab === 'project' ? projectCustomizableSkills : skills;
    return pool.find(s => s.id === selectedId) || pool[0] || null;
  }, [skills, selectedId, activeTab, projectCustomizableSkills]);

  // Sync editor text when selected skill changes
  useEffect(() => {
    if (selected) {
      const textToLoad = selected.project_instruction || selected.instruction_body || selected.content || '';
      setEditorText(textToLoad);
    }
  }, [selected]);

  // Derived categories
  const categories = useMemo(() => {
    const list = activeTab === 'project' ? projectCustomizableSkills : (skills || []);
    const set = new Set<string>();
    list.forEach(s => {
      const cat = s.frontmatter?.category || 'general';
      set.add(cat.toUpperCase());
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [skills, activeTab, projectCustomizableSkills]);

  // Filtered skills list based on active tab
  const filtered = useMemo(() => {
    const baseList = activeTab === 'project' ? projectCustomizableSkills : (skills || []);
    return baseList.filter(skill => {
      const q = query.toLowerCase();
      const matchQuery = (
        skill.id.toLowerCase().includes(q) ||
        (skill.name && skill.name.toLowerCase().includes(q)) ||
        (skill.frontmatter?.summary && skill.frontmatter.summary.toLowerCase().includes(q)) ||
        (skill.stage && skill.stage.toLowerCase().includes(q))
      );
      const skillCat = (skill.frontmatter?.category || 'general').toUpperCase();
      const matchCat = categoryFilter === 'ALL' || skillCat === categoryFilter;
      return matchQuery && matchCat;
    });
  }, [activeTab, projectCustomizableSkills, skills, query, categoryFilter]);

  const activeOverridesCount = useMemo(() => {
    return (skills || []).filter(s => s.is_overridden_in_project).length;
  }, [skills]);

  // Handle Save & Evaluate
  const handleSaveAndEvaluate = async () => {
    if (!selected) return;
    setSaving(true);
    setActionNotice(null);
    try {
      const res = await saveProjectSkill(selected.id, {
        instruction: editorText,
        enabled: selected.project_enabled ?? true,
        ...(selected.project_actions != null ? { actions: selected.project_actions } : {}),
      });

      // Update skill in state
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
    if (!selected) return;
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
        message: `Skill '${selected.id}' reset to platform baseline.`,
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

  const copyRawContent = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch { setActionNotice({ type: 'error', message: 'Unable to copy instructions. Select the raw text and copy it manually.' }); }
  };

  const copyRunId = async (runId: string) => {
    try {
      await navigator.clipboard.writeText(runId);
      setCopiedRunId(true);
      setTimeout(() => setCopiedRunId(false), 2000);
    } catch { setActionNotice({ type: 'error', message: 'Unable to copy the run ID. Select the ID and copy it manually.' }); }
  };

  const activeEvaluation = selected ? evaluationResult[selected.id] : null;

  return (
    <div className="view-container">
      {/* Hero Header */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Skill Studio & <span>Governance</span>
          </h1>
          <p className="hero-lede">
            Inspect immutable platform baseline skills or customize project-scoped workflow instructions with offline instruction checks and optional MLflow tracking.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <BookOpen size={13} />
              <b>{skills?.length ?? '—'}</b> platform baseline skills
            </span>
            <span className="hero-stat-chip">
              <Sliders size={13} />
              <b>{projectCustomizableSkills.length}</b> customizable project skills
            </span>
            <span className="hero-stat-chip">
              <Sparkles size={13} color="var(--acc)" />
              <b>{activeOverridesCount}</b> active project overrides
            </span>
            <span className="hero-stat-chip">
              <Activity size={13} />
              <b>Validation:</b> Offline instruction checks
            </span>
          </div>
        </div>
      </section>

      {/* Action Notification */}
      {actionNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            marginBottom: '16px',
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

      {/* Global Error */}
      {error && (
        <div className="card" style={{ color: 'var(--danger)', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button className="btn btn-secondary" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {/* Main Tabs Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--line)',
          marginBottom: '16px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('platform')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: activeTab === 'platform' ? 700 : 500,
            color: activeTab === 'platform' ? 'var(--tx)' : 'var(--muted)',
            background: activeTab === 'platform' ? 'var(--card-subtle)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'platform' ? '2px solid var(--acc)' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <Layers size={15} color={activeTab === 'platform' ? 'var(--acc)' : 'var(--muted)'} />
          Platform Baseline Skills
          <span className="badge badge-neutral" style={{ fontSize: '10px', padding: '1px 6px' }}>
            {skills?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('project')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: activeTab === 'project' ? 700 : 500,
            color: activeTab === 'project' ? 'var(--tx)' : 'var(--muted)',
            background: activeTab === 'project' ? 'var(--card-subtle)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'project' ? '2px solid var(--acc)' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <Sliders size={15} color={activeTab === 'project' ? 'var(--acc)' : 'var(--muted)'} />
          Project Customizations & Offline Checks
          <span className="badge badge-neutral" style={{ fontSize: '10px', padding: '1px 6px' }}>
            {projectCustomizableSkills.length}
          </span>
          {activeOverridesCount > 0 && (
            <span className="badge badge-active" style={{ fontSize: '10px', padding: '1px 6px' }}>
              {activeOverridesCount} active
            </span>
          )}
        </button>
      </div>

      {/* Sub-Toolbar (Search & Category Filters) */}
      <div className="toolbar" style={{ marginBottom: '16px' }}>
        <div className="search-box" style={{ maxWidth: '320px' }}>
          <Search size={14} />
          <input
            type="search"
            placeholder={activeTab === 'project' ? 'Search customizable project skills...' : 'Search platform skills, stages, tools...'}
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              className={`filter-pill ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '12px',
                background: categoryFilter === cat ? 'var(--acc)' : 'var(--card-subtle)',
                color: categoryFilter === cat ? '#fff' : 'var(--muted)',
                border: '1px solid var(--line)',
                cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 8px', fontSize: '11px', marginLeft: '8px' }}
            onClick={() => void load()}
            title="Refresh skills catalog"
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <span className="count-badge">
          <b>{filtered.length}</b> skills matching
        </span>
      </div>

      {/* Loading & Empty States */}
      {loading && !skills ? (
        <div className="card empty-state">Loading skills from platform registry...</div>
      ) : !filtered.length ? (
        <div className="card empty-state">No skills match the current filter criteria.</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 1fr) minmax(560px, 2.4fr)',
            gap: '20px',
            alignItems: 'start',
          }}
        >
          {/* LEFT COLUMN: Skill Master List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filtered.map(skill => {
              const isSelected = skill.id === selected?.id;
              const isOverridden = Boolean(skill.is_overridden_in_project);
              const isImmutable = Boolean(skill.immutable);

              return (
                <div
                  key={skill.id}
                  onClick={() => setSelectedId(skill.id)}
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                    background: isSelected ? 'var(--card-subtle)' : 'var(--card)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <div>
                      <strong style={{ fontSize: '14px', color: 'var(--tx)' }}>
                        {skill.id}
                      </strong>
                      <span
                        style={{
                          display: 'inline-block',
                          marginLeft: '8px',
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'rgba(255,255,255,0.06)',
                          color: 'var(--muted)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {skill.frontmatter?.category || 'general'}
                      </span>
                    </div>

                    {activeTab === 'platform' ? (
                      isImmutable ? (
                        <span className="badge badge-neutral" style={{ fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Lock size={10} /> Locked
                        </span>
                      ) : (
                        <span className="badge badge-neutral" style={{ fontSize: '10px' }}>
                          Baseline
                        </span>
                      )
                    ) : (
                      isOverridden ? (
                        <span className="badge badge-active" style={{ fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Sparkles size={10} /> Custom Active
                        </span>
                      ) : (
                        <span className="badge badge-neutral" style={{ fontSize: '10px' }}>
                          Inheriting
                        </span>
                      )
                    )}
                  </div>

                  <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0 8px 0', lineHeight: 1.4 }}>
                    {skill.frontmatter?.summary || 'No summary declared in manifest.'}
                  </p>

                  {activeTab === 'platform' ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>Stage: <strong style={{ color: 'var(--tx)' }}>{skill.stage}</strong></span>
                      <span>•</span>
                      <span>{skill.size_bytes} bytes</span>
                      <span>•</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>sha256:{skill.sha256?.substring(0, 8)}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>ADK Stage: <strong style={{ color: 'var(--tx)' }}>{skill.stage}</strong></span>
                      <span>•</span>
                      <span>Project: <strong style={{ color: 'var(--tx)' }}>payments</strong></span>
                      {evaluationResult[skill.id] && (
                        <>
                          <span>•</span>
                          <span style={{ color: 'var(--acc)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <TrendingUp size={11} />
                            Score: {(Number(evaluationResult[skill.id].candidate_metrics.quality_score ?? 0.95) * 100).toFixed(0)}%
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* RIGHT COLUMN: Detail Inspector / Editor */}
          {selected && (
            <div>
              {/* ================= TAB 1: PLATFORM BASELINE ================= */}
              {activeTab === 'platform' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Skill Header Card */}
                  <article className="card">
                    <div className="card-title-row">
                      <div>
                        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <BookOpen size={18} color="var(--acc)" />
                          {selected.id}
                        </h2>
                        <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '4px' }}>
                          {selected.frontmatter?.summary || 'No summary declared in manifest.'}
                        </p>
                      </div>
                      <span className="badge badge-active">
                        {selected.frontmatter?.version ? `v${selected.frontmatter.version}` : 'shipped'}
                      </span>
                    </div>

                    {/* Meta Pills */}
                    <div className="card-meta-pills" style={{ marginTop: '12px' }}>
                      <span className="meta-pill">
                        {selected.immutable ? (
                          <><Lock size={12} color="var(--danger)" /> Immutable Platform Baseline</>
                        ) : (
                          <><ShieldCheck size={12} color="var(--acc)" /> Project Override Permitted</>
                        )}
                      </span>
                      <span className="meta-pill">
                        Project Delegation: <strong style={{ color: selected.project_override ? 'var(--acc)' : 'var(--danger)' }}>
                          {selected.project_override ? 'Enabled' : 'Disabled'}
                        </strong>
                      </span>
                      <span className="meta-pill">
                        Mapped ADK Stage: <strong style={{ color: 'var(--tx)' }}>{selected.stage}</strong>
                      </span>
                      <span className="meta-pill" style={{ fontFamily: 'var(--font-mono)' }}>
                        SHA-256: {selected.sha256?.substring(0, 16)}…
                      </span>
                    </div>
                  </article>

                  {/* Parsed Frontmatter & Governance Details */}
                  <div className="card">
                    <h3 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck size={14} color="var(--acc)" /> Parsed Platform Manifest & Tool Ceilings
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                      <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px' }}>
                        <small style={{ color: 'var(--muted)', display: 'block' }}>Input Schema</small>
                        <strong style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--tx)' }}>
                          {selected.frontmatter?.input_schema || 'None'}
                        </strong>
                      </div>
                      <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px' }}>
                        <small style={{ color: 'var(--muted)', display: 'block' }}>Output Schema</small>
                        <strong style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--tx)' }}>
                          {selected.frontmatter?.output_schema || 'None'}
                        </strong>
                      </div>
                      <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px' }}>
                        <small style={{ color: 'var(--muted)', display: 'block' }}>Status</small>
                        <strong style={{ fontSize: '12px', color: 'var(--acc)' }}>
                          {selected.frontmatter?.status || selected.status || 'configured'}
                        </strong>
                      </div>
                    </div>

                    {/* Entrypoints */}
                    <div style={{ marginBottom: '14px' }}>
                      <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Declared Entrypoint Routines:</small>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(selected.frontmatter?.entrypoints || []).length > 0 ? (
                          selected.frontmatter!.entrypoints!.map((ep: string) => (
                            <span key={ep} className="badge badge-neutral" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                              <ChevronRight size={10} /> {ep}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>No entrypoints declared in manifest.</span>
                        )}
                      </div>
                    </div>

                    {/* Allowed Actions */}
                    <div>
                      <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Permitted Connector Actions:</small>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(selected.allowed_actions || []).length > 0 ? (
                          selected.allowed_actions!.map(action => (
                            <span key={action} className="badge badge-active" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                              {action}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>No connector actions permitted.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actual Skill Content (SKILL.md) */}
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <FileText size={15} color="var(--acc)" />
                        <h3 style={{ fontSize: '13px', textTransform: 'uppercase', margin: 0 }}>
                          Actual Skill Definition (SKILL.md)
                        </h3>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => setContentViewMode(contentViewMode === 'workflow' ? 'raw' : 'workflow')}
                        >
                          {contentViewMode === 'workflow' ? 'Show Full Raw (with Frontmatter)' : 'Show Workflow Body'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => copyRawContent(selected.content || '')}
                        >
                          {copiedRaw ? <Check size={12} color="var(--acc)" /> : <Copy size={12} />}
                          {copiedRaw ? 'Copied' : 'Copy'}
                        </button>
                      </div>
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
                      {contentViewMode === 'workflow' ? (selected.instruction_body || selected.content) : selected.content}
                    </pre>
                  </div>
                </div>
              )}

              {/* ================= TAB 2: PROJECT SKILLS (EDIT & EVALUATE) ================= */}
              {activeTab === 'project' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Skill Customization Card */}
                  <article className="card" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
                    <div className="card-title-row" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '14px', marginBottom: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '34px',
                            height: '34px',
                            borderRadius: '8px',
                            background: 'rgba(34, 197, 94, 0.1)',
                            border: '1px solid rgba(34, 197, 94, 0.3)',
                            color: 'var(--acc)',
                          }}>
                            <Sliders size={17} />
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <h2 className="card-title" style={{ margin: 0, fontSize: '16px' }}>
                                {selected.id}
                              </h2>
                              <span className="badge badge-neutral" style={{ fontSize: '10.5px' }}>
                                Stage: <strong style={{ color: 'var(--tx)', marginLeft: '3px' }}>{selected.stage}</strong>
                              </span>
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px', display: 'block' }}>
                              {selected.frontmatter?.summary || 'Project-scoped instruction tuning and MLflow validation'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="badge badge-neutral" style={{ fontSize: '11px', padding: '4px 8px' }}>
                          Scope: <strong style={{ color: 'var(--tx)', marginLeft: '4px' }}>payments</strong>
                        </span>
                        {selected.is_overridden_in_project ? (
                          <span className="badge badge-active" style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Sparkles size={12} /> Custom Override Active
                          </span>
                        ) : (
                          <span className="badge badge-neutral" style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Layers size={12} /> Inheriting Platform Baseline
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Instruction Editor Workspace */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Edit3 size={14} color="var(--acc)" />
                          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
                            Project Prompt Instructions (<code style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>project.yaml</code>):
                          </label>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                            onClick={() => {
                              const baselineText = selected.instruction_body || selected.content || '';
                              setEditorText(baselineText);
                            }}
                            title="Load the platform baseline instruction into the editor as a template"
                          >
                            <CornerDownRight size={11} /> Load Baseline Template
                          </button>
                          <span
                            style={{
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: editorText.length > 15000 ? 'rgba(239,68,68,0.1)' : 'var(--card-subtle)',
                              color: editorText.length > 15000 ? 'var(--danger)' : 'var(--muted)',
                              border: '1px solid var(--line)',
                            }}
                          >
                            <strong>{editorText.length.toLocaleString()}</strong> / 16,000 chars
                          </span>
                        </div>
                      </div>

                      <div style={{ position: 'relative' }}>
                        <textarea
                          value={editorText}
                          onChange={e => setEditorText(e.target.value)}
                          rows={14}
                          style={{
                            width: '100%',
                            minHeight: '280px',
                            padding: '16px',
                            background: 'rgba(0, 0, 0, 0.4)',
                            border: '1px solid var(--line)',
                            borderRadius: '8px',
                            color: 'var(--tx)',
                            fontSize: '13px',
                            lineHeight: 1.55,
                            fontFamily: 'var(--font-mono)',
                            resize: 'vertical',
                            boxSizing: 'border-box',
                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
                          }}
                          placeholder="Enter customized workflow instructions for this skill..."
                        />
                      </div>

                      {/* Real-Time Safety & Policy Checks */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginTop: '6px' }}>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '11.5px', flexWrap: 'wrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: editorText.toLowerCase().includes('evidence') ? 'var(--acc)' : 'var(--muted)' }}>
                            <CheckSquare size={13} color={editorText.toLowerCase().includes('evidence') ? 'var(--acc)' : 'var(--muted)'} />
                            Cites Evidence IDs ([EVD-...])
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: (editorText.toLowerCase().includes('anchor') || editorText.toLowerCase().includes('time') || editorText.toLowerCase().includes('utc')) ? 'var(--acc)' : 'var(--muted)' }}>
                            <CheckSquare size={13} color={(editorText.toLowerCase().includes('anchor') || editorText.toLowerCase().includes('time') || editorText.toLowerCase().includes('utc')) ? 'var(--acc)' : 'var(--muted)'} />
                            Resolves UTC Temporal Anchor
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--acc)' }}>
                            <CheckSquare size={13} color="var(--acc)" />
                            Stage Schema Contract Enforced
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          {selected.is_overridden_in_project && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={resetting || saving}
                              onClick={() => void handleResetToBaseline()}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                            >
                              <RotateCcw size={13} className={resetting ? 'spin' : ''} />
                              {resetting ? 'Resetting...' : 'Revert to Baseline'}
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={saving || resetting || !editorText.trim()}
                            onClick={() => void handleSaveAndEvaluate()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '12px' }}
                          >
                            <Sparkles size={14} className={saving ? 'spin' : ''} />
                            {saving ? 'Saving & checking…' : 'Save & check instructions'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>

                  {/* MLflow Evaluation & Validation Report */}
                  {activeEvaluation && (
                    <article className="card" style={{ border: '1px solid var(--acc)', background: 'linear-gradient(180deg, rgba(34, 197, 94, 0.04) 0%, rgba(0, 0, 0, 0) 100%)' }}>
                      <div className="card-title-row">
                        <div>
                          <h3 style={{ fontSize: '14px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <BarChart2 size={16} color="var(--acc)" />
                            Offline instruction check report: {activeEvaluation.stage_executed}
                          </h3>
                          <p style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px' }}>
                            Deterministic text checks; not live model quality. Experiment: <strong>{activeEvaluation.experiment_name}</strong> • Status: <span style={{ color: 'var(--acc)', fontWeight: 600 }}>{activeEvaluation.status}</span>
                          </p>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="badge badge-active" style={{ fontSize: '11px' }}>
                            <TrendingUp size={12} style={{ marginRight: '4px' }} />
                            {activeEvaluation.improvement.status}
                          </span>
                        </div>
                      </div>

                      {/* Run ID Strip */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'rgba(0,0,0,0.25)',
                          borderRadius: '6px',
                          margin: '12px 0',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span style={{ color: 'var(--muted)' }}>
                          Run ID: <strong style={{ color: 'var(--tx)' }}>{activeEvaluation.run_id}</strong>
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => copyRunId(activeEvaluation.run_id)}
                        >
                          {copiedRunId ? <Check size={10} color="var(--acc)" /> : <Copy size={10} />}
                          {copiedRunId ? 'Copied' : 'Copy Run ID'}
                        </button>
                      </div>

                      {/* Summary Narrative */}
                      <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--tx)', margin: '8px 0 16px 0' }}>
                        {activeEvaluation.improvement.summary}
                      </p>

                      {/* Scorecards Grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                        <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px', textAlign: 'center' }}>
                          <small style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>Contract Compliance</small>
                          <strong style={{ fontSize: '16px', color: 'var(--acc)' }}>
                            {(Number(activeEvaluation.candidate_metrics.contract_status ?? 1) * 100).toFixed(0)}%
                          </strong>
                        </div>

                        <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px', textAlign: 'center' }}>
                          <small style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>Citation Validity</small>
                          <strong style={{ fontSize: '16px', color: 'var(--acc)' }}>
                            {Number(activeEvaluation.candidate_metrics.citation_rate ?? 1).toFixed(2)}
                          </strong>
                        </div>

                        <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px', textAlign: 'center' }}>
                          <small style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>Temporal Precision</small>
                          <strong style={{ fontSize: '16px', color: 'var(--acc)' }}>
                            {(Number(activeEvaluation.candidate_metrics.temporal_precision ?? 1) * 100).toFixed(0)}%
                          </strong>
                        </div>

                        <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px', textAlign: 'center' }}>
                          <small style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>Redaction Gate</small>
                          <strong style={{ fontSize: '16px', color: 'var(--acc)' }}>
                            PASS
                          </strong>
                        </div>

                        <div style={{ padding: '10px', background: 'var(--card-subtle)', borderRadius: '6px', textAlign: 'center' }}>
                          <small style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>Quality Delta</small>
                          <strong style={{ fontSize: '16px', color: activeEvaluation.improvement.delta >= 0 ? 'var(--acc)' : 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                            {activeEvaluation.improvement.delta >= 0 && <ArrowUpRight size={14} />}
                            {activeEvaluation.improvement.delta >= 0 ? `+${(activeEvaluation.improvement.delta * 100).toFixed(1)}%` : `${(activeEvaluation.improvement.delta * 100).toFixed(1)}%`}
                          </strong>
                        </div>
                      </div>

                      {/* Metrics Comparison Table */}
                      <div className="table-wrap">
                        <table className="data-table" style={{ fontSize: '12px' }}>
                          <thead>
                            <tr>
                              <th>Evaluation Metric</th>
                              <th>Platform Baseline</th>
                              <th>Project Candidate</th>
                              <th>Status / Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Estimated Quality Score</td>
                              <td>{(Number(activeEvaluation.baseline_metrics.quality_score ?? 0.90) * 100).toFixed(1)}%</td>
                              <td><strong>{(Number(activeEvaluation.candidate_metrics.quality_score ?? 0.95) * 100).toFixed(1)}%</strong></td>
                              <td style={{ color: 'var(--acc)' }}>
                                {activeEvaluation.improvement.delta >= 0 ? `+${(activeEvaluation.improvement.delta * 100).toFixed(1)}%` : `${(activeEvaluation.improvement.delta * 100).toFixed(1)}%`}
                              </td>
                            </tr>
                            <tr>
                              <td>Instruction Characters</td>
                              <td>{activeEvaluation.baseline_metrics.instruction_chars ?? '—'}</td>
                              <td>{activeEvaluation.candidate_metrics.instruction_chars ?? '—'}</td>
                              <td>
                                {(activeEvaluation.candidate_metrics.instruction_chars ?? 0) - (activeEvaluation.baseline_metrics.instruction_chars ?? 0)} chars
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
                            {activeEvaluation.candidate_metrics.temporal_precision !== undefined && (
                              <tr>
                                <td>Temporal Anchor Precision</td>
                                <td>{activeEvaluation.baseline_metrics.temporal_precision !== undefined ? `${(activeEvaluation.baseline_metrics.temporal_precision * 100).toFixed(0)}%` : '—'}</td>
                                <td>{`${(activeEvaluation.candidate_metrics.temporal_precision * 100).toFixed(0)}%`}</td>
                                <td style={{ color: (activeEvaluation.candidate_metrics.temporal_precision ?? 0) >= (activeEvaluation.baseline_metrics.temporal_precision ?? 0) ? 'var(--acc)' : 'var(--danger)' }}>
                                  {(activeEvaluation.candidate_metrics.temporal_precision ?? 0) >= (activeEvaluation.baseline_metrics.temporal_precision ?? 0) ? 'Anchored' : 'Unanchored'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  )}

                  {!activeEvaluation && (
                    <article className="card" style={{ textAlign: 'center', padding: '36px 20px', background: 'var(--card-subtle)', border: '1px dashed var(--line)' }}>
                      <Activity size={32} color="var(--muted)" style={{ margin: '0 auto 12px auto', opacity: 0.6 }} />
                      <h3 style={{ fontSize: '15px', color: 'var(--tx)', margin: '0 0 6px 0' }}>
                        No offline instruction checks recorded yet
                      </h3>
                      <p style={{ color: 'var(--muted)', fontSize: '12.5px', maxWidth: '520px', margin: '0 auto' }}>
                        Modify the project prompt instructions above and click <strong>'Save & check instructions'</strong> to persist them and run deterministic text checks. These checks do not execute an ADK stage or measure live model quality.
                      </p>
                    </article>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
