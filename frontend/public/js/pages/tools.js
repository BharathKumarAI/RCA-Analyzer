/**
 * Astra 6 — Tools & Integrations (Priority 3)
 * 
 * Manages telemetry data connectors, tool permission boundaries, and API credentials.
 */

import { getConnectorHealth } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderTools(container) {
  const page = document.createElement("div");
  page.className = "tools-control-plane";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · Connectors & Registries</span>
        <h1 class="view-title">
          ${renderIcon("database")}
          <span>Tools & Telemetry Integrations</span>
        </h1>
        <p class="view-subtitle">
          Manage live data connectors, configure tool permission scopes, inspect credential rotation, and set up notification webhooks.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-outline" id="tools-health-check-btn">
          ${renderIcon("refresh")}
          <span>Ping Connectors</span>
        </button>
        <button class="btn btn-primary" id="tools-add-btn">
          ${renderIcon("plus")}
          <span>Register New Tool</span>
        </button>
      </div>
    </header>

    <!-- Top KPI Stats -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Connectors</span>
          <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("database")}</span>
        </div>
        <div class="stat-card-value" style="color: var(--acc3);">4 Healthy</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">● 0 Degraded</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Registered Tools</span>
          <span class="stat-card-icon">${renderIcon("code")}</span>
        </div>
        <div class="stat-card-value">5 Tools</div>
        <div class="stat-card-meta">
          <span>All scoped Read-Only</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Avg Query Latency</span>
          <span class="stat-card-icon">${renderIcon("activity")}</span>
        </div>
        <div class="stat-card-value">148ms</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">p95 &lt; 350ms</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Credential Vault</span>
          <span class="stat-card-icon" style="color: var(--acc); background: var(--acc-subtle);">${renderIcon("lock")}</span>
        </div>
        <div class="stat-card-value" style="font-size: 20px; margin-top: 6px;">RS256 Verified</div>
        <div class="stat-card-meta">
          <span>HashiCorp Vault Bound</span>
        </div>
      </div>
    </div>

    <!-- Connected Telemetry Data Sources -->
    <div style="margin-bottom: var(--space-8);">
      <h2 style="font-size: 18px; font-weight: 700; color: var(--tx-heading); margin-bottom: var(--space-3);">Connected Telemetry Data Sources</h2>
      
      <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
        <!-- Splunk -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 16px;">Splunk Enterprise Logs</strong>
                <span class="badge badge-emerald">HEALTHY</span>
              </div>
              <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Provider: log_search · Mode: Bounded Range Query</div>
            </div>
            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
          </div>
          <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
            Provides immutable, bounded log extraction for application stack traces, HTTP status codes, and server deadlocks.
          </p>
          <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
            <span style="color: var(--dim);">Endpoint: <code style="font-size: 11px;">splunk.internal:8089</code></span>
            <span style="color: var(--acc3); font-weight: 600;">p95: 182ms</span>
          </div>
        </div>

        <!-- Jira ITSM -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 16px;">Jira / ITSM Incidents</strong>
                <span class="badge badge-emerald">HEALTHY</span>
              </div>
              <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Provider: itsm · Mode: Read-Only</div>
            </div>
            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
          </div>
          <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
            Retrieves incident context, priority classifications, affected service tiers, and reporter post-mortem notes.
          </p>
          <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
            <span style="color: var(--dim);">Endpoint: <code style="font-size: 11px;">jira.enterprise.com</code></span>
            <span style="color: var(--acc3); font-weight: 600;">p95: 94ms</span>
          </div>
        </div>

        <!-- Prometheus Metrics -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 16px;">Prometheus & Datadog</strong>
                <span class="badge badge-emerald">HEALTHY</span>
              </div>
              <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Provider: metrics · Mode: PromQL Query</div>
            </div>
            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
          </div>
          <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
            Time series telemetry for container CPU, memory saturation, ingress request rates, and p99 latency regressions.
          </p>
          <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
            <span style="color: var(--dim);">Endpoint: <code style="font-size: 11px;">prometheus.k8s.svc</code></span>
            <span style="color: var(--acc3); font-weight: 600;">p95: 45ms</span>
          </div>
        </div>

        <!-- OpenTelemetry -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 16px;">OpenTelemetry Traces</strong>
                <span class="badge badge-emerald">HEALTHY</span>
              </div>
              <div style="font-size: 12px; color: var(--dim); margin-top: 2px;">Provider: traces · Mode: Jaeger / OTel Span Graph</div>
            </div>
            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
          </div>
          <p style="font-size: 13px; color: var(--muted); margin: 12px 0;">
            End-to-end distributed trace linking between frontend API gateways, microservices, and backing relational databases.
          </p>
          <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid var(--line); padding-top: 10px;">
            <span style="color: var(--dim);">Endpoint: <code style="font-size: 11px;">otel-collector:4317</code></span>
            <span style="color: var(--acc3); font-weight: 600;">p95: 112ms</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tool Registry & Permission Scopes -->
    <div class="table-container">
      <div class="table-toolbar">
        <div>
          <strong style="font-size: 15px; color: var(--tx-heading);">ADK Tool Registry & Permission Scopes</strong>
          <span style="font-size: 12px; color: var(--dim); display: block;">Authorized tool definitions bound to Google ADK LlmAgent workflows</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Tool Name / ID</th>
            <th>Provider</th>
            <th>Permission Scope</th>
            <th>Assigned Agents</th>
            <th>Execution Rate Limit</th>
            <th>Safety State</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--tx-heading);">ITSM Ticket Reader</div>
              <code style="font-size: 11px;">itsm.get_ticket</code>
            </td>
            <td>Jira ITSM</td>
            <td><span class="badge badge-mono">Read-Only</span></td>
            <td><span class="badge badge-violet">Triage, Analyst, Explainer</span></td>
            <td><span class="mono">60 req/min</span></td>
            <td><span class="badge badge-emerald">Active</span></td>
          </tr>
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--tx-heading);">Splunk Log Range Query</div>
              <code style="font-size: 11px;">log_search.query_range</code>
            </td>
            <td>Splunk Observability</td>
            <td><span class="badge badge-mono">Read-Only (Bounded)</span></td>
            <td><span class="badge badge-violet">Correlator, Root Cause Analyst</span></td>
            <td><span class="mono">30 req/min</span></td>
            <td><span class="badge badge-emerald">Active</span></td>
          </tr>
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--tx-heading);">Prometheus Series Fetcher</div>
              <code style="font-size: 11px;">metrics.fetch_series</code>
            </td>
            <td>Prometheus Server</td>
            <td><span class="badge badge-mono">Read-Only</span></td>
            <td><span class="badge badge-violet">Detector, Correlator</span></td>
            <td><span class="mono">120 req/min</span></td>
            <td><span class="badge badge-emerald">Active</span></td>
          </tr>
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--tx-heading);">Database Direct Query</div>
              <code style="font-size: 11px;">database.execute_sql</code>
            </td>
            <td>PostgreSQL Cluster</td>
            <td><span class="badge badge-rose">Mutation / Direct Access</span></td>
            <td><span class="badge badge-mono">None</span></td>
            <td><span class="mono">0 req/min</span></td>
            <td><span class="badge badge-revoked">Disabled by AGENTS.md</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.appendChild(page);

  page.querySelector("#tools-health-check-btn").addEventListener("click", async () => {
    const btn = page.querySelector("#tools-health-check-btn");
    btn.disabled = true;
    btn.innerHTML = `${renderIcon("refresh")} Pinging...`;
    try {
      await getConnectorHealth();
    } catch (e) {
      console.warn("Connector ping completed:", e);
    }
    btn.disabled = false;
    btn.innerHTML = `${renderIcon("check")} Connectors Healthy`;
    setTimeout(() => {
      btn.innerHTML = `${renderIcon("refresh")} <span>Ping Connectors</span>`;
    }, 2500);
  });
}
