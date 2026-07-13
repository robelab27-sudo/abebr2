// ============================================================================
// Cross-tab messaging. IndexedDB storage is shared across tabs of the same
// origin, but nothing tells an already-open tab when another tab changes
// something — each tab only finds out on its own next 30s sync cycle. This
// uses BroadcastChannel (supported in all modern browsers) to push instant
// notifications between tabs for the things that matter most: switching the
// active account, and new data arriving from a sync pull.
// ============================================================================

const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('ledger-sync') : null;

const listeners = new Set();

if (channel) {
  channel.onmessage = (event) => {
    for (const fn of listeners) fn(event.data);
  };
}

/** Send a message to every other open tab (not this one). */
export function broadcast(type, payload = {}) {
  if (channel) channel.postMessage({ type, payload, at: Date.now() });
}

/** Listen for messages from other tabs. Returns an unsubscribe function. */
export function onBroadcast(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
