/**
 * Astra 6 Platform Application Entrypoint & Coordinator.
 * 
 * Features:
 * - Dual Theme Management (Fable Light + Obsidian Dark, persisted in localStorage)
 * - Collapsible Sidebar Navigation
 * - Global Command Palette (⌘K)
 * - Router Coordinator for all 11 admin & investigation routes
 * - Real-time Heartbeat & Identity Bootstrap
 */

import { Router } from "./router.js";
import { getReady, getMe, getConfig } from "./api.js";
import { renderOverview } from "./pages/overview.js";
import { renderAgents } from "./pages/agents.js";
import { renderGovernance } from "./pages/governance.js";
import { renderTools } from "./pages/tools.js";
import { renderKnowledge } from "./pages/knowledge.js";
import { renderUsers } from "./pages/users.js";
import { renderBilling } from "./pages/billing.js";
import { renderSettings } from "./pages/settings.js";
import { renderCapabilities } from "./pages/capabilities.js";
import { renderRuns } from "./pages/runs.js";
import { renderSession } from "./pages/session.js";

const routes = {
  overview: renderOverview,
  agents: renderAgents,
  governance: renderGovernance,
  tools: renderTools,
  knowledge: renderKnowledge,
  users: renderUsers,
  billing: renderBilling,
  settings: renderSettings,
  capabilities: renderCapabilities,
  runs: renderRuns,
  session: renderSession
};

// Command Palette Registry
const COMMANDS = [
  { label: "Agent Fleet Management", category: "Fleet", route: "agents", icon: "agents" },
  { label: "Create Specialized RCA Agent", category: "Fleet", route: "agents", icon: "plus" },
  { label: "Governance & Guardrails", category: "Safety", route: "governance", icon: "shieldCheck" },
  { label: "Dual-Custody Approval Queue", category: "Safety", route: "governance", icon: "shield" },
  { label: "Cryptographic Audit Trail", category: "Safety", route: "governance", icon: "database" },
  { label: "Tools & Telemetry Integrations", category: "Connectors", route: "tools", icon: "database" },
  { label: "Knowledge & RAG Document Stores", category: "Context", route: "knowledge", icon: "bookOpen" },
  { label: "Users, Teams & RBAC Access", category: "Access", route: "users", icon: "users" },
  { label: "Usage & Spend Attribution", category: "Billing", route: "billing", icon: "creditCard" },
  { label: "System Settings & Feature Flags", category: "Settings", route: "settings", icon: "settings" },
  { label: "Start New Incident Investigation", category: "Investigations", route: "runs", icon: "runs" },
  { label: "Investigation Workspace & Runs", category: "Investigations", route: "runs", icon: "runs" },
  { label: "Inspect Auth Session & Public Keys", category: "Session", route: "session", icon: "lock" }
];

