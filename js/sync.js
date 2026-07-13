// ============================================================================
// SyncManager — the client half of the sync engine described in the master
// spec: syncs on app launch, every 30 seconds, after every save/edit, and
// immediately when the browser regains connectivity. Never throws past its
// own boundary — sync failures degrade to an "offline" status instead of
// crashing the page, and the local IndexedDB copy is always the source of
// truth for what the UI renders.
// ============================================================================

import { api, ApiError, NetworkError } from './api.js';
import { getAll, getById, putMany, getMeta, setMeta, deleteMeta, getQueue, clearQueueEntries, SYNCED_STORES } from './db.js';
import { SYNC_INTERVAL_MS, SYNC_DEBOUNCE_MS } from './config.js';
import { broadcast, onBroadcast } from './lib/broadcast.js';

export const SYNC_STATUS = { SYNCED: 'synced', SYNCING: 'syncing', OFFLINE: 'offline', ERROR: 'error' };

class SyncManager {
  constructor() {
    this.status = SYNC_STATUS.OFFLINE;
    this.lastSyncedAt = null;
    this.listeners = new Set();
    this.debounceTimer = null;
    this.intervalTimer = null;
    this.syncInFlight = null; // Promise, so concurrent triggers collapse into one run
  }

  /** Call once at app startup, after the user is authenticated. */
  start() {
    window.addEventListener('online', () => this.syncNow());
    window.addEventListener('offline', () => this._setStatus(SYNC_STATUS.OFFLINE));

    // Another tab already pulled new data into our *shared* IndexedDB — no
    // need to hit the network again ourselves, just tell every page that
    // already listens via onStatusChange() to re-render from what's now on
    // disk. Passing the real current status (rather than forcing "synced")
    // keeps the status dot honest if this tab is itself offline.
    onBroadcast((msg) => {
      if (msg.type === 'data-changed') {
        for (const cb of this.listeners) cb(this.status, { lastSyncedAt: this.lastSyncedAt });
      }
    });

    this.intervalTimer = setInterval(() => this.syncNow(), SYNC_INTERVAL_MS);
    this.syncNow(); // sync on launch
  }

  stop() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  onStatusChange(callback) {
    this.listeners.add(callback);
    callback(this.status, { lastSyncedAt: this.lastSyncedAt }); // fire immediately with current state
    return () => this.listeners.delete(callback);
  }

  _setStatus(status) {
    this.status = status;
    for (const cb of this.listeners) cb(status, { lastSyncedAt: this.lastSyncedAt });
  }

  /** Called by repositories after every local save/edit/delete. Debounced so rapid edits batch into one sync. */
  requestSync() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.syncNow(), SYNC_DEBOUNCE_MS);
  }

  /** Runs a full push-then-pull cycle. Safe to call anytime — concurrent calls share one in-flight run. */
  async syncNow() {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this._runSync().finally(() => { this.syncInFlight = null; });
    return this.syncInFlight;
  }

  async _runSync() {
    if (!navigator.onLine) {
      this._setStatus(SYNC_STATUS.OFFLINE);
      return;
    }

    this._setStatus(SYNC_STATUS.SYNCING);

    try {
      await this._pushQueue();
      const gotNewData = await this._pullChanges();
      this.lastSyncedAt = new Date();
      this._setStatus(SYNC_STATUS.SYNCED);
      if (gotNewData) broadcast('data-changed');
    } catch (err) {
      if (err instanceof NetworkError) {
        this._setStatus(SYNC_STATUS.OFFLINE);
      } else if (err instanceof ApiError && err.status === 401) {
        // The session is invalid or expired server-side, but the app still
        // thinks it's logged in locally. Force a clean re-login rather than
        // silently failing every sync forever.
        console.error('Session expired or invalid — signing out.');
        this.stop();
        await deleteMeta('auth_token');
        await deleteMeta('auth_user');
        this._setStatus(SYNC_STATUS.ERROR);
        if (!window.location.pathname.endsWith('login.html')) {
          window.location.href = 'login.html?reason=session_expired';
        }
      } else {
        console.error('Sync failed:', err);
        this._setStatus(SYNC_STATUS.ERROR);
      }
    }
  }

  /** Upload every locally dirty record. */
  async _pushQueue() {
    const queueItems = await getQueue();
    if (queueItems.length === 0) return;

    const byEntity = {};
    for (const item of queueItems) {
      byEntity[item.entity] = byEntity[item.entity] || [];
      byEntity[item.entity].push(item);
    }

    const payload = {};
    for (const [entity, items] of Object.entries(byEntity)) {
      if (entity === 'settings') continue; // handled separately below (single object, not an array)
      const records = [];
      for (const item of items) {
        const record = await getById(entity, item.id);
        if (record) records.push(record);
      }
      if (records.length > 0) payload[entity] = records;
    }

    const settingsItems = byEntity.settings;
    if (settingsItems && settingsItems.length > 0) {
      const currentUser = await getMeta('auth_user');
      const settingsRecord = currentUser ? await getById('settings', currentUser.id) : null;
      if (settingsRecord) payload.settings = settingsRecord;
    }

    if (Object.keys(payload).length === 0) {
      await clearQueueEntries(queueItems.map((i) => i.key));
      return;
    }

    await api.syncPush(payload);
    // The server is authoritative once it has accepted the push (even records
    // it "skipped" due to an already-newer version are fine to drop locally —
    // the upcoming pull will bring the newer server version back down).
    await clearQueueEntries(queueItems.map((i) => i.key));
  }

  /** Download everything that changed on the server since our last successful pull. Returns true if any new data was actually applied. */
  async _pullChanges() {
    const since = await getMeta('last_sync_cursor', '1970-01-01T00:00:00.000Z');
    const response = await api.syncPull(since);
    let appliedAnything = false;

    for (const storeName of SYNCED_STORES) {
      const records = response[storeName];
      if (records && records.length > 0) {
        await putMany(storeName, records.map((r) => ({ ...r, sync_status: 'synced' })));
        appliedAnything = true;
      }
    }

    if (response.settings) {
      await putMany('settings', [response.settings]);
      appliedAnything = true;
    }

    await setMeta('last_sync_cursor', response.server_time);
    return appliedAnything;
  }
}

export const syncManager = new SyncManager();
