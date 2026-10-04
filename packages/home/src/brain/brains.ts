// The brains after ChatGPT (PLAN 1.11): one Google Gemini API key, and a local coder. ChatGPT is
// its own (chatgpt/), and the preset's key, when the home has one, is the brain a router or a test
// gives it. This file keeps the other two and builds the order (chain.ts).
//
//   the Gemini key    in the OS keychain, like ChatGPT's tokens (chatgpt/store.ts), never in a file
//                     the home writes, an event, a trace or the door; checked before it is kept,
//                     by listing the models it may use, and the newest flash among them is picked
//   the local coder   where it listens and which model, in `brains.json` (no secret in it)
//
// Gemini speaks the OpenAI protocol at its `/v1beta/openai` root, so the same calls serve it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultStore, type SecretStore } from "../chatgpt/store.ts";
import { BrainChain, type Link } from "./chain.ts";
import type { Endpoint } from "./openai.ts";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
/** What answers when the key's model list could not be read: a flash every free key has had. */
export const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash";
const KEY = "orbs.gemini";
const SEARCH_KEY = "orbs.tavily";
export const TAVILY_BASE = "https://api.tavily.com";

/** The newest plain flash a key may use ("gemini-3.8-flash" over "-lite" and "-preview"). */
export function pickGeminiModel(ids: string[]): string {
  const flash = ids
    .map((id) => id.replace(/^models\//, ""))
    .map((id) => ({ id, v: /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(id)?.[1] }))
    .filter((x): x is { id: string; v: string } => x.v !== undefined)
    .sort((a, b) => Number(b.v) - Number(a.v));
  return flash[0]?.id ?? GEMINI_FALLBACK_MODEL;
}

export class KeyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRefusedError";
  }
}

export type LocalCoder = { baseUrl: string; model: string };
type Saved = { gemini?: { model: string }; local?: LocalCoder; search?: true };

export type BrainsOptions = {
  dataDir: string;
  store?: SecretStore;
  /** Gemini's API root (a test points it at a fake). */
  geminiBase?: string;
  /** Tavily's API root, for web search (a test points it at a fake). */
  tavilyBase?: string;
  /** The preset's own big brain, when the home has one: after Gemini, before the local coder. */
  presetKey?: Endpoint | null;
  /** ChatGPT's endpoint now (null when signed out or paused at its limit). */
  chatgpt: () => Endpoint | null;
  clock?: () => number;
};

export class Brains {
  readonly chain: BrainChain;
  readonly #o: BrainsOptions;
  #saved: Saved;
  #geminiKey: string | null = null;
  #store: Promise<SecretStore> | null = null;

