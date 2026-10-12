// PLAN 5.34_t, an orb's account and its orders (owner, 10-11: "how do we alternate between paper and real? and we dont
// want the orbs to know the difference. money is money"), on stand-in markets, DEX, routers and chains:
//   - an orb's account: paper unless you make it real money, its budget raised and lowered (never under what it has
//     spent), set at the door, by you;
//   - an order, the one way: on paper it fills at the price now; on real money it is a swap asked of you (the coin's own
//     chain, paid in its dollars), filled when its chain confirms it, what waits to be bought spoken for; one you deny
//     does not fill, and its dollars are free again; a winning sale is XP either way;
//   - nothing an orb reads says which: no tool's name, label or description, no order's result, no account's view, no
//     brief that sends it to a coin (the same words, paper or real);
//   - a strategy run on real money: at a bar's close its signal is an order asked of you; one still waiting holds the
//     next; made paper again, the run waits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { publicDex } from "../src/desk/dex.ts";
import { deskTools } from "../src/desk/tools.ts";
import type { Strategy } from "../src/desk/strategy.ts";
import { GROUPS } from "../src/agent/groups.ts";
import { agentHome } from "./helpers.ts";
import { standInChains, standInMarket, standInRouters } from "./fakes/market.ts";
import { MINT, START, standInDexFetch } from "./fakes/dex.ts";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const KEY = `solana:${MINT}`;
/** What an orb must never read: whether its account is paper or real money, or that a trade waits on anyone. */
const TELLS = /\bpaper\b|\breal\b|for real|simulat|propose_swap|paper_trade|approv|your yes|my yes|signature|wallet's/i;

async function deskHome(t: Parameters<typeof agentHome>[0]) {
  const clock = new FakeClock(START);
  let rate = 6.25; // what a dollar buys of the coin through the stand-in router (and, selling, what one brings)
  const chains = standInChains({
    getBalance: () => ({ value: 2_000_000_000 }),
    getTokenAccountsByOwner: () => ({ value: [] }),
    getTokenSupply: (p) => (p[0] === MINT ? { value: { decimals: 6, amount: "1", uiAmountString: "1" } } : null),
    getAccountInfo: () => ({ value: { data: { parsed: { type: "mint", info: { decimals: 6, mintAuthority: null, freezeAuthority: null } } } } }),
    getSignatureStatuses: () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
  });
  const { home } = await agentHome(t, [], { clock, desk: { source: standInMarket(() => clock.now()), routers: standInRouters({ outPer: () => rate }), fetch: chains, dex: publicDex({ fetch: standInDexFetch() }) } });
  home.inbox.addOrb("tess", "Tess", "dealer");
  const tools = new Map(deskTools({ desk: home.desk, wallets: home.wallets, orders: home.orders, dex: home.dex, safety: (c, a) => home.tokenSafety(c, a), now: () => home.clock.now(), nameOf: (x) => x }).map((x) => [x.name, x]));
  const use = async (name: string, a: Record<string, unknown>) => String((await tools.get(name)!.run!(a, { orb: "tess" } as never)).content);
  /** your yes, your wallet's signature, and its chain's confirmation */
  const confirm = async (swap: number) => {
    home.swaps.answer(swap, true);
    await home.swaps.build(swap, WALLET);
    home.swaps.sent(swap, `${"5".repeat(80)}${swap}`.slice(0, 88));
    await home.swaps.due();
  };
  return { home, clock, tools, use, confirm, setRate: (r: number) => void (rate = r) };
}

