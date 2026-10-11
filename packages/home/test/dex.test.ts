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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { serve } from "../src/api.ts";
import { openDb } from "../src/db.ts";
import { sqliteBars } from "../src/desk/bars.ts";
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

test("GeckoTerminal held to its minute (owner, 10-11: \"api.geckoterminal.com answered 429\"): a chart's bars may use all of it, what trends three quarters; a 429 rests as long as it asks; while it rests or its minute is spent, what it said last stands in", async () => {
  let now = START;
  let busy = false; // it answers 429, asking for 45 seconds
  const asked: string[] = [];
  const source: DexSource = {
    name: "stand-in", search: async () => [], pairs: async () => [], trades: async () => [],
    candles: async (_c, pool) => {
      asked.push(pool);
      if (busy) throw Object.assign(new Error("api.geckoterminal.com asked us to slow down (429)"), { slowDown: 45_000 });
      return [{ t: START, o: 1, h: 1, l: 1, c: Number(pool.slice(1)) || 1, v: 1 }];
    },
    trending: async (chain) => (asked.push(`trending ${chain}`), []),
  };
  const dex = new Dex(source, () => now);
  for (let i = 0; i < 18; i++) await dex.candles("solana", `p${i}`, MINT, "15m");
  await assert.rejects(() => dex.trending("solana"), /this minute are spent/, "what trends waits once three quarters of the minute are asked");
  for (let i = 18; i < Dex.GECKO_PER_MINUTE; i++) await dex.candles("solana", `p${i}`, MINT, "15m");
  await assert.rejects(() => dex.candles("solana", "p99", MINT, "15m"), /this minute are spent/, "a chart's bars stop at the minute's limit");
  assert.equal(asked.length, Dex.GECKO_PER_MINUTE, "nothing over the limit was asked");
  assert.equal((await dex.candles("solana", "p3", MINT, "15m"))[0]!.c, 3, "a chart already read still answers");
  now += 61_000; // a minute on: room again, and every chart's minute kept is up
  assert.deepEqual(await dex.trending("solana"), []);
  busy = true;
  assert.equal((await dex.candles("solana", "p5", MINT, "15m"))[0]!.c, 5, "asked too often: what it said last stands in");
  assert.ok(dex.status().restingUntil! >= now + 45_000, "resting as long as it asked");
  await assert.rejects(() => dex.candles("solana", "p77", MINT, "15m"), /resting/, "a chart it never answered has nothing to stand in");
  const before = asked.length;
  now += 30_000;
  await dex.candles("solana", "p6", MINT, "15m");
  assert.equal(asked.length, before, "still resting: not asked");
  now += 16_000;
  busy = false;
  assert.equal((await dex.candles("solana", "p77", MINT, "15m"))[0]!.c, 77, "rested: asked again");
  now += Dex.STALE_MS + 61_000;
  busy = true;
  await assert.rejects(() => dex.candles("solana", "p8", MINT, "15m"), /429/, "an answer half an hour old does not stand in");
});