  constructor(o: BrainsOptions) {
    this.#o = o;
    this.#saved = Brains.#read(o.dataDir);
    const links: Link[] = [
      { id: "chatgpt", label: "ChatGPT", endpoint: o.chatgpt, setup: "sign in with ChatGPT (/chatgpt)" },
      { id: "gemini", label: "Gemini", endpoint: () => this.#gemini(), setup: "add a Gemini API key in Settings" },
    ];
    if (o.presetKey) links.push({ id: "key", label: "my other brain", endpoint: () => o.presetKey ?? null, setup: "choose a brain in Settings" });
    links.push({ id: "local", label: "the local coder", endpoint: () => this.#local(), setup: "start a local coder (Ollama or llama-server) and add it in Settings" });
    this.chain = new BrainChain(links, o.clock);
  }

  static #read(dir: string): Saved {
    const f = join(dir, "brains.json");
    if (!existsSync(f)) return {};
    try {
      return JSON.parse(readFileSync(f, "utf8")) as Saved;
    } catch {
      return {};
    }
  }

  #write(): void {
    writeFileSync(join(this.#o.dataDir, "brains.json"), `${JSON.stringify(this.#saved, null, 2)}\n`, { mode: 0o600 });
  }

  #storeP(): Promise<SecretStore> {
    this.#store ??= this.#o.store ? Promise.resolve(this.#o.store) : defaultStore(this.#o.dataDir);
    return this.#store;
  }

  /** Reads the Gemini key from the keychain, once, when there is a saved Gemini to read it for. */
  async load(): Promise<void> {
    if (!this.#saved.gemini) return;
    this.#geminiKey = await (await this.#storeP()).get(KEY);
  }

  #gemini(): Endpoint | null {
    if (!this.#geminiKey || !this.#saved.gemini) return null;
    return { name: "gemini", baseUrl: this.#o.geminiBase ?? GEMINI_BASE, apiKey: this.#geminiKey, model: this.#saved.gemini.model, retries: 0 };
  }

  #local(): Endpoint | null {
    const l = this.#saved.local;
    // a local coder costs nothing; the price says so where it reports no cost
    return l ? { name: "local coder", baseUrl: l.baseUrl, model: l.model, retries: 0, price: { inputPerM: 0, outputPerM: 0 } } : null;
  }

  /** Checks a Gemini key by listing the models it may use, then keeps it (the keychain) and the
   * newest flash it may use (brains.json). A refused key is never kept. */
  async setGemini(key: string, fetcher: typeof fetch = fetch): Promise<{ model: string }> {
    const k = key.trim();
    // Google's keys were AIza and letters; AI Studio now makes "AQ." keys (auth keys, with a dot;
    // owner 10-03: "That doesn't look like a Gemini API key. when it is"). Both go as a Bearer to
    // the OpenAI-compatible root, the one way Google takes an AQ. key (a ?key= refuses one).
    if (!/^[\w.-]{20,}$/.test(k)) throw new KeyRefusedError("That doesn't look like a Gemini API key (they start with AIza or AQ.).");
    let res: Response;
    try {
      res = await fetcher(`${this.#o.geminiBase ?? GEMINI_BASE}/models`, { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new KeyRefusedError("Gemini could not be reached to check the key. Try again in a moment.");
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new KeyRefusedError("Gemini refused that key.");
    let model = GEMINI_FALLBACK_MODEL;
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      model = pickGeminiModel((j.data ?? []).map((m) => String(m.id ?? "")));
    }
    await (await this.#storeP()).set(KEY, k);
    this.#geminiKey = k;
    this.#saved = { ...this.#saved, gemini: { model } };
    this.#write();
    return { model };
  }

  /** The person's Tavily key, for the researchers' web search (PLAN 3.10): kept like the Gemini
   * key, in the keychain, never in a file. Checked for its shape; Tavily says if it refuses it. */
  async setSearch(key: string): Promise<void> {
    const k = key.trim();
    if (!/^tvly-[\w-]{10,}$/.test(k)) throw new KeyRefusedError("That doesn't look like a Tavily key (they start with tvly-).");
    await (await this.#storeP()).set(SEARCH_KEY, k);
    this.#saved = { ...this.#saved, search: true };
    this.#write();
  }

  async clearSearch(): Promise<void> {
    await (await this.#storeP()).delete(SEARCH_KEY);
    const { search: _, ...rest } = this.#saved;
    this.#saved = rest;
    this.#write();
  }

  /** The search key and where it is used, read from the keychain only when a search needs it. */
  async searchKey(): Promise<{ key: string; base: string } | null> {
    if (!this.#saved.search) return null;
    const k = await (await this.#storeP()).get(SEARCH_KEY);
    return k ? { key: k, base: this.#o.tavilyBase ?? TAVILY_BASE } : null;
  }

  async clearGemini(): Promise<void> {
    await (await this.#storeP()).delete(KEY);
    this.#geminiKey = null;
    const { gemini: _, ...rest } = this.#saved;
    this.#saved = rest;
    this.#write();
  }

  setLocal(l: LocalCoder | null): void {
    if (l && !/^https?:\/\/[^\s]+\/v1\/?$/.test(l.baseUrl)) throw new Error("the local coder's address must end in /v1");
    const { local: _, ...rest } = this.#saved;
    this.#saved = l ? { ...rest, local: { baseUrl: l.baseUrl.replace(/\/$/, ""), model: l.model } } : rest;
    this.#write();
  }

  /** For Settings and the door: each brain, in order, and where it stands. Never a key. */
  status(): { order: ReturnType<BrainChain["states"]>; gemini: { model: string } | null; local: LocalCoder | null; search: boolean } {
    return { order: this.chain.states(), gemini: this.#saved.gemini && this.#geminiKey ? { model: this.#saved.gemini.model } : null, local: this.#saved.local ?? null, search: Boolean(this.#saved.search) };
  }
}
