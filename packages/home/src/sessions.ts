// The app's way in (PLAN 2.4, 2.7). A page in a browser cannot read home.json, where the door's
// token is, and must never be handed it. So the home gives a one-time pairing link (`pnpm start`
// prints one; a paired device can ask for another, for a phone, as a QR code); opening it trades
// its code for a session, kept in a cookie the page's scripts cannot read (HttpOnly) and the
// browser sends only to the home's own pages (SameSite=Strict). A passkey (passkeys.ts) is the
// other way to a session, from any device. A change made with a session also needs a header no
// other site's page can add (`x-orbs`), so a page elsewhere cannot act through the person's browser.
//
// Every session is a device in the database: listed, and revocable, a revoked one locked out at
// its very next request. Only a hash of its token is kept.
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";

const CODE_MS = 5 * 60_000;
export const SESSION_MS = 30 * 24 * 3600_000;
/** How often a device's "last seen" is written (a request a second would write a second). */
const SEEN_EVERY_MS = 60_000;
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");

export type Device = { id: number; name: string; via: "pair" | "passkey"; createdAt: number; seenAt: number; expiresAt: number };
type Row = { id: number; name: string; via: "pair" | "passkey"; created_at: number; seen_at: number; expires_at: number; revoked_at: number | null };

export class Sessions {
  readonly #codes = new Map<string, number>(); // the code's hash → when it lapses
  readonly #db: DatabaseSync;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  /** A code for one pairing link, good once, for five minutes. */
  code(): string {
    const c = randomBytes(18).toString("base64url");
    this.#codes.set(hash(c), this.#clock.now() + CODE_MS);
    return c;
  }

  /** Trades a code for a session (null: a code unknown, used or lapsed). */
  redeem(code: string, name = "a browser"): string | null {
    const h = hash(code);
    const until = this.#codes.get(h);
    this.#codes.delete(h); // good once, right or wrong
    if (until === undefined || until < this.#clock.now()) return null;
    return this.open(name, "pair");
  }

  /** A new session for a device (a pairing link redeemed, a passkey signed with). */
  open(name: string, via: Device["via"]): string {
    const id = randomBytes(32).toString("base64url");
    const now = this.#clock.now();
    this.#db
      .prepare("INSERT INTO devices (token_hash, name, via, created_at, seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(hash(id), name.slice(0, 80) || "a browser", via, now, now, now + SESSION_MS);
    return id;
  }

  /** The device a session token belongs to, if it is live (not lapsed, not revoked). */
  device(token: string | null | undefined): Device | null {
    if (!token) return null;
    const r = this.#db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hash(token)) as Row | undefined;
    const now = this.#clock.now();
    if (!r || r.revoked_at !== null || r.expires_at < now) return null;
    if (now - r.seen_at >= SEEN_EVERY_MS) this.#db.prepare("UPDATE devices SET seen_at = ? WHERE id = ?").run(now, r.id);
    return toDevice({ ...r, seen_at: now - r.seen_at >= SEEN_EVERY_MS ? now : r.seen_at });
  }

  valid(token: string | null | undefined): boolean {
    return this.device(token) !== null;
  }

  /** Signs a session out (its own device). */
  end(token: string): void {
    this.#db.prepare("UPDATE devices SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(this.#clock.now(), hash(token));
  }

  /** Every device signed in now, newest first. */
  list(): Device[] {
    const rows = this.#db.prepare("SELECT * FROM devices WHERE revoked_at IS NULL AND expires_at >= ? ORDER BY created_at DESC, id DESC").all(this.#clock.now()) as Row[];
    return rows.map(toDevice);
  }

  /** Locks a device out: its next request is refused. */
  revoke(id: number): void {
    const r = this.#db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(this.#clock.now(), id);
    if (!Number(r.changes)) throw new Error(`no device ${id} signed in`);
  }
}

const toDevice = (r: Row): Device => ({ id: r.id, name: r.name, via: r.via, createdAt: r.created_at, seenAt: r.seen_at, expiresAt: r.expires_at });

export const SESSION_COOKIE = "orbs_session";
export const cookieOf = (header: string | undefined, name: string): string | null => {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
};

/** A device's name from its browser's own words ("Chrome on Android"), for the list. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}
