/**
 * Astra 6 — Knowledge & Context Management
 * 
 * Manages vector stores, runbook archives, architecture specs, and embedding sync status.
 */

import { renderIcon } from "../icons.js";

export async function renderKnowledge(container) {
  const page = document.createElement("div");
  page.className = "knowledge-control-plane";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · Context & Retrieval Grounding</span>
        <h1 class="view-title">
          ${renderIcon("bookOpen")}
          <span>Knowledge & Document Stores</span>
        </h1>
        <p class="view-subtitle">
          Manage vector indexes, historical RCA archives, runbooks, and CMDB architecture diagrams used to ground agent causal inference.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-outline" id="kb-sync-all-btn">
          ${renderIcon("refresh")}
          <span>Trigger Re-index</span>
        </button>
        <button class="btn btn-primary" id="kb-upload-btn">
          ${renderIcon("plus")}
          <span>Index Document</span>
        </button>
      </div>
    </header>

    <!-- Top KPI Stats -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Total Indexed Chunks</span>
          <span class="stat-card-icon">${renderIcon("database")}</span>
        </div>
        <div class="stat-card-value">26,320</div>
        <div class="stat-card-meta"><span class="trend-badge up">● 4 Stores Live</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Embedding Model</span>
          <span class="stat-card-icon" style="color: var(--acc); background: var(--acc-subtle);">${renderIcon("zap")}</span>
        </div>
        <div class="stat-card-value" style="font-size: 19px; margin-top: 5px;">Text-Embedding-004</div>
        <div class="stat-card-meta"><span>768 dimensions · Bounded Local</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Index Freshness</span>
          <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("check")}</span>
        </div>
        <div class="stat-card-value" style="color: var(--acc3);">10m ago</div>
        <div class="stat-card-meta"><span>Incremental vector updates</span></div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">RAG Hit Rate</span>
          <span class="stat-card-icon">${renderIcon("activity")}</span>
        </div>
        <div class="stat-card-value">94.2%</div>
        <div class="stat-card-meta"><span class="trend-badge up">+1.4%</span><span>Avg cosine similarity > 0.82</span></div>
      </div>
    </div>

    <!-- Document Stores Cards -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: var(--space-8);">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <strong style="font-size: 16px;">Historical Post-Mortems Archive</strong>
            <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Scope: All RCA Specialists</div>
          </div>
          <span class="badge badge-approved">Synced</span>
        </div>
        <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
          Contains 840 verified post-mortem documents, previous incident timelines, and root cause categorizations since 2023.
        </p>
        <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
          <span style="color: var(--dim);">12,450 vectors</span>
          <span style="color: var(--muted);">Sync 10m ago</span>
        </div>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <strong style="font-size: 16px;">Kubernetes Operational Runbooks</strong>
            <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Scope: Remediation & Infra Agents</div>
          </div>
          <span class="badge badge-approved">Synced</span>
        </div>
        <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
          Step-by-step mitigation SOPs, pod eviction diagnostics, cluster autoscaler policies, and node cordon procedures.
        </p>
        <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
          <span style="color: var(--dim);">3,820 vectors</span>
          <span style="color: var(--muted);">Sync 1h ago</span>
        </div>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <strong style="font-size: 16px;">Payment Gateway Architecture Specs</strong>
            <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Scope: Payments Specialists</div>
          </div>
          <span class="badge badge-approved">Synced</span>
        </div>
        <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
          Service boundary definitions, webhook retry contracts, and database transaction isolation levels.
        </p>
        <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
          <span style="color: var(--dim);">1,140 vectors</span>
          <span style="color: var(--muted);">Sync 1d ago</span>
        </div>
      </div>
    </div>
  `;

  container.appendChild(page);
}
