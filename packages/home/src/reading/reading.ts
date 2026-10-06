// The reading library (PLAN 3.12; owner, 10-06: "would a silent and non seen by the user webcrawler
// help with our research orbs?", then "just plan and build it to industry standards, we dont want
// anything breaking., and use the websearch to compliment and help please, they help each other not
// replace"). An orb follows a site worth keeping up with; the home reads it, quietly but never hidden:
// at once the first time, then each night, a page at a time.
//
// The manners are a crawler's by the book:
//   - an honest name (USER_AGENT; robots token `orbzreader`), and robots.txt obeyed (robots.ts, RFC
//     9309): fetched per origin and kept a day; a missing one (4xx) allows all, an unreachable one
//     (5xx, 429, no answer) forbids all until it can be read;
//   - one request at a time across the office, at least MIN_DELAY_MS between two to one site, longer
//     when its Crawl-delay asks (a site asking more than MAX_DELAY_MS is not read);
//   - 429 and 503 end that site's read, and its Retry-After is kept before the next;
//   - a page read before is asked again with its validators (If-None-Match, If-Modified-Since), so an
//     unchanged page costs a 304 and no body;
//   - `noindex` (meta robots or X-Robots-Tag, for every crawler or for ours) is not kept, `nofollow`
//     pages and rel=nofollow links are not followed; a page's canonical address is read instead of it;
//   - every hop through the guarded fetch (net.ts: no private address, a byte cap, a timeout), its
//     redirects taken one at a time, each checked against robots.txt and the source's reach.
// The reach of a source is its site (by host name) under the folder of the address followed, at most
// MAX_DEPTH links from it; a read asks at most PAGES_PER_READ times; the library keeps at most
// PAGES_PER_SOURCE pages a source and MAX_PAGES in all. Everything it keeps came from outside: the
// tools that hand it to an orb mark the turn (1.6).
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { checkUrl, safeFetch, type Fetched } from "../agent/net.ts";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import { ALLOW_ALL, allowed, DISALLOW_ALL, MAX_ROBOTS_BYTES, parseRobots, type Robots } from "./robots.ts";
import { headerDirectives, inReach, normalizeUrl, reachOf, readHtml, readSitemap, type Reach } from "./pages.ts";

export const USER_AGENT = "OrbzReader/1.0 (a personal research reader for one person's assistants; obeys robots.txt)";
export const MIN_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 60_000;
export const PAGES_PER_READ = 25;
export const MAX_DEPTH = 2;
export const PAGES_PER_SOURCE = 200;
export const MAX_PAGES = 2_000;
export const MAX_SOURCES = 50;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT = 100_000;
/** The hour the night's reads start, where the home runs. */
export const READ_HOUR = 1;
const DAY = 86_400_000;
const ROBOTS_TTL_MS = DAY;
const UNREACHABLE_TTL_MS = 3_600_000; // an unreachable robots.txt is tried again sooner
const RETRY_DEFAULT_MS = 3_600_000;
const RETRY_MAX_MS = 7 * DAY;
const ERRORS_TO_STOP = 3;
const QUEUE_MAX = 500;
const SITEMAPS_MAX = 2;

export type Source = {
  id: number; orb: string; url: string; host: string; prefix: string; title: string; why: string; everyDays: number;
  addedAt: number; lastReadAt: number | null; nextAt: number; failures: number; lastError: string | null; pages: number;
};
export type Hit = { url: string; title: string; snippet: string; readAt: number; changedAt: number; source: number; host: string; orb: string };
export type Kept = { url: string; title: string; text: string; readAt: number; changedAt: number; source: number; host: string };
export type ReadReport = {
  source: number; host: string; first: boolean; asked: number; added: number; changed: number; gone: number; unchanged: number; skipped: number;
  stopped: string | null; changedPages: { title: string; url: string }[];
};
export type Fetcher = (url: string, o: { headers: Record<string, string>; maxBytes: number; maxRedirects?: number; signal: AbortSignal }) => Promise<Fetched>;
/** Waits `ms`; a stop ends the wait at once. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export class ReadingError extends Error {}

type SourceRow = {
  id: number; orb: string; url: string; host: string; prefix: string; title: string; why: string; every_days: number;
  added_at: number; last_read_at: number | null; next_at: number; failures: number; last_error: string | null; pages?: number;
};
type PageRow = { id: number; url: string; hash: string; etag: string | null; last_modified: string | null; depth: number };

const realSleep: Sleep = (ms, signal) =>
  new Promise((done) => {
    if (signal.aborted || ms <= 0) return done();
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      done();
    }, { once: true });
  });

const hashOf = (title: string, text: string): string => createHash("sha256").update(`${title}\n${text}`).digest("hex");
const originOf = (url: string): string => new URL(url).origin;
const pathOf = (url: string): string => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};
const isText = (ct: string, body: string): "html" | "text" | null =>
  /html|xhtml/.test(ct) ? "html" : ct.startsWith("text/plain") ? "text" : !ct && /^\s*<(!doctype|html)\b/i.test(body) ? "html" : null;

/** Retry-After: seconds, or an HTTP date; kept between a minute and a week, an hour when unreadable. */
export function retryAfterMs(value: string | undefined, now: number): number {
  const v = String(value ?? "").trim();
  const date = Date.parse(v);
  const ms = /^\d+$/.test(v) ? Number(v) * 1000 : v && !Number.isNaN(date) ? date - now : RETRY_DEFAULT_MS;
  return Math.min(RETRY_MAX_MS, Math.max(60_000, ms));
}

