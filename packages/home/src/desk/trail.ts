// Reading a trail on Solana's own chain (PLAN 5.42): what an investigation needs, from the public RPC and no key (10-12,
// measured: the official endpoint answers a coin's signatures, its transactions, and its holders by the token program's
// accounts filtered on the mint, but refuses getTokenLargestAccounts with a 429 and PublicNode wants a key for both).
// A coin's launch: its oldest transactions (its signatures read back to the first), the deployer who paid for its
// creation, the pool its first buys bought from, and every buy in its first slots. Its holders: the token program's
// accounts of the mint, an owner and an amount each (40 bytes of each account, not the whole), summed by owner, an
// owner that is a program's account (a pool, a curve) told from a wallet. A wallet's first money in, and when it was
// born; a wallet with more history than a read takes is busy (an exchange's, a bot's, a program's). A wallet's recent
// transfers. Every call is spaced and counted against a budget, and a 429 waited out once; what could not be read is
// said, never guessed. Transfers are read off balances (each wallet's change in SOL and in each coin), so a swap through
// any program reads the same.
import { base58, chainOf, rpc } from "./chains.ts";
import type { Buy, Funding, Holding, Launch, Move, Sell } from "./trace.ts";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL = "So11111111111111111111111111111111111111112";
/** A change in SOL smaller than this is a fee, rent or a tip, not a transfer. */
const DUST = 0.0005;

type Sig = { signature: string; slot: number; blockTime: number | null; err: unknown };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
export type ParsedTx = {
  slot: number; blockTime: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: ({ pubkey: string; signer?: boolean } | string)[] } };
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Bytes in base58 (a Solana address from its 32 bytes). */
export function toBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

const keysOf = (tx: ParsedTx): { key: string; signer: boolean }[] =>
  tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? { key: k, signer: false } : { key: k.pubkey, signer: !!k.signer }));

/** Each owner's change in each asset in a transaction: SOL (lamports, the fee given back to the payer who paid it; a
 * token account's own lamports are rent, not the owner's) and every coin by its owner, wrapped SOL counted as SOL. */
export function changesOf(tx: ParsedTx): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const add = (owner: string, asset: string, x: number): void => {
    if (!x) return;
    if (!out.has(owner)) out.set(owner, new Map());
    const m = out.get(owner)!;
    m.set(asset, (m.get(asset) ?? 0) + x);
  };
  const meta = tx.meta;
  if (!meta) return out;
  const keys = keysOf(tx);
  const tokenAccounts = new Set([...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])].map((b) => b.accountIndex));
  keys.forEach((k, i) => {
    if (tokenAccounts.has(i)) return;
    const d = (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0) + (i === 0 ? meta.fee : 0);
    add(k.key, "SOL", d / 1e9);
  });
  const amounts = new Map<string, { owner: string; mint: string; decimals: number; pre: bigint; post: bigint }>();
  for (const [side, list] of [["pre", meta.preTokenBalances ?? []], ["post", meta.postTokenBalances ?? []]] as const) {
    for (const b of list) {
      const id = `${b.accountIndex}`;
      const owner = b.owner ?? keys[b.accountIndex]?.key ?? "?";
      const row = amounts.get(id) ?? { owner, mint: b.mint, decimals: b.uiTokenAmount.decimals, pre: 0n, post: 0n };
      row[side] = BigInt(b.uiTokenAmount.amount);
      amounts.set(id, row);
    }
  }
  for (const r of amounts.values()) add(r.owner, r.mint === WSOL ? "SOL" : r.mint, Number(r.post - r.pre) / 10 ** r.decimals);
  return out;
}

/** The transfers in a transaction: for each asset, those who lost it paired with those who gained it, the largest with
 * the largest (a swap reads as the buyer's SOL to the pool and the pool's coin to the buyer). */
export function movesOf(tx: ParsedTx, sig: string): Move[] {
  const at = (tx.blockTime ?? 0) * 1000;
  const by = new Map<string, { out: [string, number][]; in: [string, number][] }>();
  for (const [owner, assets] of changesOf(tx)) {
    for (const [asset, d] of assets) {
      if (asset === "SOL" && Math.abs(d) < DUST) continue;
      if (!by.has(asset)) by.set(asset, { out: [], in: [] });
      (d < 0 ? by.get(asset)!.out : by.get(asset)!.in).push([owner, Math.abs(d)]);
    }
  }
  const moves: Move[] = [];
  for (const [asset, side] of by) {
    const out = side.out.sort((a, b) => b[1] - a[1]);
    const inn = side.in.sort((a, b) => b[1] - a[1]);
    let i = 0;
    let j = 0;
    while (i < out.length && j < inn.length) {
      const amount = Math.min(out[i]![1], inn[j]![1]);
      if (amount > 0) moves.push({ sig, at, slot: tx.slot, from: out[i]![0], to: inn[j]![0], asset, amount });
      out[i]![1] -= amount;
      inn[j]![1] -= amount;
      if (out[i]![1] <= 1e-12) i++;
      if (inn[j]![1] <= 1e-12) j++;
    }
  }
  return moves;
}

