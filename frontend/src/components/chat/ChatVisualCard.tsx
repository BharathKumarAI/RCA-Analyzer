import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Layers,
  ListFilter,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { ChatAnswerVisuals } from './ChatAnswerVisuals';
import { AnswerMarkdown } from '../AnswerMarkdown';
import type { Run } from '../../types/api';

interface ChatVisualCardProps {
  run: Run;
  onInspectSources?: (evidenceId?: string) => void;
  onOpenRun?: (id: string) => void;
}

export function ChatVisualCard({ run, onInspectSources, onOpenRun }: ChatVisualCardProps) {
  const result = run.result;
  const presentation = result?.presentation || 'summary';
  const capability = run.capability;

  if (!result) return null;
  if (result.visuals?.length) return <ChatAnswerVisuals visuals={result.visuals} onInspectSources={onInspectSources} />;

  return (
    <div className={`chat-visual-card presentation-${presentation} capability-${capability}`}>
      {/* Capability Context Banner */}
      <div className="chat-visual-context-bar">
        <div className="chat-visual-badge-group">
          {capability === 'incident_triage' ? (
            <span className="chat-type-badge badge-critical">
              <ShieldAlert size={12} />
              Incident Triage
            </span>
          ) : capability === 'log_correlation' ? (
            <span className="chat-type-badge badge-warning">
              <TrendingUp size={12} />
              Log Correlation
            </span>
          ) : capability === 'attachment_review' ? (
            <span className="chat-type-badge badge-info">
              <BookOpen size={12} />
              Runbook & Document Analysis
            </span>
          ) : (
            <span className="chat-type-badge badge-neutral">
              <Sparkles size={12} />
              Autonomous RCA
            </span>
          )}

          {result.outcome === 'FINDINGS' ? (
            <span className="chat-outcome-badge outcome-confirmed">
              <CheckCircle2 size={12} />
              Findings available
            </span>
          ) : (
            <span className="chat-outcome-badge outcome-insufficient">
              <AlertTriangle size={12} />
              {result.outcome.replaceAll('_', ' ').toLowerCase()}
            </span>
          )}
        </div>


      </div>

      {/* 1. Dashboard View */}
      {presentation === 'dashboard' && (
        <div className="chat-visual-dashboard">
          <div className="chat-dashboard-metrics-grid">
            <div className="chat-metric-box">
              <span className="chat-metric-label">Diagnosis Status</span>
              <div className="chat-metric-value text-emerald">
                {result.outcome.replaceAll('_', ' ').toLowerCase()}
              </div>
              <span className="chat-metric-sub">
                {result.findings.length} recorded findings
              </span>
            </div>

            <div className="chat-metric-box">
              <span className="chat-metric-label">Evidence Grounding</span>
              <div className="chat-metric-value text-violet">
                {run.evidence_count ?? '—'} Sources
              </div>
              <span className="chat-metric-sub">Saved evidence items</span>
            </div>

            <div className="chat-metric-box">
              <span className="chat-metric-label">Suggested actions</span>
              <div className="chat-metric-value text-amber">
                {result.recommended_actions.length} suggestions
              </div>
              <span className="chat-metric-sub">Review before acting</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Timeline View */}
      {presentation === 'timeline' && result.findings.length > 0 && (
        <div className="chat-visual-timeline-container">
          <h4 className="chat-visual-section-heading">
            <Clock3 size={14} />
            Findings in saved order
          </h4>
          <div className="chat-visual-timeline">
            {result.findings.map((entry, idx) => (
              <div key={idx} className="chat-timeline-row">
                <div className="chat-timeline-marker">
                  <div className="chat-timeline-dot" />
                  {idx < result.findings.length - 1 && <div className="chat-timeline-line" />}
                </div>
                <div className="chat-timeline-card">
                  <div className="chat-timeline-header">
                    <span className="chat-timeline-title">Finding {idx + 1}</span>
                  </div>
                  <p className="chat-timeline-detail">{entry.summary}</p>
                  {entry.evidence_ids.length > 0 && (
                    <button
                      type="button"
                      className="chat-timeline-source-btn"
                      disabled={!onInspectSources}
                      onClick={() => onInspectSources?.(entry.evidence_ids[0])}
                    >
                      <BookOpen size={11} />
                      <span>{entry.evidence_ids.length === 1 ? '1 source' : `${entry.evidence_ids.length} sources`}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Table View */}
      {presentation === 'table' && result.findings.length > 0 && (
        <div className="chat-visual-table-container">
          <h4 className="chat-visual-section-heading">
            <ListFilter size={14} />
            Evidentiary Findings Breakdown
          </h4>
          <div className="chat-table-wrapper">
            <table className="chat-findings-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>Finding & Symptom Analysis</th>
                  <th style={{ width: '130px' }}>Source Evidence</th>
                </tr>
              </thead>
              <tbody>
                {result.findings.map((f, i) => (
                  <tr key={i}>
                    <td className="chat-table-num">{i + 1}</td>
                    <td className="chat-table-summary">
                      <AnswerMarkdown text={f.summary} />
                    </td>
                    <td className="chat-table-actions">
                      <button
                        type="button"
                        className="chat-table-source-btn"
                        disabled={!onInspectSources || !f.evidence_ids.length}
                        onClick={() => onInspectSources?.(f.evidence_ids[0])}
                      >
                        <BookOpen size={11} />
                        <span>{f.evidence_ids.length} Ref</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Report View */}
      {presentation === 'report' && (
        <div className="chat-visual-report-container">
          <div className="chat-report-banner">
            <Layers size={16} />
            <div>
              <strong>Structured Incident Investigation Report</strong>
              <p>Saved investigation findings and supporting evidence.</p>
            </div>
            {onOpenRun && (
              <button
                type="button"
                className="chat-report-full-link"
                onClick={() => onOpenRun(run.id)}
              >
                <span>Full report view</span>
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
