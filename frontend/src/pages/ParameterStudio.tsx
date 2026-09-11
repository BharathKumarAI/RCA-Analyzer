import { useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Save, Sliders } from 'lucide-react';
import { fetchParameters, resetParameterOverride, setParameterOverride } from '../services/api';

interface Parameter {
  tool: string;
  variable_name: string;
  value_type: 'string' | 'integer' | 'number' | 'boolean' | 'json' | 'secret_ref';
  description: string;
  default_value: unknown;
  effective_value: unknown;
  revision: number;
  override_revision: number | null;
  allow_project_override: boolean;
  source: 'platform' | 'project';
}
const parameterKey = (item: Parameter) => `${item.tool}.${item.variable_name}`;
const displayValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function ParameterStudio() {
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const selected = parameters.find(item => parameterKey(item) === selectedKey);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const items: Parameter[] = await fetchParameters();
      setParameters(items);
      setSelectedKey(current => items.some(item => parameterKey(item) === current) ? current : items[0] ? parameterKey(items[0]) : '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load parameters.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setValue(selected ? displayValue(selected.effective_value) : ''); }, [selected]);

  async function save(reset = false) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (reset) {
        if (!selected.override_revision) return;
        await resetParameterOverride(selected.tool, selected.variable_name, selected.override_revision);
      } else {
        const parsed = ['string', 'secret_ref'].includes(selected.value_type) ? value : JSON.parse(value);
        await setParameterOverride(selected.tool, selected.variable_name, {
          value: parsed,
          expected_revision: selected.override_revision ?? 0,
          expected_definition_revision: selected.revision,
        });
      }
      await load();
      setMessage(reset ? 'Override removed. The platform default now applies.' : 'Project override saved.');
    } catch (reason) {
      setError(reason instanceof SyntaxError ? 'Enter valid JSON for this value type.' : reason instanceof Error ? reason.message : 'Unable to save the parameter.');
    } finally { setBusy(false); }
  }

  return (
    <div className="view-container">
      <section className="hero-banner"><div className="hero-main"><h1 className="hero-title">Parameter <span>Studio</span></h1><p className="hero-lede">Inspect effective values and manage project overrides with revision checks.</p><div className="hero-meta-strip"><span className="hero-stat-chip"><Sliders size={13} /> {loading ? 'Loading…' : `${parameters.length} parameters`}</span><span className="hero-stat-chip">Server-enforced scope</span></div></div><button className="btn btn-secondary" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button></section>
      {error && <div className="notice-banner" role="alert">{error}<p className="metric-meta">Refresh to review current revisions before retrying a conflict.</p></div>}
      {message && <div className="notice-banner" role="status">{message}</div>}
      <div className="studio-grid">
        <section className="notice-banner">
          <label htmlFor="parameter-search">Find a parameter</label><input id="parameter-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search names or tools" style={{ padding: 10, width: '100%' }} />
          {parameters.filter(item => parameterKey(item).toLowerCase().includes(search.toLowerCase())).map(item => <button className={`parameter-item ${selectedKey === parameterKey(item) ? 'selected' : ''}`} key={parameterKey(item)} onClick={() => { setSelectedKey(parameterKey(item)); setMessage(null); }}><b>{parameterKey(item)}</b><span>{item.value_type} · {item.source} value</span></button>)}
          {!loading && !parameters.length && <p>No parameter definitions are configured for this deployment.</p>}
        </section>
        <section className="notice-banner">
          {selected ? <>
            <h2>{parameterKey(selected)}</h2><p>{selected.description}</p>
            <div className="settings-tags"><span className="badge badge-neutral">Definition revision {selected.revision}</span><span className="badge badge-neutral">{selected.allow_project_override ? 'Project override allowed' : 'Platform managed'}</span></div>
            <label htmlFor="parameter-value">{selected.allow_project_override ? 'Project value' : 'Effective value'} · {selected.value_type}</label>
            <textarea id="parameter-value" rows={7} value={value} onChange={event => setValue(event.target.value)} disabled={busy || !selected.allow_project_override} style={{ width: '100%', padding: 12, fontFamily: 'var(--font-mono)' }} />
            {selected.value_type === 'secret_ref' && <p className="metric-meta">Enter a deployment secret reference, never the credential itself.</p>}
            <p className="metric-meta">Platform default: <code>{displayValue(selected.default_value)}</code></p>
            <div className="settings-tags"><button className="btn btn-primary" disabled={busy || !selected.allow_project_override} onClick={() => void save()}><Save size={14} /> {busy ? 'Saving…' : 'Save override'}</button><button className="btn btn-secondary" disabled={busy || !selected.override_revision} onClick={() => void save(true)}><RotateCcw size={14} /> Restore default</button></div>
          </> : <p role="status">{loading ? 'Loading parameters…' : 'Select a parameter to inspect its value.'}</p>}
        </section>
      </div>
    </div>
  );
}
