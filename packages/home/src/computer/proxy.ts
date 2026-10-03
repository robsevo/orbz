// The way out for every orb's browser (PLAN 4.1): a small proxy in the home that every
// connection the browser makes goes through, checked the way the web tools check theirs
// (agent/net.ts): the name is resolved HERE, every address it has must be public, and the
// connection is made to the address that was checked. A page can name the home's own door, a
// router on your network or a cloud's metadata address, by IP or by a name that answers public
// once and private the next time (DNS rebinding); none of them is reached.
//
// The browser is told to send everything here, loopback included (`<-loopback>`), and QUIC and
// WebRTC's direct UDP are off (they would not come here). Another program borrowing it gets
// nothing it lacks: the proxy only ever reaches public addresses.
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import { checkUrl } from "../agent/net.ts";

export type Blocked = { host: string; why: string };

export type GuardedProxy = {
  /** For Playwright's `proxy` option. */
  server: string;
  close: () => Promise<void>;
};

const REFUSED = (why: string): string => `HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n${why}\n`;

/** host:port from a CONNECT line, IPv6 brackets kept off the host. */
function target(authority: string): { host: string; port: number } | null {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(authority.trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1]!, port } : null;
}

export async function startProxy(onBlocked: (b: Blocked) => void = () => {}): Promise<GuardedProxy> {
  const sockets = new Set<Socket>();
  const track = (s: Socket): void => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  };

  /** The address to connect to, or why not: the web tools' own check (agent/net.ts), resolved here. */
  const allowed = async (host: string, port: number): Promise<{ ok: true; address: string } | { ok: false; why: string }> => {
    const shown = net.isIPv6(host) ? `[${host}]` : host;
    const c = await checkUrl(`http://${shown}:${port}/`);
    if (c.ok) return c;
    onBlocked({ host, why: c.reason });
    return { ok: false, why: c.reason };
  };

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // plain http, asked for in absolute form: http://host/path
    let u: URL;
    try {
      u = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("a proxy request names its whole address\n");
      return;
    }
    if (u.protocol !== "http:") {
      res.writeHead(400).end("only http goes through here as a request; https goes as CONNECT\n");
      return;
    }
    const port = Number(u.port || 80);
    const ok = await allowed(u.hostname.replace(/^\[|\]$/g, ""), port);
    if (!ok.ok) {
      res.writeHead(403, { "content-type": "text/plain" }).end(`${ok.why}\n`);
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    const up = http.request({ host: ok.address, port, method: req.method, path: `${u.pathname}${u.search}`, headers, setHost: false }, (r) => {
      const back = { ...r.headers };
      delete back.connection; // this hop's, not the page's
      delete back["keep-alive"];
      res.writeHead(r.statusCode ?? 502, back);
      r.pipe(res);
    });
    up.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`${e.message}\n`);
    });
    req.pipe(up);
  });

  // https and wss: a tunnel, opened only to an address that passed
  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    const t = target(req.url ?? "");
    if (!t) {
      client.end(REFUSED("a tunnel names host:port"));
      return;
    }
    const ok = await allowed(t.host, t.port);
    if (!ok.ok) {
      client.end(REFUSED(ok.why));
      return;
    }
    const up = net.connect(t.port, ok.address, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    track(up);
    up.on("error", () => client.destroy());
    client.on("close", () => up.destroy());
  });

  // ws:// over plain http
  server.on("upgrade", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    let u: URL;
    try {
      u = new URL(req.url ?? "");
    } catch {
      client.end(REFUSED("a proxy request names its whole address"));
      return;
    }
    const port = Number(u.port || 80);
    const ok = await allowed(u.hostname.replace(/^\[|\]$/g, ""), port);
    if (!ok.ok) {
      client.end(REFUSED(ok.why));
      return;
    }
    const up = net.connect(port, ok.address, () => {
      const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!;
        if (/^proxy-connection$/i.test(k)) continue;
        lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
      }
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    track(up);
    up.on("error", () => client.destroy());
    client.on("close", () => up.destroy());
  });

  server.on("connection", track);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the browser's proxy could not listen");
  return {
    server: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((ok) => {
        for (const s of sockets) s.destroy();
        server.close(() => ok());
      }),
  };
}
