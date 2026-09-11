import React from 'react';
import { CreditCard, DollarSign, Cpu, CheckCircle2, TrendingDown } from 'lucide-react';

export const Billing: React.FC = () => {
  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Token Consumption & <span>Compute Quotas</span>
          </h1>
          <p className="hero-lede">
            Multi-model token consumption tracking, reasoning token allocations, and per-investigation cost attribution.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>Budget Status:</b> Healthy (21.4%)
            </span>
            <span className="hero-stat-chip">
              <b>Ceiling:</b> $2,000 / mo
            </span>
            <span className="hero-stat-chip">
              <b>Limit:</b> 60 req/min
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <span className="badge badge-active" style={{ padding: '6px 12px' }}>Budget Healthy</span>
          </div>
        </div>
      </section>

      {/* Proportional Metric Grid */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Month-to-Date Spend</span>
            <DollarSign size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">$428.50</div>
          <div className="metric-meta">Within $2,000 monthly ceiling</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Total Tokens Processed</span>
            <Cpu size={15} color="var(--acc)" />
          </div>
          <div className="metric-value">48.2M</div>
          <div className="metric-meta">32M input / 16.2M reasoning</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Cost / Investigation</span>
            <CreditCard size={15} color="var(--acc2)" />
          </div>
          <div className="metric-value">$3.02</div>
          <div className="metric-meta"><b>↓ $0.80</b> after Flash triage</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Quota Remaining</span>
            <CheckCircle2 size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">78.6%</div>
          <div className="metric-meta">$1,571.50 headroom remaining</div>
        </div>
      </div>

      {/* 2-Column Balanced Dashboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '16px' }}>
        {/* Cost by Model */}
        <div className="card" style={{ padding: '16px', height: 'auto' }}>
          <div className="prompt-label" style={{ marginBottom: '10px' }}>Foundation Model Spend Distribution</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 650, fontSize: '13px' }}>Gemini 2.5 Pro (Deep Reasoning & Synthesis)</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>$312.40</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '8px' }}>Root Cause Synthesizer & Splunk Log Miner</div>
              <div style={{ height: '6px', width: '100%', background: 'var(--line-strong)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '73%', background: 'var(--gradient-brand)' }} />
              </div>
            </div>

            <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 650, fontSize: '13px' }}>Gemini 2.5 Flash (Low-Latency Triage)</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>$116.10</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '8px' }}>Jira Triage & Remediation Advisor</div>
              <div style={{ height: '6px', width: '100%', background: 'var(--line-strong)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '27%', background: 'var(--acc3)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Cost Attribution per Agent */}
        <div className="card" style={{ padding: '16px', height: 'auto' }}>
          <div className="prompt-label" style={{ marginBottom: '10px' }}>Agent Fleet Cost Attribution</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: '12.5px' }}>Root Cause Synthesizer</div>
                <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>15,200 avg tokens / run</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}>$184.20</span>
                <div style={{ fontSize: '10px', color: 'var(--acc3)' }}>43% of total</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: '12.5px' }}>Splunk Observability Miner</div>
                <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>12,800 avg tokens / run</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}>$128.20</span>
                <div style={{ fontSize: '10px', color: 'var(--acc2)' }}>30% of total</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '8px', background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: '12.5px' }}>Jira Incident Triage</div>
                <div style={{ fontSize: '10.5px', color: 'var(--dim)' }}>4,100 avg tokens / run</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}>$54.60</span>
                <div style={{ fontSize: '10px', color: 'var(--acc3)' }}>13% of total</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
