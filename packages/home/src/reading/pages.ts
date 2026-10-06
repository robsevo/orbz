// What the reading library (PLAN 3.12) needs from an address and from a page, by code: an address in
// one spelling, the reach of a followed source, and what an HTML page says to a crawler (its links,
// its robots directives, its canonical address) and a sitemap's addresses. Pure: no network.
import { decodeEntities, htmlToText } from "../agent/web.ts";
import { TOKEN } from "./robots.ts";

/** Query keys that only say where a click came from: dropped, so one page is one address. */
const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

/** One spelling of an address (http or https only): no fragment, no tracking keys, no empty query. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null; // an address with a password in it is never read or kept
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (![...u.searchParams.keys()].length) u.search = "";
  return u.toString();
}

/** A source's reach: its site (by host name; http and https alike) and the folder of the address followed. */
export type Reach = { host: string; prefix: string };

/** The folder: the address itself when it ends in "/" or its last part names no file (`/docs` is the
 * docs folder, as `/docs/` is), else the folder the file is in (`/guide/intro.html` reads `/guide/`). */
export function reachOf(url: string): Reach {
  const u = new URL(url);
  const path = u.pathname || "/";
  const last = path.slice(path.lastIndexOf("/") + 1);
  const prefix = path.endsWith("/") ? path : last.includes(".") ? path.slice(0, path.lastIndexOf("/") + 1) : `${path}/`;
  return { host: u.hostname.toLowerCase(), prefix };
}

export function inReach(url: string, reach: Reach): boolean {
  try {
    const u = new URL(url);
    // the folder's own address without its "/" is in it too (`/docs` for `/docs/`)
    return u.hostname.toLowerCase() === reach.host && (u.pathname.startsWith(reach.prefix) || u.pathname === reach.prefix.slice(0, -1));
  } catch {
    return false;
  }
}

/** What a crawler is told: index (keep the words) and follow (read on from its links). */
export type Directives = { noindex: boolean; nofollow: boolean };

function readDirectives(words: string, into: Directives): void {
  for (const w of words.toLowerCase().split(/[\s,]+/)) {
    if (w === "noindex" || w === "none") into.noindex = true;
    if (w === "nofollow" || w === "none") into.nofollow = true;
  }
}

/** X-Robots-Tag: directives for every crawler, or for one named before a colon ("orbzreader: noindex"). */
export function headerDirectives(value: string | undefined): Directives {
  const d: Directives = { noindex: false, nofollow: false };
  if (!value) return d;
  for (const part of value.split(/,(?=\s*[a-z0-9_-]+\s*:)/i)) {
    const named = /^\s*([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(part);
    if (named && !/^(noindex|nofollow|none|all|index|follow|max-|noarchive|nosnippet|notranslate|noimageindex|unavailable_after)/i.test(named[1]!)) {
      if (named[1]!.toLowerCase() === TOKEN) readDirectives(named[2]!, d);
    } else readDirectives(part, d);
  }
  return d;
}

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
};

export type Page = { title: string; text: string; links: string[]; canonical: string | null; directives: Directives };

/** A page as the library reads it: its words, the addresses it links to (rel=nofollow left out), its
 * canonical address, and its meta robots for every crawler or for ours. Scripts are never run. */
export function readHtml(html: string, url: string): Page {
  const src = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const head = /<base\b[^>]*>/i.exec(src);
  const base = (head && normalizeUrl(attrs(head[0]).href ?? "", url)) || url;
  const directives: Directives = { noindex: false, nofollow: false };
  for (const m of src.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const name = (a.name ?? "").toLowerCase();
    if ((name === "robots" || name === TOKEN) && a.content) readDirectives(a.content, directives);
  }
  let canonical: string | null = null;
  for (const m of src.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) {
      canonical = normalizeUrl(a.href, base);
      break;
    }
  }
  const links: string[] = [];
  const seen = new Set<string>();
  const body = src.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.href || /^\s*(javascript|mailto|tel|data):/i.test(a.href) || a.href.trim().startsWith("#")) continue;
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("nofollow")) continue;
    const u = normalizeUrl(a.href, base);
    if (u && !seen.has(u)) {
      seen.add(u);
      links.push(u);
    }
  }
  // the words of the page's body: its title is kept on its own, so the head's words are left out
  const { title } = htmlToText(src);
  const { text } = htmlToText(src.replace(/<head\b[\s\S]*?<\/head\s*>/i, " "));
  return { title, text, links, canonical, directives };
}

/** A sitemap's addresses, and whether it is an index of other sitemaps (sitemaps.org's protocol). */
export function readSitemap(xml: string, limit = 1000): { index: boolean; urls: string[] } {
  const src = String(xml ?? "");
  const index = /<sitemapindex\b/i.test(src);
  const urls: string[] = [];
  for (const m of src.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    const u = normalizeUrl(decodeEntities(m[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, "")));
    if (u) urls.push(u);
    if (urls.length >= limit) break;
  }
  return { index, urls };
}
