import React from 'react';
import {
  Activity,
  Search,
  Sun,
  Moon,
  Plus,
  Bell
} from 'lucide-react';
import { Principal, SystemHealth } from '../types/api';
import { ActivePage } from './Sidebar';

interface TopbarProps {
  health: SystemHealth;
  principal: Principal;
  theme: 'dark' | 'light';
  activePage?: ActivePage;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenSession: () => void;
  onOpenAlerts: () => void;
  onNewInvestigation?: () => void;
}

const PAGE_TITLES: Record<ActivePage, string> = {
  overview: 'Overview',
  agents: 'Fleet & Specialists',
  tools: 'Connectors & Tools',
  governance: 'Governance & Audit',
  knowledge: 'Knowledge Base',
  runs: 'Investigations',
  capabilities: 'Capabilities & Topology',
  users: 'Users & Roles',
  billing: 'Usage & Quotas',
  settings: 'System Settings',
  skills: 'Skills Catalog',
  parameters: 'Parameter Studio',
  optimization: 'Optimization & Evaluation',
  persistence: 'Persistence & Storage',
  policy: 'Policy & Guardrails',
  roles: 'Roles & Access',
  runtime: 'Runtime & ADK',
  alerts: 'Operational Alerts',
  'health-checks': 'Health Checks',
  'project-setup': 'Project Setup',
  'harness-library': 'Harness Library',
};

export const Topbar: React.FC<TopbarProps> = ({
  principal,
  health,
  theme,
  activePage = 'overview',
  onToggleTheme,
  onOpenSearch,
  onOpenSession,
  onOpenAlerts,
  onNewInvestigation,
}) => {
  const currentCrumb = PAGE_TITLES[activePage] || 'Overview';

  return (
    <header className="topbar">
      {/* Brand & Breadcrumb */}
      <div className="topbar-brand">
        <div className="brand-icon">
          <Activity size={17} strokeWidth={2.5} />
        </div>
        <div className="brand-info">
          <div className="brand-title">
            <span className="gradient-text">RCA Analyzer</span>
          </div>
          <span className="topbar-crumb-sep">/</span>
          <span className="topbar-crumb">{currentCrumb}</span>
        </div>
      </div>

      {/* Center: Clean Search Bar */}
      <div className="topbar-center">
        <button
          type="button"
          className="search-bar-btn"
          onClick={onOpenSearch}
          title="Search workspace (⌘K)"
        >
          <Search size={14} />
          <span>Search investigations, agents, tools…</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      {/* Right Cluster: Clean & Uncluttered */}
      <div className="topbar-right">
        {onNewInvestigation && (
          <button
            type="button"
            className="topbar-quick-btn"
            onClick={onNewInvestigation}
            title="Launch an incident investigation"
          >
            <Plus size={13} strokeWidth={2.5} />
            <span>New Run</span>
          </button>
        )}

        <div className="telemetry-pill" title={`Platform ${health.mode} status`}>
          <span className="telemetry-dot" />
          <span>{health.mode === 'live' ? 'Live' : 'Demo'}</span>
        </div>

        <button
          type="button"
          className="icon-btn"
          onClick={onOpenAlerts}
          title="Open operational alerts"
        >
          <Bell size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          type="button"
          className="user-profile-btn"
          onClick={onOpenSession}
          title="Inspect authentication session"
        >
          <div className="user-avatar">
            {principal.subject.charAt(0).toUpperCase()}
          </div>
          <span className="user-name">{principal.subject.split('@')[0]}</span>
        </button>
      </div>
    </header>
  );
};
