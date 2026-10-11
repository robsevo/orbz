// Your wallets, read only (PLAN 5.26; owner, 10-10: "We can connect the users wallet there too"; "connect any wallet, like
// metamask or wtv. phantom etc."). A wallet is connected in the browser it lives in (the app finds every EVM wallet by
// EIP-6963 and every Solana wallet by the Wallet Standard) or its address is pasted; the home keeps only its public
// address, checked by its chain's own rules (chains.ts). What it holds is read from public RPCs and valued at the
// market's prices, for you and for the desk's orbs. Nothing here holds a key, asks for a signature or moves anything.
import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../events.ts";
import { CHAINS, call, fromUnits, NATIVE, readAddress, rpc, type Chain } from "./chains.ts";
import type { Market } from "./market.ts";
import { isDexChain, tokenKey, type Dex, type DexPair } from "./dex.ts";

/** Solana's two token programs: SPL's, and Token-2022's (a newer coin may live there). */
const PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE6ZnmXR6Hn1zf"];

export type Wallet = { id: number; chain: "evm" | "solana" | "bitcoin"; address: string; label: string; wallet: string | null; addedAt: number };
/** A coin a wallet holds: its amount and worth; any coin (PLAN 5.31) with its key ("solana:<mint>", what the war room's
 * screen opens), its name, its picture and how its price moved in a day. */
export type Holding = { chain: string; symbol: string; amount: string; usd: number | null; key?: string | null; name?: string; image?: string | null; change24h?: number | null };

export class WalletError extends Error {}

export class Wallets {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #market: Market;
  readonly #now: () => number;
  readonly #fetch: typeof fetch | undefined;
  readonly #cache = new Map<number, { at: number; holdings: Holding[]; errors: string[] }>();
  /** Any coin's price, name and picture (owner, 10-11: "users can see wallet balance and analytics as well"). */
  readonly #dex: Dex | null;
  /** The coins swapped through Orbz on a chain (the EVM chains have no list of every coin an address holds). */
  readonly #seen: (chain: string) => string[];
  readonly #decimals = new Map<string, number>();

  constructor(db: DatabaseSync, events: EventLog, market: Market, now: () => number, o: { fetch?: typeof fetch; dex?: Dex | null; seen?: (chain: string) => string[] } = {}) {
    this.#db = db;
    this.#events = events;
    this.#market = market;
    this.#now = now;
    this.#fetch = o.fetch;
    this.#dex = o.dex ?? null;
    this.#seen = o.seen ?? (() => []);
  }

