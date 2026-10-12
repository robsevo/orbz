// A stand-in for Solana's public RPC (PLAN 5.42): the calls an investigation makes (getSignaturesForAddress,
// getTransaction, getAccountInfo, getProgramAccounts, getMultipleAccounts), answered in their shapes from transactions a
// test writes as each wallet's change in SOL and in each coin. A wallet can be made busy (a thousand signatures a page,
// every page: more history than a read takes), and the first call of a method can be refused with a 429. No network.
import { createHash } from "node:crypto";
import { toBase58, type ParsedTx } from "../../src/desk/trail.ts";

export const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const SYSTEM = "11111111111111111111111111111111";
export const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** A Solana address for a name: 32 bytes of its hash, in base58 (a test's wallets, readable by name). */
export const addr = (name: string): string => toBase58(createHash("sha256").update(name).digest());

type Written = { sig: string; slot: number; at: number; keys: { key: string; signer: boolean }[]; tx: ParsedTx; err: boolean };

export class StandInChain {
  readonly txs: Written[] = [];
  readonly mints = new Map<string, { supply: bigint; decimals: number; program: string }>();
  readonly accounts: { account: string; mint: string; owner: string; amount: bigint }[] = [];
  /** The program that owns an account (a pool's, a curve's); a wallet's is the system program. */
  readonly owners = new Map<string, string>();
  readonly busy = new Set<string>();
  readonly calls: string[] = [];
  /** Methods whose next call is refused with a 429. */
  readonly throttle = new Set<string>();
  /** Signatures a page cannot start from ("not found", as the public RPC says of some, 10-12). */
  readonly lost = new Set<string>();
  /** A transaction's version (0 unless set): one newer than the client asks for is refused. */
  readonly versions = new Map<string, number>();

  mint(address: string, supply: number, decimals = 6, program = TOKEN22): void {
    this.mints.set(address, { supply: BigInt(supply) * 10n ** BigInt(decimals), decimals, program });
  }

  hold(owner: string, mint: string, tokens: number, account = addr(`acct:${owner}:${mint}:${this.accounts.length}`)): void {
    const m = this.mints.get(mint)!;
    this.accounts.push({ account, mint, owner, amount: BigInt(Math.round(tokens * 10 ** m.decimals)) });
  }

  /** A transaction: who signed (the first pays its fee), each wallet's change in SOL, each owner's change in a coin. */
  write(o: { sig: string; slot: number; at: number; signers: string[]; sol?: Record<string, number>; tokens?: { owner: string; mint: string; delta: number; pre?: number }[]; also?: string[]; fee?: number; err?: boolean }): void {
    const fee = o.fee ?? 5000;
    const keys: { key: string; signer: boolean }[] = [];
    const key = (k: string, signer = false): number => {
      const i = keys.findIndex((x) => x.key === k);
      if (i >= 0) return i;
      keys.push({ key: k, signer });
      return keys.length - 1;
    };
    for (const s of o.signers) key(s, true);
    for (const k of [...Object.keys(o.sol ?? {}), ...(o.also ?? [])]) key(k);
    const pre: number[] = [];
    const post: number[] = [];
    const tokenPre: NonNullable<NonNullable<ParsedTx["meta"]>["preTokenBalances"]> = [];
    const tokenPost: NonNullable<NonNullable<ParsedTx["meta"]>["postTokenBalances"]> = [];
    for (const t of o.tokens ?? []) {
      key(t.mint);
      const m = this.mints.get(t.mint)!;
      const i = key(`ta:${t.owner}:${t.mint}`);
      const before = BigInt(Math.round((t.pre ?? 0) * 10 ** m.decimals));
      const after = before + BigInt(Math.round(t.delta * 10 ** m.decimals));
      tokenPre.push({ accountIndex: i, mint: t.mint, owner: t.owner, uiTokenAmount: { amount: String(before), decimals: m.decimals } });
      tokenPost.push({ accountIndex: i, mint: t.mint, owner: t.owner, uiTokenAmount: { amount: String(after), decimals: m.decimals } });
    }
    keys.forEach((k, i) => {
      const lamports = 10_000_000_000;
      const d = Math.round((o.sol?.[k.key] ?? 0) * 1e9) - (i === 0 ? fee : 0);
      pre.push(lamports);
      post.push(lamports + d);
    });
    const tx: ParsedTx = {
      slot: o.slot, blockTime: Math.floor(o.at / 1000),
      meta: { err: o.err ? { InstructionError: [0, "Custom"] } : null, fee, preBalances: pre, postBalances: post, preTokenBalances: tokenPre, postTokenBalances: tokenPost },
      transaction: { message: { accountKeys: keys.map((k) => ({ pubkey: k.key, signer: k.signer })) } },
    };
    this.txs.push({ sig: o.sig, slot: o.slot, at: o.at, keys, tx, err: !!o.err });
  }

  /** The stand-in RPC: JSON-RPC by POST, each call kept as its method. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] };
    this.calls.push(body.method);
    const json = (v: unknown): Response => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    if (this.throttle.delete(body.method)) return json({ jsonrpc: "2.0", id: 1, error: { code: 429, message: "Too many requests for a specific RPC call" } });
    const ok = (result: unknown): Response => json({ jsonrpc: "2.0", id: 1, result });
    const [first, opts] = body.params as [unknown, Record<string, unknown> | undefined];
    switch (body.method) {
      case "getSignaturesForAddress": {
        const a = String(first);
        const limit = Number(opts?.limit ?? 1000);
        if (opts?.before && this.lost.has(String(opts.before))) return json({ jsonrpc: "2.0", id: 1, error: { code: -32009, message: `Transaction ${String(opts.before)} not found` } });
        if (this.busy.has(a)) return ok(Array.from({ length: limit }, (_, i) => ({ signature: `busy-${a.slice(0, 6)}-${String(opts?.before ?? "")}-${i}`, slot: 9_000_000 - i, blockTime: 1_790_000_000 - i, err: null })));
        // the newest first, as the chain gives them; within a slot, the later in its block first (written later)
        const mine = this.txs.map((t, i) => ({ t, i })).filter(({ t }) => t.keys.some((k) => k.key === a)).sort((x, y) => y.t.slot - x.t.slot || y.i - x.i).map(({ t }) => t);
        const from = opts?.before ? mine.findIndex((t) => t.sig === opts.before) + 1 : 0;
        return ok(mine.slice(from, from + limit).map((t) => ({ signature: t.sig, slot: t.slot, blockTime: Math.floor(t.at / 1000), err: t.err ? {} : null })));
      }
      case "getTransaction": {
        // a transaction newer than the client says it reads is refused, as the public RPC does (10-12)
        const v = this.versions.get(String(first)) ?? 0;
        if (v > Number(opts?.maxSupportedTransactionVersion ?? -1)) return json({ jsonrpc: "2.0", id: 1, error: { code: -32015, message: `Transaction version (${v}) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": ${v}` } });
        return ok(this.txs.find((t) => t.sig === first)?.tx ?? null);
      }
      case "getAccountInfo": {
        const m = this.mints.get(String(first));
        if (!m) return ok({ value: { owner: this.owners.get(String(first)) ?? SYSTEM, data: ["", "base64"] } });
        return ok({ value: { owner: m.program, data: { parsed: { type: "mint", info: { supply: String(m.supply), decimals: m.decimals, mintAuthority: null, freezeAuthority: null } } } } });
      }
      case "getProgramAccounts": {
        const filters = (opts?.filters ?? []) as { memcmp?: { offset: number; bytes: string } }[];
        const mint = filters.find((f) => f.memcmp?.offset === 0)?.memcmp?.bytes;
        const slice = opts?.dataSlice as { offset: number; length: number } | undefined;
        const rows = this.accounts.filter((x) => x.mint === mint && this.mints.get(x.mint)?.program === first);
        return ok(rows.map((x) => {
          const full = Buffer.alloc(165);
          Buffer.from(createHash("sha256").update("mint").digest()).copy(full, 0); // stands for the mint's bytes
          decode58(x.owner).copy(full, 32);
          full.writeBigUInt64LE(x.amount, 64);
          const data = slice ? full.subarray(slice.offset, slice.offset + slice.length) : full;
          return { pubkey: x.account, account: { data: [data.toString("base64"), "base64"], owner: first } };
        }));
      }
      case "getMultipleAccounts":
        return ok({ value: (first as string[]).map((a) => ({ owner: this.owners.get(a) ?? SYSTEM, data: ["", "base64"] })) });
      default:
        return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `${body.method} is not in the stand-in` } });
    }
  }) as typeof fetch;
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decode58(s: string): Buffer {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  while (bytes.length < 32) bytes.unshift(0);
  return Buffer.from(bytes);
}

/** The wallets of the scenario below, by name. */
export const W = Object.fromEntries(["GRAN", "MOM", "DEV", "B1", "B2", "B3", "B4", "LATE", "CEX", "MULE", "CURVE", "MINT", "H1", "H2", "DEV2", "MINT2", "CURVE2", "C1"].map((n) => [n, addr(n)])) as Record<string, string>;
export const LAUNCH_AT = Date.parse("2026-10-12T12:00:00Z");

/**
 * A bundled launch, as the chain would show it (worked out by hand for the tests):
 *  - GRAN sent MOM 3 SOL three hours before; MOM sent DEV 1 SOL an hour before (DEV born then), and B1 and B2 0.5 SOL
 *    each half an hour before (both born then). CEX, an exchange (busy), sent B3 and B4 their first SOL weeks before.
 *  - In slot 1000 DEV created MINT (supply 1,000,000,000) and bought 50,000,000 (5%) from CURVE, pump.fun's curve (a
 *    program's account); B1 bought 100,000,000 and B2 80,000,000 in the same slot; B3 20,000,000 in slot 1001; LATE
 *    10,000,000 in slot 1003, past the first hands. First hands: DEV, B1, B2, B3: 250,000,000, 25%.
 *  - B1 sold all of its 100,000,000 a minute after the launch and B2 its 80,000,000 thirty seconds later (one group,
 *    MOM's, selling together); DEV sold 40,000,000 of its 50,000,000 (80%) at two minutes; DEV sent MULE 3 SOL, and
 *    MULE sent CEX 3 SOL (a way out).
 *  - Holders now: CURVE 670,000,000 (a pool), B4 50,000,000 (bought later), B3 20,000,000, LATE 10,000,000, DEV
 *    10,000,000, H1 and H2 5,000,000 each (funded by B3, so with it one group).
 * A second coin, MINT2, launched a day later by DEV2 (funded by MOM) with B1 among its first hands: the same hands.
 */
export function bundledLaunch(c: StandInChain): void {
  const T = LAUNCH_AT;
  const m = 60_000;
  c.mint(W.MINT!, 1_000_000_000);
  c.owners.set(W.CURVE!, PUMP);
  c.owners.set(W.CURVE2!, PUMP);
  c.busy.add(W.CEX!);
  c.write({ sig: "gran-mom", slot: 900, at: T - 180 * m, signers: [W.GRAN!], sol: { [W.GRAN!]: -3, [W.MOM!]: 3 } });
  c.write({ sig: "mom-dev", slot: 950, at: T - 60 * m, signers: [W.MOM!], sol: { [W.MOM!]: -1, [W.DEV!]: 1 } });
  c.write({ sig: "mom-b1", slot: 970, at: T - 30 * m, signers: [W.MOM!], sol: { [W.MOM!]: -0.5, [W.B1!]: 0.5 } });
  c.write({ sig: "mom-b2", slot: 971, at: T - 30 * m, signers: [W.MOM!], sol: { [W.MOM!]: -0.5, [W.B2!]: 0.5 } });
  c.write({ sig: "cex-b3", slot: 10, at: T - 20 * 24 * 60 * m, signers: [W.CEX!], sol: { [W.CEX!]: -2, [W.B3!]: 2 } });
  c.write({ sig: "cex-b4", slot: 11, at: T - 21 * 24 * 60 * m, signers: [W.CEX!], sol: { [W.CEX!]: -2, [W.B4!]: 2 } });
  c.write({ sig: "b3-h1", slot: 12, at: T - 19 * 24 * 60 * m, signers: [W.B3!], sol: { [W.B3!]: -0.2, [W.H1!]: 0.2 } });
  c.write({ sig: "b3-h2", slot: 13, at: T - 19 * 24 * 60 * m, signers: [W.B3!], sol: { [W.B3!]: -0.2, [W.H2!]: 0.2 } });
  const curve = (sig: string, slot: number, at: number, who: string, sol: number, tokens: number, pre = 0): void =>
    c.write({ sig, slot, at, signers: [who], sol: { [who]: -sol, [W.CURVE!]: sol }, tokens: [{ owner: who, mint: W.MINT!, delta: tokens, pre }, { owner: W.CURVE!, mint: W.MINT!, delta: -tokens, pre: 950_000_000 }] });
  c.write({ sig: "create", slot: 1000, at: T, signers: [W.DEV!, W.MINT!], sol: { [W.DEV!]: -1.5, [W.CURVE!]: 1.5 }, tokens: [{ owner: W.DEV!, mint: W.MINT!, delta: 50_000_000 }, { owner: W.CURVE!, mint: W.MINT!, delta: 950_000_000 }] });
  curve("b1-buy", 1000, T, W.B1!, 0.4, 100_000_000);
  curve("b2-buy", 1000, T, W.B2!, 0.3, 80_000_000);
  curve("b3-buy", 1001, T + 400, W.B3!, 0.08, 20_000_000);
  curve("late-buy", 1003, T + 1200, W.LATE!, 0.04, 10_000_000);
  c.write({ sig: "failed", slot: 1002, at: T + 800, signers: [W.B4!], sol: {}, err: true, also: [W.MINT!] });
  curve("b1-sell", 1150, T + m, W.B1!, -0.5, -100_000_000, 100_000_000);
  curve("b2-sell", 1225, T + 1.5 * m, W.B2!, -0.4, -80_000_000, 80_000_000);
  curve("dev-sell", 1300, T + 2 * m, W.DEV!, -0.3, -40_000_000, 50_000_000);
  c.write({ sig: "dev-mule", slot: 1400, at: T + 2.5 * m, signers: [W.DEV!], sol: { [W.DEV!]: -3, [W.MULE!]: 3 } });
  c.write({ sig: "mule-cex", slot: 1500, at: T + 3.5 * m, signers: [W.MULE!], sol: { [W.MULE!]: -3, [W.CEX!]: 3 } });
  for (const [who, n] of [[W.CURVE!, 670_000_000], [W.B4!, 50_000_000], [W.B3!, 20_000_000], [W.LATE!, 10_000_000], [W.DEV!, 6_000_000], [W.H1!, 5_000_000], [W.H2!, 5_000_000]] as const) c.hold(who, W.MINT!, n);
  c.hold(W.DEV!, W.MINT!, 4_000_000); // a second account of DEV's: 10,000,000 in all
  // the second coin, a day later: the same hands
  const D = T + 24 * 60 * m;
  c.mint(W.MINT2!, 1_000_000_000);
  c.write({ sig: "mom-dev2", slot: 5000, at: D - 30 * m, signers: [W.MOM!], sol: { [W.MOM!]: -1, [W.DEV2!]: 1 } });
  c.write({ sig: "create2", slot: 5100, at: D, signers: [W.DEV2!, W.MINT2!], sol: { [W.DEV2!]: -1, [W.CURVE2!]: 1 }, tokens: [{ owner: W.DEV2!, mint: W.MINT2!, delta: 30_000_000 }, { owner: W.CURVE2!, mint: W.MINT2!, delta: 970_000_000 }] });
  c.write({ sig: "b1-buy2", slot: 5100, at: D, signers: [W.B1!], sol: { [W.B1!]: -0.2, [W.CURVE2!]: 0.2 }, tokens: [{ owner: W.B1!, mint: W.MINT2!, delta: 90_000_000 }, { owner: W.CURVE2!, mint: W.MINT2!, delta: -90_000_000, pre: 970_000_000 }] });
  c.write({ sig: "c1-buy2", slot: 5101, at: D + 400, signers: [W.C1!], sol: { [W.C1!]: -0.1, [W.CURVE2!]: 0.1 }, tokens: [{ owner: W.C1!, mint: W.MINT2!, delta: 40_000_000 }, { owner: W.CURVE2!, mint: W.MINT2!, delta: -40_000_000, pre: 880_000_000 }] });
  c.write({ sig: "cex-c1", slot: 20, at: T - 30 * 24 * 60 * m, signers: [W.CEX!], sol: { [W.CEX!]: -1, [W.C1!]: 1 } });
  for (const [who, n] of [[W.CURVE2!, 840_000_000], [W.B1!, 90_000_000], [W.C1!, 40_000_000], [W.DEV2!, 30_000_000]] as const) c.hold(who, W.MINT2!, n);
}
