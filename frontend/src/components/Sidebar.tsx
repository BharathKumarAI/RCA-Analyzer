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
  Zap
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
  | 'persistence'
  | 'policy'
  | 'roles'
  | 'governance'
  | 'knowledge'
  | 'users'
  | 'billing'
  | 'settings';

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
      >
        <LayoutDashboard size={16} />
        <span>Overview</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'runs' ? 'active' : ''}`}
        onClick={() => onSelectPage('runs')}
      >
        <PlayCircle size={16} />
        <span>Investigations</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'capabilities' ? 'active' : ''}`}
        onClick={() => onSelectPage('capabilities')}
      >
        <Cpu size={16} />
        <span>Capabilities</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'runtime' ? 'active' : ''}`}
        onClick={() => onSelectPage('runtime')}
      >
        <Zap size={16} />
        <span>Runtime & ADK</span>
      </button>

      {/* Group 2: Agent Harness Studio */}
      <div className="sidebar-heading">Harness Studio</div>

      <button
        type="button"
        className={`nav-item ${activePage === 'skills' ? 'active' : ''}`}
        onClick={() => onSelectPage('skills')}
      >
        <Sparkles size={16} />
        <span>Skills Catalog</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'parameters' ? 'active' : ''}`}
        onClick={() => onSelectPage('parameters')}
      >
        <Sliders size={16} />
        <span>Parameter Studio</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'optimization' ? 'active' : ''}`}
        onClick={() => onSelectPage('optimization')}
      >
        <FlaskConical size={16} />
        <span>Optimization & MLflow</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'agents' ? 'active' : ''}`}
        onClick={() => onSelectPage('agents')}
      >
        <Bot size={16} />
        <span>Agents Fleet</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'tools' ? 'active' : ''}`}
        onClick={() => onSelectPage('tools')}
      >
        <Wrench size={16} />
        <span>Tools & Connectors</span>
      </button>

      {/* Group 3: Storage & Governance */}
      <div className="sidebar-heading">Storage & Governance</div>

      <button
        type="button"
        className={`nav-item ${activePage === 'persistence' ? 'active' : ''}`}
        onClick={() => onSelectPage('persistence')}
      >
        <HardDrive size={16} />
        <span>Persistence & Storage</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'policy' ? 'active' : ''}`}
        onClick={() => onSelectPage('policy')}
      >
        <ShieldAlert size={16} />
        <span>Policy & Guardrails</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'roles' ? 'active' : ''}`}
        onClick={() => onSelectPage('roles')}
      >
        <KeyRound size={16} />
        <span>Roles & RBAC</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'governance' ? 'active' : ''}`}
        onClick={() => onSelectPage('governance')}
      >
        <ShieldCheck size={16} />
        <span>Governance & Audit</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'knowledge' ? 'active' : ''}`}
        onClick={() => onSelectPage('knowledge')}
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
      >
        <Users size={16} />
        <span>Users & IAM</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'billing' ? 'active' : ''}`}
        onClick={() => onSelectPage('billing')}
      >
        <CreditCard size={16} />
        <span>Token Usage & Cost</span>
      </button>

      <button
        type="button"
        className={`nav-item ${activePage === 'settings' ? 'active' : ''}`}
        onClick={() => onSelectPage('settings')}
      >
        <Settings size={16} />
        <span>System Settings</span>
      </button>
    </nav>
  );
};