/** The trades in a transaction of a coin: each signer whose holding of it rose bought (with the SOL it spent), each
 * whose holding fell sold. A signer is who traded: a pool never signs. */
export function tradesOf(tx: ParsedTx, sig: string, mint: string, skip: ReadonlySet<string> = new Set()): { buys: Buy[]; sells: Sell[] } {
  const at = (tx.blockTime ?? 0) * 1000;
  const changes = changesOf(tx);
  const buys: Buy[] = [];
  const sells: Sell[] = [];
  for (const k of keysOf(tx)) {
    if (!k.signer || skip.has(k.key)) continue;
    const c = changes.get(k.key);
    const d = c?.get(mint) ?? 0;
    if (d > 0) buys.push({ wallet: k.key, sig, slot: tx.slot, at, tokens: d, sol: Math.max(0, -(c?.get("SOL") ?? 0)) });
    else if (d < 0) sells.push({ wallet: k.key, sig, at, tokens: -d });
  }
  return { buys, sells };
}

/** A read's budget spent: the read stops (every other failure skips what could not be read). */
export class BudgetSpent extends Error {}

export type LaunchRead = Launch & { moves: Move[]; sells: Sell[]; txs: number; read: number };
export type HoldersRead = { supply: number; decimals: number; holdings: Holding[]; accounts: number };

/** A chain reader with a budget: its calls spaced, counted, a 429 waited out once. */
export class Trail {
  readonly #rpcs: readonly string[];
  readonly #fetch: typeof fetch | undefined;
  readonly #spacing: number;
  readonly #sleep: (ms: number) => Promise<void>;
  #last = 0;
  #queue: Promise<void> = Promise.resolve();
  calls = 0;
  budget: number;
  /** What the chain would not give in this read (a wallet's history, a transaction): skipped, and said. */
  unread = 0;

  constructor(o: { fetch?: typeof fetch; spacingMs?: number; budget?: number; sleep?: (ms: number) => Promise<void>; rpcs?: readonly string[] } = {}) {
    const sol = chainOf("solana");
    this.#rpcs = o.rpcs ?? (sol ? sol.rpcs : []);
    this.#fetch = o.fetch;
    this.#spacing = o.spacingMs ?? 250;
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.budget = o.budget ?? 150;
  }

