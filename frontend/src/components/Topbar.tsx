import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  ChevronDown,
  Search,
  Sun,
  Moon,
  Bell,
  Plus,
  RotateCw,
  Shield,
  LogOut,
  SlidersHorizontal,
  FolderGit2,
  ArrowRight,
} from 'lucide-react';
import type { Principal, SystemHealth, UiSettingsConfig } from '../types/api';
import type { ProjectDirectory } from '../services/projects';
import { type ActivePage, isActivePage } from './Sidebar';

export interface TopbarProps {
  settings: UiSettingsConfig;
  health: SystemHealth;
  healthUpdatedAt?: Date | null;
  healthError?: boolean;
  telemetryRefreshing?: boolean;
  onRefreshTelemetry?: () => Promise<void> | void;
  principal: Principal;
  theme: 'dark' | 'light';
  activePage?: ActivePage;
  projectKey?: string | null;
  unreadNotificationsCount?: number;
  notificationsUnavailable?: boolean;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenSession: () => void;
  onOpenAlerts: () => void;
  onNewInvestigation?: () => void;
  onNavigate?: (page: ActivePage) => void;
  onSignOut?: () => void;
  projectSelector?: React.ReactNode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  canAdmin?: boolean;
  onSwitchToProject?: (projectId?: string) => void;
  projects?: ProjectDirectory | null;
}

const ROLE_PRIORITY_ORDER: Record<string, { rank: number; label: string }> = {
  PLATFORM_ADMIN: { rank: 1, label: 'Admin' },
  PROJECT_OWNER: { rank: 2, label: 'Owner' },
  PROJECT_MANAGER: { rank: 3, label: 'Manager' },
  PROJECT_ANALYST: { rank: 4, label: 'Analyst' },
  PROJECT_VIEWER: { rank: 5, label: 'Viewer' },
  GENERIC_USER: { rank: 6, label: 'User' },
};

function getPrimaryRole(roles: string[] = []): string {
  let best = { rank: 999, label: roles[0] || 'Member' };
  for (const role of roles) {
    const candidate = ROLE_PRIORITY_ORDER[role];
    if (candidate && candidate.rank < best.rank) {
      best = candidate;
    }
  }
  return best.label;
}

