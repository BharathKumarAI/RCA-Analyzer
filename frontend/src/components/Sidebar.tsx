import React from 'react';
import type { UiSettingsConfig } from '../types/api';
import {
  Activity, AlertTriangle, BookOpen, Bot, Cpu, CreditCard,
  FileCog, FlaskConical, HardDrive, HeartPulse, KeyRound, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, PlayCircle, Settings, ShieldAlert, ShieldCheck,
  Sliders, Sparkles, Users, Wrench, Zap, type LucideIcon,
} from 'lucide-react';

export type ActivePage =
  | 'overview' | 'runs' | 'capabilities' | 'runtime' | 'skills' | 'parameters'
  | 'optimization' | 'agents' | 'tools' | 'alerts' | 'health-checks' | 'project-setup'
  | 'persistence' | 'policy' | 'roles' | 'governance' | 'knowledge' | 'users' | 'billing'
  | 'settings' | 'harness-library';

interface SidebarProps {
  settings: UiSettingsConfig;
  activePage: ActivePage;
  onSelectPage: (page: ActivePage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewInvestigation: () => void;
}

export const PAGE_ICONS: Record<ActivePage, LucideIcon> = {
  overview: LayoutDashboard, 'project-setup': FileCog, settings: Settings,
  users: Users, roles: KeyRound, tools: Wrench, capabilities: Cpu, agents: Bot,
  'harness-library': BookOpen, skills: Sparkles, parameters: Sliders, policy: ShieldAlert,
  'health-checks': HeartPulse, alerts: AlertTriangle, runtime: Zap, runs: PlayCircle,
  optimization: FlaskConical, governance: ShieldCheck, persistence: HardDrive,
  knowledge: Activity, billing: CreditCard,
};
export const isActivePage = (page: string): page is ActivePage => Object.hasOwn(PAGE_ICONS, page);

export const Sidebar: React.FC<SidebarProps> = ({ settings, activePage, onSelectPage, collapsed, onToggleCollapse }) => {
  const groups = [...new Set(settings.navigation.filter(item => item.visible).map(item => item.group))];
  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Workspace navigation">
      <div className="sidebar-top">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      {groups.map(group => (
        <div key={group} className="sidebar-group">
          {!collapsed && (
            <div className="sidebar-heading" title={group}>
              <span className="sidebar-heading-indicator" aria-hidden="true" />
              <span className="sidebar-heading-text">{group}</span>
            </div>
          )}
          <div className="sidebar-group-items">
            {settings.navigation.filter(item => item.visible && item.group === group).map(item => {
              if (!isActivePage(item.page)) return null;
              const page = item.page;
              const Icon = page === 'roles' ? Users : PAGE_ICONS[page];
              const isItemActive = activePage === page || (page === 'roles' && activePage === 'users');
              return (
                <button
                  type="button"
                  key={page}
                  className={`nav-item ${isItemActive ? 'active' : ''}`}
                  onClick={() => onSelectPage(page)}
                  aria-label={item.label}
                  title={item.description || item.label}
                  aria-current={isItemActive ? 'page' : undefined}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
};
