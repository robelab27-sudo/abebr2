// ============================================================================
// settings.html controller: theme/accent live-preview, trading preferences,
// trading account management (online — needs the server for sync tokens),
// active device/session management, manual sync, and a full local data
// export.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { getLocalSettings, updateLocalSettings } from '../repositories/settings.js';
import { applyTheme } from '../theme.js';
import { api, NetworkError } from '../api.js';
import { getAll } from '../db.js';
import { downloadFile } from '../lib/csv.js';

const user = await requireAuth();
if (!user) throw new Error('redirecting to login');

document.getElementById('userName').textContent = user.display_name || user.email;
document.getElementById('userAvatar').textContent = (user.display_name || user.email).slice(0, 2).toUpperCase();
document.getElementById('userFoot').addEventListener('click', async () => {
  if (confirm('Sign out of this device?')) { await logout(); window.location.href = 'login.html'; }
});

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced', [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally', [SYNC_STATUS.ERROR]: 'Sync error',
};
syncManager.onStatusChange((status, meta) => {
  document.getElementById('syncDot').className = `sync-dot status-${status}`;
  document.getElementById('syncStatus').className = `sync-status status-${status}`;
  document.getElementById('syncStatusText').textContent = STATUS_LABEL[status];
  document.getElementById('syncDetailStatus').textContent = meta.lastSyncedAt
    ? `${STATUS_LABEL[status]} · last successful sync ${meta.lastSyncedAt.toLocaleTimeString()}`
    : STATUS_LABEL[status];
});
syncManager.start();

document.getElementById('syncNowBtn').addEventListener('click', async () => {
  await syncManager.syncNow();
  showToast('Sync triggered');
});

// ---------------------------------------------------------------------------
// Section tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.settings-nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach((i) => i.classList.remove('active'));
    document.querySelectorAll('.settings-section').forEach((s) => s.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`section-${item.dataset.section}`).classList.add('active');
    if (item.dataset.section === 'accounts') loadAccounts();
    if (item.dataset.section === 'sync') loadSessions();
  });
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'INR', 'SGD', 'ZAR', 'AED'];
const ACCENT_PRESETS = ['#3DDC97', '#7C9EFF', '#F5B860', '#FF6B6B', '#C792EA', '#4FD1E8', '#FF8FB1'];

let settings = await getLocalSettings(user.id);
applyTheme(settings);

function populateCurrency() {
  const select = document.getElementById('currencySelect');
  select.innerHTML = CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  select.value = settings.currency || 'USD';
}

function populateTimezone() {
  const select = document.getElementById('timezoneSelect');
  let zones;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'];
  }
  select.innerHTML = zones.map((z) => `<option value="${z}">${z}</option>`).join('');
  select.value = settings.timezone || 'UTC';
}

function populateAccentSwatches() {
  const wrap = document.getElementById('accentOptions');
  wrap.innerHTML = ACCENT_PRESETS.map((color) =>
    `<div class="accent-swatch ${settings.accent_color === color ? 'selected' : ''}" style="background:${color};" data-accent="${color}"></div>`
  ).join('');
}

function refreshPreferenceUI() {
  document.querySelectorAll('.theme-swatch').forEach((el) => {
    el.classList.toggle('selected', el.dataset.themeChoice === (settings.theme || 'dark'));
  });
  populateAccentSwatches();
  document.getElementById('startingBalanceInput').value = settings.starting_balance ?? 0;
  document.getElementById('languageSelect').value = settings.language || 'en';

  for (const [toggleId, key] of [['toggleNotifications', 'notifications_enabled'], ['toggleAutoBackup', 'auto_backup_enabled'], ['toggleAutoSync', 'auto_sync_enabled']]) {
    document.getElementById(toggleId).classList.toggle('on', Boolean(settings[key]));
  }
}

populateCurrency();
populateTimezone();
refreshPreferenceUI();

async function saveSettings(changes) {
  settings = await updateLocalSettings(user.id, changes);
  applyTheme(settings);
  refreshPreferenceUI();
}

document.querySelectorAll('.theme-swatch').forEach((el) => {
  el.addEventListener('click', () => saveSettings({ theme: el.dataset.themeChoice }));
});

document.getElementById('accentOptions').addEventListener('click', (e) => {
  const swatch = e.target.closest('[data-accent]');
  if (swatch) saveSettings({ accent_color: swatch.dataset.accent });
});

document.getElementById('currencySelect').addEventListener('change', (e) => saveSettings({ currency: e.target.value }));
document.getElementById('timezoneSelect').addEventListener('change', (e) => saveSettings({ timezone: e.target.value }));
document.getElementById('languageSelect').addEventListener('change', (e) => saveSettings({ language: e.target.value }));
document.getElementById('startingBalanceInput').addEventListener('change', (e) => saveSettings({ starting_balance: Number(e.target.value) || 0 }));

for (const [toggleId, key] of [['toggleNotifications', 'notifications_enabled'], ['toggleAutoBackup', 'auto_backup_enabled'], ['toggleAutoSync', 'auto_sync_enabled']]) {
  document.getElementById(toggleId).addEventListener('click', (e) => {
    const nowOn = !e.currentTarget.classList.contains('on');
    saveSettings({ [key]: nowOn ? 1 : 0 });
  });
}

