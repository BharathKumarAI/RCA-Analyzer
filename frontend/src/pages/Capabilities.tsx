import React, { useEffect, useState } from 'react';
import {
  Layers,
  Sliders,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Bot,
  Workflow,
  Cpu,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { ApiError, fetchCapabilities } from '../services/api';

export const Capabilities: React.FC = () => {
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; fetchCapabilities().then(items => { if (active) setCapabilities(items); }).catch((reason: unknown) => { if (active) setError(reason instanceof ApiError ? reason.message : 'Unable to load capabilities.'); }); return () => { active = false; }; }, []);
  const _configuredCapabilities = [
    {
      id: 'full_incident_rca',
      title: 'Full Incident Root Cause Analysis',
      orchestrator: 'RootWorkflow Graph',
      max_steps: 25,
      description:
        'End-to-end incident investigation combining parallel Jira triage, Splunk anomaly mining, bounded document OCR, and fault-tree JoinNode synthesis.',
      stages: [
        'Jira Incident Triage',
        'Splunk Observability Miner',
        'Bounded Document OCR',
        'Root Cause Synthesizer'
      ],
      joinPattern: 'Fork-Join (Parallel Branches)',
    },
    {
      id: 'splunk_telemetry_triage',
      title: 'Splunk Observability & Log Spike Triage',
      orchestrator: 'SingleAgentWorkflow',
      max_steps: 12,
      description:
        'Targeted observability investigation focusing on error rate shifts, anomalous event distributions, and P99 latency spikes.',
      stages: ['Splunk Observability Miner', 'Root Cause Synthesizer'],
      joinPattern: 'Sequential Pipeline',
    },
    {
      id: 'jira_incident_triage',
      title: 'Jira Incident Classification & Ownership',
      orchestrator: 'SingleAgentWorkflow',
      max_steps: 8,
      description:
        'Rapid priority classification, affected service component ownership lookup, and duplicate incident discovery.',
      stages: ['Jira Incident Triage'],
      joinPattern: 'Single Agent Direct',
    },
  ];

  const stageProfiles = [
    {
      stage: 'Request Orchestrator',
      model: 'gemini-2.5-flash',
      thinking: 'High (8,192)',
      max_output: '4,096 tokens',
      temp: 0.1,
      role: 'Parses incoming directive, resolves capability graph, and spawns parallel branch execution.'
    },
    {
      stage: 'Jira Incident Triage',
      model: 'gemini-2.5-flash',
      thinking: 'Minimal (1,024)',
      max_output: '2,048 tokens',
      temp: 0.2,
      role: 'Extracts ticket priority, affected microservices, and customer impact labels.'
    },
    {
      stage: 'Splunk Observability Miner',
      model: 'gemini-2.5-pro',
      thinking: 'High (8,192)',
      max_output: '8,192 tokens',
      temp: 0.1,
      role: 'Executes bounded log queries, detects HTTP 5xx error spikes, and computes latency shifts.'
    },
    {
      stage: 'Bounded Document OCR',
      model: 'gemini-2.5-flash',
      thinking: 'Medium (2,048)',
      max_output: '4,096 tokens',
      temp: 0.2,
      role: 'Extracts text from uploaded architecture diagrams, postmortems, and runbook screenshots.'
    },
    {
      stage: 'Root Cause Synthesizer',
      model: 'gemini-2.5-pro',
      thinking: 'High (16,384)',
      max_output: '8,192 tokens',
      temp: 0.05,
      role: 'Performs final JoinNode evidence cross-correlation and synthesizes verified postmortem.'
    },
  ];

  const cards = capabilities.map((cap: any) => ({ ...cap, title: cap.name, stages: cap.skills?.length ? cap.skills : [cap.category], joinPattern: cap.requires?.connectors?.length ? `Requires ${cap.requires.connectors.join(', ')}` : 'Configured capability', orchestrator: cap.model_profile, max_steps: cap.max_steps ?? '—' }));
  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Workflow <span>Capabilities</span>
          </h1>
          <p className="hero-lede">
            Declarative root cause workflows, multi-agent pipelines, and stage-specific reasoning model profiles.
          </p>
          <div className="hero-meta-strip">
              <span className="hero-stat-chip">
                <span className="dot pulse" /> <b>{capabilities.length}</b> Authorized Workflows
            </span>
            <span className="hero-stat-chip">
              <b>5</b> Stage Model Profiles
            </span>
            <span className="hero-stat-chip">
              <b>Pattern:</b> Fork-Join Pipeline
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <span className="badge badge-active" style={{ padding: '6px 12px' }}>
              Production Profiles
            </span>
          </div>
        </div>
      </section>

      {/* Simplified & Structured Capability Topologies */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
        {error ? <div className="card empty-state"><p>{error}</p><button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry</button></div> : capabilities.length === 0 ? <div className="card empty-state"><p>Loading authorized capabilities…</p></div> : cards.map((cap, index) => (
          <article key={cap.id} className="card" style={{ padding: '18px 20px', height: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '280px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span className="num" style={{ minWidth: '32px', padding: '2px 6px' }}>
                    0{index + 1}
                  </span>
                  <h2 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--tx)', margin: 0 }}>
                    {cap.title}
                  </h2>
                  <span className="brand-badge" style={{ fontFamily: 'var(--font-mono)' }}>
                    {cap.id}
                  </span>
                  <span className="meta-pill">{cap.joinPattern}</span>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '4px 0 10px', lineHeight: 1.5 }}>
                  {cap.description}
                </p>

                {/* Visual Pipeline Flow Strip */}
                <div className="capability-flow-strip">
                  <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em', marginRight: '4px' }}>
                    Execution Flow:
                  </span>
                  {cap.stages.map((st: string, i: number) => (
                    <React.Fragment key={st}>
                      <span className="capability-flow-node">
                        {st}
                      </span>
                      {i < cap.stages.length - 1 && (
                        <span className="capability-flow-arrow">→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                <span className="badge badge-active">{cap.orchestrator}</span>
                <span className="meta-pill" style={{ fontFamily: 'var(--font-mono)' }}>
                  Max {cap.max_steps} steps
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Stage Model Profiles Matrix */}
      <div className="card" style={{ padding: 0, marginTop: '8px', height: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--tx)', margin: 0 }}>
              Stage Model Profiles Matrix
            </h3>
            <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
              Declared in config/model_profiles.yaml · Stage-specific reasoning parameters
            </span>
          </div>
          <span className="badge badge-neutral">Production Profiles</span>
        </div>

        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Execution Stage</th>
                <th>Foundation Model</th>
                <th>Thinking Budget</th>
                <th>Max Output</th>
                <th>Temp</th>
                <th>Stage Responsibility</th>
              </tr>
            </thead>
            <tbody>
              {stageProfiles.map((p, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>
                    {p.stage}
                  </td>
                  <td>
                    <span className="meta-pill highlight">
                      {p.model}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: 'var(--acc)', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '11.5px' }}>
                      {p.thinking}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    {p.max_output}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    {p.temp}
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--muted)', maxWidth: '380px' }}>
                    {p.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
