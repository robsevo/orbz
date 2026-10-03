// The home's door: a small HTTP API on 127.0.0.1 for the terminal (PLAN 1.9), the app (2.4) and
// anything else on this machine that needs to reach a headless home. The database is locked to
// the home, so this is the only way in. A random port and a random token are written to
// `<data>/home.json`, readable only by the owner. Every request needs the token (or an app
// session), and the Host header must name the loopback address, so a web page can't reach it by
// DNS rebinding.
//
// The person's other devices (PLAN 2.7) come in by a second door, only if the home is given one:
// HTTPS on the box's own names (a domain's certificate, or a private network's), nothing else. It
// answers only to those names (a rebound hostname is refused), never takes the loopback token
// (that stays for local tools), and lets in only a session: a pairing link (a QR code on a phone)
// or a passkey, each a device that can be revoked.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Home } from "./home.ts";
import { UnknownOrbError } from "./inbox.ts";
import { KeyRefusedError } from "./brain/brains.ts";
import { SPECIALTY_FAMILIES, type Specialty } from "./brain/constitution.ts";
import { cookieOf, deviceName, SESSION_COOKIE, SESSION_MS, type Sessions } from "./sessions.ts";
import { PasskeyError, type Where } from "./passkeys.ts";
import { ConnectorError, type Spec } from "./connectors/connectors.ts";
import type { Account } from "./connectors/mail.ts";
import { ImapError } from "./connectors/imap.ts";
import { CalendarError } from "./connectors/calendars.ts";
import { AccountError } from "./connectors/accounts.ts";
import { ComputerError, type Hands, type Screen } from "./computer/browser.ts";
import { VaultError } from "./computer/vault.ts";
import type { Tab } from "./team.ts";
import { standingContext } from "./agent/standing.ts";
import { listWorkspace, MissingError, OutsideError, readWorkspace, saveUpload, UPLOAD_CAP } from "./workspace.ts";
import { calendarOf, spanOf, withEvents } from "./calendar.ts";
import { clashWords, dayOf, owedWords } from "./day.ts";
import { cronFor, preview, RuleError, ruleOf, wordsOf } from "./schedule-rules.ts";
import { cronOf } from "./schedule.ts";
import { labOf, reopen } from "./lab.ts";
import { morningCard } from "./gym/card.ts";
import { levelOf, nextFor, tenureOf } from "./gym/levels.ts";
import { findHotPaths } from "./gym/finder.ts";
import { nichesOf, radarOf } from "./gym/specialty.ts";
import { version } from "./version.ts";

export type HomeDoor = {
  port: number; token: string; file: string; close(): Promise<void>;
  /** A one-time link that opens the app on this machine, paired (PLAN 2.4): good for five minutes. */
  pairLink(): string;
  /** The door for the person's other devices (PLAN 2.7), when it has one: its port, and a pairing
   * link through it (for a phone, as a QR code). */
  remote: { port: number; pairLink(): string } | null;
};

/** The second door (PLAN 2.7): HTTPS on these names only, with this certificate. */
export type Remote = { names: string[]; cert: string | Buffer; key: string | Buffer; port?: number; host?: string };

const BODY_LIMIT = 64 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Where the built app is (`pnpm -C packages/app build`), served at /app/. */
export const APP_DIR = fileURLToPath(new URL("../../app/dist/", import.meta.url));

