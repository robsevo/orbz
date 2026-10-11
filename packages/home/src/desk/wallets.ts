// Your wallets, read only (PLAN 5.26; owner, 10-10: "We can connect the users wallet there too"; "connect any wallet, like
// metamask or wtv. phantom etc."). A wallet is connected in the browser it lives in (the app finds every EVM wallet by
// EIP-6963 and every Solana wallet by the Wallet Standard) or its address is pasted; the home keeps only its public
// address, checked by its chain's own rules (chains.ts). What it holds is read from public RPCs and valued at the
// market's prices, for you and for the desk's orbs. Nothing here holds a key, asks for a signature or moves anything.
import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../events.ts";
import { CHAINS, call, fromUnits, readAddress, rpc, type Chain } from "./chains.ts";
import type { Market } from "./market.ts";

export type Wallet = { id: number; chain: "evm" | "solana" | "bitcoin"; address: string; label: string; wallet: string | null; addedAt: number };
export type Holding = { chain: string; symbol: string; amount: string; usd: number | null };

export class WalletError extends Error {}

export class Wallets {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #market: Market;
  readonly #now: () => number;
  readonly #fetch: typeof fetch | undefined;
  readonly #cache = new Map<number, { at: number; holdings: Holding[]; errors: string[] }>();

  constructor(db: DatabaseSync, events: EventLog, market: Market, now: () => number, o: { fetch?: typeof fetch } = {}) {
    this.#db = db;
    this.#events = events;
    this.#market = market;
    this.#now = now;
    this.#fetch = o.fetch;
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
    const prices = new Map((await this.#market.tickers(["BTC", "ETH", "SOL", "LINK", "UNI", "AAVE"])).filter((t) => !t.stale).map((t) => [t.symbol, t.price]));
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
              holdings.push({ chain: c.name, symbol: t.symbol, amount, usd: value(amount, t) });
            }
          }
        } catch (e) {
          errors.push(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }));
    } else if (w.chain === "solana") {
      const sol = CHAINS.find((c) => c.id === "solana")!;
      try {
        const lamports = (await rpc(sol.rpcs, "getBalance", [w.address], { fetch: get })) as { value: number };
        if (lamports.value > 0) {
          const amount = fromUnits(BigInt(lamports.value), 9);
          holdings.push({ chain: "Solana", symbol: "SOL", amount, usd: value(amount, sol.tokens[0]!) });
        }
        const accounts = (await rpc(sol.rpcs, "getTokenAccountsByOwner", [w.address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }], { fetch: get })) as { value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[] };
        for (const a of accounts.value) {
          const info = a.account.data.parsed.info;
          const t = sol.tokens.find((x) => x.address === info.mint);
          if (!t || info.tokenAmount.amount === "0") continue;
          const amount = fromUnits(BigInt(info.tokenAmount.amount), info.tokenAmount.decimals);
          holdings.push({ chain: "Solana", symbol: t.symbol, amount, usd: value(amount, t) });
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
          holdings.push({ chain: "Bitcoin", symbol: "BTC", amount, usd: value(amount, { market: "BTC" }) });
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
}
