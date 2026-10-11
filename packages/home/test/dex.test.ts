// PLAN 5.28_t, any token on a DEX (owner, 10-11: "We want this to be decentralized, shitcoins, anything. with a search
// bar for any contract address, like https://dexscreener.com/ s search. Pump.funs addresses can be entered as well"), on
// stand-ins (no network: self-made answers in the public APIs' shapes):
//   - DexScreener's and GeckoTerminal's answers read as the desk's pairs, bars, trades and what is trending: a chain it
//     does not look at left out, a link that is not https dropped, a pool's bars oldest first, a trade's side the token's.
//   - A search: each token once, on its most liquid pair, the most liquid first; a Solana address (a pump.fun mint too)
//     looked up as one; kept a while, not asked again; a failing source rests longer each time while the other answers.
//   - A token where a symbol would be: its price and bars from its most liquid pair; a paper trade in it kept by its key,
//     a winning sale XP in the desk's area; a swap in it by its address, its decimals read from its own chain once.
//   - What a token can do: a Solana mint that can freeze or mint, a fee on every transfer; on the EVM chains USDC's proxy
//     and its upgradeTo (real bytecode), WETH with nothing against it (the control), an address with no code.
//   - The orbs' token_search and token_info; the door's routes, and what they refuse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { Dex, isTokenAddress, publicDex, readTokenKey, tokenKey, type DexPair, type DexSource } from "../src/desk/dex.ts";
import { safetyOf } from "../src/desk/safety.ts";
import { deskTools } from "../src/desk/tools.ts";
import { radarOf } from "../src/gym/specialty.ts";
import { agentHome } from "./helpers.ts";
import { standInChains, standInMarket, standInRouters } from "./fakes/market.ts";
import { BONK, EVM_TOKEN, MINT, POOL, START, standInDexFetch, THIN, WSOL } from "./fakes/dex.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIN = 60_000;
test("the public answers read as the desk's: pairs, bars oldest first, a trade's side the token's own, what is trending; another chain and a link not https left out", async () => {
  const src = publicDex({ fetch: standInDexFetch() });
  const found = await src.search("fart");
  assert.deepEqual(found.map((p) => p.chain), ["solana", "solana", "solana"], "a chain the desk does not look at is left out");
  const top = found[1]!;
  assert.deepEqual([top.base.symbol, top.priceUsd, top.liquidityUsd, top.volume24h, top.buys24h, top.change.h24], ["Fartcoin", 0.16, 8_000_000, 2_000_000, 1200, 12.5]);
  assert.deepEqual(top.links.map((l) => l.url), ["https://example.test", "https://x.com/example"], "a javascript: link is never kept");
  const bars = await new Dex(src, () => START).candles("solana", POOL, MINT, "5m", 4);
  assert.deepEqual(bars.map((b) => b.t), [START - 900_000, START - 600_000, START - 300_000, START], "oldest first, in milliseconds");
  const trades = await src.trades("solana", POOL, MINT);
  assert.deepEqual(trades.map((t) => [t.side, t.amount, t.priceUsd]), [["buy", 680, 0.161], ["sell", 15000, 0.164]], "the token's side: bought when it left the pool");
  const trending = await src.trending("solana");
  assert.deepEqual([trending[0]!.base.symbol, trending[0]!.dex, trending[0]!.liquidityUsd, trending[0]!.change.h24], ["Fartcoin", "pump-fun", 18000, 1193.8]);
});

