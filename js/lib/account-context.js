// ============================================================================
// Account context — tracks which trading account the person is currently
// "viewing" (or "All Accounts"), shared across every page. The account list
// itself comes from the server (accounts require connectivity to manage),
// but we cache the last-fetched list locally so the switcher still renders
// something sensible if opened while offline.
// ============================================================================

import { api } from '../api.js';
import { getMeta, setMeta } from '../db.js';
import { broadcast, onBroadcast } from './broadcast.js';

const ACTIVE_ACCOUNT_KEY = 'active_account_id';
const CACHED_ACCOUNTS_KEY = 'cached_accounts';

/** null = "All Accounts" (no filter). */
export async function getActiveAccountId() {
  return getMeta(ACTIVE_ACCOUNT_KEY, null);
}

export async function setActiveAccountId(accountId) {
  await setMeta(ACTIVE_ACCOUNT_KEY, accountId || null);
  window.dispatchEvent(new CustomEvent('account-changed', { detail: { accountId: accountId || null } }));
  broadcast('account-changed', { accountId: accountId || null });
}

// Re-dispatch the same local event when another tab changes the active
// account, so every page's existing 'account-changed' listener (which
// already knows how to re-filter and re-render) just works without change.
onBroadcast((msg) => {
  if (msg.type === 'account-changed') {
    window.dispatchEvent(new CustomEvent('account-changed', { detail: msg.payload }));
  }
});

/** Returns the cached account list immediately, and refreshes it from the server in the background if online. */
export async function getAccounts() {
  const cached = await getMeta(CACHED_ACCOUNTS_KEY, []);
  if (navigator.onLine) {
    refreshAccountsCache().catch(() => {});
  }
  return cached;
}

export async function refreshAccountsCache() {
  const { accounts } = await api.listAccounts();
  await setMeta(CACHED_ACCOUNTS_KEY, accounts);
  return accounts;
}

/** Call after any change on the Settings page so the switcher reflects it immediately, without waiting on the background refresh. */
export async function invalidateAccountsCache() {
  try {
    await refreshAccountsCache();
  } catch {
    // offline — the cache will catch up next time we're online.
  }
}
