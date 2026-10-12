// The desk on a real home (PLAN 5.22-5.27; owner, 10-10: "We can connect the users wallet there too"; "any wallet, like
// metamask or wtv. phantom etc."), on a stand-in market, stand-in DEX routers and stand-in chains, with a
// stand-in EVM wallet (EIP-6963) and a stand-in Solana wallet (the Wallet Standard) in the page:
//   - the floor, its crew at work, the tape, the chart: nothing spilling at desk and phone sizes, every tab;
//   - a strategy backtested, kept and run on paper by one of the desk's orbs, from the page;
//   - a wallet connected for its address only, its holdings read from its chains;
//   - your own swap on Base: quoted, then signed by the wallet, which is first asked to add Base and to allow exactly
//     the amount; followed to the chain's yes;
//   - an orb's trade waits for your yes (the floor, PLAN rule 9), approved and signed, or denied; a wallet that refuses
//     to sign leaves it waiting, built again on the next yes;
//   - a swap on Solana signed by the Solana wallet.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";
import { standInChains, standInMarket, standInRouters } from "../../home/test/fakes/market.ts";
import { EVM_TOKEN, MINT, standInDexFetch } from "../../home/test/fakes/dex.ts";
import { publicDex } from "../../home/src/desk/dex.ts";
import { keptBy, TURNS } from "../src/floor/props.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-desk-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes: number[]): string {
  let n = 0n;
  for (const x of bytes) n = n * 256n + BigInt(x);
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  return out;
}
const EVM = `0x${"5a".repeat(20)}`; // the stand-in wallet's address, as a wallet gives it (lower case)
const SOL = b58(Array.from({ length: 32 }, (_, i) => i + 1));

/** The page's wallets: an EVM one announcing itself by EIP-6963 (on Ethereum, not knowing Base yet) and a Solana one
 * registered by the Wallet Standard. Everything each is asked is written to `window.__wallet` for the test to read. */
function wallets(o: { evm: string; sol: string }): void {
  type Ask = { method: string; params?: unknown };
  const w = window as unknown as Window & { __wallet: { evm: Ask[]; sol: unknown[]; refuse: boolean; added: boolean } };
  w.__wallet = { evm: [], sol: [], refuse: false, added: false };
  let chainId = "0x1";
  let sent = 0;
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      w.__wallet.evm.push({ method, params });
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [o.evm];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        const want = (params![0] as { chainId: string }).chainId;
        if (want !== "0x1" && !w.__wallet.added) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
        chainId = want;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        w.__wallet.added = true;
        chainId = (params![0] as { chainId: string }).chainId;
        return null;
      }
      if (method === "eth_sendTransaction") {
        if (w.__wallet.refuse) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        sent += 1;
        return `0x${sent.toString(16).padStart(64, "0")}`;
      }
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      throw Object.assign(new Error(`no ${method}`), { code: 4200 });
    },
  };
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Ccircle cx='4' cy='4' r='4' fill='%23f6851b'/%3E%3C/svg%3E";
  window.addEventListener("eip6963:requestProvider", () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "7e57-wallet", name: "Test Wallet", icon, rdns: "test.wallet" }, provider }) })));
  const account = { address: o.sol, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: [] };
  const sol = {
    version: "1.0.0", name: "Test Sol", icon, chains: ["solana:mainnet"], accounts: [] as (typeof account)[],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((sol.accounts = [account]), w.__wallet.sol.push("connect"), { accounts: [account] }) },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: async (...inputs: { account: { address: string }; transaction: Uint8Array; chain: string }[]) => {
          w.__wallet.sol.push({ from: inputs[0]!.account.address, bytes: [...inputs[0]!.transaction], chain: inputs[0]!.chain });
          // a signature of its own for every transaction, as a wallet's is (the home keeps each hash once)
          return inputs.map(() => ({ signature: new Uint8Array(64).fill(7 + w.__wallet.sol.length) }));
        },
      },
    },
  };
  const register = (api: { register: (...w: unknown[]) => unknown }): void => void api.register(sol);
  window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