  /** One call, spaced from the last, counted; refused once the budget is spent. */
  async call(method: string, params: unknown[]): Promise<unknown> {
    if (this.calls >= this.budget) throw new BudgetSpent(`the chain's budget for this read is spent (${this.budget} calls): read less at once`);
    this.calls++;
    const turn = this.#queue.then(async () => {
      const wait = this.#last + this.#spacing - Date.now();
      if (wait > 0) await this.#sleep(wait);
      this.#last = Date.now();
    });
    this.#queue = turn.catch(() => undefined);
    await turn;
    for (let attempt = 0; ; attempt++) {
      try {
        return await rpc(this.#rpcs, method, params, { fetch: this.#fetch });
      } catch (e) {
        if (attempt < 1 && /429|too many/i.test((e as Error).message)) {
          await this.#sleep(2_000);
          continue;
        }
        throw e;
      }
    }
  }

  async signatures(address: string, o: { pages: number; limit?: number }): Promise<{ sigs: Sig[]; reachedStart: boolean }> {
    const limit = o.limit ?? 1000;
    const sigs: Sig[] = [];
    let before: string | undefined;
    for (let p = 0; p < o.pages; p++) {
      let page: Sig[];
      try {
        page = (await this.call("getSignaturesForAddress", [address, { limit, ...(before && { before }) }])) as Sig[];
      } catch (e) {
        // 10-12, measured: a long history's next page can be refused ("Transaction … not found" for the page's start):
        // as far as it goes, then, and not its start
        if (before && !(e instanceof BudgetSpent) && /not found/i.test((e as Error).message)) return { sigs, reachedStart: false };
        throw e;
      }
      sigs.push(...page);
      if (page.length < limit) return { sigs, reachedStart: true };
      before = page.at(-1)!.signature;
    }
    return { sigs, reachedStart: false };
  }

  /** The newest transaction version this reader asks for (10-12, measured: the public RPC refuses a version-1
   * transaction to a client that says it reads only version 0, and names the version it needs). */
  #version = 1;

  async transaction(sig: string): Promise<ParsedTx | null> {
    try {
      return (await this.call("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: this.#version, commitment: "confirmed" }])) as ParsedTx | null;
    } catch (e) {
      // a newer version than this reader asked for: asked again once, as the chain says, and kept for the rest
      const v = /maxSupportedTransactionVersion"?:\s*(\d+)/.exec((e as Error).message);
      if (!v || Number(v[1]) <= this.#version) throw e;
      this.#version = Number(v[1]);
      return (await this.call("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: this.#version, commitment: "confirmed" }])) as ParsedTx | null;
    }
  }

  /** A mint: its token program, supply and decimals. */
  async mint(mint: string): Promise<{ program: string; supply: number; decimals: number }> {
    const r = (await this.call("getAccountInfo", [mint, { encoding: "jsonParsed" }])) as { value?: { owner?: string; data?: { parsed?: { type?: string; info?: { supply?: string; decimals?: number } } } } | null };
    const info = r.value?.data?.parsed;
    if (!r.value || info?.type !== "mint" || !info.info) throw new Error(`${mint} is not a token's mint on Solana`);
    const decimals = info.info.decimals ?? 0;
    return { program: r.value.owner ?? TOKEN, supply: Number(BigInt(info.info.supply ?? "0")) / 10 ** decimals, decimals };
  }

  /** A coin's launch: its signatures read back to the first (up to `pages` thousand), the creation (its payer the
   * deployer; the pool the largest receiver of the coin that did not sign), then every buy in its first `slots` slots
   * (at most `maxTx` transactions read). */
  async launch(coin: string, mint: string, o: { pages?: number; slots?: number; maxTx?: number } = {}): Promise<LaunchRead> {
    const { supply } = await this.mint(mint);
    const { sigs, reachedStart } = await this.signatures(mint, { pages: o.pages ?? 10 });
    const ok = sigs.filter((s) => !s.err).reverse(); // oldest first
    const base = { coin, supply, reachedStart, txs: sigs.length };
    // the oldest read is its creation only when the read reached its first transaction: else nothing is guessed from it
    if (!ok.length || !reachedStart) return { ...base, deployer: "", sig: "", slot: 0, at: 0, buys: [], pool: null, moves: [], sells: [], read: 0 };
    const first = ok[0]!;
    const create = await this.transaction(first.signature);
    if (!create) throw new Error(`the chain did not give ${first.signature}`);
    const keys = keysOf(create);
    const deployer = keys.find((k) => k.signer && k.key !== mint)?.key ?? keys[0]!.key;
    const gained = [...changesOf(create)].map(([owner, a]) => [owner, a.get(mint) ?? 0] as const).filter(([owner, d]) => d > 0 && !keys.some((k) => k.signer && k.key === owner)).sort((a, b) => b[1] - a[1]);
    const pool = gained[0]?.[0] ?? null;
    const skip = new Set([mint, ...(pool ? [pool] : [])]);
    const slots = o.slots ?? 2;
    const early = ok.slice(1).filter((s) => s.slot <= first.slot + slots).slice(0, o.maxTx ?? 30);
    const buys: Buy[] = [];
    const sells: Sell[] = [];
    const moves: Move[] = [];
    let read = 1;
    for (const [s, tx] of [[first, create] as const, ...(await this.#each(early.map((x) => x.signature))).map((tx, i) => [early[i]!, tx] as const)]) {
      if (!tx) continue;
      if (s !== first) read++;
      const t = tradesOf(tx, s.signature, mint, skip);
      buys.push(...t.buys);
      sells.push(...t.sells);
      moves.push(...movesOf(tx, s.signature));
    }
    return { ...base, deployer, sig: first.signature, slot: first.slot, at: (first.blockTime ?? 0) * 1000, buys, pool, moves, sells, read };
  }

  /** Each transaction, one that cannot be read left as null (a budget spent stops it). */
  async #each(sigs: readonly string[]): Promise<(ParsedTx | null)[]> {
    const out: (ParsedTx | null)[] = [];
    for (const s of sigs) out.push(await this.transaction(s).catch((e: unknown) => {
      if (e instanceof BudgetSpent) throw e;
      return null;
    }));
    return out;
  }

  /** Who holds a coin: the token program's accounts of its mint, 40 bytes each (owner, amount), summed by owner; the
   * `top` largest looked up, a program's account (a pool, a curve) told from a wallet. */
  async holders(mint: string, o: { top?: number } = {}): Promise<HoldersRead> {
    const m = await this.mint(mint);
    const filters: unknown[] = [{ memcmp: { offset: 0, bytes: mint } }, ...(m.program === TOKEN ? [{ dataSize: 165 }] : [])];
    const accounts = (await this.call("getProgramAccounts", [m.program === TOKEN22 ? TOKEN22 : TOKEN, { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters }])) as { account: { data: [string, string] } }[];
    const by = new Map<string, bigint>();
    for (const a of accounts) {
      const bytes = Buffer.from(a.account.data[0], "base64");
      if (bytes.length < 40) continue;
      const owner = toBase58(bytes.subarray(0, 32));
      by.set(owner, (by.get(owner) ?? 0n) + bytes.readBigUInt64LE(32));
    }
    const sorted = [...by].filter(([, n]) => n > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, o.top ?? 40);
    const owners = (await this.call("getMultipleAccounts", [sorted.map(([w]) => w), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }])) as { value: ({ owner: string } | null)[] };
    const holdings = sorted.map(([owner, n], i) => {
      const prog = owners.value[i]?.owner;
      return { owner, tokens: Number(n) / 10 ** m.decimals, pool: !!prog && prog !== SYSTEM };
    });
    return { supply: m.supply, decimals: m.decimals, holdings, accounts: accounts.length };
  }

  /** A wallet's first money in and when it was born: its signatures read back to the first (up to `pages` thousand; a
   * wallet with more is busy), then its oldest transactions until one where its SOL rose: who sent the most. */
  async funding(wallet: string, o: { pages?: number } = {}): Promise<Funding> {
    const { sigs, reachedStart } = await this.signatures(wallet, { pages: o.pages ?? 2 });
    if (!reachedStart) return { wallet, funder: null, at: null, sig: null, sol: 0, born: null, busy: true };
    const ok = sigs.filter((s) => !s.err).reverse();
    const born = ok[0]?.blockTime ? ok[0].blockTime * 1000 : null;
    for (const s of ok.slice(0, 3)) {
      const tx = await this.transaction(s.signature);
      if (!tx) continue;
      const c = changesOf(tx);
      const mine = c.get(wallet)?.get("SOL") ?? 0;
      if (mine <= DUST) continue;
      const from = [...c].map(([w, a]) => [w, a.get("SOL") ?? 0] as const).filter(([w, d]) => w !== wallet && d < 0).sort((a, b) => a[1] - b[1])[0];
      return { wallet, funder: from?.[0] ?? null, at: (tx.blockTime ?? 0) * 1000, sig: s.signature, sol: mine, born, busy: false };
    }
    return { wallet, funder: null, at: null, sig: null, sol: 0, born, busy: false };
  }

  /** Whether a wallet is busy: a thousand transactions in under two days (an exchange's, a bot's, a program's). */
  async busy(wallet: string): Promise<boolean> {
    const page = (await this.call("getSignaturesForAddress", [wallet, { limit: 1000 }])) as Sig[];
    if (page.length < 1000) return false;
    const t0 = page.at(-1)!.blockTime;
    const t1 = page[0]!.blockTime;
    return t0 !== null && t1 !== null && t1 - t0 < 2 * 86_400;
  }

  /** A wallet's recent transfers (its last `limit` transactions read), the ones it sent or got. */
  async flows(wallet: string, o: { limit?: number; mint?: string } = {}): Promise<{ moves: Move[]; sells: Sell[]; buys: Buy[]; read: number }> {
    const page = ((await this.call("getSignaturesForAddress", [wallet, { limit: o.limit ?? 20 }])) as Sig[]).filter((s) => !s.err);
    const moves: Move[] = [];
    const sells: Sell[] = [];
    const buys: Buy[] = [];
    for (const s of page) {
      const tx = await this.transaction(s.signature);
      if (!tx) continue;
      moves.push(...movesOf(tx, s.signature).filter((m) => m.from === wallet || m.to === wallet));
      if (o.mint) {
        const t = tradesOf(tx, s.signature, o.mint);
        sells.push(...t.sells.filter((x) => x.wallet === wallet));
        buys.push(...t.buys.filter((x) => x.wallet === wallet));
      }
    }
    return { moves, sells, buys, read: page.length };
  }
}

/** A Solana address, or why not. */
export const isSolanaAddress = (a: string): boolean => {
  const b = base58(a);
  return !!b && b.length === 32;
};
