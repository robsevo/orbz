// PLAN 3.12_t, the reading library on a real home, against stand-in sites (one local server reached by
// made-up names through the guard's resolver seam; every request logged):
//   - following a site reads it at once: robots.txt first, the sitemap, then the pages in reach, two
//     links deep; never a disallowed path, another site, a rel=nofollow link, a nofollow page's links,
//     an address a redirect points out of reach; a canonical copy, a noindex page (meta or header) and
//     a PDF are not kept; its honest name on every request, and the site's Crawl-delay between them;
//   - the next night, by the home's own timer: a page asked with its ETag answers 304 and is unchanged,
//     a changed page is reported changed, a gone one leaves, and the morning note says so;
//   - 429 ends a site's read and its Retry-After is kept; a read stops at its page cap; an unreachable
//     robots.txt and a private address are refused; closing the home ends a read at once;
//   - the tools: follow, search (fenced, dated), read, list, unfollow; web_search names the library's
//     pages; the door lists the sources, finds pages and stops one.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { TOOLS } from "../src/agent/tools.ts";
import { FakeClock } from "../src/clock.ts";
import { MIN_DELAY_MS, PAGES_PER_READ } from "../src/reading/reading.ts";
import { readingTools, withReading } from "../src/reading/tools.ts";
import { serve } from "../src/api.ts";
import { agentHome } from "./helpers.ts";
import { type Req, sites } from "./fakes/sites.ts";

/** A home whose reading library waits by moving the fake clock, and says each wait. */
async function readingHome(t: TestContext, clock: FakeClock, more: Record<string, unknown> = {}) {
  const waits: { ms: number; host: string | null }[] = [];
  let next: string | null = null;
  const { home, model } = await agentHome(t, [], {
    clock,
    reading: {
      sleep: async (ms: number) => {
        waits.push({ ms, host: next });
        clock.suspend(ms);
      },
    },
    ...more,
  });
  return { home, model, waits, about: (host: string) => (next = host) };
}

const pathsOf = (log: Req[], host: string): string[] => log.filter((r) => r.host === host).map((r) => r.path);

test("following a site: robots.txt first, the sitemap, the pages in reach; nothing it should not read; its name and its delay", async (t) => {
  const site = await sites(t);
  const clock = new FakeClock(new Date(2026, 9, 6, 14, 0).getTime());
  const { home, waits } = await readingHome(t, clock);
  home.inbox.addOrb("ada", "Ada", "research");
  const { source } = await home.reading.follow("ada", site.url("docs.test", "/guide/"), "the guide we build against");
  await home.reading.idle();

  const asked = pathsOf(site.log, "docs.test");
  assert.equal(asked[0], "/robots.txt", "robots.txt before anything else");
  assert.equal(asked.filter((p) => p === "/robots.txt").length, 1, "and once: kept for the day");
  for (const never of ["/guide/private/x", "/other/y", "/other/z", "/other/not-in-reach", "/guide/c", "/guide/hidden"]) {
    assert.ok(!asked.includes(never), `never asked for ${never}`);
  }
  assert.equal(pathsOf(site.log, "evil.test").length, 0, "another site is never read");
  for (const read of ["/sitemap.xml", "/guide/", "/guide/a", "/guide/b", "/guide/redirect", "/guide/d", "/guide/canon", "/guide/from-sitemap"]) {
    assert.ok(asked.includes(read), `read ${read}`);
  }
  assert.equal(new Set(asked).size, asked.length, "no address asked twice in a read");
  assert.ok(site.log.filter((r) => r.host === "docs.test").every((r) => r.ua.startsWith("OrbzReader/1.0 (")), "its honest name on every request");

  const kept = home.reading.sources()[0]!;
  assert.equal(kept.id, source.id);
  assert.equal(kept.title, "The guide", "the source is named by its page");
  const urls = ["/guide/", "/guide/a", "/guide/b", "/guide/d", "/guide/nofollow-page", "/guide/gone", "/guide/from-sitemap"].map((p) => site.url("docs.test", p));
  for (const u of urls) assert.ok(home.reading.page(u), `${u} is kept`);
  assert.equal(kept.pages, urls.length, "and nothing else: no canonical copy, no noindex page (meta or header), no PDF");
  assert.equal(home.reading.search("zebra").length, 0, "a noindex page's words are not in the library");
  assert.equal(home.reading.search("xylophone").length, 0, "nor an X-Robots-Tag: noindex page's");

  // a request at a time, the site's Crawl-delay (7 s, over the 5 s floor) between two to it
  assert.equal(waits.length, asked.length - 1, "a wait before every request but the first");
  assert.ok(waits.every((w) => w.ms >= 7_000), `every wait at least the Crawl-delay (${waits.map((w) => w.ms).join(", ")})`);
  const read = home.events.ofType("reading.read").at(-1)!;
  assert.equal(read.data.first, true);
  assert.equal(read.data.added, urls.length);
  assert.equal(home.notices.list().filter((n) => n.kind === "reading").length, 0, "a first read is no news: no notice");
});

