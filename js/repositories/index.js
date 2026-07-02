// ============================================================================
// One Repository instance per synced entity. Pages import from here rather
// than constructing repositories themselves, so the whole app shares the
// same objects (and therefore the same in-memory state where relevant).
// ============================================================================

import { Repository } from './repository.js';

export const tradesRepo = new Repository('trades');
export const journalRepo = new Repository('journal_entries');
export const calendarNotesRepo = new Repository('calendar_notes');
export const goalsRepo = new Repository('goals');
export const screenshotsRepo = new Repository('screenshots');
