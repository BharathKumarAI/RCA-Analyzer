import React from 'react';
import {
  LayoutDashboard,
  Bot,
  Wrench,
  ShieldCheck,
  BookOpen,
  PlayCircle,
  Cpu,
  Users,
  CreditCard,
  Settings,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Sliders,
  FlaskConical,
  HardDrive,
  ShieldAlert,
  KeyRound,
  Zap,
  HeartPulse,
  FileCog,
  AlertTriangle
} from 'lucide-react';

export type ActivePage =
  | 'overview'
  | 'runs'
  | 'capabilities'
  | 'runtime'
  | 'skills'
  | 'parameters'
  | 'optimization'
  | 'agents'
  | 'tools'
  | 'alerts'
  | 'health-checks'
  | 'project-setup'
  | 'persistence'
  | 'policy'
  | 'roles'
  | 'governance'
  | 'knowledge'
  | 'users'
  | 'billing'
  | 'settings'
  | 'harness-library';

interface SidebarProps {
  activePage: ActivePage;
  onSelectPage: (page: ActivePage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewInvestigation: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  collapsed,
  onToggleCollapse,
  onNewInvestigation,
}) => {
  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main navigation">
      <div className="sidebar-header">
        {!collapsed && <span className="brand-badge">CONTROL PLANE</span>}
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <button
        type="button"
        className="sidebar-action-btn"
        onClick={onNewInvestigation}
        title="Start new RCA investigation run"
      >
        <Plus size={16} strokeWidth={2.5} />
        <span>New investigation</span>
      </button>

      {/* Group 1: Execution & Flow */}
      <div className="sidebar-heading">Execution & Flow</div>

      <button
        type="button"
        className={`nav-item ${activePage === 'overview' ? 'active' : ''}`}
        onClick={() => onSelectPage('overview')}
        aria-label="Overview"
        title="Overview"
        aria-current={activePage === 'overview' ? 'page' : undefined}
      >
        <LayoutDashboard size={16} />
        <span>Overview</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'runs' ? 'active' : ''}`}
        onClick={() => onSelectPage('runs')}
        aria-label="Investigations"
        title="Investigations"
        aria-current={activePage === 'runs' ? 'page' : undefined}
      >
        <PlayCircle size={16} />
        <span>Investigations</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'capabilities' ? 'active' : ''}`}
        onClick={() => onSelectPage('capabilities')}
        aria-label="Capabilities"
        title="Capabilities"
        aria-current={activePage === 'capabilities' ? 'page' : undefined}
      >
        <Cpu size={16} />
        <span>Capabilities</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'runtime' ? 'active' : ''}`}
        onClick={() => onSelectPage('runtime')}
        aria-label="Runtime & ADK"
        title="Runtime & ADK"
        aria-current={activePage === 'runtime' ? 'page' : undefined}
      >
        <Zap size={16} />
        <span>Runtime & ADK</span>
      </button>

      {/* Group 2: Agent Harness Studio */}
      <div className="sidebar-heading">Harness Studio</div>

      <button
        type="button"
        className={`nav-item ${activePage === 'harness-library' ? 'active' : ''}`}
        onClick={() => onSelectPage('harness-library')}
        aria-label="Harness Library"
        title="Harness Library"
        aria-current={activePage === 'harness-library' ? 'page' : undefined}
      >
        <BookOpen size={16} />
        <span>Harness Library</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'skills' ? 'active' : ''}`}
        onClick={() => onSelectPage('skills')}
        aria-label="Skills Catalog"
        title="Skills Catalog"
        aria-current={activePage === 'skills' ? 'page' : undefined}
      >
        <Sparkles size={16} />
        <span>Skills Catalog</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'parameters' ? 'active' : ''}`}
        onClick={() => onSelectPage('parameters')}
        aria-label="Parameter Studio"
        title="Parameter Studio"
        aria-current={activePage === 'parameters' ? 'page' : undefined}
      >
        <Sliders size={16} />
        <span>Parameter Studio</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'optimization' ? 'active' : ''}`}
        onClick={() => onSelectPage('optimization')}
        aria-label="Optimization & MLflow"
        title="Optimization & MLflow"
        aria-current={activePage === 'optimization' ? 'page' : undefined}
      >
        <FlaskConical size={16} />
        <span>Optimization & MLflow</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'agents' ? 'active' : ''}`}
        onClick={() => onSelectPage('agents')}
        aria-label="Agents Fleet"
        title="Agents Fleet"
        aria-current={activePage === 'agents' ? 'page' : undefined}
      >
        <Bot size={16} />
        <span>Agents Fleet</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'tools' ? 'active' : ''}`}
        onClick={() => onSelectPage('tools')}
        aria-label="Tools & Connectors"
        title="Tools & Connectors"
        aria-current={activePage === 'tools' ? 'page' : undefined}
      >
        <Wrench size={16} />
        <span>Tools & Connectors</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'health-checks' ? 'active' : ''}`}
        onClick={() => onSelectPage('health-checks')}
        aria-label="Connector health checks"
        title="Connector health checks"
        aria-current={activePage === 'health-checks' ? 'page' : undefined}
      >
        <HeartPulse size={16} />
        <span>Health Checks</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'alerts' ? 'active' : ''}`}
        onClick={() => onSelectPage('alerts')}
        aria-label="Operational alerts"
        title="Operational alerts"
        aria-current={activePage === 'alerts' ? 'page' : undefined}
      >
        <AlertTriangle size={16} />
        <span>Alerts</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'project-setup' ? 'active' : ''}`}
        onClick={() => onSelectPage('project-setup')}
        aria-label="Project Settings"
        title="Project Settings (Tenant & Project Scoped)"
        aria-current={activePage === 'project-setup' ? 'page' : undefined}
      >
        <FileCog size={16} />
        <span>Project Settings</span>
      </button>

      {/* Group 3: Storage & Governance */}
      <div className="sidebar-heading">Storage & Governance</div>

      <button
        type="button"
        className={`nav-item ${activePage === 'persistence' ? 'active' : ''}`}
        onClick={() => onSelectPage('persistence')}
        aria-label="Persistence & Storage"
        title="Persistence & Storage"
        aria-current={activePage === 'persistence' ? 'page' : undefined}
      >
        <HardDrive size={16} />
        <span>Persistence & Storage</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'policy' ? 'active' : ''}`}
        onClick={() => onSelectPage('policy')}
        aria-label="Policy & Guardrails"
        title="Policy & Guardrails"
        aria-current={activePage === 'policy' ? 'page' : undefined}
      >
        <ShieldAlert size={16} />
        <span>Policy & Guardrails</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'roles' ? 'active' : ''}`}
        onClick={() => onSelectPage('roles')}
        aria-label="Roles & RBAC"
        title="Roles & RBAC"
        aria-current={activePage === 'roles' ? 'page' : undefined}
      >
        <KeyRound size={16} />
        <span>Roles & RBAC</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'governance' ? 'active' : ''}`}
        onClick={() => onSelectPage('governance')}
        aria-label="Governance & Audit"
        title="Governance & Audit"
        aria-current={activePage === 'governance' ? 'page' : undefined}
      >
        <ShieldCheck size={16} />
        <span>Governance & Audit</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'knowledge' ? 'active' : ''}`}
        onClick={() => onSelectPage('knowledge')}
        aria-label="Knowledge & RAG"
        title="Knowledge & RAG"
        aria-current={activePage === 'knowledge' ? 'page' : undefined}
      >
        <BookOpen size={16} />
        <span>Knowledge & RAG</span>
      </button>

      {/* Group 4: Administration */}
      <div className="sidebar-heading">Administration</div>

      <button
        type="button"
        className={`nav-item ${activePage === 'users' ? 'active' : ''}`}
        onClick={() => onSelectPage('users')}
        aria-label="Users & IAM"
        title="Users & IAM"
        aria-current={activePage === 'users' ? 'page' : undefined}
      >
        <Users size={16} />
        <span>Users & IAM</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'billing' ? 'active' : ''}`}
        onClick={() => onSelectPage('billing')}
        aria-label="Token Usage & Cost"
        title="Token Usage & Cost"
        aria-current={activePage === 'billing' ? 'page' : undefined}
      >
        <CreditCard size={16} />
        <span>Token Usage & Cost</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'settings' ? 'active' : ''}`}
        onClick={() => onSelectPage('settings')}
        aria-label="Platform Settings"
        title="Platform Settings (Server Deployment & Infrastructure)"
        aria-current={activePage === 'settings' ? 'page' : undefined}
      >
        <Settings size={16} />
        <span>Platform Settings</span>
      </button>
    </nav>
  );
};
