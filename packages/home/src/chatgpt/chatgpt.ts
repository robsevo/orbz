// Continue with ChatGPT (PLAN 1.10): the person's ChatGPT plan as an orb's big brain, the way
// OpenAI lets open-source apps that run locally use it. This holds one connection for the home:
//
//   the host ID     `urn:uuid:…`, made once and kept in <data>/chatgpt-host.json, sent on every
//                   sign-in so each install stays its own registration
//   the sign-in     a loopback listener on 127.0.0.1, then the browser; the callback must bring back
//                   this sign-in's state, and the ID token must pass every check, before anything is kept
//   the tokens      in the OS keychain (store.ts), refreshed before they lapse; never in the event
//                   log, a trace, an API reply or chatgpt-auth.json, which keeps only the registration
//   the limits      a usage limit pauses plan requests (the turn passes to the next brain) until the
//                   person resumes it or an hour has gone by; a refusal of plan use turns it off until
//                   the next sign-in; a lapsed sign-in forgets the tokens and keeps the registration
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { Clock } from "../clock.ts";
import type { EventLog } from "../events.ts";
import type { Endpoint, Limited } from "../brain/openai.ts";
import {
  authorizeUrl, discover, DYNAMIC_CLIENT, exchange, ISSUER, Keys, newHostId, pkce, randomToken, REAUTH_CODES, refresh, RESOURCE,
  revoke, SHARING_SCOPE, SignInError, verifyIdToken, type Discovery,
} from "./oauth.ts";
import { defaultStore, type SecretStore } from "./store.ts";

export const MANAGE_USAGE = "https://chatgpt.com/settings/usage";

export type ChatGPTOptions = {
  dataDir: string;
  events: EventLog;
  clock: Clock;
  /** Where the tokens go. Default: the OS keychain, else a file only the owner can read. */
  store?: SecretStore;
  issuer?: string;
  apiBase?: string;
  /** Sent as `agent_name_hint`: what the person sees on ChatGPT's consent screen. */
  appName?: string;
  signInTimeoutMs?: number;
  /** How long a usage limit pauses plan requests before they are tried again. */
  pauseMs?: number;
};

export type PlanModel = { slug: string; name: string };

type Registration = {
  clientId: string | null;
  account: { sub: string; email: string | null; name: string | null } | null;
  sharing: boolean;
  model: string | null;
  models: PlanModel[];
};

type Saved = { accessToken: string; refreshToken: string | null; expiresAt: number };

export type ChatGPTStatus = {
  connected: boolean;
  account: { email: string | null; name: string | null } | null;
  /** ChatGPT granted plan use (`chatgpt.tokens.use.direct`). */
  sharing: boolean;
  model: string | null;
  models: PlanModel[];
  paused: { until: number; why: Limited } | null;
  signingIn: boolean;
  store: SecretStore["kind"] | null;
  manageUsage: string;
};

const EMPTY: Registration = { clientId: null, account: null, sharing: false, model: null, models: [] };

export class ChatGPT {
  readonly #o: Required<Omit<ChatGPTOptions, "store">> & { store: SecretStore | null };
  readonly #hostFile: string;
  readonly #regFile: string;
  #reg: Registration;
  #connected = false;
  #paused: { until: number; why: Limited } | null = null;
  #storeP: Promise<SecretStore> | null = null;
  #discovery: Promise<Discovery> | null = null;
  #keys: Keys | null = null;
  #refreshing: Promise<string> | null = null;
  #signIn: { server: Server; cancel: (why: string) => void } | null = null;