/** The night `everyDays` from `now`, at READ_HOUR where the home runs. */
export function nextReadAt(now: number, everyDays: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + everyDays, READ_HOUR).getTime();
}

export class Reading {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #fetch: Fetcher;
  readonly #sleep: Sleep;
  readonly #lastAt = new Map<string, number>(); // the last request to each site, for its delay
  #running: Promise<void> | null = null;
  #stop = new AbortController();
  #now: { source: number; url: string } | null = null;
  #stopRead = false; // the source being read was unfollowed: the read ends at its next page

  constructor(db: DatabaseSync, events: EventLog, clock: Clock, o: { fetch?: Fetcher; sleep?: Sleep } = {}) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#fetch = o.fetch ?? ((url, x) => safeFetch(url, x));
    this.#sleep = o.sleep ?? realSleep;
  }

  // ── the sources ───────────────────────────────────────────────────────────────────────────

  /** Follows an address: checked first (a public address, robots.txt allowing it), then read at once. */
  async follow(orb: string, raw: string, why: string, everyDays = 1): Promise<{ source: Source; already: boolean }> {
    const url = normalizeUrl(raw);
    if (!url) throw new ReadingError("only an http or https address can be followed");
    const had = this.#db.prepare("SELECT * FROM reading_sources WHERE url = ?").get(url) as SourceRow | undefined;
    if (had) return { source: this.#source(had), already: true };
    if ((this.#db.prepare("SELECT count(*) AS n FROM reading_sources").get() as { n: number }).n >= MAX_SOURCES) {
      throw new ReadingError(`the library follows ${MAX_SOURCES} sources already: stop following one first`);
    }
    const check = await checkUrl(url);
    if (!check.ok) throw new ReadingError(check.reason);
    const robots = await this.#robots(url, this.#stop.signal);
    if (robots === DISALLOW_ALL) {
      throw new ReadingError(`${new URL(url).hostname}'s robots.txt could not be read (the site did not answer it, or asked to slow down), and a crawler reads nothing of a site until it can: try again later`);
    }
    if (!allowed(robots, pathOf(url))) {
      throw new ReadingError(`${new URL(url).hostname} asks crawlers not to read ${pathOf(url)} (its robots.txt), so it is not followed: read a page of it once with web_fetch instead`);
    }
    const reach = reachOf(url);
    const every = everyDays >= 7 ? 7 : 1;
    const now = this.#clock.now();
    const r = this.#db
      .prepare("INSERT INTO reading_sources (orb, url, host, prefix, why, every_days, added_at, next_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .get(orb, url, reach.host, reach.prefix, why.trim().slice(0, 300), every, now, now) as SourceRow;
    this.#events.append("reading.followed", { source: r.id, url, host: reach.host, prefix: reach.prefix, why: r.why, every }, { orb });
    void this.due(); // the first read, now
    return { source: this.#source(r), already: false };
  }

  /** Stops following a source; its pages leave the library. `by` is an orb's id, or "you". */
  unfollow(id: number, by: string): void {
    const r = this.#db.prepare("SELECT * FROM reading_sources WHERE id = ?").get(id) as SourceRow | undefined;
    if (!r) throw new ReadingError(`no source #${id} is followed`);
    tx(this.#db, () => {
      this.#db.prepare("DELETE FROM reading_pages WHERE source = ?").run(id);
      this.#db.prepare("DELETE FROM reading_sources WHERE id = ?").run(id);
    });
    if (this.#now?.source === id) this.#stopRead = true;
    this.#events.append("reading.unfollowed", { source: id, url: r.url, by }, { orb: r.orb });
  }

  /** Every source followed, newest first, with its page count. */
  sources(): Source[] {
    return (this.#db.prepare("SELECT s.*, (SELECT count(*) FROM reading_pages p WHERE p.source = s.id) AS pages FROM reading_sources s ORDER BY s.added_at DESC, s.id DESC").all() as SourceRow[]).map((r) => this.#source(r));
  }

  /** What is being read right now, if anything. */
  readingNow(): { source: number; url: string } | null {
    return this.#now;
  }

  #source(r: SourceRow): Source {
    const pages = r.pages ?? (this.#db.prepare("SELECT count(*) AS n FROM reading_pages WHERE source = ?").get(r.id) as { n: number }).n;
    return {
      id: r.id, orb: r.orb, url: r.url, host: r.host, prefix: r.prefix, title: r.title, why: r.why, everyDays: r.every_days,
      addedAt: r.added_at, lastReadAt: r.last_read_at, nextAt: r.next_at, failures: r.failures, lastError: r.last_error, pages,
    };
  }

  // ── what was read ─────────────────────────────────────────────────────────────────────────

  /** The pages read that match a query, best first: every word, else any of them (FTS5, the title weighed up). */
  search(query: string, o: { limit?: number; source?: number } = {}): Hit[] {
    const words = String(query ?? "").match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
    if (!words.length) return [];
    const run = (match: string): Hit[] =>
      (this.#db
        .prepare(
          `SELECT p.url, p.title, p.fetched_at AS readAt, p.changed_at AS changedAt, s.id AS source, s.host, s.orb,
             snippet(reading_text, 1, '«', '»', '…', 24) AS snippet
           FROM reading_text JOIN reading_pages p ON p.id = reading_text.rowid JOIN reading_sources s ON s.id = p.source
           WHERE reading_text MATCH ? ${o.source !== undefined ? "AND p.source = ?" : ""}
           ORDER BY bm25(reading_text, 5.0, 1.0) LIMIT ?`,
        )
        .all(...[match, ...(o.source !== undefined ? [o.source] : []), o.limit ?? 8]) as Hit[]).map((h) => ({ ...h }));
    const quoted = words.map((w) => `"${w}"`);
    const all = run(quoted.join(" "));
    return all.length || words.length === 1 ? all : run(quoted.join(" OR "));
  }

  /** A page as it was last read, or null when the library does not have it. */
  page(raw: string): Kept | null {
    const url = normalizeUrl(raw);
    if (!url) return null;
    const r = this.#db
      .prepare("SELECT p.url, p.title, p.text, p.fetched_at AS readAt, p.changed_at AS changedAt, s.id AS source, s.host FROM reading_pages p JOIN reading_sources s ON s.id = p.source WHERE p.url = ?")
      .get(url) as Kept | undefined;
    return r ? { ...r } : null;
  }

  /** For web_search (they help each other): a line naming what the library already has on a query, or null. */
  hint(query: string): string | null {
    const hits = this.search(query, { limit: 3 });
    if (!hits.length) return null;
    const day = (t: number): string => new Date(t).toISOString().slice(0, 10);
    const list = hits.map((h) => `- ${h.title || h.url} (${h.url}, read ${day(h.readAt)})`).join("\n");
    return `Your office's reading library already has pages on this, read before and kept:\n${list}\nsearch_reading "${query.trim().slice(0, 120)}" finds them all, dated, and read_reading gives a whole page; the results above are what is live and new.`;
  }

  // ── reading, by the home's tick ───────────────────────────────────────────────────────────

  /** When the next source is due to be read, for the home's timer. */
  nextAt(): number | null {
    return (this.#db.prepare("SELECT min(next_at) AS at FROM reading_sources").get() as { at: number | null }).at ?? null;
  }

  /** The tick's: reads the source most overdue, if one is due and no read is under way. */
  due(): Promise<void> | null {
    if (this.#running || this.#stop.signal.aborted) return null;
    const r = this.#db.prepare("SELECT * FROM reading_sources WHERE next_at <= ? ORDER BY next_at, id LIMIT 1").get(this.#clock.now()) as SourceRow | undefined;
    if (!r) return null;
    this.#running = this.#read(r)
      .catch((e: unknown) => {
        // a read never takes the home down: it is said, and the source is tried again tomorrow
        this.#events.append("reading.failed", { source: r.id, error: e instanceof Error ? e.message : String(e) }, { orb: r.orb });
        this.#db.prepare("UPDATE reading_sources SET next_at = ?, last_error = ? WHERE id = ?").run(nextReadAt(this.#clock.now(), r.every_days), e instanceof Error ? e.message : String(e), r.id);
      })
      .finally(() => {
        this.#running = null;
        this.#now = null;
      });
    return this.#running;
  }

  /** Waits for the read under way, if any. */
  async idle(): Promise<void> {
    await this.#running;
  }

  /** Stops reading (the home is closing): the read under way ends at once. */
  async close(): Promise<void> {
    this.#stop.abort();
    await this.#running;
  }

  /** Waits out a site's delay since its last request. */
  async #polite(url: string, delayMs: number, signal: AbortSignal): Promise<void> {
    const host = new URL(url).hostname;
    const last = this.#lastAt.get(host);
    const wait = last === undefined ? 0 : last + delayMs - this.#clock.now();
    if (wait > 0 && !signal.aborted) await this.#sleep(wait, signal); // stopped already: no wait to end
    this.#lastAt.set(host, this.#clock.now());
  }

  /** robots.txt for an address's origin: kept a day (an unreachable one an hour), fetched politely. */
  async #robots(url: string, signal: AbortSignal): Promise<Robots> {
    const origin = originOf(url);
    const now = this.#clock.now();
    const kept = this.#db.prepare("SELECT fetched_at, status, body FROM reading_robots WHERE origin = ?").get(origin) as { fetched_at: number; status: string; body: string } | undefined;
    const fresh = kept && now - kept.fetched_at < (kept.status === "unreachable" ? UNREACHABLE_TTL_MS : ROBOTS_TTL_MS);
    if (!fresh) {
      await this.#polite(url, MIN_DELAY_MS, signal);
      const res = await this.#fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT, accept: "text/plain,*/*;q=0.5" }, maxBytes: MAX_ROBOTS_BYTES, signal });
      const s = res.status ?? 0;
      // RFC 9309 2.3.1: 2xx is the file; 4xx is "unavailable" (all allowed); 5xx or no answer is
      // "unreachable" (all forbidden). 429 asks us to slow down: unreachable, not a licence.
      const status = s >= 200 && s < 300 ? "ok" : s >= 400 && s < 500 && s !== 429 ? "unavailable" : "unreachable";
      this.#db
        .prepare("INSERT INTO reading_robots (origin, fetched_at, status, body) VALUES (?, ?, ?, ?) ON CONFLICT (origin) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, body = excluded.body")
        .run(origin, now, status, status === "ok" ? (res.body ?? "") : "");
      return status === "ok" ? parseRobots(res.body ?? "") : status === "unavailable" ? ALLOW_ALL : DISALLOW_ALL;
    }
    return kept.status === "ok" ? parseRobots(kept.body) : kept.status === "unavailable" ? ALLOW_ALL : DISALLOW_ALL;
  }

  /** One read of one source. */
  async #read(src: SourceRow): Promise<void> {
    const signal = this.#stop.signal;
    this.#stopRead = false;
    const first = src.last_read_at === null;
    const reach: Reach = { host: src.host, prefix: src.prefix };
    const report: ReadReport = { source: src.id, host: src.host, first, asked: 0, added: 0, changed: 0, gone: 0, unchanged: 0, skipped: 0, stopped: null, changedPages: [] };
    this.#now = { source: src.id, url: src.url };
    this.#events.append("reading.started", { source: src.id, url: src.url }, { orb: src.orb });
    let retryAt: number | null = null;
    let errors = 0;

    // the queue: the address followed, then the pages known, oldest read first (a rolling re-read),
    // then what their links and the sitemap bring
    const known = this.#db.prepare("SELECT id, url, hash, etag, last_modified, depth FROM reading_pages WHERE source = ? ORDER BY fetched_at, id").all(src.id) as PageRow[];
    const byUrl = new Map(known.map((p) => [p.url, p]));
    const queue: { url: string; depth: number }[] = [{ url: src.url, depth: 0 }, ...known.filter((p) => p.url !== src.url).map((p) => ({ url: p.url, depth: p.depth }))];
    const seen = new Set(queue.map((q) => q.url));
    const enqueue = (url: string, depth: number, front = false): void => {
      if (seen.has(url) || queue.length >= QUEUE_MAX || depth > MAX_DEPTH || !inReach(url, reach)) return;
      seen.add(url);
      if (front) queue.unshift({ url, depth });
      else queue.push({ url, depth });
    };
    const keptCount = (): { mine: number; all: number } => ({
      mine: (this.#db.prepare("SELECT count(*) AS n FROM reading_pages WHERE source = ?").get(src.id) as { n: number }).n,
      all: (this.#db.prepare("SELECT count(*) AS n FROM reading_pages").get() as { n: number }).n,
    });
    const drop = (url: string): void => {
      if (byUrl.has(url)) {
        this.#db.prepare("DELETE FROM reading_pages WHERE url = ?").run(url);
        byUrl.delete(url);
        report.gone++;
      }
    };

    // robots.txt is per origin (http and https are two): each one's own, fetched once a read at most
    const robotsOf = new Map<string, Robots>();
    const robotsFor = async (url: string): Promise<Robots> => {
      const o = originOf(url);
      if (!robotsOf.has(o)) robotsOf.set(o, await this.#robots(url, signal));
      return robotsOf.get(o)!;
    };
    const delayOf = (r: Robots): number => Math.max(MIN_DELAY_MS, (r.crawlDelay ?? 0) * 1000);

    try {
      const robots = await robotsFor(src.url);
      if (robots.crawlDelay !== null && robots.crawlDelay * 1000 > MAX_DELAY_MS) {
        report.stopped = `${src.host} asks for ${robots.crawlDelay} s between pages, more than a reader that reads a page at a time waits`;
        return;
      }
      // the sitemap, the first time: addresses in reach the links may not reach
      if (first) {
        let maps = robots.sitemaps.filter((u) => !/\.gz$/i.test(u)).slice(0, SITEMAPS_MAX);
        for (let i = 0; i < maps.length && report.asked < PAGES_PER_READ; i++) {
          const map = normalizeUrl(maps[i]!);
          if (!map || new URL(map).hostname !== src.host || !allowed(robots, pathOf(map))) continue;
          await this.#polite(map, delayOf(robots), signal);
          if (signal.aborted) return;
          report.asked++;
          const res = await this.#fetch(map, { headers: { "user-agent": USER_AGENT, accept: "application/xml,text/xml,*/*;q=0.5" }, maxBytes: 5 * 1024 * 1024, signal });
          if (!res.ok || !res.body) continue;
          const sm = readSitemap(res.body);
          if (sm.index) maps = [...maps, ...sm.urls.filter((u) => !/\.gz$/i.test(u))].slice(0, SITEMAPS_MAX + 2);
          else for (const u of sm.urls) enqueue(u, 1);
        }
      }

      while (queue.length && report.asked < PAGES_PER_READ && !signal.aborted && !this.#stopRead) {
        const { url, depth } = queue.shift()!;
        if (!inReach(url, reach)) {
          report.skipped++;
          continue;
        }
        const rules = await robotsFor(url);
        if (rules.crawlDelay !== null && rules.crawlDelay * 1000 > MAX_DELAY_MS) {
          report.skipped++;
          continue;
        }
        if (!allowed(rules, pathOf(url))) {
          report.skipped++;
          if (byUrl.has(url)) drop(url); // a page robots.txt now forbids is not kept
          continue;
        }
        const had = byUrl.get(url);
        await this.#polite(url, delayOf(rules), signal);
        if (signal.aborted || this.#stopRead) break;
        this.#now = { source: src.id, url };
        report.asked++;
        const res = await this.#fetch(url, {
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            ...(had?.etag && { "if-none-match": had.etag }),
            ...(had?.last_modified && { "if-modified-since": had.last_modified }),
          },
          maxBytes: MAX_PAGE_BYTES,
          maxRedirects: 0,
          signal,
        });
        if (signal.aborted || this.#stopRead) break; // unfollowed while it was being asked: nothing of it is kept
        const status = res.status ?? 0;
        if (!status) {
          if (++errors >= ERRORS_TO_STOP) {
            report.stopped = `${src.host} did not answer ${ERRORS_TO_STOP} times (${res.reason ?? "no answer"})`;
            break;
          }
          continue;
        }
        if (status === 429 || status === 503) {
          retryAt = this.#clock.now() + retryAfterMs(res.headers?.["retry-after"], this.#clock.now());
          report.stopped = `${src.host} asked to slow down (HTTP ${status}); read again after ${new Date(retryAt).toISOString().slice(0, 16).replace("T", " ")}`;
          break;
        }
        if (status >= 300 && status < 400 && status !== 304) {
          // a redirect is one more address, checked like any other (robots, reach) before it is read
          const to = res.location ? normalizeUrl(res.location) : null;
          if (to && inReach(to, reach)) enqueue(to, depth, true);
          else report.skipped++;
          if (had) drop(url);
          continue;
        }
        if (status === 304 && had) {
          this.#db.prepare("UPDATE reading_pages SET fetched_at = ? WHERE id = ?").run(this.#clock.now(), had.id);
          report.unchanged++;
          continue;
        }
        if (status === 404 || status === 410) {
          drop(url);
          continue;
        }
        if (status < 200 || status >= 300) {
          report.skipped++;
          if (++errors >= ERRORS_TO_STOP) {
            report.stopped = `${src.host} answered with errors ${ERRORS_TO_STOP} times (the last HTTP ${status})`;
            break;
          }
          continue;
        }
        const ct = (res.contentType ?? "").toLowerCase();
        const kind = isText(ct, res.body ?? "");
        if (!kind) {
          report.skipped++; // a PDF, an image, a download: not read here (web_fetch reads a PDF when one is wanted)
          continue;
        }
        const header = headerDirectives(res.headers?.["x-robots-tag"]);
        const page = kind === "html" ? readHtml(res.body ?? "", url) : { title: "", text: res.body ?? "", links: [], canonical: null, directives: { noindex: false, nofollow: false } };
        const noindex = header.noindex || page.directives.noindex;
        const nofollow = header.nofollow || page.directives.nofollow;
        if (page.canonical && page.canonical !== url && inReach(page.canonical, reach)) {
          enqueue(page.canonical, depth, true); // the page's own address is the one kept, read once
          if (had) drop(url);
          else report.skipped++;
          continue;
        }
        if (!nofollow && depth < MAX_DEPTH) for (const link of page.links) enqueue(link, depth + 1);
        if (noindex) {
          drop(url); // asked not to be kept: it is not, and one kept before leaves
          report.skipped++;
          continue;
        }
        const title = page.title.slice(0, 300);
        const text = page.text.slice(0, MAX_TEXT);
        const hash = hashOf(title, text);
        const now = this.#clock.now();
        const etag = res.headers?.["etag"] ?? null;
        const lastModified = res.headers?.["last-modified"] ?? null;
        if (had) {
          if (had.hash === hash) {
            this.#db.prepare("UPDATE reading_pages SET fetched_at = ?, etag = ?, last_modified = ? WHERE id = ?").run(now, etag, lastModified, had.id);
            report.unchanged++;
          } else {
            this.#db.prepare("UPDATE reading_pages SET title = ?, text = ?, hash = ?, etag = ?, last_modified = ?, fetched_at = ?, changed_at = ? WHERE id = ?").run(title, text, hash, etag, lastModified, now, now, had.id);
            report.changed++;
            if (report.changedPages.length < 8) report.changedPages.push({ title: title || url, url });
          }
        } else {
          const n = keptCount();
          if (n.mine >= PAGES_PER_SOURCE || n.all >= MAX_PAGES) {
            report.skipped++; // the library is full: what is new waits for room
            continue;
          }
          const r = this.#db
            .prepare("INSERT INTO reading_pages (source, url, title, text, hash, etag, last_modified, depth, fetched_at, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (url) DO NOTHING RETURNING id")
            .get(src.id, url, title, text, hash, etag, lastModified, depth, now, now) as { id: number } | undefined;
          if (r) {
            byUrl.set(url, { id: r.id, url, hash, etag, last_modified: lastModified, depth });
            report.added++;
          } else report.skipped++; // another source keeps it
        }
        if (url === src.url && title && !src.title) this.#db.prepare("UPDATE reading_sources SET title = ? WHERE id = ?").run(title, src.id);
      }
    } finally {
      const now = this.#clock.now();
      if (!signal.aborted) {
        const readNothing = report.added + report.changed + report.unchanged === 0;
        const next = Math.max(nextReadAt(now, src.every_days), retryAt ?? 0);
        const still = this.#db.prepare("SELECT failures FROM reading_sources WHERE id = ?").get(src.id) as { failures: number } | undefined;
        if (still) {
          const failures = readNothing ? still.failures + 1 : 0;
          this.#db.prepare("UPDATE reading_sources SET last_read_at = ?, next_at = ?, failures = ?, last_error = ? WHERE id = ?").run(now, next, failures, report.stopped, src.id);
          this.#events.append("reading.read", { ...report, url: src.url, failures }, { orb: src.orb });
        }
      }
    }
  }
}