test("the desk: the floor and its tabs at desk and phone sizes; a strategy kept and run on paper; wallets connected; swaps signed by the wallet, an orb's only after your yes", { skip, timeout: 300_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-desk-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const chains = standInChains({
    eth_call: () => "0x0", // no allowance yet, and no tokens held
    eth_getBalance: () => "0xde0b6b3a7640000", // 1 ETH
    eth_getTransactionReceipt: () => ({ status: "0x1" }),
    getSignatureStatuses: () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getBalance: () => ({ value: 2_000_000_000 }),
    getTokenAccountsByOwner: () => ({ value: [] }),
    // any coin (PLAN 5.28): the pump.fun mint's decimals, and its mint with no authority left
    getTokenSupply: (p) => (p[0] === MINT ? { value: { decimals: 6, amount: "1", uiAmountString: "1" } } : null),
    getAccountInfo: () => ({ value: { data: { parsed: { type: "mint", info: { decimals: 6, mintAuthority: null, freezeAuthority: null } } } } }),
  });
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    desk: { on: true, source: standInMarket(() => Date.now()), routers: standInRouters({ outPer: () => 0.0004 }), fetch: chains, dex: publicDex({ fetch: standInDexFetch() }) },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("max", "Max", "ceo", { shape: "bean", eyes: "classic", hue: "honey" });
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "egg", eyes: "classic", hue: "mint" });
  for (const [id, name, sp, hue] of [["vic", "Vic", "deskhead", "lime"], ["kit", "Kit", "dealer", "amber"], ["quinn", "Quinn", "quant", "violet"], ["oz", "Oz", "onchain", "teal"], ["rae", "Rae", "risk", "coral"]] as const) {
    h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  }
  for (const turn of TURNS) h.about.keep(keptBy(turn)); // the floor open, as its turns leave it
  const opened: string[] = []; // the links the home opened in "this machine's browser"
  const d = await serve(h, { port: 0, appDir: dist, opener: async (url) => void opened.push(url) });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    await ctx.addInitScript(wallets, { evm: EVM, sol: SOL });
    const page = await ctx.newPage();
    await page.goto(d.pairLink().replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate(() => (location.hash = "#/desk"));
    await page.locator("[data-desk-room]").waitFor({ timeout: 30_000 });
    await page.locator('[data-market-status="live"]').waitFor({ timeout: 30_000 });
    return page;
  };
  const tab = async (p: Page, k: string): Promise<void> => {
    await p.locator(`[data-desk-tab="${k}"]`).click();
    await p.waitForTimeout(600);
  };

  const page = await open({ width: 1280, height: 1000 });
  // the floor: its crew on it (and only its crew), the tape going by, the war room's screen; no chart under it (owner,
  // 10-11: "no chart on bottom of page, only if user presses the electronic chart in war room")
  await page.waitForFunction(() => document.querySelectorAll("[data-desk-orb]").length === 5, null, { timeout: 20_000 });
  assert.deepEqual((await page.locator("[data-desk-orb]").evaluateAll((els) => els.map((e) => e.getAttribute("data-desk-orb")))).sort(), ["Kit", "Oz", "Quinn", "Rae", "Vic"]);
  await page.locator("[data-war-screen]").waitFor();
  assert.equal(await page.locator("[data-candles]").count(), 0, "no chart on the page");
  assert.ok((await page.locator("[data-tick]").count()) >= 5, "the tape");
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await measure(page), [], "the floor, at desk size");

  // a strategy: backtested, kept, run on paper by Kit
  await tab(page, "strategies");
  await page.locator("[data-backtest]").click();
  await page.locator("[data-backtest-result]").waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "a backtest, at desk size");
  await page.locator("[data-save-strategy]").click();
  await page.locator("[data-strategy]").waitFor();
  const id = Number(await page.locator("[data-strategy]").getAttribute("data-strategy"));
  await page.getByLabel("Run it on paper by").selectOption("kit");
  await page.locator(`[data-run="${id}"]`).click();
  await page.locator("[data-running]").waitFor();
  assert.ok(h.desk.books().some((b) => b.strategy === id && b.orb === "kit" && b.state === "live"), "Kit runs it, on paper");

  // Connect wallet (owner, 10-11: "how does the user connect their wallet? i dont see any way?"; "I dont see the wallet
  // trying to connect at all when we say connect wallet"): this browser has two, so its sheet lists both; one picked,
  // its own window asks, and the header says its address
  assert.equal((await page.locator("[data-connect-wallet]").innerText()).trim(), "Connect wallet");
  await page.locator("[data-connect-wallet]").click();
  await page.locator("[data-wallet-sheet]").waitFor();
  assert.deepEqual(await page.locator("[data-wallet-pick]").evaluateAll((els) => els.map((e) => e.getAttribute("data-wallet-pick"))), ["Test Wallet", "Test Sol"]);
  await page.locator('[data-wallet-pick="Test Wallet"]').click();
  await page.locator("[data-wallet-sheet]").waitFor({ state: "detached" });
  await page.locator("[data-connect-wallet]", { hasText: "0x5a5a" }).waitFor();
  // a window with no wallet in it (Orbz's own is a browser profile of its own): your browser opened by the home, signed
  // in and on the Trade tab, where your wallet is; a link to copy for a wallet app's browser
  const bare = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => bare.close());
  const win = await bare.newPage();
  await win.goto(d.pairLink().replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
  await win.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await win.evaluate(() => (location.hash = "#/desk/trade"));
  await win.locator("[data-no-wallet]").waitFor({ timeout: 30_000 });
  await win.locator("[data-open-browser]").click();
  await win.locator("[data-elsewhere]", { hasText: "Opened in your browser" }).waitFor();
  assert.equal(opened.length, 1, "one browser opened, by the home");
  assert.match(opened[0]!, /^http:\/\/127\.0\.0\.1:\d+\/app\/orbs\.html#pair=[\w-]+&to=%2Fdesk%2Ftrade$/);
  await win.locator("[data-copy-link]").click();
  assert.match(await win.locator("[data-elsewhere-link]").innerText(), /#pair=[\w-]+&to=%2Fdesk%2Ftrade$/, "a link to open where the wallet is");
  // its Connect wallet: the sheet says the same, as there is no wallet here to open
  await win.locator("[data-connect-wallet]").click();
  await win.locator("[data-wallet-sheet] [data-no-wallet]").waitFor();
  await win.keyboard.press("Escape");
  await win.locator("[data-wallet-sheet]").waitFor({ state: "detached" });
  const yours = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => yours.close());
  await yours.addInitScript(wallets, { evm: EVM, sol: SOL });
  // this browser remembers another tab of the desk: the link's place is still the one it opens on
  await yours.addInitScript(() => globalThis.localStorage.setItem("orbs.desk.tab", "books"));
  const there = await yours.newPage();
  await there.goto(opened[0]!.replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
  await there.locator('[data-desk-tab="trade"][aria-selected="true"]').waitFor({ timeout: 30_000 });
  await there.locator('[data-wallet-found="Test Wallet"]').waitFor();
  assert.equal(await there.evaluate(() => location.hash), "#/desk/trade", "signed in by the link, at the place it was made for");
  // the control: a link made for no place opens on the home page, as it always has
  const plain = await yours.newPage();
  await plain.goto(d.pairLink().replace("orbs.html#", "orbs.html?splash=0&intro=0#"));
  await plain.waitForFunction(() => location.hash === "#/home", null, { timeout: 30_000 });

  // the wallets in this browser, each connected for its address only: the one the header connected, said so here too
  await tab(page, "trade");
  await page.locator('[data-wallet-found="Test Sol"]').waitFor();
  await page.locator('[data-wallet-found="Test Wallet"]', { hasText: "0x5a5a" }).waitFor();
  const asked = async (): Promise<{ method: string; params?: unknown[] }[]> => page.evaluate(() => (window as unknown as { __wallet: { evm: { method: string; params?: unknown[] }[] } }).__wallet.evm);
  assert.deepEqual((await asked()).map((a) => a.method), ["eth_requestAccounts"], "connecting asks for the address, and nothing else");
  const evmWallet = h.wallets.list().find((w) => w.address.toLowerCase() === EVM)!;
  assert.ok(evmWallet, "the home keeps its address");
  await page.locator(`[data-holdings="${evmWallet.id}"]`).click();
  await page.locator(`[data-holdings-of="${evmWallet.id}"]`, { hasText: "ETH" }).waitFor({ timeout: 20_000 });

  // your own swap on Base: a quote, then the wallet signs (Base added, exactly the amount allowed, then the swap)
  await page.getByLabel("How much USDC to sell").fill("50");
  await page.locator("[data-quote]").click();
  await page.locator("[data-quote-result]", { hasText: "About 0.02 ETH" }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "the wallets and a quote, at desk size");
  await page.locator("[data-swap-go]").click();
  await page.waitForFunction(() => (window as unknown as { __wallet: { evm: { method: string }[] } }).__wallet.evm.filter((a) => a.method === "eth_sendTransaction").length === 2, null, { timeout: 20_000 });
  const sends = (await asked()).filter((a) => a.method === "eth_sendTransaction").map((a) => a.params![0] as { from: string; to: string; data: string });
  assert.ok((await asked()).some((a) => a.method === "wallet_addEthereumChain" && (a.params![0] as { chainId: string }).chainId === "0x2105"), "a wallet that does not know Base is asked to add it");
  assert.match(sends[0]!.data, /^0x095ea7b3/, "the allowance first");
  assert.equal(sends[1]!.to, "0x1111111111111111111111111111111111111111", "then the swap, to the router the home's route named");
  assert.ok(sends.every((s) => s.from === EVM));
  const mine = h.swaps.list().find((s) => s.orb === null)!;
  await page.waitForFunction((id) => document.querySelector(`[data-swap="${id}"]`)?.getAttribute("data-state") === "sent", mine.id, { timeout: 20_000 });
  await h.swaps.due();
  await page.locator(`[data-swap="${mine.id}"][data-state="confirmed"]`).waitFor({ timeout: 20_000 });

  // an orb's trade waits for your yes: approved and signed
  const ask = await h.swaps.ask({ by: "kit", chain: "base", sell: "USDC", buy: "ETH", amount: "20", why: "a breakout on the hour" });
  await page.locator(`[data-swap-asked="${ask.id}"]`, { hasText: "Kit asks" }).waitFor({ timeout: 20_000 });
  assert.equal(h.swaps.get(ask.id)!.state, "asked", "nothing happens before your yes");
  // the wallet refuses to sign: it waits, approved, to be built again
  await page.evaluate(() => ((window as unknown as { __wallet: { refuse: boolean } }).__wallet.refuse = true));
  await page.locator(`[data-approve-swap="${ask.id}"]`).click();
  await page.getByRole("alert").filter({ hasText: "User rejected" }).waitFor({ timeout: 20_000 });
  assert.equal(h.swaps.get(ask.id)!.state, "approved", "refused by the wallet: approved, not sent");
  // signed when built again (yours, from the swaps list, as any approved one)
  await page.evaluate(() => ((window as unknown as { __wallet: { refuse: boolean } }).__wallet.refuse = false));
  const before = (await asked()).filter((a) => a.method === "eth_sendTransaction").length;
  const built = await h.swaps.build(ask.id, EVM);
  assert.equal(built.built.kind, "evm");
  assert.equal((await asked()).filter((a) => a.method === "eth_sendTransaction").length, before, "the home builds; only the wallet sends");
  // denied
  const no = await h.swaps.ask({ by: "kit", chain: "base", sell: "USDC", buy: "ETH", amount: "10", why: "a dip" });
  await page.locator(`[data-deny-swap="${no.id}"]`).click();
  await page.locator(`[data-swap="${no.id}"][data-state="denied"]`).waitFor({ timeout: 20_000 });

  // Solana: the Solana wallet connected, its swap signed by it
  await page.locator('[data-wallet-found="Test Sol"]').click();
  await page.locator('[data-wallet-found="Test Sol"]', { hasText: SOL.slice(0, 4) }).waitFor();
  await page.locator("[data-trade-chain]").selectOption("solana");
  await page.locator('[data-trade-sell="USDC"]').waitFor();
  await page.getByLabel("How much USDC to sell").fill("10");
  await page.locator("[data-quote]").click();
  await page.locator("[data-quote-result]").waitFor({ timeout: 20_000 });
  await page.locator("[data-swap-go]").click();
  await page.waitForFunction(() => (window as unknown as { __wallet: { sol: unknown[] } }).__wallet.sol.length >= 2, null, { timeout: 20_000 });
  const signed = (await page.evaluate(() => (window as unknown as { __wallet: { sol: unknown[] } }).__wallet.sol))[1] as { from: string; bytes: number[]; chain: string };
  assert.deepEqual(signed, { from: SOL, bytes: [1, 0, 1], chain: "solana:mainnet" }, "the transaction the home built, signed by the Solana wallet for its own address");
  const onSol = h.swaps.list().find((s) => s.chain === "solana")!;
  await page.waitForFunction((id) => document.querySelector(`[data-swap="${id}"]`)?.getAttribute("data-state") === "sent", onSol.id, { timeout: 20_000 });
  await h.swaps.due();
  await page.locator(`[data-swap="${onSol.id}"][data-state="confirmed"]`).waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "the trades, at desk size");

  // the war room's screen (owner, 10-11: "user can press the chart in war room (electronic one) and a chart opens over
  // (modal i guess) with a search bar on top of it ... user can input the contract address and view the coin + trade
  // manually or send a certain orb to trade it"): what trends, a pump.fun coin by its address, its chart and numbers, a
  // swap signed by the Solana wallet, and Kit sent to it on paper, walking to the screen
  await page.locator("[data-war-screen]").click();
  await page.locator("[data-token-desk]").waitFor();
  await page.locator("[data-trending] [data-token-row]").first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.locator("[data-trending] [data-token-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-token-row"))), [`solana:${MINT}`], "what trends on Solana, each coin once");
  await page.locator("[data-token-search]").fill(MINT);
  await page.locator(`[data-token-page="solana:${MINT}"]`).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("[data-token-search]").inputValue(), "", "the address opened its coin; the search is ready again");
  await page.locator("[data-token-page] [data-candles]").waitFor({ timeout: 20_000 });
  assert.match(await page.locator("[data-token-price]").innerText(), /^\$0\.16/);
  assert.match(await page.locator("[data-token-quick]").innerText(), /^MC \$164\.00M · Liq \$8\.00M · Vol \$2\.00M$/);
  await page.locator("[data-safety]", { hasText: "Nothing found against it" }).waitFor({ timeout: 20_000 });
  await page.locator("[data-trade-row]").first().waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(page), [], "a coin's page, at desk size");
  await page.locator("[data-swap-token]", { hasText: "Test Sol" }).waitFor({ timeout: 10_000 });
  await page.locator('[data-preset="0.5"]').click();
  await page.locator("[data-token-quote]", { hasText: "≈" }).waitFor({ timeout: 20_000 });
  const signs = await page.evaluate(() => (window as unknown as { __wallet: { sol: unknown[] } }).__wallet.sol.length);
  await page.locator("[data-swap-token]").click();
  await page.waitForFunction((n) => (window as unknown as { __wallet: { sol: unknown[] } }).__wallet.sol.length > n, signs, { timeout: 20_000 });
  await page.locator("[data-token-trade] [role=status]", { hasText: "Sent:" }).waitFor({ timeout: 20_000 });
  const coin = h.swaps.list().find((x) => x.buy === MINT)!;
  assert.deepEqual([coin.chain, coin.sell, coin.amount], ["solana", "SOL", "0.5"], "the coin kept by its address, your own swap signed by your wallet");
  await page.locator("select[data-send-who]").selectOption("Kit");
  await page.locator("[data-send-go]").click();
  await page.locator("[data-sent]", { hasText: /^Kit has Fartcoin, up to \$100, on paper\./ }).waitFor({ timeout: 10_000 });
  assert.ok(h.events.ofType("desk.sent").some((e) => e.orb === "kit" && e.data.mode === "paper" && e.data.label === "Fartcoin"), "Kit sent, on paper");
  await page.locator("[data-token-close]").click();
  await page.locator("[data-token-desk]").waitFor({ state: "detached" });
  await page.locator('[data-desk-orb="Kit"][data-at="poi:whiteboard"]').waitFor({ timeout: 20_000 });

  // your wallets' worth (owner, 10-11: "users can see wallet balance and analytics as well"): what the wallets kept hold,
  // valued, how it is spread; a coin pressed opens on the war room's screen
  await tab(page, "trade");
  await page.locator("[data-worth-total]").waitFor({ timeout: 30_000 });
  assert.match(await page.locator("[data-worth-total]").innerText(), /^\$[\d,]+\.\d\d$/);
  await page.locator("[data-spread]").waitFor();
  const wsol = "solana:So11111111111111111111111111111111111111112";
  await page.locator(`[data-coin="${wsol}"]`).click();
  await page.locator(`[data-token-page="${wsol}"]`).waitFor({ timeout: 20_000 });
  await page.locator("[data-token-close]").click();
  await page.locator("[data-token-desk]").waitFor({ state: "detached" });
  // each orb's P&L (owner, 10-11: "each orb pnl"): a paper trade of Kit's closed, its card says so
  await h.desk.paperTrade("kit", "BTC", "buy", 100);
  await h.desk.paperTrade("kit", "BTC", "sell", 1_000);
  // on the wallet's dashboard too (owner, 10-11: "a wallet dashboard also where like we said we can see the orbs pnl")
  await page.locator('[data-orbs-glance] [data-orb-glance="Kit"]').waitFor({ timeout: 20_000 });
  await page.locator("[data-orbs-more]").click();
  await page.locator('[data-desk-tab="desk"][aria-selected="true"]').waitFor();
  await page.locator('[data-orb-pnl="Kit"]', { hasText: /\d+ trades/ }).waitFor({ timeout: 20_000 });
  assert.match(await page.locator('[data-orb-pnl="Kit"] [data-pnl]').innerText(), /^[+−]\$[\d,]+\.\d\d/);
  assert.match(await page.locator("[data-desk-pnl]").innerText(), /on paper, the whole desk/);
  assert.deepEqual(await measure(page), [], "each orb's P&L, at desk size");
  // an orb's account (owner, 10-11: "how do we alternate between paper and real? and we dont want the orbs to know the
  // difference. money is money"): Kit's made real money with a budget of $50, here, by you; then paper again
  const kit = page.locator('[data-account="kit"]');
  assert.equal(await kit.getAttribute("data-account-mode"), "paper");
  await kit.locator("[data-account-real]").click();
  await kit.locator("[data-account-budget]").fill("50");
  await kit.locator("[data-account-set]").click();
  await page.locator('[data-account="kit"][data-account-mode="real"]').waitFor({ timeout: 20_000 });
  assert.deepEqual([h.desk.account("kit").mode, h.desk.account("kit").budget], ["real", 50]);
  assert.match(await kit.locator("[data-account-words]").innerText(), /^Real money: \$50\.00 left of \$50\.00\. Each order Kit places comes to you for a yes/);
  assert.deepEqual(await measure(page), [], "an account of real money, at desk size");
  await kit.locator("[data-account-paper]").click();
  await page.locator('[data-account="kit"][data-account-mode="paper"]').waitFor({ timeout: 20_000 });
  assert.equal(h.desk.account("kit").mode, "paper");
  // its paper, as much as you say (owner, 10-11: "why cant we choose how much paper cash we have?")
  await kit.locator("[data-account-change-paper]").click();
  await kit.locator("[data-account-paper-amount]").fill("2500");
  await kit.locator("[data-account-set-paper]").click();
  await kit.locator("[data-account-words]", { hasText: "Paper: $2,500.00 of practice money" }).waitFor({ timeout: 20_000 });
  assert.equal(h.desk.account("kit").paper, 2_500);
  // a swap of any coin, by its address (owner, 10-11: "coin swap in general, not just pump.fun")
  await tab(page, "trade");
  await page.locator("[data-trade-chain]").selectOption("base");
  await page.locator("[data-trade-sell]").selectOption("USDC");
  await page.locator("[data-trade-buy]").selectOption("any");
  await page.locator("[data-trade-buy-at]").fill(EVM_TOKEN);
  await page.getByLabel("How much USDC to sell").fill("10");
  await page.locator("[data-quote]").click();
  await page.locator("[data-quote-result]", { hasText: "About" }).waitFor({ timeout: 20_000 });

  // every tab at phone size
  const phone = await open({ width: 390, height: 844 });
  // a phone: the floor a tab of its own, first and open; no chart under it
  await phone.locator('[data-desk-tab="floor"][aria-selected="true"]').waitFor();
  assert.equal(await phone.locator("[data-desk-tab]").first().getAttribute("data-desk-tab"), "floor");
  assert.equal(await phone.locator("[data-candles]").count(), 0);
  assert.deepEqual(await measure(phone), [], "the floor, at phone size");
  // the screen, the whole phone: a coin by its address, its chart, its swap asking for a Solana wallet and connecting it
  await phone.locator("[data-war-screen]").click();
  await phone.locator("[data-token-search]").fill(MINT);
  await phone.locator("[data-token-page] [data-candles]").waitFor({ timeout: 20_000 });
  assert.ok(Number(await phone.locator("[data-candles]").getAttribute("data-candles")) < 100, "a phone's chart: fewer bars, each readable");
  await phone.waitForTimeout(400);
  assert.deepEqual(await measure(phone), [], "a coin's page, at phone size");
  await phone.locator("[data-swap-connect]", { hasText: "Connect a Solana wallet" }).click();
  await phone.locator("[data-swap-token]", { hasText: "Test Sol" }).waitFor({ timeout: 10_000 });
  await phone.locator("[data-token-close]").click();
  for (const k of ["trade", "books", "strategies", "desk", "limits"]) {
    await tab(phone, k);
    await phone.evaluate(() => document.fonts.ready);
    assert.deepEqual(await measure(phone), [], `${k}, at phone size`);
  }
});
