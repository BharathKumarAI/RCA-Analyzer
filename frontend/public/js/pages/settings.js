/**
 * Astra 6 — System Settings & Feature Flags
 * 
 * Manages deployment environments, feature flags, notification channels, and maintenance mode.
 */

import { getConfig } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderSettings(container) {
  const page = document.createElement("div");
  page.className = "settings-control-plane";
  page.innerHTML = `
    <!-- Header -->
    <header class="view-header">
      <div class="view-header-main">
        <span class="view-eyebrow">Astra 6 · Global Platform Configuration</span>
        <h1 class="view-title">
          ${renderIcon("settings")}
          <span>System Settings</span>
        </h1>
        <p class="view-subtitle">
          Configure runtime environment variables, feature flags, telemetry exports, and platform maintenance status.
        </p>
      </div>
      <div class="view-actions">
        <button class="btn btn-primary" id="save-settings-btn">
          ${renderIcon("check")}
          <span>Save Changes</span>
        </button>
      </div>
    </header>

    <!-- Settings Sections -->
    <div style="display: grid; grid-template-columns: 1fr; gap: var(--space-6); max-width: 900px;">
      <!-- Environment & Scopes -->
      <div class="card">
        <h3 style="font-size: 16px; margin-bottom: var(--space-4); color: var(--tx-heading);">Deployment & Tenant Scope</h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div class="form-group">
            <label class="form-label">RCA Tenant ID (Immutable)</label>
            <input type="text" class="form-input mono" value="default" readonly style="opacity: 0.7;">
          </div>
          <div class="form-group">
            <label class="form-label">RCA Project ID (Immutable)</label>
            <input type="text" class="form-input mono" value="root" readonly style="opacity: 0.7;">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Active Deployment Profile</label>
          <select class="form-select">
            <option value="demo" selected>Demo Simulation (Offline Fixtures & Fast Replay)</option>
            <option value="staging">Staging Canary Cluster (Real Credentials, Bounded)</option>
            <option value="live">Live Enterprise Production (Full Splunk & Jira Read)</option>
          </select>
          <span class="form-hint">Controls connector execution mode. In demo mode, live credentials are never utilized.</span>
        </div>
      </div>

      <!-- Feature Flags -->
      <div class="card">
        <h3 style="font-size: 16px; margin-bottom: var(--space-4); color: var(--tx-heading);">Feature Flags & Reasoning Mode</h3>
        
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>Gemini 2.5 Thinking Mode</strong>
              <p style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">Allocates explicit token thinking budgets to specialists before generating hypotheses.</p>
            </div>
            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); padding-top: 14px;">
            <div>
              <strong>Dual-Custody Enforcement</strong>
              <p style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">Requires independent administrator cryptographic approval for all agent modifications.</p>
            </div>
            <label class="switch"><input type="checkbox" checked disabled><span class="slider"></span></label>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); padding-top: 14px;">
            <div>
              <strong>Streaming Evidence Explorer</strong>
              <p style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">Streams real-time log query and metric results to the investigation UI as tools execute.</p>
            </div>
            <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
          </div>
        </div>
      </div>

      <!-- Maintenance Mode & Emergency Kill Switch -->
      <div class="card" style="border-color: rgba(244, 63, 94, 0.3); background: var(--card);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h3 style="font-size: 16px; color: var(--danger); margin-bottom: 4px;">Emergency Kill Switch & Maintenance Mode</h3>
            <p style="font-size: 13px; color: var(--muted); max-width: 60ch;">
              Immediately pauses all active agent runs, halts new investigation triggers, and disconnects live telemetry connectors.
            </p>
          </div>
          <button class="btn btn-danger" id="kill-switch-btn">Activate Maintenance Mode</button>
        </div>
      </div>
    </div>
  `;

  container.appendChild(page);

  page.querySelector("#save-settings-btn").addEventListener("click", () => {
    const btn = page.querySelector("#save-settings-btn");
    btn.disabled = true;
    btn.innerHTML = `${renderIcon("check")} Saved Successfully`;
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = `${renderIcon("check")} <span>Save Changes</span>`;
    }, 2000);
  });
}
