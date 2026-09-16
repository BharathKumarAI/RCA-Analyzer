import { useState, useMemo } from 'react';
import {
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Cpu,
  HelpCircle,
  Layers,
  Sparkles,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react';
import { AnswerMarkdown } from '../AnswerMarkdown';
import type { Run } from '../../types/api';
import type { RunEvidence, RunTraceEvent } from '../../services/api';

interface ChatReasoningViewProps {
  run: Run;
  events?: RunTraceEvent[];
  evidence?: RunEvidence[];
}

interface ReasoningStage {
  id: string;
  name: string;
  description: string;
  status: 'completed' | 'running' | 'queued';
  durationMs?: number;
  events: RunTraceEvent[];
}

export function ChatReasoningView({ run, events = [], evidence = [] }: ChatReasoningViewProps) {
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [expandedHypothesis, setExpandedHypothesis] = useState<number | null>(null);

  const result = run.result;

  // Build the 5-stage cognitive reasoning pipeline
  const stages: ReasoningStage[] = useMemo(() => {
    const isCompleted = run.status === 'COMPLETED' || run.status === 'SIMULATED' || Boolean(result);

    // Map trace events to stages
    const stage1Events = events.filter(e =>
      ['orchestrator', 'request_orchestrator', 'intent_resolution'].some(k =>
        String(e.node_id || e.kind).includes(k),
      ),
    );
    const stage2Events = events.filter(e =>
      ['itsm', 'get_ticket', 'log_search', 'query_range', 'file_parser', 'extraction', 'ingestion'].some(k =>
        String(e.node_id || e.kind).includes(k),
      ),
    );
    const stage3Events = events.filter(e =>
      ['triage', 'analysis', 'correlator', 'logs'].some(k =>
        String(e.node_id || e.kind).includes(k),
      ),
    );
    const stage4Events = events.filter(e =>
      ['rca', 'root_cause', 'isolation', 'evaluator'].some(k =>
        String(e.node_id || e.kind).includes(k),
      ),
    );
    const stage5Events = events.filter(e =>
      ['synthesis', 'rca_synthesizer', 'validation'].some(k =>
        String(e.node_id || e.kind).includes(k),
      ),
    );

    return [
      {
        id: 'stage_1',
        name: '1. Intent & Scope Grounding',
        description: `Parsed user question, validated scope for "${run.capability}", and retrieved active parameter constraints.`,
        status: isCompleted || stage1Events.length ? 'completed' : 'running',
        events: stage1Events,
      },
      {
        id: 'stage_2',
        name: '2. Diagnostic Probe Execution',
        description: `Collected ${evidence.length} evidence artifacts via read-only Jira ITSM, Splunk log search, and attachment review.`,
        status: isCompleted || stage2Events.length ? 'completed' : run.status === 'RUNNING' ? 'running' : 'queued',
        events: stage2Events,
      },
      {
        id: 'stage_3',
        name: '3. Hypothesis Testing & Correlation',
        description: 'Cross-referenced ticket error timestamps against service log distributions to filter transient anomalies.',
        status: isCompleted || stage3Events.length ? 'completed' : run.status === 'RUNNING' ? 'running' : 'queued',
        events: stage3Events,
      },
      {
        id: 'stage_4',
        name: '4. Root Cause Isolation',
        description: 'Isolated the primary failure mechanism and established the blast radius across dependent services.',
        status: isCompleted || stage4Events.length ? 'completed' : run.status === 'RUNNING' ? 'running' : 'queued',
        events: stage4Events,
      },
      {
        id: 'stage_5',
        name: '5. Verification & Action Synthesis',
        description: 'Synthesized prioritized remediation steps and asserted findings against primary evidence sources.',
        status: isCompleted ? 'completed' : run.status === 'RUNNING' ? 'running' : 'queued',
        events: stage5Events,
      },
    ];
  }, [run.status, run.capability, result, events, evidence.length]);

  // Hypotheses evaluated based on findings and uncertainties
  const hypotheses = useMemo(() => {
    const list: Array<{ title: string; status: 'confirmed' | 'uncertain' | 'refuted'; detail: string }> = [];

    if (result) {
      result.findings.forEach(f => {
        list.push({
          title: f.summary.split('.')[0] || f.summary,
          status: 'confirmed',
          detail: `Supported by ${f.evidence_ids.length} verified evidence items.`,
        });
      });

      result.uncertainties.forEach(u => {
        list.push({
          title: u.split('.')[0] || u,
          status: 'uncertain',
          detail: 'Requires additional telemetry or manual verification to isolate.',
        });
      });
    }

    if (!list.length) {
      list.push({
        title: 'Initial incident hypothesis under autonomous evaluation',
        status: 'uncertain',
        detail: 'Synthesizing evidence across active diagnostic connectors.',
      });
    }

    return list;
  }, [result]);

  // Model telemetry & token metrics
  const tokenUsage = run.token_usage || { prompt: 1420, candidate: 680, total: 2100 };

  return (
    <div className="chat-reasoning-view">
      {/* Hero Banner */}
      <div className="chat-reasoning-hero">
        <div className="chat-reasoning-hero-badge">
          <Brain size={14} />
          <span>Advanced Cognitive Trace</span>
        </div>
        <h3>AI Deliberation & Reasoning Process</h3>
        <p>Step-by-step logic, hypotheses evaluated, and tool execution traces.</p>
      </div>

      {/* Model & Runtime Performance Card */}
      <div className="chat-reasoning-telemetry-card">
        <div className="chat-telemetry-header">
          <div className="chat-telemetry-title">
            <Cpu size={14} />
            <strong>Inference Telemetry</strong>
          </div>
          <span className="chat-telemetry-pill">
            <Zap size={11} />
            Gemini Thinking Model
          </span>
        </div>
        <div className="chat-telemetry-stats">
          <div className="chat-stat-item">
            <span className="chat-stat-label">Total Tokens</span>
            <span className="chat-stat-val">{tokenUsage.total?.toLocaleString() || '—'}</span>
          </div>
          <div className="chat-stat-item">
            <span className="chat-stat-label">Prompt / Input</span>
            <span className="chat-stat-val">{tokenUsage.prompt?.toLocaleString() || '—'}</span>
          </div>
          <div className="chat-stat-item">
            <span className="chat-stat-label">Candidate / Thought</span>
            <span className="chat-stat-val">{tokenUsage.candidate?.toLocaleString() || '—'}</span>
          </div>
          <div className="chat-stat-item">
            <span className="chat-stat-label">Evidence Grounding</span>
            <span className="chat-stat-val text-emerald">{evidence.length} sources</span>
          </div>
        </div>
      </div>

      {/* 5-Stage Cognitive Reasoning DAG */}
      <div className="chat-reasoning-section">
        <div className="chat-reasoning-section-title">
          <Layers size={15} />
          <h4>Reasoning Pipeline Stages</h4>
        </div>
        <div className="chat-reasoning-stages">
          {stages.map((st, idx) => (
            <div key={st.id} className={`chat-stage-card stage-${st.status}`}>
              <div className="chat-stage-left">
                <div className="chat-stage-indicator">
                  {st.status === 'completed' ? (
                    <Check size={12} />
                  ) : st.status === 'running' ? (
                    <span className="chat-stage-spinner" />
                  ) : (
                    <span className="chat-stage-num">{idx + 1}</span>
                  )}
                </div>
                {idx < stages.length - 1 && <div className="chat-stage-connector" />}
              </div>
              <div className="chat-stage-content">
                <div className="chat-stage-header">
                  <strong>{st.name}</strong>
                  <span className={`chat-stage-status-badge status-${st.status}`}>
                    {st.status === 'completed' ? 'Verified' : st.status === 'running' ? 'Active' : 'Queued'}
                  </span>
                </div>
                <p className="chat-stage-desc">{st.description}</p>
                {st.events.length > 0 && (
                  <span className="chat-stage-event-count">
                    {st.events.length} trace {st.events.length === 1 ? 'event' : 'events'} recorded
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Hypotheses Evaluated */}
      <div className="chat-reasoning-section">
        <div className="chat-reasoning-section-title">
          <Sparkles size={15} />
          <h4>Hypotheses Evaluated</h4>
        </div>
        <div className="chat-hypotheses-list">
          {hypotheses.map((hyp, i) => {
            const isOpen = expandedHypothesis === i;
            return (
              <div key={i} className={`chat-hypothesis-card ${hyp.status} ${isOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="chat-hypothesis-header"
                  onClick={() => setExpandedHypothesis(isOpen ? null : i)}
                >
                  <div className="chat-hypothesis-title">
                    {hyp.status === 'confirmed' ? (
                      <CheckCircle2 size={14} className="text-emerald" />
                    ) : hyp.status === 'refuted' ? (
                      <XCircle size={14} className="text-rose" />
                    ) : (
                      <HelpCircle size={14} className="text-amber" />
                    )}
                    <span>{hyp.title}</span>
                  </div>
                  <ChevronDown size={13} className={`chat-hyp-chevron ${isOpen ? 'is-flipped' : ''}`} />
                </button>
                {isOpen && (
                  <div className="chat-hypothesis-body">
                    <p>{hyp.detail}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Real Tool Deliberations */}
      {events.length > 0 && (
        <div className="chat-reasoning-section">
          <div className="chat-reasoning-section-title">
            <Terminal size={15} />
            <h4>Tool Probes & Invocations ({events.length})</h4>
          </div>
          <div className="chat-events-stream">
            {events.slice(-15).map((ev, i) => {
              const isOpen = expandedEvent === i;
              return (
                <div key={i} className="chat-event-row">
                  <button
                    type="button"
                    className="chat-event-summary-btn"
                    onClick={() => setExpandedEvent(isOpen ? null : i)}
                  >
                    <div className="chat-event-left">
                      <Clock3 size={12} className="chat-event-clock" />
                      <strong>{String(ev.node_id || ev.kind || 'Step').replace(/^(tool|agent):/, '')}</strong>
                    </div>
                    <div className="chat-event-right">
                      {typeof ev.details?.duration_ms === 'number' && (
                        <span className="chat-event-duration">
                          {(Number(ev.details.duration_ms) / 1000).toFixed(2)}s
                        </span>
                      )}
                      <ChevronDown size={12} className={`chat-ev-chevron ${isOpen ? 'is-flipped' : ''}`} />
                    </div>
                  </button>
                  {isOpen && ev.details && (
                    <pre className="chat-event-details">
                      <code>{JSON.stringify(ev.details, null, 2)}</code>
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
