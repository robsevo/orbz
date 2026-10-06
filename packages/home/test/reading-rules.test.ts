// PLAN 3.12_t, the reading library's rules, by code (no network):
//   - robots.txt as RFC 9309 says: the RFC's own example file (5.1), group choice and merging, the
//     longest match, Allow on a tie, `*` and `$`, an empty Disallow, one percent-encoding for both
//     sides, /robots.txt always readable, Crawl-delay from our group, Sitemap lines from anywhere;
//   - an address in one spelling, a source's reach, what a page says to a crawler (links without
//     rel=nofollow, meta robots, canonical, base), X-Robots-Tag for every crawler or ours, a sitemap.
import assert from "node:assert/strict";
import { test } from "node:test";
import { allowed, normalizePath, parseRobots, TOKEN } from "../src/reading/robots.ts";
import { headerDirectives, inReach, normalizeUrl, reachOf, readHtml, readSitemap } from "../src/reading/pages.ts";
import { nextReadAt, retryAfterMs } from "../src/reading/reading.ts";

// RFC 9309 section 5.1, the example file, as printed
const RFC_EXAMPLE = [
  "User-Agent: *",
  "Disallow: *.gif$",
  "Disallow: /example/",
  "Allow: /publications/",
  "",
  "User-Agent: foobot",
  "Disallow:/",
  "Allow:/example/page.html",
  "Allow:/example/allowed.gif",
  "",
  "User-Agent: barbot",
  "User-Agent: bazbot",
  "Disallow: /example/page.html",
  "",
  "User-Agent: quxbot",
  "",
  "EOF",
].join("\n");

test("the RFC's own example: each crawler its group, and * for the rest", () => {
  const foo = parseRobots(RFC_EXAMPLE, "foobot");
  assert.equal(allowed(foo, "/example/page.html"), true, "foobot: the longer Allow beats Disallow: /");
  assert.equal(allowed(foo, "/example/allowed.gif"), true);
  assert.equal(allowed(foo, "/other"), false, "foobot: everything else is disallowed");
  const bar = parseRobots(RFC_EXAMPLE, "barbot");
  assert.equal(allowed(bar, "/example/page.html"), false);
  assert.equal(allowed(bar, "/picture.gif"), true, "barbot has its own group: the * group's gif rule is not its");
  assert.equal(allowed(parseRobots(RFC_EXAMPLE, "bazbot"), "/example/page.html"), false, "two User-agent lines, one group");
  assert.equal(allowed(parseRobots(RFC_EXAMPLE, "quxbot"), "/anything"), true, "an empty group allows all");
  const us = parseRobots(RFC_EXAMPLE); // no group names us: the * group
  assert.equal(allowed(us, "/picture.gif"), false, "*.gif$");
  assert.equal(allowed(us, "/picture.gif?size=2"), true, "$ anchors the end: a query after .gif is not the end");
  assert.equal(allowed(us, "/example/x"), false);
  assert.equal(allowed(us, "/publications/x"), true);
  assert.equal(TOKEN, "orbzreader");
});

test("our token in any case, with a version after it; several groups for us are combined", () => {
  const r = parseRobots("User-agent: OrbzReader/1.0\nDisallow: /a\n\nUser-agent: *\nDisallow: /\n\nuser-agent: ORBZREADER\nDisallow: /b\nCrawl-delay: 9");
  assert.equal(allowed(r, "/a/x"), false);
  assert.equal(allowed(r, "/b/x"), false, "the second group naming us is combined with the first");
  assert.equal(allowed(r, "/c"), true, "our groups, not *");
  assert.equal(r.crawlDelay, 9);
});

test("the longest rule wins, Allow on a tie, wildcards, an empty Disallow, rules before any agent ignored", () => {
  const r = parseRobots("Disallow: /\nUser-agent: *\nDisallow: /docs\nAllow: /docs/public\nAllow: /tie\nDisallow: /tie\nDisallow: /eit\nAllow: /eit\nDisallow: /*/drafts/\nDisallow: /exact$\nDisallow:\n");
  assert.equal(allowed(r, "/docs/x"), false);
  assert.equal(allowed(r, "/docs/public/x"), true, "the longer Allow");
  assert.equal(allowed(r, "/tie"), true, "Allow and Disallow of one length: Allow");
  assert.equal(allowed(r, "/eit"), true, "in either order");
  assert.equal(allowed(r, "/a/b/drafts/c"), false, "* is any run of characters");
  assert.equal(allowed(r, "/exact"), false);
  assert.equal(allowed(r, "/exact/more"), true, "$ is the end");
  assert.equal(allowed(r, "/"), true, "the Disallow: / before any User-agent belongs to no one; the empty one forbids nothing");
  assert.equal(allowed(parseRobots("User-agent: *\nDisallow: /"), "/robots.txt"), true, "/robots.txt is always readable");
});

test("one percent-encoding for both sides, comments and CRLF, Sitemap lines from anywhere", () => {
  assert.equal(normalizePath("/%7euser/f%c3%b8o"), "/~user/f%C3%B8o", "an encoded unreserved character is decoded; hex upper case");
  assert.equal(normalizePath("/føo bar"), "/f%C3%B8o%20bar", "non-ASCII and a space encoded as UTF-8");
  const r = parseRobots("User-agent: * # everyone\r\nDisallow: /%7Euser # mine\r\nDisallow: /føo\r\nSitemap: https://x.test/sitemap.xml\r\n");
  assert.equal(allowed(r, "/~user/a"), false);
  assert.equal(allowed(r, "/f%C3%B8o/a"), false);
  assert.equal(allowed(r, "/f%c3%b8o/a"), false, "the address's own encoding is made the same before comparing");
  assert.equal(allowed(r, "/%7euser/a"), false);
  assert.deepEqual(r.sitemaps, ["https://x.test/sitemap.xml"]);
  assert.equal(allowed(parseRobots("User-agent: *\nDisallow: /a\n"), "/b"), true);
});

