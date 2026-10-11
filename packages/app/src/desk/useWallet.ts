// The wallet connected here, one for the whole desk: its header, the Trade tab and a token's page (owner, 10-11: "we can
// connect our phantom wallet. I dont see the wallet trying to connect at all when we say connect wallet"). The wallets
// this browser has, found as they announce themselves; the one connected, asked again without a window when it said
// yes to this page before; a swap built by the home for it, signed by it, its hash told back.
import { useEffect, useState } from "react";
import type { Office } from "../home/link.ts";
import { connectSilently, connectWallet, discover, signAndSend, type Found } from "./wallet.ts";

const LAST = "orbs.desk.wallet";
export type Linked = { f: Found; address: string };
export type WalletHere = {
  found: Found[];
  linked: Linked | null;
  busy: boolean;
  said: string | null;
  /** The wallet's own window asks you; its address is kept by the home. */
  connect: (f: Found) => Promise<void>;
  forget: () => void;
  /** A swap the home keeps, built for this wallet and signed by it: `kind` is its chain's. */
  sign: (id: number, kind: "evm" | "solana", step: (words: string) => void) => Promise<void>;
};

export function useWallet(home: Office | null, reload: () => void): WalletHere {
  const [found, setFound] = useState<Found[]>([]);
  const [linked, setLinked] = useState<Linked | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => discover(setFound), []);
  // the wallet connected here before, without its window
  useEffect(() => {
    if (linked) return;
    let last: string | null = null;
    try {
      last = globalThis.localStorage?.getItem(LAST) ?? null;
    } catch {
      // a private window: connected again by hand
    }
    const f = found.find((x) => x.id === last);
    if (!f) return;
    let live = true;
    void connectSilently(f).then((address) => live && address !== null && setLinked({ f, address }));
    return () => {
      live = false;
    };
  }, [found]);
  const connect = async (f: Found): Promise<void> => {
    setBusy(true);
    setSaid(null);
    try {
      const address = await connectWallet(f);
      setLinked({ f, address });
      try {
        globalThis.localStorage?.setItem(LAST, f.id);
      } catch {
        // a private window: for as long as the page is open
      }
      if (home) {
        await home.addWallet(address, { wallet: f.name }).catch(() => undefined); // kept already: the same address
        reload();
      }
    } catch (e) {
      setSaid((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const forget = (): void => {
    setLinked(null);
    try {
      globalThis.localStorage?.removeItem(LAST);
    } catch {
      // nothing kept
    }
  };
  const sign = async (id: number, kind: "evm" | "solana", step: (words: string) => void): Promise<void> => {
    if (!home) throw new Error("no home to build it");
    if (!linked || linked.f.kind !== kind) throw new Error(`Connect a ${kind === "solana" ? "Solana" : "Base or Ethereum"} wallet here first: it is what signs.`);
    step("Building the transaction for your wallet");
    const { built } = await home.buildSwap(id, linked.address);
    try {
      const tx = await signAndSend(linked.f, linked.address, built, step);
      await home.sentSwap(id, tx);
    } catch (e) {
      await home.unsentSwap(id, (e as Error).message).catch(() => undefined);
      throw e;
    }
    reload();
  };
  return { found, linked, busy, said, connect, forget, sign };
}
