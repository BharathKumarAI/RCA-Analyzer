import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Circle, Clock3, FileText, Link2, Plus, ShieldCheck } from 'lucide-react';
import { ApiError, fetchTools } from '../services/api';
import { AgentConfiguration, Run, SystemHealth, ToolDefinition } from '../types/api';
import { ActivePage } from '../components/Sidebar';
import '../styles/overview.css';

interface OverviewProps { health: SystemHealth; agents: AgentConfiguration[]; runs: Run[]; onNavigate: (page: ActivePage) => void; onNewInvestigation: () => void; }
const statusClass = (status: Run['status']) => `overview-status overview-status-${status.toLowerCase()}`;

export const Overview: React.FC<OverviewProps> = ({ health, agents, runs, onNavigate, onNewInvestigation }) => {
  const [tools, setTools] = useState<ToolDefinition[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  useEffect(() => { let active = true; fetchTools().then(value => active && setTools(value)).catch(reason => active && setToolsError(reason instanceof ApiError ? reason.message : 'Unable to load connections.')); return () => { active = false; }; }, []);
  const runningCount = useMemo(() => runs.filter(run => run.status === 'RUNNING' || run.status === 'QUEUED').length, [runs]);
  const pendingAgents = useMemo(() => agents.filter(agent => agent.status === 'pending'), [agents]);
  const connections = tools?.filter(tool => tool.type === 'connector' || tool.integration_kind === 'native' || tool.integration_kind === 'mcp') ?? [];
  const setupItems = [{ label: 'Connect an evidence source', page: 'tools' as ActivePage, action: 'Review connections' }, { label: 'Choose a capability', page: 'capabilities' as ActivePage, action: 'Browse capabilities' }, { label: 'Start an investigation', action: 'New investigation' }];
  return <div className="overview-page">
    <section className="overview-heading"><div><h1>Overview</h1><p>Review investigations and the evidence behind them.</p></div><button type="button" className="btn btn-primary overview-new" onClick={onNewInvestigation}><Plus size={16} /> New investigation</button></section>
    <div className="overview-metrics" aria-label="Workspace metrics"><span>Recent runs <b>{runs.length}</b></span><i /><span>Running <b>{runningCount}</b></span><i /><span>Pending approvals <b>{pendingAgents.length}</b></span></div>
    <div className="overview-grid"><main>
      <section className="overview-section"><div className="overview-section-head"><h2>Recent investigations</h2><button type="button" className="btn btn-secondary" onClick={() => onNavigate('runs')}>View all <ArrowRight size={14} /></button></div><div className="overview-table-wrap"><table className="overview-table"><thead><tr><th>Investigation</th><th>Status</th><th>Evidence</th><th>Updated</th></tr></thead><tbody>
        {runs.slice(0, 8).map(run => <tr key={run.id}><td><strong>{run.incident_id || run.capability || 'Investigation'}</strong><small>{run.id}</small></td><td><span className={statusClass(run.status)}>{run.status}</span></td><td>{run.evidence_count ?? 0} items</td><td>{run.created_at ? new Date(run.created_at).toLocaleString() : '—'}</td></tr>)}
        {!runs.length && <tr><td colSpan={4}><div className="overview-empty"><FileText size={42} strokeWidth={1.4} /><strong>No investigations yet.</strong><span>Start with an incident ID or describe what happened.</span><button type="button" className="btn btn-primary" onClick={onNewInvestigation}>Start investigation</button></div></td></tr>}
      </tbody></table></div></section>
      {!runs.length && <section className="overview-setup"><h2>Setup checklist</h2>{setupItems.map((item, index) => <div className="overview-setup-row" key={item.label}><span className="overview-step">{index + 1}</span><span>{item.label}</span><button type="button" onClick={() => item.page ? onNavigate(item.page) : onNewInvestigation()}>{item.action} <ArrowRight size={15} /></button></div>)}</section>}
    </main><aside className="overview-rail">
      <section><div className="overview-rail-head"><h2>Connections</h2><Link2 size={18} /></div>{toolsError ? <p className="overview-muted" role="alert">{toolsError}</p> : !tools ? <p className="overview-muted">Loading connections…</p> : connections.length ? <div className="overview-connection-list">{connections.map(tool => <div className="overview-connection" key={tool.id}><span className="overview-connection-icon"><Link2 size={16} /></span><span>{tool.name}</span><em className={tool.status === 'connected' ? 'is-connected' : ''}>{tool.status === 'connected' ? 'Connected' : tool.status === 'planned' ? 'Not configured' : tool.status}</em></div>)}</div> : <p className="overview-muted">No connections reported.</p>}<button type="button" className="overview-link" onClick={() => onNavigate('tools')}>Review connections <ArrowRight size={15} /></button></section>
      <section><div className="overview-rail-head"><h2>Approvals</h2><ShieldCheck size={18} /></div>{pendingAgents.length ? pendingAgents.slice(0, 4).map(agent => <button type="button" className="overview-approval" key={agent.id} onClick={() => onNavigate('agents')}><span><Circle size={12} />{agent.name || agent.id}</span><ArrowRight size={15} /></button>) : <p className="overview-muted">No pending reviews.</p>}{pendingAgents.length > 4 && <button type="button" className="overview-link" onClick={() => onNavigate('agents')}>View all approvals <ArrowRight size={15} /></button>}</section>
    </aside></div>
    {health.mode === 'demo' && <p className="overview-demo-note"><Clock3 size={14} /> Demo mode. Investigation results are simulated.</p>}
  </div>;
};
