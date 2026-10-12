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
import { CHAINS } from "./desk/chains.ts";
import { DEX_CHAINS, isDexChain, isTokenAddress, readTokenKey, tokenKey } from "./desk/dex.ts";
import { DeskError, YOU, type Settings } from "./desk/desk.ts";
import { SwapError } from "./desk/swaps.ts";
import { barsProblem, drawn, marksOn } from "./desk/chart.ts";
import { problemOf, SYMBOLS, TIMEFRAMES, type Strategy, type Timeframe } from "./desk/strategy.ts";
import { WalletError } from "./desk/wallets.ts";
import { recentWork } from "./worklog.ts";
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Home } from "./home.ts";
import { UnknownOrbError } from "./inbox.ts";
import { KeyRefusedError } from "./brain/brains.ts";
import { ProjectsRefused } from "./projects.ts";
import { SPECIALTY_FAMILIES, type Specialty } from "./brain/constitution.ts";
import { SpendCapError } from "./brain/spend.ts";
import { cookieOf, deviceName, SESSION_COOKIE, SESSION_MS, type Sessions } from "./sessions.ts";
import { PasskeyError, type Where } from "./passkeys.ts";
import { ConnectorError, type Spec } from "./connectors/connectors.ts";
import type { Account } from "./connectors/mail.ts";
import { ImapError } from "./connectors/imap.ts";
import { CalendarError } from "./connectors/calendars.ts";
import { AccountError } from "./connectors/accounts.ts";
import { ComputerError, type Hands, type Screen } from "./computer/browser.ts";
import { VaultError } from "./computer/vault.ts";
import { LessonError } from "./lessons.ts";
import { KIT_DIR } from "./kit.ts";
import { parseTabConversation, type Tab } from "./team.ts";
import { chatterOf } from "./chatter.ts";
import { standingContext } from "./agent/standing.ts";
import { listWorkspace, MissingError, OutsideError, readWorkspace, saveUpload, UPLOAD_CAP } from "./workspace.ts";
import { calendarOf, spanOf, withEvents } from "./calendar.ts";
import { clashWords, dayOf, owedWords } from "./day.ts";
import { cronFor, preview, RuleError, ruleOf, wordsOf } from "./schedule-rules.ts";
import { cronOf } from "./schedule.ts";
import { labOf, reopen } from "./lab.ts";
import { morningCard } from "./gym/card.ts";
import { LEVELS, levelOf, nextFor, tenureOf } from "./gym/levels.ts";
import type { Kind } from "./school/subjects.ts";
import { headsOf, leadsOf } from "./org.ts";
import { dashboardOf } from "./dashboard.ts";
import { statsOf } from "./stats.ts";
import { whyNot } from "./company.ts";
import { habitsOf } from "./gym/share.ts";
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
/** A recording a page sends to be heard (PLAN 4.3): a minute or so of speech. */
const VOICE_CAP = 5 * 1024 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Where the built app is (`pnpm -C packages/app build`), served at /app/. */
export const APP_DIR = fileURLToPath(new URL("../../app/dist/", import.meta.url));

/** Opens a link in this machine's own browser, the one it opens links in: xdg-open on Linux, open on a Mac, the URL
 * handler on Windows (no shell between: a link's `&` stays the link's). */
export function openHere(url: string): Promise<void> {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const p = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true });
    p.once("error", reject);
    p.once("spawn", () => (p.unref(), resolve()));
  });
}