test("an orb's account: paper unless you make it real money; its budget raised and lowered, never under what it has spent; set at the door, by you", async (t) => {
  const { home, use, confirm } = await deskHome(t);
  assert.deepEqual([home.desk.account("tess").mode, home.desk.account("tess").book.cash], ["paper", 10_000], "paper, $10,000 to start");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const put = async (orb: string, b: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}/desk/accounts/${orb}`, { method: "PUT", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: (await r.json()) as { account?: { mode: string; budget: number; cash: number }; error?: string } };
  };
  assert.deepEqual((await put("tess", { mode: "real", budget: 100 })).json.account, { orb: "tess", mode: "real", budget: 100, paper: 10_000, cash: 100 } as never);
  await use("place_order", { market: KEY, side: "buy", usd: 40, why: "a test" });
  await confirm(home.swaps.list()[0]!.id);
  assert.equal(home.desk.account("tess").book.cash, 60, "it spent $40");
  // your P&L of it: paper and real money apart, a dollar of each not the same to you
  const snap = (await (await fetch(`http://127.0.0.1:${door.port}/desk`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { orbs: { orb: string; start: number; money: { start: number; equity: number } | null }[] };
  const row = snap.orbs.find((x) => x.orb === "tess")!;
  assert.deepEqual([row.start, row.money?.start], [10_000, 100], "its paper started at $10,000, its real money at $100, each apart");
  assert.equal((await put("tess", { mode: "real", budget: 150 })).json.account!.cash, 110, "raised: $50 more to spend");
  assert.equal((await put("tess", { mode: "real", budget: 50 })).json.account!.cash, 10, "lowered: $100 less");
  const under = await put("tess", { mode: "real", budget: 30 });
  assert.deepEqual([under.status, /has spent \$40\.00/.test(under.json.error ?? "")], [409, true], "never under what it has spent");
  assert.equal((await put("tess", { mode: "paper" })).json.account!.mode, "paper");
  assert.equal(home.desk.account("tess").book.cash, 10_000, "on paper again: its paper account, as it was");
  assert.equal((await put("tess", { mode: "both" })).status, 400);
  assert.equal((await put("nobody", { mode: "real" })).status, 404);
  assert.ok(!(await import("../src/desk/tools.ts")).deskTools.toString().includes("setAccount"), "no tool of an orb's sets an account");
});

