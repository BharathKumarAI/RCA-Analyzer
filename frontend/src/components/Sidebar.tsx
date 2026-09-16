import React, { useEffect } from 'react';
import type { UiSettingsConfig } from '../types/api';
import {
  Activity, AlertTriangle, BarChart2, BookMarked, Bot, BrainCircuit, Cpu, CreditCard,
  Database, Fingerprint, FlaskConical, GitBranch, HeartPulse, History, Kanban,
  LayoutDashboard, Layers, PanelLeftClose, PanelLeftOpen, ChevronsLeft, ChevronsRight,
  SearchCode, Settings, Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Sparkles, ScrollText, Star, Terminal, Ticket, Users, Wrench, Zap, Shield,
  type LucideIcon,
} from 'lucide-react';
import { getProjectContext } from '../services/api';

export type ActivePage =
  | 'chat' | 'insights' | 'metrics' | 'overview' | 'runs' | 'capabilities' | 'runtime' | 'skills' | 'parameters'
  | 'optimization' | 'agents' | 'tools' | 'alerts' | 'health-checks' | 'project-setup'
  | 'persistence' | 'policy' | 'roles' | 'governance' | 'knowledge' | 'users' | 'billing'
  | 'settings' | 'harness-library' | 'triage-board'
  | 'tickets' | 'rca-workbench' | 'feedback' | 'docs' | 'platform-docs' | 'artifacts' | 'orchestration';

