import React, { useState } from 'react';
import {
  FlaskConical,
  BarChart2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  TrendingUp,
  FileCode,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Database,
  Check,
  Layers,
  Sparkles
} from 'lucide-react';

interface EvaluationContract {
  id: string;
  name: string;
  description: string;
  status: 'PASSED' | 'FAILED';
  baseline_score: number;
  candidate_score: number;
  latency_ms: number;
  latency_ratio: number;
  token_ratio: number;
  failure_reason?: string;
}

const EVAL_CONTRACTS: EvaluationContract[] = [
  {
    id: 'contract_empty_ticket',
    name: 'Empty Ticket Description & Missing Anchor',
    description: 'Verifies fallback to transaction headers and trace error timestamps when ticket summary lacks explicit incident time.',
    status: 'PASSED',
    baseline_score: 0.88,
    candidate_score: 0.94,
    latency_ms: 1240,
    latency_ratio: 0.98,
    token_ratio: 1.02
  },
  {
    id: 'contract_db_not_attached',
    name: 'Database Connector Unattached / Disabled',
    description: 'Guarantees the agent never attempts SQL emission or database tool calls when database_rca capability is unattached.',
    status: 'PASSED',
    baseline_score: 1.00,
    candidate_score: 1.00,
    latency_ms: 820,
    latency_ratio: 0.95,
    token_ratio: 0.96
  },
  {
    id: 'contract_jira_down',
    name: 'Jira Provider Outage / Degraded Health',
    description: 'Validates that triage stage records structured limitation and gracefully routes available log search without fatal pipeline abort.',
    status: 'PASSED',
    baseline_score: 0.85,
    candidate_score: 0.91,
    latency_ms: 1450,
    latency_ratio: 1.05,
    token_ratio: 1.04
  },
  {
    id: 'contract_no_logs',
    name: 'Zero Log Records in Splunk Query Window',
    description: 'Ensures synthesis produces PARTIAL terminal status with explicit insufficient log evidence note rather than hallucinating log causes.',
    status: 'PASSED',
    baseline_score: 0.92,
    candidate_score: 0.96,
    latency_ms: 1100,
    latency_ratio: 1.01,
    token_ratio: 0.99
  }
];

