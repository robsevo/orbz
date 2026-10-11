// What a token can do to whoever holds it, read before a swap (PLAN 5.28; owner, 10-11: "shitcoins, anything ... for
// pros"): on Solana its mint, from the chain itself (an authority that can freeze what you hold or mint more, a fee on
// every transfer or a delegate over everyone's tokens under Token-2022); on the EVM chains its code, by the reverse
// engineer's reader (reverse/evm.ts: the functions that can stop you selling or take what you hold, and a proxy, whose
// owner can change the code); and from its pair, how thin and how new it is. Said as facts, never as advice.
import { chainOf, rpc } from "./chains.ts";
import { bytecodeOf, readEvm } from "../reverse/evm.ts";
import type { DexChain, DexPair } from "./dex.ts";

export type Flag = { level: "warn" | "note"; words: string };
export type Safety = { checked: string[]; flags: Flag[] };

const usd = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

export async function safetyOf(chain: DexChain, address: string, pair: DexPair | null, o: { now: number; fetch?: typeof fetch }): Promise<Safety> {
  const flags: Flag[] = [];
  const checked: string[] = [];
  if (pair) {
    checked.push("its pair");
    if (pair.liquidityUsd !== null && pair.liquidityUsd < 10_000) flags.push({ level: "warn", words: `thin: ${usd(pair.liquidityUsd)} in its pool, so a sale moves its price a lot` });
    if (pair.createdAt !== null && o.now - pair.createdAt < 24 * 3600_000) flags.push({ level: "warn", words: "new: its pair is less than a day old" });
    if (pair.dex === "pumpfun") flags.push({ level: "note", words: "still on pump.fun's curve: it moves to a DEX pool once the curve fills" });
  }
  const c = chainOf(chain);
  if (!c) return { checked, flags }; // a chain the desk does not swap on: its pair alone
  try {
    if (c.kind === "solana") {
      const r = (await rpc(c.rpcs, "getAccountInfo", [address, { encoding: "jsonParsed" }], { fetch: o.fetch })) as {
        value?: { owner?: string; data?: { parsed?: { type?: string; info?: { mintAuthority?: string | null; freezeAuthority?: string | null; extensions?: { extension?: string }[] } } } } | null;
      };
      checked.push("its mint");
      const parsed = r.value?.data?.parsed;
      if (parsed?.type !== "mint" || !parsed.info) {
        flags.push({ level: "warn", words: "this address is not a token's mint on Solana" });
        return { checked, flags };
      }
      const i = parsed.info;
      if (i.freezeAuthority) flags.push({ level: "warn", words: "its mint can freeze what you hold" });
      if (i.mintAuthority) flags.push({ level: "warn", words: "more of it can still be minted" });
      const ext = new Set((i.extensions ?? []).map((e) => e.extension));
      if (ext.has("transferFeeConfig")) flags.push({ level: "warn", words: "it takes a fee on every transfer (Token-2022)" });
      if (ext.has("permanentDelegate")) flags.push({ level: "warn", words: "a permanent delegate can move anyone's tokens (Token-2022)" });
      if (ext.has("transferHook")) flags.push({ level: "note", words: "every transfer runs a program of its own (Token-2022)" });
    } else {
      const code = String(await rpc(c.rpcs, "eth_getCode", [address, "latest"], { fetch: o.fetch }));
      checked.push("its code");
      if (!/^0x[0-9a-fA-F]+$/.test(code) || code === "0x") {
        flags.push({ level: "warn", words: `there is no code at this address on ${c.name}` });
        return { checked, flags };
      }
      const facts = readEvm(bytecodeOf(code));
      const watch = facts.functions.filter((f) => f.watch).map((f) => f.name ?? f.selector);
      if (watch.length) flags.push({ level: "warn", words: `its code has ${watch.slice(0, 6).join(", ")}${watch.length > 6 ? " and more" : ""}: whoever holds those can stop you selling or take what you hold` });
      if (facts.proxy) flags.push({ level: "warn", words: "it is a proxy: its owner can change its code" });
    }
  } catch (e) {
    flags.push({ level: "note", words: `its chain could not be read just now: ${(e as Error).message.slice(0, 120)}` });
  }
  return { checked, flags };
}
