// ============================================================================
// SyncManager — the client half of the sync engine described in the master
// spec: syncs on app launch, every 30 seconds, after every save/edit, and
// immediately when the browser regains connectivity. Never throws past its
// own boundary — sync failures degrade to an "offline" status instead of
// crashing the page, and the local IndexedDB copy is always the source of
// truth for what the UI renders.
// ============================================================================

import { api, ApiError, NetworkError } from './api.js';
import { getAll, getById, putMany, getMeta, setMeta, getQueue, clearQueueEntries, SYNCED_STORES } from './db.js';
import { SYNC_INTERVAL_MS, SYNC_DEBOUNCE_MS } from './config.js';

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
      await this._pullChanges();
      this.lastSyncedAt = new Date();
      this._setStatus(SYNC_STATUS.SYNCED);
    } catch (err) {
      if (err instanceof NetworkError) {
        this._setStatus(SYNC_STATUS.OFFLINE);
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

  /** Download everything that changed on the server since our last successful pull. */
  async _pullChanges() {
    const since = await getMeta('last_sync_cursor', '1970-01-01T00:00:00.000Z');
    const response = await api.syncPull(since);

    for (const storeName of SYNCED_STORES) {
      const records = response[storeName];
      if (records && records.length > 0) {
        await putMany(storeName, records.map((r) => ({ ...r, sync_status: 'synced' })));
      }
    }

    if (response.settings) {
      await putMany('settings', [response.settings]);
    }

    await setMeta('last_sync_cursor', response.server_time);
  }
}

export const syncManager = new SyncManager();
