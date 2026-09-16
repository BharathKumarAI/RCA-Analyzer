import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlaskConical,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  FileCode2,
  Database,
  ArrowUpRight,
  TrendingUp,
  AlertTriangle,
  Search,
  Plus,
  X,
  Info,
  Sliders,
  Award,
  Terminal,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  fetchConfig,
  fetchOptimization,
  fetchOptimizationDatasets,
  fetchOptimizations,
  fetchPrincipal,
  fetchSkills,
  registerOptimizationDataset,
  reviewOptimization,
} from '../services/api';
import { Principal, RuntimeConfig, SkillItem } from '../types/api';
import { ActivePage } from '../components/Sidebar';
import '../styles/optimization-studio.css';
import { Improvement } from './Improvement';
import { enqueueImprovement, undoOptimization } from '../services/improvement';

interface OptimizationPageProps {
  onNavigate?: (page: ActivePage) => void;
  onSelectPage?: (page: ActivePage) => void;
}

export interface DatasetItem {
  dataset_id: string;
  version: string;
  purpose: 'example' | 'benchmark';
  capability: string;
  description: string;
  train_cases?: number;
  holdout_cases?: number;
  content_hash?: string;
  created_at?: number;
  author_subject?: string;
}

export interface OptimizationRecord {
  is_active?: boolean;
  optimization_id: string;
  status: 'RUNNING' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'NO_IMPROVEMENT' | 'FAILED' | string;
  author_subject: string;
  created_at: number;
  reviewer_subject?: string | null;
  reviewed_at?: number | null;
  report_hash: string | null;
  dataset_hash?: string | null;
  reason: string | null;
  request: {
    dataset_id: string;
    dataset_version: string;
    target_kind: 'prompt' | 'skill';
    target_name: string;
  };
  report?: {
    mlflow_run_id?: string;
    mlflow_experiment_id?: string;
    prompt_versions?: { baseline: string; candidate: string };
    comparison: {
      eligible: boolean;
      quality: {
        baseline: number;
        candidate: number;
        delta?: number;
      };
      reasons?: string[];
    };
    diff?: string;
    usage?: {
      model_calls?: number;
      token_count?: number;
      latency_seconds?: number;
      [key: string]: unknown;
    };
    config?: Record<string, unknown>;
  };
}

type TabType = 'evaluations' | 'runner' | 'datasets' | 'policy' | 'improvement';

