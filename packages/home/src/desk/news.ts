// The news that could move a coin (PLAN 5.43; owner, 10-12: "a news section too that we can click on that could affect
// crypto prices. like the chart, click and news modal comes up"): the crypto press's own public feeds (RSS, no key;
// 10-12, measured: CoinDesk, Cointelegraph, Decrypt, The Block, CryptoSlate and Bitcoin Magazine answer), read at most
// every five minutes, each feed's last good read standing in while it fails. Each story tagged by code: the coins it
// names (the desk's majors, by name or ticker) and what kind of news it is (regulation, a lawsuit, an ETF, a hack,
// macro, a listing, an unlock, a big buyer, an outage, liquidations), weighed by how much that kind has moved prices.
// What a coin did since a story came out is the door's (it has the market). Headlines are outside words: what a feed
// says is a claim, read as text, never as an instruction.

export type NewsKind = "regulation" | "lawsuit" | "etf" | "hack" | "macro" | "listing" | "unlock" | "buyer" | "outage" | "liquidations";
export type NewsItem = { id: string; source: string; title: string; summary: string; url: string; at: number; coins: string[]; kinds: NewsKind[]; weight: number };
export type NewsSource = { name: string; url: string };
export type SourceStatus = { name: string; ok: boolean; error: string | null; at: number | null; items: number };

export const SOURCES: readonly NewsSource[] = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { name: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
  { name: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed" },
];

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", euro: "€", pound: "£" };
/** A feed's text as text: CDATA opened, tags dropped, entities read, spaces made one. */
export function plain(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m)
    // a summary sent as escaped HTML (Cointelegraph's: "&lt;p&gt;…") is tags again once read: dropped too
    .replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const field = (block: string, ...names: string[]): string | null => {
  for (const n of names) {
    const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m && m[1]!.trim()) return m[1]!;
  }
  return null;
};
const httpUrl = (u: string | null): string | null => {
  if (!u) return null;
  try {
    const x = new URL(plain(u));
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
};

/** A feed's stories (RSS's items or Atom's entries): its title, its link (http or https only), when, a summary of at most
 * 280 characters; a story with no title, link or time left out. */
export function parseFeed(xml: string, source: string): Omit<NewsItem, "coins" | "kinds" | "weight">[] {
  const out: Omit<NewsItem, "coins" | "kinds" | "weight">[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const b = m[2]!;
    const title = plain(field(b, "title") ?? "");
    const url = httpUrl(field(b, "link")) ?? httpUrl(/<link\b[^>]*\bhref="([^"]+)"/i.exec(b)?.[1] ?? null);
    const when = Date.parse(plain(field(b, "pubDate", "dc:date", "published", "updated") ?? ""));
    if (!title || !url || !Number.isFinite(when)) continue;
    let summary = plain(field(b, "description", "summary", "content:encoded", "content") ?? "");
    if (summary.length > 280) summary = `${summary.slice(0, 277).replace(/\s+\S*$/, "")}…`;
    out.push({ id: url, source, title: title.slice(0, 300), summary, url, at: when });
  }
  return out;
}

/** The desk's majors by what the press calls them: a name in any case, a ticker in capitals only (so "link" or "near"
 * in a sentence is no coin). "Bitcoin Cash" is read before "Bitcoin". */
export const COIN_WORDS: [string, { names: string[]; tickers: string[] }][] = [
  ["BCH", { names: ["Bitcoin Cash"], tickers: ["BCH"] }],
  ["BTC", { names: ["Bitcoin"], tickers: ["BTC"] }],
  ["ETH", { names: ["Ethereum", "Ether"], tickers: ["ETH"] }],
  ["BNB", { names: ["BNB Chain"], tickers: ["BNB"] }],
  ["XRP", { names: ["Ripple"], tickers: ["XRP"] }],
  ["SOL", { names: ["Solana"], tickers: ["SOL"] }],
  ["TRX", { names: ["Tron"], tickers: ["TRX"] }],
  ["DOGE", { names: ["Dogecoin"], tickers: ["DOGE"] }],
  ["ZEC", { names: ["Zcash"], tickers: ["ZEC"] }],
  ["HYPE", { names: ["Hyperliquid"], tickers: ["HYPE"] }],
  ["XMR", { names: ["Monero"], tickers: ["XMR"] }],
  ["LINK", { names: ["Chainlink"], tickers: ["LINK"] }],
  ["ADA", { names: ["Cardano"], tickers: ["ADA"] }],
  ["NEAR", { names: ["NEAR Protocol"], tickers: ["NEAR"] }],
  ["XLM", { names: ["Stellar"], tickers: ["XLM"] }],
  ["LTC", { names: ["Litecoin"], tickers: ["LTC"] }],
  ["UNI", { names: ["Uniswap"], tickers: ["UNI"] }],
  ["AVAX", { names: ["Avalanche"], tickers: ["AVAX"] }],
  ["SUI", { names: [], tickers: ["SUI"] }],
  ["TON", { names: ["Toncoin"], tickers: ["TON"] }],
  ["DOT", { names: ["Polkadot"], tickers: ["DOT"] }],
  ["HBAR", { names: ["Hedera"], tickers: ["HBAR"] }],
  ["AAVE", { names: ["Aave"], tickers: ["AAVE"] }],
  ["SHIB", { names: ["Shiba Inu"], tickers: ["SHIB"] }],
  ["PEPE", { names: [], tickers: ["PEPE"] }],
];
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What kind of news it is, by the words it uses; and how much each kind has tended to move prices (3 most). Macro
 * takes the world's shocks too (10-12, live: "Bitcoin drops 2.2% as Ukraine, Iran strikes send oil toward ..." read
 * as nothing), and a hack its drain ("$87M drain"). */
