/**
 * Astra 6 — Usage & Billing Attribution
 * 
 * Tracks token consumption by model, tool invocation velocity, and investigation unit economics.
 */

import { renderIcon } from "../icons.js";

export async function renderBilling(container) {
  const page = document.createElement("div");
  page.className = "billing-control-plane";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · FinOps & Spend Governance</span>
        <h1 class="view-title">
          ${renderIcon("creditCard")}
          <span>Usage & Cost Attribution</span>
        </h1>
        <p class="view-subtitle">
          Real-time tracking of Gemini model token consumption, tool API execution spend, and cost-per-investigation attribution across teams.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-outline">
          ${renderIcon("download")}
          <span>Download Invoice CSV</span>
        </button>
      </div>
    </header>

    <!-- Top KPI Stats -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Current Month Spend</span>
          <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("creditCard")}</span>
        </div>
        <div class="stat-card-value">$418.60</div>
        <div class="stat-card-meta"><span class="trend-badge up">Budget: $1,500</span><span>27.9% utilized</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Avg Cost / Investigation</span>
          <span class="stat-card-icon">${renderIcon("activity")}</span>
        </div>
        <div class="stat-card-value">$0.38</div>
        <div class="stat-card-meta"><span class="trend-badge down">-12% vs last mo</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gemini 2.5 Pro Tokens</span>
          <span class="stat-card-icon" style="color: var(--acc); background: var(--acc-subtle);">${renderIcon("zap")}</span>
        </div>
        <div class="stat-card-value">18.4M</div>
        <div class="stat-card-meta"><span>Deep reasoning & synthesis</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Gemini 2.5 Flash Tokens</span>
          <span class="stat-card-icon" style="color: #06b6d4; background: rgba(6,182,212,0.12);">${renderIcon("zap")}</span>
        </div>
        <div class="stat-card-value">42.1M</div>
        <div class="stat-card-meta"><span>Fast triage & anomaly intake</span></div>
      </div>
    </div>

    <!-- Team Cost Attribution Table -->
    <div class="table-container">
      <div class="table-toolbar">
        <div>
          <strong style="font-size: 15px; color: var(--tx-heading);">Cost Attribution by Team Workspace</strong>
          <span style="font-size: 12px; color: var(--dim); display: block;">Granular spend allocation for incident RCA workflows</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Team Workspace</th>
            <th>Monthly Investigations</th>
            <th>Pro Tokens</th>
            <th>Flash Tokens</th>
            <th>Total Spend</th>
            <th>Budget Cap</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Payments SRE</strong></td>
            <td><span class="mono">428 runs</span></td>
            <td><span class="mono">8.2M</span></td>
            <td><span class="mono">16.4M</span></td>
            <td><strong style="color: var(--tx-heading);">$184.20</strong></td>
            <td><span class="badge badge-approved">Under Cap ($600)</span></td>
          </tr>
          <tr>
            <td><strong>Core Infrastructure</strong></td>
            <td><span class="mono">312 runs</span></td>
            <td><span class="mono">5.9M</span></td>
            <td><span class="mono">14.1M</span></td>
            <td><strong style="color: var(--tx-heading);">$132.80</strong></td>
            <td><span class="badge badge-approved">Under Cap ($500)</span></td>
          </tr>
          <tr>
            <td><strong>API Gateway Engineering</strong></td>
            <td><span class="mono">240 runs</span></td>
            <td><span class="mono">4.3M</span></td>
            <td><span class="mono">11.6M</span></td>
            <td><strong style="color: var(--tx-heading);">$101.60</strong></td>
            <td><span class="badge badge-approved">Under Cap ($400)</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.appendChild(page);
}
