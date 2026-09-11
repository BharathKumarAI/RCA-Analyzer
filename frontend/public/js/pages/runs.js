/**
 * Runs Explorer, Evidence Provenance & Governed Investigation Launcher.
 */

import { listRuns, getRun, getRunEvidence, executeRun, getCapabilities } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderRuns(container) {
  const header = document.createElement("div");
  header.className = "view-header";

  const titleGroup = document.createElement("div");
  const title = document.createElement("h1");
  title.className = "view-title";
  title.innerHTML = `${renderIcon("runs")} Investigations`;

  const subtitle = document.createElement("p");
  subtitle.className = "view-subtitle";
  subtitle.textContent = "Review investigation history, trace findings to evidence, and start a new analysis.";

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);
  container.appendChild(header);

  const content = document.createElement("div");
  content.className = "runs-content";
  container.appendChild(content);

  await loadRunsTable(content, 20, null);
}

async function loadRunsTable(content, limit = 20, before = null) {
  content.innerHTML = "<div class='metric-label'>Loading investigations…</div>";

  try {
    const runs = await listRuns(limit, before);
    content.innerHTML = "";

    // Action Header
    const actionHeader = document.createElement("div");
    actionHeader.className = "agent-toolbar";
    actionHeader.style.display = "flex";
    actionHeader.style.flexWrap = "wrap";
    actionHeader.style.gap = "var(--space-3)";
    actionHeader.style.justifyContent = "space-between";
    actionHeader.style.alignItems = "center";
    actionHeader.style.marginBottom = "var(--space-4)";

    const counter = document.createElement("div");
    counter.style.fontSize = "var(--text-sm)";
    counter.style.color = "var(--text-secondary)";
    counter.textContent = `${runs.length} investigations on this page`;

    const launchBtn = document.createElement("button");
    launchBtn.className = "btn btn-primary btn-sm";
    launchBtn.innerHTML = `${renderIcon("play")} New investigation`;
    launchBtn.addEventListener("click", () => openLaunchModal(content));

    actionHeader.appendChild(counter);
    actionHeader.appendChild(launchBtn);
    content.appendChild(actionHeader);

    if (runs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.padding = "var(--space-6)";
      empty.style.color = "var(--text-muted)";
      empty.innerHTML = `<div class="empty-state-icon">${renderIcon("runs")}</div><h2 class="empty-state-title">${before ? "You’ve reached the first investigation" : "Your first investigation starts here"}</h2><p class="empty-state-desc">${before ? "Return to recent investigations to continue exploring." : "Describe the symptoms of an incident to collect evidence and identify likely causes."}</p>`;
      if (before) {
        const recent = document.createElement("button");
        recent.className = "btn btn-secondary";
        recent.textContent = "Recent investigations";
        recent.addEventListener("click", () => loadRunsTable(content));
        empty.appendChild(recent);
      }
      content.appendChild(empty);
      return;
    }

    const filters = document.createElement("div");
    filters.className = "agent-toolbar";
    filters.innerHTML = `<div class="search-input-wrapper">${renderIcon("search")}<input class="form-input" type="search" aria-label="Search investigations on this page" placeholder="Search investigations on this page"></div><select class="form-select" style="width:auto" aria-label="Filter investigation status"><option value="">All statuses</option></select>`;
    const statusFilter = filters.querySelector("select");
    [...new Set(runs.map(run => run.status))].sort().forEach(status => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status.replaceAll("_", " ").toLowerCase();
      statusFilter.appendChild(option);
    });
    content.appendChild(filters);

    // Runs Table
    const tableContainer = document.createElement("div");
    tableContainer.className = "table-container";

    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Run ID</th>
          <th>Status</th>
          <th>Capability</th>
          <th>Prompt</th>
          <th>Outcome</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    runs.forEach(run => {
      const tr = document.createElement("tr");
      tr.dataset.status = run.status;
      tr.dataset.search = [run.run_id, run.capability, run.request?.text, run.prompt].filter(Boolean).join(" ").toLowerCase();

      const tdId = document.createElement("td");
      tdId.className = "mono";
      tdId.style.fontWeight = "var(--font-semibold)";
      tdId.style.color = "var(--cyan-telemetry)";
      tdId.textContent = run.run_id.slice(0, 16) + "…";
      tdId.title = run.run_id;

      const tdStatus = document.createElement("td");
      const dotClass = (run.status === "SUCCEEDED" || run.status === "SIMULATED") ? "online" : run.status === "RUNNING" ? "pending" : "offline";
      tdStatus.innerHTML = `
        <div class="status-indicator">
          <span class="status-dot ${dotClass}"></span>
          <span>${run.status}</span>
        </div>
      `;

      const tdCap = document.createElement("td");
      tdCap.className = "mono";
      tdCap.textContent = run.capability;

      const tdPrompt = document.createElement("td");
      tdPrompt.className = "truncate";
      tdPrompt.style.maxWidth = "280px";
      tdPrompt.textContent = run.request?.text || run.prompt || "—";
      tdPrompt.title = tdPrompt.textContent;

      const tdOutcome = document.createElement("td");
      const outcome = (run.result && run.result.outcome) || (run.synthesis && run.synthesis.outcome) || (run.status === "SIMULATED" ? "SIMULATED" : run.status === "FAILED" ? "FAILED" : "PENDING");
      tdOutcome.innerHTML = `<span class="badge ${outcome === 'FINDINGS' ? 'badge-emerald' : outcome === 'SIMULATED' ? 'badge-cyan' : outcome === 'INSUFFICIENT_EVIDENCE' ? 'badge-amber' : 'badge-rose'}">${outcome}</span>`;

      const tdCreated = document.createElement("td");
      tdCreated.style.fontSize = "var(--text-xs)";
      tdCreated.style.color = "var(--text-dim)";
      tdCreated.textContent = run.created_at ? new Date(typeof run.created_at === "number" ? run.created_at * 1000 : run.created_at).toLocaleString() : "—";

      const tdActions = document.createElement("td");
      const viewBtn = document.createElement("button");
      viewBtn.className = "btn btn-secondary btn-sm";
      viewBtn.textContent = "View details";
      viewBtn.setAttribute("aria-label", `View investigation ${run.run_id}`);
      viewBtn.addEventListener("click", () => openRunDrawer(run.run_id));
      tdActions.appendChild(viewBtn);

      tr.appendChild(tdId);
      tr.appendChild(tdStatus);
      tr.appendChild(tdCap);
      tr.appendChild(tdPrompt);
      tr.appendChild(tdOutcome);
      tr.appendChild(tdCreated);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });

    tableContainer.appendChild(table);
    content.appendChild(tableContainer);
    const noMatches = document.createElement("p");
    noMatches.className = "empty-state-desc";
    noMatches.hidden = true;
    noMatches.textContent = "No investigations match. Try a different search or status.";
    content.appendChild(noMatches);
    const filterRows = () => {
      const query = filters.querySelector("input").value.trim().toLowerCase();
      let visible = 0;
      tbody.querySelectorAll("tr").forEach(row => {
        row.hidden = !row.dataset.search.includes(query) || Boolean(statusFilter.value && row.dataset.status !== statusFilter.value);
        if (!row.hidden) visible += 1;
      });
      counter.textContent = `${visible} of ${runs.length} investigations on this page`;
      noMatches.hidden = visible > 0;
    };
    filters.querySelector("input").addEventListener("input", filterRows);
    statusFilter.addEventListener("change", filterRows);

    // Pagination Footer (native 'before' pagination)
    if (runs.length > 0) {
      const oldestRun = runs[runs.length - 1];
      const paginationDiv = document.createElement("div");
      paginationDiv.style.display = "flex";
      paginationDiv.style.justifyContent = "flex-end";
      paginationDiv.style.gap = "8px";

      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-secondary btn-sm";
      nextBtn.textContent = "Older investigations";
      nextBtn.addEventListener("click", () => {
        if (oldestRun.created_at) {
          loadRunsTable(content, limit, oldestRun.created_at);
        }
      });
      nextBtn.disabled = runs.length < limit || !oldestRun.created_at;
      if (before) {
        const recentBtn = document.createElement("button");
        recentBtn.className = "btn btn-secondary btn-sm";
        recentBtn.textContent = "Recent investigations";
        recentBtn.addEventListener("click", () => loadRunsTable(content));
        paginationDiv.appendChild(recentBtn);
      }
      paginationDiv.appendChild(nextBtn);
      content.appendChild(paginationDiv);
    }

  } catch (err) {
    const isAuthRequired = err.status === 401 || err.status === 503;
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${renderIcon("runs")}</div>
        <h2 class="empty-state-title">${isAuthRequired ? 'Connect your session to view investigations' : 'Investigations are unavailable'}</h2>
        <p class="empty-state-desc">
          ${isAuthRequired
            ? 'Connect an authorized session to review your project’s investigations and supporting evidence.'
            : `The server reported an error (${err.status || 'Error'}): ${err.message}`
          }
        </p>
        <div style="display: flex; gap: var(--space-3); margin-top: var(--space-2);">
          <a href="#session" class="btn btn-primary btn-sm">${renderIcon("shield")} Connect session</a>
          <button class="btn btn-secondary btn-sm" id="retry-runs-btn">${renderIcon("refresh")} Retry</button>
        </div>
      </div>
    `;

    const retryBtn = content.querySelector("#retry-runs-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => loadRunsTable(content, limit, before));
    }
  }
}

async function openRunDrawer(runId) {
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop open";

  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.style.maxWidth = "720px";

  drawer.innerHTML = `
    <div class="drawer-header">
      <div>
        <h3 style="font-weight: var(--font-bold); color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
          ${renderIcon("runs")} Investigation details
        </h3>
        <span class="mono" style="font-size: var(--text-xs); color: var(--cyan-telemetry);">${runId}</span>
      </div>
      <button class="btn-icon close-btn" aria-label="Close dialog">${renderIcon("x")}</button>
    </div>
    <div class="drawer-body" id="drawer-content">
      <div class="metric-label">Loading run details and evidence bundles...</div>
    </div>
    <div class="drawer-footer">
      <button class="btn btn-secondary close-btn">Close details</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.appendChild(drawer);

  const drawerContent = drawer.querySelector("#drawer-content");
  const closeButtons = drawer.querySelectorAll(".close-btn");
  const cleanup = () => backdrop.remove();
  closeButtons.forEach(b => b.addEventListener("click", cleanup));

  try {
    const [run, evidenceList] = await Promise.all([
      getRun(runId),
      getRunEvidence(runId).catch(() => [])
    ]);

    drawerContent.innerHTML = "";

    // 1. Run Status & Timings
    const statusDiv = document.createElement("div");
    statusDiv.style.display = "flex";
    statusDiv.style.justifyContent = "space-between";
    statusDiv.style.alignItems = "center";
    statusDiv.style.marginBottom = "var(--space-4)";
    statusDiv.style.padding = "var(--space-3) var(--space-4)";
    statusDiv.style.background = "var(--bg-void)";
    statusDiv.style.borderRadius = "var(--radius-md)";
    statusDiv.style.border = "1px solid var(--border-subtle)";

    const isSuccess = run.status === 'SUCCEEDED' || run.status === 'SIMULATED';
    statusDiv.innerHTML = `
      <div>Status: <span class="badge ${isSuccess ? 'badge-emerald' : 'badge-rose'}">${run.status}</span></div>
      <div>Capability: <strong class="mono">${run.capability}</strong></div>
      <div>Timing: <span class="mono">${run.timings ? (run.timings.total_seconds || 0).toFixed(2) + 's' : (run.created_at ? 'Recorded' : '—')}</span></div>
    `;
    drawerContent.appendChild(statusDiv);

    // 2. Structured Synthesis or Execution Reason
    const investigationResult = run.result || run.synthesis;
    if (investigationResult) {
      const synthCard = document.createElement("div");
      synthCard.className = "card";
      synthCard.style.marginBottom = "var(--space-6)";

      const synthHeader = document.createElement("div");
      synthHeader.className = "card-header";
      synthHeader.innerHTML = `
        <span class="card-title">${renderIcon("activity")} Investigation findings</span>
        <span class="badge ${investigationResult.outcome === 'FINDINGS' ? 'badge-emerald' : 'badge-amber'}">${investigationResult.outcome}</span>
      `;
      synthCard.appendChild(synthHeader);

      const synthBody = document.createElement("div");
      synthBody.className = "card-body";

      const summaryP = document.createElement("p");
      summaryP.style.fontSize = "var(--text-sm)";
      summaryP.style.lineHeight = "1.6";
      summaryP.style.marginBottom = "var(--space-4)";
      summaryP.textContent = investigationResult.summary || "No summary recorded.";
      synthBody.appendChild(summaryP);

      // Findings & Citations
      const findings = investigationResult.findings || [];
      if (findings.length > 0) {
        const findingsTitle = document.createElement("div");
        findingsTitle.className = "form-label";
        findingsTitle.style.marginBottom = "var(--space-2)";
        findingsTitle.textContent = "Verified findings";
        synthBody.appendChild(findingsTitle);

        findings.forEach(f => {
          const fCard = document.createElement("div");
          fCard.className = "finding-card";

          const fSummary = document.createElement("div");
          fSummary.className = "finding-summary";
          fSummary.textContent = f.summary;
          fCard.appendChild(fSummary);

          const fCites = document.createElement("div");
          fCites.className = "finding-citations";
          (f.evidence_ids || []).forEach(eid => {
            const hasMatch = evidenceList.some(ev => ev.evidence_id === eid);
            const badge = document.createElement("span");
            badge.className = `badge ${hasMatch ? 'badge-cyan' : 'badge-rose'}`;
            badge.textContent = `${hasMatch ? '✓' : '✗'} ${eid.slice(0, 14)}…`;
            badge.title = hasMatch ? `Verified citation: ${eid}` : `Unmatched evidence ID: ${eid}`;
            fCites.appendChild(badge);
          });
          fCard.appendChild(fCites);
          synthBody.appendChild(fCard);
        });
      }

      synthCard.appendChild(synthBody);
      drawerContent.appendChild(synthCard);
    }

    // 3. Evidence Bundles Provenance
    const evTitle = document.createElement("h4");
    evTitle.style.fontSize = "var(--text-sm)";
    evTitle.style.fontWeight = "var(--font-bold)";
    evTitle.style.marginBottom = "var(--space-3)";
    evTitle.style.color = "var(--text-secondary)";
    evTitle.textContent = `Evidence (${evidenceList.length})`;
    drawerContent.appendChild(evTitle);

    if (evidenceList.length === 0) {
      const emptyEv = document.createElement("div");
      emptyEv.style.fontSize = "var(--text-xs)";
      emptyEv.style.color = "var(--text-muted)";
      emptyEv.textContent = "No evidence items captured for this run.";
      drawerContent.appendChild(emptyEv);
    } else {
      // Find all cited IDs
      const citedIds = new Set();
      (investigationResult?.findings || []).forEach(f => {
        (f.evidence_ids || []).forEach(id => citedIds.add(id));
      });

      evidenceList.forEach(ev => {
        const evItem = document.createElement("div");
        evItem.className = "evidence-item";

        const isCited = citedIds.has(ev.evidence_id);

        const evHeader = document.createElement("div");
        evHeader.className = "evidence-header";

        const idSpan = document.createElement("span");
        idSpan.className = "evidence-id";
        idSpan.textContent = ev.evidence_id;

        const sourceSpan = document.createElement("span");
        sourceSpan.className = "evidence-source";
        sourceSpan.textContent = ev.source;

        const citeBadge = document.createElement("span");
        citeBadge.className = `badge ${isCited ? 'badge-emerald' : 'badge-gray'}`;
        citeBadge.textContent = isCited ? "Cited in findings" : "Captured";

        evHeader.appendChild(idSpan);
        evHeader.appendChild(sourceSpan);
        evHeader.appendChild(citeBadge);
        evItem.appendChild(evHeader);

        const textDiv = document.createElement("div");
        textDiv.className = "evidence-text";
        textDiv.textContent = ev.text;
        evItem.appendChild(textDiv);

        const metaDiv = document.createElement("div");
        metaDiv.className = "evidence-meta";
        metaDiv.innerHTML = `
          <span>SHA-256: <code>${ev.redaction_fingerprint ? ev.redaction_fingerprint.slice(0, 16) + '…' : '—'}</code></span>
        `;
        evItem.appendChild(metaDiv);

        drawerContent.appendChild(evItem);
      });
    }

  } catch (err) {
    drawerContent.innerHTML = `
      <div class="alert-banner alert-error">
        ${renderIcon("alert")}
        <div>Failed to inspect run: ${err.message}</div>
      </div>
    `;
  }
}

