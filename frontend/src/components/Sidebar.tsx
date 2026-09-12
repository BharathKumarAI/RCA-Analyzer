import React from 'react';
import {
  Activity, AlertTriangle, BookOpen, Bot, Cpu, CreditCard, FileCog, FlaskConical,
  HardDrive, HeartPulse, KeyRound, LayoutDashboard, PanelLeft, PanelLeftClose,
  PlayCircle, Settings, ShieldAlert, ShieldCheck, Sliders, Sparkles, Users, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

export type ActivePage =
  | 'overview' | 'runs' | 'capabilities' | 'runtime' | 'skills' | 'parameters'
  | 'optimization' | 'agents' | 'tools' | 'alerts' | 'health-checks' | 'project-setup'
  | 'persistence' | 'policy' | 'roles' | 'governance' | 'knowledge' | 'users' | 'billing'
  | 'settings' | 'harness-library';

interface SidebarProps {
  activePage: ActivePage;
  onSelectPage: (page: ActivePage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewInvestigation: () => void;
}

type NavItem = { page: ActivePage; label: string; icon: LucideIcon; title?: string };
const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Admin console', items: [
    { page: 'overview', label: 'Overview', icon: LayoutDashboard },
    { page: 'project-setup', label: 'Project settings', icon: FileCog },
    { page: 'settings', label: 'Platform settings', icon: Settings },
    { page: 'users', label: 'Users & Roles', icon: Users },
  ] },
  { label: 'Configuration', items: [
    { page: 'tools', label: 'Tools & connectors', icon: Wrench },
    { page: 'capabilities', label: 'Capabilities', icon: Cpu },
    { page: 'agents', label: 'Agents', icon: Bot },
    { page: 'harness-library', label: 'Harness library', icon: BookOpen },
    { page: 'skills', label: 'Skills', icon: Sparkles },
    { page: 'parameters', label: 'Parameters', icon: Sliders },
    { page: 'policy', label: 'Policy', icon: ShieldAlert },
  ] },
  { label: 'Monitoring', items: [
    { page: 'health-checks', label: 'Health checks', icon: HeartPulse },
    { page: 'alerts', label: 'Alerts', icon: AlertTriangle },
    { page: 'runtime', label: 'Runtime', icon: Zap },
    { page: 'runs', label: 'Investigations', icon: PlayCircle },
    { page: 'optimization', label: 'Optimization', icon: FlaskConical },
    { page: 'governance', label: 'Audit', icon: ShieldCheck },
    { page: 'persistence', label: 'Persistence', icon: HardDrive },
    { page: 'knowledge', label: 'Knowledge', icon: Activity },
    { page: 'billing', label: 'Billing', icon: CreditCard },
  ] },
];

export const Sidebar: React.FC<SidebarProps> = ({ activePage, onSelectPage, collapsed, onToggleCollapse }) => (
  <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Admin navigation">
    <div className="sidebar-header">
      {!collapsed && <span className="brand-badge">Workspace</span>}
      <button type="button" className="icon-btn" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
      </button>
    </div>
    <button type="button" className="sidebar-action-btn" onClick={() => onSelectPage('project-setup')} title="Open project settings">
      <FileCog size={16} /><span>Project setup</span>
    </button>
    {GROUPS.map(group => <React.Fragment key={group.label}>
      <div className="sidebar-heading">{group.label}</div>
      {group.items.map(({ page, label, icon: Icon, title }) => <button
        type="button" key={page} className={`nav-item ${activePage === page ? 'active' : ''}`}
        onClick={() => onSelectPage(page)} aria-label={label} title={title || label}
        aria-current={activePage === page ? 'page' : undefined}
      ><Icon size={16} /><span>{label}</span></button>)}
    </React.Fragment>)}
  </nav>
);