test("the next night, by the home's own timer: 304 for a page asked with its ETag, a change reported, a gone page leaving; the morning note", async (t) => {
  const site = await sites(t);
  const clock = new FakeClock(new Date(2026, 9, 6, 14, 0).getTime());
  const { home } = await readingHome(t, clock, { heartbeatMs: 86_400_000 }); // only a due read wakes the home before 03:00
  home.inbox.addOrb("ada", "Ada", "research");
  await home.reading.follow("ada", site.url("docs.test", "/guide/"), "the guide");
  await home.reading.idle();
  const next = home.reading.nextAt()!;
  assert.equal(next, new Date(2026, 9, 7, 1, 0).getTime(), "read again the next night at 01:00");

  site.state.bVersion = 2;
  site.state.goneGone = true;
  site.log.length = 0;
  home.start();
  await clock.advance(next - clock.now() - 60_000); // 00:59: not yet
  await home.reading.idle();
  assert.equal(site.log.length, 0, "nothing read before its night");
  await clock.advance(2 * 60_000); // 01:01
  await home.reading.idle();
  const a = site.log.find((r) => r.path === "/guide/a")!;
  assert.equal(a.inm, '"a1"', "asked again with its ETag");
  assert.ok(!site.log.some((r) => r.path === "/sitemap.xml"), "the sitemap is read the first time only");
  const read = home.events.ofType("reading.read").at(-1)!;
  assert.equal(read.data.first, false);
  assert.equal(read.data.changed, 1, "Bravo changed");
  assert.equal(read.data.gone, 1, "the gone page left");
  assert.ok(Number(read.data.unchanged) >= 1, "Alpha's 304 and the unchanged pages");
  assert.deepEqual((read.data.changedPages as { title: string }[]).map((p) => p.title), ["Bravo"]);
  assert.equal(home.reading.page(site.url("docs.test", "/guide/gone")), null);
  assert.ok(home.reading.page(site.url("docs.test", "/guide/a"))!.readAt > next, "a 304 is a read: Alpha was read again tonight, unchanged");
  assert.match(home.reading.page(site.url("docs.test", "/guide/b"))!.text, /Bravo version 2/);
  const note = home.notices.list().find((n) => n.kind === "reading");
  assert.ok(note, "the morning note");
  assert.match(note.title, /^Ada's reading: 1 changed, 1 gone on docs\.test$/);
  assert.match(note.detail, /Bravo/);
});

test("429 ends a site's read and its Retry-After is kept; a read stops at its page cap; unreachable robots.txt and private addresses are refused", async (t) => {
  const site = await sites(t);
  const clock = new FakeClock(new Date(2026, 9, 6, 14, 0).getTime());
  const { home } = await readingHome(t, clock);
  home.inbox.addOrb("ada", "Ada", "research");

  await home.reading.follow("ada", site.url("busy.test", "/news/"), "news");
  await home.reading.idle();
  assert.deepEqual(pathsOf(site.log, "busy.test"), ["/robots.txt", "/news/"], "one 429, and nothing more of it");
  const busy = home.reading.sources().find((s) => s.host === "busy.test")!;
  assert.ok(busy.nextAt >= clock.now() + 2 * 86_400_000 - 1000, "not read again before its Retry-After (two days)");
  assert.match(busy.lastError ?? "", /asked to slow down \(HTTP 429\)/);

  await home.reading.follow("ada", site.url("big.test", "/many/"), "many pages");
  await home.reading.idle();
  const pages = pathsOf(site.log, "big.test").filter((p) => p !== "/robots.txt");
  assert.equal(pages.length, PAGES_PER_READ, `at most ${PAGES_PER_READ} asks a read`);

  await assert.rejects(home.reading.follow("ada", site.url("down.test", "/x/"), "down"), /robots\.txt could not be read/);
  assert.deepEqual(pathsOf(site.log, "down.test"), ["/robots.txt"], "nothing of a site is read while its robots.txt cannot be");
  await assert.rejects(home.reading.follow("ada", "http://intranet.test/wiki/", "inside"), /private or reserved address/);
  await assert.rejects(home.reading.follow("ada", "ftp://docs.test/x", "no"), /only an http or https address/);
  assert.equal(MIN_DELAY_MS, 5_000);
});

test("closing the home ends a read at once, and nothing of it is recorded as read", async (t) => {
  const site = await sites(t);
  const clock = new FakeClock(new Date(2026, 9, 6, 14, 0).getTime());
  // a wait that lasts until the home stops it
  const { home } = await agentHome(t, [], { clock, reading: { sleep: (_ms: number, signal: AbortSignal) => new Promise<void>((done) => (signal.aborted ? done() : signal.addEventListener("abort", () => done(), { once: true }))) } });
  home.inbox.addOrb("ada", "Ada", "research");
  const seen: string[] = [];
  home.live.on("event", (e: { type: string }) => seen.push(e.type)); // heard as it is written, the close included
  await home.reading.follow("ada", site.url("big.test", "/many/"), "many");
  for (let i = 0; i < 50 && !home.reading.readingNow(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(home.reading.readingNow(), "a read under way");
  const started = Date.now();
  await home.close();
  assert.ok(Date.now() - started < 5_000, "closed at once");
  assert.ok(seen.includes("reading.started"), "the read had started");
  assert.ok(!seen.includes("reading.read"), "a read stopped part way is not recorded as a read");
});

test("the tools: follow, search (fenced, dated), read, list, unfollow; web_search names the library's pages; the door", async (t) => {
  const site = await sites(t);
  const clock = new FakeClock(new Date(2026, 9, 6, 14, 0).getTime());
  const { home } = await readingHome(t, clock);
  home.inbox.addOrb("ada", "Ada", "research");
  const tools = Object.fromEntries(readingTools(home.reading, (orb) => home.inbox.orb(orb)?.name ?? orb).map((x) => [x.name, x]));
  const ctx = { orb: "ada", conversation: "chat:ada", workspace: "/tmp", background: {} } as never;
  const run = async (name: string, args: Record<string, unknown>) => (await tools[name]!.run!(args, ctx)).content;

  assert.match(await run("follow_source", { url: site.url("docs.test", "/guide/"), why: "the guide" }), /Following .*docs\.test.*The first read has started/s);
  await home.reading.idle();
  assert.match(await run("follow_source", { url: site.url("docs.test", "/guide/"), why: "again" }), /is followed already \(source #1, by Ada, 7 pages/);
  const private_ = await tools.follow_source!.run!({ url: "http://intranet.test/", why: "x" }, ctx);
  assert.equal(private_.isError, true);
  assert.match(private_.content, /^Not followed: .*private or reserved address/);

  assert.equal(tools.search_reading!.untrusted, "page", "what the library hands an orb came from outside: the turn is marked (1.6)");
  assert.equal(tools.read_reading!.untrusted, "page");
  const found = await run("search_reading", { query: "event loops" });
  assert.match(found, /1\. Alpha\n {3}http:\/\/docs\.test:\d+\/guide\/a\n {3}read 2026-10-06 · docs\.test \(source #1\)\n {3}.*«event» «loops»/);
  assert.match(found, /for anything newer than that, or not here, web_search/);
  assert.match(await run("search_reading", { query: "quantum gravity" }), /Nothing in the reading library matches "quantum gravity"\. Search the live web with web_search/);
  assert.match(await run("read_reading", { url: site.url("docs.test", "/guide/b") }), /Read 2026-10-06 · docs\.test \(source #1\)\nTitle: Bravo\n\nBravo version 1/);
  assert.match((await tools.read_reading!.run!({ url: site.url("docs.test", "/nope") }, ctx)).content, /does not have .* web_fetch reads it/);
  assert.match(await run("list_reading", {}), /^#1 docs\.test\/guide\/ · followed by Ada \(the guide\) · 7 pages · read 2026-10-06, next 2026-10-07$/);

  // web_search and the library help each other: the search says what the library has
  const search = withReading(TOOLS.find((x) => x.name === "web_search")!, home.reading);
  const said = (await search.run!({ query: "event loops" }, ctx)).content;
  assert.match(said, /web_search is not set up/, "the search's own answer first");
  assert.match(said, /Your office's reading library already has pages on this, read before and kept:\n- Alpha \(http:\/\/docs\.test:\d+\/guide\/a, read 2026-10-06\)/);
  assert.doesNotMatch((await search.run!({ query: "quantum gravity" }, ctx)).content, /reading library/, "nothing in the library: nothing said");

  // the door: the sources, what is read now, pages for a query; Stop following
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const got = (await call("GET", "/reading?q=release%20notes")).json as { sources: { id: number; pages: number }[]; now: unknown; hits: { title: string }[] };
  assert.deepEqual(got.sources.map((x) => [x.id, x.pages]), [[1, 7]]);
  assert.equal(got.now, null);
  assert.deepEqual(got.hits.map((h) => h.title), ["Bravo"]);
  assert.equal((await call("DELETE", "/reading/sources/1")).status, 200);
  assert.equal((await call("DELETE", "/reading/sources/1")).status, 404);
  assert.deepEqual(home.reading.sources(), []);
  assert.equal(home.reading.search("event loops").length, 0, "its pages left with it");
  assert.equal(home.events.ofType("reading.unfollowed").at(-1)!.data.by, "you");
  // followed again, it is read whole again: nothing of the old source was left behind to stand in its way
  await home.reading.follow("ada", site.url("docs.test", "/guide/"), "the guide, again");
  await home.reading.idle();
  assert.equal(home.reading.sources()[0]!.pages, 7, "all seven pages read and kept again");
});
