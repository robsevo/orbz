// The chains a wallet lives on and the tokens the desk knows on each (PLAN 5.26-5.27; owner, 10-10: "we want the user
// to be able to connect any wallet, like metamask or wtv. phantom etc."; "base also"): EVM chains (Ethereum, Base,
// Arbitrum, Optimism, Polygon), Solana, and Bitcoin for holdings only. Every token's address and decimals were read
// from its own chain on 10-10 (symbol() and decimals(); a Solana mint's account), never typed from memory. Each chain
// has two public RPCs, the second tried when the first fails. And an address is checked by its own chain's rules before
// anything is kept: EIP-55's checksum, a Solana key's 32 bytes, Bitcoin's base58check and bech32 (BIP-173, BIP-350).
import { createHash } from "node:crypto";
import { hex, keccak256 } from "../keccak.ts";

export type Token = { symbol: string; address: string; decimals: number; native?: true; market?: string; stable?: true };
export type EvmChain = { kind: "evm"; id: string; name: string; chainId: number; kyber: string; rpcs: readonly string[]; explorer: string; tokens: readonly Token[] };
export type SolanaChain = { kind: "solana"; id: "solana"; name: "Solana"; rpcs: readonly string[]; explorer: string; tokens: readonly Token[] };
export type Chain = EvmChain | SolanaChain;

/** A chain's own coin, as KyberSwap names it. */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const eth = (market = "ETH"): Token => ({ symbol: "ETH", address: NATIVE, decimals: 18, native: true, market });

