// The news that could move a coin (PLAN 5.43): desk/news.ts and its tool on stand-in feeds written here (RSS and Atom,
// the shapes the six outlets' feeds came in on 10-12), and the door's /desk/news on a stand-in market. Controls are
// planted in tools/home_mutants.py (a ticker read in lower case, Bitcoin Cash read as Bitcoin too, a feed read on every
// ask, a failing feed's stories dropped, the move read from the bar after the story).
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { moved, moveSince, News, parseFeed, plain, tag } from "../src/desk/news.ts";
import { newsTools } from "../src/desk/news-tools.ts";
import { agentHome } from "./helpers.ts";
import { standInMarket } from "./fakes/market.ts";

const T = Date.parse("2026-10-12T12:00:00Z");
const rfc = (t: number): string => new Date(t).toUTCString();
const rss = (items: { title: string; link: string; at: number; desc?: string }[]): string => `<?xml version="1.0"?><rss><channel><title>x</title>${items.map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${rfc(i.at)}</pubDate><description>${i.desc ?? ""}</description></item>`).join("")}</channel></rss>`;

test("a feed's stories: RSS and Atom, its words as text, a link that is not the web's left out", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[SEC &amp; CFTC sue &#8220;Exchange&#8221;]]></title><link>https://a.example/1</link><pubDate>${rfc(T)}</pubDate>
      <description>&lt;p&gt;Regulators &lt;b&gt;moved&lt;/b&gt; on Friday.&lt;/p&gt;</description></item>
    <item><title>No link</title><pubDate>${rfc(T)}</pubDate></item>
    <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>${rfc(T)}</pubDate></item>
    <item><title>No time</title><link>https://a.example/3</link></item>
  </channel></rss>`;
  const got = parseFeed(xml, "A");
  assert.deepEqual(got.map((x) => [x.title, x.url, x.at, x.summary]), [["SEC & CFTC sue “Exchange”", "https://a.example/1", T, "Regulators moved on Friday."]]);
  const atom = `<feed><entry><title>Solana halts</title><link rel="alternate" href="https://b.example/2"/><updated>2026-10-12T11:00:00Z</updated><summary>${"word ".repeat(80)}</summary></entry></feed>`;
  const [e] = parseFeed(atom, "B");
  assert.deepEqual([e!.title, e!.url, e!.at], ["Solana halts", "https://b.example/2", T - 3_600_000]);
  assert.ok(e!.summary.length <= 280 && e!.summary.endsWith("word…"), "cut at a word, under 280");
  assert.equal(plain("<script>x()</script>a&nbsp;b &#x2014; c"), "a b — c");
});

test("what a story names and what kind it is: a ticker in capitals only, Bitcoin Cash not Bitcoin, the strongest kind's weight", () => {
  assert.deepEqual(tag("Bitcoin falls below $83K as CPI looms", ""), { coins: ["BTC"], kinds: ["macro"], weight: 4 });
  assert.deepEqual(tag("Bitcoin Cash upgrade goes live", "").coins, ["BCH"], "Bitcoin Cash is not Bitcoin too");
  assert.deepEqual(tag("Bitcoin Cash and Bitcoin both rise", "").coins, ["BCH", "BTC"]);
  assert.deepEqual(tag("A link to the near future", "how to dot your i's").coins, [], "words, not tickers");
  assert.deepEqual(tag("$SOL and LINK rally; Chainlink adds feeds", "").coins, ["SOL", "LINK"]);
  assert.deepEqual(tag("Exchange hacked, $40M drained", "").kinds, ["hack"]);
  assert.deepEqual(tag("Australia proposes leverage caps for crypto-settled derivatives", "").kinds, ["regulation"], "settled is no lawsuit");
  assert.deepEqual(tag("A quiet day", "nothing happened"), { coins: [], kinds: [], weight: 0 });
});

function feeds(o: { fail?: Set<string> } = {}) {
  const asked: string[] = [];
  const now = { t: T };
  const items: Record<string, string> = {
    "https://a.example/feed": rss([{ title: "Bitcoin ETF sees record inflows", link: "https://a.example/etf", at: T - 2 * 3_600_000 }, { title: "Solana outage halts blocks", link: "https://a.example/sol", at: T - 30 * 60_000 }]),
    "https://b.example/feed": rss([{ title: "Bitcoin ETF Sees Record Inflows!", link: "https://b.example/etf-copy", at: T - 2 * 3_600_000 + 60_000 }, { title: "Old news", link: "https://b.example/old", at: T - 50 * 3_600_000 }]),
  };
  const f = (async (u: string | URL | Request) => {
    asked.push(String(u));
    if (o.fail?.has(String(u))) return new Response("no", { status: 503 });
    return new Response(items[String(u)] ?? "", { status: items[String(u)] ? 200 : 404 });
  }) as typeof fetch;
  const news = new News({ fetch: f, now: () => now.t, sources: [{ name: "A", url: "https://a.example/feed" }, { name: "B", url: "https://b.example/feed" }] });
  return { news, asked, now, fail: o.fail };
}

