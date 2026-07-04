// ============================================================================
// Thin fetch wrapper around the Worker API. Every call attaches the bearer
// token automatically (when present) and throws a typed ApiError on non-2xx
// responses so callers can distinguish "network is down" from "server said
// no" — the sync manager treats those very differently.
// ============================================================================

import { API_BASE_URL } from './config.js';
import { getMeta } from './db.js';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Thrown when fetch itself fails (offline, DNS, CORS, server unreachable). */
export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function request(method, path, { body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = await getMeta('auth_token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new NetworkError(err.message || 'Network request failed.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Some responses (e.g. 204) have no body — that's fine.
  }

  if (!response.ok) {
    throw new ApiError(data?.error || `Request failed with status ${response.status}`, response.status, data?.details);
  }

  return data;
}

export const api = {
  // Auth
  register: (email, password, displayName, deviceLabel) =>
    request('POST', '/api/auth/register', { auth: false, body: { email, password, display_name: displayName, device_label: deviceLabel } }),
  login: (email, password, deviceLabel) =>
    request('POST', '/api/auth/login', { auth: false, body: { email, password, device_label: deviceLabel } }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),
  listSessions: () => request('GET', '/api/auth/sessions'),
  revokeSession: (id) => request('DELETE', `/api/auth/sessions/${id}`),

  // Sync engine
  syncPull: (since) => request('GET', `/api/sync/pull?since=${encodeURIComponent(since)}`),
  syncPush: (payload) => request('POST', '/api/sync/push', { body: payload }),

  // Trading accounts
  listAccounts: () => request('GET', '/api/accounts'),
  createAccount: (account) => request('POST', '/api/accounts', { body: account }),
  updateAccount: (id, changes) => request('PUT', `/api/accounts/${id}`, { body: changes }),
  deleteAccount: (id) => request('DELETE', `/api/accounts/${id}`),
  rotateAccountToken: (id) => request('POST', `/api/accounts/${id}/rotate-token`),

  // Health check (useful for a manual "test connection" button in Settings)
  health: () => request('GET', '/api/health', { auth: false }),

  // Screenshots
  listScreenshots: (tradeId) => request('GET', `/api/screenshots?trade_id=${encodeURIComponent(tradeId)}`),
  uploadScreenshot: (formData) => requestForm('POST', '/api/screenshots', formData),
  updateScreenshot: (id, changes) => request('PUT', `/api/screenshots/${id}`, { body: changes }),
  replaceScreenshotFile: (id, formData) => requestForm('PUT', `/api/screenshots/${id}/file`, formData),
  deleteScreenshot: (id) => request('DELETE', `/api/screenshots/${id}`),
  getScreenshotFileUrl: (id) => `${API_BASE_URL}/api/screenshots/${id}/file`,
};

/** Like request(), but sends FormData (for file uploads) instead of JSON — no Content-Type header, the browser sets the correct multipart boundary itself. */
async function requestForm(method, path, formData) {
  const headers = {};
  const token = await getMeta('auth_token');
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: formData });
  } catch (err) {
    throw new NetworkError(err.message || 'Network request failed.');
  }

  let data = null;
  try { data = await response.json(); } catch { /* no body */ }

  if (!response.ok) {
    throw new ApiError(data?.error || `Request failed with status ${response.status}`, response.status, data?.details);
  }
  return data;
}
