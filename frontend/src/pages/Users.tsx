import React, { useEffect, useMemo, useState } from 'react';
import {
  Users as UsersIcon,
  ShieldCheck,
  Search,
  RefreshCw,
  Plus,
  LayoutGrid,
  List,
  CheckCircle2,
  XCircle,
  Shield,
  KeyRound,
  ExternalLink,
  Edit2,
  Trash2,
  X,
  Lock,
  Terminal,
  Building,
  Activity,
  Layers,
  ChevronRight,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchUsers,
  fetchRoles,
  fetchCapabilities,
  fetchPrincipal,
  fetchPermissions,
  createUser,
  updateUser,
  deleteUser,
  createRole,
  updateRole,
  deleteRole,
} from '../services/api';
import { UserItem, RoleItem, CapabilityItem, Principal } from '../types/api';
import { ActivePage } from '../components/Sidebar';
import '../styles/users-roles.css';

interface UsersProps {
  onSelectPage?: (page: ActivePage) => void;
  initialTab?: TabType;
}

export type TabType = 'directory' | 'roles' | 'matrix' | 'capabilities' | 'security';
type ViewMode = 'grid' | 'table';

export const ROLE_RESPONSIBILITIES: Record<
  string,
  {
    displayName: string;
    summary: string;
    tier: string;
    analysisAllowed: boolean;
    responsibilities: string[];
    governanceScope: string;
  }
> = {
  PLATFORM_ADMIN: {
    displayName: 'Platform Administrator',
    summary:
      'Full administrative authority across global platform topology, persistence stores, runtime stages, user directories, security policy, connectors, and billing.',
    tier: 'Administrative',
    analysisAllowed: true,
    responsibilities: [
      'Global tenant & project boundaries configuration',
      'Security policy & redaction guardrails',
      'Integration connectors & credentials management',
      'Enterprise billing & token quota governance',
      'All investigation runs and capability executions',
    ],
    governanceScope: 'Global Platform',
  },
  PROJECT_OWNER: {
    displayName: 'Project Owner',
    summary:
      'Direct ownership of project scope: manages project-level configuration, custom agent approvals, parameter overrides, team memberships, and budget allocations.',
    tier: 'Governance',
    analysisAllowed: true,
    responsibilities: [
      'Project-level runtime & model configuration',
      'Custom specialist agent draft review & approval',
      'Team membership and role assignments',
      'Project token and spend budget monitoring',
      'Incident investigation execution',
    ],
    governanceScope: 'Project Boundary',
  },
  PROJECT_MANAGER: {
    displayName: 'Project Manager',
    summary:
      'Governs team resource allocation, tracks SLA metrics, manages project parameters and user memberships, monitors budgets and audit logs. Explicitly excluded from executing incident triage or active log analysis investigations.',
    tier: 'Management',
    analysisAllowed: false,
    responsibilities: [
      'Team resource allocation & member management',
      'SLA tracking & incident resolution metrics',
      'Project parameter governance & stage defaults',
      'Budget and token spend monitoring',
      'Audit log reviews & compliance tracking',
    ],
    governanceScope: 'Project Management (No Triage)',
  },
  PROJECT_ANALYST: {
    displayName: 'Project Analyst',
    summary:
      'Incident investigation lead: executes incident triage workflows, queries log search connectors, uploads diagnostic evidence bundles, and synthesizes root cause findings.',
    tier: 'Operational',
    analysisAllowed: true,
    responsibilities: [
      'Deep incident root cause analysis',
      'Automated incident triage & anchor extraction',
      'Log anomaly correlation across connectors',
      'Diagnostic file & document evidence extraction',
      'Final grounded investigation synthesis generation',
    ],
    governanceScope: 'Investigation & Triage',
  },
  PROJECT_VIEWER: {
    displayName: 'Project Viewer',
    summary:
      'Read-only observer: view completed investigation reports, root cause syntheses, evidence citations, and operational health dashboards without mutation authority.',
    tier: 'Read-Only',
    analysisAllowed: false,
    responsibilities: [
      'View completed investigation runs and syntheses',
      'Inspect citations and evidence trace bundles',
      'Monitor project health checks and probe latencies',
      'Read-only dashboard visibility',
    ],
    governanceScope: 'Observability Only',
  },
  GENERIC_USER: {
    displayName: 'Generic User',
    summary:
      'Standard authenticated platform member: general platform identity with access to documentation, runbooks, and self-service profile review.',
    tier: 'General',
    analysisAllowed: false,
    responsibilities: [
      'Access platform runbooks and knowledge items',
      'Review authenticated session identity and scopes',
      'View basic infrastructure operational status',
    ],
    governanceScope: 'Self-Service & Runbooks',
  },
};

const ASSIGNABLE_ROLE_IDS = new Set(Object.keys(ROLE_RESPONSIBILITIES));