export async function serve(home: Home, opts: { port?: number; appDir?: string; remote?: Remote } = {}): Promise<HomeDoor> {
  const token = randomBytes(24).toString("base64url");
  const want = Buffer.from(`Bearer ${token}`);
  const sessions = home.sessions;
  const appDir = opts.appDir ?? APP_DIR;
  const names = opts.remote ? opts.remote.names.map((n) => n.toLowerCase()) : null;
  let remotePort = -1;
  const remoteLink = (): string => `https://${names![0]}${remotePort === 443 ? "" : `:${remotePort}`}/app/orbs.html#pair=${sessions.code()}`;
  const handler = (which: () => Server, remote: boolean) => (req: IncomingMessage, res: ServerResponse) => {
    const door = { sessions, appDir, remote: remote ? names : null, pairLink: () => (names ? remoteLink() : localLink()) };
    handle(home, req, want, which().address(), res, door)
      .then((body) => {
        if (body !== STREAMING) send(res, 200, body);
      })
      .catch((e: unknown) => {
        const status = e instanceof HttpError ? e.status : e instanceof UnknownOrbError ? 404 : 500;
        send(res, status, { error: e instanceof Error ? e.message : String(e) });
      });
  };
  const server: Server = createServer(handler(() => server, false));
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
  const port = (server.address() as { port: number }).port;
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the home's door has no port");
  const localLink = (): string => `http://127.0.0.1:${port}/app/orbs.html#pair=${sessions.code()}`;
  let tls: Server | null = null;
  if (opts.remote && names?.length) {
    const t: Server = createTlsServer({ cert: opts.remote.cert, key: opts.remote.key }, handler(() => t, true));
    await new Promise<void>((ok, fail) => {
      t.once("error", fail);
      t.listen(opts.remote!.port ?? 0, opts.remote!.host ?? "0.0.0.0", () => ok());
    });
    remotePort = (t.address() as { port: number }).port;
    tls = t;
  }
  const file = join(home.dataDir, "home.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, port: addr.port, token, version }, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
  return {
    port: addr.port,
    token,
    file,
    pairLink: localLink,
    remote: tls ? { port: remotePort, pairLink: remoteLink } : null,
    close: async () => {
      rmSync(file, { force: true });
      for (const s of [server, tls]) {
        if (!s) continue;
        s.closeAllConnections();
        await new Promise<void>((ok) => s.close(() => ok()));
      }
    },
  };
}

export const STREAMING = Symbol("streaming");

async function handle(
  home: Home,
  req: IncomingMessage,
  want: Buffer,
  addr: ReturnType<ReturnType<typeof createServer>["address"]>,
  res?: ServerResponse,
  door?: { sessions: Sessions; appDir: string; remote: string[] | null; pairLink: () => string },
): Promise<unknown> {
  const port = addr && typeof addr !== "string" ? addr.port : -1;
  const host = (req.headers.host ?? "").toLowerCase();
  const remote = door?.remote ?? null;
  if (remote) {
    // the second door answers only to the box's own names: a hostname rebound to it is refused
    const name = host.replace(/:\d+$/, "");
    if (!remote.includes(name) || (host !== name && host !== `${name}:${port}`)) throw new HttpError(421, `this home answers only as ${remote.join(", ")}`);
  } else if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    throw new HttpError(403, "the home only answers on the loopback address");
  }
  // where a passkey is made and used: the name the browser asked (an IP is never one; loopback is "localhost")
  const where: Where = remote ? { rpId: host.replace(/:\d+$/, ""), origin: `https://${host}` } : { rpId: "localhost", origin: `http://localhost:${port}` };
  const cookie = (id: string): string => `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${remote ? "; Secure" : ""}`;
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  // the app's own files: nothing secret in them, so no pass is needed (the loopback check holds)
  if (method === "GET" && door && (parts[0] === "app" || url.pathname === "/")) {
    if (url.pathname === "/" || url.pathname === "/app" || url.pathname === "/app/") return redirect(res!, "/app/orbs.html");
    return serveApp(res!, door.appDir, parts.slice(1));
  }
  // a pairing link's code, for a session
  if (method === "POST" && url.pathname === "/session" && door) {
    const id = door.sessions.redeem(text(await body(req), "code"), deviceName(req.headers["user-agent"]));
    if (!id) throw new HttpError(401, "that pairing link is used or lapsed: start the home again, or ask it for a new one");
    res!.setHeader("set-cookie", cookie(id));
    return { paired: true };
  }
  // a passkey's sign-in (PLAN 2.7): what the browser needs, then its signature, for a session
  if (method === "POST" && url.pathname === "/passkeys/sign-in/options" && door) return home.passkeys.getOptions(where);
  if (method === "POST" && url.pathname === "/passkeys/sign-in" && door) {
    try {
      const id = home.passkeys.signIn(where, (await body(req)).credential, deviceName(req.headers["user-agent"]));
      res!.setHeader("set-cookie", cookie(id));
      return { signedIn: true };
    } catch (e) {
      throw e instanceof PasskeyError ? new HttpError(401, e.message) : e;
    }
  }

  const got = Buffer.from(req.headers.authorization ?? "");
  const byToken = !remote && got.length === want.length && timingSafeEqual(got, want); // the token is for this machine's tools only
  const me = byToken ? null : (door?.sessions.device(cookieOf(req.headers.cookie, SESSION_COOKIE)) ?? null);
  const bySession = me !== null;
  if (!byToken && !bySession) throw new HttpError(401, remote ? "no session: open a pairing link, or sign in with your passkey" : "missing or wrong token (see home.json), or no session (open the pairing link)");
  // a change made with a session needs the app's own header: a page on another site cannot add it
  if (bySession && method !== "GET" && req.headers["x-orbs"] !== "1") throw new HttpError(403, "a change through a session needs the x-orbs header");

  if (method === "GET" && url.pathname === "/stream") return stream(home, req, res!, Number(url.searchParams.get("since") ?? 0));

  // the devices signed in, and the owner's passkeys (PLAN 2.7)
  if (method === "GET" && url.pathname === "/devices") return { devices: home.sessions.list().map((d) => ({ ...d, current: d.id === me?.id })) };
  if (method === "POST" && url.pathname === "/devices/pair" && door) return { link: door.pairLink(), lapsesInMs: 5 * 60_000 };
  if (method === "POST" && parts[0] === "devices" && parts.length === 3 && parts[2] === "revoke") {
    try {
      home.sessions.revoke(Number(parts[1]));
      return { revoked: true };
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "POST" && url.pathname === "/passkeys/new/options") return home.passkeys.createOptions(where, home.about.get().name ?? "the owner");
  if (method === "POST" && url.pathname === "/passkeys") {
    const b = await body(req);
    try {
      return { passkey: home.passkeys.register(where, b.credential, typeof b.name === "string" ? b.name : deviceName(req.headers["user-agent"])) };
    } catch (e) {
      throw e instanceof PasskeyError ? new HttpError(400, e.message) : e;
    }
  }
  if (method === "GET" && url.pathname === "/passkeys") return { passkeys: home.passkeys.list() };
  // the day (PLAN 4.5): the brief and what clashes, in Ash's words, from your calendars and the orbs' list
  if (method === "GET" && url.pathname === "/day") {
    const d = await dayOf(home, home.clock.now());
    return "why" in d ? d : { ...d, clashes: d.clashes.map((c) => ({ ...c, said: clashWords(c) })), owedSaid: owedWords(d.owed) };
  }
  // your Google and Microsoft accounts (PLAN 4.2): which can be connected here, the ones that are,
  // a sign-in started (it comes back to this machine), one disconnected with its mail and calendar
  if (method === "GET" && url.pathname === "/accounts") return { providers: home.accounts.providers(), accounts: home.accounts.list() };
  if (method === "POST" && url.pathname === "/accounts/connect") {
    const b = await body(req);
    const provider = text(b, "provider");
    if (provider !== "google" && provider !== "microsoft") throw new HttpError(400, "an account is Google's or Microsoft's");
    try {
      return { url: (await home.connectAccount(provider)).url };
    } catch (e) {
      throw e instanceof AccountError ? new HttpError(400, e.message) : e;
    }
  }
  if (method === "POST" && parts[0] === "accounts" && parts.length === 3 && parts[2] === "remove") {
    try {
      await home.disconnectAccount(decodeURIComponent(parts[1]!));
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
    return { accounts: home.accounts.list() };
  }
  // your own calendars (PLAN 4.2): listed (never their addresses), subscribed to once they read as one, removed
  if (method === "GET" && url.pathname === "/calendars") return { calendars: home.calendars.list() };
  if (method === "POST" && url.pathname === "/calendars") {
    const b = await body(req);
    try {
      await home.calendars.add(text(b, "name"), typeof b.label === "string" ? b.label : "", text(b, "address"));
    } catch (e) {
      throw e instanceof CalendarError ? new HttpError(400, e.message) : e;
    }
    return { calendars: home.calendars.list() };
  }
  if (method === "POST" && parts[0] === "calendars" && parts.length === 3 && parts[2] === "remove") {
    try {
      await home.calendars.remove(decodeURIComponent(parts[1]!));
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
    return { calendars: home.calendars.list() };
  }
  // your mail accounts (PLAN 4.2): listed (never the password), added once signing in works, removed
  if (method === "GET" && url.pathname === "/mail") return { accounts: home.mail.accounts() };
  if (method === "POST" && url.pathname === "/mail") {
    const b = await body(req);
    try {
      await home.mail.add(text(b, "name"), b.account as Account, text(b, "password"));
    } catch (e) {
      throw e instanceof ImapError ? new HttpError(400, e.message) : e;
    }
    return { accounts: home.mail.accounts() };
  }
  if (method === "POST" && parts[0] === "mail" && parts.length === 3 && parts[2] === "remove") {
    try {
      await home.mail.remove(decodeURIComponent(parts[1]!));
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
    return { accounts: home.mail.accounts() };
  }
  // the person's connectors (PLAN 4.2): where each stands; one added (its secrets to the keychain), restarted, removed
  if (method === "GET" && url.pathname === "/connectors") return { connectors: home.connectors.states() };
  if (method === "POST" && url.pathname === "/connectors") {
    const b = await body(req);
    try {
      const spec = b.spec as Spec;
      if (!spec || typeof spec !== "object") throw new ConnectorError("a connector needs its spec: {command, args, env} or {url, headers}");
      // a connector that runs a program runs it on this machine: added on it, never through the second door
      if (remote && "command" in spec) throw new HttpError(403, "a connector that runs a program is added on the machine your home runs on, not from another device");
      return { connector: await home.connectors.add(text(b, "name"), spec, (b.secrets ?? {}) as Record<string, string>) };
    } catch (e) {
      throw e instanceof ConnectorError ? new HttpError(400, e.message) : e;
    }
  }
  if (method === "POST" && parts[0] === "connectors" && parts.length === 3 && (parts[2] === "remove" || parts[2] === "restart")) {
    const name = decodeURIComponent(parts[1]!);
    if (!home.connectors.specs()[name]) throw new HttpError(404, `no connector "${name}"`);
    if (parts[2] === "remove") await home.connectors.remove(name);
    else {
      await home.connectors.stop(name);
      await home.connectors.start(name);
    }
    return { connectors: home.connectors.states() };
  }
  if (method === "POST" && parts[0] === "passkeys" && parts.length === 3 && parts[2] === "remove") {
    try {
      home.passkeys.remove(Number(parts[1]));
      return { removed: true };
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }

  if (method === "GET" && url.pathname === "/status") {
    return {
      version,
      pid: process.pid,
      dataDir: home.dataDir,
      seq: home.events.head(),
      loopsOff: home.loops.disabledReason(),
      kit: home.kit ? { state: home.kit.state, pid: home.kit.pid ?? null } : null,
      orbs: home.inbox.orbs().map((o) => ({ ...o, queued: home.inbox.queued(o.id).length })),
    };
  }
  if (method === "GET" && url.pathname === "/events") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 200));
    if (!Number.isInteger(since) || !Number.isInteger(limit) || limit < 1) throw new HttpError(400, "since and limit are whole numbers");
    return { events: home.events.since(since, limit) };
  }
  if (method === "GET" && parts[0] === "conversations" && parts.length === 3 && parts[2] === "messages") {
    const conv = decodeURIComponent(parts[1]!);
    const since = Number(url.searchParams.get("since") ?? 0);
    if (!Number.isInteger(since)) throw new HttpError(400, "since is a whole number");
    const messages = home.conversations.list(conv, since);
    // how each card these rows mention was answered, so a reader can say so beside its record
    const cards: Record<string, string> = {};
    for (const m of messages) if (m.role === "notice" && typeof m.meta.card === "number") cards[m.meta.card] = home.conversations.card(m.meta.card)?.status ?? "gone";
    return { messages, cards, card: home.conversations.openCard(conv) ?? null };
  }
  if (method === "POST" && parts[0] === "cards" && parts.length === 2) {
    const id = Number(parts[1]);
    const b = await body(req);
    const choice = b.choice;
    if (!["approve", "deny", "answer", "always", "change", "save"].includes(String(choice))) {
      throw new HttpError(400, '"choice" is approve, deny, always, answer, change or save');
    }
    try {
      return { card: home.answerCard(id, choice as Parameters<Home["answerCard"]>[1], typeof b.answer === "string" ? b.answer : undefined) };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "GET" && parts[0] === "plans" && parts.length === 3 && parts[2] === "board") {
    return { board: home.board.rows(Number(parts[1])) };
  }
  if (method === "GET" && url.pathname === "/plans") {
    return { plans: home.plans.list(url.searchParams.get("orb") ?? undefined) };
  }
  if (method === "GET" && url.pathname === "/rules") {
    return { rules: home.rules.list(url.searchParams.get("orb")) };
  }
  if (method === "POST" && url.pathname === "/rules") {
    const b = await body(req);
    const decision = b.decision;
    if (decision !== "allow" && decision !== "ask" && decision !== "never") throw new HttpError(400, '"decision" is allow, ask or never');
    return { rule: home.rules.add({ orb: typeof b.orb === "string" ? b.orb : null, text: text(b, "text"), decision, source: "owner" }) };
  }
  if (method === "DELETE" && parts[0] === "rules" && parts.length === 2) {
    home.rules.remove(Number(parts[1]));
    return { removed: Number(parts[1]) };
  }
  // Continue with ChatGPT (PLAN 1.10). Status and the sign-in URL only: no reply carries a token.
  if (method === "GET" && url.pathname === "/chatgpt") return { chatgpt: await home.chatgpt.status() };
  if (method === "POST" && parts[0] === "chatgpt" && parts.length === 2) {
    switch (parts[1]) {
      case "sign-in": {
        const { url: signIn, done } = await home.chatgpt.begin();
        void done.catch(() => {}); // the outcome arrives as chatgpt.connected or chatgpt.sign_in_failed
        return { url: signIn };
      }
      case "sign-out":
        await home.chatgpt.signOut();
        return { chatgpt: await home.chatgpt.status() };
      case "resume":
        home.chatgpt.resume();
        return { chatgpt: await home.chatgpt.status() };
      case "model": {
        try {
          home.chatgpt.setModel(text(await body(req), "slug"));
        } catch (e) {
          throw new HttpError(409, e instanceof Error ? e.message : String(e));
        }
        return { chatgpt: await home.chatgpt.status() };
      }
    }
  }
  // The brain order (PLAN 1.11): where each brain stands, the Gemini key, the local coder. A reply
  // never carries the key; a refused key is never kept.
  if (method === "GET" && url.pathname === "/brains") return { brains: home.brains.status() };
  if (parts[0] === "brains" && parts[1] === "gemini" && parts.length === 2) {
    if (method === "DELETE") {
      await home.brains.clearGemini();
      return { brains: home.brains.status() };
    }
    if (method === "POST") {
      try {
        await home.brains.setGemini(text(await body(req), "key"));
      } catch (e) {
        if (e instanceof KeyRefusedError) throw new HttpError(400, e.message);
        throw e;
      }
      return { brains: home.brains.status() };
    }
  }
  if (parts[0] === "brains" && parts[1] === "search" && parts.length === 2) {
    if (method === "DELETE") {
      await home.brains.clearSearch();
      return { brains: home.brains.status() };
    }
    if (method === "POST") {
      try {
        await home.brains.setSearch(text(await body(req), "key"));
      } catch (e) {
        if (e instanceof KeyRefusedError) throw new HttpError(400, e.message);
        throw e;
      }
      return { brains: home.brains.status() };
    }
  }
  if (parts[0] === "brains" && parts[1] === "local" && parts.length === 2) {
    if (method === "DELETE") {
      home.brains.setLocal(null);
      return { brains: home.brains.status() };
    }
    if (method === "POST") {
      const b = await body(req);
      try {
        home.brains.setLocal({ baseUrl: text(b, "baseUrl"), model: text(b, "model") });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
      return { brains: home.brains.status() };
    }
  }
  if (method === "GET" && url.pathname === "/orbs") return { orbs: home.inbox.orbs({ all: url.searchParams.get("all") === "1" }) };
  if (method === "POST" && url.pathname === "/orbs") {
    const b = await body(req);
    const specialty = typeof b.specialty === "string" ? b.specialty : "general";
    if (!(specialty in SPECIALTY_FAMILIES)) throw new HttpError(400, `"${specialty}" is not a specialty`);
    const look = b.look && typeof b.look === "object" && !Array.isArray(b.look) ? (b.look as Record<string, unknown>) : {};
    try {
      return { orb: home.inbox.addOrb(text(b, "id"), text(b, "name"), specialty as Specialty, look) };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // letting an orb go: archived, his work kept (decision 12); rehiring brings him back
  if (method === "DELETE" && parts[0] === "orbs" && parts.length === 2) return { orb: home.inbox.letGo(decodeURIComponent(parts[1]!)) };
  if (method === "POST" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "rehire") return { orb: home.inbox.rehire(decodeURIComponent(parts[1]!)) };
  // sessions (PLAN 2.9): a Brainstorm and a Floor, and the orbs that work each
  if (method === "GET" && url.pathname === "/sessions") return { sessions: home.team.list() };
  if (parts[0] === "sessions") {
    const asked = async (fn: () => unknown): Promise<unknown> => {
      try {
        return await fn();
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    };
    if (method === "POST" && parts.length === 1) {
      const b = await body(req);
      const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
      return asked(() => ({ session: home.team.create(text(b, "title"), { brainstorm: list(b.brainstorm), floor: list(b.floor) }) }));
    }
    const id = Number(parts[1]);
    if (method === "GET" && parts.length === 2) {
      const s = home.team.get(id);
      if (!s) throw new HttpError(404, `no session ${parts[1]}`);
      return { session: s };
    }
    const tab = parts[2] as Tab;
    if (method === "PUT" && parts.length === 3) {
      const b = await body(req);
      return asked(() => ({ session: home.team.setMembers(id, tab, Array.isArray(b.orbs) ? b.orbs.map(String) : []) }));
    }
    if (method === "POST" && parts.length === 4 && parts[3] === "messages") {
      const b = await body(req);
      return asked(() => home.team.say(id, tab, text(b, "text")));
    }
  }
  // about you: what the office calls you
  if (method === "GET" && url.pathname === "/me") return { me: home.about.get() };
  if (method === "PUT" && url.pathname === "/me") {
    try {
      return { me: home.about.setName(text(await body(req), "name")) };
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  // the notification centre (PLAN 2.11): what is out, putting one (or all) away for every device,
  // and the bills and reminders kept (the calendar's, 2.12)
  if (method === "GET" && url.pathname === "/notices") return { notices: home.notices.list() };
  if (method === "POST" && url.pathname === "/notices/put-away") return { put: home.notices.putAwayAll() };
  if (method === "POST" && parts[0] === "notices" && parts.length === 3 && parts[2] === "put-away") {
    try {
      home.notices.putAway(Number(parts[1]));
      return { ok: true };
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "GET" && url.pathname === "/reminders") return { reminders: home.notices.reminders() };
  // the gym (PLAN 3.x): the morning card, each orb's XP and where it lies, the night's candidates
  if (method === "POST" && url.pathname === "/card/undo") {
    const b = (await body(req)) as Record<string, unknown>;
    const u =
      b.kind === "habit" ? { kind: "habit" as const, orb: text(b, "orb"), habit: text(b, "habit"), version: Number(b.version) }
        : b.kind === "lesson" ? { kind: "lesson" as const, orb: text(b, "orb"), line: text(b, "line"), index: Number(b.index) }
          : null;
    if (!u) throw new HttpError(400, 'kind is "habit" or "lesson"');
    try {
      home.undo(u);
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
    return { card: morningCard(home.events, { now: home.clock.now(), learned: (orb) => home.learned.list(orb) }) };
  }
  if (method === "GET" && url.pathname === "/card") return { card: morningCard(home.events, { now: home.clock.now(), learned: (orb) => home.learned.list(orb) }) };
  // levels (PLAN 3.8): where he stands, what the next one needs; only you promote
  if (method === "GET" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "level") {
    const orb = decodeURIComponent(parts[1]!);
    const who = home.inbox.orb(orb);
    if (!who) throw new HttpError(404, `no orb "${orb}"`);
    const now = home.clock.now();
    // with his age and his days in the company, counted where you read them (owner, 10-02)
    return { level: levelOf(home.events, orb), xp: home.xp.of(orb, now).total, next: nextFor(home.events, orb, { specialty: who.specialty, now }), ...tenureOf(home.events, who), now };
  }
  if (method === "POST" && parts[0] === "orbs" && parts.length === 3 && (parts[2] === "promote" || parts[2] === "decline-promotion")) {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    const to = text((await body(req)) as Record<string, unknown>, "to");
    if (parts[2] === "decline-promotion") {
      home.declinePromotion(orb, to);
      return { level: levelOf(home.events, orb) };
    }
    try {
      return { level: home.promote(orb, to) };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "GET" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "xp") {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    return { xp: home.xp.of(orb, home.clock.now()), radar: radarOf(home.events, orb), niches: nichesOf(home.events, orb) };
  }
  if (method === "GET" && url.pathname === "/gym/candidates") {
    const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days") ?? 14) || 14));
    return { candidates: findHotPaths(home.events, { since: home.clock.now() - days * 86_400_000 }) };
  }
  // the lab (PLAN 2.13): every brainstorm and every plan shown, searchable; a brainstorm reopened
  if (method === "GET" && url.pathname === "/lab") return labOf(home, url.searchParams.get("q") ?? "");
  if (method === "POST" && parts[0] === "lab" && parts[1] === "sessions" && parts.length === 4 && parts[3] === "reopen") {
    try {
      return { session: reopen(home, Number(parts[2])) };
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }
  // the calendar (PLAN 2.12): the days, and the person's own changes to them (an orb's go through a card)
  if (method === "GET" && url.pathname === "/calendar") {
    try {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const entries = calendarOf(home, from, to); // checks the days first
      const span = spanOf(from, to);
      return { entries: withEvents(entries, await home.calendars.events(span.start, span.end), span) };
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "POST" && parts[0] === "reminders" && (parts.length === 2 || (parts.length === 3 && parts[2] === "done"))) {
    try {
      if (parts.length === 3) {
        home.notices.done(Number(parts[1]));
        return { ok: true };
      }
      return { reminder: home.notices.move(Number(parts[1]), text(await body(req), "due")) };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(/^no reminder/.test(String((e as Error).message)) ? 404 : 400, e instanceof Error ? e.message : String(e));
    }
  }
  // the schedule editor (PLAN 2.4): a rule, previewed in plain words with its next runs, then kept
  if (parts[0] === "schedules" && (url.pathname === "/schedules/preview" || url.pathname === "/schedules")) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (method === "GET") {
      const orb = url.searchParams.get("orb") ?? undefined;
      return { schedules: home.schedules.list(orb).map((x) => ({ ...x, words: wordsOf(x.cron), next: cronOf(x.cron, x.timezone).nextRun(new Date(home.clock.now()))?.getTime() ?? null })) };
    }
    const b = await body(req);
    try {
      if (url.pathname === "/schedules/preview") return preview(ruleOf(b.rule), zone, new Date(home.clock.now()));
      const orb = text(b, "orb");
      if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
      const cron = cronFor(ruleOf(b.rule));
      const made = home.schedules.add({ orb, name: text(b, "name").slice(0, 80), instruction: text(b, "instruction").slice(0, 2000), cron, timezone: zone });
      return { schedule: { ...made, words: wordsOf(made.cron) } };
    } catch (e) {
      throw e instanceof RuleError ? new HttpError(400, e.message) : e;
    }
  }
  if (method === "POST" && parts[0] === "schedules" && parts.length === 3 && parts[2] === "remove") {
    const id = decodeURIComponent(parts[1]!);
    if (!home.schedules.get(id)) throw new HttpError(404, `no schedule ${id}`);
    home.schedules.remove(id);
    return { removed: true };
  }
  if (method === "POST" && parts[0] === "schedules" && parts.length === 2) {
    const id = decodeURIComponent(parts[1]!);
    if (!home.schedules.get(id)) throw new HttpError(404, `no schedule ${id}`);
    const b = await body(req);
    try {
      if (typeof b.enabled === "boolean") home.schedules.setEnabled(id, b.enabled);
      if (typeof b.time === "string") {
        const m = /^(\d{2}):(\d{2})$/.exec(b.time);
        if (!m) throw new Error("a time is HH:MM");
        home.schedules.setTime(id, Number(m[1]), Number(m[2]));
      }
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    return { schedule: home.schedules.get(id) };
  }
  // the passwords you save for your orbs' browsers (PLAN 4.1): listed by site and username, never shown back
  if (method === "GET" && url.pathname === "/vault") return { entries: home.vault.list() };
  if (method === "POST" && url.pathname === "/vault") {
    const b = await body(req);
    try {
      const entry = await home.vault.add(text(b, "site"), text(b, "username"), text(b, "password"));
      return { entry, entries: home.vault.list() };
    } catch (e) {
      throw e instanceof VaultError ? new HttpError(400, e.message) : e;
    }
  }
  if (method === "POST" && url.pathname === "/vault/remove") {
    const b = await body(req);
    try {
      home.vault.remove(text(b, "site"), text(b, "username"));
    } catch (e) {
      throw e instanceof VaultError ? new HttpError(404, e.message) : e;
    }
    return { entries: home.vault.list() };
  }
  // his computer (PLAN 4.1): whether his browser is open, the last still of his screen and where his
  // cursor was, and the person's hand on it (wake, sleep, reset, take over, hand back)
  if (parts[0] === "orbs" && parts.length >= 3 && (parts[2] === "computer" || parts[2] === "screen.jpg")) {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    const { file, meta } = home.computers.screen(orb);
    const state = () => {
      let screen: Screen | null = null;
      try {
        screen = JSON.parse(readFileSync(meta, "utf8")) as Screen;
      } catch {
        // nothing looked at yet
      }
      return { awake: home.computers.awake(orb), takenOver: home.computers.takenOver(orb), screen };
    };
    if (method === "GET" && parts[2] === "screen.jpg" && parts.length === 3) {
      if (!existsSync(file)) throw new HttpError(404, "he has not looked at anything yet");
      res!.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res!.end(readFileSync(file));
      return STREAMING;
    }
    if (method === "GET" && parts[2] === "computer" && parts.length === 3) return state();
    // his screen live (PLAN 4.6): a stream of JPEG frames an <img> shows as they come, for as long
    // as the page watching it stays; the screencast ends with the last watcher
    if (method === "GET" && parts[2] === "computer" && parts.length === 4 && parts[3] === "live") {
      let stop: (() => Promise<void>) | null = null;
      let gone = false;
      let backedUp = false; // a slow phone gets the frames it can take, never a growing queue
      res!.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=orbsframe", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res!.on("close", () => {
        gone = true;
        void stop?.();
      });
      try {
        stop = await home.computers.watch(orb, (jpeg) => {
          if (gone || backedUp) return;
          res!.write(`--orbsframe\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`);
          res!.write(jpeg);
          if (!res!.write("\r\n")) {
            backedUp = true;
            res!.once("drain", () => (backedUp = false));
          }
        });
        if (gone) await stop();
      } catch {
        res!.end();
      }
      return STREAMING;
    }
    // the person's hands on his page, once they have taken it over
    if (method === "POST" && parts[2] === "computer" && parts.length === 4 && parts[3] === "hands") {
      if (!home.computers.takenOver(orb)) throw new HttpError(409, "take his computer over first");
      try {
        return { at: await home.computers.hands(orb, (await body(req)) as Hands), ...state() };
      } catch (e) {
        throw e instanceof ComputerError ? new HttpError(400, e.message) : e;
      }
    }
    if (method === "POST" && parts[2] === "computer" && parts.length === 4) {
      try {
        if (parts[3] === "wake") await home.computers.wake(orb);
        else if (parts[3] === "sleep") await home.computers.sleep(orb);
        else if (parts[3] === "reset") await home.computers.reset(orb);
        else if (parts[3] === "take-over") home.computers.takeOver(orb);
        else if (parts[3] === "hand-back") home.computers.handBack(orb);
        else throw new HttpError(404, `no ${parts[3]} for his computer`);
      } catch (e) {
        throw e instanceof ComputerError ? new HttpError(400, e.message) : e;
      }
      return state();
    }
  }
  // a command the person types into his terminal, once they have his computer (PLAN 4.6)
  if (method === "POST" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "terminal") {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    if (!home.computers.takenOver(orb)) throw new HttpError(409, "take his computer over first");
    const r = await home.terminal(orb, text(await body(req), "command"));
    return { output: r.content, failed: r.isError === true };
  }
  // his computer (PLAN 2.8): what he is making, his workspace's folders and files, to read
  // a file you give him, from a chat (PLAN 2.4): kept in his workspace's from-you/, the path back
  if (method === "POST" && parts[0] === "orbs" && parts.length === 4 && parts[2] === "workspace" && parts[3] === "files") {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    const name = url.searchParams.get("name") ?? "";
    if (!name.trim()) throw new HttpError(400, "a file needs its name (?name=)");
    const bytes = await rawBody(req, UPLOAD_CAP);
    try {
      return { path: saveUpload(home.dataDir, orb, name, bytes) };
    } catch (e) {
      throw new HttpError(e instanceof OutsideError ? 403 : 400, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "GET" && parts[0] === "orbs" && parts.length >= 3 && parts[2] === "workspace") {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    const path = url.searchParams.get("path") ?? "";
    try {
      if (parts.length === 3) return { entries: listWorkspace(home.dataDir, orb, path) };
      if (parts.length === 4 && parts[3] === "file") return { file: readWorkspace(home.dataDir, orb, path) };
    } catch (e) {
      if (e instanceof OutsideError) throw new HttpError(400, e.message);
      if (e instanceof MissingError) throw new HttpError(404, e.message);
      throw e;
    }
  }
  // Each orb's own constitution (PLAN 3.9): what he loads, to read; what he learned, which only
  // the person adds (here, through the door) and can take back.
  if (parts[0] === "orbs" && parts.length >= 3 && (parts[2] === "constitution" || parts[2] === "learned")) {
    const orb = decodeURIComponent(parts[1]!);
    const o = home.inbox.orb(orb);
    if (!o) throw new HttpError(404, `no orb "${orb}"`);
    if (method === "GET" && parts[2] === "constitution" && parts.length === 3) {
      return { constitution: standingContext({ orbName: o.name, brainDir: join(home.dataDir, "brain"), workspace: "", specialty: o.specialty, learned: home.learned.list(orb) }) };
    }
    if (parts[2] === "learned") {
      try {
        if (method === "GET" && parts.length === 3) return { learned: home.learned.list(orb) };
        if (method === "POST" && parts.length === 3) return { learned: home.learned.add(orb, text(await body(req), "line")) };
        if (method === "DELETE" && parts.length === 4) return { learned: home.learned.remove(orb, Number(parts[3])) };
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (method === "POST" && parts[0] === "orbs" && parts.length === 3) {
    const orb = decodeURIComponent(parts[1]!);
    switch (parts[2]) {
      case "messages": {
        const b = await body(req);
        const conversation = typeof b.conversation === "string" && b.conversation ? b.conversation : "chat:main";
        return { item: home.inbox.send(orb, conversation, text(b, "text")) };
      }
      case "pause":
        home.inbox.pause(orb);
        return { orb: home.inbox.orb(orb) };
      case "resume":
        home.inbox.resume(orb);
        return { orb: home.inbox.orb(orb) };
      case "stop":
        home.inbox.stop(orb);
        return { orb: home.inbox.orb(orb) };
    }
  }
  throw new HttpError(404, `no ${method} ${url.pathname}`);
}

/** Server-sent events: what happened since `since`, then everything as it happens, plus a reply's
 * text as it streams. A comment line every 15 s keeps proxies from closing a quiet stream. */
function stream(home: Home, req: IncomingMessage, res: ServerResponse, since: number): typeof STREAMING {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const out = (kind: string, data: unknown): void => {
    res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  for (const e of home.events.since(Number.isInteger(since) ? since : 0, 1000)) out("event", e);
  const onEvent = (e: unknown): void => out("event", e);
  const onText = (e: unknown): void => out("text", e);
  const onTerminal = (e: unknown): void => out("terminal", e); // his commands' output as it comes (PLAN 4.6)
  home.live.on("event", onEvent);
  home.live.on("text", onText);
  home.live.on("terminal", onTerminal);
  const beat = setInterval(() => res.write(": beat\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(beat);
    home.live.off("event", onEvent);
    home.live.off("text", onText);
    home.live.off("terminal", onTerminal);
  });
  return STREAMING;
}

/** A request's bytes as they are, refused past `cap`. */
async function rawBody(req: IncomingMessage, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > cap) throw new HttpError(413, `a file up to ${Math.round(cap / 1024 / 1024)} MB`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > BODY_LIMIT) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "the body must be a JSON object");
}

function text(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `"${key}" is required`);
  return v;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

function redirect(res: ServerResponse, to: string): typeof STREAMING {
  res.writeHead(302, { location: to });
  res.end();
  return STREAMING;
}

const APP_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

/** A file of the built app, never a path outside it; the page told what it may load (CSP). */
function serveApp(res: ServerResponse, dir: string, parts: string[]): typeof STREAMING {
  const rel = normalize(parts.map((p) => decodeURIComponent(p)).join("/"));
  const file = join(dir, rel);
  if (!file.startsWith(dir.endsWith(sep) ? dir : dir + sep) || rel.startsWith("..")) throw new HttpError(404, "not part of the app");
  if (!existsSync(dir)) throw new HttpError(404, "the app is not built: pnpm -C packages/app build");
  if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, `no ${rel} in the app`);
  res.writeHead(200, {
    "content-type": APP_TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": extname(file) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(readFileSync(file));
  return STREAMING;
}
