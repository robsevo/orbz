// Real trades from your own wallet, decentralized, each one yours (PLAN 5.27; owner, 10-10: "both" paper and real). A
// swap is routed by a public DEX aggregator, with no account anywhere: KyberSwap on the EVM chains (Ethereum, Base,
// Arbitrum, Optimism, Polygon), Jupiter on Solana. Its life, each step a state kept here:
//   asked     an orb proposed it (`propose_swap`), with a quote: nothing more happens without you (CLAUDE.md rule 9)
//   approved  you said yes (an orb's), or pressed Swap yourself (your own)
//   built     a fresh quote and its transaction for your wallet's address, refused when the price moved past your
//             slippage from what you approved, or past your limits; a token that needs an allowance asks for it first
//   sent      your wallet signed and sent it (only it can: the home holds no key); its hash kept, so it is sent once
//   confirmed / failed   read from the chain; expired: asked an hour ago and never answered; denied: you said no
// The limits (a trade's, a day's), the slippage and the off switch are the desk's settings (desk.ts), checked when it is
// asked and again when it is built.
import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../events.ts";
import { call, chainOf, CHAINS, fromUnits, NATIVE, rpc, toUnits, tokenOf, type Chain, type Token } from "./chains.ts";
import { isDexChain, isTokenAddress, tokenKey, type Dex } from "./dex.ts";
import type { Desk } from "./desk.ts";
import type { Market } from "./market.ts";

export type Quote = { amountIn: string; amountOut: string; out: string; priceImpactPct: number | null; feeUsd: number | null; route: string[]; router: string | null };
export type Built = { kind: "evm"; chainId: number; approve: { to: string; data: string } | null; tx: { to: string; data: string; value: string; gas: string | null } } | { kind: "solana"; transaction: string };

/** The routers, so a test can stand in for them. */
export interface Routers {
  evmQuote(chain: Extract<Chain, { kind: "evm" }>, sell: Token, buy: Token, units: bigint): Promise<Quote & { raw: unknown }>;
  evmBuild(chain: Extract<Chain, { kind: "evm" }>, raw: unknown, from: string, slippageBps: number): Promise<{ to: string; data: string; value: string; gas: string | null; amountOut: string }>;
  solQuote(sell: Token, buy: Token, units: bigint, slippageBps: number): Promise<Quote & { raw: unknown }>;
  solBuild(raw: unknown, from: string): Promise<{ transaction: string }>;
}

