import React, { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  ShieldCheck,
  Building,
  KeyRound,
  RefreshCw,
  Search,
  Plus,
  Edit2,
  Trash2,
  Users as UsersIcon,
  Layers,
  CheckCircle2,
  XCircle,
  ExternalLink,
  X,
  Lock,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  fetchRoles,
  fetchUsers,
  fetchCapabilities,
  fetchPrincipal,
  fetchPermissions,
  createRole,
  updateRole,
  deleteRole,
} from '../services/api';
import { RoleItem, UserItem, CapabilityItem, Principal } from '../types/api';
import { ActivePage } from '../components/Sidebar';
import '../styles/users-roles.css';

interface RolesProps {
  onSelectPage?: (page: ActivePage) => void;
}

type TabType = 'catalog' | 'matrix' | 'hierarchy';

export const Roles: React.FC<RolesProps> = ({ onSelectPage }) => {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('catalog');

  const [search, setSearch] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState('ALL');
  const [selectedRole, setSelectedRole] = useState<RoleItem | null>(null);

  // Modal states for Create/Edit Role
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [rolesData, usersData, capsData, meData, permsData] = await Promise.all([
        fetchRoles(),
        fetchUsers().catch(() => [] as UserItem[]),
        fetchCapabilities(true).catch(() => [] as CapabilityItem[]),
        fetchPrincipal().catch(() => null),
        fetchPermissions().catch(() => [] as string[]),
      ]);

      const normalizedRoles = (Array.isArray(rolesData) ? rolesData : []).map(r => ({
        ...r,
        id: r.id || r.role_id || '',
        name: r.name || r.id || r.role_id || '',
        tier: r.tier || 'General',
        description: r.description || '',
        permissions: r.permissions || [],
      }));

      setRoles(normalizedRoles);
      setUsers(usersData);
      setCapabilities(capsData);
      setPrincipal(meData);
      setAvailableActions(permsData);

      if (normalizedRoles.length > 0 && !selectedRole) {
        setSelectedRole(normalizedRoles[0]);
      } else if (selectedRole) {
        const stillExists = normalizedRoles.find(r => r.id === selectedRole.id);
        setSelectedRole(stillExists || normalizedRoles[0] || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load roles');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const getTierClass = (tier?: string) => {
    const t = (tier || '').toLowerCase();
    if (t.includes('admin')) return 'tier-admin';
    if (t.includes('manage')) return 'tier-mgmt';
    if (t.includes('operat')) return 'tier-ops';
    if (t.includes('gov')) return 'tier-gov';
    if (t.includes('spec')) return 'tier-spec';
    return 'tier-view';
  };

  // Distinct tiers from real roles
  const distinctTiers = useMemo(() => {
    const set = new Set<string>();
    roles.forEach(r => {
      if (r.tier) set.add(r.tier);
    });
    return Array.from(set);
  }, [roles]);

  // Filtered roles
  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roles.filter(role => {
      const tier = role.tier || 'General';
      const matchesSearch =
        !q ||
        role.name.toLowerCase().includes(q) ||
        role.id.toLowerCase().includes(q) ||
        role.description.toLowerCase().includes(q);

      const matchesTier = selectedTierFilter === 'ALL' || tier === selectedTierFilter;

      return matchesSearch && matchesTier;
    });
  }, [roles, search, selectedTierFilter]);

  // Users assigned to the currently selected role
  const assignedUsers = useMemo(() => {
    if (!selectedRole) return [];
    return users.filter(u => u.roles.includes(selectedRole.id));
  }, [selectedRole, users]);

  // Capabilities that allow the currently selected role
  const authorizedCapabilities = useMemo(() => {
    if (!selectedRole) return [];
    return capabilities.filter(cap => {
      const allowed = cap.permissions?.allowed_roles || [];
      if (allowed.length === 0) return true; // public or unconstrained
      return allowed.includes(selectedRole.id);
    });
  }, [selectedRole, capabilities]);

  const handleOpenCreate = () => {
    setModalMode('create');
    setFormId('');
    setFormName('');
    setFormDesc('');
    setFormPermissions(['view_runs', 'create_runs']);
    setModalOpen(true);
  };

  const handleOpenEdit = (role: RoleItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setModalMode('edit');
    setFormId(role.id);
    setFormName(role.name);
    setFormDesc(role.description);
    setFormPermissions([...(role.permissions || [])]);
    setModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionFeedback(null);
    try {
      if (modalMode === 'create') {
        const created = await createRole({
          id: formId.trim().toUpperCase(),
          name: formName.trim(),
          description: formDesc.trim(),
          permissions: formPermissions,
          status: 'active',
        });
        setActionFeedback(`Role '${created.name}' created successfully.`);
      } else {
        const updated = await updateRole(formId, {
          name: formName.trim(),
          description: formDesc.trim(),
          permissions: formPermissions,
          status: 'active',
        });
        setActionFeedback(`Role '${updated.name}' updated successfully.`);
      }
      setModalOpen(false);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRole = async (roleId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete custom role '${roleId}'?`)) return;
    try {
      await deleteRole(roleId);
      setActionFeedback(`Role '${roleId}' deleted.`);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    }
  };

  const handleRemovePermission = async (role: RoleItem, permission: string) => {
    const nextPerms = (role.permissions || []).filter(p => p !== permission);
    // Optimistic update
    setRoles(prev => prev.map(r => r.id === role.id ? { ...r, permissions: nextPerms } : r));
    if (selectedRole?.id === role.id) {
      setSelectedRole(prev => prev ? { ...prev, permissions: nextPerms } : null);
    }
    try {
      await updateRole(role.id, {
        name: role.name,
        description: role.description,
        permissions: nextPerms,
        status: role.status || 'active',
      });
      setActionFeedback(`Revoked permission '${permission}' from ${role.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke permission');
      await loadData(true);
    }
  };

  const handleAddPermission = async (role: RoleItem, permission: string) => {
    if ((role.permissions || []).includes(permission)) return;
    const nextPerms = [...(role.permissions || []), permission];
    // Optimistic update
    setRoles(prev => prev.map(r => r.id === role.id ? { ...r, permissions: nextPerms } : r));
    if (selectedRole?.id === role.id) {
      setSelectedRole(prev => prev ? { ...prev, permissions: nextPerms } : null);
    }
    try {
      await updateRole(role.id, {
        name: role.name,
        description: role.description,
        permissions: nextPerms,
        status: role.status || 'active',
      });
      setActionFeedback(`Granted permission '${permission}' to ${role.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant permission');
      await loadData(true);
    }
  };

  const togglePermission = (action: string) => {
    setFormPermissions(prev =>
      prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action]
    );
  };

  return (
    <div className="view-container iam-page">
      {/* Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Roles, <span>RBAC & Scope</span> Governance
          </h1>
          <p className="hero-lede">
            Server-owned role hierarchies, capability permissions, and cryptographic access boundaries
            enforced across this project deployment.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{loading ? '…' : roles.length}</b> Configured Roles
            </span>
            <span className="hero-stat-chip">
              <UsersIcon size={13} style={{ color: 'var(--acc)' }} />
              <b>{loading ? '…' : users.length}</b> Assigned Principals
            </span>
            <span className="hero-stat-chip">
              <ShieldCheck size={13} style={{ color: 'var(--acc2)' }} />
              <b>Tiers:</b> {distinctTiers.length} Classification Levels
            </span>
            <span className="hero-stat-chip">
              <Lock size={13} style={{ color: '#10b981' }} />
              <b>Enforcement:</b> Server Policy (Hard Scoped)
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenCreate}
            title="Define new role"
          >
            <Plus size={14} /> Add Role
          </button>
        </div>
      </section>

      {/* Scoping Notice */}
      <div className="notice-banner blue">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Building size={17} style={{ color: 'var(--acc)' }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
            Immutable Server-Side Role Enforcement
          </h3>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          The API validates issuer, audience, deployment scope, and server-side subject membership.
          Roles and project scope are signed into verified RS256 JWT tokens and <b>never</b> accepted from request bodies.
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          action={
            <button className="btn btn-outline btn-sm" onClick={() => void loadData(true)}>
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

      {/* Sub-Navigation Strip */}
      <div className="iam-subnav-bar">
        <div className="iam-tabs-group">
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => setActiveTab('catalog')}
          >
            <KeyRound size={15} />
            <span>Role Catalog & Dossier</span>
            <span className="iam-tab-pill">{roles.length}</span>
          </button>
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => setActiveTab('matrix')}
          >
            <Layers size={15} />
            <span>Capability Access Matrix</span>
          </button>
          <button
            type="button"
            className={`iam-tab-btn ${activeTab === 'hierarchy' ? 'active' : ''}`}
            onClick={() => setActiveTab('hierarchy')}
          >
            <Shield size={15} />
            <span>Privilege Hierarchy</span>
          </button>
        </div>

        <div className="iam-subnav-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onSelectPage?.('users')}
            title="Navigate to Users Directory"
          >
            <UsersIcon size={14} /> View Users Directory
          </button>
        </div>
      </div>

      {/* TAB 1: ROLE CATALOG & DOSSIER */}
      {activeTab === 'catalog' && (
        <>
          {/* Toolbar with Search and Tier Filter */}
          <div className="iam-toolbar-panel">
            <div className="iam-search-box">
              <Search size={15} style={{ color: 'var(--muted)' }} />
              <input
                type="search"
                aria-label="Search roles"
                placeholder="Search roles by name, ID, or description…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="iam-filter-group">
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                Tier:
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

          {/* Master-Detail Split */}
          <div className="iam-master-detail">
            {/* Left: Role List Items */}
            <div className="iam-role-list-pane">
              {filteredRoles.map(role => {
                const isSelected = selectedRole?.id === role.id;
                const userCount = users.filter(u => u.roles.includes(role.id)).length;
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
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`iam-badge-role ${getTierClass(role.tier)}`}>
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
                    <span className={`iam-badge-role ${getTierClass(selectedRole.tier)}`}>
                      {selectedRole.tier || 'Operational'}
                    </span>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Role Description</div>
                    <div className="iam-detail-val">{selectedRole.description}</div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">Assigned Users ({assignedUsers.length})</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {assignedUsers.map(u => (
                        <span
                          key={u.id}
                          className="meta-pill"
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => onSelectPage?.('users')}
                          title="Click to view in Users Directory"
                        >
                          <UsersIcon size={11} />
                          <b>{u.name}</b> ({u.id})
                        </span>
                      ))}
                      {assignedUsers.length === 0 && (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          No users in this project currently hold this role.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label">
                      Authorized Capabilities ({authorizedCapabilities.length})
                    </div>
                    <div className="iam-caps-list">
                      {authorizedCapabilities.map(c => (
                        <div key={c.id} className="iam-cap-row">
                          <span className="iam-cap-name">{c.name}</span>
                          <span className="iam-cap-cat">{c.category}</span>
                        </div>
                      ))}
                      {authorizedCapabilities.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          No capabilities specifically restricted to this role.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="iam-detail-row">
                    <div className="iam-detail-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Permissions & Actions ({(selectedRole.permissions || []).length})</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Click × to revoke or + to grant</span>
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
                            No granular permissions assigned. Governed by capability policy.
                          </span>
                        )}
                      </div>

                      {/* Available Unassigned Permissions */}
                      {availableActions.some(action => !(selectedRole.permissions || []).includes(action)) && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>
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

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => handleOpenEdit(selectedRole)}
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

      {/* TAB 2: CAPABILITY ACCESS MATRIX */}
      {activeTab === 'matrix' && (
        <div className="iam-matrix-card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
              Capability RBAC Access Matrix
            </h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              Cross-tabulation mapping investigation capabilities to server-authorized roles.
            </p>
          </div>
          <div className="iam-matrix-table-wrap">
            <table className="iam-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Capability</th>
                  <th style={{ minWidth: 100 }}>Category</th>
                  {roles.map(r => (
                    <th key={r.id} style={{ textAlign: 'center', minWidth: 110 }}>
                      <span className={`iam-badge-role ${getTierClass(r.tier)}`} style={{ fontSize: 10 }}>
                        {r.name}
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
                              <span className="iam-matrix-cross">
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

      {/* TAB 3: PRIVILEGE HIERARCHY */}
      {activeTab === 'hierarchy' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {distinctTiers.map(tierName => {
            const tierRoles = roles.filter(r => (r.tier || 'General') === tierName);
            return (
              <div key={tierName} className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`iam-badge-role ${getTierClass(tierName)}`} style={{ fontSize: 12 }}>
                      {tierName}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Platform role classification tier
                    </span>
                  </div>
                  <span className="iam-tab-pill">{tierRoles.length} {tierRoles.length === 1 ? 'role' : 'roles'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
                  {tierRoles.map(r => (
                    <div
                      key={r.id}
                      style={{
                        padding: 12,
                        background: 'var(--card-subtle)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        setSelectedRole(r);
                        setActiveTab('catalog');
                      }}
                    >
                      <div style={{ fontWeight: 650, fontSize: 13, color: 'var(--text)' }}>{r.name}</div>
                      <code style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginTop: 3 }}>{r.id}</code>
                      {r.description && (
                        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0', lineHeight: 1.4 }}>
                          {r.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT ROLE MODAL */}
      {modalOpen && (
        <div className="iam-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="iam-modal-card" onClick={e => e.stopPropagation()}>
            <div className="iam-modal-header">
              <h3 className="iam-modal-title">
                {modalMode === 'create' ? 'Create Custom Role' : `Edit Role: ${formId}`}
              </h3>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveRole} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {modalMode === 'create' && (
                <div className="iam-form-group">
                  <label htmlFor="role-id">Role Identifier *</label>
                  <input
                    id="role-id"
                    className="iam-form-input"
                    placeholder="e.g. CUSTOM_ANALYST"
                    required
                    value={formId}
                    onChange={e => setFormId(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
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
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                />
              </div>

              <div className="iam-form-group">
                <label htmlFor="role-desc">Description</label>
                <input
                  id="role-desc"
                  className="iam-form-input"
                  placeholder="e.g. Grants investigation monitoring and run execution privileges"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                />
              </div>

              <div className="iam-form-group">
                <label>Assigned Actions & Permissions ({formPermissions.length})</label>
                <div className="iam-checkbox-group">
                  {availableActions.map(action => (
                    <label key={action} className="iam-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formPermissions.includes(action)}
                        onChange={() => togglePermission(action)}
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
                  onClick={() => setModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : modalMode === 'create' ? 'Create Role' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
