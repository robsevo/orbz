// Your Google and Microsoft accounts (PLAN 4.2, owner 10-02: "the option for the user to add their
// teams or slack calendar, or simply gmail or outlook"). Both providers now take only OAuth for mail:
// Outlook.com ended passwords and app passwords for IMAP on 2024-09-16, and Google ended password-only
// IMAP and CalDAV for Workspace on 2025-03-14. So an account is connected by its own sign-in, from the
// home straight to the provider (nobody in between): a loopback listener on this machine, PKCE, and
// the browser. One sign-in gives the mail (IMAP with the token, XOAUTH2: read and drafted, never sent)
// and the calendar (Google Calendar, or Microsoft Graph, where Teams meetings are: read only).
// Teams and Slack keep no calendar of their own: Teams' is the Microsoft one, and Slack shows the
// Google or Microsoft calendar it is linked to.
//
// The refresh token goes to the keychain (`account:<name>:refresh`), never a file, the log or a
// trace. Each provider needs an app registered with it (its client id); until the home has one,
// connecting says so (`providers()`), see docs/accounts.md.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { EventLog } from "../events.ts";
import type { SecretStore } from "../chatgpt/store.ts";
import type { IcsEvent } from "./ics.ts";

export type ProviderId = "google" | "microsoft";
export type Endpoints = { authorize: string; token: string; api: string; imap: { host: string; port: number; tls?: boolean } };
export type Provider = {
  id: ProviderId;
  title: string;
  /** What one sign-in connects, in a few words. */
  what: string;
  endpoints: Endpoints;
  /** The scopes asked for at sign-in (Microsoft: consent for both resources at once). */
  scopes: string[];
  /** The scopes of the token the mail is read with, and of the one the calendar is read with. */
  mailScope: string;
  calendarScope: string;
  /** Where the browser comes back to (Microsoft matches localhost on any port; Google 127.0.0.1). */
  loopback: "127.0.0.1" | "localhost";
  extra: Record<string, string>;
};

export const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    id: "google", title: "Google", what: "Gmail and Google Calendar",
    endpoints: { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", api: "https://www.googleapis.com", imap: { host: "imap.gmail.com", port: 993 } },
    scopes: ["openid", "email", "https://mail.google.com/", "https://www.googleapis.com/auth/calendar.readonly"],
    mailScope: "https://mail.google.com/", calendarScope: "https://www.googleapis.com/auth/calendar.readonly",
    loopback: "127.0.0.1",
    extra: { access_type: "offline", prompt: "consent" }, // a refresh token every time
  },
  microsoft: {
    id: "microsoft", title: "Microsoft", what: "Outlook mail and your Outlook and Teams calendar",
    endpoints: { authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", api: "https://graph.microsoft.com", imap: { host: "outlook.office365.com", port: 993 } },
    scopes: ["openid", "email", "offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://graph.microsoft.com/Calendars.Read"],
    // one resource a token: the mail's from outlook.office.com, the calendar's from Graph, both off one refresh token
    mailScope: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access", calendarScope: "https://graph.microsoft.com/Calendars.Read offline_access",
    loopback: "localhost",
    extra: { prompt: "select_account" },
  },
};

/** How long the browser has to finish a sign-in, and how long a provider may take to answer. */
export const SIGN_IN_MS = 10 * 60_000;
export const CALL_MS = 20_000;
export class AccountError extends Error {}

export type Client = { id: string; secret?: string };
export type Account = { provider: ProviderId; email: string };
export type AccountsOptions = {
  dataDir: string;
  events: EventLog;
  store: () => Promise<SecretStore>;
  now: () => number;
  /** The apps registered with each provider (else `<data>/oauth-clients.json`, else ORBS_GOOGLE_CLIENT_ID, …). */
  clients?: Partial<Record<ProviderId, Client>>;
  /** Tests point the providers at stand-ins. */
  endpoints?: Partial<Record<ProviderId, Partial<Endpoints>>>;
  signInMs?: number;
};

