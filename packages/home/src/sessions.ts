// The app's way in (PLAN 2.4). A page in a browser cannot read home.json, where the door's token
// is, and must never be handed it. So the home prints a one-time pairing link for this machine
// (`pnpm start`); opening it trades its code for a session, kept in a cookie the page's scripts
// cannot read (HttpOnly) and the browser sends only to the home's own pages (SameSite=Strict).
// A change made with a session also needs a header no other site's page can add without the
// home's leave (`x-orbs`), so a page elsewhere cannot act through the person's browser.
// Remote devices, passkeys and revoking a phone are 2.7's.
import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "./clock.ts";

const CODE_MS = 5 * 60_000;
const SESSION_MS = 30 * 24 * 3600_000;
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");

export class Sessions {
  readonly #codes = new Map<string, number>(); // the code's hash → when it lapses
  readonly #live = new Map<string, number>(); // the session's hash → when it lapses
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** A code for one pairing link, good once, for five minutes. */
  code(): string {
    const c = randomBytes(18).toString("base64url");
    this.#codes.set(hash(c), this.#clock.now() + CODE_MS);
    return c;
  }

  /** Trades a code for a session (null: a code unknown, used or lapsed). */
  redeem(code: string): string | null {
    const h = hash(code);
    const until = this.#codes.get(h);
    this.#codes.delete(h); // good once, right or wrong
    if (until === undefined || until < this.#clock.now()) return null;
    const id = randomBytes(32).toString("base64url");
    this.#live.set(hash(id), this.#clock.now() + SESSION_MS);
    return id;
  }

  valid(id: string | null | undefined): boolean {
    if (!id) return false;
    const until = this.#live.get(hash(id));
    if (until === undefined) return false;
    if (until < this.#clock.now()) {
      this.#live.delete(hash(id));
      return false;
    }
    return true;
  }

  end(id: string): void {
    this.#live.delete(hash(id));
  }
}

export const SESSION_COOKIE = "orbs_session";
export const cookieOf = (header: string | undefined, name: string): string | null => {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
};
