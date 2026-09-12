import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Topbar } from './components/Topbar';
import { Sidebar, ActivePage } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { SessionModal } from './components/SessionModal';
import { NewInvestigationModal } from './components/NewInvestigationModal';

const Overview = lazy(() => import('./pages/Overview').then(module => ({ default: module.Overview })));
const Agents = lazy(() => import('./pages/Agents').then(module => ({ default: module.Agents })));
const Tools = lazy(() => import('./pages/Tools').then(module => ({ default: module.Tools })));
const Governance = lazy(() => import('./pages/Governance').then(module => ({ default: module.Governance })));
const Knowledge = lazy(() => import('./pages/Knowledge').then(module => ({ default: module.Knowledge })));
const Runs = lazy(() => import('./pages/Runs').then(module => ({ default: module.Runs })));
const Capabilities = lazy(() => import('./pages/Capabilities').then(module => ({ default: module.Capabilities })));
const Users = lazy(() => import('./pages/Users').then(module => ({ default: module.Users })));
const Billing = lazy(() => import('./pages/Billing').then(module => ({ default: module.Billing })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));

// New Agent Harness Suite Pages
const Skills = lazy(() => import('./pages/Skills').then(module => ({ default: module.Skills })));
const ParameterStudio = lazy(() => import('./pages/ParameterStudio').then(module => ({ default: module.ParameterStudio })));
const Optimization = lazy(() => import('./pages/Optimization').then(module => ({ default: module.Optimization })));
const Persistence = lazy(() => import('./pages/Persistence').then(module => ({ default: module.Persistence })));
const Policy = lazy(() => import('./pages/Policy').then(module => ({ default: module.Policy })));
const Runtime = lazy(() => import('./pages/Runtime').then(module => ({ default: module.Runtime })));
const Alerts = lazy(() => import('./pages/Alerts').then(module => ({ default: module.Alerts })));
const HealthChecks = lazy(() => import('./pages/HealthChecks').then(module => ({ default: module.HealthChecks })));
const ProjectSetup = lazy(() => import('./pages/ProjectSetup').then(module => ({ default: module.ProjectSetup })));
const HarnessLibrary = lazy(() => import('./pages/HarnessLibrary').then(module => ({ default: module.HarnessLibrary })));

import {
  fetchHealth,
  fetchPrincipal,
  fetchAgents,
  fetchRuns,
  fetchTools,
  fetchAuditLogs,
  getSessionToken,
  setSessionToken,
  ApiError,
} from './services/api';
import { SystemHealth, Principal, AgentConfiguration, Run } from './types/api';

