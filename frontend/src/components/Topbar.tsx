import React from 'react';
import {
  Activity,
  Search,
  Sun,
  Moon,
  Bell
} from 'lucide-react';
import { Principal, SystemHealth } from '../types/api';
import { ActivePage } from './Sidebar';
import type { UiSettingsConfig } from '../types/api';

interface TopbarProps {
  settings: UiSettingsConfig;
  health: SystemHealth;
  principal: Principal;
  theme: 'dark' | 'light';
  activePage?: ActivePage;
  projectKey?: string | null;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenSession: () => void;
  onOpenAlerts: () => void;
  unreadNotificationsCount?: number;
  onNewInvestigation?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  settings,
  principal,
  health,
  theme,
  activePage = 'overview',
  projectKey = null,
  onToggleTheme,
  onOpenSearch,
  onOpenSession,
  onOpenAlerts,
  unreadNotificationsCount = 0,
}) => {
  const currentNav = settings.navigation.find(item => item.page === activePage);
  const currentGroup = currentNav?.group;
  const currentCrumb = currentNav?.label || activePage;

  return (
    <header className="topbar">
      {/* Brand & Breadcrumb */}
      <div className="topbar-brand">
        <div className="brand-icon">
          <Activity size={17} strokeWidth={2.5} />
        </div>
        <div className="brand-info">
          <div className="brand-title">
            <span title={settings.brand_name}>{settings.brand_name}</span>
          </div>
          {currentGroup && (
            <>
              <span className="topbar-crumb-sep">/</span>
              <span className="topbar-crumb-group" title={currentGroup}>{currentGroup}</span>
            </>
          )}
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
          title="Search admin console (⌘K)"
        >
          <Search size={14} />
          <span>Search admin console…</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      {/* Right Cluster: Clean & Uncluttered */}
      <div className="topbar-right">
        <div className="telemetry-pill" title={`Platform ${health.mode} status`}>
          <span className="telemetry-dot" />
          <span>{health.mode === 'live' ? 'Live' : 'Demo'}</span>
        </div>
        <span className="scope-pill" title={projectKey ? "Authenticated project workspace" : "Templates and configuration setup"}>
          {projectKey ? `/p/${projectKey}` : 'Administration'}
        </span>

        <button
          type="button"
          className="icon-btn topbar-bell-btn"
          onClick={onOpenAlerts}
          title={unreadNotificationsCount > 0 ? `${unreadNotificationsCount} unread notification${unreadNotificationsCount === 1 ? '' : 's'}` : "Open operational alerts & notifications"}
          aria-label={unreadNotificationsCount > 0 ? `${unreadNotificationsCount} unread notification${unreadNotificationsCount === 1 ? '' : 's'}` : "Open operational alerts and notifications"}
        >
          <Bell size={15} />
          {unreadNotificationsCount > 0 && (
            <span className="topbar-bell-badge">
              {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
            </span>
          )}
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