export const KINDS: Record<NewsKind, { words: RegExp; weight: number }> = {
  regulation: { words: /\b(SEC|CFTC|FCA|ESMA|regulators?|regulat(?:ion|ions|ory)|watchdog|MiCA|lawmakers|Congress|Senate|bill|ban(?:s|ned)?|licen[cs]es?|stablecoin law|crackdown|central bank|leverage caps?)\b/i, weight: 3 },
  lawsuit: { words: /\b(lawsuit|sues|sued|court|judge|charged|indict(?:ed|ment)|settlement|settles with|settled with|plea)\b/i, weight: 2 },
  etf: { words: /\b(ETFs?|ETPs?|spot fund)\b/i, weight: 3 },
  hack: { words: /\b(hack(?:ed|er|ers|s)?|exploit(?:ed|s)?|drain(?:s|ed|er)?|stolen|breach|attackers?|rug ?pull|heist|phishing|scam(?:s|mers)?|fraud|frozen)\b/i, weight: 3 },
  macro: { words: /\b(Fed|FOMC|Powell|rate (?:cut|hike)s?|interest rates?|CPI|inflation|jobs report|payrolls|tariffs?|recession|Treasury yields?|dollar (?:index|strength)|DXY|oil|wars?|(?:air)?strikes?|sanctions?|missiles?|invasion|ceasefire|elections?|geopolitic\w*|conflict(?! of interest))\b/i, weight: 3 },
  listing: { words: /\b(listings?|lists|listed|delist(?:s|ed|ing)?)\b/i, weight: 2 },
  unlock: { words: /\b(unlocks?|vesting|token release|airdrops?)\b/i, weight: 2 },
  buyer: { words: /\b(treasury|buys|bought|adds|scoops? up|stacking|purchases?|purchased|acquir(?:es|ed)|accumulat(?:es|ed|ion|ing)|holdings|whales?|inflows?|outflows?|BlackRock)\b/i, weight: 2 },
  outage: { words: /\b(outage|halt(?:s|ed)?|paused withdrawals|downtime|network down)\b/i, weight: 2 },
  liquidations: { words: /\b(liquidat(?:ion|ions|ed)|short squeeze|long squeeze|leverage flush)\b/i, weight: 2 },
};

/** A story's coins, its kinds and its weight (its kinds' strongest; a named major adds one; 0 is none). */
export function tag(title: string, summary: string): { coins: string[]; kinds: NewsKind[]; weight: number } {
  let text = `${title}. ${summary}`;
  const coins: string[] = [];
  for (const [sym, w] of COIN_WORDS) {
    const name = w.names.length ? new RegExp(`\\b(${w.names.map(esc).join("|")})\\b`, "i") : null;
    const ticker = new RegExp(`(?<![A-Za-z$])\\$?(${w.tickers.map(esc).join("|")})(?![A-Za-z])`);
    if ((name && name.test(text)) || ticker.test(text)) {
      coins.push(sym);
      if (name) text = text.replace(new RegExp(name.source, "gi"), " "); // "Bitcoin Cash" is not Bitcoin too
    }
  }
  const kinds = (Object.keys(KINDS) as NewsKind[]).filter((k) => KINDS[k].words.test(`${title}. ${summary}`));
  const weight = kinds.length ? Math.max(...kinds.map((k) => KINDS[k].weight)) + (coins.length ? 1 : 0) : 0;
  return { coins, kinds, weight };
}

