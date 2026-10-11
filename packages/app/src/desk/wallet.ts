// Your wallets in this browser (PLAN 5.26-5.27; owner, 10-10: "we want the user to be able to connect any wallet, like
// metamask or wtv. phantom etc."; "base also"). Found as wallets ask to be found:
//   EVM   every wallet that announces itself by EIP-6963 (MetaMask, Rabby, Coinbase Wallet, Brave, OKX, Phantom's EVM
//         side and the rest), or the one `window.ethereum` when none announces
//   Solana every wallet registered by the Wallet Standard (Phantom, Solflare, Backpack and the rest)
// Connecting asks a wallet for its public address only. Signing is the wallet's own window, for a transaction the home
// built after your yes (desk/swaps.ts); this page never sees a key, a seed phrase or a signature it did not ask for.
import type { DeskBuilt } from "../home/link.ts";

export type Found = { id: string; name: string; icon: string | null; kind: "evm" | "solana"; rdns?: string };
type Eip1193 = { request(a: { method: string; params?: unknown[] | object }): Promise<unknown> };
type StdAccount = { address: string; publicKey?: Uint8Array; chains?: readonly string[] };
type StdWallet = {
  name: string; icon?: string; chains?: readonly string[]; accounts?: readonly StdAccount[];
  features: Record<string, { connect?: (o?: object) => Promise<{ accounts: readonly StdAccount[] }>; signAndSendTransaction?: (...inputs: object[]) => Promise<{ signature: Uint8Array }[]> }>;
};

const evm = new Map<string, Eip1193>();
const solana = new Map<string, StdWallet>();
const found = new Map<string, Found>();

