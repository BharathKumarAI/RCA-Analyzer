import React, { useState, useEffect, lazy, Suspense } from 'react';
import { flushSync } from 'react-dom';
import { Topbar } from './components/Topbar';
import { Sidebar, ActivePage, isActivePage } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { SessionModal } from './components/SessionModal';
import { ProjectAccessDialog } from './components/ProjectAccessDialog';
import { NewProjectDialog, ProjectSwitcher } from './components/ProjectWorkspace';
import { createProject, fetchProjects, selectProject } from './services/projects';
import type { CreateProjectInput, ProjectDirectory } from './services/projects';


const Insights = lazy(() => import('./pages/Insights').then(module => ({ default: module.Insights })));
const Metrics = lazy(() => import('./pages/Metrics').then(module => ({ default: module.Metrics })));
const Chat = lazy(() => import('./pages/Chat').then(module => ({ default: module.Chat })));
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
const TriageBoard = lazy(() => import('./pages/TriageBoard').then(module => ({ default: module.TriageBoard })));
const ProjectTickets = lazy(() => import('./pages/ProjectTickets').then(module => ({ default: module.ProjectTickets })));
const RCAWorkbench = lazy(() => import('./pages/RCAWorkbench').then(module => ({ default: module.RCAWorkbench })));
const ProjectFeedback = lazy(() => import('./pages/ProjectFeedback').then(module => ({ default: module.ProjectFeedback })));
const Docs = lazy(() => import('./pages/Docs').then(module => ({ default: module.Docs })));
const Artifacts = lazy(() => import('./pages/Artifacts').then(module => ({ default: module.Artifacts })));
const Orchestration = lazy(() => import('./pages/Orchestration').then(module => ({ default: module.Orchestration })));
const Landing = lazy(() => import('./pages/Landing').then(module => ({ default: module.Landing })));
const PageNotFound = lazy(() => import('./pages/Landing').then(module => ({ default: module.PageNotFound })));

import {
  fetchUiSettings,
  fetchHealth,
  fetchPrincipal,
  fetchAgents,
  fetchRuns,
  fetchTools,
  fetchAuditLogs,
  fetchNotifications,
  getSessionGeneration,
  fetchAuthSession,
  logoutSession,
  setSessionToken,
  setProjectContext,
  uploadKnowledgeDoc,
  ApiError,
} from './services/api';
import { SystemHealth, Principal, AgentConfiguration, Run, UiSettingsConfig } from './types/api';

type LocationRoute = { projectKey: string | null; page: ActivePage | null; invalidProjectKey: boolean };

const pageFromSegment = (segment: string | undefined): ActivePage | null => {
  if (!segment) return null;
  const normalized = segment.toLowerCase() === 'project' ? 'project-setup' : segment.toLowerCase();
  return isActivePage(normalized) ? normalized : null;
};

const readLocationRoute = (): LocationRoute => {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const normalizedPathParts = pathParts.map(part => part.toLowerCase());
  const projectIndex = pathParts.findIndex(part => part.toLowerCase() === 'p');
  if (projectIndex >= 0 && pathParts[projectIndex + 1]) {
    let projectKey: string;
    try {
      projectKey = decodeURIComponent(pathParts[projectIndex + 1]);
    } catch {
      return { projectKey: null, page: null, invalidProjectKey: true };
    }
    return {
      projectKey,
      page: pageFromSegment(pathParts[projectIndex + 2]) || 'chat',
      invalidProjectKey: false,
    };
  }
  if (normalizedPathParts[0] === 'admin' && pathParts[1] && pathParts[2]) {
    try {
      const candidateProjectKey = decodeURIComponent(pathParts[1]);
      const candidatePage = pageFromSegment(pathParts[2]);
      return {
        projectKey: candidateProjectKey,
        page: candidatePage || 'overview',
        invalidProjectKey: false,
      };
    } catch {
      return { projectKey: null, page: null, invalidProjectKey: true };
    }
  }
  if (['admin', 'admins'].includes(normalizedPathParts[0]) && pathParts[1]) {
    return {
      projectKey: null,
      page: pageFromSegment(pathParts[1]),
      invalidProjectKey: false,
    };
  }
  const hashPage = pageFromSegment(window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0]);
  return { projectKey: null, page: hashPage, invalidProjectKey: false };
};