interface SidebarProps {
  settings: UiSettingsConfig;
  projectWorkspace?: boolean;
  canAdminister?: boolean;
  onOpenAdministration?: () => void;
  onOpenWorkspace?: () => void;
  activePage: ActivePage;
  onSelectPage: (page: ActivePage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewInvestigation: () => void;
}

export const PAGE_ICONS: Record<ActivePage, LucideIcon> = {
  // Project Workspace Pages (Tech & Terminal Style)
  'triage-board': Kanban,
  tickets: Ticket,
  'rca-workbench': SearchCode,
  feedback: Star,
  docs: BookMarked,
  'platform-docs': BookMarked,
  artifacts: Layers,
  orchestration: GitBranch,
  chat: Terminal,
  insights: Activity,
  metrics: BarChart2,
  runs: History,
  knowledge: BrainCircuit,

  // Admin & Platform Pages
  overview: LayoutDashboard,
  'project-setup': Settings2,
  settings: Settings,
  users: Users,
  roles: Fingerprint,
  tools: Wrench,
  capabilities: Cpu,
  agents: Bot,
  'harness-library': ScrollText,
  skills: Sparkles,
  parameters: SlidersHorizontal,
  policy: ShieldAlert,
  'health-checks': HeartPulse,
  alerts: AlertTriangle,
  runtime: Zap,
  optimization: FlaskConical,
  governance: ShieldCheck,
  persistence: Database,
  billing: CreditCard,
};
export const isActivePage = (page: string): page is ActivePage => Object.hasOwn(PAGE_ICONS, page);

export const Sidebar: React.FC<SidebarProps> = ({
  settings,
  activePage,
  onSelectPage,
  collapsed,
  onToggleCollapse,
  projectWorkspace,
  canAdminister,
  onOpenAdministration,
  onOpenWorkspace,
}) => {
  // Global ⌘B / Ctrl+B keyboard shortcut to toggle sidebar collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onToggleCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleCollapse]);

  const PROJECT_PAGE_KEYS = [
    'triage-board', 'tickets', 'rca-workbench', 'chat', 'runs',
    'feedback', 'artifacts', 'orchestration', 'knowledge', 'insights', 'docs', 'platform-docs', 'metrics',
    ...(canAdminister ? ['project-setup'] : []),
  ];

  const navigation = settings.navigation
    .filter(item =>
      item.visible &&
      (projectWorkspace
        ? PROJECT_PAGE_KEYS.includes(item.page)
        : !['triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration', 'knowledge', 'insights', 'docs', 'project-setup'].includes(item.page))
    );

  const groups = [...new Set(navigation.map(item => item.group))];

  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      aria-label="Workspace navigation"
      onClick={collapsed ? onToggleCollapse : undefined}
      title={collapsed ? 'Click to expand sidebar (⌘B)' : undefined}
    >
      {/* Floating Edge Expander Tab (Visibly prominent on right border when collapsed) */}
      {collapsed && (
        <button
          type="button"
          className="sidebar-edge-toggle"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          title="Expand sidebar (⌘B)"
          aria-label="Expand sidebar (⌘B)"
        >
          <ChevronsRight size={14} strokeWidth={2.5} />
          <span className="sidebar-edge-dot" aria-hidden="true" />
        </button>
      )}

      {/* Top Brand Header Area & Header Expander */}
      <div className="sidebar-top">
        <div className="sidebar-brand-wrapper">
          <div className="sidebar-brand-emblem" aria-hidden="true">
            <Activity size={16} strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-name">{settings.brand_name}</span>
              <span className="sidebar-brand-sub">
                {projectWorkspace ? (
                  <span className="sidebar-scope-pill project" title={getProjectContext() || 'Project Scope'}>
                    <span className="sidebar-scope-dot" aria-hidden="true" />
                    <span className="sidebar-scope-name">{getProjectContext() || 'Project'}</span>
                  </span>
                ) : (
                  <span className="sidebar-scope-pill admin" title="Platform Administration">
                    <Shield size={10} strokeWidth={2.5} />
                    <span>Admin</span>
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {!collapsed && (
          <button
            type="button"
            className="sidebar-header-collapse-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            title="Collapse sidebar (⌘B)"
            aria-label="Collapse sidebar (⌘B)"
          >
            <ChevronsLeft size={16} />
          </button>
        )}
      </div>

      <div className="sidebar-content">
        {!projectWorkspace && (
          <button
            type="button"
            className="nav-item sidebar-workspace-link"
            onClick={onOpenWorkspace}
            title="Open team workspace"
          >
            <span className="nav-item-icon">
              <Terminal size={16} />
            </span>
            {!collapsed && <span>Open team workspace</span>}
          </button>
        )}

        {groups.map((group) => (
          <div key={group} className="sidebar-group">
            {!collapsed && (
              <div className="sidebar-heading" title={group}>
                <span className="sidebar-heading-indicator" aria-hidden="true" />
                <span className="sidebar-heading-text">{group}</span>
              </div>
            )}
            <div className="sidebar-group-items">
              {navigation
                .filter((item) => item.group === group)
                .map((item) => {
                  if (!isActivePage(item.page)) return null;
                  const page = item.page;
                  const Icon = PAGE_ICONS[page];
                  const isItemActive = activePage === page || (page === 'roles' && activePage === 'users');
                  return (
                    <button
                      type="button"
                      key={page}
                      className={`nav-item ${isItemActive ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPage(page);
                      }}
                      aria-label={item.label}
                      title={collapsed ? item.label : item.description || item.label}
                      aria-current={isItemActive ? 'page' : undefined}
                    >
                      <span className="nav-item-icon">
                        <Icon size={16} />
                      </span>
                      {!collapsed && <span>{item.label}</span>}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}

        {projectWorkspace && canAdminister && (
          <button
            type="button"
            className="nav-item sidebar-admin-link"
            onClick={onOpenAdministration}
            title="Administration"
          >
            <span className="nav-item-icon">
              <Settings size={16} />
            </span>
            {!collapsed && <span>Administration</span>}
          </button>
        )}
      </div>

      {/* Sidebar Footer Dock with Collapse/Expand Controls */}
      <div className="sidebar-footer-dock">
        {!collapsed ? (
          <button
            type="button"
            className="sidebar-dock-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            title="Collapse sidebar (⌘B)"
            aria-label="Collapse sidebar (⌘B)"
          >
            <PanelLeftClose size={15} />
            <span className="sidebar-dock-text">Collapse sidebar</span>
            <kbd className="sidebar-kbd">⌘B</kbd>
          </button>
        ) : (
          <button
            type="button"
            className="sidebar-dock-btn-collapsed"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            title="Expand sidebar (⌘B)"
            aria-label="Expand sidebar (⌘B)"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
      </div>
    </aside>
  );
};
