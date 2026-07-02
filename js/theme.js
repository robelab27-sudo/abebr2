// ============================================================================
// Theme engine: applies the user's saved theme + accent color as CSS custom
// property overrides on <html>. Called on every page (right after auth
// resolves) so the choice made in Settings is reflected everywhere, not just
// on the Settings page itself.
// ============================================================================

import { getLocalSettings } from './repositories/settings.js';

export function applyTheme(settings = {}) {
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');

  const accent = settings.accent_color;
  if (accent) {
    root.style.setProperty('--mint', accent);
    root.style.setProperty('--mint-dim', `color-mix(in srgb, ${accent} 14%, transparent)`);
  } else {
    root.style.removeProperty('--mint');
    root.style.removeProperty('--mint-dim');
  }
}

/** Convenience: load this user's saved settings from local DB and apply them. */
export async function applyThemeForUser(userId) {
  if (!userId) return null;
  const settings = await getLocalSettings(userId);
  applyTheme(settings);
  return settings;
}
