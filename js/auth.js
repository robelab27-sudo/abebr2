// ============================================================================
// Auth: wraps the API's register/login/logout calls and persists the
// session (token + user) into IndexedDB's meta store so it survives reloads
// and works across the app without re-prompting.
// ============================================================================

import { api } from './api.js';
import { getMeta, setMeta, deleteMeta } from './db.js';

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return 'Mobile browser';
  if (/Mac/i.test(ua)) return 'Mac — ' + (navigator.appVersion.includes('Chrome') ? 'Chrome' : 'Safari');
  if (/Win/i.test(ua)) return 'Windows — Browser';
  return 'Browser';
}

export async function register(email, password, displayName) {
  const { user, token } = await api.register(email, password, displayName, deviceLabel());
  await setMeta('auth_token', token);
  await setMeta('auth_user', user);
  return user;
}

export async function login(email, password) {
  const { user, token } = await api.login(email, password, deviceLabel());
  await setMeta('auth_token', token);
  await setMeta('auth_user', user);
  return user;
}

export async function logout() {
  try {
    await api.logout();
  } catch {
    // Even if the network call fails, still clear local session state below.
  }
  await deleteMeta('auth_token');
  await deleteMeta('auth_user');
}

export async function getCurrentUser() {
  return getMeta('auth_user');
}

export async function isAuthenticated() {
  return Boolean(await getMeta('auth_token'));
}

/** Call at the top of any protected page's script. Redirects to login.html if not authenticated. */
export async function requireAuth() {
  const authed = await isAuthenticated();
  if (!authed) {
    window.location.href = 'login.html';
    return null;
  }
  return getCurrentUser();
}
