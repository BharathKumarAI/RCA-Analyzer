import { useEffect, useState } from 'react';
import { CheckCircle2, FlaskConical, Play, RefreshCw, XCircle } from 'lucide-react';
import { createOptimization, fetchConfig, fetchOptimization, fetchOptimizationDatasets, fetchOptimizations, registerOptimizationDataset, reviewOptimization } from '../services/api';

interface Dataset { dataset_id: string; version: string; purpose: string; description: string }
interface OptimizationRecord {
  optimization_id: string;
  status: string;
  author_subject: string;
  created_at: number;
  report_hash: string | null;
  reason: string | null;
  request: { dataset_id: string; dataset_version: string; target_kind: 'prompt' | 'skill'; target_name: string };
  report?: { comparison: { eligible: boolean; quality: { baseline: number; candidate: number }; reasons?: string[] }; diff?: string };
}

export function Optimization() {
  const [items, setItems] = useState<OptimizationRecord[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetKey, setDatasetKey] = useState('');
  const [registeringDataset, setRegisteringDataset] = useState(false);
  const [datasetText, setDatasetText] = useState(JSON.stringify({
    id: 'incident_examples', version: '1.0.0', purpose: 'example',
    capability: 'incident_triage', description: 'Curated incident examples',
    train: [], holdout: [],
  }, null, 2));
  const [targetName, setTargetName] = useState('');
  const [targetKind, setTargetKind] = useState<'prompt' | 'skill'>('prompt');
  const [targets, setTargets] = useState<string[]>([]);
  const [detail, setDetail] = useState<OptimizationRecord | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [records, available, config] = await Promise.all([fetchOptimizations(), fetchOptimizationDatasets(), fetchConfig()]);
      setItems(records);
      setDatasets(available as Dataset[]);
      setTargets(Object.keys(config.model_profiles.stages));
      setDatasetKey(current => current || (available[0] ? `${(available[0] as Dataset).dataset_id}@${(available[0] as Dataset).version}` : ''));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load optimizations.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function registerDataset() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const dataset = JSON.parse(datasetText);
      if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) throw new Error('Dataset JSON must be an object.');
      const registered = await registerOptimizationDataset(dataset);
      await load();
      setDatasetKey(`${registered.dataset_id}@${registered.version}`);
      setRegisteringDataset(false);
      setMessage(`Dataset '${registered.dataset_id}' version ${registered.version} registered.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to register dataset.'); }
    finally { setBusy(false); }
  }
  async function run() {
    const dataset = datasets.find(item => `${item.dataset_id}@${item.version}` === datasetKey);
    if (!dataset || !targetName.trim()) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const record: OptimizationRecord = await createOptimization({ dataset_id: dataset.dataset_id, dataset_version: dataset.version, target_kind: targetKind, target_name: targetName.trim() });
      setDetail(record);
      await load();
      setMessage(`Evaluation returned ${record.status.toLowerCase().replaceAll('_', ' ')}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to run evaluation.'); }
    finally { setBusy(false); }
  }
  async function inspect(id: string) {
    setBusy(true); setError(null); setReason('');
    try { setDetail(await fetchOptimization(id) as OptimizationRecord); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load report.'); }
    finally { setBusy(false); }
  }
  async function review(approve: boolean) {
    if (!detail?.report_hash || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      setDetail(await reviewOptimization(detail.optimization_id, approve, detail.report_hash, reason.trim()));
      await load();
      setMessage(approve ? 'Optimization approved.' : 'Optimization rejected.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to review optimization.'); }
    finally { setBusy(false); }
  }

  return <div className="view-container">
    <section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Optimization <span>Studio</span></h1><p className="hero-lede">Compare registered offline datasets and review persisted evaluation reports.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><FlaskConical size={14} /> {loading ? 'Loading…' : `${items.length} records`}</span><span className="hero-stat-chip">Offline comparisons are not live quality scores</span></div></div><button className="btn btn-secondary" onClick={() => void load()} disabled={busy || loading}><RefreshCw size={14} /> Refresh</button></section>
    {error && <div className="notice-banner" role="alert">{error}</div>}
    {message && <div className="notice-banner" role="status">{message}</div>}
    <section className="notice-banner"><h2>Registered datasets</h2>
      <button className="btn btn-secondary" disabled={busy} onClick={() => setRegisteringDataset(open => !open)}>{registeringDataset ? 'Close registration' : 'Register dataset'}</button>
      {registeringDataset && <form onSubmit={event => { event.preventDefault(); void registerDataset(); }}>
        <p className="metric-meta">Paste a curated dataset as JSON. Versions are immutable. Include distinct training and holdout cases; each case needs id, prompt, expected_outcome (FINDINGS or INSUFFICIENT_EVIDENCE), and expected_facts. Training and holdout arrays must each contain at least one case; evaluation may require more cases under the configured limits.</p>
        <label htmlFor="dataset-json">Dataset JSON</label>
        <textarea id="dataset-json" rows={14} value={datasetText} onChange={event => setDatasetText(event.target.value)} required maxLength={2097152} disabled={busy} style={{ width: '100%', fontFamily: 'var(--font-mono)', padding: 10 }} />
        <button className="btn btn-primary" type="submit" disabled={busy || !datasetText.trim()}>{busy ? 'Registering…' : 'Register version'}</button>
      </form>}
    </section>
    <section className="notice-banner"><h2>Run an evaluation</h2>
      <div className="settings-values">
        <label>Registered dataset<select value={datasetKey} onChange={event => setDatasetKey(event.target.value)} style={{ display: 'block', width: '100%', padding: 10 }}><option value="">Select a dataset</option>{datasets.map(item => <option key={`${item.dataset_id}@${item.version}`} value={`${item.dataset_id}@${item.version}`}>{item.dataset_id} · {item.version} · {item.purpose}</option>)}</select></label>
        <label>Target type<select value={targetKind} onChange={event => { setTargetKind(event.target.value as 'prompt' | 'skill'); setTargetName(''); }} style={{ display: 'block', width: '100%', padding: 10 }}><option value="prompt">Prompt stage</option><option value="skill">Skill</option></select></label>
        <label>Target name<input list="optimization-targets" value={targetName} onChange={event => setTargetName(event.target.value)} placeholder={targetKind === 'prompt' ? 'Stage name' : 'Configured skill ID'} style={{ display: 'block', width: '100%', padding: 10 }} /><datalist id="optimization-targets">{targetKind === 'prompt' && targets.map(name => <option key={name} value={name} />)}</datalist></label>
      </div>
      {!loading && !datasets.length && <p className="metric-meta">No datasets are registered. Use Register dataset above to add a curated dataset before running an evaluation.</p>}
      <button className="btn btn-primary" disabled={busy || loading || !datasetKey || !targetName.trim()} onClick={() => void run()}><Play size={14} /> {busy ? 'Working…' : 'Run offline evaluation'}</button>
    </section>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Target</th><th>Dataset</th><th>Status</th><th>Author</th><th>Created</th><th>Report</th></tr></thead><tbody>{items.map(item => <tr key={item.optimization_id}><td>{item.request.target_name}</td><td>{item.request.dataset_id} · {item.request.dataset_version}</td><td><span className="badge badge-neutral">{item.status.replaceAll('_', ' ')}</span></td><td>{item.author_subject}</td><td>{new Date(item.created_at * 1000).toLocaleString()}</td><td><button className="btn btn-secondary" disabled={busy} onClick={() => void inspect(item.optimization_id)}>Inspect</button></td></tr>)}{!items.length && <tr><td colSpan={6}>{loading ? 'Loading evaluations…' : 'No recorded optimizations.'}</td></tr>}</tbody></table></div>
    {detail && <section className="notice-banner"><h2>{detail.request.target_name} comparison</h2><p>Status: {detail.status.replaceAll('_', ' ')}</p>{detail.reason && <p>{detail.reason}</p>}
      {detail.report ? <><div className="metric-grid"><div className="metric-card"><div className="metric-label-row">Baseline quality</div><div className="metric-value">{detail.report.comparison.quality.baseline.toFixed(3)}</div></div><div className="metric-card"><div className="metric-label-row">Candidate quality</div><div className="metric-value">{detail.report.comparison.quality.candidate.toFixed(3)}</div></div><div className="metric-card"><div className="metric-label-row">Review eligibility</div><div className="metric-value">{detail.report.comparison.eligible ? 'Eligible' : 'Not eligible'}</div></div></div>{detail.report.diff && <details><summary>Review proposed instruction changes</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.report.diff}</pre></details>}</> : <p>No comparison report is available for this record.</p>}
      {detail.status === 'PENDING_APPROVAL' && <><label htmlFor="review-reason">Review reason</label><textarea id="review-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} rows={3} style={{ padding: 10 }} /><p className="metric-meta">A different authorized administrator must review this exact report hash.</p><div className="settings-tags"><button className="btn btn-primary" disabled={busy || !reason.trim() || !detail.report_hash} onClick={() => void review(true)}><CheckCircle2 size={14} /> Approve</button><button className="btn btn-secondary" disabled={busy || !reason.trim() || !detail.report_hash} onClick={() => void review(false)}><XCircle size={14} /> Reject</button></div></>}
    </section>}
  </div>;
}
