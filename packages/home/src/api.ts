// The home's door: a small HTTP API on 127.0.0.1 for the terminal (PLAN 1.9), the app (2.4) and
// anything else on this machine that needs to reach a headless home. The database is locked to
// the home, so this is the only way in. A random port and a random token are written to
// `<data>/home.json`, readable only by the owner. Every request needs the token, and the Host
// header must name the loopback address, so a web page can't reach it by DNS rebinding.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { Home } from "./home.ts";
import { UnknownOrbError } from "./inbox.ts";
import { version } from "./version.ts";

export type HomeDoor = { port: number; token: string; file: string; close(): Promise<void> };

const BODY_LIMIT = 64 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function serve(home: Home, opts: { port?: number } = {}): Promise<HomeDoor> {
  const token = randomBytes(24).toString("base64url");
  const want = Buffer.from(`Bearer ${token}`);
  const server = createServer((req, res) => {
    handle(home, req, want, server.address())
      .then((body) => send(res, 200, body))
      .catch((e: unknown) => {
        const status = e instanceof HttpError ? e.status : e instanceof UnknownOrbError ? 404 : 500;
        send(res, status, { error: e instanceof Error ? e.message : String(e) });
      });
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
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
    close: () =>
      new Promise<void>((ok) => {
        rmSync(file, { force: true });
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

async function handle(home: Home, req: IncomingMessage, want: Buffer, addr: ReturnType<ReturnType<typeof createServer>["address"]>): Promise<unknown> {
  const port = addr && typeof addr !== "string" ? addr.port : -1;
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    throw new HttpError(403, "the home only answers on the loopback address");
  }
  const got = Buffer.from(req.headers.authorization ?? "");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "missing or wrong token (see home.json)");

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/status") {
    return {
      version,
      pid: process.pid,
      dataDir: home.dataDir,
      loopsOff: home.loops.disabledReason(),
      orbs: home.inbox.orbs().map((o) => ({ ...o, queued: home.inbox.queued(o.id).length })),
    };
  }
  if (method === "GET" && url.pathname === "/events") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 200));
    if (!Number.isInteger(since) || !Number.isInteger(limit) || limit < 1) throw new HttpError(400, "since and limit are whole numbers");
    return { events: home.events.since(since, limit) };
  }
  if (method === "POST" && url.pathname === "/orbs") {
    const b = await body(req);
    return { orb: home.inbox.addOrb(text(b, "id"), text(b, "name")) };
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