// ---------------------------------------------------------------------------
// Trading accounts (server-backed — needs connectivity)
// ---------------------------------------------------------------------------
async function loadAccounts() {
  const list = document.getElementById('accountsList');
  const emptyState = document.getElementById('accountsEmptyState');
  list.innerHTML = '<div style="color:var(--text-dim); font-size:13px; padding:12px 0;">Loading accounts…</div>';

  try {
    const { accounts } = await api.listAccounts();
    list.innerHTML = '';
    emptyState.style.display = accounts.length === 0 ? 'flex' : 'none';

    for (const account of accounts) {
      const row = document.createElement('div');
      row.className = 'account-row';
      row.innerHTML = `
        <div class="account-info">
          <div class="name">${escapeHtml(account.account_name)}</div>
          <div class="meta">${[account.prop_firm, account.broker, account.account_number].filter(Boolean).map(escapeHtml).join(' · ') || 'No broker details set'}</div>
        </div>
        <div class="account-row-actions">
          <span class="token-pill" data-copy-token="${account.sync_token}" title="Click to copy sync token">${account.sync_token.slice(0, 10)}…</span>
          <div class="icon-btn" data-action="rotate" data-id="${account.id}" title="Rotate sync token">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
          </div>
          <div class="icon-btn danger" data-action="deactivate" data-id="${account.id}" title="Remove account">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </div>
        </div>`;
      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = '';
    emptyState.style.display = 'flex';
    document.getElementById('accountsEmptyState').querySelector('.title').textContent =
      err instanceof NetworkError ? "Can't load accounts — you're offline" : 'Could not load accounts';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

document.getElementById('accountsList').addEventListener('click', async (event) => {
  const copyEl = event.target.closest('[data-copy-token]');
  if (copyEl) {
    await navigator.clipboard.writeText(copyEl.dataset.copyToken);
    showToast('Sync token copied');
    return;
  }

  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const { action, id } = actionEl.dataset;

  if (action === 'rotate') {
    if (!confirm('Rotate this account\'s sync token? Any MT5 EA already configured with the old token will need updating.')) return;
    await api.rotateAccountToken(id);
    showToast('Sync token rotated');
    loadAccounts();
  } else if (action === 'deactivate') {
    if (!confirm('Remove this account? Existing trades keep their history either way.')) return;
    await api.deleteAccount(id);
    showToast('Account removed');
    loadAccounts();
  }
});

document.getElementById('addAccountBtn').addEventListener('click', () => {
  document.getElementById('addAccountForm').style.display = 'block';
});
document.getElementById('cancelAddAccount').addEventListener('click', () => {
  document.getElementById('addAccountForm').style.display = 'none';
});
document.getElementById('saveAccountBtn').addEventListener('click', async () => {
  const name = document.getElementById('aName').value.trim();
  if (!name) { showToast('Account name is required.', 'error'); return; }

  try {
    await api.createAccount({
      account_name: name,
      prop_firm: document.getElementById('aPropFirm').value.trim(),
      broker: document.getElementById('aBroker').value.trim(),
      account_number: document.getElementById('aAccountNumber').value.trim(),
      mt5_login: document.getElementById('aMt5Login').value.trim(),
      mt5_server: document.getElementById('aMt5Server').value.trim(),
      currency: document.getElementById('aCurrency').value.trim() || 'USD',
      starting_balance: Number(document.getElementById('aStartingBalance').value) || 0,
    });
    document.getElementById('addAccountForm').style.display = 'none';
    document.getElementById('addAccountForm').querySelectorAll('input').forEach((i) => (i.value = ''));
    showToast('Account added');
    loadAccounts();
  } catch (err) {
    showToast(err instanceof NetworkError ? "Can't reach the server — you're offline." : 'Could not add account.', 'error');
  }
});

// ---------------------------------------------------------------------------
// Active devices / sessions
// ---------------------------------------------------------------------------
async function loadSessions() {
  const list = document.getElementById('sessionsList');
  list.innerHTML = '<div style="color:var(--text-dim); font-size:13px; padding:12px 0;">Loading devices…</div>';

  try {
    const { sessions } = await api.listSessions();
    list.innerHTML = '';
    for (const session of sessions) {
      const row = document.createElement('div');
      row.className = 'session-row';
      row.innerHTML = `
        <div class="session-info">
          <div class="name">${escapeHtml(session.device_label)} ${session.is_current ? '<span class="current-badge">This device</span>' : ''}</div>
          <div class="meta">Last active ${new Date(session.last_seen_at).toLocaleString()}</div>
        </div>
        ${session.is_current ? '' : `<div class="icon-btn danger" data-revoke="${session.id}" title="Log out this device">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>`}
      `;
      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = `<div style="color:var(--text-dim); font-size:13px; padding:12px 0;">${err instanceof NetworkError ? "Can't load devices — you're offline." : 'Could not load devices.'}</div>`;
  }
}

document.getElementById('sessionsList').addEventListener('click', async (event) => {
  const el = event.target.closest('[data-revoke]');
  if (!el) return;
  await api.revokeSession(el.dataset.revoke);
  showToast('Device signed out');
  loadSessions();
});

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------
document.getElementById('exportAllBtn').addEventListener('click', async () => {
  const [trades, journal_entries, calendar_notes, goals, screenshots] = await Promise.all([
    getAll('trades'), getAll('journal_entries'), getAll('calendar_notes'), getAll('goals'), getAll('screenshots'),
  ]);
  const backup = { exported_at: new Date().toISOString(), user: user.email, trades, journal_entries, calendar_notes, goals, screenshots, settings };
  downloadFile(`ledger-backup-${Date.now()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  showToast('Backup downloaded');
});
