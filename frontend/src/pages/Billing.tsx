import { useEffect, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { fetchBilling, updateBilling, request } from '../services/api';
import type { BillingPayload, Principal } from '../types/api';
import type { ModelRate } from '../services/telemetry';
import '../pages/insights.css';

interface Pricing {
  revision: number; currency: 'USD'; rates: Record<string, ModelRate>; active_revision: number | null; active_hash: string | null;
  proposal: { rates: Record<string, ModelRate>; status: string; author_subject: string; content_hash: string; revision: number; reviewer_subject?: string; reason?: string } | null;
  can_review: boolean;
}
const validRate = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
export function Billing({ principal }: { principal: Principal }) {
  const [form, setForm] = useState<BillingPayload | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [rates, setRates] = useState<Array<{ model: string; input: string; output: string; cached: string }>>([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const admin = principal.roles.includes('PLATFORM_ADMIN');
  const manager = admin || principal.roles.includes('PROJECT_OWNER');
  const applyPricing = (value: Pricing) => {
    setPricing(value);
    setRates(Object.entries(value.proposal?.status === 'PENDING' ? value.proposal.rates : value.rates).map(([model, rate]) => ({ model, input: String(rate.input_per_million), output: String(rate.output_per_million), cached: rate.cached_input_per_million == null ? '' : String(rate.cached_input_per_million) })));
  };
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [config, value] = await Promise.all([fetchBilling(), request<Pricing>('/api/v1/telemetry/pricing')]);
      setForm({ tier: config.tier, monthly_spend_budget: config.monthly_spend_budget, monthly_token_budget: config.monthly_token_budget, max_concurrent_investigations: config.max_concurrent_investigations, rate_limit_rpm: config.rate_limit_rpm, rate_limit_tpm: config.rate_limit_tpm, alert_threshold_percent: config.alert_threshold_percent, webhook_url: config.webhook_url || '', pricing_matrix: config.pricing_matrix });
      applyPricing(value);
    } catch (error) { setError(error instanceof Error ? error.message : 'Budget settings could not load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const saveBudget = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form || !manager) return;
    setBusy(true); setError(null); setNotice('');
    try { const { pricing_matrix: _prices, ...budget } = form; await updateBilling(budget); setNotice('Planning budget saved.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'The budget could not be saved.'); }
    finally { setBusy(false); }
  };
  const submitPrices = async (event: React.FormEvent) => {
    event.preventDefault(); if (!pricing || !admin) return;
    const names = rates.map(row => row.model.trim());
    if (names.some(name => !name) || new Set(names).size !== names.length || rates.some(row => !validRate(row.input) || !validRate(row.output) || row.cached !== '' && !validRate(row.cached))) { setError('Each model needs a unique name and non-negative input and output prices.'); return; }
    const next = Object.fromEntries(rates.map(row => [row.model.trim(), { input_per_million: Number(row.input), output_per_million: Number(row.output), ...(row.cached !== '' ? { cached_input_per_million: Number(row.cached) } : {}) }]));
    setBusy(true); setError(null); setNotice('');
    try { applyPricing(await request<Pricing>('/api/v1/telemetry/pricing', { method: 'PUT', body: { expected_revision: pricing.revision, rates: next } })); setNotice('Prices submitted for another administrator to review.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Prices could not be submitted.'); }
    finally { setBusy(false); }
  };
  const review = async (action: 'approve' | 'reject' | 'revoke') => {
    if (!pricing || !reason.trim()) return;
    setBusy(true); setError(null); setNotice('');
    try { applyPricing(await request<Pricing>(`/api/v1/telemetry/pricing/${action}`, { method: 'POST', body: { expected_hash: action === 'revoke' ? pricing.active_hash : pricing.proposal?.content_hash, reason: reason.trim() } })); setReason(''); setNotice(action === 'approve' ? 'Approved prices will be used for new investigations.' : action === 'reject' ? 'Price proposal rejected.' : 'Prices revoked. New cost estimates will remain unknown until prices are approved.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'The review could not be saved.'); }
    finally { setBusy(false); }
  };
  const changeRate = (index: number, key: 'model' | 'input' | 'output' | 'cached', value: string) => setRates(previous => previous.map((row, i) => i === index ? { ...row, [key]: value } : row));
  return <div className="insights-page"><header className="insights-header"><div><span className="insights-eyebrow">COST PLANNING</span><h1>Budgets and model prices</h1><p>Set a planning budget and review the prices used in investigation cost estimates.</p></div></header>
    {loading && <p role="status">Loading budget settings…</p>}{error && <div className="insights-error" role="alert">{error}<button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void load()}>Reload</button></div>}{notice && <p role="status" className="insights-coverage">{notice}</p>}
    {form && pricing && !loading && <><section className="insights-section"><h2>Planning budget</h2><p>Use Insights to compare measured usage against these saved targets. These planning values do not stop investigations or send alerts.</p><form onSubmit={saveBudget} className="insights-filters"><label>Monthly budget (USD)<input type="number" min={0} required step="0.01" disabled={!manager || busy} value={form.monthly_spend_budget} onChange={event => setForm({ ...form, monthly_spend_budget: Number(event.target.value) })} /></label><label>Monthly token target<input type="number" min={0} step={1} required disabled={!manager || busy} value={form.monthly_token_budget} onChange={event => setForm({ ...form, monthly_token_budget: Number(event.target.value) })} /></label>{manager && <button className="btn btn-primary" type="submit" disabled={busy}><Save size={14} /> Save budget</button>}</form></section>
      <section className="insights-section"><h2>Approved model prices</h2><p>USD per million tokens. Prices are captured when an investigation starts, so future changes preserve earlier cost estimates. Add prices from your provider agreement.</p>{!Object.keys(pricing.rates).length ? <p className="insights-coverage">No approved prices. Costs remain unknown until two administrators submit and approve a price list.</p> : <div className="insights-table-wrap"><table><thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached input</th></tr></thead><tbody>{Object.entries(pricing.rates).map(([model, rate]) => <tr key={model}><th scope="row">{model}</th><td>{rate.input_per_million}</td><td>{rate.output_per_million}</td><td>{rate.cached_input_per_million ?? 'Not configured'}</td></tr>)}</tbody></table></div>}</section>
      {pricing.proposal && <section className="insights-section"><h2>Price review · {labelStatus(pricing.proposal.status)}</h2><p>Submitted by {pricing.proposal.author_subject}{pricing.proposal.reviewer_subject && ` · Reviewed by ${pricing.proposal.reviewer_subject}`}</p>{pricing.proposal.reason && <p>{pricing.proposal.reason}</p>}{pricing.proposal.status === 'PENDING' && <div className="insights-table-wrap"><table><thead><tr><th>Proposed model</th><th>Input</th><th>Output</th><th>Cached input</th></tr></thead><tbody>{Object.entries(pricing.proposal.rates).map(([model, rate]) => <tr key={model}><th scope="row">{model}</th><td>{rate.input_per_million}</td><td>{rate.output_per_million}</td><td>{rate.cached_input_per_million ?? 'Not configured'}</td></tr>)}</tbody></table></div>}{admin && (pricing.can_review || pricing.active_hash) && <div className="pricing-review"><label htmlFor="price-review-reason">Review reason</label><textarea id="price-review-reason" rows={2} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /><div className="insights-actions">{pricing.can_review && pricing.proposal.status === 'PENDING' && <><button type="button" className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void review('approve')}>Approve proposed prices</button><button type="button" className="btn btn-secondary" disabled={busy || !reason.trim()} onClick={() => void review('reject')}>Reject proposal</button></>}{pricing.active_hash && <button type="button" className="btn btn-secondary" disabled={busy || !reason.trim()} onClick={() => void review('revoke')}>Revoke active prices</button>}</div></div>}</section>}
      {admin && <section className="insights-section"><h2>Propose a price change</h2><p>A different administrator must approve this list before it affects new investigations.</p><form onSubmit={submitPrices}><div className="insights-table-wrap"><table><thead><tr><th>Model name</th><th>Input</th><th>Output</th><th>Cached input (optional)</th><th /></tr></thead><tbody>{rates.map((row, index) => <tr key={index}><td><input aria-label={`Model ${index + 1}`} value={row.model} onChange={event => changeRate(index, 'model', event.target.value)} maxLength={128} required disabled={busy} /></td>{(['input', 'output', 'cached'] as const).map(key => <td key={key}><input aria-label={`${key} price for model ${index + 1}`} type="number" min={0} step="any" required={key !== 'cached'} value={row[key]} onChange={event => changeRate(index, key, event.target.value)} disabled={busy} /></td>)}<td><button type="button" className="icon-btn" aria-label={`Remove model ${index + 1}`} disabled={busy} onClick={() => setRates(previous => previous.filter((_, i) => i !== index))}><X size={15} /></button></td></tr>)}</tbody></table></div><div className="insights-actions"><button type="button" className="btn btn-secondary" disabled={busy || rates.length >= 100} onClick={() => setRates(previous => [...previous, { model: '', input: '', output: '', cached: '' }])}><Plus size={14} /> Add model</button><button type="submit" className="btn btn-primary" disabled={busy}>Submit prices for review</button></div></form></section>}
    </>}
  </div>;
}
const labelStatus = (status: string) => ({ PENDING: 'Awaiting another administrator', APPROVED: 'Approved', REJECTED: 'Rejected', REVOKED: 'Revoked' })[status] || status;