test("an address in one spelling; a source's reach is its site under the folder followed", () => {
  assert.equal(normalizeUrl("HTTPS://Docs.Test:443/a/b?utm_source=x&id=2#part"), "https://docs.test/a/b?id=2");
  assert.equal(normalizeUrl("https://docs.test/a?utm_medium=y"), "https://docs.test/a", "nothing left of the query: no ?");
  assert.equal(normalizeUrl("ftp://docs.test/a"), null);
  assert.equal(normalizeUrl("https://me:secret@docs.test/a"), null, "an address with a password in it is never read");
  assert.equal(normalizeUrl("../c", "https://docs.test/a/b/x.html"), "https://docs.test/a/c");
  assert.deepEqual(reachOf("https://docs.test/guide/intro.html"), { host: "docs.test", prefix: "/guide/" });
  assert.deepEqual(reachOf("https://docs.test/guide/"), { host: "docs.test", prefix: "/guide/" });
  assert.deepEqual(reachOf("https://docs.test/guide"), { host: "docs.test", prefix: "/guide/" }, "a last part naming no file is a folder");
  const reach = reachOf("https://docs.test/guide/");
  assert.equal(inReach("http://docs.test/guide/a", reach), true, "http and https alike");
  assert.equal(inReach("https://docs.test/guide", reach), true, "the folder without its /");
  assert.equal(inReach("https://docs.test/guidebook", reach), false);
  assert.equal(inReach("https://docs.test/other/a", reach), false);
  assert.equal(inReach("https://evil.test/guide/a", reach), false);
});

test("what a page says to a crawler: links (not rel=nofollow), meta robots, canonical, base; X-Robots-Tag", () => {
  const p = readHtml(
    `<html><head><title>Guide &amp; more</title><base href="/guide/"><meta name="robots" content="noindex, follow"><link rel="canonical" href="https://docs.test/guide/main"></head>
     <body><script>location="/x"; var a = '<a href="/script-link">'</script>
     <a href="a">A</a> <a href='/guide/b#frag'>B</a> <a href="c" rel="nofollow">C</a> <a href="mailto:x@y">mail</a> <a href="#top">top</a>
     <a href="a">A again</a><!-- <a href="/hidden"> --> <p>Hello there.</p></body></html>`,
    "https://docs.test/start",
  );
  assert.equal(p.title, "Guide & more");
  assert.deepEqual(p.links, ["https://docs.test/guide/a", "https://docs.test/guide/b"], "relative to <base>, once each; no nofollow, mailto, fragment, script or comment links");
  assert.deepEqual(p.directives, { noindex: true, nofollow: false });
  assert.equal(p.canonical, "https://docs.test/guide/main");
  assert.match(p.text, /Hello there\./);
  assert.deepEqual(readHtml('<meta name="orbzreader" content="none">', "https://x.test/").directives, { noindex: true, nofollow: true }, "a meta for us by name");
  assert.deepEqual(readHtml('<meta name="googlebot" content="noindex">', "https://x.test/").directives, { noindex: false, nofollow: false }, "another crawler's is not ours");
  assert.deepEqual(headerDirectives("noindex, nofollow"), { noindex: true, nofollow: true });
  assert.deepEqual(headerDirectives("googlebot: noindex"), { noindex: false, nofollow: false });
  assert.deepEqual(headerDirectives("googlebot: noindex, orbzreader: nofollow"), { noindex: false, nofollow: true });
  assert.deepEqual(headerDirectives("unavailable_after: 25 Jun 2010 15:00:00 PST"), { noindex: false, nofollow: false });
  assert.deepEqual(headerDirectives(undefined), { noindex: false, nofollow: false });
});

test("a sitemap's addresses, and an index of sitemaps", () => {
  const set = readSitemap(`<?xml version="1.0"?><urlset><url><loc>https://docs.test/guide/a</loc></url><url><loc> https://docs.test/guide/b?x=1&amp;y=2 </loc></url></urlset>`);
  assert.deepEqual(set, { index: false, urls: ["https://docs.test/guide/a", "https://docs.test/guide/b?x=1&y=2"] });
  assert.equal(readSitemap(`<sitemapindex><sitemap><loc>https://docs.test/s1.xml</loc></sitemap></sitemapindex>`).index, true);
});

test("Retry-After in seconds or as a date, kept between a minute and a week; the next read is a night at 01:00", () => {
  const now = Date.parse("2026-10-06T10:00:00Z");
  assert.equal(retryAfterMs("120", now), 120_000);
  assert.equal(retryAfterMs("5", now), 60_000, "never sooner than a minute");
  assert.equal(retryAfterMs(new Date(now + 3_600_000).toUTCString(), now), 3_600_000);
  assert.equal(retryAfterMs("soon", now), 3_600_000, "unreadable: an hour");
  assert.equal(retryAfterMs(undefined, now), 3_600_000);
  assert.equal(retryAfterMs(String(30 * 86_400), now), 7 * 86_400_000, "never more than a week");
  const local = new Date(2026, 9, 6, 14, 30).getTime();
  assert.equal(nextReadAt(local, 1), new Date(2026, 9, 7, 1, 0).getTime());
  assert.equal(nextReadAt(local, 7), new Date(2026, 9, 13, 1, 0).getTime());
});