test("a market now, for a chart's forming bar (owner, 10-11: \"the candlestick freezes at what we started the chart on, price too\"): a Solana coin at Jupiter's price, kept seconds; its pair's when Jupiter cannot say, and on another chain; a major's own forming bar; never GeckoTerminal", async (t) => {
  let jup: number | null = 0.171;
  const clock = new FakeClock(START);
  const dexFetch = standInDexFetch({ jupiter: () => jup });
  const { home } = await agentHome(t, [], { clock, desk: { source: standInMarket(() => clock.now()), routers: standInRouters({ outPer: () => 680 }), fetch: standInChains({}), dex: publicDex({ fetch: dexFetch }) } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const live = async (market: string, tf = "15m") => {
    const r = await fetch(`http://127.0.0.1:${door.port}/desk/live?market=${encodeURIComponent(market)}&tf=${tf}`, { headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, body: (await r.json()) as { price: number | null; bar: { t: number; c: number } | null } };
  };
  assert.equal((await live(`solana:${MINT}`)).body.price, 0.171, "Jupiter's price");
  jup = 0.18;
  assert.equal((await live(`solana:${MINT}`)).body.price, 0.171, "kept a few seconds");
  clock.suspend(3_500);
  assert.equal((await live(`solana:${MINT}`)).body.price, 0.18, "asked again after them");
  jup = null;
  clock.suspend(3_500);
  assert.equal((await live(`solana:${MINT}`)).body.price, 0.16, "Jupiter not answering: its most liquid pair's price");
  assert.equal((await live(`base:${EVM_TOKEN}`)).body.price, 2, "another chain: its pair's");
  const sol = (await live("SOL", "1m")).body;
  assert.ok(sol.bar && sol.price === sol.bar.c && sol.bar.t <= clock.now() && clock.now() < sol.bar.t + 60_000, "a major: its own forming bar, now");
  assert.ok(!dexFetch.urls.some((u) => u.includes("/ohlcv/") || u.includes("/trades") || u.includes("trending")), "never GeckoTerminal");
  assert.equal((await live("NOPE")).status, 400);
  assert.equal((await live("SOL", "3m")).status, 400);
});

test("a pool's bars kept (owner, 10-11: \"No chart now ... 429 can we use something else? thatsfree\"): after a restart they stand in while GeckoTerminal rests; once read, only what has formed since is asked; asks spaced apart, a wait too long refused", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbs-bars-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = START;
  let busy = false;
  const limits: number[] = [];
  const source: DexSource = {
    name: "stand-in", search: async () => [], pairs: async () => [], trades: async () => [], trending: async () => [],
    candles: async (_c, _p, _t, _tf, limit) => {
      limits.push(limit);
      if (busy) throw Object.assign(new Error("api.geckoterminal.com asked us to slow down (429)"), { slowDown: 30_000 });
      // the bars up to the one forming now, 5 minutes apart
      const last = Math.floor(now / 300_000) * 300_000;
      return Array.from({ length: limit }, (_, i) => ({ t: last - (limit - 1 - i) * 300_000, o: 1, h: 2, l: 0.5, c: 1 + i / 1000, v: 10 }));
    },
  };
  const db1 = openDb(dir);
  const first = new Dex(source, () => now, { bars: sqliteBars(db1) });
  assert.equal((await first.candles("solana", POOL, MINT, "5m", 100)).length, 100);
  db1.close();
  // a restart: a new home on the same database, and GeckoTerminal resting
  busy = true;
  now += 2 * 60_000;
  const db2 = openDb(dir);
  t.after(() => db2.close());
  const second = new Dex(source, () => now, { bars: sqliteBars(db2) });
  const kept = await second.candles("solana", POOL, MINT, "5m", 100);
  assert.equal(kept.length, 100, "after a restart, what was kept stands in while it rests");
  busy = false;
  now += 60 * 60_000; // past its rest, an hour of bars on
  await second.candles("solana", POOL, MINT, "5m", 100);
  assert.ok(limits.at(-1)! <= 15 && limits.at(-1)! >= 2, `once read, only what formed since is asked (${limits.at(-1)} bars), never the whole again`);
  assert.equal((await second.candles("solana", POOL, MINT, "5m", 100)).at(-1)!.t, Math.floor(now / 300_000) * 300_000, "up to the bar forming now");
  // asks one at a time, spaced; a wait too long is refused at once
  const spaced = new Dex(source, () => now, { spacingMs: 120 });
  const t0 = Date.now();
  await Promise.all(["a", "b", "c"].map((p) => spaced.candles("solana", `${p}${POOL}`.slice(0, 44), MINT, "5m", 10)));
  assert.ok(Date.now() - t0 >= 230, "three asks at least two spacings apart");
  const slow = new Dex(source, () => now, { spacingMs: 4_500 });
  const x = slow.candles("solana", `x${POOL}`.slice(0, 44), MINT, "5m", 10); // its turn now
  const y = slow.candles("solana", `y${POOL}`.slice(0, 44), MINT, "5m", 10); // in 4.5 seconds
  await assert.rejects(() => slow.candles("solana", `z${POOL}`.slice(0, 44), MINT, "5m", 10), /asked too fast/, "a turn over eight seconds off is refused at once, not waited for");
  await Promise.all([x, y]);
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

test("a Solana wallet its endpoints will not fully read: Token-2022's coins by the program's accounts; the rest standing, and said, when those fail too; Jupiter's free balances when the chain cannot be read", async (t) => {
  const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const parsed = (mint: string, amount: string, decimals: number) => ({ pubkey: "x", account: { data: { parsed: { type: "account", info: { mint, tokenAmount: { amount, decimals } } } } } });
  let chain = true; // the chain's endpoints answer at all
  let scan = true; // and Token-2022's accounts by their owner
  let jupiter = false; // Jupiter's free balances answer
  const { home, clock } = await tokenHome(t, {
    chains: {
      getBalance: () => {
        if (!chain) throw new Error("Request blocked");
        return { value: 1_000_000_000 };
      },
      getTokenAccountsByOwner: (p) => {
        if (!chain || !(p[1] as { programId: string }).programId.startsWith("Tokenkeg")) throw new Error(chain ? "INVALID_PARAMS" : "Request blocked");
        return { value: [parsed(USDC, "25000000", 6)] };
      },
      getProgramAccounts: () => {
        if (!chain || !scan) throw new Error("Indexed requests require a personal token");
        return [parsed(BONK, "500000", 5)];
      },
      "GET /ultra/v1/holdings/": () => {
        if (!jupiter) throw new Error("Jupiter is down");
        return { amount: "2000000000", tokens: { [USDC]: [{ amount: "5000000", decimals: 6, programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }], [BONK]: [{ amount: "400000", decimals: 5, programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE6ZnmXR6Hn1zf" }, { amount: "300000", decimals: 5, programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE6ZnmXR6Hn1zf" }] } };
      },
    },
  });
  const w = home.wallets.add(OWNER);
  const read = async () => {
    clock.suspend(61_000); // past a wallet's minute
    const r = await home.wallets.holdings(w.id);
    return { coins: Object.fromEntries(r.holdings.map((h) => [h.key === `solana:${BONK}` ? "BONK" : h.symbol, h.amount])), errors: r.errors };
  };
  assert.deepEqual(await read(), { coins: { SOL: "1", USDC: "25", BONK: "5" }, errors: [] }, "the chain read: Token-2022's coins by the program's accounts");
  scan = false;
  assert.deepEqual(await read(), { coins: { SOL: "1", USDC: "25" }, errors: ["Solana's Token-2022 coins: Indexed requests require a personal token"] }, "those refused: the rest stands, and the gap is said");
  jupiter = true;
  assert.deepEqual(await read(), { coins: { SOL: "1", USDC: "25", BONK: "7" }, errors: [] }, "Jupiter's balances for Token-2022's coins only (a coin's accounts summed), the chain's for the rest");
  chain = false;
  assert.deepEqual(await read(), { coins: { SOL: "2", USDC: "5", BONK: "7" }, errors: [] }, "the chain refusing: Jupiter's balances, every coin");
  jupiter = false;
  assert.deepEqual(await read(), { coins: {}, errors: ["Solana: Request blocked"] }, "neither: not read, said so");
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
  const thin = await safetyOf("bsc", EVM_TOKEN, pair({ liquidityUsd: 4_000, createdAt: START - 3600_000, dex: "pumpfun" }), { now: START, fetch: standInChains({ eth_getCode: () => evmCode("weth-base") }) });
  assert.deepEqual(thin.flags.map((f) => f.level), ["warn", "warn", "note"], "thin, new, still on its curve: its pair's own facts (its code clean)");
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
  const tools = new Map(deskTools({ desk: home.desk, wallets: home.wallets, orders: home.orders, dex: home.dex, safety: (c, a) => home.tokenSafety(c, a), now: () => home.clock.now(), nameOf: (x) => x }).map((x) => [x.name, x]));
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

test("an orb sent to a coin: told in its chat to trade it from its account (PLAN 5.34: the same words whatever its account is); it walks to the war room's screen; what is not one refused", async (t) => {
  const { home } = await tokenHome(t);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const post = async (b: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}/desk/send`, { method: "POST", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const key = `solana:${MINT}`;
  const sent = await post({ orb: "tess", market: key, budget: 100, note: "under $0.15" });
  assert.deepEqual(sent.json.sent, { orb: "tess", market: key, label: "Fartcoin", mode: "paper", budget: 100 }, "named by its symbol; you are told its account's kind");
  const told = sent.json.item as { conversation: string; text: string };
  assert.equal(told.conversation, "chat:tess", "told in its own chat");
  assert.match(told.text, /^Trade Fartcoin \(solana:9BB6\S+pump\) for me, with up to \$100 of your account\. Read it first: token_info .* place an order on "solana:9BB6\S+pump" \(place_order\).* My note: under \$0\.15/);
  assert.deepEqual(home.events.ofType("desk.sent").map((e) => [e.orb, e.data.label, e.data.mode]), [["tess", "Fartcoin", "paper"]], "its moment on the floor: to the war room's screen");
  assert.equal((await post({ orb: "tess", market: "BTC" })).status, 200, "a major too");
  assert.equal((await post({ orb: "nobody", market: key })).status, 404);
  assert.equal((await post({ orb: "tess", market: "NOPE" })).status, 400, "not a market");
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

// your wallets' worth and each orb's P&L (PLAN 5.31; owner, 10-11: "users can see wallet balance and analytics as well.
// and each orb pnl"); a swap on BNB Chain ("coin swap in general")
test("a wallet's every coin: on Solana both token programs, a coin the desk does not know at its pair's price; on an EVM chain a coin swapped through Orbz", async (t) => {
  const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const account = (mint: string, amount: string, decimals: number, type = "account") => ({ account: { data: { parsed: { type, info: { mint, tokenAmount: { amount, decimals } } } } } });
  const programs: string[] = [];
  const { home, chains } = await tokenHome(t, {
    chains: {
      getBalance: () => ({ value: 2_000_000_000 }),
      // as the official endpoint answers (10-11): the classic program's coins by their owner, Token-2022's refused
      getTokenAccountsByOwner: (p) => {
        const program = (p[1] as { programId: string }).programId;
        if (!program.startsWith("Tokenkeg")) throw new Error("INVALID_PARAMS");
        programs.push(program);
        return { value: [account("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "25000000", 6), account(MINT, "1000000000", 6), account(BONK, "0", 5)] };
      },
      // Token-2022's: the program's accounts whose owner (at byte 32) is this wallet; a mint of its own is no coin held
      getProgramAccounts: (p) => {
        const [program, o] = p as [string, { filters: { memcmp: { offset: number; bytes: string } }[] }];
        assert.deepEqual(o.filters, [{ memcmp: { offset: 32, bytes: OWNER } }]);
        programs.push(program);
        return [account(BONK, "500000", 5), account(BONK, "0", 5, "mint")];
      },
      getTokenSupply: () => ({ value: { decimals: 18, amount: "1", uiAmountString: "1" } }),
      eth_getBalance: () => "0x0",
      // the coin swapped through Orbz holds 3 of 18 decimals; nothing else is held
      eth_call: (p) => {
        const { to, data } = p[0] as { to: string; data: string };
        if (to.toLowerCase() !== EVM_TOKEN) return "0x0";
        return data.startsWith("0x313ce567") ? "0x12" : `0x${(3n * 10n ** 18n).toString(16)}`;
      },
    },
  });
  const sol = home.wallets.add(OWNER);
  const got = (await home.wallets.holdings(sol.id)).holdings;
  assert.deepEqual(programs.sort(), ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE6ZnmXR6Hn1zf"], "both token programs read: the classic by owner, Token-2022 by its accounts' owner");
  assert.deepEqual((await home.wallets.holdings(sol.id)).errors, [], "nothing left unread");
  const by = new Map(got.map((h) => [h.symbol, h]));
  assert.equal(by.get("USDC")!.usd, 25, "a coin the desk knows, at its price");
  const fart = by.get("Fartcoin")!;
  assert.deepEqual([fart.amount, fart.usd, fart.key], ["1000", 160, `solana:${MINT}`], "a pump.fun coin, at its pair's price, with its key");
  assert.ok(got.some((h) => h.key === `solana:${BONK}` && h.usd === null && Number(h.amount) === 5), "a Token-2022 coin with no pair: held, no price");
  assert.ok(!got.some((h) => h.key === `solana:${BONK}` && Number(h.amount) === 0), "an empty account is nothing held");
  // an EVM wallet: the coins the desk knows, and one swapped through Orbz (asked of you, kept by its address)
  await home.swaps.ask({ by: "tess", chain: "base", sell: "USDC", buy: EVM_TOKEN, amount: "10" });
  const evm = home.wallets.add("0x52908400098527886E0F7030069857D2E4169EE7");
  const held = (await home.wallets.holdings(evm.id)).holdings;
  assert.deepEqual(held.map((h) => [h.symbol, h.amount, h.usd, h.key]), [["TST", "3", 6, `base:${EVM_TOKEN}`]], "the coin it swapped, its decimals read from its chain");
  const decimalsAsks = chains.calls.length;
  home.wallets.remove(evm.id);
  const again = home.wallets.add("0x52908400098527886E0F7030069857D2E4169EE7");
  await home.wallets.holdings(again.id);
  assert.ok(chains.calls.length > decimalsAsks, "read again after a minute's cache is gone");
});

test("each orb's P&L: its closed trades summed (a win, a loss), its books against what they started with; a swap quoted on BNB Chain", async (t) => {
  let price = "0.16";
  const { home, clock } = await tokenHome(t, { price: () => price, chains: { getTokenSupply: () => ({ value: { decimals: 6, amount: "1", uiAmountString: "1" } }) } });
  const key = `solana:${MINT}`;
  await home.desk.paperTrade("tess", key, "buy", 1000);
  price = "0.20";
  clock.suspend(20_000);
  await home.desk.paperTrade("tess", key, "sell", 1_000_000); // a win
  await home.desk.paperTrade("tess", key, "buy", 500);
  price = "0.10";
  clock.suspend(20_000);
  await home.desk.paperTrade("tess", key, "sell", 1_000_000); // a loss
  const [tess] = home.desk.pnl();
  assert.deepEqual([tess!.orb, tess!.trades, tess!.wins], ["tess", 2, 1]);
  assert.ok(tess!.best! > 0 && tess!.worst! < 0 && tess!.today === tess!.realized, "its best and worst; today all of it");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const snap = (await (await fetch(`http://127.0.0.1:${door.port}/desk`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { orbs: { orb: string; pnl: number; start: number; equity: number; trades: number; open: number }[] };
  const row = snap.orbs.find((o) => o.orb === "tess")!;
  assert.ok(Math.abs(row.pnl - tess!.realized) < 1e-6, "its P&L: its book against what it started with, the same as its closed trades when nothing is open (each counted once)");
  assert.deepEqual([row.start, row.open, row.trades], [10_000, 0, 2]);
  const q = await home.swaps.quote({ chain: "bsc", sell: "USDT", buy: "BNB", amount: "10" });
  assert.equal(q.usd, 10, "BNB Chain: USDT at a dollar");
});