test("a search: each token once on its most liquid pair, the most liquid first; a Solana address looked up as one (a pump.fun mint too); kept a while; a failing source rests while the other answers", async () => {
  let now = START;
  let failing = false;
  const f = standInDexFetch({ fail: () => failing });
  const dex = new Dex(publicDex({ fetch: f }), () => now);
  const found = await dex.search("fart");
  assert.deepEqual(found.map((p) => [p.base.symbol, p.pair]), [["Fartcoin", POOL], ["Bonk", "BONKpairBONKpairBONKpairBONKpairBONKpair1"]], "Fartcoin once, on its deeper pool, first");
  const asked = f.urls.length;
  await dex.search("FART");
  assert.equal(f.urls.length, asked, "kept: not asked again within its time");
  now += 21_000;
  await dex.search("fart");
  assert.equal(f.urls.length, asked + 1, "asked again once its time is up");
  const byAddress = await dex.search(MINT);
  assert.ok(f.urls.at(-1)!.startsWith(`/tokens/v1/solana/${MINT}`), "a mint is looked up as an address, not searched for as words");
  assert.deepEqual(byAddress.map((p) => p.pair), [POOL]);
  assert.equal(await dex.price("solana", MINT), 0.16, "its price, from its most liquid pair");
  // DexScreener failing: it rests (2 s, then 4 s), while GeckoTerminal still answers
  failing = true;
  now += 30_000;
  await assert.rejects(() => dex.search("bonk"), /503/);
  const resting = f.urls.length;
  await assert.rejects(() => dex.search("bonk2"), /resting/);
  assert.equal(f.urls.length, resting, "resting: not asked at all");
  assert.equal(dex.status().ok, false);
  failing = false;
  assert.equal((await dex.candles("solana", POOL, MINT, "1m", 4)).length, 4, "the other source answers meanwhile");
  now += 2_100;
  assert.equal((await dex.search("bonk")).length, 2, "after its rest, asked again");
  assert.equal(dex.status().ok, true);
});

test("a token's key and address: a pump.fun mint, a Solana token, an EVM token; what is not one", () => {
  assert.ok(isTokenAddress("solana", MINT), "a pump.fun mint is a Solana address like any other");
  assert.ok(isTokenAddress("solana", BONK));
  assert.ok(isTokenAddress("base", EVM_TOKEN));
  for (const bad of ["0OIl" + MINT.slice(4), MINT.slice(0, 20), `${MINT}x`, "pump"]) assert.equal(isTokenAddress("solana", bad), false, bad);
  assert.equal(isTokenAddress("base", "0x123"), false);
  assert.equal(isTokenAddress("solana", EVM_TOKEN), false, "an EVM address is not a Solana one");
  assert.deepEqual(readTokenKey(tokenKey("solana", MINT)), { chain: "solana", address: MINT });
  assert.equal(readTokenKey("BTC"), null);
  assert.equal(readTokenKey(`tron:${MINT}`), null, "a chain the desk does not look at");
});

async function tokenHome(t: Parameters<typeof agentHome>[0], o: { price?: () => string; chains?: Parameters<typeof standInChains>[0] } = {}) {
  const clock = new FakeClock(START);
  const chains = standInChains(o.chains ?? {});
  const dexFetch = standInDexFetch({ price: o.price });
  const { home } = await agentHome(t, [], { clock, desk: { source: standInMarket(() => clock.now()), routers: standInRouters({ outPer: () => 680 }), fetch: chains, dex: publicDex({ fetch: dexFetch }) } });
  home.inbox.addOrb("tess", "Tess", "dealer");
  return { home, clock, chains, dexFetch };
}

test("a token where a symbol would be: its price and bars; a paper trade in it kept by its key, a winning sale XP in the desk's area", async (t) => {
  let price = "0.16";
  const { home, clock } = await tokenHome(t, { price: () => price });
  const key = tokenKey("solana", MINT);
  assert.equal(await home.market.price(key), 0.16);
  assert.equal((await home.market.candles(key, "5m", 4)).length, 4, "its bars, from its most liquid pair");
  const bought = await home.desk.paperTrade("tess", key, "buy", 500);
  assert.ok(bought.book.holdings.some((h) => h.symbol === key && h.qty > 0), "held by its key");
  price = "0.20";
  clock.suspend(20_000); // past the pairs' keep
  const sold = await home.desk.paperTrade("tess", key, "sell", 1_000_000);
  assert.ok((sold.trade as { pnl: number }).pnl > 0, "sold for more than it cost, after fees");
  assert.equal(home.events.ofType("xp.earned").filter((e) => e.orb === "tess").length, 1, "a winning sale is XP");
  assert.ok(radarOf(home.events, "tess").desk.xp > 0, "in the desk's area");
  // the control: a market that is neither a major nor a token is no market
  await assert.rejects(() => home.desk.paperTrade("tess", "solana:not-an-address", "buy", 10), /no live price/);
});