export const Optimization: React.FC = () => {
  const [contracts] = useState<EvaluationContract[]>(EVAL_CONTRACTS);
  const [selectedContract, setSelectedContract] = useState<EvaluationContract>(EVAL_CONTRACTS[0]);
  const [evaluating, setEvaluating] = useState(false);
  const [evalProgress, setEvalProgress] = useState(100);
  const [promoted, setPromoted] = useState(false);

  const avgBaseline = (contracts.reduce((acc, c) => acc + c.baseline_score, 0) / contracts.length).toFixed(3);
  const avgCandidate = (contracts.reduce((acc, c) => acc + c.candidate_score, 0) / contracts.length).toFixed(3);
  const qualityGain = (parseFloat(avgCandidate) - parseFloat(avgBaseline)).toFixed(3);

  const handleRunEvaluation = () => {
    setEvaluating(true);
    setEvalProgress(10);
    const interval = setInterval(() => {
      setEvalProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setEvaluating(false);
          return 100;
        }
        return prev + 30;
      });
    }, 300);
  };

  const handlePromote = () => {
    setPromoted(true);
    setTimeout(() => setPromoted(false), 2000);
  };

  return (
    <div className="view-container">
      {/* Header Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Optimization <span>Studio</span> & MLflow Evaluation
          </h1>
          <p className="hero-lede">
            Isolated replay, MLflow experiment tracking, and rigorous offline evaluation gates comparing candidate stage instructions against active baselines.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Tracking Backend:</b> PostgreSQL MLflow Schema
            </span>
            <span className="hero-stat-chip">
              <b>Eval Contracts:</b> 4 Active Offline Contracts
            </span>
            <span className="hero-stat-chip">
              <b>Quality Gain Threshold:</b> &ge; +0.02
            </span>
            <span className="hero-stat-chip">
              <b>Artifact Store:</b> framework/optimizations/objects/
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRunEvaluation}
            disabled={evaluating}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Play size={13} className={evaluating ? 'pulse' : ''} />
            {evaluating ? `Running Replay (${evalProgress}%)...` : 'Run Offline Evaluation'}
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePromote}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {promoted ? <Check size={14} /> : <ShieldCheck size={14} />}
            {promoted ? 'Promoted to Active' : 'Promote Candidate (Admin)'}
          </button>
        </div>
      </section>

      {/* KPI Cards: Quality Gain, Latency, Token Ratios, Gate Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            Quality Score Gain
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#10b981' }}>+{qualityGain}</span>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>({avgBaseline} &rarr; {avgCandidate})</span>
          </div>
          <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
            <CheckCircle2 size={12} /> Exceeds minimum threshold (&ge; 0.02)
          </span>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            Max Latency Ratio
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)' }}>1.05x</span>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Max gate: 1.50x</span>
          </div>
          <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
            <CheckCircle2 size={12} /> Within latency budget
          </span>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            Max Token Ratio
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)' }}>1.04x</span>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Max gate: 1.25x</span>
          </div>
          <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
            <CheckCircle2 size={12} /> Token economy preserved
          </span>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            Promotion Gate Status
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: 800, color: '#10b981' }}>ELIGIBLE</span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
            All 4 offline contracts validated
          </span>
        </div>
      </div>

      {/* Main Studio View: Contract List + Deep Evaluation Inspector */}
      <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left: Contracts List */}
        <div className="card" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', color: 'var(--muted)' }}>
            Offline Evaluation Contracts
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {contracts.map(c => {
              const isSelected = selectedContract.id === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedContract(c)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: isSelected ? '1px solid var(--acc)' : '1px solid var(--line)',
                    background: isSelected ? 'var(--acc-subtle)' : 'var(--card)',
                    transition: 'all .15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                      {c.name}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(16,185,129,0.15)',
                      color: '#10b981'
                    }}>
                      PASSED
                    </span>
                  </div>

                  <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 8px 0', lineHeight: 1.4 }}>
                    {c.description}
                  </p>

                  <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--muted)' }}>
                    <span>Baseline: <b>{c.baseline_score.toFixed(2)}</b></span>
                    <span>&rarr;</span>
                    <span style={{ color: '#10b981' }}>Candidate: <b>{c.candidate_score.toFixed(2)}</b></span>
                    <span>•</span>
                    <span>{c.latency_ms}ms</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* MLflow Connection Badge */}
          <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Database size={13} style={{ color: 'var(--acc)' }} />
              <span style={{ fontSize: '11px', fontWeight: 700 }}>MLflow Tracking Backend</span>
            </div>
            <code style={{ fontSize: '10px', display: 'block', color: 'var(--muted)', wordBreak: 'break-all' }}>
              postgresql+psycopg://rca_app:***@127.0.0.1:5432/rca_db?options=-csearch_path%3Dmlflow
            </code>
          </div>
        </div>

        {/* Right: Selected Contract Deep Inspector & Diff */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <FlaskConical size={18} style={{ color: 'var(--acc)' }} />
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{selectedContract.name}</h2>
                  <span style={{ fontSize: '11px', background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                    {selectedContract.status}
                  </span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>{selectedContract.description}</p>
              </div>

              <code style={{ fontSize: '11px', background: 'var(--bg)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--line)' }}>
                {selectedContract.id}
              </code>
            </div>

            {/* Metrics Breakdown Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Quality Metric</span>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>
                  {selectedContract.baseline_score.toFixed(2)} &rarr; {selectedContract.candidate_score.toFixed(2)}
                </span>
                <span style={{ fontSize: '10px', color: '#10b981', display: 'block', marginTop: '2px' }}>
                  +{(selectedContract.candidate_score - selectedContract.baseline_score).toFixed(2)} delta
                </span>
              </div>

              <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Execution Latency</span>
                <span style={{ fontSize: '16px', fontWeight: 700 }}>{selectedContract.latency_ms} ms</span>
                <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
                  {selectedContract.latency_ratio}x of baseline
                </span>
              </div>

              <div style={{ background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Token Consumption</span>
                <span style={{ fontSize: '16px', fontWeight: 700 }}>{selectedContract.token_ratio}x</span>
                <span style={{ fontSize: '10px', color: '#10b981', display: 'block', marginTop: '2px' }}>
                  Within 1.25x gate
                </span>
              </div>
            </div>

            {/* Prompt Instruction Diff */}
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Prompt Candidate Instruction Delta (Diff)
              </h3>
              <div style={{
                background: 'var(--bg)',
                padding: '14px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                fontSize: '11px',
                fontFamily: 'monospace',
                lineHeight: 1.6
              }}>
                <div style={{ color: 'var(--muted)' }}># Active Stage Instruction: synthesis</div>
                <div style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: '3px' }}>
                  - Synthesize evidence items into plain markdown conclusions without strict ID provenance check.
                </div>
                <div style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: '3px', marginTop: '4px' }}>
                  + Synthesize verified root cause findings, validate citations against durable evidence store, and declare SUCCEEDED or PARTIAL with explicit limitations.
                </div>
              </div>
            </div>

            {/* Immutable Artifact Storage Callout */}
            <div style={{ background: 'linear-gradient(90deg, rgba(59,130,246,0.06), transparent)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
              <h4 style={{ fontSize: '12px', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--text)' }}>
                Immutable Evaluation Artifact Storage Location
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                Evaluated optimization datasets and verified reports are written as immutable canonical JSON objects under:
              </p>
              <code style={{ fontSize: '11px', background: 'var(--bg)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--line)', display: 'block' }}>
                blob_local/projects/&lt;tenant-key&gt;/&lt;project-key&gt;/artifacts/framework/optimizations/objects/&lt;sha256&gt;.yaml
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
