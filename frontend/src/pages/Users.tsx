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
  Info,
  Mail,
  BookOpen,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
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

export const SUBROUTE_MAP: Record<TabType, string> = {
  directory: 'roles/directory',
  roles: 'roles/catalog',
  matrix: 'roles/role-matrix',
  capabilities: 'roles/capability-matrix',
  security: 'roles/security',
};

export const getTabFromHash = (fallback: TabType = 'directory'): TabType => {
  if (typeof window === 'undefined') return fallback;
  const hash = window.location.hash.toLowerCase();
  if (hash.includes('roles/directory') || hash === '#users') return 'directory';
  if (hash.includes('roles/catalog')) return 'roles';
  if (hash.includes('roles/role-matrix') || hash.includes('role-matrix')) return 'matrix';
  if (hash.includes('roles/capability-matrix') || hash.includes('capability-matrix')) return 'capabilities';
  if (hash.includes('roles/security') || hash.includes('security')) return 'security';
  if (hash === '#roles') return fallback;
  return fallback;
};


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
    summary: 'Starts read-only triage and views project investigations, metrics, and feedback. Cannot change project settings, membership, feedback, or external systems.',
    tier: 'Management',
    analysisAllowed: true,
    responsibilities: ['Start read-only incident analyses', 'View the live triage board and evidence', 'Review project metrics and feedback'],
    governanceScope: 'Project Analysis & Read Access',
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
    summary: 'Starts read-only triage and views project investigations, metrics, and feedback. Cannot change project settings, membership, feedback, or external systems.',
    tier: 'Read-Only',
    analysisAllowed: true,
    responsibilities: ['Start read-only incident analyses', 'View live and completed investigations', 'Inspect evidence, metrics, and feedback'],
    governanceScope: 'Project Analysis & Read Access',
  },
  GENERIC_USER: {
    displayName: 'Generic User',
    summary: 'Uses personal platform experiments and local text tools. Has no access to project boards, metrics, feedback, knowledge, or connectors.',
    tier: 'General',
    analysisAllowed: false,
    responsibilities: ['Experiment with personally supplied text and JSON', 'Review own experiment results', 'Review own authenticated identity'],
    governanceScope: 'Personal Playground',
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
  const [activeTab, setActiveTab] = useState<TabType>(() => getTabFromHash(initialTab));
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Mutation and permission states
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

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
  const [savingRolePermission, setSavingRolePermission] = useState<string | null>(null);
  const [matrixUserSearch, setMatrixUserSearch] = useState('');
  const [capMatrixSearch, setCapMatrixSearch] = useState('');
  const [capMatrixCategory, setCapMatrixCategory] = useState('ALL');
  const assignableRoles = useMemo(() => roles.filter(role => ASSIGNABLE_ROLE_IDS.has(role.id)), [roles]);

  // Permission helpers
  const MANAGEMENT_ROLES = useMemo(() => new Set(['PLATFORM_ADMIN', 'PROJECT_OWNER']), []);
  const isPlatformAdmin = Boolean(principal?.roles?.includes('PLATFORM_ADMIN'));
  const canManageUsers = Boolean(principal?.roles?.some(r => MANAGEMENT_ROLES.has(r)));
  const isSelf = (userId: string) => principal?.subject === userId;

  const canModifyTargetUser = (targetUser: UserItem) => {
    if (!canManageUsers) return false;
    if (targetUser.roles.includes('PLATFORM_ADMIN') && !isPlatformAdmin) return false;
    return true;
  };

  const canDeleteTargetUser = (targetUser: UserItem) => {
    if (isSelf(targetUser.id)) return false;
    if (!canModifyTargetUser(targetUser)) return false;
    return true;
  };

  const canToggleTargetStatus = (targetUser: UserItem) => {
    if (isSelf(targetUser.id) && targetUser.status === 'active') return false;
    if (!canModifyTargetUser(targetUser)) return false;
    return true;
  };


  // Tab switching with browser history pushState
  const handleTabClick = (tab: TabType) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const { pathname, search } = window.location;
      const subroute = SUBROUTE_MAP[tab];
      const newUrl = `${pathname}${search}#${subroute}`;
      if (window.location.hash !== `#${subroute}`) {
        window.history.pushState(null, '', newUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
  };

  // Synchronize activeTab with URL hash changes (back/forward and direct links)
  useEffect(() => {
    const handleLocationChange = () => {
      const current = getTabFromHash(initialTab);
      setActiveTab(current);
    };
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
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

  // Filtered users for Role Assignment Matrix
  const filteredMatrixUsers = useMemo(() => {
    const q = matrixUserSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      u => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
    );
  }, [users, matrixUserSearch]);

  // Distinct capability categories
  const distinctCapCategories = useMemo(() => {
    const set = new Set<string>();
    capabilities.forEach(c => {
      if (c.category) set.add(c.category);
    });
    return Array.from(set);
  }, [capabilities]);

  // Filtered capabilities for Capability Matrix
  const filteredMatrixCaps = useMemo(() => {
    const q = capMatrixSearch.trim().toLowerCase();
    return capabilities.filter(cap => {
      const matchesSearch =
        !q ||
        cap.name.toLowerCase().includes(q) ||
        cap.id.toLowerCase().includes(q) ||
        (cap.description && cap.description.toLowerCase().includes(q));
      const matchesCat = capMatrixCategory === 'ALL' || cap.category === capMatrixCategory;
      return matchesSearch && matchesCat;
    });
  }, [capabilities, capMatrixSearch, capMatrixCategory]);

  // Total role assignments across all users
  const totalRoleAssignments = useMemo(() => {
    return users.reduce((acc, u) => acc + (u.roles || []).length, 0);
  }, [users]);

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

  const handleDeleteUser = async (target: UserItem | string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const user = typeof target === 'string' ? users.find(u => u.id === target) : target;
    const userId = typeof target === 'string' ? target : target.id;
    if (user && !canDeleteTargetUser(user)) {
      setError(isSelf(userId) ? 'Cannot delete your own membership account.' : 'Insufficient permissions to delete this user.');
      return;
    }
    if (deletingUserId) return;
    if (!window.confirm(`Are you sure you want to remove membership for '${user?.name || userId}'?`)) return;
    setDeletingUserId(userId);
    try {
      await deleteUser(userId);
      setActionFeedback(`User ${user?.name || userId} deleted from database.`);
      if (inspectedUser?.id === userId) {
        setInspectedUser(null);
      }
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleToggleUserRole = async (user: UserItem, roleId: string) => {
    if (!canModifyTargetUser(user)) {
      setError('Insufficient permissions to modify roles for this user.');
      return;
    }
    if (roleId === 'PLATFORM_ADMIN' && !isPlatformAdmin) {
      setError('Only a Platform Administrator can assign or revoke the Platform Administrator role.');
      return;
    }
    const hasRole = user.roles.includes(roleId);
    const nextRoles = hasRole
      ? user.roles.filter(r => r !== roleId)
      : [...user.roles, roleId];
    if (nextRoles.length === 0) {
      setError(`Cannot revoke all roles: User '${user.name || user.id}' must retain at least one role.`);
      return;
    }
    if (hasRole && isSelf(user.id) && MANAGEMENT_ROLES.has(roleId)) {
      const remainingManagement = nextRoles.filter(r => MANAGEMENT_ROLES.has(r));
      if (remainingManagement.length === 0) {
        setError('Cannot remove your own last management role.');
        return;
      }
    }
    if (savingUserId) return;
    setSavingUserId(user.id);
    const previousRoles = user.roles;
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
        `${hasRole ? 'Revoked' : 'Granted'} role ${roleId} for ${user.name || user.id} (persisted)`
      );
    } catch (err) {
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, roles: previousRoles } : u)));
      if (inspectedUser?.id === user.id) {
        setInspectedUser(prev => (prev ? { ...prev, roles: previousRoles } : null));
      }
      setError(err instanceof Error ? err.message : 'Failed to update role assignment');
      await loadData(true);
    } finally {
      setSavingUserId(null);
    }
  };

  const handleRemoveUserRole = async (user: UserItem, roleId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canModifyTargetUser(user)) {
      setError('Insufficient permissions to modify roles for this user.');
      return;
    }
    if (user.roles.length <= 1) {
      setError(`User '${user.name || user.id}' must retain at least one role.`);
      return;
    }
    if (isSelf(user.id) && MANAGEMENT_ROLES.has(roleId)) {
      const remainingManagement = user.roles.filter(r => r !== roleId && MANAGEMENT_ROLES.has(r));
      if (remainingManagement.length === 0) {
        setError('Cannot remove your own last management role.');
        return;
      }
    }
    if (savingUserId) return;
    setSavingUserId(user.id);
    const previousRoles = user.roles;
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
      setActionFeedback(`Removed role ${roleId} from ${user.name || user.id} (persisted)`);
    } catch (err) {
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, roles: previousRoles } : u)));
      if (inspectedUser?.id === user.id) {
        setInspectedUser(prev => (prev ? { ...prev, roles: previousRoles } : null));
      }
      setError(err instanceof Error ? err.message : 'Failed to remove role');
      await loadData(true);
    } finally {
      setSavingUserId(null);
    }
  };

  const handleAddUserRole = async (user: UserItem, roleId: string) => {
    if (!roleId || user.roles.includes(roleId)) return;
    if (!canModifyTargetUser(user)) {
      setError('Insufficient permissions to modify roles for this user.');
      return;
    }
    if (roleId === 'PLATFORM_ADMIN' && !isPlatformAdmin) {
      setError('Only a Platform Administrator can assign the Platform Administrator role.');
      return;
    }
    if (savingUserId) return;
    setSavingUserId(user.id);
    const previousRoles = user.roles;
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
      setActionFeedback(`Assigned role ${roleId} to ${user.name || user.id} (persisted)`);
    } catch (err) {
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, roles: previousRoles } : u)));
      if (inspectedUser?.id === user.id) {
        setInspectedUser(prev => (prev ? { ...prev, roles: previousRoles } : null));
      }
      setError(err instanceof Error ? err.message : 'Failed to add role');
      await loadData(true);
    } finally {
      setSavingUserId(null);
    }
  };

  const handleToggleUserStatus = async (user: UserItem) => {
    if (!canToggleTargetStatus(user)) {
      setError(isSelf(user.id) ? 'Cannot suspend your own authenticated account.' : 'Insufficient permissions to change status for this user.');
      return;
    }
    if (savingUserId) return;
    setSavingUserId(user.id);
    const previousStatus = user.status;
    const nextStatus = previousStatus === 'active' ? 'inactive' : 'active';
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
      setActionFeedback(`Membership status for ${user.name || user.id} set to ${nextStatus} (persisted)`);
    } catch (err) {
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, status: previousStatus } : u)));
      if (inspectedUser?.id === user.id) {
        setInspectedUser(prev => (prev ? { ...prev, status: previousStatus } : null));
      }
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
      await loadData(true);
    } finally {
      setSavingUserId(null);
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
    if (savingRolePermission) return;
    setSavingRolePermission(permission);
    const previousPerms = role.permissions || [];
    const nextPerms = previousPerms.filter(p => p !== permission);
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
      setActionFeedback(`Revoked descriptive action '${permission}' from role definition ${role.name}.`);
    } catch (err) {
      // Rollback to previous permissions on failure
      setRoles(prev => prev.map(r => (r.id === role.id ? { ...r, permissions: previousPerms } : r)));
      if (selectedRole?.id === role.id) {
        setSelectedRole(prev => (prev ? { ...prev, permissions: previousPerms } : null));
      }
      setError(err instanceof Error ? err.message : 'Failed to revoke descriptive action');
    } finally {
      setSavingRolePermission(null);
    }
  };

  const handleAddPermission = async (role: RoleItem, permission: string) => {
    if (savingRolePermission) return;
    if ((role.permissions || []).includes(permission)) return;
    setSavingRolePermission(permission);
    const previousPerms = role.permissions || [];
    const nextPerms = [...previousPerms, permission];
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
      setActionFeedback(`Granted descriptive action '${permission}' to role definition ${role.name}.`);
    } catch (err) {
      // Rollback to previous permissions on failure
      setRoles(prev => prev.map(r => (r.id === role.id ? { ...r, permissions: previousPerms } : r)));
      if (selectedRole?.id === role.id) {
        setSelectedRole(prev => (prev ? { ...prev, permissions: previousPerms } : null));
      }
      setError(err instanceof Error ? err.message : 'Failed to grant descriptive action');
    } finally {
      setSavingRolePermission(null);
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
      {/* Compact IAM Control Header */}
      <div className="iam-control-header">
        <div className="iam-header-main">
          <div className="iam-title-row">
            <ShieldCheck size={18} style={{ color: 'var(--acc)' }} />
            <h1 className="iam-page-title">Users & Access Control</h1>
            <span className="iam-scope-badge">
              <Lock size={11} /> RS256 JWT Verified
            </span>
          </div>
          <div className="iam-header-metrics">
            <span className="iam-metric-pill">
              <UsersIcon size={12} style={{ color: 'var(--acc)' }} />
              <strong>{loading ? '…' : users.length}</strong>
              <span className="iam-metric-label">Principals</span>
            </span>
            <span className="iam-metric-pill">
              <KeyRound size={12} style={{ color: '#10b981' }} />
              <strong>{loading ? '…' : roles.length}</strong>
              <span className="iam-metric-label">Roles</span>
            </span>
            <span className="iam-metric-pill">
              <Layers size={12} style={{ color: '#f59e0b' }} />
              <strong>{loading ? '…' : capabilities.length}</strong>
              <span className="iam-metric-label">Capabilities</span>
            </span>
            {principal && (
              <span
                className="iam-metric-pill user-session"
                title={`Authenticated as ${principal.subject} (${(principal.roles || []).join(', ')})`}
              >
                <span className="iam-metric-label">Session:</span>
                <strong>{principal.subject}</strong>
                <span className="iam-session-role">
                  {principal.roles && principal.roles[0] ? principal.roles[0].replace(/_/g, ' ') : 'USER'}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="iam-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadData(true)}
            disabled={loading || refreshing}
            title="Refresh IAM state"
          >
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {activeTab === 'roles' ? (
            canManageUsers && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleOpenCreateRole}
                title="Define custom role"
              >
                <Plus size={13} /> Add Role
              </button>
            )
          ) : (
            canManageUsers && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleOpenCreateUser}
                title="Register new user membership"
              >
                <Plus size={13} /> Add User
              </button>
            )
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          action={
            <button
              className="btn btn-outline btn-sm"
              onClick={() => void loadData(true)}
            >
              Retry
            </button>
          }
        />
      )}
      {actionFeedback && (
        <NotificationBanner
          type="success"
          message={actionFeedback}
          onClose={() => setActionFeedback(null)}
        />
      )}

      {/* Unified Sub-Navigation Strip */}
      <div className="iam-subnav-bar">
        <div className="iam-tabs-group" role="tablist" aria-label="Identity and Access Control views">
          <button
            type="button"
            role="tab"
            id="iam-tab-directory"
            aria-selected={activeTab === 'directory'}
            aria-controls="iam-panel-directory"
            className={`iam-tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
            onClick={() => handleTabClick('directory')}
          >
            <UsersIcon size={15} />
            <span>User Directory</span>
            <span className="iam-tab-pill">{users.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="iam-tab-roles"
            aria-selected={activeTab === 'roles'}
            aria-controls="iam-panel-roles"
            className={`iam-tab-btn ${activeTab === 'roles' ? 'active' : ''}`}
            onClick={() => handleTabClick('roles')}
          >
            <KeyRound size={15} />
            <span>Roles Catalog</span>
            <span className="iam-tab-pill">{roles.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="iam-tab-matrix"
            aria-selected={activeTab === 'matrix'}
            aria-controls="iam-panel-matrix"
            className={`iam-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => handleTabClick('matrix')}
          >
            <Layers size={15} />
            <span>Role Assignment Matrix</span>
          </button>
          <button
            type="button"
            role="tab"
            id="iam-tab-capabilities"
            aria-selected={activeTab === 'capabilities'}
            aria-controls="iam-panel-capabilities"
            className={`iam-tab-btn ${activeTab === 'capabilities' ? 'active' : ''}`}
            onClick={() => handleTabClick('capabilities')}
          >
            <ShieldCheck size={15} />
            <span>Capability Access Matrix</span>
          </button>
          <button
            type="button"
            role="tab"
            id="iam-tab-security"
            aria-selected={activeTab === 'security'}
            aria-controls="iam-panel-security"
            className={`iam-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => handleTabClick('security')}
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
                aria-label="Grid cards view"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                className={`iam-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table list view"
                aria-label="Table list view"
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
        <div role="tabpanel" id="iam-panel-directory" aria-labelledby="iam-tab-directory" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="iam-toolbar-panel">
            <div className="iam-search-box">
              <Search size={14} style={{ color: 'var(--muted)' }} />
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search users by name, ID, email, or role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="iam-clear-search-btn"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="iam-filter-controls">
              <select
                className="iam-filter-select"
                value={selectedRoleFilter}
                onChange={e => setSelectedRoleFilter(e.target.value)}
                aria-label="Filter by role"
              >
                <option value="ALL">All Roles ({users.length})</option>
                {distinctRoles.map(role => (
                  <option key={role} value={role}>
                    {role.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>

              <div className="iam-status-segmented" role="radiogroup" aria-label="Filter by status">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedStatusFilter === 'ALL'}
                  className={`iam-segmented-btn ${selectedStatusFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedStatusFilter('ALL')}
                >
                  All
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedStatusFilter === 'active'}
                  className={`iam-segmented-btn ${selectedStatusFilter === 'active' ? 'active' : ''}`}
                  onClick={() => setSelectedStatusFilter('active')}
                >
                  Active
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedStatusFilter === 'inactive'}
                  className={`iam-segmented-btn ${selectedStatusFilter === 'inactive' ? 'active' : ''}`}
                  onClick={() => setSelectedStatusFilter('inactive')}
                >
                  Inactive
                </button>
              </div>

              {(search || selectedRoleFilter !== 'ALL' || selectedStatusFilter !== 'ALL') && (
                <button
                  type="button"
                  className="iam-reset-filters-btn"
                  onClick={() => {
                    setSearch('');
                    setSelectedRoleFilter('ALL');
                    setSelectedStatusFilter('ALL');
                  }}
                  title="Reset all filters"
                >
                  Reset
                </button>
              )}
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
                          <div style={{ position: 'relative' }}>
                            <div className={`iam-avatar ${getAvatarClass(user)}`}>
                              {user.name ? user.name.charAt(0).toUpperCase() : user.id.charAt(0).toUpperCase()}
                            </div>
                            <span
                              className={`iam-avatar-dot ${user.status === 'active' ? 'active' : 'inactive'}`}
                              title={`Membership: ${user.status}`}
                            />
                          </div>
                          <div className="iam-user-meta">
                            <div className="iam-user-name-row">
                              <span className="iam-user-name" title={user.name || user.id}>
                                {user.name || user.id}
                              </span>
                              <span
                                className="iam-auth-badge"
                                title={`Authentication: ${user.authn_method || 'jwt_rs256'}`}
                              >
                                {user.authn_method || 'jwt_rs256'}
                              </span>
                            </div>
                            <span className="iam-user-id-badge">
                              <code>{user.id}</code>
                            </span>
                          </div>
                        </div>

                        <div className="iam-role-pills-wrap">
                          {user.roles.map(r => (
                            <span key={r} className={`iam-badge-role ${getTierClass(r)}`}>
                              <Shield size={10} />
                              {r.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>

                        <div className="iam-user-footer">
                          {user.email ? (
                            <span className="iam-email-text" title={user.email}>
                              <Mail size={12} style={{ flexShrink: 0 }} />
                              <span>{user.email}</span>
                            </span>
                          ) : (
                            <span className="iam-email-text iam-no-email">
                              <Mail size={12} style={{ flexShrink: 0 }} />
                              <span>No email assigned</span>
                            </span>
                          )}
                          <div className="iam-user-actions">
                            {canModifyTargetUser(user) && (
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={e => handleOpenEditUser(user, e)}
                                title="Edit user profile"
                                aria-label={`Edit ${user.name || user.id}`}
                              >
                                <Edit2 size={12} />
                              </button>
                            )}
                            {canToggleTargetStatus(user) && (
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={e => {
                                  e.stopPropagation();
                                  void handleToggleUserStatus(user);
                                }}
                                disabled={savingUserId === user.id}
                                title={user.status === 'active' ? 'Suspend membership' : 'Activate membership'}
                                aria-label={`${user.status === 'active' ? 'Suspend' : 'Activate'} ${user.name || user.id}`}
                              >
                                {user.status === 'active' ? (
                                  <XCircle size={12} style={{ color: '#f43f5e' }} />
                                ) : (
                                  <CheckCircle2 size={12} style={{ color: '#10b981' }} />
                                )}
                              </button>
                            )}
                            {canDeleteTargetUser(user) && (
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={e => handleDeleteUser(user, e)}
                                disabled={deletingUserId === user.id}
                                title="Delete user"
                                aria-label={`Delete ${user.name || user.id}`}
                              >
                                <Trash2 size={12} style={{ color: '#f43f5e' }} />
                              </button>
                            )}
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
                        <th>Auth Method</th>
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
                                <div style={{ position: 'relative' }}>
                                  <div
                                    className={`iam-avatar ${getAvatarClass(user)}`}
                                    style={{ width: 28, height: 28, fontSize: 11 }}
                                  >
                                    {user.name.charAt(0).toUpperCase()}
                                  </div>
                                  <span
                                    className={`iam-avatar-dot ${user.status === 'active' ? 'active' : 'inactive'}`}
                                    style={{ width: 8, height: 8, bottom: -1, right: -1 }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{user.name}</div>
                                  {user.email && (
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{user.email}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              <code>{user.id}</code>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {user.roles.map(r => (
                                  <span key={r} className={`iam-badge-role ${getTierClass(r)}`}>
                                    {r.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <span className="iam-auth-badge">{user.authn_method || 'jwt_rs256'}</span>
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
                                {canModifyTargetUser(user) && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={e => handleOpenEditUser(user, e)}
                                    title="Edit user"
                                    aria-label={`Edit ${user.name}`}
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                )}
                                {canToggleTargetStatus(user) && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={e => {
                                      e.stopPropagation();
                                      void handleToggleUserStatus(user);
                                    }}
                                    disabled={savingUserId === user.id}
                                    title={user.status === 'active' ? 'Suspend user' : 'Activate user'}
                                    aria-label={`${user.status === 'active' ? 'Suspend' : 'Activate'} ${user.name}`}
                                  >
                                    {user.status === 'active' ? (
                                      <XCircle size={12} style={{ color: '#f43f5e' }} />
                                    ) : (
                                      <CheckCircle2 size={12} style={{ color: '#10b981' }} />
                                    )}
                                  </button>
                                )}
                                {canDeleteTargetUser(user) && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={e => handleDeleteUser(user, e)}
                                    disabled={deletingUserId === user.id}
                                    title="Delete user"
                                    aria-label={`Delete ${user.name}`}
                                  >
                                    <Trash2 size={12} style={{ color: '#f43f5e' }} />
                                  </button>
                                )}
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
                    <div style={{ position: 'relative' }}>
                      <div
                        className={`iam-avatar ${getAvatarClass(inspectedUser)}`}
                        style={{ width: 48, height: 48, fontSize: 18 }}
                      >
                        {inspectedUser.name.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`iam-avatar-dot ${inspectedUser.status === 'active' ? 'active' : 'inactive'}`}
                        style={{ width: 12, height: 12, bottom: 0, right: 0 }}
                      />
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
                      {canToggleTargetStatus(inspectedUser) ? (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px', height: 'auto' }}
                          onClick={() => void handleToggleUserStatus(inspectedUser)}
                          disabled={savingUserId === inspectedUser.id}
                          title="Toggle active / inactive membership state"
                        >
                          {savingUserId === inspectedUser.id
                            ? 'Saving…'
                            : inspectedUser.status === 'active'
                            ? 'Suspend User'
                            : 'Activate User'}
                        </button>
                      ) : isSelf(inspectedUser.id) && inspectedUser.status === 'active' ? (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '3px 8px', height: 'auto', opacity: 0.6 }}
                          disabled
                          title="Cannot suspend your own authenticated session"
                        >
                          Active (Current)
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Email Address</div>
                    <div
                      className="iam-detail-val"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <span>
                        {inspectedUser.email ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Mail size={12} style={{ color: 'var(--muted)' }} />
                            {inspectedUser.email}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No email assigned</span>
                        )}
                      </span>
                      {canModifyTargetUser(inspectedUser) && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={e => handleOpenEditUser(inspectedUser, e)}
                          title="Edit email"
                          aria-label="Edit email"
                        >
                          <Edit2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Authentication Method</div>
                    <div className="iam-detail-val">
                      <code>{inspectedUser.authn_method || principal?.authn_method || 'jwt_rs256'}</code>
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div
                      className="iam-detail-label"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>Assigned Roles ({inspectedUser.roles.length})</span>
                      {canModifyTargetUser(inspectedUser) &&
                        assignableRoles.some(r => !inspectedUser.roles.includes(r.id)) && (
                          <select
                            className="iam-quick-add-select"
                            value=""
                            onChange={e => void handleAddUserRole(inspectedUser, e.target.value)}
                            disabled={savingUserId === inspectedUser.id}
                            aria-label="Quick assign role"
                          >
                            <option value="" disabled>
                              + Assign Role…
                            </option>
                            {assignableRoles
                              .filter(
                                r =>
                                  !inspectedUser.roles.includes(r.id) &&
                                  (r.id !== 'PLATFORM_ADMIN' || isPlatformAdmin)
                              )
                              .map(r => (
                                <option key={r.id} value={r.id}>
                                  {r.name || r.id}
                                </option>
                              ))}
                          </select>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {inspectedUser.roles.map(r => {
                        const cannotRemove =
                          inspectedUser.roles.length <= 1 ||
                          (isSelf(inspectedUser.id) && MANAGEMENT_ROLES.has(r)) ||
                          !canModifyTargetUser(inspectedUser) ||
                          savingUserId === inspectedUser.id;
                        return (
                          <span key={r} className={`iam-badge-role ${getTierClass(r)} iam-badge-editable`}>
                            <Shield size={11} />
                            <span
                              onClick={() => {
                                const match = roles.find(item => item.id === r);
                                if (match) setSelectedRole(match);
                                handleTabClick('roles');
                              }}
                              title="Click to view in Roles Catalog"
                              style={{ cursor: 'pointer' }}
                            >
                              {r.replace(/_/g, ' ')}
                            </span>
                            {canModifyTargetUser(inspectedUser) && (
                              <button
                                type="button"
                                className="iam-pill-remove-btn"
                                onClick={e => void handleRemoveUserRole(inspectedUser, r, e)}
                                title={
                                  inspectedUser.roles.length <= 1
                                    ? 'User must retain at least one role'
                                    : isSelf(inspectedUser.id) && MANAGEMENT_ROLES.has(r)
                                    ? 'Cannot remove your own last management role'
                                    : `Remove ${r} from ${inspectedUser.name}`
                                }
                                disabled={cannotRemove}
                                aria-label={`Remove role ${r}`}
                              >
                                <X size={10} />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">
                      Role-Aligned Capabilities ({userAuthorizedCapabilities.length})
                    </div>
                    <div className="iam-cap-note">
                      <Info size={13} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />
                      Role alignment reflects declared role restrictions. Runtime execution enforces minimum role hierarchy, enabled state, project scope, and connector health.
                    </div>
                    <div className="iam-caps-list">
                      {userAuthorizedCapabilities.slice(0, 8).map(c => (
                        <div key={c.id} className="iam-cap-row">
                          <span className="iam-cap-name">{c.name}</span>
                          <span className="iam-cap-cat">{c.category}</span>
                        </div>
                      ))}
                      {userAuthorizedCapabilities.length === 0 && (
                        <div className="iam-caps-empty">
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
                      disabled={!canModifyTargetUser(inspectedUser)}
                    >
                      <Edit2 size={13} /> Edit Profile
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => handleTabClick('roles')}
                      title="Inspect Roles Catalog"
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
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: ROLES CATALOG & RESPONSIBILITIES                              */}
      {/* ==================================================================== */}
      {activeTab === 'roles' && (
        <div role="tabpanel" id="iam-panel-roles" aria-labelledby="iam-tab-roles" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

          <div className="iam-master-detail iam-roles-master-detail">
            {/* Left: Role List Items */}
            <div className="iam-role-list-pane">
              {filteredRoles.map(role => {
                const isSelected = selectedRole?.id === role.id;
                const userCount = users.filter(u => u.roles.includes(role.id)).length;
                const resp = ROLE_RESPONSIBILITIES[role.id];
                const isSystem = ASSIGNABLE_ROLE_IDS.has(role.id);

                return (
                  <button
                    type="button"
                    key={role.id}
                    className={`iam-role-item-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedRole(role)}
                  >
                    <div className="iam-role-card-header">
                      <span className="iam-role-item-title" title={role.name}>{role.name}</span>
                      <div className="iam-role-card-header-right">
                        <span className="iam-role-user-count" title={`${userCount} assigned ${userCount === 1 ? 'user' : 'users'}`}>
                          <UsersIcon size={11} />
                          <span>{userCount}</span>
                        </span>
                        <ChevronRight size={13} className="iam-role-chevron" />
                      </div>
                    </div>

                    <div className="iam-role-card-sub">
                      <span className="iam-role-item-code">{role.id}</span>
                      {resp && (
                        <span className="iam-role-item-scope">
                          {resp.governanceScope}
                          {!resp.analysisAllowed && (
                            <span className="iam-role-no-triage">• No Triage</span>
                          )}
                        </span>
                      )}
                    </div>

                    <div className="iam-role-card-badges">
                      {isSystem ? (
                        <span className="iam-badge-role tier-admin">System</span>
                      ) : (
                        <span className="iam-badge-role tier-gen">Custom</span>
                      )}
                      <span className={`iam-badge-role ${getTierClass(role.tier || role.id)}`}>
                        {role.tier || 'Operational'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right: Detailed Role Dossier */}
            <div className="iam-detail-pane">
              {selectedRole ? (
                <div className="iam-detail-card">
                  {/* Hero Header */}
                  <div className="iam-detail-hero">
                    <div className="iam-stat-icon-wrapper purple" style={{ width: 44, height: 44 }}>
                      <ShieldCheck size={22} />
                    </div>
                    <div className="iam-detail-hero-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h3 className="iam-detail-hero-name" style={{ margin: 0 }}>{selectedRole.name}</h3>
                        {ASSIGNABLE_ROLE_IDS.has(selectedRole.id) ? (
                          <span className="iam-badge-role tier-admin" style={{ fontSize: 11 }}>
                            <CheckCircle2 size={11} /> Supported System Role
                          </span>
                        ) : (
                          <span className="iam-badge-role tier-gen" style={{ fontSize: 11 }}>
                            <BookOpen size={11} /> Custom Catalog Role
                          </span>
                        )}
                      </div>
                      <div className="iam-detail-hero-sub">Identifier: {selectedRole.id}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`iam-badge-role ${getTierClass(selectedRole.tier || selectedRole.id)}`}>
                        {selectedRole.tier || 'Operational'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => handleOpenEditRole(selectedRole)}
                        title="Edit role definition"
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      {!selectedRole.is_system && !ASSIGNABLE_ROLE_IDS.has(selectedRole.id) && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ color: '#f43f5e', fontSize: 12, padding: '4px 10px' }}
                          onClick={e => handleDeleteRole(selectedRole.id, e)}
                          title="Delete custom role definition"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Descriptive Role Catalog Notice */}
                  <div className="iam-descriptive-notice">
                    <Info size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--acc)' }} />
                    <div>
                      <div>
                        <b>Descriptive Role Catalog:</b> Permission lists defined in this catalog document intended actions.
                        Runtime authorization is governed by backend capability policies, minimum roles, and project scope.
                      </div>
                      {!ASSIGNABLE_ROLE_IDS.has(selectedRole.id) && (
                        <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 11 }}>
                          Notice: Custom roles cannot be assigned to principals in the backend; user membership requires supported system roles.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Core Responsibilities Box */}
                  {ROLE_RESPONSIBILITIES[selectedRole.id] ? (
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 8,
                        background:
                          selectedRole.id === 'PROJECT_MANAGER'
                            ? 'rgba(245, 158, 11, 0.08)'
                            : 'var(--card-subtle)',
                        border:
                          selectedRole.id === 'PROJECT_MANAGER'
                            ? '1px solid rgba(245, 158, 11, 0.25)'
                            : '1px solid var(--line)',
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
                          marginBottom: 6,
                        }}
                      >
                        <Sparkles size={13} /> Role Responsibilities & Governance Scope ({ROLE_RESPONSIBILITIES[selectedRole.id].governanceScope})
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
                        {ROLE_RESPONSIBILITIES[selectedRole.id].summary}
                      </p>
                      <div className="iam-resp-list">
                        {ROLE_RESPONSIBILITIES[selectedRole.id].responsibilities.map((r, i) => (
                          <div key={i} className="iam-resp-item">
                            <CheckCircle2 size={13} style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>
                      {!ROLE_RESPONSIBILITIES[selectedRole.id].analysisAllowed && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#f87171',
                            fontSize: 11,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <AlertTriangle size={13} />
                          <span>Analysis & Triage Restricted: Principals holding this role alone cannot execute incident triage or diagnostic log correlation.</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="iam-detail-row">
                      <div className="iam-detail-label">Role Description</div>
                      <div className="iam-detail-val">{selectedRole.description || 'Custom platform role.'}</div>
                    </div>
                  )}

                  {/* Multi-Column Dossier Workspace */}
                  <div className="iam-dossier-grid">
                    {/* Column 1: Descriptive Permissions & Actions */}
                    <div className="iam-dossier-col">
                      <div className="iam-detail-row">
                        <div
                          className="iam-detail-label"
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <span>Descriptive Actions ({(selectedRole.permissions || []).length})</span>
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                            Click × to revoke or + to grant
                          </span>
                        </div>

                        {savingRolePermission && (
                          <div style={{ fontSize: 11, color: 'var(--acc)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <RefreshCw size={11} className="spin" /> Updating role definition...
                          </div>
                        )}

                        <div className="iam-permissions-container" style={{ marginTop: 6 }}>
                          {/* Active Granted Permissions */}
                          <div className="iam-permissions-list">
                            {(selectedRole.permissions || []).map(p => (
                              <span key={p} className="iam-permission-pill active">
                                <span>{p}</span>
                                <button
                                  type="button"
                                  className="iam-pill-remove-btn"
                                  disabled={Boolean(savingRolePermission)}
                                  onClick={() => void handleRemovePermission(selectedRole, p)}
                                  title={`Revoke descriptive action '${p}' from role definition`}
                                  aria-label={`Revoke action ${p}`}
                                >
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                            {(!selectedRole.permissions || selectedRole.permissions.length === 0) && (
                              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                                No granular actions cataloged for this role.
                              </span>
                            )}
                          </div>

                          {/* Available Unassigned Platform Actions */}
                          {availableActions.some(action => !(selectedRole.permissions || []).includes(action)) && (
                            <div style={{ marginTop: 10 }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--muted)',
                                  marginBottom: 4,
                                  textTransform: 'uppercase',
                                  fontWeight: 600,
                                }}
                              >
                                Available Actions to Catalog:
                              </div>
                              <div className="iam-permissions-list">
                                {availableActions
                                  .filter(action => !(selectedRole.permissions || []).includes(action))
                                  .map(action => (
                                    <button
                                      type="button"
                                      key={action}
                                      disabled={Boolean(savingRolePermission)}
                                      className="iam-permission-pill add-pill"
                                      onClick={() => void handleAddPermission(selectedRole, action)}
                                      title={`Add action '${action}' to role definition`}
                                      aria-label={`Add action ${action}`}
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
                    </div>

                    {/* Column 2: Assigned Principals & Permitted Capabilities */}
                    <div className="iam-dossier-col">
                      <div className="iam-detail-row">
                        <div className="iam-detail-label">Assigned Principals ({roleAssignedUsers.length})</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {roleAssignedUsers.map(u => (
                            <span
                              key={u.id}
                              className="meta-pill"
                              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                              onClick={() => {
                                setInspectedUser(u);
                                handleTabClick('directory');
                              }}
                              title="Click to view in User Directory"
                            >
                              <UsersIcon size={11} />
                              <b>{u.name}</b> <span style={{ opacity: 0.7, fontSize: 10 }}>({u.id})</span>
                            </span>
                          ))}
                          {roleAssignedUsers.length === 0 && (
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                              No principals in this project currently hold this role.
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="iam-detail-row">
                        <div className="iam-detail-label">
                          Explicitly Permitted Capabilities ({roleAuthorizedCapabilities.length})
                        </div>
                        <div className="iam-caps-list">
                          {roleAuthorizedCapabilities.map(c => (
                            <div key={c.id} className="iam-cap-row">
                              <div>
                                <div className="iam-cap-name">{c.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{c.id}</div>
                              </div>
                              <span className="iam-cap-cat">{c.category}</span>
                            </div>
                          ))}
                          {roleAuthorizedCapabilities.length === 0 && (
                            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                              No capabilities explicitly list this role in allowed_roles.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="iam-detail-card" style={{ textAlign: 'center', padding: 32 }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Select a role to inspect its permissions.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: ROLE ASSIGNMENT MATRIX                                        */}
      {/* ==================================================================== */}
      {activeTab === 'matrix' && (
        <div className="iam-matrix-card" role="tabpanel" id="iam-panel-matrix" aria-labelledby="iam-tab-matrix">
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
                System Role Assignment Matrix
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                Manage project role membership across supported system roles. User assignments are persisted in real time to PostgreSQL.
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
                Unassigned (Click to toggle)
              </span>
            </div>
          </div>

          <div className="iam-matrix-toolbar">
            <div className="iam-matrix-search">
              <Search size={14} style={{ color: 'var(--muted)' }} />
              <input
                type="search"
                placeholder="Search principals by name or ID..."
                value={matrixUserSearch}
                onChange={e => setMatrixUserSearch(e.target.value)}
                aria-label="Search principals in role matrix"
              />
            </div>
            <div className="iam-matrix-meta-summary">
              <span><b>{filteredMatrixUsers.length}</b> of <b>{users.length}</b> Principals</span>
              <span>•</span>
              <span><b>{totalRoleAssignments}</b> Active Role Grants</span>
            </div>
          </div>

          <div className="iam-matrix-table-wrap">
            <table className="iam-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Principal</th>
                  <th style={{ minWidth: 120 }}>Subject ID</th>
                  {assignableRoles.map(r => (
                    <th key={r.id} style={{ textAlign: 'center', minWidth: 110 }}>
                      <span className={`iam-badge-role ${getTierClass(r.id)}`} style={{ fontSize: 10 }}>
                        {r.name || r.id.replaceAll('_', ' ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMatrixUsers.length === 0 ? (
                  <tr>
                    <td colSpan={assignableRoles.length + 2} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                      No principals found matching &quot;{matrixUserSearch}&quot;.
                    </td>
                  </tr>
                ) : (
                  filteredMatrixUsers.map(u => (
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
                      {assignableRoles.map(r => {
                        const hasRole = u.roles.includes(r.id);
                        const disabled =
                          !canModifyTargetUser(u) ||
                          (r.id === 'PLATFORM_ADMIN' && !isPlatformAdmin) ||
                          savingUserId === u.id ||
                          (hasRole && u.roles.length <= 1) ||
                          (hasRole &&
                            isSelf(u.id) &&
                            MANAGEMENT_ROLES.has(r.id) &&
                            u.roles.filter(role => role !== r.id && MANAGEMENT_ROLES.has(role)).length === 0);
                        return (
                          <td key={r.id} style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className={`iam-matrix-toggle-btn ${hasRole ? 'active' : 'inactive'}`}
                              onClick={() => void handleToggleUserRole(u, r.id)}
                              aria-pressed={hasRole}
                              disabled={disabled}
                              aria-label={`${hasRole ? 'Revoke' : 'Grant'} role ${r.name || r.id} for ${u.name}`}
                              title={
                                disabled
                                  ? 'Role assignment change restricted by governance policy'
                                  : `Click to ${hasRole ? 'revoke' : 'grant'} role ${r.name || r.id} for ${u.name}`
                              }
                            >
                              {hasRole ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: CAPABILITY ACCESS MATRIX                                      */}
      {/* ==================================================================== */}
      {activeTab === 'capabilities' && (
        <div className="iam-matrix-card" role="tabpanel" id="iam-panel-capabilities" aria-labelledby="iam-tab-capabilities">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
              Capability RBAC Access Matrix
            </h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              Cross-tabulation mapping investigation capabilities to server-authorized roles. Capabilities with no explicit role restriction
              still require minimum role thresholds, connector availability, and authenticated tenant/project scope.
            </p>
          </div>

          <div className="iam-matrix-toolbar">
            <div className="iam-matrix-search">
              <Search size={14} style={{ color: 'var(--muted)' }} />
              <input
                type="search"
                placeholder="Search capabilities by name, ID, or description..."
                value={capMatrixSearch}
                onChange={e => setCapMatrixSearch(e.target.value)}
                aria-label="Search capabilities"
              />
            </div>

            <div className="iam-filter-group">
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                Category:
              </span>
              <button
                type="button"
                className={`iam-filter-chip ${capMatrixCategory === 'ALL' ? 'active' : ''}`}
                onClick={() => setCapMatrixCategory('ALL')}
              >
                All
              </button>
              {distinctCapCategories.map(cat => (
                <button
                  type="button"
                  key={cat}
                  className={`iam-filter-chip ${capMatrixCategory === cat ? 'active' : ''}`}
                  onClick={() => setCapMatrixCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="iam-matrix-meta-summary">
              <span><b>{filteredMatrixCaps.length}</b> of <b>{capabilities.length}</b> Capabilities</span>
            </div>
          </div>

          <div className="iam-matrix-table-wrap">
            <table className="iam-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>Capability</th>
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
                {filteredMatrixCaps.length === 0 ? (
                  <tr>
                    <td colSpan={roles.length + 2} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                      No capabilities found matching the active filter.
                    </td>
                  </tr>
                ) : (
                  filteredMatrixCaps.map(cap => {
                    const allowed = cap.permissions?.allowed_roles || [];
                    const hasExplicitRestriction = allowed.length > 0;
                    return (
                      <tr key={cap.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600 }}>{cap.name}</span>
                            {!hasExplicitRestriction && (
                              <span className="badge badge-neutral" style={{ fontSize: 9, padding: '1px 5px' }}>
                                No explicit role restriction
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {cap.id}
                            {!hasExplicitRestriction && (
                              <span style={{ opacity: 0.7, marginLeft: 4 }}>(subject to minimum role & scope)</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="iam-cap-cat">{cap.category}</span>
                        </td>
                        {roles.map(r => {
                          const permitted = !hasExplicitRestriction || allowed.includes(r.id);
                          return (
                            <td key={r.id} style={{ textAlign: 'center' }}>
                              {permitted ? (
                                <span
                                  className="iam-matrix-check"
                                  title={
                                    hasExplicitRestriction
                                      ? `${r.name} explicitly authorized for ${cap.name}`
                                      : `No explicit role restriction for ${cap.name} (requires minimum role & project scope)`
                                  }
                                >
                                  <CheckCircle2 size={14} />
                                </span>
                              ) : (
                                <span
                                  className="iam-matrix-cross"
                                  title={`${r.name} not permitted for ${cap.name}`}
                                >
                                  <XCircle size={14} />
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: SECURITY & SCOPING POLICY                                     */}
      {/* ==================================================================== */}
      {activeTab === 'security' && (
        <div style={{ display: 'grid', gap: 16 }} role="tabpanel" id="iam-panel-security" aria-labelledby="iam-tab-security">
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
            <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Lock size={16} style={{ color: 'var(--acc)' }} />
              Security Hardening Guardrails
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginTop: 12 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Local Diagnostic Files Only</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Zero remote URL fetching. Bounded parsing and OCR-only image text extraction.</div>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>No Arbitrary Code Execution</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Zero arbitrary macros or code execution. ADK agent execution paths are strictly typed.</div>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>UTC Request Deadlines</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Enforced execution deadlines and timeouts prevent unbounded investigation loops.</div>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--card-subtle)', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Read-Only Live Connectors</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Jira and Splunk connectors operate in strictly read-only query mode.</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal size={16} style={{ color: 'var(--acc)' }} />
              Development Utility: Scoped JWT Token Issuer
            </h4>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
              For offline development and smoke testing in <code>RCA_MODE=demo</code> deployments, signed RS256 JWT tokens
              can be issued for configured server principals (configured in <code>RCA_PRINCIPALS_JSON</code>) using the offline script:
            </p>
            <pre style={{ padding: 12, borderRadius: 8, background: 'var(--code-bg)', fontSize: 12, overflowX: 'auto', margin: 0 }}>
              <code>uv run python -m scripts.issue_dev_token &lt;principal_subject&gt; --expires-in 86400</code>
            </pre>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0', fontStyle: 'italic' }}>
              Note: This script requires a local private key file, is restricted to demo mode, and only accepts subjects explicitly defined in server configuration.
            </p>
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
