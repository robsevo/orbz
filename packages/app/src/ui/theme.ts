// The theme you chose (owner, 10-02: "different themes users can use besides light or dark"), kept
// in this browser: a device's look is its own. Nothing chosen yet wears Midnight (owner, 10-06: "make
// midnight the app default"); choosing System follows the device's light or dark, and is kept as such.
import { DEFAULT_THEME, THEMES, type ThemeId } from "../design/tokens.ts";

const KEY = "orbs.theme";
const SYSTEM = "system";

/** The theme to wear: the one chosen here, null for System, Midnight when none was ever chosen. */
export function savedTheme(): ThemeId | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY) ?? null;
    if (v === SYSTEM) return null;
    return v !== null && v in THEMES ? (v as ThemeId) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // a private window: the app's own
  }
}

/** Wears a theme now (none: the system's), and keeps it for the next open. */
export function applyTheme(t: ThemeId | null, keep = true): void {
  const root = globalThis.document?.documentElement;
  if (root) {
    if (t) root.dataset.theme = t;
    else delete root.dataset.theme;
  }
  if (!keep) return;
  try {
    globalThis.localStorage?.setItem(KEY, t ?? SYSTEM); // System is a choice too, kept like the others
  } catch {
    // a private window: worn for as long as the page is open
  }
}