class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="notice-banner" role="alert" style={{ margin: 24 }}>
      <p>This page could not load. The application may have been updated. Reload to reconnect your session and try again.</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload application</button>
    </div>;
    return this.props.children;
  }
}

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<ActivePage>('overview');
  const [initialRunId, setInitialRunId] = useState<string | undefined>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [isNewRunOpen, setIsNewRunOpen] = useState(false);
  const [initialCapability, setInitialCapability] = useState<string | undefined>();
  const openInvestigation = (capability?: string) => { setInitialCapability(capability); setIsNewRunOpen(true); };

  // Core Data
  const [health, setHealth] = useState<SystemHealth>({ status: 'error', latency_ms: 0, tenant_id: '', project_id: '', mode: 'demo', active_runs: 0, total_runs: 0, mttr_minutes: 0, tool_success_rate: 0, active_agents_count: 0 });

  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [agents, setAgents] = useState<AgentConfiguration[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tools, setTools] = useState<import('./types/api').ToolDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<import('./types/api').AuditLog[]>([]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsSearchOpen(open => !open);
      }
    };
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);

  // Initialize data and hash routing
  useEffect(() => {
    // Hash & Path router synchronization
    const handleHashChange = () => {
      const rawHash = window.location.hash
        .replace(/^#\/?/, '')
        .split('?')[0]
        .split('/')[0]
        .toLowerCase() as ActivePage;

      const validPages: ActivePage[] = [
        'overview',
        'runs',
        'capabilities',
        'skills',
        'runtime',
        'parameters',
        'optimization',
        'agents',
        'tools',
        'alerts',
        'health-checks',
        'project-setup',
        'persistence',
        'policy',
        'roles',
        'governance',
        'knowledge',
        'users',
        'billing',
        'settings',
        'harness-library',
      ];

      const hashStr = (window.location.hash + ' ' + window.location.pathname).toLowerCase();

      if (validPages.includes(rawHash)) {
        setActivePage(rawHash);
      } else if (hashStr.includes('persistence') || hashStr.includes('storage')) {
        setActivePage('persistence');
      } else if (hashStr.includes('skill')) {
        setActivePage('skills');
      } else if (hashStr.includes('parameter') || hashStr.includes('studio')) {
        setActivePage('parameters');
      } else if (hashStr.includes('optimi')) {
        setActivePage('optimization');
      } else if (hashStr.includes('role')) {
        setActivePage('roles');
      } else if (hashStr.includes('policy') || hashStr.includes('guardrail')) {
        setActivePage('policy');
      } else if (hashStr.includes('runtime')) {
        setActivePage('runtime');
      } else if (hashStr.includes('runs')) {
        setActivePage('runs');
      } else if (hashStr.includes('harness-configuration') || hashStr.includes('capabilities')) {
        setActivePage('capabilities');
      } else if (hashStr.includes('agents')) {
        setActivePage('agents');
      } else if (hashStr.includes('tools')) {
        setActivePage('tools');
      } else if (hashStr.includes('alerts')) {
        setActivePage('alerts');
      } else if (hashStr.includes('health')) {
        setActivePage('health-checks');
      } else if (hashStr.includes('project')) {
        setActivePage('project-setup');
      } else if (hashStr.includes('settings')) {
        setActivePage('settings');
      } else {
        setActivePage('overview');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const loadData = async () => {
    if (!principal) return;
    const token = getSessionToken();
    setLoadingData(true);
    setLoadError(null);
    try {
      const [p, h, ag, rn, tl, logs] = await Promise.allSettled([
        fetchPrincipal(), fetchHealth(), fetchAgents(), fetchRuns(), fetchTools(), fetchAuditLogs(),
      ]);
      if (token !== getSessionToken()) return;
      if (p.status === 'rejected') throw p.reason;
      if (p.value.subject !== principal.subject || p.value.tenant_id !== principal.tenant_id || p.value.project_id !== principal.project_id) return clearScopedData();
      const failures = [h, ag, rn, tl, logs].filter(result => result.status === 'rejected');
      const expired = failures.find(result => result.reason instanceof ApiError && result.reason.status === 401);
      if (expired) return clearScopedData(expired.reason.message);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (ag.status === 'fulfilled') setAgents(ag.value);
      if (rn.status === 'fulfilled') setRuns(rn.value);
      if (tl.status === 'fulfilled') setTools(tl.value);
      if (logs.status === 'fulfilled') setAuditLogs(logs.value);
      if (failures.length) setLoadError(failures.map(result => result.reason instanceof Error ? result.reason.message : 'Some workspace data is unavailable.').join(' '));
    } catch (error) {
      if (token !== getSessionToken()) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) clearScopedData(error.message);
      else setLoadError(error instanceof Error ? error.message : 'Unable to load workspace data.');
    } finally {
      if (token === getSessionToken()) setLoadingData(false);
    }
  };
  const clearScopedData = (message?: string) => { setSessionError(message || null); setSessionToken(null); setLoadingData(false); setIsNewRunOpen(false); setIsSearchOpen(false); setPrincipal(null); setAgents([]); setRuns([]); setTools([]); setAuditLogs([]); setLoadError(null); setIsSessionOpen(true); setSessionVersion(v => v + 1); };
  const handleAuthenticated = (next: Principal) => { setSessionError(null); setAgents([]); setRuns([]); setTools([]); setAuditLogs([]); setLoadingData(true); setPrincipal(next); setSessionVersion(v => v + 1); setIsSessionOpen(false); };
  useEffect(() => { if (principal) void loadData(); }, [principal]);
  useEffect(() => {
    void fetchPrincipal().then(p => {
      handleAuthenticated(p);
    }).catch(err => {
      if (err instanceof ApiError && [401, 403].includes(err.status)) {
        setIsSessionOpen(true);
      }
    });
  }, []);

  const handleSelectPage = (page: ActivePage) => {
    setActivePage(page);
    window.location.hash = page;
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const handleRunCreated = (newRun: Run) => {
    setRuns(prev => [newRun, ...prev]);
    setInitialRunId(newRun.id);
    setActivePage('runs');
    window.location.hash = 'runs';
    void loadData();
  };

  if (!principal) return <div className="app-layout"><div style={{ padding: 24, fontWeight: 650 }}>RCA Analyzer</div><SessionModal isOpen sessionError={sessionError} principal={{ subject: '', roles: [], tenant_id: '', project_id: '' }} onClose={() => undefined} onAuthenticated={handleAuthenticated} onSignedOut={clearScopedData} /></div>;

  return (
    <div className="app-layout">
      {/* Topbar */}
      <Topbar
        health={health}
        principal={principal}
        theme={theme}
        activePage={activePage}
        onToggleTheme={toggleTheme}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenSession={() => setIsSessionOpen(true)}
        onOpenAlerts={() => handleSelectPage('alerts')}
        onNewInvestigation={() => openInvestigation()}
      />

      {/* Main Body */}
      <div className="app-body">
        <Sidebar
          activePage={activePage}
          onSelectPage={handleSelectPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNewInvestigation={() => openInvestigation()}
        />

        <main key={sessionVersion} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, width: '100%' }}>
          {loadError && <div className="notice-banner" role="alert">{loadError}<button className="btn btn-secondary" onClick={() => void loadData()}>Retry loading data</button></div>}
          {loadingData && <div role="status" style={{ padding: '8px 24px', color: 'var(--muted)' }}>Refreshing workspace data…</div>}
          <PageErrorBoundary>
          <Suspense fallback={<div role="status" style={{ padding: 24 }}>Loading page…</div>}>
          {activePage === 'overview' && (
            <Overview
              health={health}
              agents={agents}
              runs={runs}
              onNavigate={handleSelectPage}
              onNewInvestigation={() => openInvestigation()}
              onOpenRun={id => { setInitialRunId(id); handleSelectPage('runs'); }}
            />
          )}

          {activePage === 'runs' && (
            <Runs initialRunId={initialRunId} runs={runs} onNewInvestigation={() => openInvestigation()} onRunUpdated={updated => setRuns(prev => prev.map(run => run.id === updated.id ? updated : run))} />
          )}

          {activePage === 'capabilities' && (
            <Capabilities onNewInvestigation={openInvestigation} />
          )}

          {activePage === 'skills' && (
            <Skills principal={principal} onNavigate={setActivePage} />
          )}

          {activePage === 'harness-library' && (
            <HarnessLibrary principal={principal} onNavigate={setActivePage} />
          )}

          {activePage === 'runtime' && (
            <Runtime health={health} />
          )}

          {activePage === 'parameters' && (
            <ParameterStudio />
          )}

          {activePage === 'optimization' && (
            <Optimization />
          )}

          {activePage === 'agents' && (
            <Agents agents={agents} principal={principal} onRefresh={loadData} onNavigate={setActivePage} />
          )}

          {activePage === 'tools' && (
            <Tools tools={tools} principal={principal} onNavigate={handleSelectPage} />
          )}

          {activePage === 'alerts' && (
            <Alerts />
          )}

          {activePage === 'health-checks' && (
            <HealthChecks />
          )}

          {activePage === 'project-setup' && (
            <ProjectSetup />
          )}

          {activePage === 'persistence' && (
            <Persistence />
          )}

          {activePage === 'policy' && (
            <Policy />
          )}

          {activePage === 'roles' && (
            <Users onSelectPage={handleSelectPage} initialTab="roles" />
          )}

          {activePage === 'governance' && (
            <Governance logs={auditLogs} agents={agents} />
          )}

          {activePage === 'knowledge' && (
            <Knowledge />
          )}

          {activePage === 'users' && (
            <Users onSelectPage={handleSelectPage} />
          )}

          {activePage === 'billing' && (
            <Billing />
          )}

          {activePage === 'settings' && (
            <Settings principal={principal} health={health} />
          )}
          </Suspense>
          </PageErrorBoundary>
        </main>
      </div>

      {/* Modals & Command Palette */}
      <CommandPalette
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={handleSelectPage}
      />

      <SessionModal
        isOpen={isSessionOpen}
        onClose={() => setIsSessionOpen(false)}
        principal={principal}
        onAuthenticated={handleAuthenticated}
        onSignedOut={clearScopedData}
      />

      <NewInvestigationModal
        initialCapability={initialCapability}
        isOpen={isNewRunOpen}
        onClose={() => setIsNewRunOpen(false)}
        onRunCreated={handleRunCreated}
      />
    </div>
  );
};
