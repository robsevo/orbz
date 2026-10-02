// The home's door: a small HTTP API on 127.0.0.1 for the terminal (PLAN 1.9), the app (2.4) and
// anything else on this machine that needs to reach a headless home. The database is locked to
// the home, so this is the only way in. A random port and a random token are written to
// `<data>/home.json`, readable only by the owner. Every request needs the token, and the Host
// header must name the loopback address, so a web page can't reach it by DNS rebinding.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Home } from "./home.ts";
import { UnknownOrbError } from "./inbox.ts";
import { KeyRefusedError } from "./brain/brains.ts";
import { SPECIALTY_FAMILIES, type Specialty } from "./brain/constitution.ts";
import { cookieOf, SESSION_COOKIE, Sessions } from "./sessions.ts";
import type { Tab } from "./team.ts";
import { standingContext } from "./agent/standing.ts";
import { listWorkspace, MissingError, OutsideError, readWorkspace } from "./workspace.ts";
import { calendarOf } from "./calendar.ts";
import { labOf, reopen } from "./lab.ts";
import { version } from "./version.ts";

export type HomeDoor = {
  port: number; token: string; file: string; close(): Promise<void>;
  /** A one-time link that opens the app on this machine, paired (PLAN 2.4): good for five minutes. */
  pairLink(): string;
};

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

export async function serve(home: Home, opts: { port?: number; appDir?: string } = {}): Promise<HomeDoor> {
  const token = randomBytes(24).toString("base64url");
  const want = Buffer.from(`Bearer ${token}`);
  const sessions = new Sessions(home.clock);
  const appDir = opts.appDir ?? APP_DIR;
  const server = createServer((req, res) => {
    handle(home, req, want, server.address(), res, { sessions, appDir })
      .then((body) => {
        if (body !== STREAMING) send(res, 200, body);
      })
      .catch((e: unknown) => {
        const status = e instanceof HttpError ? e.status : e instanceof UnknownOrbError ? 404 : 500;
        send(res, status, { error: e instanceof Error ? e.message : String(e) });
      });
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
  const port = (server.address() as { port: number }).port;
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the home's door has no port");
  const file = join(home.dataDir, "home.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, port: addr.port, token, version }, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
  return {
    port: addr.port,
    token,
    file,
    pairLink: () => `http://127.0.0.1:${port}/app/orbs.html#pair=${sessions.code()}`,
    close: () =>
      new Promise<void>((ok) => {
        rmSync(file, { force: true });
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

export const STREAMING = Symbol("streaming");

async function handle(
  home: Home,
  req: IncomingMessage,
  want: Buffer,
  addr: ReturnType<ReturnType<typeof createServer>["address"]>,
  res?: ServerResponse,
  door?: { sessions: Sessions; appDir: string },
): Promise<unknown> {
  const port = addr && typeof addr !== "string" ? addr.port : -1;
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    throw new HttpError(403, "the home only answers on the loopback address");
  }
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
    const id = door.sessions.redeem(text(await body(req), "code"));
    if (!id) throw new HttpError(401, "that pairing link is used or lapsed: start the home again, or ask it for a new one");
    res!.setHeader("set-cookie", `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}`);
    return { paired: true };
  }

  const got = Buffer.from(req.headers.authorization ?? "");
  const byToken = got.length === want.length && timingSafeEqual(got, want);
  const bySession = !byToken && Boolean(door?.sessions.valid(cookieOf(req.headers.cookie, SESSION_COOKIE)));
  if (!byToken && !bySession) throw new HttpError(401, "missing or wrong token (see home.json), or no session (open the pairing link)");
  // a change made with a session needs the app's own header: a page on another site cannot add it
  if (bySession && method !== "GET" && req.headers["x-orbs"] !== "1") throw new HttpError(403, "a change through a session needs the x-orbs header");

  if (method === "GET" && url.pathname === "/stream") return stream(home, req, res!, Number(url.searchParams.get("since") ?? 0));

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
      return { entries: calendarOf(home, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "") };
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
  // his computer (PLAN 2.8): what he is making, his workspace's folders and files, to read
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
  home.live.on("event", onEvent);
  home.live.on("text", onText);
  const beat = setInterval(() => res.write(": beat\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(beat);
    home.live.off("event", onEvent);
    home.live.off("text", onText);
  });
  return STREAMING;
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
