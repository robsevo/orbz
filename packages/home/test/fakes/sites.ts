// The stand-in sites for the reading library (PLAN 3.12): one local server reached by made-up names
// through the guard's resolver seam, every request logged. docs.test is a site with a robots.txt (a
// Disallow, a Crawl-delay, a Sitemap) and pages that each test one manner (an ETag, a redirect in and
// out of reach, a canonical copy, noindex by meta and by header, nofollow, a PDF, a page that goes);
// busy.test answers 429; big.test has forty pages; down.test cannot serve its robots.txt;
// intranet.test resolves to a private address; evil.test is another site that must never be read.
import { createServer } from "node:http";
import type { TestContext } from "node:test";
import { _setAddressPolicy, _setResolver, blockedAddress } from "../../src/agent/net.ts";

export type Req = { host: string; path: string; ua: string; inm: string | null };

/** The stand-in sites, on one local server; intranet.test resolves to a private address. */
export async function sites(t: TestContext) {
  const log: Req[] = [];
  const state = { bVersion: 1, goneGone: false };
  let port = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host ?? "").split(":")[0]!;
    const path = req.url ?? "/";
    log.push({ host, path, ua: String(req.headers["user-agent"] ?? ""), inm: (req.headers["if-none-match"] as string | undefined) ?? null });
    const at = (h: string, p: string): string => `http://${h}:${port}${p}`;
    const html = (title: string, body: string, head = "", headers: Record<string, string> = {}): void => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(`<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`);
    };
    const text = (status: number, body: string, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": "text/plain", ...headers });
      res.end(body);
    };
    if (host === "docs.test") {
      switch (path) {
        case "/robots.txt":
          return text(200, `User-agent: *\nDisallow: /guide/private/\nCrawl-delay: 7\nSitemap: ${at("docs.test", "/sitemap.xml")}\n`);
        case "/sitemap.xml":
          res.writeHead(200, { "content-type": "application/xml" });
          return res.end(`<urlset><url><loc>${at("docs.test", "/guide/from-sitemap")}</loc></url><url><loc>${at("docs.test", "/other/not-in-reach")}</loc></url></urlset>`);
        case "/guide/":
          return html("The guide", `<p>Welcome to the guide.</p>
            <a href="a">A</a> <a href="b">B</a> <a href="private/x">private</a> <a href="/other/y">other</a>
            <a href="${at("evil.test", "/guide/")}">elsewhere</a> <a href="a#frag">A again</a> <a href="c" rel="nofollow">C</a>
            <a href="redirect">moved</a> <a href="redirect-out">moved away</a> <a href="canon">copy</a> <a href="noindex">secret</a>
            <a href="nofollow-page">nf</a> <a href="xrobots">xr</a> <a href="file.pdf">pdf</a> <a href="gone">gone</a>`);
        case "/guide/a":
          if (req.headers["if-none-match"] === '"a1"') {
            res.writeHead(304, { etag: '"a1"' });
            return res.end();
          }
          return html("Alpha", "<p>Alpha is about event loops and coroutines.</p>", "", { etag: '"a1"' });
        case "/guide/b":
          return html("Bravo", `<p>Bravo version ${state.bVersion} of the release notes.</p>`);
        case "/guide/redirect":
          res.writeHead(301, { location: "/guide/d" });
          return res.end();
        case "/guide/d":
          return html("Delta", "<p>Delta, reached through a redirect.</p>");
        case "/guide/redirect-out":
          res.writeHead(301, { location: "/other/z" });
          return res.end();
        case "/guide/canon":
          return html("A copy of Alpha", "<p>A copy.</p>", `<link rel="canonical" href="/guide/a">`);
        case "/guide/noindex":
          return html("Not for keeping", "<p>zebra words</p>", `<meta name="robots" content="noindex">`);
        case "/guide/nofollow-page":
          return html("No following", `<p>Nofollow page.</p><a href="hidden">hidden</a>`, `<meta name="robots" content="nofollow">`);
        case "/guide/xrobots":
          return html("Header noindex", "<p>xylophone words</p>", "", { "x-robots-tag": "noindex" });
        case "/guide/file.pdf":
          res.writeHead(200, { "content-type": "application/pdf" });
          return res.end("%PDF-1.4 not text");
        case "/guide/gone":
          return state.goneGone ? text(404, "gone") : html("Gone soon", "<p>Here today.</p>");
        case "/guide/from-sitemap":
          return html("From the sitemap", "<p>Only the sitemap links here.</p>");
        default:
          return text(404, "not here");
      }
    }
    if (host === "busy.test") {
      if (path === "/robots.txt") return text(404, "none");
      return text(429, "slow down", { "retry-after": String(2 * 86_400) });
    }
    if (host === "big.test") {
      if (path === "/robots.txt") return text(200, "User-agent: *\nAllow: /\n");
      if (path === "/many/") return html("Many", Array.from({ length: 40 }, (_, i) => `<a href="p${i + 1}">${i + 1}</a>`).join(" "));
      return html(`Page ${path}`, `<p>Page ${path}.</p>`);
    }
    if (host === "down.test") return text(500, "broken");
    return text(404, "unknown site");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  port = (server.address() as { port: number }).port;
  const prevPolicy = _setAddressPolicy((ip) => (ip === "127.0.0.1" ? false : blockedAddress(ip)));
  const prevResolver = _setResolver(async (host) => (host === "intranet.test" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]));
  t.after(() => {
    _setAddressPolicy(prevPolicy);
    _setResolver(prevResolver);
    server.closeAllConnections();
    server.close();
  });
  return { url: (host: string, path: string) => `http://${host}:${port}${path}`, log, state };
}

