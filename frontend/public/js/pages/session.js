/**
 * Authenticated Session & Security Console.
 * 
 * Token is kept strictly IN-MEMORY.
 * Provides live inspection of /api/v1/me and token validation.
 */

import { getMe, setSessionToken, clearSessionToken, getSessionToken, hasSessionToken, ApiError } from "../api.js";
import { renderIcon } from "../icons.js";

export async function renderSession(container) {
  const header = document.createElement("div");
  header.className = "view-header";

  const titleGroup = document.createElement("div");
  const title = document.createElement("h1");
  title.className = "view-title";
  title.innerHTML = `${renderIcon("shield")} Your session`;

  const subtitle = document.createElement("p");
  subtitle.className = "view-subtitle";
  subtitle.textContent = "Connect securely to your workspace and review your account permissions.";

  titleGroup.appendChild(title);
  titleGroup.appendChild(subtitle);
  header.appendChild(titleGroup);
  container.appendChild(header);

  const content = document.createElement("div");
  content.className = "session-content";
  container.appendChild(content);

  await loadSessionView(content);
}

async function loadSessionView(content) {
  content.innerHTML = "<div class='metric-label'>Checking session state...</div>";

  let principal = null;
  let authError = null;

  try {
    principal = await getMe();
  } catch (err) {
    authError = err;
  }

  content.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(100%, 360px), 1fr))";

  // Card 1: Current Principal Identity
  const identityCard = document.createElement("div");
  identityCard.className = "card";

  identityCard.innerHTML = `
    <div class="card-header">
      <span class="card-title">${renderIcon("shield")} Workspace access</span>
      <span class="badge ${principal ? 'badge-emerald' : 'badge-rose'}">
        ${principal ? 'Connected' : 'Not connected'}
      </span>
    </div>
    <div class="card-body">
      ${principal ? `
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: var(--text-sm);">
          <div>Subject: <strong class="mono">${principal.subject}</strong></div>
          <div>Tenant ID: <strong class="mono">${principal.tenant_id}</strong></div>
          <div>Project ID: <strong class="mono">${principal.project_id}</strong></div>
          <div>Auth Method: <span class="badge badge-gray">${principal.authn_method}</span></div>
          <div style="margin-top: 4px;">
            <div style="font-size: var(--text-xs); color: var(--text-dim); margin-bottom: 4px;">Assigned roles</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${(principal.roles || []).map(r => `<span class="badge badge-indigo">${r}</span>`).join('')}
            </div>
          </div>
        </div>
      ` : `
        <div class="alert-banner alert-demo" style="margin-bottom: 0;">
          ${renderIcon("alert")}
          <div><strong>Session not connected.</strong> ${authError ? authError.message : 'No Bearer token loaded in memory.'}</div>
        </div>
      `}
    </div>
  `;
  grid.appendChild(identityCard);

  // Card 2: In-Memory Access token Keypad
  const tokenCard = document.createElement("div");
  tokenCard.className = "card";

  tokenCard.innerHTML = `
    <div class="card-header">
      <span class="card-title">${renderIcon("activity")} Connect your account</span>
      <span class="badge ${hasSessionToken() ? 'badge-cyan' : 'badge-gray'}">
        ${hasSessionToken() ? 'Token loaded' : 'Not connected'}
      </span>
    </div>
    <div class="card-body">
      <p style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-3); line-height: 1.5;">
        Paste the access token provided for your account. It stays in this browser tab and is cleared when you reload or close the tab.
      </p>
      <div class="form-group">
        <label class="form-label" for="token-input">Access token</label>
        <textarea class="form-textarea" id="token-input" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Paste RS256 JWT string here..." style="min-height: 90px;"></textarea>
      </div>
      <div id="token-feedback" role="status" aria-live="polite" style="display: none; margin-bottom: var(--space-3);" class="alert-banner"></div>
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        <button class="btn btn-secondary btn-sm" id="clear-token-btn">Clear session</button>
        <button class="btn btn-primary btn-sm" id="save-token-btn">Connect session</button>
      </div>
    </div>
  `;
  grid.appendChild(tokenCard);

  content.appendChild(grid);

  // Local development setup Documentation
  const devDocCard = document.createElement("details");
  devDocCard.className = "card";
  devDocCard.innerHTML = `
    <summary class="card-header" style="cursor: pointer;">
      <span class="card-title">${renderIcon("runs")} Local development setup</span>
      <span class="badge badge-amber">Demo only</span>
    </summary>
    <div class="card-body" style="font-size: var(--text-sm); line-height: 1.6;">
      <p style="color: var(--text-secondary); margin-bottom: var(--space-3);">
        To issue development RS256 Bearer tokens for configured demo subjects on your machine, run the server CLI helper:
      </p>
      <pre><code># Issue a token for the 'analyst' principal
python -m scripts.issue_dev_token analyst --key-path path/to/dev_private_key.pem

# Issue a token for the 'admin' principal
python -m scripts.issue_dev_token admin --key-path path/to/dev_private_key.pem</code></pre>
      <p style="color: var(--text-dim); font-size: var(--text-xs); margin-top: var(--space-3);">
        * Note: <code>scripts.issue_dev_token</code> strictly refuses execution if <code>RCA_MODE != "demo"</code> and requires an explicit private key file.
      </p>
    </div>
  `;
  content.appendChild(devDocCard);

  // Wire up token events
  const tokenInput = tokenCard.querySelector("#token-input");
  const saveBtn = tokenCard.querySelector("#save-token-btn");
  const clearBtn = tokenCard.querySelector("#clear-token-btn");
  const feedback = tokenCard.querySelector("#token-feedback");

  if (hasSessionToken()) {
    tokenInput.placeholder = "Token currently active in memory. Paste new token to overwrite.";
  }

  saveBtn.addEventListener("click", async () => {
    const val = tokenInput.value.trim();
    if (!val) {
      feedback.className = "alert-banner alert-error";
      feedback.textContent = "Please enter a non-empty token.";
      feedback.style.display = "flex";
      return;
    }

    const previousToken = getSessionToken();
    setSessionToken(val);
    saveBtn.disabled = true;
    saveBtn.textContent = "Validating...";

    try {
      const p = await getMe();
      feedback.className = "alert-banner alert-info";
      feedback.textContent = `Connected as ${p.subject} (${(p.roles || []).join(', ')})`;
      tokenInput.value = "";
      feedback.style.display = "flex";
      
      // Update topbar badge
      updateTopbarPrincipal(p);
      setTimeout(() => loadSessionView(content), 600);
    } catch (err) {
      setSessionToken(previousToken);
      feedback.className = "alert-banner alert-error";
      feedback.textContent = `Authentication failed (${err.status || 'Error'}): ${err.message}`;
      feedback.style.display = "flex";
      saveBtn.disabled = false;
      saveBtn.textContent = "Connect session";
    }
  });

  clearBtn.addEventListener("click", () => {
    clearSessionToken();
    tokenInput.value = "";
    feedback.className = "alert-banner alert-demo";
    feedback.textContent = "Session cleared. Token removed from memory.";
    feedback.style.display = "flex";
    updateTopbarPrincipal(null);
    setTimeout(() => loadSessionView(content), 500);
  });
}

function updateTopbarPrincipal(principal) {
  const badge = document.getElementById("topbar-principal-badge");
  if (badge) {
    if (principal) {
      badge.textContent = `${principal.subject} (${(principal.roles || [])[0] || 'VIEWER'})`;
      badge.className = "badge badge-emerald";
    } else {
      badge.textContent = "Not connected";
      badge.className = "badge badge-rose";
    }
  }
}
