import React, { useState, useEffect } from 'react';
import { Topbar } from './components/Topbar';
import { Sidebar, ActivePage } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { SessionModal } from './components/SessionModal';
import { NewInvestigationModal } from './components/NewInvestigationModal';

import { Overview } from './pages/Overview';
import { Agents } from './pages/Agents';
import { Tools } from './pages/Tools';
import { Governance } from './pages/Governance';
import { Knowledge } from './pages/Knowledge';
import { Runs } from './pages/Runs';
import { Capabilities } from './pages/Capabilities';
import { Users } from './pages/Users';
import { Billing } from './pages/Billing';
import { Settings } from './pages/Settings';

// New Agent Harness Suite Pages
import { Skills } from './pages/Skills';
import { ParameterStudio } from './pages/ParameterStudio';
import { Roles } from './pages/Roles';
import { Optimization } from './pages/Optimization';
import { Persistence } from './pages/Persistence';
import { Policy } from './pages/Policy';
import { Runtime } from './pages/Runtime';

import {
  fetchHealth,
  fetchPrincipal,
  fetchAgents,
  fetchRuns,
  fetchTools,
  fetchAuditLogs,
} from './services/api';
import { SystemHealth, Principal, AgentConfiguration, Run } from './types/api';

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<ActivePage>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [isNewRunOpen, setIsNewRunOpen] = useState(false);

  // Core Data
  const [health, setHealth] = useState<SystemHealth>({ status: 'error', latency_ms: 0, tenant_id: '', project_id: '', mode: 'demo', active_runs: 0, total_runs: 0, mttr_minutes: 0, tool_success_rate: 0, active_agents_count: 0 });

  const [principal, setPrincipal] = useState<Principal>({ subject: '', roles: [], tenant_id: '', project_id: '' });

  const [agents, setAgents] = useState<AgentConfiguration[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tools, setTools] = useState<import('./types/api').ToolDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<import('./types/api').AuditLog[]>([]);

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
        'persistence',
        'policy',
        'roles',
        'governance',
        'knowledge',
        'users',
        'billing',
        'settings',
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
      } else if (hashStr.includes('settings')) {
        setActivePage('settings');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    // Fetch initial backend state
    loadData();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const loadData = async () => {
    try {
      const [h, p, ag, rn, tl] = await Promise.all([
        fetchHealth(),
        fetchPrincipal(),
        fetchAgents(),
        fetchRuns(),
        fetchTools(),
      ]);
      setHealth(h);
      setPrincipal(p);
      setAgents(ag);
      setRuns(rn);
      setTools(tl);
      try { setAuditLogs(await fetchAuditLogs()); } catch { setAuditLogs([]); }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Unable to load application data');
    }
  };

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
    setActivePage('runs');
    window.location.hash = 'runs';
  };

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
        onOpenAlerts={() => handleSelectPage('governance')}
        onNewInvestigation={() => setIsNewRunOpen(true)}
      />

      {/* Main Body */}
      <div className="app-body">
        <Sidebar
          activePage={activePage}
          onSelectPage={handleSelectPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNewInvestigation={() => setIsNewRunOpen(true)}
        />

        <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0, width: '100%' }}>
          {activePage === 'overview' && (
            <Overview
              health={health}
              agents={agents}
              runs={runs}
              onNavigate={handleSelectPage}
              onNewInvestigation={() => setIsNewRunOpen(true)}
            />
          )}

          {activePage === 'runs' && (
            <Runs runs={runs} onNewInvestigation={() => setIsNewRunOpen(true)} onRunUpdated={updated => setRuns(prev => prev.map(run => run.id === updated.id ? updated : run))} />
          )}

          {activePage === 'capabilities' && (
            <Capabilities />
          )}

          {activePage === 'skills' && (
            <Skills />
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
            <Agents agents={agents} onRefresh={loadData} />
          )}

          {activePage === 'tools' && (
            <Tools tools={tools} />
          )}

          {activePage === 'persistence' && (
            <Persistence />
          )}

          {activePage === 'policy' && (
            <Policy />
          )}

          {activePage === 'roles' && (
            <Roles />
          )}

          {activePage === 'governance' && (
            <Governance logs={auditLogs} agents={agents} />
          )}

          {activePage === 'knowledge' && (
            <Knowledge />
          )}

          {activePage === 'users' && (
            <Users />
          )}

          {activePage === 'billing' && (
            <Billing />
          )}

          {activePage === 'settings' && (
            <Settings principal={principal} health={health} />
          )}
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
        onUpdatePrincipal={setPrincipal}
        onSessionChanged={loadData}
      />

      <NewInvestigationModal
        isOpen={isNewRunOpen}
        onClose={() => setIsNewRunOpen(false)}
        onRunCreated={handleRunCreated}
      />
    </div>
  );
};
