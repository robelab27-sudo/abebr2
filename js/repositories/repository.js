// ============================================================================
// Generic repository: local-first CRUD for any synced entity. Every write
// goes to IndexedDB immediately (so the UI never waits on the network), gets
// queued for sync, and nudges the sync manager to push soon. This is the
// "save locally, sync automatically" pattern the whole app is built on.
// ============================================================================

import { getAll, getById, put, enqueueForSync } from '../db.js';
import { syncManager } from '../sync.js';

export class Repository {
  constructor(storeName) {
    this.storeName = storeName;
  }

  async list({ includeDeleted = false } = {}) {
    const all = await getAll(this.storeName);
    return includeDeleted ? all : all.filter((r) => !r.deleted_at);
  }

  async get(id) {
    return getById(this.storeName, id);
  }

  async create(data) {
    const timestamp = new Date().toISOString();
    const record = {
      ...data,
      id: data.id || crypto.randomUUID(),
      created_at: data.created_at || timestamp,
      updated_at: timestamp,
      deleted_at: null,
      sync_status: 'pending',
    };
    await put(this.storeName, record);
    await enqueueForSync(this.storeName, record.id);
    syncManager.requestSync();
    return record;
  }

  async update(id, changes) {
    const existing = await getById(this.storeName, id);
    if (!existing) throw new Error(`${this.storeName} record "${id}" not found locally.`);
    const record = { ...existing, ...changes, id, updated_at: new Date().toISOString(), sync_status: 'pending' };
    await put(this.storeName, record);
    await enqueueForSync(this.storeName, id);
    syncManager.requestSync();
    return record;
  }

  /** Soft delete — moves the record into the recycle bin rather than erasing it, matching the server schema. */
  async remove(id) {
    return this.update(id, { deleted_at: new Date().toISOString() });
  }

  async restore(id) {
    return this.update(id, { deleted_at: null });
  }
}