test("a swap in any token by its address: its decimals read from its own chain once, kept as its address; one that answers none refused", async (t) => {
  const { home, chains } = await tokenHome(t, { chains: { getTokenSupply: (p) => (p[0] === MINT ? { value: { decimals: 6, amount: "1", uiAmountString: "1" } } : null) } });
  const q = await home.swaps.quote({ chain: "solana", sell: "SOL", buy: MINT, amount: "0.5" });
  assert.ok(Number(q.amountOut) > 0, "quoted");
  const mine = await home.swaps.ask({ by: null, chain: "solana", sell: "SOL", buy: MINT, amount: "0.5" });
  assert.equal(mine.buy, MINT, "a token the desk does not know is kept by its address");
  assert.equal(mine.sell, "SOL", "one it knows, by its name");
  const before = chains.calls.filter((c) => c === "getTokenSupply").length;
  await home.swaps.build(mine.id, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU").catch(() => undefined);
  assert.equal(chains.calls.filter((c) => c === "getTokenSupply").length, before, "its decimals read once, then kept");
  await assert.rejects(() => home.swaps.quote({ chain: "solana", sell: "SOL", buy: BONK, amount: "0.5" }), /no decimals|not a token/, "an address that answers no decimals is no token to swap");
  await assert.rejects(() => home.swaps.quote({ chain: "solana", sell: "SOL", buy: "not-an-address", amount: "0.5" }), /any token by its address/);
});

const evmCode = (name: string): string => `0x${readFileSync(join(HERE, `fixtures/contracts/${name}.hex`), "utf8").replace(/\s+/g, "").replace(/^0x/i, "")}`;

test("what a token can do: a Solana mint that can freeze or mint, a fee on every transfer; USDC's proxy and upgradeTo; WETH with nothing against it; no code at all", async () => {
  const pair = (o: Partial<DexPair>): DexPair => ({ ...(plainPair()), ...o });
  const mint = (info: Record<string, unknown>) => standInChains({ getAccountInfo: () => ({ value: { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE6ZnmXR6Hn1zf", data: { parsed: { type: "mint", info: { decimals: 6, supply: "1", ...info } } } } }) });
  const risky = await safetyOf("solana", MINT, null, { now: START, fetch: mint({ freezeAuthority: "Auth111111111111111111111111111111111111111", mintAuthority: "Auth111111111111111111111111111111111111111", extensions: [{ extension: "transferFeeConfig" }] }) });
  assert.deepEqual(risky.flags.map((f) => f.words), ["its mint can freeze what you hold", "more of it can still be minted", "it takes a fee on every transfer (Token-2022)"]);
  const clean = await safetyOf("solana", MINT, null, { now: START, fetch: mint({ freezeAuthority: null, mintAuthority: null }) });
  assert.deepEqual(clean.flags, [], "the control: a mint whose authorities are gone says nothing against it");
  const usdc = await safetyOf("base", EVM_TOKEN, null, { now: START, fetch: standInChains({ eth_getCode: () => evmCode("usdc-base") }) });
  assert.match(usdc.flags.map((f) => f.words).join(" | "), /upgradeTo\(address\).*\| it is a proxy/);
  const weth = await safetyOf("base", EVM_TOKEN, null, { now: START, fetch: standInChains({ eth_getCode: () => evmCode("weth-base") }) });
  assert.deepEqual(weth.flags, [], "the control: WETH's code has nothing against it");
  const none = await safetyOf("base", EVM_TOKEN, null, { now: START, fetch: standInChains({ eth_getCode: () => "0x" }) });
  assert.match(none.flags[0]!.words, /no code/);
  const thin = await safetyOf("bsc", EVM_TOKEN, pair({ liquidityUsd: 4_000, createdAt: START - 3600_000, dex: "pumpfun" }), { now: START });
  assert.deepEqual(thin.flags.map((f) => f.level), ["warn", "warn", "note"], "thin, new, still on its curve: from its pair alone on a chain the desk does not swap on");
});
/** A plain pair to change a field of. */
function plainPair(): DexPair {
  return {
    chain: "solana", dex: "raydium", pair: POOL, url: null, base: { address: MINT, name: "Fartcoin", symbol: "Fartcoin" }, quote: { address: WSOL, name: "Wrapped SOL", symbol: "SOL" },
    priceUsd: 0.16, priceNative: 0.0015, change: { m5: null, h1: null, h6: null, h24: null }, volume24h: null, liquidityUsd: 1_000_000, fdv: null, marketCap: null, buys24h: null, sells24h: null, createdAt: START - 400 * 24 * 3600_000, image: null, links: [],
  };
}

test("the orbs' token_search and token_info; the door's routes, and what they refuse", async (t) => {
  const { home } = await tokenHome(t, { chains: { getAccountInfo: () => ({ value: { data: { parsed: { type: "mint", info: { decimals: 6, freezeAuthority: "Auth111111111111111111111111111111111111111", mintAuthority: null } } } } }) } });
  const tools = new Map(deskTools({ desk: home.desk, wallets: home.wallets, swaps: home.swaps, dex: home.dex, safety: (c, a) => home.tokenSafety(c, a), now: () => home.clock.now(), nameOf: (x) => x }).map((x) => [x.name, x]));
  const searched = await tools.get("token_search")!.run!({ query: "fart" }, { orb: "tess" } as never);
  assert.match(searched.content as string, new RegExp(`Fartcoin \\(Fartcoin\\) on solana, solana:${MINT}: \\$0\\.160000`));
  const info = await tools.get("token_info")!.run!({ chain: "solana", address: MINT }, { orb: "tess" } as never);
  assert.match(info.content as string, /WARN: its mint can freeze what you hold/);
  assert.match(info.content as string, /\$5\.0K.*on pumpfun/, "every pair it trades on, its pump.fun curve too");
  const bad = await tools.get("token_info")!.run!({ chain: "solana", address: "nope" }, { orb: "tess" } as never);
  assert.equal(bad.isError, true);

  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const get = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal(((await get("/desk/dex/search?q=fart")).json.pairs as DexPair[]).length, 2);
  assert.equal(((await get(`/desk/dex/token/solana/${MINT}`)).json.pairs as DexPair[])[0]!.pair, POOL);
  assert.equal(((await get(`/desk/dex/safety/solana/${MINT}`)).json.safety as { flags: unknown[] }).flags.length >= 1, true);
  assert.equal(((await get(`/desk/dex/candles/solana/${POOL}?token=${MINT}&tf=5m&n=30`)).json.candles as unknown[]).length, 4);
  assert.equal(((await get(`/desk/dex/trades/solana/${POOL}?token=${MINT}`)).json.trades as unknown[]).length, 2);
  assert.equal(((await get("/desk/dex/trending?chain=solana")).json.pairs as unknown[]).length, 1);
  assert.equal((await get(`/desk/dex/token/tron/${MINT}`)).status, 400, "a chain the desk does not look at");
  assert.equal((await get("/desk/dex/token/solana/not-an-address")).status, 400, "not an address");
  assert.equal((await get(`/desk/dex/candles/solana/${POOL}?token=${MINT}&tf=7m`)).status, 400, "a timeframe it does not know");
  const snap = (await get("/desk")).json;
  assert.ok("tokens" in snap && "dex" in snap, "the desk's snapshot names any token it holds, and says how the DEX data is");
});

test("an orb sent to a coin: told in its chat, on paper or for real (each real trade still asked); it walks to the war room's screen; what is not one refused", async (t) => {
  const { home } = await tokenHome(t);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const post = async (b: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}/desk/send`, { method: "POST", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const key = `solana:${MINT}`;
  const paper = await post({ orb: "tess", market: key, mode: "paper", budget: 100, note: "under $0.15" });
  assert.deepEqual(paper.json.sent, { orb: "tess", market: key, label: "Fartcoin", mode: "paper", budget: 100 }, "named by its symbol");
  const real = await post({ orb: "tess", market: key, mode: "real" });
  assert.equal(real.status, 200);
  const told = [paper, real].map((r) => r.json.item as { conversation: string; text: string });
  assert.deepEqual(told.map((i) => i.conversation), ["chat:tess", "chat:tess"], "both told in its own chat");
  assert.match(told[0]!.text, /^Trade Fartcoin \(solana:9BB6\S+pump\) for me, on paper, up to \$100\. Read it first: token_info .* paper_trade .* My note: under \$0\.15/);
  assert.match(told[1]!.text, /for real\. .* propose_swap \(chain solana, buy 9BB6\S+pump\): it waits for my yes and my wallet's signature/, "real: asked of you, never on its own");
  assert.doesNotMatch(told[1]!.text, /paper_trade/);
  assert.deepEqual(home.events.ofType("desk.sent").map((e) => [e.orb, e.data.label, e.data.mode]), [["tess", "Fartcoin", "paper"], ["tess", "Fartcoin", "real"]], "its moment on the floor: to the war room's screen");
  assert.equal((await post({ orb: "tess", market: "BTC" })).status, 200, "a major too");
  assert.equal((await post({ orb: "nobody", market: key })).status, 404);
  assert.equal((await post({ orb: "tess", market: "SHIB" })).status, 400, "not a market");
  assert.equal((await post({ orb: "tess", market: key, budget: 0 })).status, 400, "a budget of nothing");
});

test("a coin's picture through the home: from an image host only, kept, never an SVG nor one too big; a coin trending on two pools listed once", async (t) => {
  const f = standInDexFetch();
  const dex = new Dex(publicDex({ fetch: f }), () => START);
  const pic = await dex.image("https://dd.dexscreener.com/ds-data/tokens/solana/coin.png");
  assert.deepEqual([pic.type, pic.bytes.length], ["image/png", 8]);
  const asked = f.urls.length;
  await dex.image("https://dd.dexscreener.com/ds-data/tokens/solana/coin.png");
  assert.equal(f.urls.length, asked, "kept: not fetched again");
  for (const bad of ["https://evil.example/coin.png", "http://dd.dexscreener.com/coin.png", "javascript:alert(1)"]) await assert.rejects(() => dex.image(bad), /no such picture/, bad);
  assert.equal(f.urls.length, asked, "a host that is not an image host is never asked");
  await assert.rejects(() => dex.image("https://dd.dexscreener.com/coin.svg"), /no picture there/, "an SVG can carry a script: never one");
  await assert.rejects(() => dex.image("https://dd.dexscreener.com/big.png"), /too big/);
  // what trends: the stand-in's coin on two pools, once, where it first trends
  const raw = await publicDex({ fetch: f }).trending("solana");
  assert.equal(raw.length, 2, "the source gives both pools");
  assert.deepEqual((await dex.trending("solana")).map((p) => [p.base.symbol, p.pair]), [["Fartcoin", THIN]], "the desk lists the coin once");
  // through the door: the picture as an image of its own, sandboxed; anything else not found
  const { home } = await tokenHome(t);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const get = (u: string) => fetch(`http://127.0.0.1:${door.port}/desk/dex/image?u=${encodeURIComponent(u)}`, { headers: { authorization: `Bearer ${door.token}` } });
  const ok = await get("https://dd.dexscreener.com/ds-data/tokens/solana/coin.png");
  assert.deepEqual([ok.status, ok.headers.get("content-type"), ok.headers.get("content-security-policy")], [200, "image/png", "default-src 'none'; sandbox"]);
  assert.equal((await ok.arrayBuffer()).byteLength, 8);
  assert.equal((await get("https://evil.example/coin.png")).status, 404);
});
