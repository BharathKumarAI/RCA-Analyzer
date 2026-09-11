/**
 * Astra 6 — Governance, Safety & Policies (Priority 2)
 * 
 * Provides SRE leads and AI Ops teams with an audit-friendly governance control plane:
 * - Global Guardrails (Citation Enforcement, PII Redaction, Prompt Injection Defense)
 * - Dual-Custody Approval Queue (Pending agent drafts with cryptographic SHA-256 verification)
 * - Allowed Actions Matrix (Autonomous vs Human-In-The-Loop approval rules)
 * - Cryptographic Immutable Audit Log
 */

import { getAgentConfigurations, approveAgentConfiguration, rejectAgentConfiguration } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderGovernance(container) {
  const page = document.createElement("div");
  page.className = "governance-control-plane";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · Compliance & Safety</span>
        <h1 class="view-title">
          ${renderIcon("shieldCheck")}
          <span>Governance & Safety Engine</span>
        </h1>
        <p class="view-subtitle">
          Enforce immutable guardrails, govern autonomous agent permissions, review pending dual-custody drafts, and audit all platform actions.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-outline" id="gov-refresh-btn">
          ${renderIcon("refresh")}
          <span>Refresh Audit</span>
        </button>
      </div>
    </header>

    <!-- Top KPI Stats -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Guardrails</span>
          <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("shieldCheck")}</span>
        </div>
        <div class="stat-card-value" style="color: var(--acc3);">6 / 6</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">● 100% Enforced</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Pending Dual-Custody</span>
          <span class="stat-card-icon" style="color: var(--warning); background: var(--warning-subtle);">${renderIcon("shield")}</span>
        </div>
        <div class="stat-card-value" id="gov-pending-count" style="color: var(--warning);">1</div>
        <div class="stat-card-meta">
          <span>Requires peer review</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Policy Violations (24h)</span>
          <span class="stat-card-icon">${renderIcon("alert")}</span>
        </div>
        <div class="stat-card-value">0</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">Clean Audit</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">PII Redactions (24h)</span>
          <span class="stat-card-icon">${renderIcon("lock")}</span>
        </div>
        <div class="stat-card-value">1,428</div>
        <div class="stat-card-meta">
          <span>Tokens & customer IPs masked</span>
        </div>
      </div>
    </div>

    <!-- Dual-Custody Approval Queue -->
    <div class="table-container" style="margin-bottom: var(--space-8);">
      <div class="table-toolbar">
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong style="font-size: 15px; color: var(--tx-heading);">Dual-Custody Approval Queue</strong>
          <span class="badge badge-amber" id="gov-queue-badge">1 Awaiting Review</span>
        </div>
        <span style="font-size: 12px; color: var(--dim);">Two-person rule enforced per AGENTS.md contract</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Agent ID / Name</th>
            <th>Author</th>
            <th>Submitted</th>
            <th>Expected SHA-256 Digest</th>
            <th>Requested Scope</th>
            <th style="text-align: right;">Review Action</th>
          </tr>
        </thead>
        <tbody id="gov-queue-tbody">
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--tx-heading);">Payments Anomaly Specialist</div>
              <div style="font-family: var(--font-mono); font-size: 11px; color: var(--acc);">payments_timeout_specialist</div>
            </td>
            <td><span class="badge-mono">admin</span></td>
            <td><span style="color: var(--muted); font-size: 12px;">15m ago</span></td>
            <td><code style="font-size: 11px;">sha256:c65b38fa0e891c3245d8b7a63...</code></td>
            <td><span class="role-badge root_cause">Root Cause Analyst</span></td>
            <td style="text-align: right;">
              <a href="#agents" class="btn btn-primary btn-sm">Inspect & Review</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Global Guardrails Grid -->
    <div style="margin-bottom: var(--space-8);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3);">
        <div>
          <h2 style="font-size: 18px; font-weight: 700; color: var(--tx-heading);">Active Global Guardrails</h2>
          <p style="font-size: 13px; color: var(--muted);">Deterministic safety boundaries enforced across all active RCA workflows.</p>
        </div>
      </div>

      <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("check")}</span>
              <strong>Strict Citation Enforcement</strong>
            </div>
            <span class="badge badge-emerald">Mandatory</span>
          </div>
          <p style="font-size: 12.5px; color: var(--muted); margin: 10px 0;">
            Any conclusion, anomaly assertion, or hypothesis not directly anchored to an exact ITSM ticket ID or Splunk log timestamp is rejected.
          </p>
          <div style="font-size: 11.5px; color: var(--dim);">Enforcement: Pre-synthesis AST Parser</div>
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="stat-card-icon" style="color: var(--acc); background: var(--acc-subtle);">${renderIcon("lock")}</span>
              <strong>PII & Credential Redaction</strong>
            </div>
            <span class="badge badge-emerald">Active</span>
          </div>
          <p style="font-size: 12.5px; color: var(--muted); margin: 10px 0;">
            Regex sanitizers scrub API authorization headers, bearer tokens, passwords, customer credit card PANs, and emails from all logs.
          </p>
          <div style="font-size: 11.5px; color: var(--dim);">Enforcement: Connector Ingress Filter</div>
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="stat-card-icon" style="color: var(--warning); background: var(--warning-subtle);">${renderIcon("alert")}</span>
              <strong>Prompt Injection Neutralization</strong>
            </div>
            <span class="badge badge-emerald">Active</span>
          </div>
          <p style="font-size: 12.5px; color: var(--muted); margin: 10px 0;">
            Log content is bounded in XML data envelopes with structural delimiters. System persona instructions cannot be overwritten by log data.
          </p>
          <div style="font-size: 11.5px; color: var(--dim);">Enforcement: ADK Prompt Envelope</div>
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="stat-card-icon">${renderIcon("shield")}</span>
              <strong>Autonomous Action Boundaries</strong>
            </div>
            <span class="badge badge-amber">HITL Required</span>
          </div>
          <p style="font-size: 12.5px; color: var(--muted); margin: 10px 0;">
            Read-only queries to Splunk/Jira execute autonomously. Ticket mutation, pod rollbacks, or service restarts require human authorization.
          </p>
          <div style="font-size: 11.5px; color: var(--dim);">Enforcement: Tool Scope Policy Manager</div>
        </div>
      </div>
    </div>

    <!-- Immutable Audit Trail Table -->
    <div class="table-container">
      <div class="table-toolbar">
        <div>
          <strong style="font-size: 15px; color: var(--tx-heading);">Cryptographic Audit Trail</strong>
          <span style="font-size: 12px; color: var(--dim); display: block;">Chronological log of administrative actions, approvals, and policy checks</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <input type="search" class="form-input" placeholder="Search audit trail..." style="padding: 6px 12px; font-size: 12px; width: 220px;">
          <button class="btn btn-outline btn-sm">${renderIcon("download")} Export CSV</button>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp (UTC)</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target Entity</th>
            <th>Digest / Evidence</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="mono" style="font-size: 12px;">2026-09-11 21:14:02</span></td>
            <td><strong>lead_sre</strong></td>
            <td><span class="badge badge-emerald">AGENT_APPROVE</span></td>
            <td><span class="mono">log_anomaly_specialist</span></td>
            <td><code style="font-size: 11px;">sha256:035fd8...</code></td>
            <td><span class="badge badge-approved">Success</span></td>
          </tr>
          <tr>
            <td><span class="mono" style="font-size: 12px;">2026-09-11 20:42:15</span></td>
            <td><strong>admin</strong></td>
            <td><span class="badge badge-indigo">AGENT_SUBMIT</span></td>
            <td><span class="mono">payments_timeout_specialist</span></td>
            <td><code style="font-size: 11px;">sha256:c65b38...</code></td>
            <td><span class="badge badge-pending">Pending Peer Review</span></td>
          </tr>
          <tr>
            <td><span class="mono" style="font-size: 12px;">2026-09-11 19:30:00</span></td>
            <td><strong>system_guardrail</strong></td>
            <td><span class="badge badge-mono">PII_MASK_EVENT</span></td>
            <td><span>Splunk Query Range</span></td>
            <td><span style="font-size: 12px; color: var(--dim);">Redacted 14 auth tokens</span></td>
            <td><span class="badge badge-approved">Sanitized</span></td>
          </tr>
          <tr>
            <td><span class="mono" style="font-size: 12px;">2026-09-11 18:12:44</span></td>
            <td><strong>platform_admin</strong></td>
            <td><span class="badge badge-violet">ENV_CONFIG_UPDATE</span></td>
            <td><span>RCA_TENANT_ID</span></td>
            <td><code style="font-size: 11px;">tenant-prod-us1</code></td>
            <td><span class="badge badge-approved">Applied</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.appendChild(page);

  page.querySelector("#gov-refresh-btn").addEventListener("click", () => {
    renderGovernance(container);
  });
}
