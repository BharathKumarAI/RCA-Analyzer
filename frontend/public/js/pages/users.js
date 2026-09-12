/**
 * Astra 6 — Users, Teams & Access (Priority 5)
 * 
 * Manages user accounts, team workspaces, role-based access control, and SSO/SCIM integrations.
 */

import { getMe } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderUsers(container) {
  const page = document.createElement("div");
  page.className = "users-control-plane";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · Identity & Access Management</span>
        <h1 class="view-title">
          ${renderIcon("users")}
          <span>Users, Teams & RBAC</span>
        </h1>
        <p class="view-subtitle">
          Manage workspace members, assign role-based permissions, configure Okta OIDC SSO, and govern administrator peer-review privileges.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-primary" id="users-invite-btn">
          ${renderIcon("plus")}
          <span>Invite Member</span>
        </button>
      </div>
    </header>

    <!-- Top KPI Stats -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Users</span>
          <span class="stat-card-icon">${renderIcon("users")}</span>
        </div>
        <div class="stat-card-value">12 Members</div>
        <div class="stat-card-meta"><span class="trend-badge up">● 4 Online Now</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Platform Admins</span>
          <span class="stat-card-icon" style="color: var(--acc); background: var(--acc-subtle);">${renderIcon("shieldCheck")}</span>
        </div>
        <div class="stat-card-value" style="color: var(--acc);">3 Admins</div>
        <div class="stat-card-meta"><span>Dual-custody eligible</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">SSO Provider</span>
          <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("lock")}</span>
        </div>
        <div class="stat-card-value" style="color: var(--acc3); font-size: 20px; margin-top: 4px;">Okta OIDC</div>
        <div class="stat-card-meta"><span>SCIM Auto-Sync Active</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Teams</span>
          <span class="stat-card-icon">${renderIcon("matrix")}</span>
        </div>
        <div class="stat-card-value">4 Workspaces</div>
        <div class="stat-card-meta"><span>Payments, Core, Gateway, Infra</span></div>
      </div>
    </div>

    <!-- Users Table -->
    <div class="table-container" style="margin-bottom: var(--space-8);">
      <div class="table-toolbar">
        <div>
          <strong style="font-size: 15px; color: var(--tx-heading);">Workspace Members</strong>
          <span style="font-size: 12px; color: var(--dim); display: block;">Authorized principals configured in server-side authentication</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <input type="search" class="form-input" placeholder="Search members..." style="padding: 6px 12px; font-size: 12px; width: 220px;">
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>User Principal</th>
            <th>Assigned Role</th>
            <th>Team Workspace</th>
            <th>Dual-Custody Authority</th>
            <th>Last Active</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="user-avatar" style="width: 32px; height: 32px;">A</div>
                <div>
                  <strong>admin</strong>
                  <div style="font-size: 11.5px; color: var(--dim);">admin@enterprise.internal</div>
                </div>
              </div>
            </td>
            <td><span class="badge badge-violet">PLATFORM_ADMIN</span></td>
            <td><span>Platform Engineering</span></td>
            <td><span class="badge badge-emerald">Eligible Signer</span></td>
            <td><span style="font-size: 12px; color: var(--dim);">Just now</span></td>
            <td style="text-align: right;">
              <button class="btn btn-outline btn-sm">Edit Role</button>
            </td>
          </tr>
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="user-avatar" style="width: 32px; height: 32px; background: linear-gradient(135deg, #0e7a5f, #059669);">L</div>
                <div>
                  <strong>lead_sre</strong>
                  <div style="font-size: 11.5px; color: var(--dim);">leadsre@enterprise.internal</div>
                </div>
              </div>
            </td>
            <td><span class="badge badge-indigo">SRE_LEAD</span></td>
            <td><span>Payments SRE</span></td>
            <td><span class="badge badge-emerald">Eligible Signer</span></td>
            <td><span style="font-size: 12px; color: var(--dim);">12m ago</span></td>
            <td style="text-align: right;">
              <button class="btn btn-outline btn-sm">Edit Role</button>
            </td>
          </tr>
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="user-avatar" style="width: 32px; height: 32px; background: linear-gradient(135deg, #d97706, #b45309);">O</div>
                <div>
                  <strong>oncall_operator</strong>
                  <div style="font-size: 11.5px; color: var(--dim);">operator@enterprise.internal</div>
                </div>
              </div>
            </td>
            <td><span class="badge badge-mono">PROJECT_ANALYST</span></td>
            <td><span>Core Infrastructure</span></td>
            <td><span class="badge badge-mono">Review Only</span></td>
            <td><span style="font-size: 12px; color: var(--dim);">1h ago</span></td>
            <td style="text-align: right;">
              <button class="btn btn-outline btn-sm">Edit Role</button>
            </td>
          </tr>
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="user-avatar" style="width: 32px; height: 32px; background: #64748b;">V</div>
                <div>
                  <strong>auditor_readonly</strong>
                  <div style="font-size: 11.5px; color: var(--dim);">compliance@enterprise.internal</div>
                </div>
              </div>
            </td>
            <td><span class="badge badge-mono">VIEWER</span></td>
            <td><span>Security & Compliance</span></td>
            <td><span class="badge badge-rose">No Authorization</span></td>
            <td><span style="font-size: 12px; color: var(--dim);">Yesterday</span></td>
            <td style="text-align: right;">
              <button class="btn btn-outline btn-sm">Edit Role</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.appendChild(page);
}
