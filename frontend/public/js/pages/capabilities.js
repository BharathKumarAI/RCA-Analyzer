/**
 * Capabilities & Stage Model Profiles Matrix.
 */

import { getCapabilities, getConfig } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderCapabilities(container) {
  const header = document.createElement("div");
  header.className = "view-header";

  const titleGroup = document.createElement("div");
  const title = document.createElement("h1");
  title.className = "view-title";
  title.innerHTML = `${renderIcon("matrix")} Capabilities`;

  const subtitle = document.createElement("p");
  subtitle.className = "view-subtitle";
  subtitle.textContent = "Explore the investigations available to your team, their tools, and configured limits.";

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);
  container.appendChild(header);

  const content = document.createElement("div");
  content.className = "capabilities-content";
  container.appendChild(content);

  content.innerHTML = "<div class='metric-label'>Loading capabilities and stage profiles...</div>";

  try {
    const [capabilities, config] = await Promise.all([
      getCapabilities(),
      getConfig()
    ]);

    content.innerHTML = "";

    const displayCaps = Array.isArray(capabilities) ? capabilities : [];

    // 1. Declarative Capabilities Catalog
    renderCapabilitiesCatalog(content, displayCaps);

    // 2. Stage Model Profiles Matrix
    renderStageProfiles(content, config);

    // 3. Bounded Parser & Connector Limits
    renderLimitsAndConnectors(content, config);

  } catch (err) {
    content.innerHTML = `
      <div class="alert-banner alert-error">
        ${renderIcon("alert")}
        <div><strong>Capabilities unavailable</strong><p id="capabilities-error"></p><a href="#session" class="btn btn-secondary btn-sm">Check session</a></div>
      </div>
    `;
    content.querySelector("#capabilities-error").textContent = err.message;
  }
}

function renderCapabilitiesCatalog(container, capabilities) {
  const section = document.createElement("div");
  section.style.marginBottom = "var(--space-8)";

  const title = document.createElement("h2");
  title.style.fontSize = "var(--text-lg)";
  title.style.fontWeight = "var(--font-bold)";
  title.style.marginBottom = "var(--space-3)";
  title.textContent = "Available investigations";
  section.appendChild(title);

  if (!capabilities || capabilities.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No investigations are available for this account. Ask your project administrator to review your access.";
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  const tableContainer = document.createElement("div");
  tableContainer.className = "table-container";

  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Capability ID</th>
        <th>Name</th>
        <th>Category</th>
        <th>Allowed Actions</th>
        <th>Minimum Role</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  capabilities.forEach(cap => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.className = "mono";
    tdId.style.fontWeight = "var(--font-semibold)";
    tdId.style.color = "var(--cyan-telemetry)";
    tdId.textContent = cap.id;

    const tdName = document.createElement("td");
    tdName.textContent = cap.name || cap.id;

    const tdCat = document.createElement("td");
    tdCat.innerHTML = `<span class="badge badge-gray">${cap.category || 'general'}</span>`;

    const tdActions = document.createElement("td");
    (cap.permissions?.allowed_actions || cap.allowed_actions || []).forEach(act => {
      const b = document.createElement("span");
      b.className = "badge badge-cyan";
      b.style.marginRight = "4px";
      b.textContent = act;
      tdActions.appendChild(b);
    });

    const tdRole = document.createElement("td");
    tdRole.innerHTML = `<span class="badge badge-indigo">${cap.permissions?.minimum_role || 'PROJECT_ANALYST'}</span>`;

    tr.appendChild(tdId);
    tr.appendChild(tdName);
    tr.appendChild(tdCat);
    tr.appendChild(tdActions);
    tr.appendChild(tdRole);
    tbody.appendChild(tr);
  });

  tableContainer.appendChild(table);
  section.appendChild(tableContainer);
  container.appendChild(section);
}

function renderStageProfiles(container, config) {
  const section = document.createElement("div");
  section.style.marginBottom = "var(--space-8)";

  const title = document.createElement("h2");
  title.style.fontSize = "var(--text-lg)";
  title.style.fontWeight = "var(--font-bold)";
  title.style.marginBottom = "var(--space-3)";
  title.textContent = "Models by investigation stage";
  section.appendChild(title);

  const stages = config?.model_profiles?.stages || {};

  const tableContainer = document.createElement("div");
  tableContainer.className = "table-container";

  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Stage Name</th>
        <th>Model ID</th>
        <th>Thinking Level</th>
        <th>Temperature</th>
        <th>Max Output Tokens</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  Object.entries(stages).forEach(([stageName, stageData]) => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.style.fontWeight = "var(--font-semibold)";
    tdName.textContent = stageName;

    const tdModel = document.createElement("td");
    tdModel.className = "mono";
    tdModel.style.color = "var(--cyan-telemetry)";
    tdModel.textContent = stageData.model;

    const tdThinking = document.createElement("td");
    tdThinking.innerHTML = `<span class="badge badge-indigo">${stageData.thinking_level || 'low'}</span>`;

    const tdTemp = document.createElement("td");
    tdTemp.className = "mono";
    tdTemp.textContent = stageData.temperature ?? "1.0";

    const tdTokens = document.createElement("td");
    tdTokens.className = "mono";
    tdTokens.textContent = stageData.max_output_tokens ?? "—";

    tr.appendChild(tdName);
    tr.appendChild(tdModel);
    tr.appendChild(tdThinking);
    tr.appendChild(tdTemp);
    tr.appendChild(tdTokens);
    tbody.appendChild(tr);
  });

  tableContainer.appendChild(table);
  section.appendChild(tableContainer);
  container.appendChild(section);
}

function renderLimitsAndConnectors(container, config) {
  const grid = document.createElement("div");
  grid.className = "card-grid";

  // File Limits Card
  const fileCard = document.createElement("div");
  fileCard.className = "card";
  const limits = config && config.file_limits ? config.file_limits : {};
  fileCard.innerHTML = `
    <div class="card-header">
      <span class="card-title">${renderIcon("shield")} Attachment limits</span>
      <span class="badge badge-emerald">Configured</span>
    </div>
    <div class="card-body" style="font-size: var(--text-xs); line-height: 1.8;">
      <div>Max Files per Request: <strong>${limits.max_files ?? '—'}</strong></div>
      <div>Max File Size: <strong>${limits.max_file_bytes ? Math.round(limits.max_file_bytes / 1024 / 1024) : '—'} MB</strong></div>
      <div>Allowed Extensions: <code class="mono">${(limits.allowed_extensions || []).join(', ')}</code></div>
      <div>OCR Engine: <strong>Local PyTesseract / Tesseract</strong></div>
    </div>
  `;
  grid.appendChild(fileCard);

  // Execution Limits Card
  const execCard = document.createElement("div");
  execCard.className = "card";
  const exec = config && config.execution ? config.execution : {};
  execCard.innerHTML = `
    <div class="card-header">
      <span class="card-title">${renderIcon("activity")} Investigation limits</span>
      <span class="badge badge-indigo">Configured</span>
    </div>
    <div class="card-body" style="font-size: var(--text-xs); line-height: 1.8;">
      <div>Max Concurrent Runs: <strong>${exec.max_concurrent_runs ?? '—'}</strong></div>
      <div>Max LLM Calls per Run: <strong>${exec.max_llm_calls ?? '—'}</strong></div>
      <div>Run Timeout: <strong>${exec.run_timeout_seconds ?? '—'}s</strong></div>
      <div>Max Context Chars: <strong>${exec.max_context_chars ?? '—'}</strong></div>
    </div>
  `;
  grid.appendChild(execCard);

  container.appendChild(grid);
}
