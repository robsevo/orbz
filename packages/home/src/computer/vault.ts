// The vault (PLAN 4.1): the passwords you save for your orbs' browsers, each sealed with
// AES-256-GCM under one key that lives in the keychain (never in a file the home writes). Open
// Dot's idea, in our own code, with three things it does not do:
//
//   a password is typed only into a page whose address IS the one it was saved for: a page on
//     another host asking for "your github.com password" gets nothing, whatever the orb was told
//   each sealed password is bound to its site and username (the AAD), so moving one sealed blob
//     onto another entry in the file makes it unreadable, not someone else's password
//   every word an orb reads from his computer passes `scrub` first, so a page that echoes a
//     password back ("your password is …") hands the model "[a saved password]"
//
// The model never sees a password: only the person adds one (through the door), the orb's
// `sign_in` names a site, and what comes back says whether the fields were filled.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventLog } from "../events.ts";
import type { SecretStore } from "../chatgpt/store.ts";

export class VaultError extends Error {}

/** What an orb reads in place of a saved password. */
export const HIDDEN = "[a saved password]";
const KEY = "vault:key";
const AAD = (site: string, username: string): Buffer => Buffer.from(`orbs-vault:v1\n${site}\n${username}`, "utf8");
/** A password shorter than this is not looked for in what an orb reads: "1234" would hide every
 * fourth number on a page. It is still kept and typed. */
const SCRUB_MIN = 6;

type Sealed = { site: string; username: string; sealed: string; added: number };
export type Entry = { site: string; username: string; added: number };

/** The host a saved password belongs to, from what the person typed: an address or a bare name. */
export function siteOf(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) throw new VaultError("a password is saved for a site: the address of its sign-in page");
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`).hostname;
  } catch {
    throw new VaultError(`"${raw.trim()}" is not a site's address`);
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    throw new VaultError(`"${raw.trim()}" is not a site's address (like github.com, or accounts.google.com)`);
  }
  return host;
}

/** The host of the page an orb is on, as the vault compares it (no "www."). */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return null;
  }
}

export type VaultOptions = { dataDir: string; events: EventLog; store: () => Promise<SecretStore>; now: () => number };

export class Vault {
  readonly #o: VaultOptions;
  /** The key, once read from the keychain: a sign-in does not ask the keychain every time. */
  #key: Buffer | null = null;
  /** The passwords to hide from what an orb reads, opened once per change of the file. */
  #hide: string[] | null = null;

  constructor(o: VaultOptions) {
    this.#o = o;
  }

  get #file(): string {
    return join(this.#o.dataDir, "vault.json");
  }