/** The feeds, each read at most every `keepMs`, its last good read standing in while it fails; the stories of all of
 * them, each once (by its link), the newest first. */
export class News {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sources: readonly NewsSource[];
  readonly #keepMs: number;
  readonly #kept = new Map<string, { at: number; items: NewsItem[] }>();
  readonly #status = new Map<string, SourceStatus>();
  #reading: Promise<void> | null = null;

  constructor(o: { fetch?: typeof fetch; now: () => number; sources?: readonly NewsSource[]; keepMs?: number }) {
    this.#fetch = o.fetch ?? fetch;
    this.#now = o.now;
    this.#sources = o.sources ?? SOURCES;
    this.#keepMs = o.keepMs ?? 5 * 60_000;
  }

  async #read(s: NewsSource): Promise<void> {
    const was = this.#kept.get(s.name);
    if (was && this.#now() - was.at < this.#keepMs) return;
    try {
      const r = await this.#fetch(s.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "Orbz/1.0 (desk news)" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`${s.name} answered ${r.status}`);
      const xml = await r.text();
      const items = parseFeed(xml.slice(0, 3_000_000), s.name).map((x) => ({ ...x, ...tag(x.title, x.summary) }));
      if (!items.length) throw new Error(`${s.name} gave no stories`);
      this.#kept.set(s.name, { at: this.#now(), items });
      this.#status.set(s.name, { name: s.name, ok: true, error: null, at: this.#now(), items: items.length });
    } catch (e) {
      // its last good read stands; asked again after the keep, not at once
      this.#kept.set(s.name, { at: this.#now(), items: was?.items ?? [] });
      this.#status.set(s.name, { name: s.name, ok: false, error: (e as Error).message.slice(0, 160), at: was ? (this.#status.get(s.name)?.at ?? null) : null, items: was?.items.length ?? 0 });
    }
  }

  /** The stories now (the newest first, `max` at most), and how each feed is. */
  async read(o: { max?: number; coin?: string | null; hours?: number } = {}): Promise<{ items: NewsItem[]; sources: SourceStatus[] }> {
    this.#reading ??= Promise.all(this.#sources.map((s) => this.#read(s))).then(() => undefined).finally(() => (this.#reading = null));
    await this.#reading;
    const seen = new Set<string>();
    const since = o.hours ? this.#now() - o.hours * 3_600_000 : -Infinity;
    const items = [...this.#kept.values()].flatMap((k) => k.items)
      .filter((x) => x.at >= since && x.at <= this.#now() + 3_600_000 && (!o.coin || x.coins.includes(o.coin)))
      .sort((a, b) => b.at - a.at)
      .filter((x) => {
        const key = x.title.toLowerCase().replace(/\W+/g, " ").trim();
        if (seen.has(x.url) || seen.has(key)) return false;
        seen.add(x.url);
        seen.add(key);
        return true;
      })
      .slice(0, o.max ?? 60);
    return { items, sources: this.#sources.map((s) => this.#status.get(s.name) ?? { name: s.name, ok: false, error: "not read yet", at: null, items: 0 }) };
  }
}

/** How a coin moved since a story came out: from the open of the bar it came out in to the last close (bars of any one
 * length, oldest first); null when the story is older than the bars or newer than the last. */
export function moveSince(at: number, bars: readonly { t: number; o: number; c: number }[], barMs: number): number | null {
  if (!bars.length || at < bars[0]!.t || at >= bars.at(-1)!.t + barMs) return null;
  const from = bars.find((b) => at >= b.t && at < b.t + barMs);
  if (!from || !(from.o > 0)) return null;
  return bars.at(-1)!.c / from.o - 1;
}

/** The bars a story's move is read on: 15 minutes, two days of them. */
export const NEWS_BAR_MS = 900_000;
export type Moved = NewsItem & { moves: Record<string, number | null> };
/** Each story with how each major it names has moved since it came out (each coin's bars read once). */
export async function moved(items: readonly NewsItem[], bars: (symbol: string) => Promise<readonly { t: number; o: number; c: number }[]>): Promise<Moved[]> {
  const got = new Map<string, readonly { t: number; o: number; c: number }[]>();
  for (const s of [...new Set(items.flatMap((x) => x.coins))].slice(0, 12)) got.set(s, await bars(s).catch(() => []));
  return items.map((x) => ({ ...x, moves: Object.fromEntries(x.coins.map((c) => [c, got.has(c) ? moveSince(x.at, got.get(c)!, NEWS_BAR_MS) : null])) }));
}
