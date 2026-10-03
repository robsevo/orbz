// The theme you chose (owner, 10-02: "different themes users can use besides light or dark"), kept
// in this browser: a device's look is its own. None chosen follows the system's light or dark.
import { THEMES, type ThemeId } from "../design/tokens.ts";

const KEY = "orbs.theme";

export function savedTheme(): ThemeId | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY) ?? null;
    return v !== null && v in THEMES ? (v as ThemeId) : null;
  } catch {
    return null; // a private window: the system's
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
    if (t) globalThis.localStorage?.setItem(KEY, t);
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // a private window: worn for as long as the page is open
  }
}