  #entries(): Sealed[] {
    if (!existsSync(this.#file)) return [];
    try {
      const v = JSON.parse(readFileSync(this.#file, "utf8")) as { entries?: Sealed[] };
      return Array.isArray(v.entries) ? v.entries : [];
    } catch {
      return [];
    }
  }

  #save(entries: Sealed[]): void {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ entries }, null, 1)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#file);
    this.#hide = null;
  }

  /** The key from the keychain; made the first time a password is saved, never otherwise. */
  async #keyOf(make: boolean): Promise<Buffer> {
    if (this.#key) return this.#key;
    const store = await this.#o.store();
    let hex = await store.get(KEY);
    if (!hex && make) {
      hex = randomBytes(32).toString("hex");
      await store.set(KEY, hex);
    }
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
      throw new VaultError(`the vault's key is not in ${store.kind === "keychain" ? "this keychain" : "this home's secret store"}, so its passwords cannot be opened; save them again`);
    }
    this.#key = Buffer.from(hex, "hex");
    return this.#key;
  }

  /** Who has a password saved, and for where. Never the passwords. */
  list(): Entry[] {
    return this.#entries().map(({ site, username, added }) => ({ site, username, added }));
  }

  /** Saves (or replaces) the password for a username on a site. Only the person does this. */
  async add(siteRaw: string, usernameRaw: string, password: string): Promise<Entry> {
    const site = siteOf(siteRaw);
    const username = usernameRaw.trim();
    if (!username) throw new VaultError("a password is saved with the username it goes with");
    if (username.length > 200) throw new VaultError("that username is longer than any site takes");
    if (!password) throw new VaultError("there is no password to save");
    if (password.length > 1000) throw new VaultError("that password is longer than any site takes");
    const key = await this.#keyOf(true);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(AAD(site, username));
    const data = Buffer.concat([c.update(password, "utf8"), c.final()]);
    const sealed = [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
    const added = this.#o.now();
    this.#save([...this.#entries().filter((e) => !(e.site === site && e.username === username)), { site, username, sealed, added }]);
    this.#o.events.append("vault.saved", { site }); // never the username's password, nor the username
    return { site, username, added };
  }

  remove(siteRaw: string, username: string): void {
    const site = siteOf(siteRaw);
    const all = this.#entries();
    const left = all.filter((e) => !(e.site === site && e.username === username.trim()));
    if (left.length === all.length) throw new VaultError(`no password saved for ${username.trim()} on ${site}`);
    this.#save(left);
    this.#o.events.append("vault.removed", { site });
  }

  #open(key: Buffer, e: Sealed): string {
    const [iv, tag, data] = e.sealed.split(".").map((s) => Buffer.from(s, "base64url"));
    if (!iv || !tag || !data) throw new VaultError(`the password for ${e.username} on ${e.site} is damaged; save it again`);
    try {
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAAD(AAD(e.site, e.username));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString("utf8");
    } catch {
      throw new VaultError(`the password for ${e.username} on ${e.site} cannot be opened with this vault's key; save it again`);
    }
  }

  /** The login for the page an orb is on: only a password saved for that page's own host. With
   * two usernames saved there, the orb names one. The password goes to the page, never to him. */
  async loginFor(pageUrl: string, username?: string): Promise<{ site: string; username: string; password: string }> {
    const host = hostOf(pageUrl);
    if (!host) throw new VaultError("a saved password is typed only into a web page (http or https)");
    const here = this.#entries().filter((e) => e.site === host);
    if (!here.length) {
      const sites = [...new Set(this.#entries().map((e) => e.site))];
      throw new VaultError(
        `no password is saved for ${host}${sites.length ? ` (saved: ${sites.join(", ")}; a password is typed only on the site it was saved for)` : ""}. The person can save one in Settings, or take over and sign in themselves.`,
      );
    }
    const pick = username ? here.filter((e) => e.username === username.trim()) : here;
    if (pick.length !== 1) {
      throw new VaultError(
        username
          ? `no password saved for ${username.trim()} on ${host} (saved there: ${here.map((e) => e.username).join(", ")})`
          : `${here.length} usernames are saved for ${host}: ${here.map((e) => e.username).join(", ")}. Say which.`,
      );
    }
    const e = pick[0]!;
    return { site: e.site, username: e.username, password: this.#open(await this.#keyOf(false), e) };
  }

  /** `text` with every saved password taken out, before an orb (or a trace) sees it. */
  async scrub(text: string): Promise<string> {
    if (!this.#entries().length) return text;
    if (!this.#hide) {
      let key: Buffer;
      try {
        key = await this.#keyOf(false);
      } catch {
        return text; // no key: nothing can be opened, so nothing could have been typed
      }
      const opened: string[] = [];
      for (const e of this.#entries()) {
        try {
          opened.push(this.#open(key, e));
        } catch {
          // a damaged entry was never typed either
        }
      }
      // the longest first, so one password inside another is hidden whole
      this.#hide = [...new Set(opened.filter((p) => p.length >= SCRUB_MIN))].sort((a, b) => b.length - a.length);
    }
    let out = text;
    for (const p of this.#hide) {
      for (const form of [p, encodeURIComponent(p), Buffer.from(p, "utf8").toString("base64")]) {
        if (form.length >= SCRUB_MIN && out.includes(form)) out = out.split(form).join(HIDDEN);
      }
    }
    return out;
  }
}
