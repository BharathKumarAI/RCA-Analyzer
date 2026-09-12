import React, { useEffect, useState, useMemo } from 'react';
import {
  CreditCard,
  Cpu,
  DollarSign,
  Zap,
  CheckCircle2,
  RefreshCw,
  Save,
  AlertTriangle,
  Sliders,
  TrendingUp,
  Activity,
  Layers,
  ShieldAlert,
  Server,
  BellRing,
} from 'lucide-react';
import { fetchBilling, updateBilling } from '../services/api';
import type { BillingConfig, BillingPayload } from '../types/api';

const TIERS = [
  { id: 'Development', name: 'Development Tier', maxRuns: 2, desc: 'Local testing & evaluation runs' },
  { id: 'Standard', name: 'Standard Enterprise', maxRuns: 4, desc: 'Production incident triage & analysis' },
  { id: 'Dedicated', name: 'Dedicated High-Throughput', maxRuns: 8, desc: 'Mission-critical autonomous RCA fleet' },
];

export const Billing: React.FC = () => {
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form State
  const [form, setForm] = useState<BillingPayload>({
    tier: 'Standard',
    monthly_spend_budget: 500,
    monthly_token_budget: 50000000,
    max_concurrent_investigations: 4,
    rate_limit_rpm: 60,
    rate_limit_tpm: 250000,
    alert_threshold_percent: 80,
    webhook_url: '',
    pricing_matrix: {
      'gemini-2.5-flash': { input_per_million: 0.15, output_per_million: 0.60 },
      'gemini-2.5-flash-lite': { input_per_million: 0.075, output_per_million: 0.30 },
      'gemini-2.5-pro': { input_per_million: 1.25, output_per_million: 5.00 },
      'gemini-1.5-pro': { input_per_million: 1.25, output_per_million: 5.00 },
      'gemini-1.5-flash': { input_per_million: 0.075, output_per_million: 0.30 },
      'ocr-parser': { input_per_million: 0.20, output_per_million: 0.20 },
    },
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBilling();
      setConfig(data);
      setForm({
        tier: data.tier || 'Standard',
        monthly_spend_budget: data.monthly_spend_budget || 500,
        monthly_token_budget: data.monthly_token_budget || 50000000,
        max_concurrent_investigations: data.max_concurrent_investigations || 4,
        rate_limit_rpm: data.rate_limit_rpm || 60,
        rate_limit_tpm: data.rate_limit_tpm || 250000,
        alert_threshold_percent: data.alert_threshold_percent || 80,
        webhook_url: data.webhook_url || '',
        pricing_matrix: data.pricing_matrix || form.pricing_matrix,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load billing telemetry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateBilling(form);
      setConfig(prev => ({ ...prev, ...updated }));
      setNotice('Compute quotas and pricing matrix saved successfully.');
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save billing configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handlePriceChange = (model: string, field: 'input_per_million' | 'output_per_million', val: number) => {
    setForm(prev => ({
      ...prev,
      pricing_matrix: {
        ...prev.pricing_matrix,
        [model]: {
          ...(prev.pricing_matrix[model] || { input_per_million: 0.1, output_per_million: 0.5 }),
          [field]: val,
        },
      },
    }));
  };

  const usage = config?.usage;
  const spendPct = usage?.budget_consumed_percent ?? 0;
  const tokenPct = usage && form.monthly_token_budget > 0
    ? Math.min(100, Math.round((usage.estimated_tokens_processed / form.monthly_token_budget) * 100))
    : 0;

  return (
    <div className="view-container">
      {/* Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">Token Consumption &amp; <span>Compute Quotas</span></h1>
          <p className="hero-lede">
            Live telemetry aggregation, compute budget quotas, rate limits, and model pricing configuration.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Activity size={13} /> <b>Active Tier:</b> {form.tier}
            </span>
            <span className="hero-stat-chip">
              <b>Spend to Date:</b> ${usage?.month_to_date_spend_usd.toFixed(2) ?? '0.00'}
            </span>
            <span className="hero-stat-chip">
              <b>Calculated from:</b> {usage?.total_runs ?? 0} runs ({usage?.total_evidence_collected ?? 0} evidence bundles)
            </span>
          </div>
        </div>
        <div className="hero-actions" style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading || saving}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh Telemetry
          </button>
        </div>
      </section>

      {error && <div className="notice-banner red" role="alert">{error}</div>}
      {notice && <div className="notice-banner blue" role="status">{notice}</div>}

      {/* Live Metric Cards */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Month to Date Spend</span>
            <DollarSign size={16} style={{ color: 'var(--acc)' }} />
          </div>
          <div className="metric-value">${usage?.month_to_date_spend_usd.toFixed(2) ?? '0.00'}</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              <span>Budget: ${form.monthly_spend_budget}</span>
              <span>{spendPct}% consumed</span>
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, spendPct)}%`, height: '100%', background: spendPct > 85 ? 'var(--danger)' : 'var(--acc)', transition: 'width 0.4s' }} />
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Tokens Processed</span>
            <Cpu size={16} style={{ color: 'var(--acc3)' }} />
          </div>
          <div className="metric-value">{(usage?.estimated_tokens_processed ?? 0).toLocaleString()}</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              <span>Quota: {(form.monthly_token_budget / 1_000_000).toFixed(0)}M tokens</span>
              <span>{tokenPct}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${tokenPct}%`, height: '100%', background: 'var(--acc3)', transition: 'width 0.4s' }} />
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Investigation Executions</span>
            <Layers size={16} style={{ color: 'var(--acc2)' }} />
          </div>
          <div className="metric-value">{usage?.total_runs ?? 0}</div>
          <p className="metric-meta">
            {usage?.completed_runs ?? 0} succeeded · {usage?.failed_runs ?? 0} failed · {usage?.active_runs ?? 0} active
          </p>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Avg Cost / Run</span>
            <CreditCard size={16} style={{ color: '#10b981' }} />
          </div>
          <div className="metric-value">
            ${usage && usage.total_runs > 0 ? (usage.month_to_date_spend_usd / usage.total_runs).toFixed(3) : '0.000'}
          </div>
          <p className="metric-meta">Estimated from active model profile tokens</p>
        </div>
      </div>

      <form onSubmit={handleSave}>
        {/* Compute Tier Selection */}
        <section className="card" style={{ padding: 22, marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={16} style={{ color: 'var(--acc)' }} /> Compute Infrastructure Tier
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            {TIERS.map(tier => {
              const isSelected = form.tier === tier.id;
              return (
                <div
                  key={tier.id}
                  onClick={() => setForm({ ...form, tier: tier.id, max_concurrent_investigations: tier.maxRuns })}
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: isSelected ? '2px solid var(--acc)' : '1px solid var(--line)',
                    background: isSelected ? 'var(--acc-subtle)' : 'var(--card)',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>{tier.name}</strong>
                    {isSelected && <CheckCircle2 size={16} style={{ color: 'var(--acc)' }} />}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>{tier.desc}</p>
                  <span className="badge badge-neutral" style={{ fontSize: 11 }}>Max Concurrency: {tier.maxRuns}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Quota & Rate Limit Form */}
        <section className="card" style={{ padding: 22, marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sliders size={16} style={{ color: 'var(--acc)' }} /> Quotas &amp; Operational Thresholds
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                Monthly Spend Budget ($ USD)
              </label>
              <input
                type="number"
                min={10}
                max={50000}
                step={10}
                value={form.monthly_spend_budget}
                onChange={e => setForm({ ...form, monthly_spend_budget: parseFloat(e.target.value) || 0 })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                Monthly Token Quota
              </label>
              <input
                type="number"
                min={1000000}
                max={1000000000}
                step={1000000}
                value={form.monthly_token_budget}
                onChange={e => setForm({ ...form, monthly_token_budget: parseInt(e.target.value, 10) || 0 })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                Max Concurrent Investigations
              </label>
              <input
                type="number"
                min={1}
                max={32}
                value={form.max_concurrent_investigations}
                onChange={e => setForm({ ...form, max_concurrent_investigations: parseInt(e.target.value, 10) || 1 })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                Rate Limit: Requests Per Minute (RPM)
              </label>
              <input
                type="number"
                min={5}
                max={1000}
                value={form.rate_limit_rpm}
                onChange={e => setForm({ ...form, rate_limit_rpm: parseInt(e.target.value, 10) || 10 })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                Cost Alert Threshold ({form.alert_threshold_percent}% of Budget)
              </label>
              <input
                type="range"
                min={50}
                max={95}
                value={form.alert_threshold_percent}
                onChange={e => setForm({ ...form, alert_threshold_percent: parseInt(e.target.value, 10) })}
                style={{ width: '100%', marginTop: 8 }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Dispatches operational warning when spend reaches {form.alert_threshold_percent}%</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                Billing Webhook / Alert Endpoint
              </label>
              <input
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={form.webhook_url || ''}
                onChange={e => setForm({ ...form, webhook_url: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)' }}
              />
            </div>
          </div>
        </section>

        {/* Model Pricing Rate Matrix */}
        <section className="card" style={{ padding: 22, marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={16} style={{ color: 'var(--acc)' }} /> Foundation Model Pricing Matrix ($ / 1M Tokens)
          </h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>
            Configure model unit costs to compute live investigation telemetry and budget run rates.
          </p>
          <div className="table-wrap" style={{ border: '1px solid var(--line)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model / Engine Profile</th>
                  <th>Input Cost ($ / 1M Tokens)</th>
                  <th>Output Cost ($ / 1M Tokens)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(form.pricing_matrix).map(([model, pricing]) => (
                  <tr key={model}>
                    <td>
                      <strong>{model}</strong>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>$</span>
                        <input
                          type="number"
                          step={0.001}
                          min={0}
                          value={pricing.input_per_million}
                          onChange={e => handlePriceChange(model, 'input_per_million', parseFloat(e.target.value) || 0)}
                          style={{ width: 110, padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)' }}
                        />
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>$</span>
                        <input
                          type="number"
                          step={0.001}
                          min={0}
                          value={pricing.output_per_million}
                          onChange={e => handlePriceChange(model, 'output_per_million', parseFloat(e.target.value) || 0)}
                          style={{ width: 110, padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)' }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Save Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingBottom: 24 }}>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', fontSize: 14 }}>
            <Save size={15} /> {saving ? 'Saving to database…' : 'Save Quotas & Pricing'}
          </button>
        </div>
      </form>
    </div>
  );
};