export function publicRouters(o: { fetch?: typeof fetch; kyber?: string; jupiter?: string } = {}): Routers {
  const get = o.fetch ?? fetch;
  const kyber = o.kyber ?? "https://aggregator-api.kyberswap.com";
  const jup = o.jupiter ?? "https://lite-api.jup.ag/swap/v1";
  const json = async (url: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const r = await get(url, { ...init, headers: { "content-type": "application/json", "x-client-id": "orbz", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error(`the router answered ${r.status}: ${String(j.message ?? j.error ?? "")}`.trim());
    return j;
  };
  return {
    async evmQuote(chain, sell, buy, units) {
      const j = await json(`${kyber}/${chain.kyber}/api/v1/routes?tokenIn=${sell.address}&tokenOut=${buy.address}&amountIn=${units}&gasInclude=true`);
      const s = (j.data as { routeSummary?: Record<string, unknown>; routerAddress?: string } | undefined)?.routeSummary;
      if (!s) throw new Error(String(j.message ?? "no route for that swap"));
      const route = ((s.route as { exchange?: string }[][] | undefined) ?? []).flat().map((h) => h.exchange ?? "?");
      const inUsd = Number(s.amountInUsd);
      const outUsd = Number(s.amountOutUsd);
      return {
        amountIn: String(s.amountIn), amountOut: String(s.amountOut), out: fromUnits(BigInt(String(s.amountOut)), buy.decimals),
        priceImpactPct: inUsd > 0 && outUsd > 0 ? ((inUsd - outUsd) / inUsd) * 100 : null, feeUsd: Number(s.gasUsd) || null,
        route: [...new Set(route)], router: (j.data as { routerAddress?: string }).routerAddress ?? null, raw: s,
      };
    },
    async evmBuild(chain, raw, from, slippageBps) {
      const j = await json(`${kyber}/${chain.kyber}/api/v1/route/build`, { method: "POST", body: JSON.stringify({ routeSummary: raw, sender: from, recipient: from, slippageTolerance: slippageBps, deadline: Math.floor(Date.now() / 1000) + 1200, source: "orbz" }) });
      const d = j.data as { data?: string; routerAddress?: string; transactionValue?: string; gas?: string; amountOut?: string } | undefined;
      if (!d?.data || !d.routerAddress) throw new Error(String(j.message ?? "the router built no transaction"));
      return { to: d.routerAddress, data: d.data, value: d.transactionValue ?? "0", gas: d.gas ?? null, amountOut: String(d.amountOut ?? "0") };
    },
    async solQuote(sell, buy, units, slippageBps) {
      const j = await json(`${jup}/quote?inputMint=${sell.address}&outputMint=${buy.address}&amount=${units}&slippageBps=${slippageBps}`);
      if (!j.outAmount) throw new Error(String(j.error ?? "no route for that swap"));
      return {
        amountIn: String(j.inAmount), amountOut: String(j.outAmount), out: fromUnits(BigInt(String(j.outAmount)), buy.decimals),
        priceImpactPct: Number(j.priceImpactPct) * 100, feeUsd: null,
        route: [...new Set(((j.routePlan as { swapInfo?: { label?: string } }[] | undefined) ?? []).map((p) => p.swapInfo?.label ?? "?"))], router: null, raw: j,
      };
    },
    async solBuild(raw, from) {
      const j = await json(`${jup}/swap`, { method: "POST", body: JSON.stringify({ quoteResponse: raw, userPublicKey: from, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" }) });
      if (typeof j.swapTransaction !== "string") throw new Error(String(j.error ?? "the router built no transaction"));
      return { transaction: j.swapTransaction };
    },
  };
}

export type SwapState = "asked" | "approved" | "built" | "sent" | "confirmed" | "failed" | "denied" | "expired";
export type Swap = { id: number; orb: string | null; chain: string; sell: string; buy: string; amount: string; usd: number; why: string; quote: Quote | null; state: SwapState; tx: string | null; error: string | null; createdAt: number; settledAt: number | null };

export class SwapError extends Error {}

type Row = { id: number; card: number | null; orb: string | null; chain: string; sell: string; buy: string; amount: string; usd: number; why: string; quote: string | null; state: SwapState; tx: string | null; error: string | null; created_at: number; settled_at: number | null };
const EXPIRE_MS = 3_600_000;

export class Swaps {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #market: Market;
  readonly #desk: Desk;
  readonly #routers: Routers;
  readonly #now: () => number;
  readonly #fetch: typeof fetch | undefined;
  readonly #raw = new Map<number, unknown>(); // each swap's latest route, as the router gave it
  /** Any token by its address (owner, 10-11: "shitcoins, anything"): its symbol from the DEX data, its decimals from its
   * own chain, read once (they never change). */
  readonly #dex: Dex | null;
  readonly #decimals = new Map<string, number>();
  #following: Promise<void> | null = null;

  constructor(db: DatabaseSync, events: EventLog, market: Market, desk: Desk, routers: Routers, now: () => number, o: { fetch?: typeof fetch; dex?: Dex | null } = {}) {
    this.#db = db;
    this.#events = events;
    this.#market = market;
    this.#desk = desk;
    this.#routers = routers;
    this.#now = now;
    this.#fetch = o.fetch;
    this.#dex = o.dex ?? null;
  }

  #of(r: Row): Swap {
    return { id: r.id, orb: r.orb, chain: r.chain, sell: r.sell, buy: r.buy, amount: r.amount, usd: r.usd, why: r.why, quote: r.quote ? (JSON.parse(r.quote) as Quote) : null, state: r.state, tx: r.tx, error: r.error, createdAt: r.created_at, settledAt: r.settled_at };
  }
  get(id: number): Swap | null {
    const r = this.#db.prepare("SELECT * FROM desk_swaps WHERE id = ?").get(id) as Row | undefined;
    return r ? this.#of(r) : null;
  }
  list(limit = 50): Swap[] {
    return (this.#db.prepare("SELECT * FROM desk_swaps ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((r) => this.#of(r));
  }

  /** The dollars a sale is worth now, or null when the market cannot say. */
  async #usd(token: Token, amount: string): Promise<number | null> {
    if (token.stable) return Number(amount);
    if (!token.market) return null;
    const px = await this.#market.price(token.market);
    return px === null ? null : Number(amount) * px;
  }

  /** What today's trades already spent (asked or later, not denied, failed or expired), in dollars. */
  #spentToday(): number {
    const d = new Date(this.#now());
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const r = this.#db.prepare("SELECT COALESCE(SUM(usd), 0) AS n FROM desk_swaps WHERE created_at >= ? AND state IN ('approved', 'built', 'sent', 'confirmed')").get(start) as { n: number };
    return r.n;
  }

  #limits(usd: number, self: number | null): void {
    const s = this.#desk.settings();
    if (s.off) throw new SwapError("real trades are switched off on the desk");
    if (usd > s.perTradeUsd) throw new SwapError(`$${usd.toFixed(2)} is over the desk's limit of $${s.perTradeUsd} a trade`);
    const today = this.#spentToday() - (self ?? 0);
    if (today + usd > s.perDayUsd) throw new SwapError(`it would take today's trades to $${(today + usd).toFixed(2)}, over the desk's $${s.perDayUsd} a day`);
  }

  /** A token the desk knows by name, or any token on the chain by its address: kept as its symbol when known, its
   * address when not (a symbol is not one token's own). */
  async #tokenOf(chain: Chain, x: string): Promise<Token | null> {
    const known = tokenOf(chain, x);
    if (known) return known;
    const on = chain.kind === "solana" ? "solana" : chain.id;
    if (!isDexChain(on) || !isTokenAddress(on, x)) return null;
    const k = `${chain.id}:${x}`;
    let decimals = this.#decimals.get(k);
    if (decimals === undefined) {
      try {
        decimals = chain.kind === "evm"
          ? Number(BigInt(String(await rpc(chain.rpcs, "eth_call", [{ to: x, data: call("decimals()") }, "latest"], { fetch: this.#fetch }))))
          : Number(((await rpc(chain.rpcs, "getTokenSupply", [x], { fetch: this.#fetch })) as { value?: { decimals?: unknown } }).value?.decimals);
      } catch (e) {
        throw new SwapError(`${x} on ${chain.name} answered no decimals: ${(e as Error).message}`);
      }
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new SwapError(`${x} is not a token on ${chain.name}`);
      this.#decimals.set(k, decimals);
    }
    const symbol = (await this.#dex?.token(on, x).catch(() => []))?.[0]?.base.symbol || `${x.slice(0, 4)}…${x.slice(-4)}`;
    return { symbol, address: x, decimals, market: tokenKey(on, x) };
  }
  /** How a swap keeps a token: its symbol when the desk knows it, else its address. */
  #kept = (chain: Chain, t: Token): string => (tokenOf(chain, t.symbol)?.address === t.address ? t.symbol : t.address);

  /** A quote alone, kept nowhere: what the Trade panel shows before you press Swap. */
  async quote(o: { chain: string; sell: string; buy: string; amount: string }): Promise<Quote & { usd: number | null }> {
    const chain = chainOf(o.chain);
    const sell = chain && (await this.#tokenOf(chain, o.sell));
    const buy = chain && (await this.#tokenOf(chain, o.buy));
    if (!chain || !sell || !buy || sell.address.toLowerCase() === buy.address.toLowerCase()) throw new SwapError("a chain the desk knows, and two tokens on it: by name, or any token by its address");
    let units: bigint;
    try {
      units = toUnits(o.amount, sell.decimals);
    } catch (e) {
      throw new SwapError((e as Error).message);
    }
    const q = chain.kind === "evm" ? await this.#routers.evmQuote(chain, sell, buy, units) : await this.#routers.solQuote(sell, buy, units, this.#desk.settings().slippageBps);
    const { raw: _raw, ...quote } = q;
    return { ...quote, usd: await this.#usd(sell, o.amount) };
  }

  /** Asks for a swap: `by` an orb (it then waits for you) or null (yours: approved as you ask). A quote comes with it. */
  async ask(o: { by: string | null; chain: string; sell: string; buy: string; amount: string; why?: string }): Promise<Swap> {
    const chain = chainOf(o.chain);
    if (!chain) throw new SwapError(`no chain "${o.chain}": ${CHAINS.map((c) => c.id).join(", ")}`);
    const sell = await this.#tokenOf(chain, o.sell);
    const buy = await this.#tokenOf(chain, o.buy);
    if (!sell || !buy) throw new SwapError(`on ${chain.name} the desk swaps ${chain.tokens.map((t) => t.symbol).join(", ")}, or any token by its address`);
    if (sell.address.toLowerCase() === buy.address.toLowerCase()) throw new SwapError("a swap is from one token to another");
    let units: bigint;
    try {
      units = toUnits(o.amount, sell.decimals);
    } catch (e) {
      throw new SwapError((e as Error).message);
    }
    if (units <= 0n) throw new SwapError("an amount above nothing");
    const usd = await this.#usd(sell, o.amount);
    if (usd === null) throw new SwapError(`no live price for ${sell.symbol} now, so its limits cannot be kept: try again in a moment`);
    this.#limits(usd, null);
    const q = chain.kind === "evm" ? await this.#routers.evmQuote(chain, sell, buy, units) : await this.#routers.solQuote(sell, buy, units, this.#desk.settings().slippageBps);
    const { raw, ...quote } = q;
    const state: SwapState = o.by === null ? "approved" : "asked";
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_swaps (orb, chain, sell, buy, amount, usd, why, quote, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(o.by, chain.id, this.#kept(chain, sell), this.#kept(chain, buy), o.amount, usd, (o.why ?? "").slice(0, 400), JSON.stringify(quote), state, this.#now());
    const id = Number(lastInsertRowid);
    this.#raw.set(id, raw);
    this.#events.append(o.by === null ? "desk.swap_approved" : "desk.swap_asked", { swap: id, chain: chain.id, sell: sell.symbol, buy: buy.symbol, amount: o.amount, usd, out: quote.out, why: o.why ?? "" }, { orb: o.by });
    return this.get(id)!;
  }

  /** Your answer to an orb's swap: yes or no. */
  answer(id: number, yes: boolean): Swap {
    const s = this.get(id);
    if (!s) throw new SwapError(`no swap ${id}`);
    if (s.state !== "asked") throw new SwapError(`swap ${id} is ${s.state}, not waiting for you`);
    if (this.#now() - s.createdAt > EXPIRE_MS) {
      this.#settle(id, "expired", null);
      throw new SwapError("it was asked over an hour ago: its price is stale, so it has expired");
    }
    this.#db.prepare("UPDATE desk_swaps SET state = ? WHERE id = ? AND state = 'asked'").run(yes ? "approved" : "denied", id);
    this.#events.append(yes ? "desk.swap_approved" : "desk.swap_denied", { swap: id }, { orb: s.orb });
    return this.get(id)!;
  }

  /** The transaction for your wallet to sign: only for a swap you approved, a fresh quote, its price and your limits kept. */
  async build(id: number, from: string): Promise<{ swap: Swap; built: Built }> {
    const s = this.get(id);
    if (!s) throw new SwapError(`no swap ${id}`);
    if (s.state !== "approved" && s.state !== "built") throw new SwapError(s.state === "asked" ? "it waits for your yes first" : `swap ${id} is ${s.state}`);
    this.#limits(s.usd, s.usd);
    const chain = chainOf(s.chain)!;
    const sell = (await this.#tokenOf(chain, s.sell))!;
    const buy = (await this.#tokenOf(chain, s.buy))!;
    const units = toUnits(s.amount, sell.decimals);
    const slip = this.#desk.settings().slippageBps;
    const fresh = chain.kind === "evm" ? await this.#routers.evmQuote(chain, sell, buy, units) : await this.#routers.solQuote(sell, buy, units, slip);
    // the price you approved, kept: a fresh quote worse than it past your slippage is refused
    const before = BigInt(s.quote!.amountOut);
    const now = BigInt(fresh.amountOut);
    if (now * 10_000n < before * BigInt(10_000 - slip)) {
      this.#events.append("desk.swap_moved", { swap: id, before: s.quote!.out, now: fresh.out }, { orb: s.orb });
      throw new SwapError(`the price moved: ${s.quote!.out} ${buy.symbol} when you approved it, ${fresh.out} now (past your ${slip / 100}% slippage). Ask again for a new quote.`);
    }
    let built: Built;
    if (chain.kind === "evm") {
      const tx = await this.#routers.evmBuild(chain, fresh.raw, from, slip);
      // a token (not the chain's own coin) is spent by the router only with an allowance: asked for exactly this much
      let approve: { to: string; data: string } | null = null;
      if (sell.address !== NATIVE) {
        const allowed = BigInt(String(await rpc(chain.rpcs, "eth_call", [{ to: sell.address, data: call("allowance(address,address)", from, tx.to) }, "latest"], { fetch: this.#fetch })));
        if (allowed < units) approve = { to: sell.address, data: call("approve(address,uint256)", tx.to, units.toString(16)) };
      }
      built = { kind: "evm", chainId: chain.chainId, approve, tx: { to: tx.to, data: tx.data, value: tx.value, gas: tx.gas } };
    } else built = { kind: "solana", ...(await this.#routers.solBuild(fresh.raw, from)) };
    const { raw: _raw, ...q } = fresh;
    this.#db.prepare("UPDATE desk_swaps SET state = 'built', quote = ? WHERE id = ?").run(JSON.stringify(q), id);
    this.#events.append("desk.swap_built", { swap: id, from, out: q.out }, { orb: s.orb });
    return { swap: this.get(id)!, built };
  }

  /** Your wallet sent it: its hash, kept once (a retry of the same swap is refused), then followed on the chain. */
  sent(id: number, tx: string): Swap {
    const s = this.get(id);
    if (!s) throw new SwapError(`no swap ${id}`);
    if (s.state !== "built") throw new SwapError(s.tx ? `swap ${id} was already sent (${s.tx})` : `swap ${id} is ${s.state}: build it for your wallet first`);
    const ok = s.chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx) : /^0x[0-9a-fA-F]{64}$/.test(tx);
    if (!ok) throw new SwapError("that is not a transaction's hash on this chain");
    this.#db.prepare("UPDATE desk_swaps SET state = 'sent', tx = ? WHERE id = ? AND state = 'built'").run(tx, id);
    this.#events.append("desk.swap_sent", { swap: id, tx }, { orb: s.orb });
    return this.get(id)!;
  }

  /** Your wallet refused or failed to send it: said so, and it can be built again. */
  notSent(id: number, why: string): Swap {
    const s = this.get(id);
    if (!s || s.state !== "built") throw new SwapError(`swap ${id} was not waiting for your wallet`);
    this.#db.prepare("UPDATE desk_swaps SET state = 'approved', error = ? WHERE id = ?").run(why.slice(0, 300), id);
    this.#events.append("desk.swap_unsent", { swap: id, why: why.slice(0, 300) }, { orb: s.orb });
    return this.get(id)!;
  }

  #settle(id: number, state: "confirmed" | "failed" | "expired", error: string | null): void {
    const s = this.get(id)!;
    this.#db.prepare("UPDATE desk_swaps SET state = ?, error = ?, settled_at = ? WHERE id = ?").run(state, error, this.#now(), id);
    this.#events.append("desk.swap_settled", { swap: id, state, error, chain: s.chain, sell: s.sell, buy: s.buy, amount: s.amount, tx: s.tx }, { orb: s.orb });
  }

  /** Follows what was sent until the chain says, and lets what nobody answered expire. */
  due(): Promise<void> {
    if (this.#following) return this.#following;
    this.#following = (async () => {
      for (const s of this.list(200)) {
        if ((s.state === "asked" || s.state === "approved") && this.#now() - s.createdAt > EXPIRE_MS) this.#settle(s.id, "expired", null);
        if (s.state !== "sent" || !s.tx) continue;
        const chain = chainOf(s.chain)!;
        try {
          if (chain.kind === "evm") {
            const r = (await rpc(chain.rpcs, "eth_getTransactionReceipt", [s.tx], { fetch: this.#fetch })) as { status?: string } | null;
            if (r?.status === "0x1") this.#settle(s.id, "confirmed", null);
            else if (r?.status === "0x0") this.#settle(s.id, "failed", "the chain reverted it: nothing was swapped, the network fee was paid");
          } else {
            const r = (await rpc(chain.rpcs, "getSignatureStatuses", [[s.tx], { searchTransactionHistory: true }], { fetch: this.#fetch })) as { value: ({ confirmationStatus?: string; err?: unknown } | null)[] };
            const st = r.value[0];
            if (st?.err) this.#settle(s.id, "failed", "the chain refused it: nothing was swapped");
            else if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") this.#settle(s.id, "confirmed", null);
          }
        } catch {
          /* the chain did not answer: asked again next time */
        }
        if (this.get(s.id)!.state === "sent" && this.#now() - s.createdAt > 6 * EXPIRE_MS) this.#settle(s.id, "failed", "the chain never said: look it up by its hash");
      }
    })().finally(() => (this.#following = null));
    return this.#following;
  }

  /** When something waits on the chain or may expire. */
  nextAt(): number | null {
    const open = this.list(200).filter((s) => s.state === "sent" || s.state === "asked" || s.state === "approved");
    if (!open.length) return null;
    return this.#now() + (open.some((s) => s.state === "sent") ? 6_000 : 60_000);
  }
}