  /** A coin on a DEX as a wallet holds it: its worth at its pair's price, its name, picture and day. */
  #coin(chain: string, address: string, amount: string, p: DexPair | undefined): Holding {
    const on = chain === "Solana" ? "solana" : CHAINS.find((c) => c.name === chain)?.id ?? "";
    return {
      chain, symbol: p?.base.symbol || `${address.slice(0, 4)}…${address.slice(-4)}`, amount, usd: p?.priceUsd != null ? Number(amount) * p.priceUsd : null,
      key: isDexChain(on) ? tokenKey(on, address) : null, name: p?.base.name, image: p?.image ?? null, change24h: p?.change.h24 ?? null,
    };
  }

  list(): Wallet[] {
    return (this.#db.prepare("SELECT id, chain, address, label, wallet, added_at FROM desk_wallets ORDER BY id").all() as { id: number; chain: Wallet["chain"]; address: string; label: string; wallet: string | null; added_at: number }[])
      .map((r) => ({ id: r.id, chain: r.chain, address: r.address, label: r.label, wallet: r.wallet, addedAt: r.added_at }));
  }

  /** Keeps a wallet's public address (`wallet` names the app it came from: "MetaMask", "Phantom"). */
  add(raw: string, o: { label?: string; wallet?: string | null } = {}): Wallet {
    const a = readAddress(raw);
    if ("why" in a) throw new WalletError(a.why);
    const label = (o.label ?? "").trim().slice(0, 40);
    const wallet = o.wallet ? o.wallet.trim().slice(0, 40) : null;
    this.#db.prepare("INSERT INTO desk_wallets (chain, address, label, wallet, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chain, address) DO UPDATE SET label = CASE WHEN excluded.label = '' THEN label ELSE excluded.label END, wallet = COALESCE(excluded.wallet, wallet)").run(a.chain, a.address, label, wallet, this.#now());
    const w = this.list().find((x) => x.chain === a.chain && x.address === a.address)!;
    this.#events.append("desk.wallet_added", { wallet: w.id, chain: w.chain, address: w.address, from: wallet });
    return w;
  }

  remove(id: number): void {
    this.#db.prepare("DELETE FROM desk_wallets WHERE id = ?").run(id);
    this.#cache.delete(id);
    this.#events.append("desk.wallet_removed", { wallet: id });
  }

  /** What a wallet holds now, on every chain of its kind (cached a minute). A chain that does not answer is said so. */
  async holdings(id: number): Promise<{ holdings: Holding[]; errors: string[]; at: number }> {
    const w = this.list().find((x) => x.id === id);
    if (!w) throw new WalletError(`no wallet ${id}`);
    const had = this.#cache.get(id);
    if (had && this.#now() - had.at < 60_000) return had;
    const tickers = (await this.#market.tickers(["BTC", "ETH", "SOL", "BNB", "LINK", "UNI", "AAVE"])).filter((t) => !t.stale);
    const prices = new Map(tickers.map((t) => [t.symbol, t.price]));
    const moved = new Map(tickers.map((t) => [t.symbol, t.changePct]));
    const value = (amount: string, t: { stable?: true; market?: string }): number | null => (t.stable ? Number(amount) : t.market && prices.has(t.market) ? Number(amount) * prices.get(t.market)! : null);
    const holdings: Holding[] = [];
    const errors: string[] = [];
    const get = this.#fetch;
    if (w.chain === "evm") {
      await Promise.all(CHAINS.filter((c): c is Extract<Chain, { kind: "evm" }> => c.kind === "evm").map(async (c) => {
        try {
          for (const t of c.tokens) {
            const raw = t.native ? await rpc(c.rpcs, "eth_getBalance", [w.address, "latest"], { fetch: get }) : await rpc(c.rpcs, "eth_call", [{ to: t.address, data: call("balanceOf(address)", w.address) }, "latest"], { fetch: get });
            const units = BigInt(String(raw ?? "0x0") === "0x" ? "0x0" : String(raw ?? "0x0"));
            if (units > 0n) {
              const amount = fromUnits(units, t.decimals);
              holdings.push({ chain: c.name, symbol: t.symbol, amount, usd: value(amount, t), key: t.address === NATIVE ? null : tokenKey(c.id as "base", t.address), change24h: t.stable ? 0 : t.market ? moved.get(t.market) ?? null : null });
            }
          }
          // any coin swapped through Orbz on this chain: its balance, its decimals from the chain once, its worth from its pair
          const known = new Set(c.tokens.map((t) => t.address.toLowerCase()));
          const more = [...new Set(this.#seen(c.id).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a) && !known.has(a.toLowerCase())))].slice(0, 20);
          const held: [string, string][] = [];
          for (const a of more) {
            const raw = String((await rpc(c.rpcs, "eth_call", [{ to: a, data: call("balanceOf(address)", w.address) }, "latest"], { fetch: get })) ?? "0x0");
            const units = BigInt(raw === "0x" ? "0x0" : raw);
            if (units <= 0n) continue;
            const k = `${c.id}:${a.toLowerCase()}`;
            let d = this.#decimals.get(k);
            if (d === undefined) {
              d = Number(BigInt(String(await rpc(c.rpcs, "eth_call", [{ to: a, data: call("decimals()") }, "latest"], { fetch: get }))));
              this.#decimals.set(k, d);
            }
            held.push([a, fromUnits(units, d)]);
          }
          if (held.length && isDexChain(c.id)) {
            const best = (await this.#dex?.best(c.id, held.map(([a]) => a)).catch(() => null)) ?? new Map<string, DexPair>();
            for (const [a, amount] of held) holdings.push(this.#coin(c.name, a, amount, best.get(a.toLowerCase())));
          }
        } catch (e) {
          errors.push(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }));
    } else if (w.chain === "solana") {
      const sol = CHAINS.find((c) => c.id === "solana")!;
      try {
        const found = await this.#solana(w.address, get, errors);
        if (found.lamports > 0n) {
          const amount = fromUnits(found.lamports, 9);
          holdings.push({ chain: "Solana", symbol: "SOL", amount, usd: value(amount, sol.tokens[0]!), key: tokenKey("solana", sol.tokens[0]!.address), change24h: moved.get("SOL") ?? null });
        }
        const others: [string, string][] = [];
        for (const [mint, c] of found.coins) {
          if (c.amount === 0n) continue;
          const amount = fromUnits(c.amount, c.decimals);
          const t = sol.tokens.find((x) => x.address === mint);
          if (t) holdings.push({ chain: "Solana", symbol: t.symbol, amount, usd: value(amount, t), key: tokenKey("solana", t.address), change24h: t.stable ? 0 : t.market ? moved.get(t.market) ?? null : null });
          else others.push([mint, amount]);
        }
        // every other coin it holds, a pump.fun one too, at its pair's price (one ask for 30 of them)
        if (others.length) {
          const best = (await this.#dex?.best("solana", others.map(([m]) => m)).catch(() => null)) ?? new Map<string, DexPair>();
          for (const [mint, amount] of others) holdings.push(this.#coin("Solana", mint, amount, best.get(mint.toLowerCase())));
        }
      } catch (e) {
        errors.push(`Solana: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      try {
        const r = await (get ?? fetch)(`https://mempool.space/api/address/${w.address}`, { signal: AbortSignal.timeout(12_000) });
        const j = (await r.json()) as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number } };
        const sats = j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum + j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum;
        if (sats > 0) {
          const amount = fromUnits(BigInt(sats), 8);
          holdings.push({ chain: "Bitcoin", symbol: "BTC", amount, usd: value(amount, { market: "BTC" }), change24h: moved.get("BTC") ?? null });
        }
      } catch (e) {
        errors.push(`Bitcoin: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    holdings.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
    const out = { holdings, errors, at: this.#now() };
    this.#cache.set(id, out);
    return out;
  }

  /** What a Solana wallet holds, read from its chain: its SOL, and each coin of both token programs (a coin's accounts
   * summed). The public endpoints do not answer Token-2022's coins by their owner (10-11: the official one refuses the
   * program, PublicNode asks for a key), so those are the program's accounts whose owner is this wallet. When the chain
   * cannot be read, Jupiter's free balances (the swaps' own router) stand in; when only Token-2022's coins cannot be,
   * the rest stands and `notes` says so. */
  async #solana(address: string, get: typeof fetch | undefined, notes: string[]): Promise<{ lamports: bigint; coins: Map<string, { amount: bigint; decimals: number }> }> {
    const sol = CHAINS.find((c) => c.id === "solana")!;
    type Parsed = { account: { data: { parsed?: { type?: string; info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } } };
    const coins = new Map<string, { amount: bigint; decimals: number }>();
    const add = (mint: unknown, amount: unknown, decimals: unknown): void => {
      if (typeof mint !== "string" || typeof amount !== "string" || !/^\d+$/.test(amount) || !Number.isInteger(decimals)) return;
      const had = coins.get(mint);
      coins.set(mint, { amount: (had?.amount ?? 0n) + BigInt(amount), decimals: decimals as number });
    };
    const addParsed = (a: Parsed): void => {
      const info = a.account?.data?.parsed?.info;
      add(info?.mint, info?.tokenAmount?.amount, info?.tokenAmount?.decimals);
    };
    let lamports: bigint;
    try {
      lamports = BigInt(((await rpc(sol.rpcs, "getBalance", [address], { fetch: get })) as { value: number }).value);
      const classic = (await rpc(sol.rpcs, "getTokenAccountsByOwner", [address, { programId: PROGRAMS[0] }, { encoding: "jsonParsed" }], { fetch: get })) as { value?: Parsed[] } | null;
      for (const a of classic?.value ?? []) addParsed(a);
    } catch (e) {
      const j = await this.#jupiter(address, get).catch(() => null);
      if (!j) throw e;
      for (const c of j.coins) add(c.mint, c.amount, c.decimals);
      return { lamports: j.lamports, coins };
    }
    try {
      const newer = (await rpc(sol.rpcs, "getProgramAccounts", [PROGRAMS[1], { encoding: "jsonParsed", filters: [{ memcmp: { offset: 32, bytes: address } }] }], { fetch: get })) as Parsed[] | null;
      for (const a of newer ?? []) if (a.account?.data?.parsed?.type === "account") addParsed(a);
    } catch (e) {
      const j = await this.#jupiter(address, get).catch(() => null);
      if (j) {
        for (const c of j.coins) if (c.program === PROGRAMS[1]) add(c.mint, c.amount, c.decimals);
      } else notes.push(`Solana's Token-2022 coins: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { lamports, coins };
  }

  /** A Solana wallet's balances from Jupiter's free API (no key): its lamports and each token account. */
  async #jupiter(address: string, get: typeof fetch | undefined): Promise<{ lamports: bigint; coins: { mint: string; amount: string; decimals: number; program: string }[] }> {
    const r = await (get ?? fetch)(`https://lite-api.jup.ag/ultra/v1/holdings/${address}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`Jupiter answered ${r.status}`);
    const j = (await r.json()) as { amount?: unknown; tokens?: Record<string, { amount?: string; decimals?: number; programId?: string }[]> };
    if (typeof j.amount !== "string" || !/^\d+$/.test(j.amount)) throw new Error("Jupiter gave no balance");
    const coins = Object.entries(j.tokens ?? {}).flatMap(([mint, list]) => (Array.isArray(list) ? list : []).map((a) => ({ mint, amount: String(a.amount ?? ""), decimals: Number(a.decimals), program: String(a.programId ?? "") })));
    return { lamports: BigInt(j.amount), coins };
  }
}