const projectPath = (projectKey: string, page: ActivePage, search = window.location.search) => `/p/${encodeURIComponent(projectKey)}/${page}${search}`;

class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, errorInfo: unknown) {
    console.error('PageErrorBoundary caught error:', error, errorInfo);
  }
  render() {
    if (this.state.failed) return <div className="notice-banner" role="alert" style={{ margin: 24 }}>
      <p>This page could not load. The application may have been updated. Reload to reconnect your session and try again.</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload application</button>
    </div>;
    return this.props.children;
  }
}

export const App: React.FC = () => {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const syncLocation = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);
  // The introduction does not load private APIs or prompt for a token.
  if (pathname === '/') return <Suspense fallback={<div role="status" style={{ padding: 24 }}>Loading RCA assist…</div>}><Landing /></Suspense>;
  if (/^\/(?:admins?(?:\/|$)|p\/|workspace\/?$)/.test(pathname)) return <WorkspaceApp />;
  return <Suspense fallback={<div role="status">Loading page…</div>}><PageNotFound /></Suspense>;
};

const WorkspaceApp: React.FC = () => {
  const [activePage, setActivePage] = useState<ActivePage>(() => readLocationRoute().page || 'overview');
  const [routeProjectKey, setRouteProjectKey] = useState<string | null>(() => readLocationRoute().projectKey);
  const [invalidProjectRoute, setInvalidProjectRoute] = useState(() => readLocationRoute().invalidProjectKey);
  const [initialRunId, setInitialRunId] = useState<string | undefined>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [uiSettings, setUiSettings] = useState<UiSettingsConfig | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiReload, setUiReload] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [chatRequestVersion, setChatRequestVersion] = useState(0);
  const [initialCapability, setInitialCapability] = useState<string | undefined>();
  const [projects, setProjects] = useState<ProjectDirectory | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectAccessOpen, setProjectAccessOpen] = useState(false);
  const [projectCreationStatus, setProjectCreationStatus] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const openProjectCreation = () => {
    if (window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) setNewProjectOpen(true);
  };
  const openInvestigation = (capability?: string) => {
    if (!window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) return;
    setInitialCapability(capability); setChatRequestVersion(value => value + 1); handleSelectPage('chat', undefined, true);
  };

  const applyUiSettings = (next: UiSettingsConfig) => {
    setUiSettings(next);
    setTheme(next.default_theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : next.default_theme);
    document.title = next.brand_name;
  };

  // Core Data
  const [health, setHealth] = useState<SystemHealth>({ status: 'error', latency_ms: 0, tenant_id: '', project_id: '', mode: 'demo', active_runs: 0, total_runs: 0, mttr_minutes: 0, tool_success_rate: 0, active_agents_count: 0 });
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<Date | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [telemetryRefreshing, setTelemetryRefreshing] = useState(false);

  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [agents, setAgents] = useState<AgentConfiguration[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tools, setTools] = useState<import('./types/api').ToolDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<import('./types/api').AuditLog[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [notificationsUnavailable, setNotificationsUnavailable] = useState(false);

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
      const route = readLocationRoute();
      setRouteProjectKey(route.projectKey);
      setInvalidProjectRoute(route.invalidProjectKey);
      const rawHash = window.location.hash
        .replace(/^#\/?/, '')
        .split('?')[0]
        .split('/')[0]
        .toLowerCase();



      const hashStr = (window.location.hash + ' ' + window.location.pathname).toLowerCase();

      if (route.page && !rawHash) {
        setActivePage(route.page);
      } else if (isActivePage(rawHash)) {
        setActivePage(rawHash);
      } else if (rawHash.startsWith('template-') || rawHash.startsWith('registration-')) {
        setActivePage('tools');
      } else if (hashStr.includes('triage')) {
        setActivePage('triage-board');
      } else if (hashStr.includes('ticket')) {
        setActivePage('tickets');
      } else if (hashStr.includes('rca') || hashStr.includes('workbench')) {
        setActivePage('rca-workbench');
      } else if (hashStr.includes('feedback')) {
        setActivePage('feedback');
      } else if (hashStr.includes('artifact')) {
        setActivePage('artifacts');
      } else if (hashStr.includes('orchestrat')) {
        setActivePage('orchestration');
      } else if (hashStr.includes('doc')) {
        setActivePage('docs');
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
      } else if (hashStr.includes('metrics') || hashStr.includes('telemetry')) {
        setActivePage('metrics');
      } else if (hashStr.includes('insight')) {
        setActivePage('insights');
      } else {
        setActivePage('overview');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    handleHashChange();

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  const loadData = async () => {
    if (!principal) return;
    const generation = getSessionGeneration();
    setLoadingData(true);
    setLoadError(null);
    try {
      const [p, h, ag, rn, tl, logs, notices] = await Promise.allSettled([
        fetchPrincipal(), fetchHealth(),
        ['overview', 'agents'].includes(activePage) ? fetchAgents() : Promise.resolve(null),
        ['overview', 'runs'].includes(activePage) ? fetchRuns() : Promise.resolve(null),
        activePage === 'tools' ? fetchTools() : Promise.resolve(null),
        activePage === 'governance' ? fetchAuditLogs() : Promise.resolve(null),
        fetchNotifications(),
      ]);
      if (generation !== getSessionGeneration()) return;
      if (p.status === 'rejected') throw p.reason;
      if (p.value.subject !== principal.subject || p.value.tenant_id !== principal.tenant_id || p.value.project_id !== principal.project_id) return clearScopedData();
      if (JSON.stringify(p.value.roles) !== JSON.stringify(principal.roles)) return handleAuthenticated(p.value);
      const failures = [h, ag, rn, tl, logs].filter(result => result.status === 'rejected');
      const expired = failures.find(result => result.reason instanceof ApiError && result.reason.status === 401);
      if (expired) return clearScopedData(expired.reason.message);
      if (h.status === 'fulfilled') {
        setHealth(h.value);
        setHealthUpdatedAt(new Date());
        setHealthError(false);
      } else {
        setHealthError(true);
      }
      if (ag.status === 'fulfilled' && ag.value !== null) setAgents(ag.value);
      if (rn.status === 'fulfilled' && rn.value !== null) setRuns(rn.value);
      if (tl.status === 'fulfilled' && tl.value !== null) setTools(tl.value);
      if (logs.status === 'fulfilled' && logs.value !== null) setAuditLogs(logs.value);
      if (notices.status === 'fulfilled') {
        setUnreadNotificationsCount(notices.value.unread_count);
        setNotificationsUnavailable(false);
      } else {
        setNotificationsUnavailable(true);
      }
      if (failures.length) setLoadError(failures.map(result => result.reason instanceof Error ? result.reason.message : 'Some workspace data is unavailable.').join(' '));
    } catch (error) {
      if (generation !== getSessionGeneration()) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) clearScopedData(error.message);
      else setLoadError(error instanceof Error ? error.message : 'Unable to load workspace data.');
    } finally {
      if (generation === getSessionGeneration()) setLoadingData(false);
    }
  };

  const clearScopedData = (message?: string) => {
    setSessionError(message || null); setSessionToken(null); setProjects(null); setProjectNotice(null);
    setProjectAccessOpen(false); setNewProjectOpen(false); setProjectCreationStatus(null);
    setLoadingData(false); setIsSearchOpen(false); setPrincipal(null); setUiSettings(null); setUiError(null);
    document.title = 'RCA assist'; setAgents([]); setRuns([]); setTools([]); setAuditLogs([]);
    setUnreadNotificationsCount(0); setNotificationsUnavailable(false); setHealthUpdatedAt(null);
    setHealthError(false); setTelemetryRefreshing(false); setLoadError(null);
    setIsSessionOpen(true); setSessionVersion(v => v + 1);
  };
  const refreshTelemetry = async () => {
    if (!principal) return;
    const generation = getSessionGeneration();
    setTelemetryRefreshing(true);
    try {
      const h = await fetchHealth();
      if (generation !== getSessionGeneration()) return;
      setHealth(h); setHealthUpdatedAt(new Date()); setHealthError(false);
    } catch {
      if (generation === getSessionGeneration()) setHealthError(true);
    } finally {
      if (generation === getSessionGeneration()) setTelemetryRefreshing(false);
    }
  };
  const handleAuthenticated = (next: Principal) => {
    // Tear down scope-bound editors and polling before changing request headers.
    flushSync(() => { setUiSettings(null); setIsSearchOpen(false); setProjectAccessOpen(false); setNewProjectOpen(false); });
    setProjectContext(next.project_id);
    setHealthUpdatedAt(null); setHealthError(false); setTelemetryRefreshing(false); setLoadError(null); setProjectNotice(null); setProjects(null);
    setUiSettings(null); setUiError(null); setSessionError(null); setAgents([]); setRuns([]); setTools([]); setAuditLogs([]); setLoadingData(true); setPrincipal(next); setSessionVersion(v => v + 1); setIsSessionOpen(false);
    if (/^\/workspace\/?$/.test(window.location.pathname) || /^\/admins?\/(chat|knowledge|insights)\/?$/.test(window.location.pathname)) {
      window.history.replaceState({}, '', projectPath(next.project_id, 'chat', ''));
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };
  useEffect(() => { if (principal) void loadData(); }, [principal, activePage]);
  useEffect(() => {
    if (!principal) return;
    let cancelled = false;
    setProjects(null);
    fetchProjects().then(value => { if (!cancelled) { setProjects(value); setProjectError(null); } }).catch(error => { if (!cancelled) setProjectError(error instanceof Error ? error.message : 'Projects could not be loaded.'); });
    return () => { cancelled = true; };
  }, [principal]);
  useEffect(() => {
    if (principal && routeProjectKey && !invalidProjectRoute && routeProjectKey !== principal.project_id && !switchingProject) void activateProject(routeProjectKey, readLocationRoute().page || 'chat', true);
  // Browser history can select a project, but the server must approve its membership first.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectKey]);
  useEffect(() => {
    const generation = getSessionGeneration();
    void fetchAuthSession().then(session => {
      if (generation === getSessionGeneration()) handleAuthenticated(session.principal);
    }).catch(err => {
      if (err instanceof ApiError && [401, 403].includes(err.status)) {
        setIsSessionOpen(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!principal) return;
    let cancelled = false;
    const generation = getSessionGeneration();
    setUiError(null);
    void fetchUiSettings().then(next => {
      if (cancelled || generation !== getSessionGeneration()) return;
      applyUiSettings(next);
      if (!readLocationRoute().page && !window.location.hash && isActivePage(next.default_page)) setActivePage(next.default_page);
    }).catch(error => {
      if (cancelled || generation !== getSessionGeneration()) return;
      if (error instanceof ApiError && error.status === 401) clearScopedData(error.message);
      else setUiError(error instanceof Error ? error.message : 'Workspace settings could not load.');
    });
    return () => { cancelled = true; };
  }, [principal, uiReload, routeProjectKey]);

  const handleSelectPage = (page: ActivePage, search?: string, navigationApproved = false) => {
    if (!navigationApproved && !window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) return;
    setActivePage(page);
    const isProjectScopedPage = [
      'triage-board', 'tickets', 'rca-workbench', 'chat', 'runs', 'feedback', 'artifacts', 'orchestration', 'knowledge', 'insights', 'docs', 'project-setup'
    ].includes(page) || (page === 'metrics' && Boolean(routeProjectKey));
    const scopedProjectKey = isProjectScopedPage ? (routeProjectKey || principal?.project_id) : null;
    const query = search ? (search.startsWith('?') ? search : `?${search}`) : '';
    if (scopedProjectKey) {
      window.history.pushState({}, '', projectPath(scopedProjectKey, page, query));
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      window.history.pushState({}, '', `/admins/${page}${query}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const activateProject = async (projectId: string, page: ActivePage = 'chat', replace = false) => {
    if (switchingProject || !window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) return;
    setSwitchingProject(true); setProjectError(null);
    try {
      const selected = await selectProject(projectId);
      setInitialRunId(undefined); setInitialCapability(undefined);
      handleAuthenticated(selected.principal);
      window.history[replace ? 'replaceState' : 'pushState']({}, '', projectPath(projectId, page, ''));
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'This project could not be opened.'); }
    finally { setSwitchingProject(false); }
  };
  const handleCreateProject = async (input: CreateProjectInput, files: File[]) => {
    const created = await createProject(input);
    let selected;
    try { selected = await selectProject(created.project_id); }
    catch (error) {
      const directory = await fetchProjects().catch(() => null); if (directory) setProjects(directory);
      throw new Error(`The project was created, but could not be opened. Select it from the project menu to continue. ${error instanceof Error ? error.message : ''}`);
    }
    // Remove the old workspace before any request can use the new project context.
    setProjectCreationStatus('Saving your project references…');
    setNewProjectOpen(false); setInitialRunId(undefined); setInitialCapability(undefined);
    handleAuthenticated(selected.principal);
    window.history.pushState({}, '', projectPath(created.project_id, 'project-setup', ''));
    window.dispatchEvent(new PopStateEvent('popstate'));
    const generation = getSessionGeneration();
    const failed: string[] = [];
    for (let index = 0; index < files.length; index += 2) {
      if (generation !== getSessionGeneration()) return;
      const batch = files.slice(index, index + 2);
      const uploaded = await Promise.allSettled(batch.map(file => uploadKnowledgeDoc(file, file.name, 'Project references')));
      uploaded.forEach((result, item) => { if (result.status === 'rejected') failed.push(batch[item].name); });
    }
    if (generation !== getSessionGeneration()) return;
    setProjectCreationStatus(null);
    setProjectNotice(`${created.name} was created.${files.length - failed.length > 0 ? ` ${files.length - failed.length} document drafts are ready for review in Knowledge.` : ''}${failed.length ? ` These files could not be added: ${failed.join(', ')}. Add them again from Knowledge.` : ''}`);
  };

  const refreshProjectDirectory = async () => {
    const generation = getSessionGeneration();
    try {
      const directory = await fetchProjects();
      if (generation === getSessionGeneration()) { setProjects(directory); setProjectError(null); }
    } catch (error) {
      if (generation === getSessionGeneration()) setProjectError(error instanceof Error ? error.message : 'Projects could not be loaded.');
    }
  };

  const handleNavigateFromAlert = (page: ActivePage, options?: { runId?: string; filter?: string; targetId?: string }) => {
    if (options?.runId) {
      setInitialRunId(options.runId);
    }
    handleSelectPage(page);
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };


  if (!principal) return <div className="app-layout"><div style={{ padding: 24, fontWeight: 650 }}>RCA assist · Investigation workspace</div><SessionModal isOpen sessionError={sessionError} principal={{ subject: '', roles: [], tenant_id: '', project_id: '' }} onClose={() => undefined} onAuthenticated={handleAuthenticated} onSignedOut={clearScopedData} /></div>;

  if (projectCreationStatus) return <div className="app-layout"><main style={{ padding: 24 }} role="status"><h1>Your project is ready</h1><p>{projectCreationStatus}</p></main></div>;

  if (!uiSettings) return <div className="app-layout"><main style={{ padding: 24 }}>
    {uiError ? <div role="alert"><p>{uiError}</p><button className="btn btn-primary" onClick={() => setUiReload(value => value + 1)}>Retry workspace settings</button></div>
      : <p role="status">Loading workspace settings…</p>}
    <button className="btn btn-secondary" onClick={() => { void logoutSession().then(() => clearScopedData()).catch(error => setUiError(error instanceof Error ? error.message : 'Sign-out failed. Please try again.')); }}>Sign out</button>
  </main></div>;

  const isPlatformAdmin = Boolean(principal?.roles.includes('PLATFORM_ADMIN'));
  const isAuthorizedAdmin = Boolean(
    principal?.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER', 'PROJECT_MANAGER'].includes(role))
  );

  return (
    <div className="app-layout">
      {/* Topbar */}
      <Topbar
        settings={uiSettings}
        health={health}
        healthUpdatedAt={healthUpdatedAt}
        healthError={healthError}
        telemetryRefreshing={telemetryRefreshing}
        onRefreshTelemetry={refreshTelemetry}
        principal={principal}
        theme={theme}
        activePage={activePage}
        projectKey={routeProjectKey}
        unreadNotificationsCount={unreadNotificationsCount}
        notificationsUnavailable={notificationsUnavailable}
        onToggleTheme={toggleTheme}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenSession={() => setIsSessionOpen(true)}
        onOpenAlerts={() => handleSelectPage('alerts')}
        onNewInvestigation={() => openInvestigation()}
        onNavigate={handleSelectPage}
        onSignOut={() => { void logoutSession().then(() => clearScopedData()).catch(error => setUiError(error instanceof Error ? error.message : 'Sign-out failed. Please try again.')); }}
        canAdmin={isAuthorizedAdmin}
        projects={projects}
        onSwitchToProject={(id) => {
          const target = id || principal.project_id || projects?.items[0]?.project_id;
          if (target) void activateProject(target, 'chat');
        }}
        projectSelector={routeProjectKey ? (
          <ProjectSwitcher
            directory={projects}
            currentProject={principal.project_id}
            loading={switchingProject}
            onSelect={id => void activateProject(id)}
            onCreate={openProjectCreation}
            onAccess={() => setProjectAccessOpen(true)}
            onOpenWorkspace={() => handleSelectPage('chat')}
            canAdmin={isAuthorizedAdmin}
            onOpenAdmin={() => {
              if (!window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) return;
              window.history.pushState({}, '', '/admins/overview');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
          />
        ) : undefined}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Body */}
      <div className="app-body">
        <Sidebar
          settings={uiSettings}
          projectWorkspace={Boolean(routeProjectKey)}
          onOpenAdministration={() => { if (!window.dispatchEvent(new Event('rca:before-navigation', { cancelable: true }))) return; window.history.pushState({}, '', '/admins/overview'); window.dispatchEvent(new PopStateEvent('popstate')); }}
          onOpenWorkspace={() => handleSelectPage('chat')}
          canAdminister={principal.roles.some(role => ['PLATFORM_ADMIN', 'PROJECT_OWNER', 'PROJECT_MANAGER'].includes(role))}
          activePage={activePage}
          onSelectPage={handleSelectPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNewInvestigation={() => openInvestigation()}
        />

        <main key={sessionVersion} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, width: '100%' }}>
          {switchingProject && <div role="status" className="notice-banner">Opening your project…</div>}
          {projectError && <div role="alert" className="notice-banner">{projectError}<button type="button" className="btn btn-secondary" onClick={() => void refreshProjectDirectory()}>Reload projects</button></div>}
          {projectNotice && <div role="status" className="notice-banner">{projectNotice}<button type="button" className="btn btn-secondary" onClick={() => setProjectNotice(null)}>Dismiss</button></div>}
          {loadError && <div className="notice-banner" role="alert">{loadError}<button className="btn btn-secondary" onClick={() => void loadData()}>Retry loading data</button></div>}
          {loadingData && <div role="status" style={{ padding: '8px 24px', color: 'var(--muted)' }}>Refreshing workspace data…</div>}
          {invalidProjectRoute && (
            <div className="notice-banner" role="alert" style={{ margin: 24 }}>
              This project URL is malformed. Use a URL-encoded project key in the form <code>/p/&lt;project_key&gt;/</code>.
            </div>
          )}
          {routeProjectKey && principal && routeProjectKey !== principal.project_id && (
            <div className="notice-banner" role="alert" style={{ margin: 24 }}>
              This URL is outside the authenticated project scope. Sign in with a session for <code>{routeProjectKey}</code> or open <button type="button" className="btn btn-secondary" onClick={() => { window.history.replaceState({}, '', projectPath(principal.project_id, activePage)); window.dispatchEvent(new PopStateEvent('popstate')); }}>{principal.project_id}</button>.
            </div>
          )}
          {!routeProjectKey && !isAuthorizedAdmin && (
            <div className="notice-banner" role="alert" style={{ margin: 24 }}>
              Administration console access requires an administrator role. Open <button type="button" className="btn btn-secondary" onClick={() => { window.history.replaceState({}, '', projectPath(principal.project_id, 'chat')); window.dispatchEvent(new PopStateEvent('popstate')); }}>your workspace</button>.
            </div>
          )}
          <PageErrorBoundary>
          <Suspense fallback={<div role="status" style={{ padding: 24 }}>Loading page…</div>}>
          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && (activePage === 'metrics' || activePage === 'insights') && (
            <Metrics
              initialMode={health.mode}
              projectWorkspace={Boolean(routeProjectKey)}
              canAdminister={isAuthorizedAdmin}
            />
          )}
          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'chat' && (
            <Chat initialCapability={initialCapability} requestVersion={chatRequestVersion} onRunUpdated={updated => setRuns(previous => previous.some(run => run.id === updated.id) ? previous.map(run => run.id === updated.id ? updated : run) : [updated, ...previous])} onOpenRun={id => { setInitialRunId(id); handleSelectPage('runs'); }} />
          )}
          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'overview' && (
            <Overview
              principal={principal}
              projectWorkspace={Boolean(routeProjectKey)}
              projects={projects}
              onSelectProject={id => void activateProject(id)}
              onCreateProject={projects?.can_create ? openProjectCreation : undefined}
              settings={uiSettings}
              health={health}
              agents={agents}
              runs={runs}
              onNavigate={handleSelectPage}
              onNewInvestigation={() => openInvestigation()}
              onOpenRun={id => { setInitialRunId(id); handleSelectPage('runs'); }}
              onRefresh={() => void loadData()}
            />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'runs' && (
            <Runs initialRunId={initialRunId} runs={runs} onNewInvestigation={() => openInvestigation()} onRunUpdated={updated => setRuns(prev => prev.map(run => run.id === updated.id ? updated : run))} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'capabilities' && (
            <Capabilities onNewInvestigation={openInvestigation} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'skills' && (
            <Skills principal={principal} onNavigate={handleSelectPage} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'harness-library' && (
            <HarnessLibrary principal={principal} onNavigate={handleSelectPage} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'runtime' && (
            <Runtime health={health} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'parameters' && (
            <ParameterStudio />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'optimization' && (
            <Optimization onNavigate={handleSelectPage} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'agents' && (
            <Agents agents={agents} principal={principal} onRefresh={loadData} onNavigate={handleSelectPage} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'tools' && (
            <Tools tools={tools} principal={principal} onNavigate={handleSelectPage} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'alerts' && (
            <Alerts onNavigate={handleNavigateFromAlert} onNotificationsUpdated={loadData} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'health-checks' && (
            <HealthChecks />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'project-setup' && (
            <ProjectSetup onApplied={() => void refreshProjectDirectory()} onOverview={() => handleSelectPage('overview')} onNewInvestigation={() => openInvestigation()} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'persistence' && (
            <Persistence />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'policy' && (
            <Policy />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'roles' && (
            <Users onSelectPage={handleSelectPage} initialTab="directory" />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'governance' && (
            <Governance logs={auditLogs} agents={agents} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'knowledge' && (
            <Knowledge />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'users' && (
            <Users onSelectPage={handleSelectPage} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'billing' && (
            <Billing principal={principal} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'settings' && (
            <Settings principal={principal} health={health} onUiSettingsChanged={applyUiSettings} />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'triage-board' && (
            <TriageBoard />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'tickets' && (
            <ProjectTickets />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'rca-workbench' && (
            <RCAWorkbench />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'feedback' && (
            <ProjectFeedback />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'docs' && (
            <Docs />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'artifacts' && (
            <Artifacts />
          )}

          {(!invalidProjectRoute && (!routeProjectKey || !principal || routeProjectKey === principal.project_id)) && activePage === 'orchestration' && (
            <Orchestration />
          )}
          </Suspense>
          </PageErrorBoundary>
        </main>
      </div>

      {/* Modals & Command Palette */}
      <CommandPalette
        settings={uiSettings}
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
      {projectAccessOpen && <ProjectAccessDialog principal={principal} onClose={() => setProjectAccessOpen(false)} onAccessChanged={() => void refreshProjectDirectory()} />}
      {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} onCreate={handleCreateProject} />}


    </div>
  );
};