export const CHAINS: readonly Chain[] = [
  {
    kind: "evm", id: "base", name: "Base", chainId: 8453, kyber: "base", explorer: "https://basescan.org/tx/",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    tokens: [eth(), { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, stable: true }, { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, market: "ETH" }, { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, market: "BTC" }],
  },
  {
    kind: "evm", id: "ethereum", name: "Ethereum", chainId: 1, kyber: "ethereum", explorer: "https://etherscan.io/tx/",
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    tokens: [eth(), { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, stable: true }, { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, stable: true }, { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, market: "BTC" }, { symbol: "LINK", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, market: "LINK" }, { symbol: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, market: "UNI" }, { symbol: "AAVE", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, market: "AAVE" }],
  },
  { kind: "evm", id: "arbitrum", name: "Arbitrum", chainId: 42161, kyber: "arbitrum", explorer: "https://arbiscan.io/tx/", rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"], tokens: [eth(), { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, stable: true }] },
  { kind: "evm", id: "optimism", name: "Optimism", chainId: 10, kyber: "optimism", explorer: "https://optimistic.etherscan.io/tx/", rpcs: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"], tokens: [eth(), { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, stable: true }] },
  { kind: "evm", id: "polygon", name: "Polygon", chainId: 137, kyber: "polygon", explorer: "https://polygonscan.com/tx/", rpcs: ["https://polygon-bor-rpc.publicnode.com"], tokens: [{ symbol: "POL", address: NATIVE, decimals: 18, native: true }, { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, stable: true }] },
  // BNB Chain (owner, 10-11: "coin swap in general, not just pump.fun"): its tokens' symbols and decimals read from the
  // chain itself on 10-11 (symbol() and decimals() at both RPCs, chain id 0x38), never typed from memory
  {
    kind: "evm", id: "bsc", name: "BNB Chain", chainId: 56, kyber: "bsc", explorer: "https://bscscan.com/tx/",
    rpcs: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
    tokens: [
      { symbol: "BNB", address: NATIVE, decimals: 18, native: true, market: "BNB" },
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, stable: true },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, stable: true },
      { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, market: "BNB" },
    ],
  },
  {
    kind: "solana", id: "solana", name: "Solana", explorer: "https://solscan.io/tx/",
    rpcs: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
    tokens: [
      { symbol: "SOL", address: "So11111111111111111111111111111111111111112", decimals: 9, native: true, market: "SOL" },
      { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, stable: true },
      { symbol: "USDT", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, stable: true },
      { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
      { symbol: "cbBTC", address: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", decimals: 8, market: "BTC" },
    ],
  },
];

export const chainOf = (id: string): Chain | null => CHAINS.find((c) => c.id === id) ?? null;
export const tokenOf = (chain: Chain, symbolOrAddress: string): Token | null =>
  chain.tokens.find((t) => t.symbol.toLowerCase() === symbolOrAddress.toLowerCase() || t.address.toLowerCase() === symbolOrAddress.toLowerCase()) ?? null;

// ── amounts ───────────────────────────────────────────────────────────────────────────────────────
/** "1.5" of a token with 18 decimals as its smallest units, exactly (no floating point): refused past its decimals. */
export function toUnits(amount: string, decimals: number): bigint {
  const m = /^(\d{1,30})(?:\.(\d{1,40}))?$/.exec(amount.trim());
  if (!m) throw new Error(`"${amount}" is not an amount: digits, and a point if it needs one`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`this token has ${decimals} decimals: "${amount}" has ${frac.length}`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
/** Smallest units as a person reads them, to at most `places` decimals, trailing zeros dropped. */
export function fromUnits(units: bigint, decimals: number, places = 6): string {
  const neg = units < 0n;
  const u = neg ? -units : units;
  const whole = u / 10n ** BigInt(decimals);
  const frac = (u % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

// ── addresses ─────────────────────────────────────────────────────────────────────────────────────
/** An EVM address with its EIP-55 checksum. */
export function checksummed(addr: string): string {
  const lower = addr.slice(2).toLowerCase();
  const h = hex(keccak256(lower));
  return `0x${[...lower].map((c, i) => (parseInt(h[i]!, 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Bech32 and bech32m (BIP-173, BIP-350): which one the checksum is, or null when it is neither. */
function bech32Kind(s: string): "bech32" | "bech32m" | null {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const lower = s.toLowerCase();
  if (s !== lower && s !== s.toUpperCase()) return null;
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length || lower.length > 90) return null;
  const hrp = lower.slice(0, pos);
  const data = [...lower.slice(pos + 1)].map((c) => CHARSET.indexOf(c));
  if (data.some((d) => d < 0)) return null;
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data]) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk === 1 ? "bech32" : chk === 0x2bc830a3 ? "bech32m" : null;
}

export type Address = { chain: "evm" | "solana" | "bitcoin"; address: string };

/** An address as its own chain's rules read it, or why it is not one. */
export function readAddress(raw: string): Address | { why: string } {
  const a = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
    const mixed = a.slice(2) !== a.slice(2).toLowerCase() && a.slice(2) !== a.slice(2).toUpperCase();
    if (mixed && checksummed(a) !== a) return { why: "an Ethereum-style address with a typo: its capitals do not match its EIP-55 checksum" };
    return { chain: "evm", address: checksummed(a) };
  }
  if (/^(bc1|BC1)[0-9A-Za-z]{11,87}$/.test(a)) {
    const k = bech32Kind(a);
    const witness = a.toLowerCase()[3]; // q: version 0 (bech32), p: version 1 (bech32m)
    if (!k || (witness === "q" && k !== "bech32") || (witness !== "q" && k !== "bech32m")) return { why: "a Bitcoin address with a typo: its bech32 checksum does not hold" };
    return { chain: "bitcoin", address: a.toLowerCase() };
  }
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) {
    const b = base58(a);
    if (!b || b.length !== 25) return { why: "not a Bitcoin address: its base58 is the wrong length" };
    const sum = createHash("sha256").update(createHash("sha256").update(b.subarray(0, 21)).digest()).digest();
    if (!sum.subarray(0, 4).equals(Buffer.from(b.subarray(21)))) return { why: "a Bitcoin address with a typo: its checksum does not hold" };
    return { chain: "bitcoin", address: a };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
    const b = base58(a);
    if (b?.length === 32) return { chain: "solana", address: a };
    return { why: "not a Solana address: a Solana address is 32 bytes in base58" };
  }
  return { why: "not an address Orbz reads: an Ethereum-style 0x… address, a Solana address or a Bitcoin address" };
}

// ── talking to a chain ────────────────────────────────────────────────────────────────────────────
/** A JSON-RPC call to the first of a chain's RPCs that answers. */
export async function rpc(rpcs: readonly string[], method: string, params: unknown[], o: { fetch?: typeof fetch } = {}): Promise<unknown> {
  const get = o.fetch ?? fetch;
  let last: unknown = null;
  for (const url of rpcs) {
    try {
      const r = await get(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
      const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? "the chain refused the call");
      return j.result;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("no RPC answered");
}

/** ERC-20 call data: a selector and its words. */
export const call = (signature: string, ...words: string[]): string => `0x${hex(keccak256(signature)).slice(0, 8)}${words.map((w) => w.replace(/^0x/, "").toLowerCase().padStart(64, "0")).join("")}`;