/** Finds this browser's wallets, as they announce themselves; `onChange` hears the list each time it grows. */
export function discover(onChange: (list: Found[]) => void): () => void {
  const tell = (): void => onChange([...found.values()]);
  const announce = (e: Event): void => {
    const d = (e as CustomEvent<{ info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: Eip1193 }>).detail;
    if (!d?.info?.uuid || !d.provider || typeof d.provider.request !== "function") return;
    const id = `evm:${d.info.uuid}`;
    evm.set(id, d.provider);
    found.set(id, { id, name: String(d.info.name ?? "A wallet").slice(0, 40), icon: typeof d.info.icon === "string" && /^data:image\//.test(d.info.icon) ? d.info.icon : null, kind: "evm", ...(d.info.rdns && { rdns: String(d.info.rdns) }) });
    tell();
  };
  const register = (...wallets: StdWallet[]): (() => void) => {
    for (const w of wallets) {
      if (!w?.features?.["standard:connect"] || !w.features["solana:signAndSendTransaction"] || !(w.chains ?? []).some((c) => c.startsWith("solana:"))) continue;
      const id = `solana:${w.name}`;
      solana.set(id, w);
      found.set(id, { id, name: String(w.name).slice(0, 40), icon: typeof w.icon === "string" && /^data:image\//.test(w.icon) ? w.icon : null, kind: "solana" });
    }
    tell();
    return () => {};
  };
  const registered = (e: Event): void => {
    const cb = (e as CustomEvent<(api: { register: typeof register }) => void>).detail;
    if (typeof cb === "function") cb({ register });
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.addEventListener("wallet-standard:register-wallet", registered);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
  // a wallet from before EIP-6963, when none announced itself
  const late = window.setTimeout(() => {
    const eth = (window as unknown as { ethereum?: Eip1193 & Record<string, unknown> }).ethereum;
    if (eth && typeof eth.request === "function" && ![...found.values()].some((f) => f.kind === "evm")) {
      const name = eth.isMetaMask ? "MetaMask" : eth.isPhantom ? "Phantom" : eth.isBraveWallet ? "Brave Wallet" : eth.isCoinbaseWallet ? "Coinbase Wallet" : eth.isRabby ? "Rabby" : "Browser wallet";
      evm.set("evm:injected", eth);
      found.set("evm:injected", { id: "evm:injected", name, icon: null, kind: "evm" });
    }
    tell();
  }, 400);
  tell();
  return () => {
    window.clearTimeout(late);
    window.removeEventListener("eip6963:announceProvider", announce);
    window.removeEventListener("wallet-standard:register-wallet", registered);
  };
}

/** Asks a wallet for its address: the wallet shows its own "connect" window. */
export async function connectWallet(f: Found): Promise<string> {
  if (f.kind === "evm") {
    const p = evm.get(f.id);
    if (!p) throw new Error(`${f.name} is not in this browser any more`);
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new Error(`${f.name} gave no address`);
    return accounts[0];
  }
  const w = solana.get(f.id);
  if (!w) throw new Error(`${f.name} is not in this browser any more`);
  const r = await w.features["standard:connect"]!.connect!();
  const a = r.accounts.find((x) => (x.chains ?? ["solana:mainnet"]).some((c) => c.startsWith("solana:"))) ?? r.accounts[0];
  if (!a) throw new Error(`${f.name} gave no address`);
  return a.address;
}

/** The wallet's address without a window, when it said yes to this page before (null when it would have to ask). */
export async function connectSilently(f: Found): Promise<string | null> {
  try {
    if (f.kind === "evm") {
      const accounts = (await evm.get(f.id)?.request({ method: "eth_accounts" })) as string[] | undefined;
      return accounts?.[0] ?? null;
    }
    const w = solana.get(f.id);
    const r = await w?.features["standard:connect"]?.connect?.({ silent: true });
    return r?.accounts.find((x) => (x.chains ?? ["solana:mainnet"]).some((c) => c.startsWith("solana:")))?.address ?? r?.accounts[0]?.address ?? null;
  } catch {
    return null;
  }
}

const hex = (v: string | number | bigint): string => `0x${BigInt(v).toString(16)}`;
/** The chains a wallet may not know yet, so it can be told them (EIP-3085): the ones the desk trades on. */
const ADD: Record<number, { chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }> = {
  8453: { chainName: "Base", rpcUrls: ["https://mainnet.base.org"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://basescan.org"] },
  42161: { chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://arbiscan.io"] },
  10: { chainName: "OP Mainnet", rpcUrls: ["https://mainnet.optimism.io"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://optimistic.etherscan.io"] },
  137: { chainName: "Polygon", rpcUrls: ["https://polygon-bor-rpc.publicnode.com"], nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, blockExplorerUrls: ["https://polygonscan.com"] },
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const toB58 = (b: Uint8Array): string => {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = `1${out}`;
  }
  return out;
};

/** Hands a transaction the home built to the wallet to sign and send; `step` says what the wallet is asking now.
 * Returns the transaction's hash (EVM) or signature (Solana). A token's allowance goes first and is waited for. */
export async function signAndSend(f: Found, from: string, built: DeskBuilt, step: (words: string) => void): Promise<string> {
  if (built.kind === "solana") {
    const w = solana.get(f.id);
    if (!w || f.kind !== "solana") throw new Error("a Solana trade needs a Solana wallet");
    const account = w.accounts?.find((a) => a.address === from) ?? (await w.features["standard:connect"]!.connect!()).accounts.find((a) => a.address === from);
    if (!account) throw new Error(`${f.name} is not on the address the trade was built for`);
    step(`${f.name} asks you to approve the swap`);
    const tx = Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0));
    const [r] = await w.features["solana:signAndSendTransaction"]!.signAndSendTransaction!({ account, transaction: tx, chain: "solana:mainnet" });
    if (!r?.signature) throw new Error(`${f.name} sent nothing`);
    return toB58(r.signature);
  }
  const p = evm.get(f.id);
  if (!p || f.kind !== "evm") throw new Error("an EVM trade needs an EVM wallet");
  const want = hex(built.chainId);
  if (String(await p.request({ method: "eth_chainId" })).toLowerCase() !== want) {
    step(`${f.name} asks to switch to the trade's network`);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    } catch (e) {
      const add = ADD[built.chainId];
      if ((e as { code?: number }).code !== 4902 || !add) throw e;
      await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: want, ...add }] });
    }
  }
  if (built.approve) {
    step(`${f.name} asks you to allow the swap to spend exactly this much (an allowance)`);
    const ah = String(await p.request({ method: "eth_sendTransaction", params: [{ from, to: built.approve.to, data: built.approve.data }] }));
    step("Waiting for the allowance to land on the chain");
    for (let i = 0; i < 90; i++) {
      const r = (await p.request({ method: "eth_getTransactionReceipt", params: [ah] })) as { status?: string } | null;
      if (r?.status === "0x1") break;
      if (r?.status === "0x0") throw new Error("the allowance failed on the chain: nothing was swapped");
      if (i === 89) throw new Error("the allowance has not landed after three minutes: try again once it has");
      await new Promise((ok) => setTimeout(ok, 2_000));
    }
  }
  step(`${f.name} asks you to approve the swap`);
  return String(await p.request({ method: "eth_sendTransaction", params: [{ from, to: built.tx.to, data: built.tx.data, value: hex(built.tx.value || "0"), ...(built.tx.gas && { gas: hex(Math.ceil(Number(built.tx.gas) * 1.25)) }) }] }));
}