test("the feeds read at most every five minutes; the same story from two outlets once; the newest first; a coin, the last hours", async () => {
  const { news, asked, now } = feeds();
  const r = await news.read();
  assert.deepEqual(r.items.map((x) => x.url), ["https://a.example/sol", "https://b.example/etf-copy", "https://b.example/old"], "the copy with the same words kept once (the later one)");
  assert.deepEqual(r.sources.map((s) => [s.name, s.ok, s.items]), [["A", true, 2], ["B", true, 2]]);
  await news.read();
  assert.equal(asked.length, 2, "kept: not asked again within five minutes");
  now.t += 5 * 60_000;
  await news.read();
  assert.equal(asked.length, 4);
  assert.deepEqual((await news.read({ coin: "SOL" })).items.map((x) => x.url), ["https://a.example/sol"]);
  assert.deepEqual((await news.read({ hours: 24 })).items.length, 2, "the 50-hour-old story left out");
});

test("a feed that fails: its last good stories stand, it says why, and it is asked again only after the keep", async () => {
  const fail = new Set<string>();
  const { news, asked, now } = feeds({ fail });
  await news.read();
  fail.add("https://b.example/feed");
  now.t += 6 * 60_000;
  const r = await news.read();
  assert.ok(r.items.some((x) => x.url === "https://b.example/old"), "B's stories stand");
  const b = r.sources.find((s) => s.name === "B")!;
  assert.deepEqual([b.ok, b.error, b.items], [false, "B answered 503", 2]);
  await news.read();
  assert.equal(asked.filter((u) => u.startsWith("https://b")).length, 2, "not hammered while it fails");
});

test("how a coin moved since a story: from the open of the bar it came out in to the last close", async () => {
  const bars = [{ t: 0, o: 100, c: 101 }, { t: 900_000, o: 101, c: 104 }, { t: 1_800_000, o: 104, c: 110 }];
  assert.equal(moveSince(950_000, bars, 900_000), 110 / 101 - 1, "the second bar's open");
  assert.equal(moveSince(-1, bars, 900_000), null, "older than the bars");
  assert.equal(moveSince(2_700_000, bars, 900_000), null, "after the last");
  const items = [{ id: "x", source: "A", title: "t", summary: "", url: "u", at: 950_000, coins: ["BTC", "ETH"], kinds: [], weight: 0 }];
  const m = await moved(items, async (s) => (s === "BTC" ? bars : Promise.reject(new Error("no market"))));
  assert.deepEqual(m[0]!.moves, { BTC: 110 / 101 - 1, ETH: null });
});

test("the tool: the stories that could move prices, each with its coins, kind and move since; outside words", async () => {
  const { news } = feeds();
  // the story at 11:30 came out in the 11:30 bar, which opened at 100; the last close is 102
  const [tool] = newsTools({ news, bars: async () => [{ t: T - 2_700_000, o: 99, c: 100 }, { t: T - 1_800_000, o: 100, c: 101 }, { t: T - 900_000, o: 101, c: 102 }] });
  assert.equal(tool!.untrusted, "feed");
  assert.equal(tool!.group?.id, "desk");
  const out = (await tool!.run!({ coin: "SOL" }, {} as never)).content;
  assert.match(out, /^News that could move prices, newest first \(the outlets' claims, not facts\):\n- 10-12 11:30 UTC, A \[SOL\] \(outage; weight 3\): Solana outage halts blocks \(SOL \+2\.0% since\)$/);
  assert.match((await tool!.run!({ coin: "DOGE" }, {} as never)).content, /^No story naming DOGE\.$/);
});

test("at the door: the news with each coin's move since, how each feed is; a coin that is not a major refused", async (t) => {
  const clock = new FakeClock(T);
  const body = rss([{ title: "Ethereum ETF approved", link: "https://a.example/eth", at: T - 3_600_000 }]);
  const fetchAll = (async () => new Response(body)) as typeof fetch;
  const { home } = await agentHome(t, [], { clock, desk: { source: standInMarket(() => clock.now()), fetch: fetchAll } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const get = async (p: string) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${p}`, { headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, json: (await r.json()) as { items: { title: string; coins: string[]; kinds: string[]; moves: Record<string, number | null> }[]; sources: { ok: boolean }[] } };
  };
  const r = await get("/desk/news");
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 1 && r.json.items.every((x) => x.title === "Ethereum ETF approved"), "the six feeds gave the same story: once");
  assert.equal(r.json.items.length, 1);
  assert.deepEqual([r.json.items[0]!.coins, r.json.items[0]!.kinds], [["ETH"], ["etf"]]);
  assert.equal(typeof r.json.items[0]!.moves.ETH, "number", "its move since, from the market's bars");
  assert.equal(r.json.sources.length, 6);
  assert.equal((await get("/desk/news?coin=ETH")).json.items.length, 1);
  assert.equal((await get("/desk/news?coin=NOPE")).status, 400);
});
