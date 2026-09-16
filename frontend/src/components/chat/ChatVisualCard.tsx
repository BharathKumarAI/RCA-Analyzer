import { useMemo } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Layers,
  ListFilter,
  Server,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
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

  // Extract blast radius / affected services if mentioned in findings or summary
  const affectedServices = useMemo(() => {
    if (!result) return [];
    const text = `${result.summary} ${result.findings.map(f => f.summary).join(' ')}`;
    const matched = new Set<string>();
    const knownServices = [
      'Payment Gateway',
      'Checkout API',
      'PostgreSQL',
      'HikariCP Pool',
      'Redis Cache',
      'Worker Queue',
      'Auth Service',
      'Ingress Controller',
      'Kafka Stream',
      'Splunk Cluster',
      'Jira ITSM',
    ];
    for (const svc of knownServices) {
      if (new RegExp(`\\b${svc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
        matched.add(svc);
      }
    }
    return Array.from(matched);
  }, [result]);

  // Extract timeline entries from findings or summary
  const timelineEntries = useMemo(() => {
    if (!result) return [];
    const entries: Array<{ time?: string; title: string; detail: string; evidenceIds: string[] }> = [];

    // Parse time patterns like "14:02 UTC", "2026-09-15 14:00", etc.
    result.findings.forEach((finding, idx) => {
      const timeMatch = finding.summary.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:UTC|GMT|EST|PST)?)\b/i);
      const timeStr = timeMatch ? timeMatch[1] : undefined;
      const parts = finding.summary.split(/[:–—]/);
      const title = parts.length > 1 && parts[0].length < 40 ? parts[0].trim() : `Event #${idx + 1}`;
      const detail = parts.length > 1 && parts[0].length < 40 ? parts.slice(1).join(':').trim() : finding.summary;

      entries.push({
        time: timeStr,
        title,
        detail,
        evidenceIds: finding.evidence_ids || [],
      });
    });

    return entries;
  }, [result]);

  if (!result) return null;

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
              Root cause isolated
            </span>
          ) : (
            <span className="chat-outcome-badge outcome-insufficient">
              <AlertTriangle size={12} />
              Needs further telemetry
            </span>
          )}
        </div>

        {affectedServices.length > 0 && (
          <div className="chat-visual-services">
            <Server size={12} className="chat-service-icon" />
            <span className="chat-service-label">Impacted:</span>
            {affectedServices.slice(0, 3).map((svc, i) => (
              <span key={i} className="chat-service-pill">
                {svc}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 1. Dashboard View */}
      {presentation === 'dashboard' && (
        <div className="chat-visual-dashboard">
          <div className="chat-dashboard-metrics-grid">
            <div className="chat-metric-box">
              <span className="chat-metric-label">Diagnosis Status</span>
              <div className="chat-metric-value text-emerald">
                {result.outcome === 'FINDINGS' ? 'Identified' : 'Evaluating'}
              </div>
              <span className="chat-metric-sub">
                {result.findings.length} confirmed evidentiary findings
              </span>
            </div>

            <div className="chat-metric-box">
              <span className="chat-metric-label">Evidence Grounding</span>
              <div className="chat-metric-value text-violet">
                {run.evidence_count || result.findings.reduce((acc, f) => acc + f.evidence_ids.length, 0)} Sources
              </div>
              <span className="chat-metric-sub">Across Jira, Splunk & files</span>
            </div>

            <div className="chat-metric-box">
              <span className="chat-metric-label">Mitigation Steps</span>
              <div className="chat-metric-value text-amber">
                {result.recommended_actions.length} Actionable
              </div>
              <span className="chat-metric-sub">Validated against runbooks</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Timeline View */}
      {presentation === 'timeline' && timelineEntries.length > 0 && (
        <div className="chat-visual-timeline-container">
          <h4 className="chat-visual-section-heading">
            <Clock3 size={14} />
            Incident Event Sequence
          </h4>
          <div className="chat-visual-timeline">
            {timelineEntries.map((entry, idx) => (
              <div key={idx} className="chat-timeline-row">
                <div className="chat-timeline-marker">
                  <div className="chat-timeline-dot" />
                  {idx < timelineEntries.length - 1 && <div className="chat-timeline-line" />}
                </div>
                <div className="chat-timeline-card">
                  <div className="chat-timeline-header">
                    <span className="chat-timeline-title">{entry.title}</span>
                    {entry.time && <span className="chat-timeline-time-tag">{entry.time}</span>}
                  </div>
                  <p className="chat-timeline-detail">{entry.detail}</p>
                  {entry.evidenceIds.length > 0 && (
                    <button
                      type="button"
                      className="chat-timeline-source-btn"
                      onClick={() => onInspectSources?.(entry.evidenceIds[0])}
                    >
                      <BookOpen size={11} />
                      <span>{entry.evidenceIds.length === 1 ? '1 source' : `${entry.evidenceIds.length} sources`}</span>
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
              <p>Generated by RCA assist with strict multi-source verification.</p>
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