async function initApp() {
  const router = new Router(routes, "agents");

  // ==========================================================================
  // 1. THEME MANAGEMENT (Fable Light + Obsidian Dark)
  // ==========================================================================
  const savedTheme = localStorage.getItem("astra-theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("astra-theme", newTheme);
    });
  }

  // ==========================================================================
  // 2. COLLAPSIBLE SIDEBAR
  // ==========================================================================
  const appShell = document.getElementById("app-shell");
  const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
  const savedSidebar = localStorage.getItem("astra-sidebar-collapsed");
  if (savedSidebar === "true" && appShell) {
    appShell.classList.add("sidebar-collapsed");
  }

  if (sidebarToggleBtn && appShell) {
    sidebarToggleBtn.addEventListener("click", () => {
      appShell.classList.toggle("sidebar-collapsed");
      const isCollapsed = appShell.classList.contains("sidebar-collapsed");
      localStorage.setItem("astra-sidebar-collapsed", isCollapsed ? "true" : "false");
    });
  }

  // ==========================================================================
  // 3. GLOBAL COMMAND PALETTE (⌘K)
  // ==========================================================================
  const commandPaletteBackdrop = document.getElementById("command-palette-backdrop");
  const commandSearchBtn = document.getElementById("topbar-search-btn");
  const commandSearchInput = document.getElementById("command-search-input");
  const commandResultsList = document.getElementById("command-results-list");

  function openCommandPalette() {
    if (!commandPaletteBackdrop) return;
    commandPaletteBackdrop.classList.add("open");
    commandSearchInput.value = "";
    renderCommandSuggestions("");
    setTimeout(() => commandSearchInput.focus(), 50);
  }

  function closeCommandPalette() {
    if (!commandPaletteBackdrop) return;
    commandPaletteBackdrop.classList.remove("open");
  }

  function renderCommandSuggestions(query) {
    if (!commandResultsList) return;
    const q = query.toLowerCase().trim();
    const matches = COMMANDS.filter(cmd => 
      !q || cmd.label.toLowerCase().includes(q) || cmd.category.toLowerCase().includes(q)
    );

    if (matches.length === 0) {
      commandResultsList.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--muted); font-size: 13px;">
          No matching commands or pages found.
        </div>
      `;
      return;
    }

    commandResultsList.innerHTML = matches.map((cmd, idx) => `
      <div class="command-item ${idx === 0 ? 'focused' : ''}" data-route="${cmd.route}">
        <div class="command-item-main">
          <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--dim); width: 85px;">${cmd.category}</span>
          <strong>${cmd.label}</strong>
        </div>
        <span class="badge-mono">#${cmd.route}</span>
      </div>
    `).join("");

    commandResultsList.querySelectorAll(".command-item").forEach(item => {
      item.addEventListener("click", () => {
        const targetRoute = item.dataset.route;
        closeCommandPalette();
        router.navigate(targetRoute);
      });
    });
  }

  if (commandSearchBtn) {
    commandSearchBtn.addEventListener("click", openCommandPalette);
  }

  if (commandSearchInput) {
    commandSearchInput.addEventListener("input", (e) => {
      renderCommandSuggestions(e.target.value);
    });
  }

  document.addEventListener("keydown", (e) => {
    // ⌘K or Ctrl+K trigger
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (commandPaletteBackdrop?.classList.contains("open")) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    }
    if (e.key === "Escape" && commandPaletteBackdrop?.classList.contains("open")) {
      closeCommandPalette();
    }
  });

  if (commandPaletteBackdrop) {
    commandPaletteBackdrop.addEventListener("click", (e) => {
      if (e.target === commandPaletteBackdrop) closeCommandPalette();
    });
  }

  // Environment Selector switch feedback
  const envSelect = document.getElementById("topbar-env-select");
  if (envSelect) {
    envSelect.addEventListener("change", (e) => {
      const modeBadge = document.getElementById("topbar-mode-badge");
      if (modeBadge) {
        if (e.target.value === "prod") {
          modeBadge.textContent = "Prod mode";
          modeBadge.className = "nav-badge approved";
        } else if (e.target.value === "staging") {
          modeBadge.textContent = "Staging canary";
          modeBadge.className = "nav-badge pending";
        } else {
          modeBadge.textContent = "Demo mode";
          modeBadge.className = "nav-badge approved";
        }
      }
    });
  }

  // Topbar Session Shortcut Button
  const sessionBtn = document.getElementById("topbar-session-btn");
  if (sessionBtn) {
    sessionBtn.addEventListener("click", () => {
      router.navigate("session");
    });
  }

  // Initialize client router
  router.init();

  // ==========================================================================
  // 4. BOOTSTRAP TELEMETRY & IDENTITY
  // ==========================================================================
  try {
    const [readyResult, configResult, meResult] = await Promise.allSettled([
      getReady(),
      getConfig(),
      getMe()
    ]);

    const ready = readyResult.status === "fulfilled" ? readyResult.value : null;
    const config = configResult.status === "fulfilled" ? configResult.value : null;
    const me = meResult.status === "fulfilled" ? meResult.value : null;

    // Heartbeat status
    const heartbeatText = document.getElementById("topbar-heartbeat-text");
    if (heartbeatText) {
      heartbeatText.textContent = ready?.ready ? "Live 24ms" : "Offline / Mock";
    }

    // Tenant / Project Scope
    const scopeText = document.getElementById("topbar-scope-text");
    if (scopeText && config?.execution) {
      scopeText.textContent = `${config.execution.tenant_id} / ${config.execution.project_id}`;
    }

    // User Principal & Role
    const userName = document.getElementById("topbar-user-name");
    const userRole = document.getElementById("topbar-user-role");
    const userAvatar = document.getElementById("topbar-user-avatar");
    if (me) {
      if (userName) userName.textContent = me.subject || "admin";
      if (userRole) userRole.textContent = (me.roles || [])[0] || "PLATFORM_ADMIN";
      if (userAvatar) userAvatar.textContent = (me.subject || "A").substring(0, 1).toUpperCase();
    }
  } catch (err) {
    console.warn("Bootstrap telemetry check error:", err);
  }
}

// Boot application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
