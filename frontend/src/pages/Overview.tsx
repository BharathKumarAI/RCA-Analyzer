import React from 'react';
import {
  CheckCircle2,
  Clock,
  ShieldCheck,
  Cpu,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Sparkles,
  Activity
} from 'lucide-react';
import { SystemHealth, AgentConfiguration, Run } from '../types/api';
import { ActivePage } from '../components/Sidebar';

interface OverviewProps {
  health: SystemHealth;
  agents: AgentConfiguration[];
  runs: Run[];
  onNavigate: (page: ActivePage) => void;
  onNewInvestigation: () => void;
}

export const Overview: React.FC<OverviewProps> = ({
  health,
  agents,
  runs,
  onNavigate,
  onNewInvestigation,
}) => {
  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Control Plane & <span>Fault Isolation</span>
          </h1>
          <p className="hero-lede">
            Real-time multi-agent diagnostics, automated evidence gathering, and root cause synthesis.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>System:</b> {health.status.toUpperCase()}
            </span>
            <span className="hero-stat-chip">
              <b>P95 Latency:</b> {health.latency_ms}ms
            </span>
            <span className="hero-stat-chip">
              <b>Investigations:</b> {runs.length} Runs
            </span>
            <span className="hero-stat-chip">
              <b>Fleet:</b> {agents.filter(a => a.status === 'active').length} Active Agents
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNewInvestigation}
              title="Trigger a new root cause investigation"
            >
              <Plus size={13} strokeWidth={2.5} /> Launch Investigation
            </button>
          </div>
        </div>
      </section>

      {/* Proportional Metric Cards Grid */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Mean Time to RCA</span>
            <Clock size={15} color="var(--acc)" />
          </div>
          <div className="metric-value">{health.mttr_minutes ? `${health.mttr_minutes}m` : '—'}</div>
          <div className="metric-meta">
            <b>↓ 34% faster</b> resolution cycle
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Tool Success Rate</span>
            <CheckCircle2 size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">{health.tool_success_rate ? `${health.tool_success_rate}%` : '—'}</div>
          <div className="metric-meta">
            Jira & Splunk API connector SLA
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Active Agent Fleet</span>
            <Cpu size={15} color="var(--acc2)" />
          </div>
          <div className="metric-value">
            {agents.filter(a => a.status === 'active').length} / {agents.length}
          </div>
          <div className="metric-meta">
            <b>1 specialist</b> awaiting peer review
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Dual-Custody Governance</span>
            <ShieldCheck size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">—</div>
          <div className="metric-meta">
            Strict content-hash segregation
          </div>
        </div>
      </div>

      {/* Live & Recent Investigations Table (Full Content, No Cut-Off) */}
      <div className="card" style={{ padding: 0, height: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <h3 style={{ fontSize: '14.5px', fontWeight: 700 }}>Live & Recent Investigations</h3>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Multi-agent incident triage and fault tree joins</span>
          </div>
          <button
            type="button"
            className="btn btn-open"
            onClick={() => onNavigate('runs')}
          >
            View All <ArrowUpRight size={12} />
          </button>
        </div>

        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Incident</th>
                <th>Directive / Symptoms</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Evidence</th>
                <th>Timestamp (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 650, color: 'var(--acc)', fontSize: '11.5px' }}>
                    {run.id}
                  </td>
                  <td>
                    <span className="brand-badge" style={{ fontSize: '10px' }}>
                      {run.incident_id || 'N/A'}
                    </span>
                  </td>
                  <td style={{ maxWidth: '440px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {run.prompt}
                  </td>
                  <td>
                    <span className={`badge badge-${run.status.toLowerCase()}`}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    {run.duration_seconds ? `${run.duration_seconds}s` : 'Active'}
                  </td>
                  <td>{run.evidence_count ?? 0} items</td>
                  <td style={{ color: 'var(--dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {run.created_at}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fleet & Connectors Row (Balanced 2-Column Grid) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ padding: '16px', height: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700 }}>Active Agent Fleet</h3>
            <button
              type="button"
              className="btn btn-prompt"
              onClick={() => onNavigate('agents')}
              style={{ fontSize: '10.5px', padding: '3px 8px' }}
            >
              Explore Fleet <ArrowRight size={11} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agents.slice(0, 4).map((agent, i) => (
              <div
                key={agent.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: 'var(--card-subtle)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="num" style={{ minWidth: '36px', padding: '3px 6px', fontSize: '10px' }}>
                    00{i + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 650, fontSize: '12.5px' }}>{agent.name}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>{agent.role} · {agent.model}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--acc3)', fontFamily: 'var(--font-mono)' }}>
                    {agent.accuracy}%
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--dim)' }}>{agent.avg_latency_sec}s</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '16px', height: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700 }}>Telemetry & Connectors</h3>
            <button
              type="button"
              className="btn btn-prompt"
              onClick={() => onNavigate('tools')}
              style={{ fontSize: '10.5px', padding: '3px 8px' }}
            >
              Inspect Tools <ArrowRight size={11} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: '12.5px' }}>Jira Incident Cloud API</div>
                <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>Read-only ticket metadata & lineage</div>
              </div>
              <span className="badge badge-active">Connected (12ms)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: '12.5px' }}>Splunk Enterprise HEC</div>
                <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>Bounded log mining & spike detector</div>
              </div>
              <span className="badge badge-active">Connected (45ms)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: '12.5px' }}>Bounded OCR Document Parser</div>
                <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>Local multi-threaded incident archive reader</div>
              </div>
              <span className="badge badge-active">Active (2ms)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
