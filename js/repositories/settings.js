// ============================================================================
// Settings is a singleton row per user, so it doesn't fit the generic
// Repository pattern (which is keyed by an "id" the server also uses for
// dedupe). These two helpers do the same "write locally, queue for sync"
// dance, keyed by user_id instead.
// ============================================================================

import { getById, put, enqueueForSync } from '../db.js';
import { syncManager } from '../sync.js';

const DEFAULTS = {
  theme: 'dark',
  accent_color: '#3DDC97',
  currency: 'USD',
  timezone: 'UTC',
  starting_balance: 0,
  notifications_enabled: 1,
  auto_backup_enabled: 1,
  auto_sync_enabled: 1,
  language: 'en',
};

export async function getLocalSettings(userId) {
  const existing = await getById('settings', userId);
  return existing || { user_id: userId, ...DEFAULTS, updated_at: null };
}

export async function updateLocalSettings(userId, changes) {
  const existing = await getById('settings', userId);
  const updated = {
    ...DEFAULTS,
    ...(existing || {}),
    ...changes,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  await put('settings', updated);
  await enqueueForSync('settings', userId);
  syncManager.requestSync();
  return updated;
}