const b64url = (b: Buffer): string => b.toString("base64url");
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export class Accounts {
  readonly #o: AccountsOptions;
  #signIn: { server: Server; cancel: (why: string) => void } | null = null;
  readonly #tokens = new Map<string, { token: string; until: number }>();

  constructor(o: AccountsOptions) {
    this.#o = o;
  }

  get #file(): string {
    return join(this.#o.dataDir, "accounts.json");
  }

  provider(id: ProviderId): Provider {
    const p = PROVIDERS[id];
    return { ...p, endpoints: { ...p.endpoints, ...this.#o.endpoints?.[id] } };
  }

  /** The app registered with a provider, if the home has one. */
  client(id: ProviderId): Client | null {
    const given = this.#o.clients?.[id];
    if (given?.id) return given;
    const file = join(this.#o.dataDir, "oauth-clients.json");
    if (existsSync(file)) {
      try {
        const c = (JSON.parse(readFileSync(file, "utf8")) as Partial<Record<ProviderId, Client>>)[id];
        if (c?.id) return c;
      } catch {
        // unreadable: as if there were none
      }
    }
    const env = id === "google" ? { id: process.env.ORBS_GOOGLE_CLIENT_ID, secret: process.env.ORBS_GOOGLE_CLIENT_SECRET } : { id: process.env.ORBS_MICROSOFT_CLIENT_ID };
    return env.id ? { id: env.id, ...(env.secret && { secret: env.secret }) } : null;
  }

  /** Each provider: whether this home can connect to it, and why not. */
  providers(): { id: ProviderId; title: string; what: string; ready: boolean; why: string | null }[] {
    return (Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
      const ready = this.client(id) !== null;
      return { id, title: PROVIDERS[id].title, what: PROVIDERS[id].what, ready, why: ready ? null : `this home has no ${PROVIDERS[id].title} app registered yet (docs/accounts.md)` };
    });
  }

  list(): Record<string, Account> {
    if (!existsSync(this.#file)) return {};
    try {
      return (JSON.parse(readFileSync(this.#file, "utf8")) as { accounts?: Record<string, Account> }).accounts ?? {};
    } catch {
      return {};
    }
  }

  #save(accounts: Record<string, Account>): void {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ accounts }, null, 1)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  /** Starts a sign-in: the address to open in the browser, and the account once it comes back. */
  async connect(id: ProviderId, name: string): Promise<{ url: string; done: Promise<{ name: string; account: Account }> }> {
    if (!NAME.test(name)) throw new AccountError("an account's name is lowercase letters, digits, - and _ (up to 32)");
    const client = this.client(id);
    const p = this.provider(id);
    if (!client) throw new AccountError(`this home has no ${p.title} app registered yet (docs/accounts.md)`);
    this.#signIn?.cancel("another sign-in was started");
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(24));
    let settle!: { ok: (a: { name: string; account: Account }) => void; fail: (e: Error) => void };
    const done = new Promise<{ name: string; account: Account }>((ok, fail) => (settle = { ok, fail }));
    done.catch(() => {}); // a caller that never awaits it must not crash the home
    let finished = false;
    let redirectUri = "";
    const finish = (e: Error | null, got?: { name: string; account: Account }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      setTimeout(() => server.closeAllConnections(), 2000).unref();
      if (this.#signIn?.server === server) this.#signIn = null;
      if (e) {
        this.#o.events.append("account.connect_failed", { provider: id, why: e.message });
        settle.fail(e);
      } else settle.ok(got!);
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback") return void res.writeHead(404).end();
      const page = (code: number, title: string, body: string): void => {
        res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", connection: "close" });
        res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;margin:4em auto;max-width:32em"><h1 style="font-size:1.3em">${esc(title)}</h1><p>${esc(body)}</p>`);
      };
      const q = url.searchParams;
      if (q.get("state") !== state) {
        page(400, "This is not the sign-in Orbz started", "Go back to Orbz and connect the account again.");
        return finish(new AccountError("the sign-in came back with a state this sign-in did not send"));
      }
      if (q.get("error")) {
        page(400, `${p.title} is not connected`, `${p.title} said: ${q.get("error_description") ?? q.get("error")}`);
        return finish(new AccountError(`${p.title} did not connect the account (${q.get("error")})`));
      }
      const code = q.get("code");
      if (!code) {
        page(400, `${p.title} is not connected`, "The sign-in came back without what Orbz needs. Try again.");
        return finish(new AccountError("the sign-in brought back no code"));
      }
      void (async () => {
        try {
          const t = await this.#tokenCall(p, client, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, scope: p.mailScope });
          if (!t.refresh_token) throw new AccountError(`${p.title} gave no refresh token, so the account could not stay connected`);
          const email = emailOf(t.id_token, client.id);
          if (!email) throw new AccountError(`${p.title} did not say which account this is`);
          await (await this.#o.store()).set(`account:${name}:refresh`, t.refresh_token);
          this.#tokens.set(`${name}|mail`, { token: t.access_token, until: this.#o.now() + (t.expires_in ?? 3600) * 1000 });
          const account: Account = { provider: id, email };
          this.#save({ ...this.list(), [name]: account });
          this.#o.events.append("account.connected", { name, provider: id }); // never the address or a token
          page(200, `${p.title} is connected`, "You can close this tab and go back to Orbz.");
          finish(null, { name, account });
        } catch (e) {
          page(400, `${p.title} is not connected`, e instanceof Error ? e.message : String(e));
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, p.loopback, () => ok()); // up before the browser is sent anywhere
    });
    const addr = server.address();
    redirectUri = `http://${p.loopback}:${typeof addr === "object" && addr ? addr.port : 0}/callback`;
    const timer = setTimeout(() => finish(new AccountError("the sign-in was not finished in time")), this.#o.signInMs ?? SIGN_IN_MS);
    timer.unref();
    this.#signIn = { server, cancel: (why) => finish(new AccountError(why)) };
    const u = new URL(p.endpoints.authorize);
    for (const [k, v] of Object.entries({ client_id: client.id, response_type: "code", redirect_uri: redirectUri, scope: p.scopes.join(" "), state, code_challenge: challenge, code_challenge_method: "S256", ...p.extra })) u.searchParams.set(k, v);
    this.#o.events.append("account.connect_started", { provider: id });
    return { url: u.toString(), done };
  }

  async #tokenCall(p: Provider, client: Client, form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }> {
    const body = new URLSearchParams({ client_id: client.id, ...(client.secret && { client_secret: client.secret }), ...form });
    let res: Response;
    try {
      res = await fetch(p.endpoints.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, signal: AbortSignal.timeout(CALL_MS) });
    } catch (e) {
      throw new AccountError(`${p.title} could not be reached: ${e instanceof Error ? e.message : String(e)}`);
    }
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof j.access_token !== "string") {
      throw new AccountError(`${p.title} refused: ${String(j.error_description ?? j.error ?? `HTTP ${res.status}`).slice(0, 200)}`);
    }
    return j as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };
  }

  /** A token for an account's mail or calendar: kept while it lasts, else from its refresh token. */
  async token(name: string, use: "mail" | "calendar"): Promise<string> {
    const a = this.list()[name];
    if (!a) throw new AccountError(`no account "${name}"`);
    const kept = this.#tokens.get(`${name}|${use}`);
    if (kept && kept.until - 60_000 > this.#o.now()) return kept.token;
    const client = this.client(a.provider);
    const p = this.provider(a.provider);
    if (!client) throw new AccountError(`this home has no ${p.title} app registered any more`);
    const store = await this.#o.store();
    const refresh = await store.get(`account:${name}:refresh`);
    if (!refresh) throw new AccountError(`${a.email} needs connecting again`);
    const t = await this.#tokenCall(p, client, { grant_type: "refresh_token", refresh_token: refresh, scope: use === "mail" ? p.mailScope : p.calendarScope });
    if (t.refresh_token && t.refresh_token !== refresh) await store.set(`account:${name}:refresh`, t.refresh_token); // Microsoft rolls it
    this.#tokens.set(`${name}|${use}`, { token: t.access_token, until: this.#o.now() + (t.expires_in ?? 3600) * 1000 });
    return t.access_token;
  }

  async remove(name: string): Promise<void> {
    const all = this.list();
    if (!all[name]) throw new AccountError(`no account "${name}"`);
    delete all[name];
    this.#save(all);
    for (const k of [...this.#tokens.keys()]) if (k.startsWith(`${name}|`)) this.#tokens.delete(k);
    await (await this.#o.store()).delete(`account:${name}:refresh`);
    this.#o.events.append("account.removed", { name });
  }

  /** An account's calendar events in [from, to), every calendar it shows, as the ICS reader gives them. */
  async events(name: string, from: number, to: number): Promise<IcsEvent[]> {
    const a = this.list()[name];
    if (!a) throw new AccountError(`no account "${name}"`);
    const token = await this.token(name, "calendar");
    const p = this.provider(a.provider);
    return a.provider === "google" ? googleEvents(p, token, from, to) : graphEvents(p, token, from, to);
  }

  close(): void {
    this.#signIn?.cancel("the home is closing");
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The account's address from the ID token the token endpoint gave us directly (over TLS, so the
 * issuer is the one we called, OpenID Connect 3.1.3.7), checked to be ours. */
function emailOf(idToken: string | undefined, clientId: string): string | null {
  if (!idToken) return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    if (claims.aud !== clientId) return null;
    const email = claims.email ?? claims.preferred_username;
    return typeof email === "string" && email.includes("@") ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function getJson(url: string, token: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json", ...headers }, signal: AbortSignal.timeout(CALL_MS) });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AccountError(`the calendar answered ${res.status}: ${String((j.error as { message?: string } | undefined)?.message ?? "").slice(0, 160)}`);
  return j;
}

/** At most this many pages of a calendar are read at once. */
const PAGES = 10;

/** Google Calendar: every calendar the account shows (selected in Google), its times worked out by Google. */
async function googleEvents(p: Provider, token: string, from: number, to: number): Promise<IcsEvent[]> {
  const list = await getJson(`${p.endpoints.api}/calendar/v3/users/me/calendarList?minAccessRole=reader`, token);
  const cals = ((list.items ?? []) as { id: string; selected?: boolean; primary?: boolean }[]).filter((c) => c.selected || c.primary);
  const out: IcsEvent[] = [];
  for (const c of cals) {
    let page: string | undefined;
    for (let n = 0; n < PAGES; n++) {
      const u = new URL(`${p.endpoints.api}/calendar/v3/calendars/${encodeURIComponent(c.id)}/events`);
      for (const [k, v] of Object.entries({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(page && { pageToken: page }) })) u.searchParams.set(k, v);
      const j = await getJson(u.toString(), token);
      for (const e of (j.items ?? []) as { id: string; status?: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[]) {
        if (e.status === "cancelled" || !e.start) continue;
        const allDay = !e.start.dateTime;
        const start = allDay ? localDay(e.start.date!) : Date.parse(e.start.dateTime!);
        const end = e.end ? (allDay ? localDay(e.end.date!) : Date.parse(e.end.dateTime!)) : start;
        out.push({ uid: e.id, title: e.summary ?? "(no title)", start, end, allDay, location: e.location ?? null });
      }
      page = typeof j.nextPageToken === "string" ? j.nextPageToken : undefined;
      if (!page) break;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Microsoft Graph's calendar view (Outlook's calendar, and Teams' meetings in it), in UTC. */
async function graphEvents(p: Provider, token: string, from: number, to: number): Promise<IcsEvent[]> {
  const out: IcsEvent[] = [];
  const u = new URL(`${p.endpoints.api}/v1.0/me/calendarView`);
  for (const [k, v] of Object.entries({ startDateTime: new Date(from).toISOString(), endDateTime: new Date(to).toISOString(), $select: "id,subject,start,end,location,isAllDay,isCancelled", $top: "200" })) u.searchParams.set(k, v);
  let next: string | undefined = u.toString();
  for (let n = 0; next && n < PAGES; n++) {
    const j = await getJson(next, token, { prefer: 'outlook.timezone="UTC"' });
    for (const e of (j.value ?? []) as { id: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean; location?: { displayName?: string }; start?: { dateTime: string }; end?: { dateTime: string } }[]) {
      if (e.isCancelled || !e.start) continue;
      const utc = (s: string): number => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
      // a day-long event is the day it is on, wherever the home is
      const start = e.isAllDay ? localDay(e.start.dateTime.slice(0, 10)) : utc(e.start.dateTime);
      const end = e.end ? (e.isAllDay ? localDay(e.end.dateTime.slice(0, 10)) : utc(e.end.dateTime)) : start;
      out.push({ uid: e.id, title: e.subject || "(no title)", start, end, allDay: Boolean(e.isAllDay), location: e.location?.displayName || null });
    }
    next = typeof j["@odata.nextLink"] === "string" ? (j["@odata.nextLink"] as string) : undefined;
  }
  return out.sort((a, b) => a.start - b.start);
}

const localDay = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
};