  constructor(o: ChatGPTOptions) {
    this.#o = {
      issuer: ISSUER, apiBase: RESOURCE, appName: "Orbz", signInTimeoutMs: 10 * 60_000, pauseMs: 60 * 60_000,
      ...o, store: o.store ?? null,
    };
    this.#hostFile = join(o.dataDir, "chatgpt-host.json");
    this.#regFile = join(o.dataDir, "chatgpt-auth.json");
    this.#reg = this.#readReg();
  }

  #store(): Promise<SecretStore> {
    this.#storeP ??= this.#o.store ? Promise.resolve(this.#o.store) : defaultStore(this.#o.dataDir);
    return this.#storeP;
  }

  #disco(): Promise<Discovery> {
    this.#discovery ??= discover(this.#o.issuer).catch((e: unknown) => {
      this.#discovery = null; // a failed lookup is tried again next time
      throw e;
    });
    return this.#discovery;
  }

  /** This install's host ID, made on first use and kept for good. */
  hostId(): string {
    try {
      const v = (JSON.parse(readFileSync(this.#hostFile, "utf8")) as { hostId?: unknown }).hostId;
      if (typeof v === "string" && v.startsWith("urn:uuid:")) return v;
    } catch {
      // not made yet
    }
    const id = newHostId();
    writeAtomic(this.#hostFile, JSON.stringify({ hostId: id }, null, 1));
    return id;
  }

  #readReg(): Registration {
    try {
      return { ...EMPTY, ...(JSON.parse(readFileSync(this.#regFile, "utf8")) as Partial<Registration>) };
    } catch {
      return { ...EMPTY };
    }
  }

  #saveReg(): void {
    writeAtomic(this.#regFile, JSON.stringify(this.#reg, null, 1));
  }

  #key(): string {
    return `chatgpt:${this.hostId()}`;
  }

  async #saved(): Promise<Saved | null> {
    const raw = await (await this.#store()).get(this.#key());
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Saved;
    } catch {
      return null;
    }
  }

  async #save(t: Saved): Promise<void> {
    await (await this.#store()).set(this.#key(), JSON.stringify(t));
    this.#connected = true;
  }

  /** Reads whether this home is signed in (the tokens are in the store). Call once at start. A home
   * that never registered does not touch the keychain at all. */
  async load(): Promise<ChatGPTStatus> {
    this.#connected = this.#reg.clientId !== null && (await this.#saved()) !== null;
    return this.status();
  }

  async status(): Promise<ChatGPTStatus> {
    const paused = this.#paused && this.#paused.until > this.#o.clock.now() ? this.#paused : null;
    return {
      connected: this.#connected,
      account: this.#connected && this.#reg.account ? { email: this.#reg.account.email, name: this.#reg.account.name } : null,
      sharing: this.#connected && this.#reg.sharing,
      model: this.#reg.model,
      models: this.#reg.models,
      paused,
      signingIn: this.#signIn !== null,
      store: this.#storeP ? (await this.#storeP).kind : this.#o.store?.kind ?? null,
      manageUsage: MANAGE_USAGE,
    };
  }

  /** Starts a sign-in: the URL to open in the browser, and the sign-in's outcome. A sign-in still
   * open is cancelled first. Nothing is kept unless every check passes. */
  async begin(): Promise<{ url: string; done: Promise<ChatGPTStatus> }> {
    this.#signIn?.cancel("a new sign-in was started");
    const d = await this.#disco();
    const hostId = this.hostId();
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = pkce();
    const sent = this.#reg.clientId ?? DYNAMIC_CLIENT;
    let settle!: { ok: (s: ChatGPTStatus) => void; fail: (e: Error) => void };
    const done = new Promise<ChatGPTStatus>((ok, fail) => (settle = { ok, fail }));
    done.catch(() => {}); // a caller that never awaits it must not crash the home
    let redirectUri = "";
    let finished = false;
    const finish = (e: Error | null, status?: ChatGPTStatus): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      // the page goes out with `connection: close`; anything still open after that is cut
      server.close();
      setTimeout(() => server.closeAllConnections(), 2000).unref();
      if (this.#signIn?.server === server) this.#signIn = null;
      if (e) {
        this.#o.events.append("chatgpt.sign_in_failed", { why: e.message });
        settle.fail(e);
      } else settle.ok(status!);
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const q = url.searchParams;
      const page = (code: number, title: string, body: string): void => {
        res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", connection: "close" });
        res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;margin:4em auto;max-width:32em"><h1 style="font-size:1.3em">${esc(title)}</h1><p>${esc(body)}</p>`);
      };
      if (q.get("state") !== state) {
        page(400, "This sign-in is not the one Orbz started", "Go back to Orbz and choose Continue with ChatGPT again.");
        finish(new SignInError("the sign-in came back with a state this sign-in did not send"));
        return;
      }
      if (q.get("error")) {
        page(400, "Orbz is not signed in", `ChatGPT said: ${q.get("error_description") ?? q.get("error")}`);
        finish(new SignInError(`ChatGPT did not sign you in (${q.get("error")})`, q.get("error")));
        return;
      }
      const code = q.get("code");
      const issued = q.get("client_id") ?? this.#reg.clientId;
      if (!code || !issued || issued === DYNAMIC_CLIENT) {
        page(400, "Orbz is not signed in", "The sign-in came back without what Orbz needs. Try again.");
        finish(new SignInError(code ? "the sign-in issued no client ID" : "the sign-in brought back no code"));
        return;
      }
      void (async () => {
        try {
          const t = await exchange(d, { clientId: issued, code, verifier, redirectUri });
          if (!t.idToken) throw new SignInError("the sign-in server sent no ID token");
          this.#keys ??= new Keys(d.jwksUri);
          const who = await verifyIdToken(t.idToken, { issuer: this.#o.issuer, audience: issued, nonce, keys: this.#keys, nowMs: this.#o.clock.now() });
          const sharing = t.scope.split(/\s+/).includes(SHARING_SCOPE);
          await this.#save({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: this.#o.clock.now() + t.expiresIn * 1000 });
          this.#reg = { ...this.#reg, clientId: issued, account: who, sharing };
          this.#paused = null;
          if (sharing) await this.#refreshModels(t.accessToken);
          this.#saveReg();
          this.#o.events.append("chatgpt.connected", { email: who.email, sharing, model: this.#reg.model });
          page(200, sharing ? "You're using your ChatGPT plan" : "Signed in to ChatGPT", sharing ? "You can close this tab and go back to Orbz." : "ChatGPT did not allow plan use for this account, so Orbz will use its other brain. You can close this tab.");
          finish(null, await this.status());
        } catch (e) {
          page(400, "Orbz is not signed in", (e as Error).message);
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    });
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => ok()); // the listener is up before the browser is sent anywhere
    });
    const addr = server.address();
    redirectUri = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/callback`;
    const timer = setTimeout(() => finish(new SignInError("the sign-in was not finished in time")), this.#o.signInTimeoutMs);
    this.#signIn = { server, cancel: (why) => finish(new SignInError(why)) };
    this.#o.events.append("chatgpt.sign_in_started", { client: sent === DYNAMIC_CLIENT ? "new registration" : "saved registration" });
    return { url: authorizeUrl(d, { clientId: sent, redirectUri, state, nonce, challenge, appName: this.#o.appName, hostId }), done };
  }

  async #refreshModels(token: string): Promise<void> {
    try {
      const res = await fetch(`${this.#o.apiBase.replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return;
      const j = (await res.json()) as { models?: unknown; data?: unknown };
      const list = (Array.isArray(j.models) ? j.models : Array.isArray(j.data) ? j.data : []) as { slug?: unknown; id?: unknown; display_name?: unknown; visibility?: unknown }[];
      const models = list
        .filter((m) => m.visibility === undefined || m.visibility === "list")
        .map((m) => ({ slug: String(m.slug ?? m.id ?? ""), name: String(m.display_name ?? m.slug ?? m.id ?? "") }))
        .filter((m) => m.slug);
      this.#reg.models = models;
      if (!this.#reg.model || !models.some((m) => m.slug === this.#reg.model)) this.#reg.model = models[0]?.slug ?? null;
    } catch {
      // the models stay as they were; the status shows none if there never were any
    }
  }

  /** A valid access token: the saved one, or a refreshed one when it is about to lapse. */
  async accessToken(): Promise<string> {
    const t = await this.#saved();
    if (!t) throw new SignInError("not signed in to ChatGPT");
    if (t.expiresAt - 60_000 > this.#o.clock.now()) return t.accessToken;
    if (!t.refreshToken || !this.#reg.clientId) {
      await this.#forget("the sign-in expired");
      throw new SignInError("the ChatGPT sign-in expired");
    }
    const clientId = this.#reg.clientId;
    const refreshToken = t.refreshToken;
    this.#refreshing ??= (async () => {
      try {
        const n = await refresh(await this.#disco(), { clientId, refreshToken });
        await this.#save({ accessToken: n.accessToken, refreshToken: n.refreshToken ?? refreshToken, expiresAt: this.#o.clock.now() + n.expiresIn * 1000 });
        return n.accessToken;
      } catch (e) {
        if (e instanceof SignInError && e.code && REAUTH_CODES.has(e.code)) await this.#forget(`the sign-in lapsed (${e.code})`);
        throw e;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }

  async #forget(why: string): Promise<void> {
    await (await this.#store()).delete(this.#key());
    this.#connected = false;
    this.#o.events.append("chatgpt.signed_out", { why });
  }

  /** The plan could not serve a request: pause it, turn it off, or forget the sign-in. */
  async limited(why: Limited): Promise<void> {
    if (why === "usage-limit") {
      this.#paused = { until: this.#o.clock.now() + this.#o.pauseMs, why };
      this.#o.events.append("chatgpt.limited", { why, until: this.#paused.until });
    } else if (why === "not-eligible") {
      this.#reg.sharing = false;
      this.#saveReg();
      this.#o.events.append("chatgpt.limited", { why });
    } else if (this.#connected) await this.#forget("ChatGPT no longer accepts this sign-in");
  }

  resume(): void {
    this.#paused = null;
    this.#o.events.append("chatgpt.resumed", {});
  }

  /** Forgets the tokens here and asks ChatGPT to revoke them. The registration stays, so signing in
   * again is the same app, not a new one. */
  async signOut(): Promise<void> {
    const t = await this.#saved();
    if (t?.refreshToken && this.#reg.clientId) {
      try {
        await revoke(await this.#disco(), { clientId: this.#reg.clientId, token: t.refreshToken });
      } catch {
        // forgotten here all the same
      }
    }
    await this.#forget("you signed out");
  }

  setModel(slug: string): void {
    if (!this.#reg.models.some((m) => m.slug === slug)) throw new Error(`your ChatGPT plan lists no model ${slug}`);
    this.#reg.model = slug;
    this.#saveReg();
  }

  /** The plan as a brain, when it can serve now: signed in, plan use granted, a model, not paused. */
  endpoint(): Endpoint | null {
    if (!this.#connected || !this.#reg.sharing || !this.#reg.model) return null;
    if (this.#paused && this.#paused.until > this.#o.clock.now()) return null;
    return {
      name: "chatgpt",
      api: "responses",
      baseUrl: this.#o.apiBase,
      model: this.#reg.model,
      plan: "chatgpt",
      price: { inputPerM: 0, outputPerM: 0 }, // the plan pays: nothing comes out of the spend cap
      retries: 0,
      token: () => this.accessToken(),
    };
  }

  close(): void {
    this.#signIn?.cancel("the home is stopping");
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