test("its paper, as much as you say (owner, 10-11: \"why cant we choose how much paper cash we have?\"): set at the door; its paper account's dollars follow it, never under what it has spent; an order over them refused; a strategy run on paper begins with it", async (t) => {
  const { home, use } = await deskHome(t);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const put = async (b: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}/desk/accounts/tess`, { method: "PUT", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: (await r.json()) as { account?: { paper: number; cash: number }; error?: string } };
  };
  assert.equal(home.desk.account("tess").paper, 10_000, "$10,000 till you say");
  assert.deepEqual([(await put({ mode: "paper", paper: 500 })).json.account!.paper, home.desk.account("tess").book.cash], [500, 500], "its paper is $500 now");
  assert.match(await use("place_order", { market: KEY, side: "buy", usd: 600, why: "too much" }), /has \$500\.00 to spend/, "an order over it refused");
  await use("place_order", { market: KEY, side: "buy", usd: 300, why: "the dip" });
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert.ok(near(home.desk.account("tess").book.cash, 199.99), "$300 and the router's network fee, a cent here");
  assert.ok(near((await put({ mode: "paper", paper: 1_000 })).json.account!.cash, 699.99), "raised: $500 more to spend");
  const under = await put({ mode: "paper", paper: 200 });
  assert.deepEqual([under.status, /spent \$300\.01/.test(under.json.error ?? "")], [409, true], "never under what it has spent");
  assert.equal((await put({ mode: "paper", paper: -5 })).status, 409);
  const kept = home.desk.save({ name: "Any", symbol: "SOL", timeframe: "1h", sizePct: 10, entry: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "value", value: 0 } }] }, exit: { all: [{ left: { kind: "price", field: "close" }, op: "<", right: { kind: "value", value: 0 } }] } }, "tess");
  assert.equal((await home.desk.run(kept.id, "tess")).cashStart, 1_000, "a strategy run on paper begins with its paper");
});

test("your own paper (owner, 10-11: \"still cant decide what amount we want to paper trade... simulate slippage etc.\"): as much as you say; filled at the router's quote for its size (its coins, its impact, its network fee paid), a coin with no route at the market's price and the usual cost; never real money, never an orb's; an orb's paper quoted alike", async (t) => {
  const { home, use, setRate } = await deskHome(t);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const ask = async (path: string, method: string, b: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  };
  assert.equal((await ask("/desk/accounts/~you", "PUT", { mode: "paper", paper: 1_000 })).status, 200);
  const bought = await ask("/desk/paper", "POST", { market: KEY, side: "buy", usd: 100 });
  assert.equal(bought.status, 200);
  assert.deepEqual([bought.json.fill.quoted, bought.json.fill.qty, bought.json.fill.impact, bought.json.fill.feeUsd], [true, 100 * 6.25, 0.05, 0.01], "the router's quote for $100: the coins it brings, its impact, its network fee");
  assert.ok(Math.abs(bought.json.you.cash - (1_000 - 100.01)) < 1e-9, "what it cost, the fee too");
  setRate(0.2); // the coin now brings 20 cents each
  const sold = await ask("/desk/paper", "POST", { market: KEY, side: "sell", usd: 50 });
  assert.equal(sold.json.fill.quoted, true);
  assert.ok(Math.abs(sold.json.fill.qty - 50 / 0.16) < 1e-6, "as many as $50 is at the market's price");
  const xrp = await ask("/desk/paper", "POST", { market: "XRP", side: "buy", usd: 10 });
  assert.deepEqual([xrp.status, xrp.json.fill.quoted], [200, false], "no route: the market's price and the usual cost");
  assert.equal((await ask("/desk/accounts/~you", "PUT", { mode: "real", budget: 50 })).status, 400, "yours here is paper: your real money is your wallet's");
  assert.equal((await ask("/desk/paper", "POST", { market: "NOPE", side: "buy", usd: 10 })).status, 400);
  const snap = (await (await fetch(`http://127.0.0.1:${door.port}/desk`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { orbs: { orb: string }[]; you: { paper: number; holdings: { symbol: string }[] } };
  assert.ok(!snap.orbs.some((o) => o.orb === "~you"), "you are not one of the orbs");
  assert.deepEqual([snap.you.paper, snap.you.holdings.map((h) => h.symbol).sort()], [1_000, [KEY, "XRP"].sort()]);
  assert.equal(home.events.ofType("xp.earned").filter((e) => e.orb === "~you").length, 0, "no XP for yours");
  const marks = (await (await fetch(`http://127.0.0.1:${door.port}/desk/marks?market=${encodeURIComponent(KEY)}`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { fills: { kind: string; orb: string | null }[] };
  assert.deepEqual(marks.fills.filter((f) => f.kind === "paper").map((f) => f.orb), [null, null], "on the chart, yours: as your real trades are");
  // an orb's paper order: the same quote
  setRate(6.25);
  await use("place_order", { market: KEY, side: "buy", usd: 20, why: "the dip" });
  const fill = home.events.ofType("desk.fill").filter((e) => e.orb === "tess").at(-1)!;
  assert.deepEqual([fill.data.quoted, fill.data.qty], [true, 20 * 6.25], "an orb's paper filled as the market would");
});

test("an order, the one way: on paper it fills at the price now; on real money a swap asked of you, filled when its chain confirms it; denied, it does not fill and its dollars are free; a winning sale is XP either way", async (t) => {
  const { home, use, confirm, setRate } = await deskHome(t);
  const paper = await use("place_order", { market: KEY, side: "buy", usd: 25, why: "the dip" });
  assert.match(paper, /^Order 1 placed: buy \$25\.00 of solana:\S+pump\. Its fill shows in your account \(desk_book\)\.$/);
  assert.equal(home.orders.get(1)!.state, "filled", "on paper: filled at the price now");
  assert.ok(home.desk.ownBook("tess").holdings.some((h) => h.symbol === KEY), "in its paper account");
  home.desk.setAccount("tess", "real", 100);
  const real = await use("place_order", { market: KEY, side: "buy", usd: 25, why: "the dip" });
  assert.equal(real.replace(/Order \d+/, "Order N"), paper.replace(/Order \d+/, "Order N"), "the same words, paper or real");
  const sw = home.swaps.list().find((x) => x.orb === "tess")!;
  assert.deepEqual([sw.state, sw.chain, sw.sell, sw.buy, sw.amount], ["asked", "solana", "USDC", MINT, "25.00"], "real money: a swap asked of you, its coin's chain, paid in dollars");
  assert.equal(home.orders.get(2)!.state, "placed");
  assert.match(await use("place_order", { market: KEY, side: "buy", usd: 80, why: "more" }), /has \$75\.00 to spend/, "what waits to be bought is spoken for");
  await confirm(sw.id);
  const filled = home.orders.get(2)!;
  assert.deepEqual([filled.state, filled.qty], ["filled", 25 * 6.25], "filled when its chain confirms it, what its quote bought");
  assert.equal(home.desk.account("tess").book.cash, 75);
  // a sale you deny: not filled, said in its account, and the dollars are free again
  await use("place_order", { market: KEY, side: "sell", usd: 10, why: "a test" });
  const sale = home.swaps.list().find((x) => x.orb === "tess" && x.state === "asked")!;
  assert.deepEqual([sale.sell, sale.buy], [MINT, "USDC"]);
  home.swaps.answer(sale.id, false);
  assert.equal(home.orders.list("tess")[0]!.state, "not_filled");
  const account = await use("desk_book", {});
  assert.match(account, /not filled, it did not go through/);
  assert.doesNotMatch(account, TELLS, "its account says nothing of which it is");
  // a winning sale of real money is XP, said as any trade is
  setRate(0.25); // a coin now worth 25 cents
  await use("place_order", { market: KEY, side: "sell", usd: 1_000, why: "the target" });
  await confirm(home.swaps.list().find((x) => x.orb === "tess" && x.state === "asked")!.id);
  const xp = home.events.ofType("xp.earned").filter((e) => e.orb === "tess" && /trade won/.test(String(e.data.reason)));
  assert.equal(xp.length, 1, "a winning sale is XP, money being money");
  assert.doesNotMatch(String(xp[0]!.data.reason), TELLS);
});

test("nothing an orb reads says which: no tool's name, label or description, no group's words, no brief that sends it to a coin (the same words, paper or real)", async (t) => {
  const { home, tools } = await deskHome(t);
  for (const x of tools.values()) {
    assert.doesNotMatch(`${x.name} ${x.label} ${x.description} ${JSON.stringify(x.parameters)}`, TELLS, `${x.name}'s words`);
  }
  assert.doesNotMatch(GROUPS.desk.about, TELLS);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const send = async () => {
    const r = await fetch(`http://127.0.0.1:${door.port}/desk/send`, { method: "POST", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify({ orb: "tess", market: KEY, budget: 50, note: "under 15 cents" }) });
    return ((await r.json()) as { item: { text: string }; sent: { mode: string } });
  };
  const onPaper = await send();
  home.desk.setAccount("tess", "real", 100);
  const onReal = await send();
  assert.deepEqual([onPaper.sent.mode, onReal.sent.mode], ["paper", "real"], "you are told which");
  assert.equal(onReal.item.text, onPaper.item.text, "the orb is told the same, word for word");
  assert.match(onPaper.item.text, /with up to \$50 of your account\. .* place an order on "solana:\S+pump" \(place_order\)/);
  assert.doesNotMatch(onPaper.item.text, TELLS);
});

test("a strategy run on real money: at a bar's close its signal is an order asked of you; one still waiting holds the next; made paper again, the run waits", async (t) => {
  const { home, clock } = await deskHome(t);
  const always: Strategy = {
    name: "Always in", symbol: "SOL", timeframe: "1h", sizePct: 10,
    entry: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "value", value: 0 } }] },
    exit: { all: [{ left: { kind: "price", field: "close" }, op: "<", right: { kind: "value", value: 0 } }] },
  };
  const kept = home.desk.save(always, "tess");
  home.desk.setAccount("tess", "real", 1_000);
  const run = await home.desk.run(kept.id, "tess");
  assert.deepEqual([run.real, run.cash], [true, 0], "a run of the account's own: no cash of its own");
  await home.desk.due();
  assert.equal(home.orders.list("tess").length, 0, "the simulator never steps a run of real money");
  clock.suspend(3_600_000);
  await home.orders.due();
  const [order] = home.orders.list("tess");
  assert.deepEqual([order!.market, order!.side, order!.usd, order!.strategy, order!.state], ["SOL", "buy", 100, kept.id, "placed"], "its signal at the close: 10% of the account, asked of you");
  const sw = home.swaps.get(order!.swap!)!;
  assert.deepEqual([sw.chain, sw.sell, sw.buy, sw.amount], ["solana", "USDC", "SOL", "100.00"]);
  await home.orders.due();
  clock.suspend(3_600_000);
  await home.orders.due();
  assert.equal(home.orders.list("tess").length, 1, "one still waiting holds the next");
  home.swaps.answer(sw.id, false);
  home.desk.setAccount("tess", "paper");
  clock.suspend(3_600_000);
  await home.orders.due();
  assert.equal(home.orders.list("tess").length, 1, "made paper again, the run waits");
});
