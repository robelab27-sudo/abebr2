// ============================================================================
// App configuration.
//
// After deploying the Worker (Phase 1), replace API_BASE_URL below with your
// live Worker URL, e.g. "https://trading-journal-api.yourname.workers.dev".
// Leave it as "http://localhost:8787" while developing with `wrangler dev`.
// ============================================================================

export const API_BASE_URL = 'https://trading-journal-api.abebr.workers.dev';

// How often the sync manager auto-syncs in the background, in milliseconds.
export const SYNC_INTERVAL_MS = 30_000;

// How long to wait after a local save before pushing it, so rapid edits
// (typing in a notes field, etc.) get batched into one sync call instead of
// firing on every keystroke.
export const SYNC_DEBOUNCE_MS = 1500;