async function openLaunchModal(content) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop open";

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.maxWidth = "560px";

  modal.innerHTML = `
    <div class="modal-header">
      <h3 style="font-weight: var(--font-bold); color: var(--text-primary);">New investigation</h3>
      <button class="btn-icon close-btn" aria-label="Close dialog">${renderIcon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="run-capability">Investigation type *</label>
        <select class="form-select" id="run-capability">
          <option value="">Loading available investigations…</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="run-incident">Incident ID (optional)</label>
        <input class="form-input" id="run-incident" placeholder="e.g. SAMSON-101" />
      </div>
      <div class="form-group">
        <label class="form-label" for="run-prompt">What happened? *</label>
        <textarea class="form-input" id="run-prompt" placeholder="Describe the incident error or symptoms to investigate..." style="min-height: 140px;" required></textarea>
      </div>
      <div id="launch-error" role="alert" style="display: none;" class="alert-banner alert-error"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary cancel-btn">Cancel</button>
      <button class="btn btn-primary submit-btn">Start investigation</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.appendChild(modal);

  const closeBtn = modal.querySelector(".close-btn");
  const cancelBtn = modal.querySelector(".cancel-btn");
  const submitBtn = modal.querySelector(".submit-btn");
  const capSelect = modal.querySelector("#run-capability");
  const incidentInput = modal.querySelector("#run-incident");
  const promptInput = modal.querySelector("#run-prompt");
  const errorDiv = modal.querySelector("#launch-error");

  const cleanup = () => backdrop.remove();
  closeBtn.addEventListener("click", cleanup);
  cancelBtn.addEventListener("click", cleanup);

  submitBtn.disabled = true;
  try {
    const capabilities = await getCapabilities();
    capSelect.replaceChildren();
    capabilities.filter(cap => cap.enabled !== false).forEach(cap => {
      const option = document.createElement("option");
      option.value = cap.id;
      option.textContent = cap.name || cap.id;
      capSelect.appendChild(option);
    });
    submitBtn.disabled = !capSelect.value;
    if (!capSelect.value) {
      errorDiv.textContent = "No investigation types are available for this account.";
      errorDiv.style.display = "flex";
    }
  } catch (err) {
    errorDiv.textContent = `Unable to load investigation types: ${err.message}`;
    errorDiv.style.display = "flex";
  }

  submitBtn.addEventListener("click", async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      errorDiv.textContent = "Investigation prompt is required.";
      errorDiv.style.display = "flex";
      promptInput.setAttribute("aria-invalid", "true");
      promptInput.focus();
      return;
    }

    promptInput.removeAttribute("aria-invalid");
    submitBtn.disabled = true;
    submitBtn.textContent = "Investigating…";

    try {
      await executeRun(capSelect.value, prompt, incidentInput.value.trim() || null);
      cleanup();
      loadRunsTable(content);
    } catch (err) {
      errorDiv.textContent = `Run execution failed: ${err.message}`;
      errorDiv.style.display = "flex";
      submitBtn.disabled = false;
      submitBtn.textContent = "Start investigation";
    }
  });
}