export const Optimization: React.FC<OptimizationPageProps> = () => {

  // Data states
  const [items, setItems] = useState<OptimizationRecord[]>([]);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [principal, setPrincipal] = useState<Principal | null>(null);

  // UI flow states
  const [activeTab, setActiveTab] = useState<TabType>(() => new URLSearchParams(window.location.search).get('tab') === 'improvement' ? 'improvement' : 'evaluations');
  const selectTab = (next: TabType) => { if (next === activeTab || window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) setActiveTab(next); };
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [detail, setDetail] = useState<OptimizationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Run Wizard states
  const [targetKind, setTargetKind] = useState<'prompt' | 'skill'>('prompt');
  const [targetName, setTargetName] = useState('');
  const [selectedDatasetKey, setSelectedDatasetKey] = useState('');

  // Register Dataset Modal state
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const defaultDatasetJSON = JSON.stringify({
    id: '', version: '', purpose: 'benchmark', capability: '', description: '',
    train: [], holdout: [],
  }, null, 2);
  const [datasetText, setDatasetText] = useState(defaultDatasetJSON);
  const [datasetJsonValid, setDatasetJsonValid] = useState<boolean>(true);
  const [datasetJsonStats, setDatasetJsonStats] = useState<{ train: number; holdout: number; id: string } | null>(null);

  // Review state
  const [reviewReason, setReviewReason] = useState('');
  const queuedRequest = useRef<{ fingerprint: string; key: string } | null>(null);

  // Validate dataset JSON live
  useEffect(() => {
    try {
      const parsed = JSON.parse(datasetText);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Array.isArray(parsed.train) &&
        Array.isArray(parsed.holdout) &&
        typeof parsed.id === 'string'
      ) {
        setDatasetJsonValid(true);
        setDatasetJsonStats({
          train: parsed.train.length,
          holdout: parsed.holdout.length,
          id: parsed.id,
        });
      } else {
        setDatasetJsonValid(false);
        setDatasetJsonStats(null);
      }
    } catch {
      setDatasetJsonValid(false);
      setDatasetJsonStats(null);
    }
  }, [datasetText]);

  // Load all authentic live backend data
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [records, availableDatasets, runtimeConfig, skillsList, userPrincipal] = await Promise.all([
        fetchOptimizations(),
        fetchOptimizationDatasets() as Promise<DatasetItem[]>,
        fetchConfig().catch(() => null),
        fetchSkills().catch(() => [] as SkillItem[]),
        fetchPrincipal().catch(() => null),
      ]);

      setItems(records as OptimizationRecord[]);
      setDatasets(availableDatasets || []);
      setConfig(runtimeConfig);
      setSkills(skillsList || []);
      setPrincipal(userPrincipal);

      // Default selected dataset key if not already selected
      if (!selectedDatasetKey && availableDatasets?.length > 0) {
        const first = availableDatasets[0];
        setSelectedDatasetKey(`${first.dataset_id}@${first.version}`);
      }

      // Default target name if not selected
      if (!targetName && runtimeConfig?.model_profiles?.stages) {
        const stageNames = Object.keys(runtimeConfig.model_profiles.stages);
        if (stageNames.length > 0) {
          setTargetName(stageNames[0]);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load optimization telemetry.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Available prompt stages from live runtime config
  const promptStages = useMemo(() => {
    if (!config?.model_profiles?.stages) return [];
    return Object.keys(config.model_profiles.stages);
  }, [config]);

  // Filtered optimizations
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch =
        !search.trim() ||
        item.request?.target_name?.toLowerCase().includes(search.toLowerCase()) ||
        item.request?.dataset_id?.toLowerCase().includes(search.toLowerCase()) ||
        item.author_subject?.toLowerCase().includes(search.toLowerCase()) ||
        item.optimization_id?.toLowerCase().includes(search.toLowerCase());

      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [items, search, statusFilter]);

  // Selected dataset object for the runner
  const activeSelectedDataset = useMemo(() => {
    return datasets.find(d => `${d.dataset_id}@${d.version}` === selectedDatasetKey);
  }, [datasets, selectedDatasetKey]);

  // Summary KPIs
  const kpis = useMemo(() => {
    const total = items.length;
    const pending = items.filter(i => i.status === 'PENDING_APPROVAL').length;
    const approved = items.filter(i => i.is_active === true).length;
    const datasetCount = datasets.length;
    const minQualityGain = config?.optimization?.min_quality_gain ?? 0.02;
    return { total, pending, approved, datasetCount, minQualityGain };
  }, [items, datasets, config]);

  // Run new optimization evaluation
  const handleRunEvaluation = async () => {
    if (!activeSelectedDataset || !targetName.trim()) {
      setError('Please select a registered dataset and valid target.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = { kind: 'optimize' as const, optimization: {
        dataset_id: activeSelectedDataset.dataset_id,
        dataset_version: activeSelectedDataset.version,
        target_kind: targetKind,
        target_name: targetName.trim(),
      } };
      const fingerprint = JSON.stringify(payload);
      if (queuedRequest.current?.fingerprint !== fingerprint) queuedRequest.current = { fingerprint, key: crypto.randomUUID() };
      const job = await enqueueImprovement(payload, queuedRequest.current!.key);
      queuedRequest.current = null;
      setMessage(`Evaluation queued as ${job.job_id}. Follow progress in Continuous improvement.`);
      setDetail(null);
      selectTab('improvement');
      await loadData(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evaluation execution failed.');
    } finally {
      setBusy(false);
    }
  };

  // Inspect existing optimization
  const handleInspect = async (optimizationId: string) => {
    setBusy(true);
    setError(null);
    setReviewReason('');
    try {
      const fullRecord = (await fetchOptimization(optimizationId)) as OptimizationRecord;
      setDetail(fullRecord);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load evaluation report artifact.');
    } finally {
      setBusy(false);
    }
  };

  // Submit Governance Review (Approve / Reject)
  const handleReview = async (approve: boolean) => {
    if (!detail?.report_hash) {
      setError('Missing verified report hash for this optimization.');
      return;
    }
    if (!reviewReason.trim()) {
      setError('A bounded review justification reason is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await reviewOptimization(
        detail.optimization_id,
        approve,
        detail.report_hash,
        reviewReason.trim()
      );
      setDetail(updated as OptimizationRecord);
      setMessage(
        approve
          ? `Optimization ${detail.optimization_id} approved. Revised bundle is now active in production scope.`
          : `Optimization ${detail.optimization_id} rejected.`
      );
      setReviewReason('');
      await loadData(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to complete governance review.');
    } finally {
      setBusy(false);
    }
  };

  // Register new immutable dataset version
  const handleRestore = async (action: 'rollback' | 'revoke') => {
    if (busy || !detail?.report_hash || !reviewReason.trim()) return;
    setBusy(true); setError(null);
    try {
      const updated = await undoOptimization(detail.optimization_id, action, detail.report_hash, reviewReason.trim());
      setDetail(updated as OptimizationRecord); setReviewReason('');
      setMessage(action === 'rollback' ? 'Previous configuration restored. New investigations use the restored version.' : 'Optimization revoked. New investigations use the configured baseline.');
      await loadData(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Restoration failed. Refresh the report and retry.'); }
    finally { setBusy(false); }
  };

  // Register new immutable dataset version
  const handleRegisterDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(datasetText);
      const registered = await registerOptimizationDataset(parsed);
      await loadData(true);
      setSelectedDatasetKey(`${registered.dataset_id}@${registered.version}`);
      setRegisterModalOpen(false);
      setMessage(`Curated dataset '${registered.dataset_id}' version ${registered.version} registered successfully.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to register dataset.');
    } finally {
      setBusy(false);
    }
  };

  // Helper to render diff lines with styling
  const renderDiffContent = (diffText: string) => {
    const lines = diffText.split('\n');
    return (
      <div className="opt-diff-view">
        {lines.map((line, idx) => {
          let lineType = 'context';
          let prefix = ' ';
          if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
            lineType = 'header';
          } else if (line.startsWith('+')) {
            lineType = 'addition';
            prefix = '+';
          } else if (line.startsWith('-')) {
            lineType = 'deletion';
            prefix = '-';
          }

          return (
            <div key={idx} className={`opt-diff-line ${lineType}`}>
              <span className="opt-diff-prefix">{prefix}</span>
              <span className="opt-diff-text">{line.replace(/^[+\- ]/, '')}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // Check if current user authored the inspected item
  const isAuthorOfDetail = detail && principal && detail.author_subject === principal.subject;
  const isAdminUser = principal?.roles?.some(
    r => r === 'PLATFORM_ADMIN' || r === 'PROJECT_OWNER' || (r as unknown as string) === 'admin'
  );

  return (
    <div className="view-container">
      <div className="optimization-studio">
        {/* Standard Hero Banner */}
        <section className="hero-banner">
          <div className="hero-main">
            <h1 className="hero-title">
              <FlaskConical size={22} color="var(--acc)" />
              Optimization <span>Studio</span>
            </h1>
            <p className="hero-lede">
              Offline replay evaluation, prompt & skill tuning, and two-person governance review.
              Offline comparisons evaluate candidate instructions against immutable baseline datasets before production activation.
            </p>
            <div className="hero-meta-strip">
              <span className="hero-stat-chip highlight">
                <FlaskConical size={12} /> <b>{items.length}</b> Replays Evaluated
              </span>
              <span className="hero-stat-chip">
                <span className="dot pulse" /> MLflow Metric Validation
              </span>
              <span className="hero-stat-chip">
                Dual-Custody Approval Required
              </span>
            </div>
          </div>
          <div className="hero-actions">
            <div className="hero-actions-row">
              <button
                className="btn btn-secondary"
                onClick={() => void loadData()}
                disabled={busy || loading}
                title="Refresh telemetry"
              >
                <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  selectTab('runner');
                  setDetail(null);
                }}
                disabled={busy}
              >
                <Play size={13} /> New Evaluation
              </button>
            </div>
          </div>
        </section>

        {/* Feedback notices */}
        {error && (
          <NotificationBanner
            type="error"
            message={error}
            onClose={() => setError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        {message && (
          <NotificationBanner
            type="success"
            message={message}
            onClose={() => setMessage(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Live KPI Metric Cards */}
        <div className="opt-kpi-grid">
          <div className="opt-kpi-card">
            <div className="opt-kpi-icon-wrap">
              <FlaskConical size={20} />
            </div>
            <div className="opt-kpi-content">
              <span className="opt-kpi-label">Recorded Runs</span>
              <div className="opt-kpi-val-row">
                <span className="opt-kpi-value">{loading ? '…' : kpis.total}</span>
                <span className="opt-kpi-sub">evaluations</span>
              </div>
            </div>
          </div>

          <div className="opt-kpi-card">
            <div className="opt-kpi-icon-wrap warning">
              <Clock size={20} />
            </div>
            <div className="opt-kpi-content">
              <span className="opt-kpi-label">Pending Reviews</span>
              <div className="opt-kpi-val-row">
                <span className="opt-kpi-value">{loading ? '…' : kpis.pending}</span>
                <span className="opt-kpi-sub">requiring 2nd admin</span>
              </div>
            </div>
          </div>

          <div className="opt-kpi-card">
            <div className="opt-kpi-icon-wrap success">
              <CheckCircle2 size={20} />
            </div>
            <div className="opt-kpi-content">
              <span className="opt-kpi-label">Approved & Active</span>
              <div className="opt-kpi-val-row">
                <span className="opt-kpi-value">{loading ? '…' : kpis.approved}</span>
                <span className="opt-kpi-sub">in production bundle</span>
              </div>
            </div>
          </div>

          <div className="opt-kpi-card">
            <div className="opt-kpi-icon-wrap neutral">
              <Database size={20} />
            </div>
            <div className="opt-kpi-content">
              <span className="opt-kpi-label">Curated Datasets</span>
              <div className="opt-kpi-val-row">
                <span className="opt-kpi-value">{loading ? '…' : kpis.datasetCount}</span>
                <span className="opt-kpi-sub">immutable versions</span>
              </div>
            </div>
          </div>

          <div className="opt-kpi-card">
            <div className="opt-kpi-icon-wrap neutral">
              <TrendingUp size={20} />
            </div>
            <div className="opt-kpi-content">
              <span className="opt-kpi-label">Quality Gate</span>
              <div className="opt-kpi-val-row">
                <span className="opt-kpi-value">+{((kpis.minQualityGain) * 100).toFixed(0)}%</span>
                <span className="opt-kpi-sub">min quality delta</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-navigation tabs */}
        <div className="opt-nav-bar">
          <div className="opt-tabs-group">
            <button
              className={`opt-tab-btn ${activeTab === 'evaluations' ? 'active' : ''}`}
              onClick={() => {
                selectTab('evaluations');
              }}
            >
              <FlaskConical size={14} />
              Evaluations & History
              <span className="opt-tab-pill">{items.length}</span>
            </button>
            <button
              className={`opt-tab-btn ${activeTab === 'runner' ? 'active' : ''}`}
              onClick={() => {
                selectTab('runner');
                setDetail(null);
              }}
            >
              <Play size={14} />
              Run Evaluation
            </button>
            <button
              className={`opt-tab-btn ${activeTab === 'datasets' ? 'active' : ''}`}
              onClick={() => {
                selectTab('datasets');
                setDetail(null);
              }}
            >
              <Database size={14} />
              Dataset Registry
              <span className="opt-tab-pill">{datasets.length}</span>
            </button>
            <button
              className={`opt-tab-btn ${activeTab === 'policy' ? 'active' : ''}`}
              onClick={() => {
                selectTab('policy');
                setDetail(null);
              }}
            >
              <ShieldCheck size={14} />
              Governance & Policies
            </button>
            {isAdminUser && <button type="button" className={`opt-tab-btn ${activeTab === 'improvement' ? 'active' : ''}`} onClick={() => { selectTab('improvement'); setDetail(null); }}>Continuous improvement</button>}
          </div>

          {activeTab === 'datasets' && (
            <button
              className="btn btn-primary"
              onClick={() => setRegisterModalOpen(true)}
              disabled={busy}
            >
              <Plus size={14} /> Register Dataset
            </button>
          )}
        </div>

        {activeTab === 'improvement' && principal && isAdminUser && <Improvement principal={principal} datasets={datasets} promptNames={promptStages} skillNames={skills.map(skill => skill.id)} onDataset={() => void loadData(true)} onReport={id => { selectTab('evaluations'); void handleInspect(id); }} />}
        {/* TAB 1: Evaluations History */}
        {activeTab === 'evaluations' && (
          <>
            {/* Toolbar search and filters */}
            <div className="opt-toolbar">
              <div className="opt-search-box">
                <Search size={14} />
                <input
                  type="text"
                  className="opt-search-input"
                  placeholder="Filter by target, dataset, author, or run ID…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div className="opt-filter-chips">
                {(['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'NO_IMPROVEMENT', 'RUNNING', 'FAILED'] as const).map(
                  status => {
                    const count = status === 'ALL' ? items.length : items.filter(i => i.status === status).length;
                    return (
                      <button
                        key={status}
                        className={`opt-filter-chip ${statusFilter === status ? 'active' : ''}`}
                        onClick={() => setStatusFilter(status)}
                      >
                        {status.replaceAll('_', ' ')}
                        <span style={{ opacity: 0.7 }}>({count})</span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Evaluations Table or Clean Zero State */}
            {items.length === 0 ? (
              <div className="opt-table-container" style={{ padding: '40px 24px' }}>
                <div className="opt-empty-state">
                  <FlaskConical size={42} color="var(--acc)" />
                  <p className="opt-empty-title">No Evaluations Recorded Yet</p>
                  <p className="opt-empty-desc">
                    Offline replay evaluations compare candidate model instructions against registered baseline datasets to measure quality gains before activating changes in production.
                  </p>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button className="btn btn-primary" onClick={() => selectTab('runner')}>
                      <Play size={14} /> Configure & Run Evaluation
                    </button>
                    <button className="btn btn-secondary" onClick={() => selectTab('datasets')}>
                      <Database size={14} /> View Curated Datasets
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="opt-table-container">
                <table className="opt-table">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Kind</th>
                      <th>Dataset Version</th>
                      <th>Status</th>
                      <th>Author</th>
                      <th>Created</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map(item => {
                      const isSelected = detail?.optimization_id === item.optimization_id;
                      const isCurrentUserAuthor = principal && item.author_subject === principal.subject;

                      return (
                        <tr
                          key={item.optimization_id}
                          className={isSelected ? 'selected' : ''}
                          onClick={() => void handleInspect(item.optimization_id)}
                        >
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <strong style={{ color: 'var(--tx)', fontFamily: 'var(--font-mono)' }}>
                                {item.request?.target_name}
                              </strong>
                              <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                                {item.optimization_id.slice(0, 16)}…
                              </span>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`opt-badge ${
                                item.request?.target_kind === 'prompt' ? 'target-prompt' : 'target-skill'
                              }`}
                            >
                              {item.request?.target_kind === 'prompt' ? 'Prompt Stage' : 'Skill'}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                              {item.request?.dataset_id} · <span style={{ color: 'var(--dim)' }}>v{item.request?.dataset_version}</span>
                            </span>
                          </td>
                          <td>
                            <span className={`opt-badge ${item.status.toLowerCase()}`}>
                              {item.status === 'PENDING_APPROVAL' && <Clock size={11} />}
                              {item.status === 'APPROVED' && <CheckCircle2 size={11} />}
                              {item.status === 'REJECTED' && <XCircle size={11} />}
                              {item.status === 'RUNNING' && <RefreshCw size={11} className="spin" />}
                              {item.status.replaceAll('_', ' ')}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12 }}>
                              {item.author_subject}
                              {isCurrentUserAuthor && (
                                <span style={{ marginLeft: 4, color: 'var(--acc)', fontSize: 11 }}>(you)</span>
                              )}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {new Date(item.created_at * 1000).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={e => {
                                e.stopPropagation();
                                void handleInspect(item.optimization_id);
                              }}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <div className="opt-empty-state">
                            <Search size={32} />
                            <p className="opt-empty-title">No matching evaluations</p>
                            <p className="opt-empty-desc">
                              No records match the current search query or filter.
                            </p>
                            <button
                              className="btn btn-secondary"
                              onClick={() => {
                                setSearch('');
                                setStatusFilter('ALL');
                              }}
                            >
                              Reset filters
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Deep Report Inspector */}
            {detail && (
              <section className="opt-inspector">
                <div className="opt-inspector-header">
                  <div className="opt-inspector-title">
                    <FlaskConical size={20} color="var(--acc)" />
                    <div>
                      <h2>
                        Evaluation Report: {detail.request?.target_name}{' '}
                        <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)' }}>
                          ({detail.request?.target_kind})
                        </span>
                      </h2>
                      <div className="opt-inspector-meta">
                        <span>ID: <code>{detail.optimization_id}</code></span>
                        <span>•</span>
                        <span>Dataset: <code>{detail.request?.dataset_id}@{detail.request?.dataset_version}</code></span>
                        <span>•</span>
                        <span>Author: <strong>{detail.author_subject}</strong></span>
                        {detail.report_hash && (
                          <>
                            <span>•</span>
                            <span>Report Hash: <code>{detail.report_hash.slice(0, 16)}…</code></span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`opt-badge ${detail.status.toLowerCase()}`}>
                      {detail.status.replaceAll('_', ' ')}
                    </span>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setDetail(null)}
                      title="Close Inspector"
                    >
                      <X size={14} /> Close
                    </button>
                  </div>
                </div>

                <div className="opt-inspector-body">
                  {/* Status explanation if reason recorded */}
                  {detail.reason && (
                    <div className="opt-feedback-banner info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Info size={16} />
                        <span><strong>Review Note:</strong> {detail.reason}</span>
                      </div>
                      {detail.reviewer_subject && (
                        <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                          Reviewed by {detail.reviewer_subject} at{' '}
                          {detail.reviewed_at ? new Date(detail.reviewed_at * 1000).toLocaleString() : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quality Score Breakdown */}
                  {detail.report ? (
                    <>
                      <div className="opt-comparison-grid">
                        <div className="opt-score-card">
                          <span className="opt-score-label">Baseline Quality</span>
                          <span className="opt-score-value">
                            {detail.report.comparison.quality.baseline.toFixed(3)}
                          </span>
                          <span className="opt-score-meta">Pre-optimization test score</span>
                        </div>

                        <div className="opt-score-card highlight">
                          <span className="opt-score-label">Candidate Quality</span>
                          <span className="opt-score-value" style={{ color: 'var(--acc)' }}>
                            {detail.report.comparison.quality.candidate.toFixed(3)}
                          </span>
                          <span className="opt-score-meta">Revised prompt test score</span>
                        </div>

                        <div className="opt-score-card">
                          <span className="opt-score-label">Quality Delta</span>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span
                              className="opt-score-value"
                              style={{
                                color:
                                  detail.report.comparison.quality.candidate >=
                                  detail.report.comparison.quality.baseline
                                    ? 'var(--acc3)'
                                    : 'var(--acc-rose)',
                              }}
                            >
                              {(
                                detail.report.comparison.quality.candidate -
                                detail.report.comparison.quality.baseline
                              ).toFixed(3)}
                            </span>
                            <span
                              className={`opt-delta-pill ${
                                detail.report.comparison.quality.candidate >=
                                detail.report.comparison.quality.baseline
                                  ? 'gain'
                                  : 'drop'
                              }`}
                            >
                              {(
                                ((detail.report.comparison.quality.candidate -
                                  detail.report.comparison.quality.baseline) /
                                  Math.max(0.001, detail.report.comparison.quality.baseline)) *
                                100
                              ).toFixed(1)}
                              %
                            </span>
                          </div>
                          <span className="opt-score-meta">Relative quality improvement</span>
                        </div>

                        <div className="opt-score-card">
                          <span className="opt-score-label">Eligibility Verdict</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            {detail.report.comparison.eligible ? (
                              <span className="opt-badge approved">
                                <CheckCircle2 size={13} /> Eligible for Production
                              </span>
                            ) : (
                              <span className="opt-badge rejected">
                                <XCircle size={13} /> Gate Not Satisfied
                              </span>
                            )}
                          </div>
                          <span className="opt-score-meta">
                            {detail.report.comparison.eligible
                              ? 'Meets configured gain & safety constraints'
                              : 'Candidate failed quality threshold checks'}
                          </span>
                        </div>
                      </div>

                      {/* Gate Reasons list */}
                      {detail.report.comparison.reasons && detail.report.comparison.reasons.length > 0 && (
                        <div className="opt-gate-checklist">
                          <strong style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>
                            Gate Evaluation Checks
                          </strong>
                          {detail.report.comparison.reasons.map((reason, idx) => (
                            <div
                              key={idx}
                              className={`opt-gate-item ${
                                detail.report?.comparison.eligible ? 'pass' : 'fail'
                              }`}
                            >
                              {detail.report?.comparison.eligible ? (
                                <CheckCircle2 size={15} />
                              ) : (
                                <AlertTriangle size={15} />
                              )}
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Git Unified Diff Viewer */}
                      {detail.report.diff ? (
                        <div className="opt-diff-container">
                          <div className="opt-diff-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <FileCode2 size={15} />
                              <span>Instruction Revision Diff (Baseline → Candidate)</span>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                              Target: {detail.request?.target_name}
                            </span>
                          </div>
                          {renderDiffContent(detail.report.diff)}
                        </div>
                      ) : (
                        <div className="opt-feedback-banner info">
                          <Info size={15} />
                          <span>No instruction text diff was generated for this evaluation run.</span>
                        </div>
                      )}

                      {/* MLflow & Telemetry snapshot */}
                      {detail.report.mlflow_run_id && (
                        <div className="opt-limits-callout">
                          <Terminal size={18} />
                          <div>
                            <strong>MLflow Telemetry Snapshot:</strong> Run ID{' '}
                            <code>{detail.report.mlflow_run_id}</code> in Experiment{' '}
                            <code>{detail.report.mlflow_experiment_id || 'rca-optimization'}</code>.
                            {detail.report.usage && (
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--dim)' }}>
                                Budget consumption: {detail.report.usage.model_calls ?? 0} model calls,{' '}
                                {detail.report.usage.token_count ?? 0} tokens used.
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="opt-empty-state" style={{ padding: 24 }}>
                      <AlertTriangle size={32} />
                      <p className="opt-empty-title">No comparison report artifact</p>
                      <p className="opt-empty-desc">
                        This evaluation record does not have an attached comparison artifact (it may have encountered an error or is still pending completion).
                      </p>
                    </div>
                  )}

                  {/* Two-Person Governance Review Box */}
                  {detail.is_active && <section className="opt-governance-box"><h3>Restore or revoke active changes</h3><p>Restore the previous approved configuration, or revoke this optimization to use the configured baseline. The server checks that this exact report is still active.</p>{isAuthorOfDetail ? <p>A different administrator must review restoration.</p> : isAdminUser && <><label htmlFor="restore-reason">Reason</label><textarea id="restore-reason" className="opt-textarea" rows={3} maxLength={2000} value={reviewReason} onChange={event => setReviewReason(event.target.value)} disabled={busy} /><div className="knowledge-actions"><button type="button" className="btn btn-secondary" disabled={busy || !reviewReason.trim()} onClick={() => void handleRestore('rollback')}>Restore previous configuration</button><button type="button" className="btn btn-secondary" disabled={busy || !reviewReason.trim()} onClick={() => void handleRestore('revoke')}>Revoke optimization</button></div></>}</section>}
                  {detail.status === 'PENDING_APPROVAL' && (
                    <div className="opt-review-card">
                      <div className="opt-review-header">
                        <ShieldCheck size={18} color="var(--acc)" />
                        <h3>Administrator Governance Review</h3>
                      </div>

                      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
                        This candidate revision passed the offline evaluation gate. Before changes can be activated in production, a same-scope administrator other than the author must inspect the exact report hash and provide a review rationale.
                      </p>

                      {isAuthorOfDetail ? (
                        <div className="opt-two-person-warning">
                          <AlertTriangle size={18} />
                          <div>
                            <strong>Author Review Restriction (Two-Person Rule):</strong>
                            <p style={{ margin: '3px 0 0', lineHeight: 1.4 }}>
                              You are authenticated as <code>{principal?.subject}</code>, the author of this optimization run. In accordance with RCA assist security policy, authors cannot review their own revisions. Another authorized administrator must approve or reject this candidate.
                            </p>
                          </div>
                        </div>
                      ) : !isAdminUser ? (
                        <div className="opt-two-person-warning">
                          <AlertTriangle size={18} />
                          <div>
                            <strong>Admin Role Required:</strong>
                            <p style={{ margin: '3px 0 0', lineHeight: 1.4 }}>
                              Your principal subject does not have administrator privileges required to approve production prompt changes.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div className="opt-form-group">
                            <label htmlFor="review-reason">
                              Review Justification <span className="label-hint">Required for audit trail</span>
                            </label>
                            <textarea
                              id="review-reason"
                              className="opt-textarea"
                              rows={3}
                              placeholder="Document why this revised instruction is safe, verified, and ready for production activation…"
                              value={reviewReason}
                              onChange={e => setReviewReason(e.target.value)}
                              disabled={busy}
                              maxLength={2000}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                              className="btn btn-primary"
                              disabled={busy || !reviewReason.trim() || !detail.report_hash}
                              onClick={() => void handleReview(true)}
                            >
                              <CheckCircle2 size={14} /> {busy ? 'Processing…' : 'Approve & Activate in Production'}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy || !reviewReason.trim() || !detail.report_hash}
                              onClick={() => void handleReview(false)}
                            >
                              <XCircle size={14} /> Reject Revision
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {/* TAB 2: Run Evaluation (Interactive Wizard) */}
        {activeTab === 'runner' && (
          <div className="opt-wizard-panel">
            <div className="opt-wizard-header">
              <h2>
                <Play size={18} color="var(--acc)" /> Configure Replay Evaluation
              </h2>
              <p>
                Run offline multi-round replay evaluation comparing baseline performance against training holdouts.
              </p>
            </div>

            <div className="opt-form-grid">
              {/* Dataset Selection */}
              <div className="opt-form-group">
                <label>
                  Registered Curated Dataset <span className="label-hint">Immutable ground truth</span>
                </label>
                <select
                  className="opt-select"
                  value={selectedDatasetKey}
                  onChange={e => setSelectedDatasetKey(e.target.value)}
                  disabled={busy}
                >
                  <option value="">-- Choose a dataset --</option>
                  {datasets.map(d => (
                    <option key={`${d.dataset_id}@${d.version}`} value={`${d.dataset_id}@${d.version}`}>
                      {d.dataset_id} (v{d.version}) • {d.purpose} • {d.capability}
                    </option>
                  ))}
                </select>
                {activeSelectedDataset && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                    Capability: <code>{activeSelectedDataset.capability}</code> • Train:{' '}
                    <strong>{activeSelectedDataset.train_cases ?? 0}</strong> • Holdout:{' '}
                    <strong>{activeSelectedDataset.holdout_cases ?? 0}</strong>
                  </div>
                )}
              </div>

              {/* Target Kind Toggle */}
              <div className="opt-form-group">
                <label>
                  Target Asset Type <span className="label-hint">Optimization scope</span>
                </label>
                <div className="opt-kind-toggle">
                  <button
                    type="button"
                    className={`opt-kind-btn ${targetKind === 'prompt' ? 'active' : ''}`}
                    onClick={() => {
                      setTargetKind('prompt');
                      if (promptStages.length > 0) setTargetName(promptStages[0]);
                    }}
                  >
                    <strong>Prompt Stage</strong>
                    <span>System instruction stage</span>
                  </button>
                  <button
                    type="button"
                    className={`opt-kind-btn ${targetKind === 'skill' ? 'active' : ''}`}
                    onClick={() => {
                      setTargetKind('skill');
                      if (skills.length > 0) setTargetName(skills[0].id);
                    }}
                  >
                    <strong>Specialist Skill</strong>
                    <span>Domain skill instruction</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Target Name Selection */}
            <div className="opt-form-group">
              <label>
                Target Identifier <span className="label-hint">Select or type exact name</span>
              </label>
              <input
                type="text"
                className="opt-input"
                placeholder={targetKind === 'prompt' ? 'e.g. synthesis, incident_triage' : 'e.g. ticket-review, gitlab-review'}
                value={targetName}
                onChange={e => setTargetName(e.target.value)}
                disabled={busy}
              />

              {/* Quick Suggestion Chips */}
              <div className="opt-target-chips">
                <span style={{ fontSize: 11, color: 'var(--dim)', alignSelf: 'center', marginRight: 4 }}>
                  Suggestions:
                </span>
                {targetKind === 'prompt' &&
                  promptStages.map(stage => (
                    <button
                      key={stage}
                      type="button"
                      className={`opt-target-chip ${targetName === stage ? 'selected' : ''}`}
                      onClick={() => setTargetName(stage)}
                    >
                      {stage}
                    </button>
                  ))}
                {targetKind === 'skill' &&
                  skills.slice(0, 8).map(skill => (
                    <button
                      key={skill.id}
                      type="button"
                      className={`opt-target-chip ${targetName === skill.id ? 'selected' : ''}`}
                      onClick={() => setTargetName(skill.id)}
                    >
                      {skill.id}
                    </button>
                  ))}
              </div>
            </div>

            {/* Platform limits & gate notice */}
            <div className="opt-limits-callout">
              <ShieldCheck size={20} />
              <div>
                <strong>ADK Gate Parameters:</strong> Offline evaluation will execute against training cases with{' '}
                <code>{config?.optimization?.repeats ?? 2}</code> repetitions.
                Candidates must achieve at least a{' '}
                <strong>+{(kpis.minQualityGain * 100).toFixed(0)}%</strong> quality gain over baseline without
                dropping individual holdout case quality by more than{' '}
                <strong>{((config?.optimization?.max_case_quality_drop ?? 0.1) * 100).toFixed(0)}%</strong>.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <button
                className="btn btn-primary"
                disabled={busy || !selectedDatasetKey || !targetName.trim()}
                onClick={() => void handleRunEvaluation()}
              >
                <Play size={14} /> {busy ? 'Running Evaluation Replay…' : 'Run Offline Evaluation'}
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => selectTab('evaluations')}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: Curated Dataset Registry */}
        {activeTab === 'datasets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="opt-datasets-grid">
              {datasets.map(dataset => (
                <div key={`${dataset.dataset_id}@${dataset.version}`} className="opt-dataset-card">
                  <div>
                    <div className="opt-dataset-card-header">
                      <h3 className="opt-dataset-title">
                        <Database size={16} color="var(--acc)" />
                        {dataset.dataset_id}
                      </h3>
                      <span className="opt-dataset-version">v{dataset.version}</span>
                    </div>
                    <p className="opt-dataset-desc">{dataset.description}</p>
                  </div>

                  <div className="opt-dataset-stats-strip">
                    <div className="opt-dataset-stat-item">
                      <span>Capability:</span>
                      <strong>{dataset.capability}</strong>
                    </div>
                    <div className="opt-dataset-stat-item">
                      <span>Train:</span>
                      <strong>{dataset.train_cases ?? 'N/A'}</strong>
                    </div>
                    <div className="opt-dataset-stat-item">
                      <span>Holdout:</span>
                      <strong>{dataset.holdout_cases ?? 'N/A'}</strong>
                    </div>
                  </div>

                  <div className="opt-dataset-footer">
                    <span>Author: {dataset.author_subject || 'system'}</span>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => {
                        setSelectedDatasetKey(`${dataset.dataset_id}@${dataset.version}`);
                        selectTab('runner');
                      }}
                    >
                      Use in Replay <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
              ))}

              {!datasets.length && (
                <div className="opt-empty-state" style={{ gridColumn: '1 / -1' }}>
                  <Database size={36} />
                  <p className="opt-empty-title">No Curated Datasets Found</p>
                  <p className="opt-empty-desc">
                    No offline datasets are registered in this project yet. Register a validated dataset JSON to enable offline tuning.
                  </p>
                  <button className="btn btn-primary" onClick={() => setRegisterModalOpen(true)}>
                    <Plus size={14} /> Register Dataset
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Governance & Policies */}
        {activeTab === 'policy' && (
          <div className="opt-policy-grid">
            <div className="opt-policy-card">
              <h3>
                <ShieldCheck size={18} color="var(--acc)" />
                Two-Person Review Contract
              </h3>
              <p>
                To safeguard the agent system against unauthorized or unverified prompt changes, optimization runs enforce strict two-person separation of duties.
              </p>
              <div className="opt-policy-spec-list">
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Author Self-Approval:</span>
                  <span className="opt-policy-spec-val" style={{ color: 'var(--acc-rose)' }}>Forbidden</span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Reviewer Scope:</span>
                  <span className="opt-policy-spec-val">Same Tenant / Project Scope</span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Verification Hash:</span>
                  <span className="opt-policy-spec-val">Exact SHA-256 Report Match</span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Review Rationale:</span>
                  <span className="opt-policy-spec-val">Mandatory Audit Logged</span>
                </div>
              </div>
            </div>

            <div className="opt-policy-card">
              <h3>
                <Sliders size={18} color="var(--acc)" />
                Quality & Safety Gates
              </h3>
              <p>
                Candidates must satisfy automated metric gates before being flagged as eligible for human review:
              </p>
              <div className="opt-policy-spec-list">
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Min Quality Gain:</span>
                  <span className="opt-policy-spec-val">
                    +{((config?.optimization?.min_quality_gain ?? 0.02) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Min Candidate Quality:</span>
                  <span className="opt-policy-spec-val">
                    {(config?.optimization?.min_candidate_quality ?? 0.8).toFixed(2)}
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Max Holdout Drop:</span>
                  <span className="opt-policy-spec-val">
                    {((config?.optimization?.max_case_quality_drop ?? 0.1) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Max Latency Ratio:</span>
                  <span className="opt-policy-spec-val">
                    {(config?.optimization?.max_latency_ratio ?? 1.5).toFixed(1)}x
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Max Token Ratio:</span>
                  <span className="opt-policy-spec-val">
                    {(config?.optimization?.max_token_ratio ?? 1.25).toFixed(2)}x
                  </span>
                </div>
              </div>
            </div>

            <div className="opt-policy-card">
              <h3>
                <Award size={18} color="var(--acc)" />
                Execution Boundaries
              </h3>
              <p>
                Offline evaluations run in sandboxed replay environments without executing live mutations:
              </p>
              <div className="opt-policy-spec-list">
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Model Call Budget:</span>
                  <span className="opt-policy-spec-val">
                    {config?.optimization?.max_model_calls ?? 256} calls
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Run Timeout:</span>
                  <span className="opt-policy-spec-val">
                    {config?.optimization?.timeout_seconds ?? 1800}s
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Reflection Stage:</span>
                  <span className="opt-policy-spec-val">
                    {config?.optimization?.reflection_stage ?? 'synthesis'}
                  </span>
                </div>
                <div className="opt-policy-spec-row">
                  <span className="opt-policy-spec-label">Judge Stage:</span>
                  <span className="opt-policy-spec-val">
                    {config?.optimization?.judge_stage ?? 'synthesis'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dataset Registration Modal */}
        {registerModalOpen && (
          <div className="opt-modal-backdrop" onClick={() => setRegisterModalOpen(false)}>
            <div className="opt-modal" onClick={e => e.stopPropagation()}>
              <div className="opt-modal-header">
                <h2>
                  <Database size={18} color="var(--acc)" /> Register Curated Dataset Version
                </h2>
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)' }}
                  onClick={() => setRegisterModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleRegisterDataset}>
                <div className="opt-modal-body">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      Versions are immutable. Training and holdout splits must each contain unique cases.
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      onClick={() => setDatasetText(defaultDatasetJSON)}
                    >
                      Reset to Template
                    </button>
                  </div>

                  <div className="opt-form-group">
                    <label htmlFor="dataset-json">
                      Dataset JSON Definition{' '}
                      <span className="label-hint">
                        {datasetJsonValid && datasetJsonStats ? (
                          <span style={{ color: 'var(--acc3)', fontWeight: 600 }}>
                            ✓ Valid JSON (ID: {datasetJsonStats.id} • Train: {datasetJsonStats.train} • Holdout:{' '}
                            {datasetJsonStats.holdout})
                          </span>
                        ) : (
                          <span style={{ color: 'var(--acc-rose)', fontWeight: 600 }}>
                            ⚠ Invalid JSON format
                          </span>
                        )}
                      </span>
                    </label>
                    <textarea
                      id="dataset-json"
                      className="opt-textarea"
                      rows={14}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      value={datasetText}
                      onChange={e => setDatasetText(e.target.value)}
                      required
                      maxLength={2097152}
                      disabled={busy}
                    />
                  </div>
                </div>

                <div className="opt-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => setRegisterModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={busy || !datasetJsonValid || !datasetText.trim()}
                  >
                    {busy ? 'Registering…' : 'Register Version'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