export function Users({ onSelectPage, initialTab = 'directory' }: UsersProps) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Users Tab filters
  const [search, setSearch] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('ALL');
  const [inspectedUser, setInspectedUser] = useState<UserItem | null>(null);

  // Roles Tab filters
  const [roleSearch, setRoleSearch] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState('ALL');
  const [selectedRole, setSelectedRole] = useState<RoleItem | null>(null);

  // Modal states for Create/Edit User
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalMode, setUserModalMode] = useState<'create' | 'edit'>('create');
  const [userFormId, setUserFormId] = useState('');
  const [userFormName, setUserFormName] = useState('');
  const [userFormEmail, setUserFormEmail] = useState('');
  const [userFormStatus, setUserFormStatus] = useState<'active' | 'inactive'>('active');
  const [userFormRoles, setUserFormRoles] = useState<string[]>([]);
  const [userSubmitting, setUserSubmitting] = useState(false);

  // Modal states for Create/Edit Role
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleModalMode, setRoleModalMode] = useState<'create' | 'edit'>('create');
  const [roleFormId, setRoleFormId] = useState('');
  const [roleFormName, setRoleFormName] = useState('');
  const [roleFormDesc, setRoleFormDesc] = useState('');
  const [roleFormPermissions, setRoleFormPermissions] = useState<string[]>([]);
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const assignableRoles = useMemo(() => roles.filter(role => ASSIGNABLE_ROLE_IDS.has(role.id)), [roles]);

  // Synchronize initialTab if prop changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [usersData, rolesData, capsData, meData, permsData] = await Promise.all([
        fetchUsers(),
        fetchRoles().catch(() => [] as RoleItem[]),
        fetchCapabilities(true).catch(() => [] as CapabilityItem[]),
        fetchPrincipal().catch(() => null),
        fetchPermissions().catch(() => [] as string[]),
      ]);

      const normalizedRoles = (Array.isArray(rolesData) ? rolesData : []).map(r => ({
        ...r,
        id: r.id || r.role_id || '',
        name: r.name || r.id || r.role_id || '',
        tier: r.tier || ROLE_RESPONSIBILITIES[r.id || r.role_id || '']?.tier || 'Operational',
        description:
          r.description ||
          ROLE_RESPONSIBILITIES[r.id || r.role_id || '']?.summary ||
          '',
        permissions: r.permissions || [],
      }));

      setUsers(usersData);
      setRoles(normalizedRoles);
      setCapabilities(capsData);
      setPrincipal(meData);
      setAvailableActions(permsData);

      if (usersData.length > 0 && !inspectedUser) {
        setInspectedUser(usersData[0]);
      } else if (inspectedUser) {
        const stillExists = usersData.find(u => u.id === inspectedUser.id);
        setInspectedUser(stillExists || usersData[0] || null);
      }

      if (normalizedRoles.length > 0 && !selectedRole) {
        setSelectedRole(normalizedRoles[0]);
      } else if (selectedRole) {
        const stillExists = normalizedRoles.find(r => r.id === selectedRole.id);
        setSelectedRole(stillExists || normalizedRoles[0] || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load IAM access control plane');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Distinct roles assigned across current users
  const distinctRoles = useMemo(() => {
    const set = new Set<string>();
    users.forEach(u => u.roles.forEach(r => set.add(r)));
    return Array.from(set);
  }, [users]);

  // Distinct tiers from real roles
  const distinctTiers = useMemo(() => {
    const set = new Set<string>();
    roles.forEach(r => {
      if (r.tier) set.add(r.tier);
    });
    return Array.from(set);
  }, [roles]);

  // Filtered users for Directory
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(user => {
      const matchesSearch =
        !q ||
        user.name.toLowerCase().includes(q) ||
        user.id.toLowerCase().includes(q) ||
        (user.email && user.email.toLowerCase().includes(q)) ||
        user.roles.some(r => r.toLowerCase().includes(q));

      const matchesRole =
        selectedRoleFilter === 'ALL' || user.roles.includes(selectedRoleFilter);

      const matchesStatus =
        selectedStatusFilter === 'ALL' || user.status === selectedStatusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, selectedRoleFilter, selectedStatusFilter]);

  // Filtered roles for Catalog
  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    return roles.filter(role => {
      const tier = role.tier || 'Operational';
      const matchesSearch =
        !q ||
        role.name.toLowerCase().includes(q) ||
        role.id.toLowerCase().includes(q) ||
        role.description.toLowerCase().includes(q);

      const matchesTier = selectedTierFilter === 'ALL' || tier === selectedTierFilter;

      return matchesSearch && matchesTier;
    });
  }, [roles, roleSearch, selectedTierFilter]);

  // Users assigned to the currently selected role
  const roleAssignedUsers = useMemo(() => {
    if (!selectedRole) return [];
    return users.filter(u => u.roles.includes(selectedRole.id));
  }, [selectedRole, users]);

  // Capabilities authorized for the inspected user
  const userAuthorizedCapabilities = useMemo(() => {
    if (!inspectedUser) return [];
    return capabilities.filter(cap => {
      const allowed = cap.permissions?.allowed_roles || [];
      if (allowed.length === 0) return true;
      return inspectedUser.roles.some(r => allowed.includes(r));
    });
  }, [inspectedUser, capabilities]);

  // Capabilities that allow the currently selected role
  const roleAuthorizedCapabilities = useMemo(() => {
    if (!selectedRole) return [];
    return capabilities.filter(cap => {
      const allowed = cap.permissions?.allowed_roles || [];
      if (allowed.length === 0) return true;
      return allowed.includes(selectedRole.id);
    });
  }, [selectedRole, capabilities]);

  // User Actions
  const handleOpenCreateUser = () => {
    setUserModalMode('create');
    setUserFormId('');
    setUserFormName('');
    setUserFormEmail('');
    setUserFormStatus('active');
    setUserFormRoles(['PROJECT_ANALYST']);
    setUserModalOpen(true);
  };

  const handleOpenEditUser = (user: UserItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setUserModalMode('edit');
    setUserFormId(user.id);
    setUserFormName(user.name);
    setUserFormEmail(user.email || '');
    setUserFormStatus(user.status);
    setUserFormRoles(user.roles.filter(role => ASSIGNABLE_ROLE_IDS.has(role)));
    setUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserSubmitting(true);
    setActionFeedback(null);
    try {
      if (userModalMode === 'create') {
        const created = await createUser({
          id: userFormId.trim(),
          name: userFormName.trim(),
          email: userFormEmail.trim() || undefined,
          roles: userFormRoles,
          status: userFormStatus,
        });
        setActionFeedback(`User ${created.name} registered and persisted.`);
      } else {
        const updated = await updateUser(userFormId, {
          name: userFormName.trim(),
          email: userFormEmail.trim() || undefined,
          roles: userFormRoles,
          status: userFormStatus,
        });
        setActionFeedback(`User ${updated.name} updated and persisted.`);
      }
      setUserModalOpen(false);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'User operation failed');
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.confirm(`Are you sure you want to remove membership for '${userId}'?`)) return;
    try {
      await deleteUser(userId);
      setActionFeedback(`User ${userId} deleted from database.`);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handleToggleUserRole = async (user: UserItem, roleId: string) => {
    const hasRole = user.roles.includes(roleId);
    const nextRoles = hasRole
      ? user.roles.filter(r => r !== roleId)
      : [...user.roles, roleId];
    if (nextRoles.length === 0) {
      setError(`Cannot revoke all roles: User '${user.name}' must retain at least one role.`);
      return;
    }
    // Optimistic update
    setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, roles: nextRoles } : u)));
    if (inspectedUser?.id === user.id) {
      setInspectedUser(prev => (prev ? { ...prev, roles: nextRoles } : null));
    }
    try {
      await updateUser(user.id, {
        name: user.name,
        email: user.email,
        roles: nextRoles,
        status: user.status,
      });
      setActionFeedback(
        `${hasRole ? 'Revoked' : 'Granted'} role ${roleId} for ${user.name} (persisted)`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role assignment');
      await loadData(true);
    }
  };

  const handleRemoveUserRole = async (user: UserItem, roleId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (user.roles.length <= 1) {
      setError(`User '${user.name}' must retain at least one role.`);
      return;
    }
    const nextRoles = user.roles.filter(r => r !== roleId);
    setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, roles: nextRoles } : u)));
    if (inspectedUser?.id === user.id) {
      setInspectedUser(prev => (prev ? { ...prev, roles: nextRoles } : null));
    }
    try {
      await updateUser(user.id, {
        name: user.name,
        email: user.email,
        roles: nextRoles,
        status: user.status,
      });
      setActionFeedback(`Removed role ${roleId} from ${user.name} (persisted)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove role');
      await loadData(true);
    }
  };

  const handleAddUserRole = async (user: UserItem, roleId: string) => {
    if (!roleId || user.roles.includes(roleId)) return;
    const nextRoles = [...user.roles, roleId];
    setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, roles: nextRoles } : u)));
    if (inspectedUser?.id === user.id) {
      setInspectedUser(prev => (prev ? { ...prev, roles: nextRoles } : null));
    }
    try {
      await updateUser(user.id, {
        name: user.name,
        email: user.email,
        roles: nextRoles,
        status: user.status,
      });
      setActionFeedback(`Assigned role ${roleId} to ${user.name} (persisted)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add role');
      await loadData(true);
    }
  };

  const handleToggleUserStatus = async (user: UserItem) => {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, status: nextStatus } : u)));
    if (inspectedUser?.id === user.id) {
      setInspectedUser(prev => (prev ? { ...prev, status: nextStatus } : null));
    }
    try {
      await updateUser(user.id, {
        name: user.name,
        email: user.email,
        roles: user.roles,
        status: nextStatus,
      });
      setActionFeedback(`Membership status for ${user.name} set to ${nextStatus} (persisted)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
      await loadData(true);
    }
  };

  // Role Actions
  const handleOpenCreateRole = () => {
    setRoleModalMode('create');
    setRoleFormId('');
    setRoleFormName('');
    setRoleFormDesc('');
    setRoleFormPermissions(['view_runs', 'create_runs']);
    setRoleModalOpen(true);
  };

  const handleOpenEditRole = (role: RoleItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRoleModalMode('edit');
    setRoleFormId(role.id);
    setRoleFormName(role.name);
    setRoleFormDesc(role.description);
    setRoleFormPermissions([...(role.permissions || [])]);
    setRoleModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleSubmitting(true);
    setActionFeedback(null);
    try {
      if (roleModalMode === 'create') {
        const created = await createRole({
          id: roleFormId.trim().toUpperCase(),
          name: roleFormName.trim(),
          description: roleFormDesc.trim(),
          permissions: roleFormPermissions,
          status: 'active',
        });
        setActionFeedback(`Role '${created.name}' created and persisted.`);
      } else {
        const updated = await updateRole(roleFormId, {
          name: roleFormName.trim(),
          description: roleFormDesc.trim(),
          permissions: roleFormPermissions,
          status: 'active',
        });
        setActionFeedback(`Role '${updated.name}' updated and persisted.`);
      }
      setRoleModalOpen(false);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setRoleSubmitting(false);
    }
  };

  const handleDeleteRole = async (roleId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete custom role '${roleId}'?`)) return;
    try {
      await deleteRole(roleId);
      setActionFeedback(`Role '${roleId}' deleted from database.`);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    }
  };

  const handleRemovePermission = async (role: RoleItem, permission: string) => {
    const nextPerms = (role.permissions || []).filter(p => p !== permission);
    setRoles(prev => prev.map(r => (r.id === role.id ? { ...r, permissions: nextPerms } : r)));
    if (selectedRole?.id === role.id) {
      setSelectedRole(prev => (prev ? { ...prev, permissions: nextPerms } : null));
    }
    try {
      await updateRole(role.id, {
        name: role.name,
        description: role.description,
        permissions: nextPerms,
        status: role.status || 'active',
      });
      setActionFeedback(`Revoked permission '${permission}' from ${role.name} (persisted)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke permission');
      await loadData(true);
    }
  };

  const handleAddPermission = async (role: RoleItem, permission: string) => {
    if ((role.permissions || []).includes(permission)) return;
    const nextPerms = [...(role.permissions || []), permission];
    setRoles(prev => prev.map(r => (r.id === role.id ? { ...r, permissions: nextPerms } : r)));
    if (selectedRole?.id === role.id) {
      setSelectedRole(prev => (prev ? { ...prev, permissions: nextPerms } : null));
    }
    try {
      await updateRole(role.id, {
        name: role.name,
        description: role.description,
        permissions: nextPerms,
        status: role.status || 'active',
      });
      setActionFeedback(`Granted permission '${permission}' to ${role.name} (persisted)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant permission');
      await loadData(true);
    }
  };

  const toggleUserFormRole = (roleId: string) => {
    setUserFormRoles(prev =>
      prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId]
    );
  };

  const toggleRoleFormPermission = (action: string) => {
    setRoleFormPermissions(prev =>
      prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action]
    );
  };

  const getTierClass = (roleOrTier: string) => {
    const r = roleOrTier.toUpperCase();
    if (r.includes('ADMIN')) return 'tier-admin';
    if (r.includes('OWNER') || r.includes('GOV')) return 'tier-gov';
    if (r.includes('MANAGER') || r.includes('MGMT')) return 'tier-mgmt';
    if (r.includes('ANALYST') || r.includes('OPS')) return 'tier-ops';
    if (r.includes('VIEWER') || r.includes('READ')) return 'tier-view';
    if (r.includes('GENERIC') || r.includes('USER') || r.includes('GEN')) return 'tier-gen';
    return 'tier-view';
  };

  const getAvatarClass = (user: UserItem) => {
    if (user.roles.some(r => r.includes('ADMIN'))) return 'avatar-admin';
    if (user.roles.some(r => r.includes('OWNER'))) return 'avatar-owner';
    if (user.roles.some(r => r.includes('MANAGER'))) return 'avatar-manager';
    if (user.roles.some(r => r.includes('ANALYST'))) return 'avatar-analyst';
    if (user.roles.some(r => r.includes('VIEWER'))) return 'avatar-viewer';
    if (user.roles.some(r => r.includes('GENERIC') || r.includes('USER'))) return 'avatar-generic';
    return 'avatar-default';
  };

  return (
    <div className="view-container iam-page">
      {/* Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Identity & <span>Access Control</span> (IAM)
          </h1>
          <p className="hero-lede">
            Enterprise RBAC governance, authentic cryptographic RS256 JWT validation, and live
            server-side role assignments persisted to PostgreSQL across this project deployment.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{loading ? '…' : users.length}</b> Principals
            </span>
            <span className="hero-stat-chip">
              <KeyRound size={13} style={{ color: 'var(--acc)' }} />
              <b>{loading ? '…' : roles.length}</b> Defined Roles
            </span>
            <span className="hero-stat-chip">
              <Building size={13} style={{ color: 'var(--acc2)' }} />
              <b>Scope:</b>{' '}
              {principal?.tenant_id && principal?.project_id
                ? `${principal.tenant_id} / ${principal.project_id}`
                : '—'}
            </span>
            <span className="hero-stat-chip">
              <Lock size={13} style={{ color: '#10b981' }} />
              <b>Auth:</b> RS256 JWT Verified
            </span>
          </div>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void loadData(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {activeTab === 'roles' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenCreateRole}
              title="Define custom role"
            >
              <Plus size={14} /> Add Role
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenCreateUser}
              title="Register new user membership"
            >
              <Plus size={14} /> Add User
            </button>
          )}
        </div>
      </section>

      {/* Notifications */}
      {error && (
        <div className="notice-banner red" role="alert">
          <AlertTriangle size={16} /> {error}
          <button
            className="btn btn-outline"
            style={{ marginLeft: 12 }}
            onClick={() => void loadData(true)}
          >
            Retry
          </button>
        </div>
      )}
      {actionFeedback && (
        <div className="notice-banner green">
          <CheckCircle2 size={16} /> {actionFeedback}
        </div>
      )}

      {/* KPI Stat Cards Strip */}
      <div className="iam-stat-strip">
        <div className="iam-stat-box">
          <div className="iam-stat-icon-wrapper indigo">
            <UsersIcon size={18} />
          </div>
          <div className="iam-stat-content">
            <div className="iam-stat-title">Scoped Principals</div>
            <div className="iam-stat-number">{loading ? '—' : users.length}</div>
            <div className="iam-stat-caption">Verified subject identities</div>
          </div>
        </div>

        <div className="iam-stat-box">
          <div className="iam-stat-icon-wrapper emerald">
            <ShieldCheck size={18} />
          </div>
          <div className="iam-stat-content">
            <div className="iam-stat-title">Configured Roles</div>
            <div className="iam-stat-number">{loading ? '—' : roles.length}</div>
            <div className="iam-stat-caption">6 Core Roles + Custom</div>
          </div>
        </div>

        <div className="iam-stat-box">
          <div className="iam-stat-icon-wrapper amber">
            <Layers size={18} />
          </div>
          <div className="iam-stat-content">
            <div className="iam-stat-title">Authorized Capabilities</div>
            <div className="iam-stat-number">{loading ? '—' : capabilities.length}</div>
            <div className="iam-stat-caption">Project investigation tools</div>
          </div>
        </div>

        <div className="iam-stat-box">
          <div className="iam-stat-icon-wrapper purple">
            <Activity size={18} />
          </div>
          <div className="iam-stat-content">
            <div className="iam-stat-title">Current Session</div>
            <div className="iam-stat-number">{principal?.subject || '—'}</div>
            <div className="iam-stat-caption">{(principal?.roles || []).join(', ') || '—'}</div>
          </div>
        </div>
      </div>

      {/* Unified Sub-Navigation Strip */}
      <div className="iam-subnav-bar">
        <div className="iam-tabs-group">
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
            onClick={() => setActiveTab('directory')}
          >
            <UsersIcon size={15} />
            <span>User Directory</span>
            <span className="iam-tab-pill">{users.length}</span>
          </button>
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'roles' ? 'active' : ''}`}
            onClick={() => setActiveTab('roles')}
          >
            <KeyRound size={15} />
            <span>Roles & Permissions</span>
            <span className="iam-tab-pill">{roles.length}</span>
          </button>
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => setActiveTab('matrix')}
          >
            <Layers size={15} />
            <span>Role Assignment Matrix</span>
          </button>
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'capabilities' ? 'active' : ''}`}
            onClick={() => setActiveTab('capabilities')}
          >
            <ShieldCheck size={15} />
            <span>Capability Access Matrix</span>
          </button>
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Lock size={15} />
            <span>Security & Scope Policy</span>
          </button>
        </div>

        {activeTab === 'directory' && (
          <div className="iam-subnav-actions">
            <div className="iam-view-switcher">
              <button
                type="button"
                className={`iam-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grid cards view"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                className={`iam-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table list view"
              >
                <List size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: USER DIRECTORY                                                */}
      {/* ==================================================================== */}
      {activeTab === 'directory' && (
        <>
          <div className="iam-toolbar-panel">
            <div className="iam-search-box">
              <Search size={15} style={{ color: 'var(--muted)' }} />
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search users by name, ID, email, or role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="iam-filter-group">
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                Role:
              </span>
              <button
                type="button"
                className={`iam-filter-chip ${selectedRoleFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setSelectedRoleFilter('ALL')}
              >
                All
              </button>
              {distinctRoles.map(role => (
                <button
                  type="button"
                  key={role}
                  className={`iam-filter-chip ${selectedRoleFilter === role ? 'active' : ''}`}
                  onClick={() => setSelectedRoleFilter(role)}
                >
                  {role.replaceAll('_', ' ')}
                </button>
              ))}
            </div>

            <div className="iam-filter-group">
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                Status:
              </span>
              {['ALL', 'active', 'inactive'].map(st => (
                <button
                  type="button"
                  key={st}
                  className={`iam-filter-chip ${selectedStatusFilter === st ? 'active' : ''}`}
                  onClick={() => setSelectedStatusFilter(st)}
                >
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="iam-master-detail">
            {/* Left: User Cards or Table */}
            <div className="iam-master-list">
              {filteredUsers.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                  <UsersIcon size={32} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>No matching users</h3>
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                    Try refining your search query or reset your filters.
                  </p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="iam-user-cards-grid">
                  {filteredUsers.map(user => {
                    const isSelected = inspectedUser?.id === user.id;
                    return (
                      <div
                        key={user.id}
                        className={`iam-user-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setInspectedUser(user)}
                      >
                        <div className="iam-user-header">
                          <div className={`iam-avatar ${getAvatarClass(user)}`}>
                            {user.name ? user.name.charAt(0).toUpperCase() : user.id.charAt(0).toUpperCase()}
                          </div>
                          <div className="iam-user-meta">
                            <div className="iam-user-name-row">
                              <span className="iam-user-name" title={user.name}>
                                {user.name || user.id}
                              </span>
                              <span
                                className={`iam-status-dot ${user.status === 'active' ? 'active' : 'suspended'}`}
                                title={`Status: ${user.status}`}
                              />
                            </div>
                            <div className="iam-user-id">{user.id}</div>
                          </div>
                        </div>

                        <div className="iam-role-pills-wrap">
                          {user.roles.map(r => (
                            <span key={r} className={`iam-badge-role ${getTierClass(r)}`}>
                              <Shield size={10} />
                              {r.replaceAll('_', ' ')}
                            </span>
                          ))}
                        </div>

                        <div className="iam-user-footer">
                          <span>{user.email || 'No email assigned'}</span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={e => handleOpenEditUser(user, e)}
                              title="Edit user profile"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={e => handleDeleteUser(user.id, e)}
                              title="Delete user"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="table-wrap card" style={{ overflow: 'hidden' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>User Name</th>
                        <th>Subject ID</th>
                        <th>Assigned Roles</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map(user => {
                        const isSelected = inspectedUser?.id === user.id;
                        return (
                          <tr
                            key={user.id}
                            onClick={() => setInspectedUser(user)}
                            style={{
                              cursor: 'pointer',
                              background: isSelected ? 'var(--acc-subtle)' : undefined,
                            }}
                          >
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div
                                  className={`iam-avatar ${getAvatarClass(user)}`}
                                  style={{ width: 28, height: 28, fontSize: 11 }}
                                >
                                  {user.name.charAt(0).toUpperCase()}
                                </div>
                                <span style={{ fontWeight: 600 }}>{user.name}</span>
                              </div>
                            </td>
                            <td>
                              <code>{user.id}</code>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {user.roles.map(r => (
                                  <span key={r} className={`iam-badge-role ${getTierClass(r)}`}>
                                    {r.replaceAll('_', ' ')}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <span
                                className={`badge ${user.status === 'active' ? 'badge-active' : 'badge-neutral'}`}
                              >
                                {user.status}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={e => handleOpenEditUser(user, e)}
                                  title="Edit user"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={e => handleDeleteUser(user.id, e)}
                                  title="Delete user"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right: User Detail Dossier */}
            <div className="iam-detail-pane">
              {inspectedUser ? (
                <div className="iam-detail-card">
                  <div className="iam-detail-hero">
                    <div
                      className={`iam-avatar ${getAvatarClass(inspectedUser)}`}
                      style={{ width: 48, height: 48, fontSize: 18 }}
                    >
                      {inspectedUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="iam-detail-hero-info">
                      <h3 className="iam-detail-hero-name">{inspectedUser.name}</h3>
                      <div className="iam-detail-hero-sub">Subject: {inspectedUser.id}</div>
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Membership Status</div>
                    <div
                      className="iam-detail-val"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <span
                        className={`badge ${inspectedUser.status === 'active' ? 'badge-active' : 'badge-neutral'}`}
                      >
                        {inspectedUser.status}
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '3px 8px', height: 'auto' }}
                        onClick={() => void handleToggleUserStatus(inspectedUser)}
                        title="Toggle active / inactive membership state"
                      >
                        {inspectedUser.status === 'active' ? 'Suspend User' : 'Activate User'}
                      </button>
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Email Address</div>
                    <div
                      className="iam-detail-val"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <span>
                        {inspectedUser.email || (
                          <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No email assigned</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={e => handleOpenEditUser(inspectedUser, e)}
                        title="Edit email"
                      >
                        <Edit2 size={11} />
                      </button>
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Authentication Method</div>
                    <div className="iam-detail-val">
                      <code>{inspectedUser.authn_method || principal?.authn_method || 'workforce_identity'}</code>
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Deployment Scope</div>
                    <div className="iam-detail-val">
                      Tenant: <b>{inspectedUser.tenant_id || principal?.tenant_id || '—'}</b> · Project:{' '}
                      <b>{inspectedUser.project_id || principal?.project_id || '—'}</b>
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div
                      className="iam-detail-label"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>Assigned Roles ({inspectedUser.roles.length})</span>
                      {assignableRoles.some(r => !inspectedUser.roles.includes(r.id)) && (
                        <select
                          className="iam-quick-add-select"
                          value=""
                          onChange={e => void handleAddUserRole(inspectedUser, e.target.value)}
                          aria-label="Quick assign role"
                        >
                          <option value="" disabled>
                            + Assign Role…
                          </option>
                          {assignableRoles
                            .filter(r => !inspectedUser.roles.includes(r.id))
                            .map(r => (
                              <option key={r.id} value={r.id}>
                                {r.name || r.id}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {inspectedUser.roles.map(r => (
                        <span key={r} className={`iam-badge-role ${getTierClass(r)} iam-badge-editable`}>
                          <Shield size={11} />
                          <span
                            onClick={() => {
                              const match = roles.find(item => item.id === r);
                              if (match) setSelectedRole(match);
                              setActiveTab('roles');
                            }}
                            title="Click to view in Roles Catalog"
                            style={{ cursor: 'pointer' }}
                          >
                            {r.replaceAll('_', ' ')}
                          </span>
                          <button
                            type="button"
                            className="iam-pill-remove-btn"
                            onClick={e => void handleRemoveUserRole(inspectedUser, r, e)}
                            title={`Remove ${r} from ${inspectedUser.name}`}
                            disabled={inspectedUser.roles.length <= 1}
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">
                      Authorized Capabilities ({userAuthorizedCapabilities.length})
                    </div>
                    <div className="iam-caps-list">
                      {userAuthorizedCapabilities.slice(0, 8).map(c => (
                        <div key={c.id} className="iam-cap-row">
                          <span className="iam-cap-name">{c.name}</span>
                          <span className="iam-cap-cat">{c.category}</span>
                        </div>
                      ))}
                      {userAuthorizedCapabilities.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          No capabilities specifically restricted to these roles.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => handleOpenEditUser(inspectedUser)}
                    >
                      <Edit2 size={13} /> Edit Profile
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setActiveTab('roles')}
                      title="Inspect Roles & Privileges"
                    >
                      <KeyRound size={13} /> Roles Catalog
                    </button>
                  </div>
                </div>
              ) : (
                <div className="iam-detail-card" style={{ textAlign: 'center', padding: 32 }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Select a user to inspect identity and permissions.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: ROLES CATALOG & RESPONSIBILITIES                              */}
      {/* ==================================================================== */}
      {activeTab === 'roles' && (
        <>
          <div className="iam-toolbar-panel">
            <div className="iam-search-box">
              <Search size={15} style={{ color: 'var(--muted)' }} />
              <input
                type="search"
                aria-label="Search roles"
                placeholder="Search roles by name, identifier, or description…"
                value={roleSearch}
                onChange={e => setRoleSearch(e.target.value)}
              />
            </div>

            <div className="iam-filter-group">
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                Classification Tier:
              </span>
              <button
                type="button"
                className={`iam-filter-chip ${selectedTierFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setSelectedTierFilter('ALL')}
              >
                All Tiers
              </button>
              {distinctTiers.map(tier => (
                <button
                  type="button"
                  key={tier}
                  className={`iam-filter-chip ${selectedTierFilter === tier ? 'active' : ''}`}
                  onClick={() => setSelectedTierFilter(tier)}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>

          <div className="iam-master-detail">
            {/* Left: Role List Items */}
            <div className="iam-role-list-pane">
              {filteredRoles.map(role => {
                const isSelected = selectedRole?.id === role.id;
                const userCount = users.filter(u => u.roles.includes(role.id)).length;
                const resp = ROLE_RESPONSIBILITIES[role.id];

                return (
                  <button
                    type="button"
                    key={role.id}
                    className={`iam-role-item-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedRole(role)}
                  >
                    <div className="iam-role-item-left">
                      <div className="iam-role-item-title">{role.name}</div>
                      <div className="iam-role-item-code">{role.id}</div>
                      {resp && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {resp.governanceScope}
                          {!resp.analysisAllowed && (
                            <span style={{ color: '#f59e0b', marginLeft: 6 }}>• No Triage</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`iam-badge-role ${getTierClass(role.tier || role.id)}`}>
                        {role.tier || 'Operational'}
                      </span>
                      <span className="iam-tab-pill" title={`${userCount} assigned users`}>
                        {userCount} {userCount === 1 ? 'user' : 'users'}
                      </span>
                      <ChevronRight size={14} style={{ opacity: isSelected ? 1 : 0.4 }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right: Detailed Role Dossier */}
            <div className="iam-detail-pane">
              {selectedRole ? (
                <div className="iam-detail-card">
                  <div className="iam-detail-hero">
                    <div className="iam-stat-icon-wrapper purple" style={{ width: 44, height: 44 }}>
                      <ShieldCheck size={22} />
                    </div>
                    <div className="iam-detail-hero-info">
                      <h3 className="iam-detail-hero-name">{selectedRole.name}</h3>
                      <div className="iam-detail-hero-sub">Identifier: {selectedRole.id}</div>
                    </div>
                    <span className={`iam-badge-role ${getTierClass(selectedRole.tier || selectedRole.id)}`}>
                      {selectedRole.tier || 'Operational'}
                    </span>
                  </div>

                  {/* Core Responsibilities Box */}
                  {ROLE_RESPONSIBILITIES[selectedRole.id] ? (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background:
                          selectedRole.id === 'PROJECT_MANAGER'
                            ? 'rgba(245, 158, 11, 0.08)'
                            : 'var(--card-subtle)',
                        border:
                          selectedRole.id === 'PROJECT_MANAGER'
                            ? '1px solid rgba(245, 158, 11, 0.25)'
                            : '1px solid var(--line)',
                        margin: '10px 0',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: selectedRole.id === 'PROJECT_MANAGER' ? '#f59e0b' : 'var(--text)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 4,
                        }}
                      >
                        <Sparkles size={13} /> Role Responsibilities & Operational Boundary
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
                        {ROLE_RESPONSIBILITIES[selectedRole.id].summary}
                      </p>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--text)', lineHeight: 1.6 }}>
                        {ROLE_RESPONSIBILITIES[selectedRole.id].responsibilities.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      {!ROLE_RESPONSIBILITIES[selectedRole.id].analysisAllowed && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: '4px 8px',
                            borderRadius: 4,
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#f87171',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          ⚠️ Analysis & Triage Prohibited: This role cannot execute incident triage or log correlation.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="iam-detail-row">
                      <div className="iam-detail-label">Role Description</div>
                      <div className="iam-detail-val">{selectedRole.description || 'Custom platform role.'}</div>
                    </div>
                  )}

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Assigned Principals ({roleAssignedUsers.length})</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {roleAssignedUsers.map(u => (
                        <span
                          key={u.id}
                          className="meta-pill"
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => {
                            setInspectedUser(u);
                            setActiveTab('directory');
                          }}
                          title="Click to view in User Directory"
                        >
                          <UsersIcon size={11} />
                          <b>{u.name}</b> ({u.id})
                        </span>
                      ))}
                      {roleAssignedUsers.length === 0 && (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          No users in this project currently hold this role.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Permissions & Actions with 1-click add/remove */}
                  <div className="iam-detail-row">
                    <div
                      className="iam-detail-label"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>Permissions & Actions ({(selectedRole.permissions || []).length})</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                        Click × to revoke or + to grant
                      </span>
                    </div>

                    <div className="iam-permissions-container" style={{ marginTop: 6 }}>
                      {/* Active Granted Permissions */}
                      <div className="iam-permissions-list">
                        {(selectedRole.permissions || []).map(p => (
                          <span key={p} className="iam-permission-pill active">
                            <span>{p}</span>
                            <button
                              type="button"
                              className="iam-pill-remove-btn"
                              onClick={() => void handleRemovePermission(selectedRole, p)}
                              title={`Revoke action '${p}' from ${selectedRole.name}`}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        {(!selectedRole.permissions || selectedRole.permissions.length === 0) && (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            No granular actions assigned. Governed by capability policy.
                          </span>
                        )}
                      </div>

                      {/* Available Unassigned Platform Actions */}
                      {availableActions.some(action => !(selectedRole.permissions || []).includes(action)) && (
                        <div style={{ marginTop: 8 }}>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              marginBottom: 4,
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            Available Actions to Grant:
                          </div>
                          <div className="iam-permissions-list">
                            {availableActions
                              .filter(action => !(selectedRole.permissions || []).includes(action))
                              .map(action => (
                                <button
                                  type="button"
                                  key={action}
                                  className="iam-permission-pill add-pill"
                                  onClick={() => void handleAddPermission(selectedRole, action)}
                                  title={`Grant action '${action}' to ${selectedRole.name}`}
                                >
                                  <Plus size={10} />
                                  <span>{action}</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">
                      Authorized Capabilities ({roleAuthorizedCapabilities.length})
                    </div>
                    <div className="iam-caps-list">
                      {roleAuthorizedCapabilities.map(c => (
                        <div key={c.id} className="iam-cap-row">
                          <span className="iam-cap-name">{c.name}</span>
                          <span className="iam-cap-cat">{c.category}</span>
                        </div>
                      ))}
                      {roleAuthorizedCapabilities.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          No investigation capabilities specifically granted to this role.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => handleOpenEditRole(selectedRole)}
                    >
                      <Edit2 size={13} /> Edit Role
                    </button>
                    {!selectedRole.is_system && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ color: '#f43f5e' }}
                        onClick={e => handleDeleteRole(selectedRole.id, e)}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="iam-detail-card" style={{ textAlign: 'center', padding: 32 }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Select a role to inspect its permissions.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: ROLE ASSIGNMENT MATRIX                                        */}
      {/* ==================================================================== */}
      {activeTab === 'matrix' && (
        <div className="iam-matrix-card">
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
                Cross-Tenant Role Assignment Matrix
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                Click any cell to immediately grant or revoke role membership with real-time PostgreSQL persistence.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="iam-matrix-toggle-btn active" style={{ width: 20, height: 20 }}>
                  <CheckCircle2 size={13} />
                </span>
                Assigned
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="iam-matrix-toggle-btn inactive" style={{ width: 20, height: 20 }}>
                  <XCircle size={13} />
                </span>
                Unassigned (Click to grant)
              </span>
            </div>
          </div>
          <div className="iam-matrix-table-wrap">
            <table className="iam-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Principal</th>
                  <th style={{ minWidth: 120 }}>Subject ID</th>
                  {roles.map(r => (
                    <th key={r.id} style={{ textAlign: 'center', minWidth: 110 }}>
                      <span className={`iam-badge-role ${getTierClass(r.id)}`} style={{ fontSize: 10 }}>
                        {r.id.replaceAll('_', ' ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className={`iam-avatar ${getAvatarClass(u)}`} style={{ width: 24, height: 24, fontSize: 10 }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                      </div>
                    </td>
                    <td>
                      <code>{u.id}</code>
                    </td>
                    {roles.map(r => {
                      const hasRole = u.roles.includes(r.id);
                      return (
                        <td key={r.id} style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className={`iam-matrix-toggle-btn ${hasRole ? 'active' : 'inactive'}`}
                            onClick={() => void handleToggleUserRole(u, r.id)}
                            title={`Click to ${hasRole ? 'revoke' : 'grant'} role ${r.name || r.id} for ${u.name}`}
                          >
                            {hasRole ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: CAPABILITY ACCESS MATRIX                                      */}
      {/* ==================================================================== */}
      {activeTab === 'capabilities' && (
        <div className="iam-matrix-card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
              Capability RBAC Access Matrix
            </h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              Cross-tabulation mapping investigation capabilities to server-authorized roles. Notice that
              <b> Project Managers</b> are restricted from analysis and triage capabilities, while
              <b> Project Analysts</b> and <b>Project Owners</b> hold investigation execution rights.
            </p>
          </div>
          <div className="iam-matrix-table-wrap">
            <table className="iam-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 240 }}>Capability</th>
                  <th style={{ minWidth: 110 }}>Category</th>
                  {roles.map(r => (
                    <th key={r.id} style={{ textAlign: 'center', minWidth: 110 }}>
                      <span className={`iam-badge-role ${getTierClass(r.id)}`} style={{ fontSize: 10 }}>
                        {r.name || r.id}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilities.map(cap => {
                  const allowed = cap.permissions?.allowed_roles || [];
                  const isPublic = allowed.length === 0;
                  return (
                    <tr key={cap.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{cap.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cap.id}</div>
                      </td>
                      <td>
                        <span className="iam-cap-cat">{cap.category}</span>
                      </td>
                      {roles.map(r => {
                        const permitted = isPublic || allowed.includes(r.id);
                        return (
                          <td key={r.id} style={{ textAlign: 'center' }}>
                            {permitted ? (
                              <span className="iam-matrix-check" title={`${r.name} authorized for ${cap.name}`}>
                                <CheckCircle2 size={14} />
                              </span>
                            ) : (
                              <span className="iam-matrix-cross" title={`${r.name} not permitted for ${cap.name}`}>
                                <XCircle size={14} />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: SECURITY & SCOPING POLICY                                     */}
      {/* ==================================================================== */}
      {activeTab === 'security' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="notice-banner blue">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Building size={18} style={{ color: 'var(--acc)' }} />
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                Immutable Server-Side Scoping Architecture
              </h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
              The RCA Analyzer backend enforces strict cryptographic isolation. Each deployment has one configured
              tenant/project boundary from <code>RCA_TENANT_ID</code> and <code>RCA_PROJECT_ID</code>. The server validates
              the RS256 JWT signature, issuer, audience, expiry, and server-side subject membership before executing any runs
              or uploads. Role and scope parameters are <b>never</b> accepted from request bodies.
            </p>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal size={16} style={{ color: 'var(--acc)' }} />
              Issuing Scoped Development Tokens
            </h4>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              In demo environments, tokens for configured server principals can be generated using the offline script:
            </p>
            <pre style={{ padding: 12, borderRadius: 8, background: 'var(--code-bg)', fontSize: 12, overflowX: 'auto' }}>
              <code>uv run python -m scripts.issue_dev_token admin --expires-in 86400</code>
            </pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {users.map(u => (
                <span key={u.id} className="meta-pill">
                  Subject: <b>{u.id}</b> ({u.roles.join(', ')})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT USER MODAL */}
      {userModalOpen && (
        <div className="iam-modal-overlay" onClick={() => setUserModalOpen(false)}>
          <div className="iam-modal-card" onClick={e => e.stopPropagation()}>
            <div className="iam-modal-header">
              <h3 className="iam-modal-title">
                {userModalMode === 'create' ? 'Register New User' : `Edit User: ${userFormId}`}
              </h3>
              <button type="button" className="icon-btn" onClick={() => setUserModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveUser} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {userModalMode === 'create' && (
                <div className="iam-form-group">
                  <label htmlFor="user-id">Subject / User ID *</label>
                  <input
                    id="user-id"
                    className="iam-form-input"
                    placeholder="e.g. s_johnson"
                    required
                    value={userFormId}
                    onChange={e => setUserFormId(e.target.value)}
                  />
                </div>
              )}

              <div className="iam-form-group">
                <label htmlFor="user-name">Full Name *</label>
                <input
                  id="user-name"
                  className="iam-form-input"
                  placeholder="e.g. Sarah Johnson"
                  required
                  value={userFormName}
                  onChange={e => setUserFormName(e.target.value)}
                />
              </div>

              <div className="iam-form-group">
                <label htmlFor="user-email">Email Address</label>
                <input
                  id="user-email"
                  type="email"
                  className="iam-form-input"
                  placeholder="e.g. sarah@company.com"
                  value={userFormEmail}
                  onChange={e => setUserFormEmail(e.target.value)}
                />
              </div>

              <div className="iam-form-group">
                <label htmlFor="user-status">Membership Status</label>
                <select
                  id="user-status"
                  className="iam-form-select"
                  value={userFormStatus}
                  onChange={e => setUserFormStatus(e.target.value as 'active' | 'inactive')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="iam-form-group">
                <label>Assigned Roles * ({userFormRoles.length} selected)</label>
                <div className="iam-checkbox-group">
                  {assignableRoles.map(r => (
                    <label key={r.id} className="iam-checkbox-label">
                      <input
                        type="checkbox"
                        checked={userFormRoles.includes(r.id)}
                        onChange={() => toggleUserFormRole(r.id)}
                      />
                      <span>{r.name || r.id}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setUserModalOpen(false)}
                  disabled={userSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={userSubmitting || userFormRoles.length === 0}
                >
                  {userSubmitting ? 'Saving…' : userModalMode === 'create' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE / EDIT ROLE MODAL */}
      {roleModalOpen && (
        <div className="iam-modal-overlay" onClick={() => setRoleModalOpen(false)}>
          <div className="iam-modal-card" onClick={e => e.stopPropagation()}>
            <div className="iam-modal-header">
              <h3 className="iam-modal-title">
                {roleModalMode === 'create' ? 'Create Custom Role' : `Edit Role: ${roleFormId}`}
              </h3>
              <button type="button" className="icon-btn" onClick={() => setRoleModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveRole} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {roleModalMode === 'create' && (
                <div className="iam-form-group">
                  <label htmlFor="role-id">Role Identifier *</label>
                  <input
                    id="role-id"
                    className="iam-form-input"
                    placeholder="e.g. CUSTOM_ANALYST"
                    required
                    value={roleFormId}
                    onChange={e => setRoleFormId(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                  />
                </div>
              )}

              <div className="iam-form-group">
                <label htmlFor="role-name">Display Name *</label>
                <input
                  id="role-name"
                  className="iam-form-input"
                  placeholder="e.g. Custom Operator"
                  required
                  value={roleFormName}
                  onChange={e => setRoleFormName(e.target.value)}
                />
              </div>

              <div className="iam-form-group">
                <label htmlFor="role-desc">Description</label>
                <input
                  id="role-desc"
                  className="iam-form-input"
                  placeholder="e.g. Grants investigation monitoring and run execution privileges"
                  value={roleFormDesc}
                  onChange={e => setRoleFormDesc(e.target.value)}
                />
              </div>

              <div className="iam-form-group">
                <label>Assigned Actions & Permissions ({roleFormPermissions.length})</label>
                <div className="iam-checkbox-group">
                  {availableActions.map(action => (
                    <label key={action} className="iam-checkbox-label">
                      <input
                        type="checkbox"
                        checked={roleFormPermissions.includes(action)}
                        onChange={() => toggleRoleFormPermission(action)}
                      />
                      <span>{action}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRoleModalOpen(false)}
                  disabled={roleSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={roleSubmitting}>
                  {roleSubmitting ? 'Saving…' : roleModalMode === 'create' ? 'Create Role' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
