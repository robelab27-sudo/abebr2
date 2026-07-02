// ============================================================================
// IndexedDB layer — the local, offline-first database every page reads from
// and writes to. The sync manager (sync.js) is the only thing that talks to
// the network; everything else in the UI only ever touches this file.
//
// Object stores:
//   trades, journal_entries, calendar_notes, goals, screenshots  — synced entities
//   settings        — single row, keyed by user_id
//   sync_queue      — dirty-record tracker: {key: "entity:id", entity, id, queued_at}
//   meta            — small key/value bag: auth token, current user, last sync cursor
// ============================================================================

const DB_NAME = 'trading_journal';
const DB_VERSION = 1;

const SYNCED_STORES = ['trades', 'journal_entries', 'calendar_notes', 'goals', 'screenshots'];

let dbPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Opens (or creates/upgrades) the IndexedDB database. Safe to call many times — cached after first call. */
export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      for (const storeName of SYNCED_STORES) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const store = db.createObjectStore(storeName, { keyPath: 'id' });
        store.createIndex('updated_at', 'updated_at');
        store.createIndex('deleted_at', 'deleted_at');
        if (storeName === 'trades') store.createIndex('entry_date', 'entry_date');
        if (storeName === 'journal_entries' || storeName === 'screenshots') store.createIndex('trade_id', 'trade_id');
        if (storeName === 'calendar_notes') store.createIndex('note_date', 'note_date');
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'user_id' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Generic store helpers
// ---------------------------------------------------------------------------

export async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

export async function getById(storeName, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const result = await requestToPromise(tx.objectStore(storeName).get(id));
  return result || null;
}

export async function put(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  await requestToPromise(tx.objectStore(storeName).put(value));
  return value;
}

/** Write many records to a store in one transaction (used by the sync engine when applying a pull). */
export async function putMany(storeName, values) {
  if (!values || values.length === 0) return;
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function remove(storeName, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  await requestToPromise(tx.objectStore(storeName).delete(id));
}

export async function clearStore(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  await requestToPromise(tx.objectStore(storeName).clear());
}

// ---------------------------------------------------------------------------
// meta key/value helpers (auth token, current user, sync cursor)
// ---------------------------------------------------------------------------

export async function getMeta(key, defaultValue = null) {
  const row = await getById('meta', key);
  return row ? row.value : defaultValue;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

export async function deleteMeta(key) {
  return remove('meta', key);
}

// ---------------------------------------------------------------------------
// sync_queue helpers — tracks which local records still need pushing.
// Using "entity:id" as the key means editing the same record twice while
// offline just overwrites the queue entry instead of growing it.
// ---------------------------------------------------------------------------

export async function enqueueForSync(entity, id) {
  return put('sync_queue', { key: `${entity}:${id}`, entity, id, queued_at: new Date().toISOString() });
}

export async function getQueue() {
  return getAll('sync_queue');
}

export async function clearQueueEntries(keys) {
  const db = await openDatabase();
  const tx = db.transaction('sync_queue', 'readwrite');
  const store = tx.objectStore('sync_queue');
  for (const key of keys) store.delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export { SYNCED_STORES };
