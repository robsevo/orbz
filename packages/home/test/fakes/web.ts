// The stand-in web for his computer's tests (PLAN 4.1): one server on this machine, reached by the
// names the guard's resolver seam gives it (shop.test, login.test, evil.test), plus canaries that
// count any request the guard should have stopped (intranet.test: this machine, spelt the IPv6 way,
// which the guard refuses; and 127.0.0.2 where this machine has it).
import { createServer } from "node:http";
import type { TestContext } from "node:test";
import { _setAddressPolicy, _setResolver, blockedAddress } from "../../src/agent/net.ts";

export type Site = { url: (host: string, path: string) => string; orders: number; payments: number; sessions: { user: string; pass: string }[]; leaks: number; loopLeaks: number | null };

/** The stand-in web: one server, reached by the names the resolver gives it. */
export async function web(t: TestContext): Promise<Site> {
  const s: Site & { port: number; loop: number | null } = { url: () => "", orders: 0, payments: 0, sessions: [], leaks: 0, loopLeaks: null, port: 0, loop: null };
  // a second canary on 127.0.0.2, where this machine has one (Linux): loopback that is NOT let
  // through, so a browser that went round the proxy for loopback would be heard
  const loop = createServer((_req, res) => {
    s.loopLeaks = (s.loopLeaks ?? 0) + 1;
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => {
    loop.once("error", () => ok());
    loop.listen(0, "127.0.0.2", () => {
      s.loop = (loop.address() as { port: number }).port;
      s.loopLeaks = 0;
      ok();
    });
  });
  t.after(() => {
    loop.closeAllConnections();
    loop.close();
  });
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d: Buffer) => (body += d.toString()));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      const page = (title: string, b: string): void => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><head><title>${title}</title></head><body>${b}</body></html>`);
      };
      const host = String(req.headers.host ?? "").split(":")[0];
      if (u.pathname === "/x") s.leaks++;
      switch (`${req.method} ${u.pathname}`) {
        case "GET /shop":
          return page("Shop", `<h1>Shop</h1><button>Add to cart</button><button>I agree</button><form method="post" action="/order"><button>Place order</button></form><form method="post" action="/pay"><button>Continue to payment</button></form><a href="/about">About us</a>`);
        case "GET /checkout":
          return page("Checkout", `<form><label>Card number <input name="cc"></label><label>Note <input name="note"></label></form>`);
        case "POST /order":
          s.orders++;
          return page("Thanks", "<p>Order placed.</p>");
        case "POST /pay":
          s.payments++;
          return page("Paid", "<p>Paid.</p>");
        case "GET /about":
          return page("About", "<p>We sell things.</p>");
        case "GET /login":
          return page(`Sign in to ${host}`, `<form method="post" action="/session"><label>Username <input name="username" autocomplete="username"></label><label>Password <input type="password" name="password"></label><button>Sign in</button></form>`);
        case "POST /session": {
          const p = new URLSearchParams(body);
          s.sessions.push({ user: p.get("username") ?? "", pass: p.get("password") ?? "" });
          // shown back, but never to be kept: no-store, as a page showing a secret sends (so the
          // browser checks see only what HIS browser keeps of its own, never the site's cached page)
          res.setHeader("cache-control", "no-store");
          return page("Welcome", `<p>Welcome ${p.get("username")}. Your password is ${p.get("password")}.</p>`);
        }
        case "GET /cookie":
          return page("Cookie", `<p id="c"></p><script>document.getElementById("c").textContent = "cookie: " + (document.cookie || "none"); document.cookie = "seen=1; max-age=86400; path=/";</script>`);
        case "GET /download":
          return page("Files", `<a href="/file">Get the file</a>`);
        case "GET /file":
          res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="../../evil.txt"' });
          return res.end("file body");
        case "GET /leak":
          return page("Leaky", `<p>Leaky</p><img src="http://intranet.test:${s.port}/x?img"><img src="http://[::ffff:127.0.0.1]:${s.port}/x?literal">${s.loop ? `<img src="http://127.0.0.2:${s.loop}/x?loop">` : ""}<script>fetch("http://intranet.test:${s.port}/x?fetch").catch(() => {})</script>`);
        default:
          res.writeHead(404);
          res.end();
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  s.port = (server.address() as { port: number }).port;
  s.url = (host, path) => `http://${host}:${s.port}${path}`;
  // the guard's seams, in this process only: the stand-in names are this machine, and this
  // machine's 127.0.0.1 is let through; intranet.test is this machine too, spelt the IPv6 way,
  // which the guard still refuses (a canary: a request that got past it would be counted)
  const resolve = _setResolver(async (h) =>
    h === "intranet.test" ? [{ address: "::ffff:127.0.0.1", family: 6 }] : h.endsWith(".test") ? [{ address: "127.0.0.1", family: 4 }] : [],
  );
  const policy = _setAddressPolicy((ip) => ip !== "127.0.0.1" && blockedAddress(ip));
  t.after(() => {
    _setResolver(resolve);
    _setAddressPolicy(policy);
    server.closeAllConnections();
    server.close();
  });
  return s;
}