export async function serve(home: Home, opts: { port?: number; portFallback?: boolean; appDir?: string; remote?: Remote; opener?: (url: string) => Promise<void> } = {}): Promise<HomeDoor> {
  const token = randomBytes(24).toString("base64url");
  const want = Buffer.from(`Bearer ${token}`);
  const sessions = home.sessions;
  const appDir = opts.appDir ?? APP_DIR;
  const names = opts.remote ? opts.remote.names.map((n) => n.toLowerCase()) : null;
  let remotePort = -1;
  const remoteLink = (): string => `https://${names![0]}${remotePort === 443 ? "" : `:${remotePort}`}/app/orbs.html#pair=${sessions.code()}`;
  const handler = (which: () => Server, remote: boolean) => (req: IncomingMessage, res: ServerResponse) => {
    const door = { sessions, appDir, remote: remote ? names : null, pairLink: () => (names ? remoteLink() : localLink()), localLink: () => localLink(), open: opts.opener ?? openHere };
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
  // the same port every time when it is free (owner, 10-04: "when a user changes theme, it has to be
  // persistent"): the app keeps the theme and the rest in the browser, by address, and a new port each
  // start was a new address; taken (another home, a test), any port, as before
  const listen = (port: number): Promise<void> =>
    new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => (server.off("error", fail), ok()));
    });
  try {
    await listen(opts.port ?? 0);
  } catch (e) {
    if (!(opts.portFallback && (e as NodeJS.ErrnoException).code === "EADDRINUSE")) throw e;
    await listen(0);
  }
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
  door?: { sessions: Sessions; appDir: string; remote: string[] | null; pairLink: () => string; localLink: () => string; open: (url: string) => Promise<void> },
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
  // the lesson's canvas (PLAN 4.4): a carried page with nothing secret in it, framed only by the app
  if (method === "GET" && door && url.pathname === "/lesson/canvas.html") return serveCanvas(res!);
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
  // the app opened in this machine's own browser (owner, 10-11: "how does the user connect their wallet? i dont see any
  // way?"): Orbz's window is a browser profile of its own, so a wallet lives in the browser beside it. A link paired for
  // it, to a place in the app, opened there; from this machine only, never through the door for other devices
  if (method === "POST" && url.pathname === "/devices/open-browser" && door) {
    if (door.remote) throw new HttpError(403, "a browser is opened only on the machine the home runs on");
    const to = text(await body(req), "to");
    if (!/^\/[a-z0-9/_-]{1,60}$/i.test(to)) throw new HttpError(400, "a place in the app, as /desk/trade");
    const link = `${door.localLink()}&to=${encodeURIComponent(to)}`;
    try {
      await door.open(link);
      return { opened: true, link: null };
    } catch {
      return { opened: false, link };
    }
  }
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
  // Your projects folder (projects.ts): where every project's files are copied, on or off, copy now
  if (method === "GET" && url.pathname === "/projects") return { projects: home.projects.state() };
  if (method === "POST" && url.pathname === "/projects") {
    const b = await body(req);
    try {
      return { projects: home.projects.set({ ...(typeof b.dir === "string" && { dir: b.dir }), ...(typeof b.on === "boolean" && { on: b.on }) }) };
    } catch (e) {
      throw e instanceof ProjectsRefused ? new HttpError(400, e.message) : e;
    }
  }
  if (method === "POST" && url.pathname === "/projects/sync") {
    home.projects.sync();
    return { projects: home.projects.state() };
  }
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
    // the founding three first, in order, and a money orb only with a CFO (PLAN 5.13)
    const why = whyNot(specialty, home.inbox.orbs().map((o) => o.specialty));
    if (why) throw new HttpError(409, why);
    const look = b.look && typeof b.look === "object" && !Array.isArray(b.look) ? (b.look as Record<string, unknown>) : {};
    try {
      return { orb: home.inbox.addOrb(text(b, "id"), text(b, "name"), specialty as Specialty, look) };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // letting an orb go: archived, his work kept (decision 12); rehiring brings him back
  // letting an orb go (PLAN 5.5): his habits handed to another orb first, if you name one (?handTo=)
  if (method === "DELETE" && parts[0] === "orbs" && parts.length === 2) {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    try {
      return home.letGo(orb, url.searchParams.get("handTo") ?? undefined);
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // school (PLAN 5.7): send an orb you let go, its report card, the syllabus you change, your thumbs
  if (parts[0] === "orbs" && parts.length === 3 && parts[2] === "school") {
    const orb = decodeURIComponent(parts[1]!);
    if (method === "GET") return home.school.report(orb);
    if (method === "POST") {
      const b = await body(req);
      const subjects = Array.isArray(b.subjects) ? (b.subjects as unknown[]).slice(0, 12).map((s) => {
        const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
        return { kind: String(o.kind ?? "") as Kind, ...(typeof o.name === "string" && { name: o.name.slice(0, 60) }) };
      }) : [];
      try {
        return home.sendToSchool(orb, subjects, Number(b.passMark));
      } catch (e) {
        throw new HttpError(409, e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (method === "PUT" && parts[0] === "school" && parts[1] === "subjects" && /^\d+$/.test(parts[2] ?? "") && parts[3] === "syllabus" && parts.length === 4) {
    const b = await body(req);
    try {
      home.school.setSyllabus(Number(parts[2]), Array.isArray(b.topics) ? (b.topics as unknown[]).map(String) : []);
      return { ok: true };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "POST" && parts[0] === "school" && parts[1] === "sittings" && /^\d+$/.test(parts[2] ?? "") && parts[3] === "answers" && /^\d+$/.test(parts[4] ?? "") && parts.length === 5) {
    const b = await body(req);
    try {
      home.school.thumb(Number(parts[2]), Number(parts[4]), b.up === true);
      return { ok: true };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // office life (PLAN 5.9): the friendships, the meetings (the floor plays the ones under way), the lessons
  // waiting for your yes; an orb's traits as the app's DNA has them; Keep or Not now for a lesson
  if (method === "GET" && url.pathname === "/social") {
    // `now` is the home's clock: a device times the meetings by it, whatever its own clock says
    return { now: home.clock.now(), friendships: home.social.friendships(), meetings: home.social.recent(20), current: home.social.current(), lessons: home.social.lessons("waiting"),
      // the moments under way (owner, 10-07: "micro interactions"), for the floor to play
      moments: home.social.moments(6).filter((m) => m.until > home.clock.now()) };
  }
  if (method === "GET" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "friends") {
    const id = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(id)) throw new HttpError(404, `no orb "${id}"`);
    return { friends: home.social.of(id) };
  }
  if (method === "PUT" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "traits") {
    const id = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(id)) throw new HttpError(404, `no orb "${id}"`);
    const b = await body(req);
    try {
      return { traits: home.social.setTraits(id, b.traits) };
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "POST" && parts[0] === "social" && parts[1] === "lessons" && parts.length === 4 && /^\d+$/.test(parts[2]!) && (parts[3] === "keep" || parts[3] === "drop")) {
    try {
      if (parts[3] === "keep") return { learned: home.social.keepLesson(Number(parts[2])) };
      home.social.dropLesson(Number(parts[2]));
      return { ok: true };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // the reading library (PLAN 3.12): what the office follows, what is being read now, and, for a
  // query, the pages read that match; Stop following is yours too
  if (method === "GET" && url.pathname === "/reading") {
    const q = (url.searchParams.get("q") ?? "").trim();
    return { sources: home.reading.sources(), now: home.reading.readingNow(), hits: q ? home.reading.search(q, { limit: 12 }) : [] };
  }
  if (method === "DELETE" && parts[0] === "reading" && parts[1] === "sources" && parts.length === 3 && /^\d+$/.test(parts[2]!)) {
    try {
      home.reading.unfollow(Number(parts[2]), "you");
      return { ok: true };
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }
  // the desk (PLAN 5.22-5.27): the market, strategies and paper books, notes, settings, wallets, swaps
  if (parts[0] === "desk") {
    const no = (code: number, e: unknown): never => {
      throw new HttpError(code, e instanceof Error ? e.message : String(e));
    };
    const id = (k: number): number => (/^\d+$/.test(parts[k] ?? "") ? Number(parts[k]) : no(404, "no such thing on the desk"));
    try {
      if (method === "GET" && parts.length === 1) {
        const now = home.clock.now();
        const prices = await home.market.tickers([...SYMBOLS]).catch(() => []);
        const price = new Map(prices.map((t) => [t.symbol, t.price]));
        // any token a book holds or a swap names (PLAN 5.28): its name and its price now, for the page and the books' worth
        const keys = new Set<string>();
        for (const b of home.desk.books()) for (const k of [b.symbol ?? "", ...b.holdings.map((h) => h.symbol)]) if (readTokenKey(k)) keys.add(k);
        for (const sw of home.swaps.list(30)) for (const a of [sw.sell, sw.buy]) if (isDexChain(sw.chain) && isTokenAddress(sw.chain, a)) keys.add(tokenKey(sw.chain, a));
        const tokens: Record<string, { symbol: string; name: string; image: string | null; priceUsd: number | null }> = {};
        await Promise.all([...keys].slice(0, 30).map(async (k) => {
          const t = readTokenKey(k)!;
          const top = (await home.dex.token(t.chain, t.address).catch(() => []))[0];
          if (!top) return;
          tokens[k] = { symbol: top.base.symbol, name: top.base.name, image: top.image, priceUsd: top.priceUsd };
          if (top.priceUsd !== null) price.set(k, top.priceUsd);
        }));
        const books = home.desk.books().map((b) => {
          const held = b.strategy !== null ? (b.qty > 0 && b.symbol ? b.qty * (price.get(b.symbol) ?? b.entryPx) : 0) : b.holdings.reduce((n, h) => n + h.qty * (price.get(h.symbol) ?? h.cost / Math.max(h.qty, 1e-12)), 0);
          return { ...b, equity: b.cash + held };
        });
        const recent = (type: string, n: number) => home.events.ofType(type).slice(-n).reverse().map((e) => ({ seq: e.seq, at: e.at, orb: e.orb, ...e.data }));
        // each orb's P&L (PLAN 5.31; owner, 10-11: "each orb pnl"): its closed trades, what its live books are worth now,
        // and the real trades it asked you for (each still yours to say yes to)
        const pnlOf = (all: typeof books) => {
          const realized = new Map(home.desk.pnl().map((p) => [p.orb, p]));
          const asks = home.swaps.list(500).filter((x) => x.orb !== null);
          // the orbs' (yours, YOU, is shown as yours)
          const ids = new Set([...realized.keys(), ...all.map((b) => b.orb), ...asks.map((x) => x.orb!)].filter((x) => x !== YOU));
          return [...ids].map((orb) => {
            // its P&L: every book it has had, live or stopped, worth now against what it started with (gains made and
            // gains on paper still open, each once); its closed trades' numbers beside it
            // on paper and real money apart (PLAN 5.34): a dollar of each is not the same to you
            const its = all.filter((b) => b.orb === orb && !b.real);
            const real = all.filter((b) => b.orb === orb && b.real && b.strategy === null);
            const r = realized.get(orb) ?? { orb, trades: 0, wins: 0, realized: 0, today: 0, best: null, worst: null, fees: 0, last: null };
            const mine = asks.filter((x) => x.orb === orb);
            const start = its.reduce((n, b) => n + b.cashStart, 0);
            const equity = its.reduce((n, b) => n + b.equity, 0);
            return {
              ...r, start, equity, pnl: equity - start,
              money: real.length ? { start: real.reduce((n, b) => n + b.cashStart, 0), equity: real.reduce((n, b) => n + b.equity, 0) } : null,
              open: its.filter((b) => b.state === "live").reduce((n, b) => n + (b.qty > 0 ? 1 : 0) + b.holdings.filter((h) => h.qty > 0).length, 0),
              real: { asked: mine.length, yes: mine.filter((x) => ["approved", "built", "sent", "confirmed"].includes(x.state)).length, sentUsd: mine.filter((x) => x.state === "sent" || x.state === "confirmed").reduce((n, x) => n + x.usd, 0) },
            };
          }).sort((a, b) => b.pnl - a.pnl);
        };
        return {
          now, market: home.market.status(), prices, top: await home.market.top(10), strategies: home.desk.strategies(), accounts: home.desk.accounts(), you: youOf(home), books, notes: home.desk.notes(), settings: home.desk.settings(),
          fills: recent("desk.fill", 40), trades: recent("desk.trade_closed", 40), wallets: home.wallets.list(), swaps: home.swaps.list(30), tokens, dex: home.dex.status(), orbs: pnlOf(books),
          chains: CHAINS.map((c) => ({ id: c.id, name: c.name, kind: c.kind, ...(c.kind === "evm" && { chainId: c.chainId }), explorer: c.explorer, tokens: c.tokens.map((t) => ({ symbol: t.symbol, decimals: t.decimals })) })),
        };
      }
      // a market now, for a chart's forming bar (PLAN 5.33): a major's own forming bar from its market; any coin's price
      // (Jupiter's on Solana, else its pair's), never GeckoTerminal's minute
      if (method === "GET" && parts[1] === "live" && parts.length === 2) {
        const market = url.searchParams.get("market") ?? "";
        const tf = (url.searchParams.get("tf") ?? "15m") as Timeframe;
        if (!TIMEFRAMES.includes(tf)) no(400, "a timeframe the desk knows");
        const token = readTokenKey(market);
        if (token) return { market, at: home.clock.now(), price: await home.dex.livePrice(token.chain, token.address), bar: null };
        if (!(SYMBOLS as readonly string[]).includes(market)) no(400, "a market the desk knows: a major by its symbol, or a coin as chain:address");
        const bar = await home.market.forming(market, tf);
        return { market, at: home.clock.now(), price: bar?.c ?? null, bar };
      }
      // what was done on a market (PLAN 5.32): each orb's paper fills, the real trades that went, the strategies run on it
      if (method === "GET" && parts[1] === "marks" && parts.length === 2) {
        const market = url.searchParams.get("market") ?? "";
        if (!((SYMBOLS as readonly string[]).includes(market) || readTokenKey(market))) no(400, "a market the desk knows: a major by its symbol, or a coin as chain:address");
        return marksOn(market, { fills: home.events.ofType("desk.fill"), swaps: home.swaps.list(1000), books: home.desk.books() });
      }
      if (method === "GET" && parts[1] === "candles") {
        const symbol = url.searchParams.get("symbol") ?? "BTC";
        const tf = (url.searchParams.get("tf") ?? "1h") as Timeframe;
        if (!((SYMBOLS as readonly string[]).includes(symbol) || readTokenKey(symbol)) || !TIMEFRAMES.includes(tf)) no(400, "a symbol and a timeframe the desk knows");
        return { symbol, tf, candles: await home.market.candles(symbol, tf, Math.min(500, Math.max(30, Number(url.searchParams.get("n")) || 200))) };
      }
      // any token on a DEX (PLAN 5.28; owner, 10-11: "a search bar for any contract address, like dexscreener's"): a
      // search, a token's pairs and what it can do to whoever holds it, a pool's bars and last trades, what is trending
      if (method === "GET" && parts[1] === "dex") {
        if (parts[2] === "search" && parts.length === 3) return { pairs: (await home.dex.search(url.searchParams.get("q") ?? "")).slice(0, 30) };
        // a coin's picture, through the home (the page's own address: img-src 'self'), from an image host only
        if (parts[2] === "image" && parts.length === 3) {
          const pic = await home.dex.image(url.searchParams.get("u") ?? "").catch(() => null);
          if (!pic) no(404, "no such picture");
          res!.writeHead(200, { "content-type": pic!.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
          res!.end(pic!.bytes);
          return STREAMING;
        }
        const chain = parts[2] === "trending" ? (url.searchParams.get("chain") ?? "solana") : (parts[3] ?? "");
        if (!isDexChain(chain)) no(400, `a chain: ${DEX_CHAINS.join(", ")}`);
        const c = chain as (typeof DEX_CHAINS)[number];
        if (parts[2] === "trending" && parts.length === 3) return { pairs: (await home.dex.trending(c)).slice(0, 30) };
        const at = decodeURIComponent(parts[4] ?? "");
        const token = url.searchParams.get("token") ?? at;
        if (parts.length !== 5 || at.length < 20 || at.length > 100 || !isTokenAddress(c, token)) no(400, `a ${chain} address`);
        if (parts[2] === "token") return { pairs: (await home.dex.token(c, at)).slice(0, 20) };
        if (parts[2] === "safety") return { safety: await home.tokenSafety(c, at) };
        if (parts[2] === "candles") {
          const tf = (url.searchParams.get("tf") ?? "15m") as Timeframe;
          if (!TIMEFRAMES.includes(tf)) no(400, `a timeframe: ${TIMEFRAMES.join(", ")}`);
          return { candles: await home.dex.candles(c, at, token, tf, Math.min(1000, Math.max(30, Number(url.searchParams.get("n")) || 300))) };
        }
        if (parts[2] === "trades") return { trades: (await home.dex.trades(c, at, token)).slice(0, 60) };
        no(404, "no such thing on the desk");
      }
      // an orb sent to a token or a major (owner, 10-11: "user can input the contract address and view the coin + trade
      // manually or send a certain orb to trade it"): told in its chat to trade it from its account, in the same words
      // whether its account is on paper or real money ("we dont want the orbs to know the difference. money is money";
      // PLAN 5.34: you set which on its account, and each real order still waits for you, rule 9); it walks to the war
      // room's screen (desk.sent)
      if (method === "POST" && parts[1] === "send" && parts.length === 2) {
        const b = await body(req);
        const orb = text(b, "orb");
        if (!home.inbox.orb(orb)) no(404, `no orb "${orb}"`);
        const market = text(b, "market").trim();
        const token = readTokenKey(market);
        if (!token && !(SYMBOLS as readonly string[]).includes(market)) no(400, 'a market: a major, or a token as "solana:<mint>"');
        const budget = b.budget === undefined || b.budget === null || b.budget === "" ? null : Number(b.budget);
        if (budget !== null && !(budget >= 1 && budget <= 1_000_000)) no(400, "a budget of $1 to $1,000,000");
        const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
        const label = token ? ((await home.dex.token(token.chain, token.address).catch(() => []))[0]?.base.symbol ?? market) : market;
        const brief = [
          `Trade ${label} (${market}) for me${budget !== null ? `, with up to $${budget} of your account` : ""}.`,
          token ? `Read it first: token_info (chain ${token.chain}, address ${token.address}) and its chart (market_chart takes "${market}").` : `Read its chart first (market_chart, "${market}").`,
          `When you see an entry, place an order on "${market}" (place_order), and sell when your reason for it is gone.`,
          note && `My note: ${note}`,
          "Tell me what you see, what you did and why.",
        ].filter(Boolean).join(" ");
        const mode = home.desk.account(orb).mode;
        const item = home.inbox.send(orb, `chat:${orb}`, brief);
        home.events.append("desk.sent", { market, label, mode, budget }, { orb });
        return { sent: { orb, market, label, mode, budget }, item };
      }
      // your own paper trade (PLAN 5.38; owner, 10-11: "still cant decide what amount we want to paper trade... simulate
      // slippage etc."): as much as you say, filled as the market would fill it now (the router's quote for its size)
      if (method === "POST" && parts[1] === "paper" && parts.length === 2) {
        const b = await body(req);
        const market = text(b, "market").trim();
        if (!((SYMBOLS as readonly string[]).includes(market) || readTokenKey(market))) no(400, "a market the desk knows: a major by its symbol, or a coin as chain:address");
        if (b.side !== "buy" && b.side !== "sell") no(400, "a paper trade buys or sells");
        const r = await home.orders.paper(YOU, { market, side: b.side as "buy" | "sell", usd: Number(b.usd) });
        return { fill: { side: b.side, qty: r.qty, px: r.px, quoted: r.quoted, impact: r.impact, feeUsd: r.feeUsd, pnl: (r.trade as { pnl?: number } | null)?.pnl ?? null }, you: youOf(home) };
      }
      // an orb's account (PLAN 5.34): on paper, or real money up to the budget you give it; yours alone to set, here
      if (method === "PUT" && parts[1] === "accounts" && parts.length === 3) {
        const orb = decodeURIComponent(parts[2]!);
        if (orb !== YOU && !home.inbox.orb(orb)) no(404, `no orb "${orb}"`);
        const b = await body(req);
        if (b.mode !== "paper" && b.mode !== "real") no(400, "an account is on paper or real money");
        if (orb === YOU && b.mode !== "paper") no(400, "your own account here is paper: your real money is your wallet's");
        const budget = b.budget === undefined || b.budget === null || b.budget === "" ? undefined : Number(b.budget);
        const paper = b.paper === undefined || b.paper === null || b.paper === "" ? undefined : Number(b.paper);
        const a = home.desk.setAccount(orb, b.mode as "paper" | "real", budget, paper);
        return { account: { orb, mode: a.mode, budget: a.budget, paper: a.paper, cash: a.book.cash } };
      }
      if (method === "POST" && parts[1] === "backtest" && parts.length === 2) {
        const b = await body(req);
        // a strategy over the bars a chart shows (PLAN 5.32): what its rules read there and the trades they make
        if (b.bars !== undefined) {
          const problem = problemOf(b.strategy) ?? barsProblem(b.bars);
          if (problem) no(400, problem);
          const d = drawn(b.strategy as Strategy, b.bars as Parameters<typeof drawn>[1], home.clock.now());
          return { backtest: { metrics: d.metrics, trades: d.trades, series: d.series, bars: d.bars } };
        }
        const bt = await home.desk.backtest(b.strategy as Strategy);
        return { backtest: { metrics: bt.metrics, trades: bt.trades.slice(-200), equity: bt.equity.filter((_, i, all) => all.length <= 400 || i % Math.ceil(all.length / 400) === 0 || i === all.length - 1) } };
      }
      if (method === "POST" && parts[1] === "strategies" && parts.length === 2) {
        const b = await body(req);
        const bt = b.backtest === false ? null : await home.desk.backtest(b.strategy as Strategy).catch(() => null);
        return { strategy: home.desk.save(b.strategy as Strategy, null, bt) };
      }
      if (method === "DELETE" && parts[1] === "strategies" && parts.length === 3) {
        home.desk.archive(id(2));
        return { ok: true };
      }
      if (method === "POST" && parts[1] === "runs" && parts.length === 2) {
        const b = await body(req);
        const orb = text(b, "orb");
        if (!home.inbox.orb(orb)) no(404, `no orb "${orb}"`);
        return { book: await home.desk.run(Number(b.strategy), orb) };
      }
      if (method === "POST" && parts[1] === "books" && parts.length === 4 && parts[3] === "stop") return { book: await home.desk.stopAndSell(id(2)) };
      if (method === "PUT" && parts[1] === "settings" && parts.length === 2) return { settings: home.desk.setSettings((await body(req)) as Partial<Settings>) };
      if (method === "POST" && parts[1] === "wallets" && parts.length === 2) {
        const b = await body(req);
        return { wallet: home.wallets.add(text(b, "address"), { label: typeof b.label === "string" ? b.label : "", wallet: typeof b.wallet === "string" ? b.wallet : null }) };
      }
      if (method === "DELETE" && parts[1] === "wallets" && parts.length === 3) {
        home.wallets.remove(id(2));
        return { ok: true };
      }
      if (method === "GET" && parts[1] === "wallets" && parts.length === 4 && parts[3] === "holdings") return await home.wallets.holdings(id(2));
      if (method === "GET" && parts[1] === "quote") {
        const q = (k: string): string => url.searchParams.get(k) ?? "";
        return { quote: await home.swaps.quote({ chain: q("chain"), sell: q("sell"), buy: q("buy"), amount: q("amount") }) };
      }
      if (method === "POST" && parts[1] === "swaps" && parts.length === 2) {
        const b = await body(req);
        return { swap: await home.swaps.ask({ by: null, chain: text(b, "chain"), sell: text(b, "sell"), buy: text(b, "buy"), amount: text(b, "amount") }) };
      }
      if (method === "POST" && parts[1] === "swaps" && parts.length === 4) {
        const b = await body(req);
        if (parts[3] === "answer") return { swap: home.swaps.answer(id(2), b.yes === true) };
        if (parts[3] === "build") return await home.swaps.build(id(2), text(b, "from"));
        if (parts[3] === "sent") return { swap: home.swaps.sent(id(2), text(b, "tx")) };
        if (parts[3] === "unsent") return { swap: home.swaps.notSent(id(2), typeof b.why === "string" ? b.why : "the wallet did not send it") };
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      no(e instanceof DeskError || e instanceof SwapError || e instanceof WalletError ? 409 : 502, e);
    }
  }
  // the little things found in the office, kept
  if (method === "GET" && url.pathname === "/me/keepsakes") return { keepsakes: home.about.keepsakes() };
  if (method === "PUT" && url.pathname === "/me/keepsakes") {
    try {
      return { keepsakes: home.about.keep(text(await body(req), "id")) };
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  // the recruiter (PLAN 5.8): the positions you are hiring for, who applied, an interview, hire or pass
  if (method === "GET" && url.pathname === "/recruiter") return home.recruiting();
  if (method === "PUT" && parts[0] === "recruiter" && parts[1] === "positions" && parts.length === 2) {
    // several at once: All, or a department's all (owner, 10-07)
    const b = await body(req);
    if (!Array.isArray(b.specialties) || !b.specialties.every((s) => typeof s === "string")) throw new HttpError(400, "specialties: a list of kinds of work");
    // hiring opens once the founding three are in, and money with a CFO (PLAN 5.13)
    const office = home.inbox.orbs().map((o) => o.specialty);
    const closed = b.open === true ? (b.specialties as string[]).map((s) => whyNot(s, office)).find(Boolean) : null;
    if (closed) throw new HttpError(409, closed);
    try {
      return { positions: home.recruiter.setPositions(b.specialties as string[], b.open === true) };
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  if (method === "PUT" && parts[0] === "recruiter" && parts[1] === "positions" && parts.length === 3) {
    const b = await body(req);
    const why = b.open === true ? whyNot(decodeURIComponent(parts[2]!), home.inbox.orbs().map((o) => o.specialty)) : null;
    if (why) throw new HttpError(409, why);
    try {
      return { positions: home.recruiter.setPosition(decodeURIComponent(parts[2]!), b.open === true) };
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }
  if (parts[0] === "applicants" && parts.length === 3 && /^\d+$/.test(parts[1]!)) {
    const id = Number(parts[1]);
    try {
      if (method === "GET" && parts[2] === "interview") return { said: home.recruiter.interview(id) };
      if (method === "POST" && parts[2] === "interview") {
        const b = await body(req);
        const who = { name: text(b, "name").slice(0, 40), title: text(b, "title").slice(0, 60), focus: text(b, "focus").slice(0, 200), tone: text(b, "tone").slice(0, 200) };
        return { answer: await home.interview(id, who, text(b, "text")) };
      }
      if (method === "POST" && parts[2] === "hire") {
        const b = await body(req);
        const look = b.look && typeof b.look === "object" && !Array.isArray(b.look) ? (b.look as Record<string, unknown>) : {};
        return { orb: home.hireApplicant(id, { id: text(b, "id"), name: text(b, "name"), look }) };
      }
      if (method === "POST" && parts[2] === "pass") {
        home.recruiter.pass(id);
        return { passed: id };
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof SpendCapError) throw new HttpError(402, e.message);
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // the company's board (PLAN 5.16): who sits, its last election, its proposals and their votes; a proposal put to it
  // (each member votes on the cheapest brain, the votes coming as events); an election now
  if (method === "GET" && url.pathname === "/board") {
    const seats = home.boardroom.seats();
    return { size: seats.length, seats, election: home.boardroom.lastElection(), proposals: home.boardroom.proposals() };
  }
  if (method === "POST" && url.pathname === "/board/proposals") {
    const t = text(await body(req), "text");
    if (t.length > 600) throw new HttpError(400, "a proposal is 600 letters at most: say it in a few lines");
    if (!home.boardroom.seats().length) throw new HttpError(409, "there is no board yet: appoint your CEO first");
    void home.boardroom.propose(t, "founder").catch(() => undefined); // its votes come as board.* events
    return { put: true };
  }
  if (method === "POST" && url.pathname === "/board/election") return { election: home.boardroom.elect() };
  // the board's daily report (PLAN 5.18): the last week's, newest first; one made now (the day's own comes at 08:00);
  // your verdict on an idea (approved gives its orb XP, once)
  if (method === "GET" && url.pathname === "/reports") return { reports: home.reports.list() };
  if (method === "POST" && url.pathname === "/reports") {
    if (!home.inbox.orbs().length) throw new HttpError(409, "there is no one to report yet: appoint your CEO first");
    void home.reports.make().catch(() => undefined); // it comes as a report.made event
    return { making: true };
  }
  const idea = /^\/reports\/ideas\/(\d+\.\d+)\/(approve|pass)$/.exec(url.pathname);
  if (method === "POST" && idea) {
    try {
      return { idea: home.reports.judge(idea[1]!, idea[2] === "approve" ? "approved" : "passed") };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // the home page's look at the office (owner, 10-07: "a nice home page the app can default to ... with a nice dashboard
  // and stats"): by code, no brain asked
  if (method === "GET" && url.pathname === "/dashboard") return dashboardOf(home);
  // the numbers behind the home page, as charts (PLAN 2.19): the last 7, 14 or 30 days
  if (method === "GET" && url.pathname === "/stats") return statsOf(home, Number(url.searchParams.get("days") ?? 7));
  // the org chart (PLAN 5.6): who is in the office, at what level, how long, and who leads each kind of work
  if (method === "GET" && url.pathname === "/org") {
    const now = home.clock.now();
    const team = home.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: levelOf(home.events, o.id), createdAt: o.createdAt, xp: home.xp.of(o.id, now).total }));
    const { chief, bySpecialty } = leadsOf(team);
    // who is away, the most qualified first (school, PLAN 5.7: a diploma counts, never promotes): level, diplomas, XP
    const away = home.inbox.orbs({ all: true }).filter((o) => o.letGoAt !== null)
      .map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: levelOf(home.events, o.id), createdAt: o.createdAt, ...tenureOf(home.events, o), now,
        xp: home.xp.of(o.id, now).total, diplomas: home.school.diplomas(o.id).map((d) => d.name), atSchool: home.school.term(o.id) !== null }))
      .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.diplomas.length - a.diplomas.length || b.xp - a.xp);
    // the departments' heads (owner, 10-07) and you, the Founder
    return { chief, leads: Object.fromEntries(bySpecialty), heads: headsOf(team), founder: home.about.get().name, company: home.about.get().company, orbs: team.map((m) => ({ ...m, ...tenureOf(home.events, home.inbox.orb(m.id)!), now })), away };
  }
  // a career page (PLAN 5.6): read off the log by code
  if (method === "GET" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "career") {
    const orb = decodeURIComponent(parts[1]!);
    const who = home.inbox.orb(orb);
    if (!who) throw new HttpError(404, `no orb "${orb}"`);
    const now = home.clock.now();
    const promoted = home.events.ofType("habit.promoted").filter((e) => e.orb === orb);
    return {
      level: levelOf(home.events, orb), xp: home.xp.of(orb, now).total, next: nextFor(home.events, orb, { specialty: who.specialty, now }),
      ...tenureOf(home.events, who), now,
      radar: radarOf(home.events, orb), niches: nichesOf(home.events, orb),
      habits: habitsOf(home.events, home.dataDir, orb).map((h) => {
        const shared = promoted.find((e) => e.data.kind === h.key && Number(e.data.version) === h.version)?.data.shared as { from?: string } | undefined;
        return { task: h.task, version: h.version, shared: shared?.from ? { from: home.inbox.orb(shared.from)?.name ?? shared.from } : null };
      }),
      reviews: {
        given: home.events.ofType("board.ticked").filter((e) => e.data.reviewer === orb).length,
        received: home.events.ofType("board.review_asked").filter((e) => e.data.by === orb).length,
      },
      performance: home.events.ofType("performance.card").findLast((e) => e.orb === orb)?.data ?? null,
      // its growth with the others (owner, 10-07: "put it in the career section too, its where we see the orbs
      // growth"): its latest work, its meetings and the ideas traded in them, its friends, the lessons passed
      work: recentWork(home.events, orb, { limit: 6 }),
      // the office by XP, the most first (owner, 10-07: each wants "to be the best orb ... get xp and please the user")
      ranking: home.ranking(),
      meetings: home.events.ofType("social.met").filter((e) => e.data.a === orb || e.data.b === orb).slice(-8).reverse().map((e) => {
        const other = String(e.data.a === orb ? e.data.b : e.data.a);
        const ideas = (Array.isArray(e.data.ideas) ? e.data.ideas : []) as { orb: string; text: string }[];
        return {
          at: e.at, with: home.inbox.orb(other)?.name ?? other, kind: String(e.data.kind), place: String(e.data.place), word: String(e.data.word ?? ""), delta: Number(e.data.delta ?? 0),
          won: e.data.winner ? e.data.winner === orb : null,
          brought: ideas.find((i) => i.orb === orb)?.text ?? null, heard: ideas.find((i) => i.orb === other)?.text ?? null,
        };
      }),
      friends: home.social.of(orb).map((f) => ({ name: f.name, word: f.word, score: f.score, meetings: f.meetings })),
      lessons: (["waiting", "kept", "dropped"] as const).flatMap((st) => home.social.lessons(st)).filter((l) => l.from === orb || l.to === orb).sort((a, b) => b.at - a.at).slice(0, 6).map((l) => ({
        at: l.at, from: home.inbox.orb(l.from)?.name ?? l.from, to: home.inbox.orb(l.to)?.name ?? l.to, line: l.line, state: l.state,
      })),
    };
  }
  if (method === "POST" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "rehire") return { orb: home.rehire(decodeURIComponent(parts[1]!)) };
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
    // deleting a session (owner, 10-06: "give the user ability to delete sessions")
    if (method === "DELETE" && parts.length === 2) {
      if (!home.team.get(id)) throw new HttpError(404, `no session ${parts[1]}`);
      await home.team.remove(id);
      return { deleted: id };
    }
    // the team's board (PLAN 5.1, 5.2): its plans row by row, who holds what, the reviews waiting
    // and the changes proposed, and the chatter written from it all by code
    if (method === "GET" && parts.length === 3 && parts[2] === "board") {
      if (!home.team.get(id)) throw new HttpError(404, `no session ${parts[1]}`);
      const plans = home.plans.list().filter((p) => parseTabConversation(p.conversation)?.id === id);
      const nameOf = (o: string): string => (o === "you" ? "You" : (home.inbox.orb(o)?.name ?? o));
      return {
        plans: plans.map((p) => ({ id: p.id, title: p.title, status: p.status, rows: home.board.rows(p.id), changes: home.amendments.list(p.id) })),
        claims: home.claims.live(id).map((c) => ({ ...c, name: nameOf(c.orb) })),
        chatter: chatterOf(home.events, id, { plans: plans.map((p) => p.id), nameOf }),
      };
    }
    // a claim gone stale (90 minutes without a sign of him), let go by you
    if (method === "POST" && parts.length === 5 && parts[2] === "claims" && parts[4] === "recover") {
      return asked(() => {
        home.claims.recover(id, Number(parts[3]), "you");
        return { claims: home.claims.live(id) };
      });
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
  // a change an orb proposed to a plan, seconded by you (PLAN 5.1): ✓ Agreed, and the board has its row
  if (method === "POST" && parts[0] === "amendments" && parts.length === 3 && parts[2] === "agree") {
    try {
      const m = home.amendments.agree(Number(parts[1]), "you", (x) => home.board.add(x.plan, x.row, `${x.feature}: ${x.description}`, x.test));
      const plan = home.plans.get(m.plan);
      const by = home.inbox.orb(m.proposer)?.name ?? m.proposer;
      if (plan) home.conversations.add({ conversation: plan.conversation, orb: "you", role: "notice", content: `✓ Agreed: row ${m.row}, ${m.feature} (proposed by ${by}, seconded by you)`, meta: { agreed: `row ${m.row}: ${m.feature}`, amendment: m.id } });
      return { change: m };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // your review of a junior's row (PLAN 5.4): approved, it is ticked; or changes asked, with your note
  if (method === "POST" && parts[0] === "plans" && parts.length === 5 && parts[2] === "rows" && parts[4] === "review") {
    const b = await body(req);
    const planId = Number(parts[1]);
    const row = decodeURIComponent(parts[3]!);
    const approve = b.approve === true;
    const note = typeof b.note === "string" ? b.note.slice(0, 2000).trim() : "";
    try {
      const rows = home.board.review(planId, row, "you", approve, note);
      const plan = home.plans.get(planId);
      if (plan) home.conversations.add({ conversation: plan.conversation, orb: "you", role: "notice", content: approve ? `You approved row ${row}: it is done [x].` : `You asked for changes on row ${row}${note ? `: ${note}` : ""}.`, meta: { board: true } });
      return { board: rows };
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  // about you: what the office calls you
  if (method === "GET" && url.pathname === "/me") return { me: home.about.get() };
  if (method === "PUT" && url.pathname === "/me") {
    try {
      // your name, your company's name (owner, 10-07), what it can spend (PLAN 5.20, owner 10-08), or any of them
      const b = await body(req);
      if (typeof b.company === "string") home.about.setCompany(b.company);
      if (b.budget !== undefined) home.about.setBudget(b.budget);
      return { me: typeof b.name === "string" || (b.company === undefined && b.budget === undefined) ? home.about.setName(text(b, "name")) : home.about.get() };
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
      if (!existsSync(file)) throw new HttpError(404, "nothing has been looked at yet");
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
      if (!home.computers.takenOver(orb)) throw new HttpError(409, "take the computer over first");
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
        else throw new HttpError(404, `no ${parts[3]} for this computer`);
      } catch (e) {
        throw e instanceof ComputerError ? new HttpError(400, e.message) : e;
      }
      return state();
    }
  }
  // his lesson (PLAN 4.4): the one he is giving, and your hand in it
  if (parts[0] === "orbs" && parts[2] === "lesson" && (parts.length === 3 || parts.length === 4)) {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    const state = (): Record<string, unknown> | null => {
      const c = home.lessons.current(orb);
      return c ? { ...c.lesson, step: c.step } : null;
    };
    try {
      if (method === "GET" && parts.length === 3) return { lesson: state() };
      if (method === "POST" && parts[3] === "next") {
        home.lessons.next(orb);
        return { lesson: state() };
      }
      if (method === "POST" && parts[3] === "stop") {
        home.lessons.end(orb, "stopped by you");
        return { lesson: null };
      }
      if (method === "POST" && parts[3] === "answer") {
        const b = await body(req);
        return await home.lessons.answer(orb, text(b, "answer"), (b.facts && typeof b.facts === "object" ? b.facts : {}) as Record<string, unknown>);
      }
      if (method === "POST" && parts[3] === "explain") {
        const b = await body(req);
        return { say: await home.lessons.explain(orb, (b.facts && typeof b.facts === "object" ? b.facts : {}) as Record<string, unknown>) };
      }
    } catch (e) {
      throw e instanceof LessonError ? new HttpError(409, e.message) : e;
    }
  }
  // his voice and his ears (PLAN 4.3): Ash's, through the kit. The page records and plays; what he
  // says and what he hears are the home's
  if (method === "POST" && parts[0] === "orbs" && parts.length === 4 && parts[2] === "voice") {
    const orb = decodeURIComponent(parts[1]!);
    const who = home.inbox.orb(orb);
    if (!who) throw new HttpError(404, `no orb "${orb}"`);
    const kit = home.kit;
    if (!kit) throw new HttpError(503, "voices are the kit's, and the kit is not running");
    const ask = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
      try {
        return await kit.call(tool, args);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message.replace(/^.*?Error executing tool \w+: /, "") : String(e));
      }
    };
    if (parts[3] === "phrases" || parts[3] === "say") {
      const b = await body(req);
      const voice = typeof b.voice === "string" && b.voice ? b.voice : "ash";
      const speed = Math.min(1.5, Math.max(0.6, Number(b.speed) || 1));
      if (parts[3] === "phrases") return { phrases: await ask("voice_phrases", { text: text(b, "text").slice(0, 20_000), voice, speed }) };
      const said = (await ask("voice_say", { phrase: text(b, "phrase").slice(0, 2000), voice, speed })) as { wav: string };
      const wav = Buffer.from(said.wav, "base64");
      res!.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res!.end(wav);
      return STREAMING;
    }
    if (parts[3] === "hear" || parts[3] === "woken" || parts[3] === "finished" || parts[3] === "turn" || parts[3] === "overlap") {
      const audio = (await rawBody(req, VOICE_CAP)).toString("base64");
      if (!audio) throw new HttpError(400, "the recording is empty");
      if (parts[3] === "finished") return await ask("voice_finished", { audio });
      // what he was saying while you spoke over him (PLAN 4.7): his own words back through the microphone are not yours
      if (parts[3] === "overlap") return await ask("voice_overlap", { audio, name: who.name, saying: (url.searchParams.get("saying") ?? "").slice(0, 2000) });
      return await ask(`voice_${parts[3]}`, { audio, name: who.name });
    }
  }
  // a command the person types into his terminal, once they have his computer (PLAN 4.6)
  if (method === "POST" && parts[0] === "orbs" && parts.length === 3 && parts[2] === "terminal") {
    const orb = decodeURIComponent(parts[1]!);
    if (!home.inbox.orb(orb)) throw new HttpError(404, `no orb "${orb}"`);
    if (!home.computers.takenOver(orb)) throw new HttpError(409, "take the computer over first");
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
    // a session he works in (PLAN 5.1): the team's shared workspace, never one he is not part of
    const asked = url.searchParams.get("session");
    let root: string | undefined;
    if (asked !== null) {
      const s = home.team.get(Number(asked));
      if (!s || ![...s.brainstorm, ...s.floor].includes(orb)) throw new HttpError(404, `${orb} does not work session ${asked}`);
      root = home.sessionWorkspace(s.id);
    }
    try {
      if (parts.length === 3) return { entries: listWorkspace(home.dataDir, orb, path, root) };
      if (parts.length === 4 && parts[3] === "file") return { file: readWorkspace(home.dataDir, orb, path, root) };
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
        // said aloud (PLAN 4.7): he answers in plain spoken English, for the ear
        return { item: home.inbox.send(orb, conversation, text(b, "text"), { said: b.said === true }) };
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

/** Your own paper account (PLAN 5.38): how much it is, what it has to spend, what it holds and what that cost. */
function youOf(home: Home): { paper: number; cash: number; start: number; holdings: { symbol: string; qty: number; cost: number }[] } {
  const a = home.desk.account(YOU);
  return { paper: a.paper, cash: a.book.cash, start: a.book.cashStart, holdings: a.book.holdings.map((h) => ({ symbol: h.symbol, qty: h.qty, cost: h.cost })) };
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

/** The lesson's canvas (PLAN 4.4): Ash's teach/canvas.html, carried into the kit, served as it is with
 * a policy of its own: its one inline script allowed by its hash (computed from the file, so a
 * changed carry is a refused script, never a silently allowed one), framed only by the app. */
export function serveCanvas(res: ServerResponse): typeof STREAMING {
  const file = join(KIT_DIR, "ash", "teach", "canvas.html");
  if (!existsSync(file)) throw new HttpError(404, "the lesson canvas is not in the kit");
  const page = readFileSync(file, "utf8");
  const hashes = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; script-src ${hashes.join(" ") || "'none'"}; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(page);
  return STREAMING;
}
