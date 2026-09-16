/**
 * Authenticated API Client for RCA assist.
 * 
 * Token is stored strictly IN-MEMORY in a private closure.
 * Never persisted in localStorage, sessionStorage, or cookies.
 * Zero silent simulation fallbacks: HTTP 401, 403, 503 are preserved and reported.
 */

let inMemoryToken = null;

export function setSessionToken(token) {
  inMemoryToken = token ? token.trim() : null;
}

export function getSessionToken() {
  return inMemoryToken;
}

export function clearSessionToken() {
  inMemoryToken = null;
}

export function hasSessionToken() {
  return Boolean(inMemoryToken);
}

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const headers = {
    "Accept": "application/json",
    ...options.headers
  };

  if (inMemoryToken) {
    headers["Authorization"] = `Bearer ${inMemoryToken}`;
  }

  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (err) {
    throw new ApiError(0, `Network or connectivity error: ${err.message}`);
  }

  if (!response.ok) {
    let errorDetail = null;
    try {
      const data = await response.clone().json();
      errorDetail = data.detail || data;
    } catch {
      errorDetail = response.statusText || `HTTP ${response.status}`;
    }

    let message = `HTTP ${response.status}`;
    if (typeof errorDetail === "string") {
      message = errorDetail;
    } else if (errorDetail && errorDetail.detail) {
      message = errorDetail.detail;
    } else if (Array.isArray(errorDetail)) {
      message = errorDetail.map(d => `${d.loc ? d.loc.join('.') + ': ' : ''}${d.msg}`).join("; ");
    }

    throw new ApiError(response.status, message, errorDetail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/* Core Readiness & Telemetry */
export async function getReady() {
  return request("/ready");
}

export async function getHealth() {
  return request("/health");
}

/* Authenticated Context & Configuration */
export async function getMe() {
  return request("/api/v1/me");
}

export async function getConfig() {
  return request("/api/v1/config");
}

export async function getCapabilities(all = true) {
  return request(all ? "/api/v1/capabilities?all=true" : "/api/v1/capabilities");
}

export async function getConnectorHealth() {
  return request("/api/v1/connectors/health");
}

/* Agent Specialists Dual-Custody Governance */
export async function getAgentConfigurations() {
  return request("/api/v1/agent-configurations");
}

export async function getAgentSchema() {
  return request("/api/v1/agent-configurations/schema");
}

export async function submitAgentConfiguration(yamlText) {
  return request("/api/v1/agent-configurations", {
    method: "POST",
    body: { yaml: yamlText }
  });
}

export async function approveAgentConfiguration(draftId, expectedHash, reason) {
  return request(`/api/v1/agent-configurations/${encodeURIComponent(draftId)}/approve`, {
    method: "POST",
    body: {
      expected_hash: expectedHash,
      reason: reason
    }
  });
}

export async function rejectAgentConfiguration(draftId, expectedHash, reason) {
  return request(`/api/v1/agent-configurations/${encodeURIComponent(draftId)}/reject`, {
    method: "POST",
    body: {
      expected_hash: expectedHash,
      reason: reason
    }
  });
}

export async function revokeAgentConfiguration(draftId, reason) {
  return request(`/api/v1/agent-configurations/${encodeURIComponent(draftId)}/revoke`, {
    method: "POST",
    body: {
      reason: reason
    }
  });
}

/* Runs & Evidence Explorer */
export async function listRuns(limit = 20, before = null) {
  let url = `/api/v1/runs?limit=${encodeURIComponent(limit)}`;
  if (before) {
    url += `&before=${encodeURIComponent(before)}`;
  }
  return request(url);
}

export async function getRun(runId) {
  return request(`/api/v1/runs/${encodeURIComponent(runId)}`);
}

export async function getRunEvidence(runId) {
  return request(`/api/v1/runs/${encodeURIComponent(runId)}/evidence`);
}

export async function executeRun(capability, prompt, incidentId = null) {
  return request("/api/v1/runs", {
    method: "POST",
    body: {
      capability: capability,
      prompt: prompt,
      incident_id: incidentId || null,
      attachment_ids: []
    }
  });
}

export async function cancelRun(runId) {
  return request(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST"
  });
}
