/**
 * Astra 6 — Executive Mission Control & Overview Dashboard
 * 
 * High-density operational overview:
 * - Real-time Platform Health & Telemetry
 * - Active Agents & Concurrent Investigation Pipeline
 * - Usage Velocity (Tokens, Tool calls/min, MTTR)
 * - Signal-to-Understanding Agent Flow
 * - Recent Critical Incidents & Event Stream
 */

import { getReady, getConfig, getCapabilities, getConnectorHealth } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderOverview(container) {
  const page = document.createElement("div");
  page.className = "overview-dashboard";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · Mission Control</span>
        <h1 class="view-title">
          ${renderIcon("activity")}
          <span>Platform Overview</span>
        </h1>
        <p class="view-subtitle">
          Real-time visibility into agentic root cause analysis, active telemetry connectors, token velocities, and concurrent investigations.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-outline" id="overview-refresh-btn">
          ${renderIcon("refresh")}
          <span>Refresh Metrics</span>
        </button>
        <a href="#runs" class="btn btn-primary">
          ${renderIcon("plus")}
          <span>New Investigation</span>
        </a>
      </div>
    </header>

    <!-- Platform Status Banner -->
    <div class="card" style="padding: 14px 20px; margin-bottom: var(--space-6); background: var(--card-glass); display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="heartbeat-dot"></span>
        <div>
          <strong style="color: var(--tx-heading);" id="overview-health-title">Platform Online & Ready</strong>
          <span style="font-size: 12.5px; color: var(--muted); margin-left: 8px;" id="overview-health-desc">ADK workflow graph active · 4 connectors healthy</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="badge badge-mono" id="overview-scope-badge">Scope: default / root</span>
        <span class="badge badge-approved" id="overview-mode-badge">Live System</span>
      </div>
    </div>

    <!-- KPI Metric Cards Grid -->
    <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Agents</span>
          <span class="stat-card-icon" style="color: var(--acc); background: var(--acc-subtle);">${renderIcon("agents")}</span>
        </div>
        <div class="stat-card-value">5 Agents</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">● 100% Online</span>
          <span>Detect, Correlate, RCA</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Concurrent Runs</span>
          <span class="stat-card-icon" style="color: var(--acc3); background: var(--acc3-subtle);">${renderIcon("runs")}</span>
        </div>
        <div class="stat-card-value">2 Active</div>
        <div class="stat-card-meta">
          <span>Avg duration: 38.4s</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Token Velocity (24h)</span>
          <span class="stat-card-icon">${renderIcon("zap")}</span>
        </div>
        <div class="stat-card-value">1.42M</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">Gemini 2.5 Pro</span>
          <span>$0.38 / investigation</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Tool Calls / Min</span>
          <span class="stat-card-icon">${renderIcon("database")}</span>
        </div>
        <div class="stat-card-value">48 / min</div>
        <div class="stat-card-meta">
          <span class="trend-badge up">99.8% Success</span>
          <span>Splunk, Jira, Metrics</span>
        </div>
      </div>
    </div>

    <!-- Agent Signal Pipeline Flow Visualizer -->
    <div class="card" style="padding: var(--space-6); margin-bottom: var(--space-6);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4);">
        <div>
          <h2 style="font-size: 17px; font-weight: 700; color: var(--tx-heading);">Agentic Root Cause Analysis Topology</h2>
          <p style="font-size: 13px; color: var(--muted); margin-top: 2px;">Multi-agent Google ADK workflow orchestrator from incident trigger to evidence synthesis.</p>
        </div>
        <span class="badge badge-mono">Google ADK Native Graph</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; position: relative;">
        <!-- Step 1 -->
        <div class="card" style="padding: 14px; background: var(--bg-subtle); border-color: var(--line);">
          <div style="font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--acc); font-weight: 700;">Stage 01</div>
          <strong style="font-size: 14px; color: var(--tx-heading); margin: 4px 0 6px; display: block;">Incident Trigger</strong>
          <p style="font-size: 12px; color: var(--muted);">Jira ITSM ticket intake, priority triage, and service scope boundary definition.</p>
          <div style="margin-top: 10px;"><span class="role-badge detector">Detector</span></div>
        </div>

        <!-- Step 2 -->
        <div class="card" style="padding: 14px; background: var(--bg-subtle); border-color: var(--line);">
          <div style="font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--acc); font-weight: 700;">Stage 02</div>
          <strong style="font-size: 14px; color: var(--tx-heading); margin: 4px 0 6px; display: block;">Evidence Collection</strong>
          <p style="font-size: 12px; color: var(--muted);">Bounded Splunk log queries and Prometheus latency metrics correlation.</p>
          <div style="margin-top: 10px;"><span class="role-badge correlator">Correlator</span></div>
        </div>

        <!-- Step 3 -->
        <div class="card" style="padding: 14px; background: var(--bg-subtle); border-color: var(--line);">
          <div style="font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--acc); font-weight: 700;">Stage 03</div>
          <strong style="font-size: 14px; color: var(--tx-heading); margin: 4px 0 6px; display: block;">Hypothesis Testing</strong>
          <p style="font-size: 12px; color: var(--muted);">Causal chain evaluation, database lock checks, and verified citation validation.</p>
          <div style="margin-top: 10px;"><span class="role-badge root_cause">Root Cause</span></div>
        </div>

        <!-- Step 4 -->
        <div class="card" style="padding: 14px; background: var(--bg-subtle); border-color: var(--line);">
          <div style="font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--acc); font-weight: 700;">Stage 04</div>
          <strong style="font-size: 14px; color: var(--tx-heading); margin: 4px 0 6px; display: block;">Synthesis & Report</strong>
          <p style="font-size: 12px; color: var(--muted);">Executive summary generation, timeline reconstruction, and mitigation advice.</p>
          <div style="margin-top: 10px;"><span class="role-badge explainer">Explainer</span></div>
        </div>
      </div>
    </div>

    <!-- Recent Investigations & Critical Events -->
    <div class="table-container">
      <div class="table-toolbar">
        <div>
          <strong style="font-size: 15px; color: var(--tx-heading);">Recent Investigations & Agent Traces</strong>
          <span style="font-size: 12px; color: var(--dim); display: block;">Live telemetry from incident triage runs</span>
        </div>
        <a href="#runs" class="btn btn-outline btn-sm">View All in Runs →</a>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Investigation ID</th>
            <th>Capability</th>
            <th>Trigger Incident</th>
            <th>Specialists Engaged</th>
            <th>Evidence Items</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><a href="#runs" style="font-weight: 700;" class="mono">run-20260911-0842</a></td>
            <td><span class="badge badge-mono">incident_triage</span></td>
            <td><span>INC-8921 (Payments 504 Timeout)</span></td>
            <td><span class="role-badge root_cause">Payments Specialist</span></td>
            <td><span class="mono">14 verified items</span></td>
            <td><span class="badge badge-approved">Completed</span></td>
            <td><span class="mono">34.2s</span></td>
          </tr>
          <tr>
            <td><a href="#runs" style="font-weight: 700;" class="mono">run-20260911-0810</a></td>
            <td><span class="badge badge-mono">log_correlation</span></td>
            <td><span>INC-8914 (Postgres Pool Deadlock)</span></td>
            <td><span class="role-badge correlator">Lock Correlator</span></td>
            <td><span class="mono">9 verified items</span></td>
            <td><span class="badge badge-approved">Completed</span></td>
            <td><span class="mono">42.8s</span></td>
          </tr>
          <tr>
            <td><a href="#runs" style="font-weight: 700;" class="mono">run-20260911-0730</a></td>
            <td><span class="badge badge-mono">incident_triage</span></td>
            <td><span>INC-8899 (Redis Cluster Memory Spike)</span></td>
            <td><span class="role-badge detector">Detector</span></td>
            <td><span class="mono">6 verified items</span></td>
            <td><span class="badge badge-approved">Completed</span></td>
            <td><span class="mono">21.0s</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.appendChild(page);

  page.querySelector("#overview-refresh-btn").addEventListener("click", loadStatus);
  await loadStatus();

  async function loadStatus() {
    try {
      const [readyRes, configRes] = await Promise.allSettled([
        getReady(),
        getConfig()
      ]);
      const ready = readyRes.status === "fulfilled" ? readyRes.value : null;
      const config = configRes.status === "fulfilled" ? configRes.value : null;

      if (ready) {
        page.querySelector("#overview-health-title").textContent = ready.ready ? "Platform Online & Ready" : "Platform Partially Degraded";
        page.querySelector("#overview-mode-badge").textContent = ready.mode === "live" ? "Live Production" : "Demo Simulation";
        page.querySelector("#overview-mode-badge").className = `badge ${ready.mode === 'live' ? 'badge-approved' : 'badge-amber'}`;
      }

      if (config && config.execution) {
        page.querySelector("#overview-scope-badge").textContent = `Scope: ${config.execution.tenant_id} / ${config.execution.project_id}`;
      }
    } catch (e) {
      console.warn("Overview telemetry check error:", e);
    }
  }
}