function formatRelativeFreshness(date: Date | null | undefined): string {
  if (!date) return 'Unavailable';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const Topbar: React.FC<TopbarProps> = ({
  settings,
  health,
  healthUpdatedAt = null,
  healthError = false,
  telemetryRefreshing = false,
  onRefreshTelemetry,
  principal,
  theme,
  activePage = 'overview',
  projectKey = null,
  unreadNotificationsCount = 0,
  notificationsUnavailable = false,
  onToggleTheme,
  onOpenSearch,
  onOpenSession,
  onOpenAlerts,
  onNewInvestigation,
  onNavigate,
  onSignOut,
  projectSelector,
  canAdmin,
  onSwitchToProject,
  projects,
}) => {
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moduleNavOpen, setModuleNavOpen] = useState(false);
  const [scopeNavOpen, setScopeNavOpen] = useState(false);
  const [moduleFilter, setModuleFilter] = useState('');

  const telemetryRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const moduleNavRef = useRef<HTMLDivElement>(null);
  const scopeNavRef = useRef<HTMLDivElement>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const moduleTriggerRef = useRef<HTMLButtonElement>(null);

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (scopeNavOpen) {
          setScopeNavOpen(false);
          scopeTriggerRef.current?.focus();
        }
        if (moduleNavOpen) {
          setModuleNavOpen(false);
          moduleTriggerRef.current?.focus();
        }
        setTelemetryOpen(false);
        setUserMenuOpen(false);
      }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (telemetryRef.current && !telemetryRef.current.contains(event.target as Node)) {
        setTelemetryOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (moduleNavRef.current && !moduleNavRef.current.contains(event.target as Node)) {
        setModuleNavOpen(false);
      }
      if (scopeNavRef.current && !scopeNavRef.current.contains(event.target as Node)) {
        setScopeNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [scopeNavOpen, moduleNavOpen]);

  const currentNav = settings.navigation.find(item => item.page === activePage);
  const currentCrumb = currentNav?.label || activePage;
  const primaryRole = getPrimaryRole(principal.roles);
  const isHealthy = !healthError && health.status === 'healthy';
  const isDegraded = !healthError && health.status === 'degraded';
  const statusClass = healthError
    ? 'dot-error'
    : isHealthy
    ? 'dot-healthy'
    : isDegraded
    ? 'dot-degraded'
    : 'dot-unknown';

  const handleBrandClick = () => {
    if (onNavigate) {
      onNavigate(projectKey ? 'chat' : 'overview');
    }
  };

  // Grouped items for the Module Navigator popover
  const isPlatformAdmin = principal.roles.includes('PLATFORM_ADMIN');
  const visibleNavItems = settings.navigation.filter(item =>
    item.visible &&
    (projectKey
      ? ['triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration', 'knowledge', 'insights', 'metrics', ...(canAdmin ? ['project-setup'] : [])].includes(item.page)
      : (!isPlatformAdmin && ['settings', 'capabilities', 'policy'].includes(item.page)
          ? false
          : !['triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration', 'knowledge', 'insights', 'project-setup'].includes(item.page)))
  );

  const filteredNavItems = visibleNavItems.filter(item => {
    if (!moduleFilter.trim()) return true;
    const q = moduleFilter.toLowerCase();
    return item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q);
  });

  const uniqueGroups = [...new Set(filteredNavItems.map(item => item.group))];
  const groupedFilteredItems = uniqueGroups.map(group => ({
    group,
    items: filteredNavItems.filter(item => item.group === group),
  }));

  return (
    <header className={`topbar ${projectKey ? 'team-topbar' : ''}`} role="banner">
      {/* Left: Brand & Segmented Context/Module Switcher */}
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-brand-btn"
          onClick={handleBrandClick}
          title={`${settings.brand_name} - Open ${projectKey ? 'Chat' : 'overview'}`}
        >
          <div className="topbar-brand-icon">
            <Activity size={16} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <span className="topbar-brand-title">{settings.brand_name}</span>
        </button>


        {/* Dual-Filter Segmented Switcher: Filter 1 (Scope Dropdown) | Filter 2 (Page Dropdown) */}
        <div className="topbar-segmented-switcher topbar-dual-pill">
          {/* Filter 1: Scope Dropdown (Project Scope or Admin Console) */}
          {projectKey && projectSelector ? (
            <div className="topbar-scope-wrapper">
              {projectSelector}
            </div>
          ) : (
            <div className="topbar-scope-wrapper" ref={scopeNavRef}>
              <button
                ref={scopeTriggerRef}
                type="button"
                className={`topbar-scope-trigger ${scopeNavOpen ? 'active' : ''}`}
                onClick={() => {
                  setScopeNavOpen(open => !open);
                  setModuleNavOpen(false);
                  setTelemetryOpen(false);
                  setUserMenuOpen(false);
                }}
                title="Platform Administration Console. Click to switch project or scope."
                aria-expanded={scopeNavOpen}
                aria-haspopup="dialog"
              >
                <span className="segmented-tag">
                  <Shield size={12} aria-hidden="true" />
                  <span>ADMIN CONSOLE</span>
                  <ChevronDown
                    size={11}
                    className={`segmented-chevron ${scopeNavOpen ? 'rotated' : ''}`}
                    aria-hidden="true"
                  />
                </span>
              </button>

              {/* Admin Scope Popover: Current Admin Console + Switch to Projects */}
              {scopeNavOpen && (
                <div className="topbar-popover topbar-scope-popover" role="dialog" aria-label="Scope and Project Switcher">
                  <div className="scope-popover-header">
                    <span className="scope-popover-title">Platform Scope</span>
                    <span className="badge badge-purple">Tenant Fleet</span>
                  </div>

                  <div className="scope-admin-current-card">
                    <div className="scope-admin-card-icon">
                      <Shield size={15} aria-hidden="true" />
                    </div>
                    <div className="scope-admin-card-info">
                      <span className="scope-admin-card-title">Admin Console</span>
                      <span className="scope-admin-card-sub">Fleet operations across all projects</span>
                    </div>
                    <span className="scope-active-check">✓ Active</span>
                  </div>

                  <div className="scope-project-section">
                    <div className="scope-project-header">
                      <span className="scope-project-heading">
                        Switch to Project Workspace ({projects?.items?.length || 0})
                      </span>
                    </div>

                    <div className="scope-project-list">
                      {projects?.items && projects.items.length > 0 ? (
                        projects.items.map(p => {
                          const initials = p.project_id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'PR';
                          return (
                            <button
                              key={p.project_id}
                              type="button"
                              className="scope-project-btn"
                              onClick={() => {
                                setScopeNavOpen(false);
                                if (onSwitchToProject) onSwitchToProject(p.project_id);
                              }}
                              title={`Open ${p.name} (${p.project_id}) workspace`}
                            >
                              <div className="project-avatar-box">
                                {initials}
                              </div>
                              <div className="scope-project-btn-details">
                                <span className="scope-project-btn-name">{p.name}</span>
                                <span className="scope-project-btn-key mono">{p.project_id}</span>
                              </div>
                              <ArrowRight size={13} className="scope-project-arrow" aria-hidden="true" />
                            </button>
                          );
                        })
                      ) : (
                        <div className="scope-project-empty">No projects registered in tenant</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <span className="segmented-divider" aria-hidden="true" />

          {/* Filter 2: Page Dropdown (Admin Console Pages or Project Pages) */}
          <div className="topbar-page-wrapper" ref={moduleNavRef}>
            <button
              ref={moduleTriggerRef}
              type="button"
              className={`topbar-page-trigger ${moduleNavOpen ? 'active' : ''}`}
              onClick={() => {
                setModuleNavOpen(open => !open);
                setScopeNavOpen(false);
                setTelemetryOpen(false);
                setUserMenuOpen(false);
              }}
              title={`Page: ${currentCrumb}. Click to switch page.`}
              aria-expanded={moduleNavOpen}
              aria-haspopup="dialog"
            >
              <span className="segmented-title">{currentCrumb}</span>
              <ChevronDown
                size={12}
                className={`segmented-chevron ${moduleNavOpen ? 'rotated' : ''}`}
                aria-hidden="true"
              />
            </button>

            {/* Page Navigator Dropdown Popover */}
            {moduleNavOpen && (
              <div className="topbar-popover topbar-module-popover" role="dialog" aria-label="Page Navigation">
                <div className="module-popover-header">
                  <span className="module-popover-title">
                    {projectKey ? `Project Workspace Pages` : 'Admin Console Pages'}
                  </span>
                  <span className="module-popover-count">
                    {filteredNavItems.length} pages
                  </span>
                </div>

                <div className="module-search-wrap">
                  <Search size={12} className="module-search-icon" aria-hidden="true" />
                  <input
                    type="text"
                    value={moduleFilter}
                    onChange={(e) => setModuleFilter(e.target.value)}
                    placeholder="Filter workspace modules..."
                    className="module-search-input"
                    autoFocus
                  />
                  {moduleFilter && (
                    <button
                      type="button"
                      className="module-search-clear"
                      onClick={() => setModuleFilter('')}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="module-groups-list">
                  {groupedFilteredItems.map(({ group, items }) => (
                    <div key={group} className="module-group-block">
                      <span className="module-group-heading">{group}</span>
                      <div className="module-group-grid">
                        {items.map((item) => {
                          const isItemActive = activePage === item.page;
                          return (
                            <button
                              key={item.page}
                              type="button"
                              className={`module-item-btn ${isItemActive ? 'active' : ''}`}
                              onClick={() => {
                                setModuleNavOpen(false);
                                setModuleFilter('');
                                if (onNavigate && isActivePage(item.page)) onNavigate(item.page);
                              }}
                            >
                              <span className="module-item-name">{item.label}</span>
                              {isItemActive && <span className="module-active-dot" aria-hidden="true" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {groupedFilteredItems.length === 0 && (
                    <div className="module-empty-state">No matching modules found</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center: Command Search Bar */}
      <div className="topbar-center">
        <button
          type="button"
          className="topbar-search-btn"
          onClick={onOpenSearch}
          title="Search workspace pages (⌘K)"
          aria-label="Search workspace pages (⌘K)"
        >
          <Search size={14} aria-hidden="true" />
          <span className="topbar-search-text">Search pages</span>
          <kbd className="topbar-search-kbd">⌘K</kbd>
        </button>
      </div>

      {/* Right: 3 Clustered Zones with Dividers */}
      <div className="topbar-right">
        {/* Zone 1: Primary Action CTA */}
        {onNewInvestigation && activePage !== 'chat' && (
          <div className="topbar-action-group">
            <button
              type="button"
              className="topbar-action-btn"
              onClick={onNewInvestigation}
              title="Start a new chat investigation"
              aria-label="New investigation (Chat)"
            >
              <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
              <span>New investigation</span>
            </button>
          </div>
        )}

        {onNewInvestigation && activePage !== 'chat' && (
          <div className="topbar-divider" aria-hidden="true" />
        )}

        {/* Zone 2: Compact Utility Icons Dock */}
        <div className="topbar-utility-dock">
          {/* Telemetry Pill & Popover */}
          <div className="topbar-menu-wrapper" ref={telemetryRef}>
            <button
              type="button"
              className={`topbar-telemetry-pill ${telemetryOpen ? 'active' : ''}`}
              onClick={() => {
                setTelemetryOpen(open => !open);
                setUserMenuOpen(false);
                setModuleNavOpen(false);
              }}
              title="Inspect platform telemetry & execution status"
              aria-expanded={telemetryOpen}
              aria-haspopup="dialog"
            >
              <span className={`telemetry-dot ${statusClass}`} aria-hidden="true" />
              <span className="telemetry-mode">
                {health.mode === 'live' ? 'Mode: Live' : 'Mode: Demo'}
              </span>
              <span className="telemetry-divider" aria-hidden="true" />
              <span
                className="telemetry-latency"
                title="Client round-trip API response time"
              >
                {healthError || !healthUpdatedAt ? 'Unavailable' : `${health.latency_ms}ms`}
              </span>
              {health.active_runs > 0 && (
                <span
                  className="telemetry-runs-badge"
                  title={`${health.active_runs} active investigation run${health.active_runs === 1 ? '' : 's'}`}
                >
                  ⚡ {health.active_runs}
                </span>
              )}
              <ChevronDown size={11} className="telemetry-chevron" aria-hidden="true" />
            </button>

            {telemetryOpen && (
              <div className="topbar-popover telemetry-popover" role="dialog" aria-label="Platform Telemetry">
                <div className="popover-header">
                  <div className="popover-title-row">
                    <span className="popover-title">Platform Telemetry</span>
                    <span className={`popover-status-badge ${statusClass}`}>
                      {healthError ? 'Unavailable' : health.status}
                    </span>
                  </div>
                  <span className="popover-subtitle">
                    API response time refreshed {formatRelativeFreshness(healthUpdatedAt)}
                  </span>
                </div>

                <div className="popover-body">
                  <div className="telemetry-grid">
                    <div className="telemetry-row">
                      <span className="telemetry-label">Execution Mode</span>
                      <span className="telemetry-val">
                        {health.mode === 'live' ? 'Live execution' : 'Demo simulation'}
                      </span>
                    </div>
                    <div className="telemetry-row">
                      <span className="telemetry-label">API Response Time</span>
                      <span className="telemetry-val">
                        {healthError || !healthUpdatedAt ? 'Unavailable' : `${health.latency_ms} ms (round-trip)`}
                      </span>
                    </div>
                    <div className="telemetry-row">
                      <span className="telemetry-label">Active Investigations</span>
                      <span className="telemetry-val">{health.active_runs}</span>
                    </div>
                    <div className="telemetry-row">
                      <span className="telemetry-label">Total Completed Runs</span>
                      <span className="telemetry-val">{health.total_runs}</span>
                    </div>
                    <div className="telemetry-row">
                      <span className="telemetry-label">Tenant ID</span>
                      <code className="telemetry-code">{health.tenant_id || principal.tenant_id || '—'}</code>
                    </div>
                    <div className="telemetry-row">
                      <span className="telemetry-label">{projectKey ? 'Project Scope' : 'Active Scope'}</span>
                      <code className="telemetry-code">
                        {projectKey ? (health.project_id || principal.project_id || '—') : 'Platform Fleet (All Projects)'}
                      </code>
                    </div>
                    {healthUpdatedAt && (
                      <div className="telemetry-row">
                        <span className="telemetry-label">Last Refresh</span>
                        <span className="telemetry-val">{healthUpdatedAt.toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="popover-footer">
                  {onRefreshTelemetry && (
                    <button
                      type="button"
                      className="btn btn-secondary popover-action-btn"
                      onClick={() => void onRefreshTelemetry()}
                      disabled={telemetryRefreshing}
                    >
                      <RotateCw size={13} className={telemetryRefreshing ? 'spin' : ''} aria-hidden="true" />
                      <span>{telemetryRefreshing ? 'Refreshing…' : 'Refresh telemetry'}</span>
                    </button>
                  )}
                  {onNavigate && (
                    <button
                      type="button"
                      className="btn btn-secondary popover-action-btn"
                      onClick={() => {
                        setTelemetryOpen(false);
                        onNavigate('health-checks');
                      }}
                    >
                      <SlidersHorizontal size={13} aria-hidden="true" />
                      <span>Full health checks</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Notifications / Alerts */}
          <button
            type="button"
            className="topbar-icon-btn topbar-bell-btn"
            onClick={onOpenAlerts}
            title={
              notificationsUnavailable
                ? 'Notification status unavailable. Click to view alerts.'
                : unreadNotificationsCount > 0
                ? `${unreadNotificationsCount} unread operational alert${unreadNotificationsCount === 1 ? '' : 's'}`
                : 'Operational alerts & notifications'
            }
            aria-label={
              notificationsUnavailable
                ? 'Notification status unavailable. Click to view alerts.'
                : unreadNotificationsCount > 0
                ? `${unreadNotificationsCount} unread operational alerts`
                : 'Open alerts and notifications'
            }
          >
            <Bell size={15} aria-hidden="true" />
            {notificationsUnavailable ? (
              <span className="topbar-bell-badge badge-unavailable" title="Notification status unavailable">
                !
              </span>
            ) : unreadNotificationsCount > 0 ? (
              <span className="topbar-bell-badge" aria-label={`${unreadNotificationsCount} unread`}>
                {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
              </span>
            ) : null}
          </button>

          {/* Theme Switcher */}
          <button
            type="button"
            className="topbar-icon-btn topbar-theme-btn"
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          </button>
        </div>

        <div className="topbar-divider" aria-hidden="true" />

        {/* Zone 3: Fluid User Session Menu with Live Online Dot */}
        <div className="topbar-menu-wrapper" ref={userMenuRef}>
          <button
            type="button"
            className={`topbar-user-btn ${userMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setUserMenuOpen(open => !open);
              setTelemetryOpen(false);
              setModuleNavOpen(false);
            }}
            title={`Signed in as ${principal.subject} (${primaryRole})`}
            aria-expanded={userMenuOpen}
            aria-haspopup="dialog"
          >
            <div className="topbar-user-avatar-wrap">
              <div className="topbar-user-avatar" aria-hidden="true">
                {principal.subject.charAt(0).toUpperCase()}
              </div>
              <span className="user-online-dot" aria-label="Online status" />
            </div>
            <div className="topbar-user-info">
              <span className="topbar-user-name">{principal.subject.split('@')[0]}</span>
              <span className="topbar-role-badge">{primaryRole}</span>
            </div>
            <ChevronDown size={12} className="topbar-user-chevron" aria-hidden="true" />
          </button>

          {userMenuOpen && (
            <div className="topbar-popover user-popover" role="dialog" aria-label="Session Account Details">
              <div className="popover-header">
                <div className="user-popover-identity">
                  <div className="topbar-user-avatar-wrap">
                    <div className="user-popover-avatar" aria-hidden="true">
                      {principal.subject.charAt(0).toUpperCase()}
                    </div>
                    <span className="user-online-dot" aria-label="Online status" />
                  </div>
                  <div className="user-popover-details">
                    <span className="user-popover-subject" title={principal.subject}>
                      {principal.subject}
                    </span>
                    <div className="user-roles-list">
                      {principal.roles.map(role => (
                        <span key={role} className="user-role-tag">
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="popover-body">
                <div className="telemetry-grid">
                  <div className="telemetry-row">
                    <span className="telemetry-label">Tenant ID</span>
                    <code className="telemetry-code">{principal.tenant_id}</code>
                  </div>
                  <div className="telemetry-row">
                    <span className="telemetry-label">{projectKey ? 'Project Scope' : 'Active Scope'}</span>
                    <code className="telemetry-code">
                      {projectKey ? principal.project_id : 'Platform Fleet (All Projects)'}
                    </code>
                  </div>
                </div>
              </div>

              <div className="popover-footer user-popover-footer">
                <button
                  type="button"
                  className="btn btn-secondary popover-action-btn"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onOpenSession();
                  }}
                >
                  <Shield size={13} aria-hidden="true" />
                  <span>Session details</span>
                </button>

                {onSignOut && (
                  <button
                    type="button"
                    className="btn btn-secondary popover-action-btn popover-danger-btn"
                    onClick={() => {
                      setUserMenuOpen(false);
                      onSignOut();
                    }}
                  >
                    <LogOut size={13} aria-hidden="true" />
                    <span>Sign out</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
