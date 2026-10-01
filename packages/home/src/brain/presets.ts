// Brain presets (PLAN 1.4): which endpoint each rung uses. The setup wizard (PLAN 2.5) offers them;
// "Continue with ChatGPT" joins them with PLAN 1.10.
//
//   local      the own brain on this computer (Ollama or llama-server), no big brain
//   one key    any OpenAI-compatible provider: a big model and a cheaper own model on one key
//   openrouter one key at OpenRouter, which reports each call's cost in the reply
//   ash-router this machine's router, FREE seats only (owner, 2026-09-30: cloud seats for now,
//              never the RX 580); the seats come from the bake-off's generated defaults file
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Endpoint } from "./openai.ts";

export type Preset = { id: string; title: string; own: Endpoint | null; big: Endpoint | null; teacher: Endpoint | null };

export class PresetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetError";
  }
}

const REPO = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
export const BAKEOFF_DEFAULTS = resolve(REPO, "docs", "bakeoff-defaults.json");

/** Seats verified free on 2026-09-30 by reading Ash's litellm.yaml (the spike's list): Gemini
 * free tier, the NVIDIA NIM trial, OpenRouter's :free models. Anything else may cost money. */
export const ASH_ROUTER_FREE_SEATS: readonly string[] = [
  "bedrock-brain", "think-brain", "cloud-brain", "free-flash", "free-flash25", "free-flash3",
  "nim-ultra", "free-coder", "free-ultra",
];

export function local(o: { model: string; baseUrl?: string }): Preset {
  return {
    id: "local",
    title: "Free, on this computer",
    own: { name: "own", baseUrl: o.baseUrl ?? "http://127.0.0.1:11434/v1", model: o.model, price: { inputPerM: 0, outputPerM: 0 } },
    big: null,
    teacher: null,
  };
}

export function oneKey(o: {
  baseUrl: string;
  apiKey: string;
  big: string;
  own?: string;
  price?: Endpoint["price"];
  extra?: Record<string, unknown>;
  title?: string;
}): Preset {
  const ep = (name: string, model: string): Endpoint => ({
    name, baseUrl: o.baseUrl, apiKey: o.apiKey, model,
    ...(o.price && { price: o.price }), ...(o.extra && { extra: o.extra }),
  });
  return {
    id: "one-key",
    title: o.title ?? "One key",
    own: ep("own", o.own ?? o.big),
    big: ep("big", o.big),
    teacher: ep("teacher", o.big),
  };
}

export function openRouter(o: { apiKey: string; big: string; own?: string }): Preset {
  return {
    ...oneKey({ baseUrl: "https://openrouter.ai/api/v1", apiKey: o.apiKey, big: o.big, own: o.own, extra: { usage: { include: true } } }),
    id: "openrouter",
    title: "One OpenRouter key",
  };
}

/** This machine's router, with the seats the bake-off picked. Refuses any seat not known to be
 * free, and turns the router's fallbacks off per request (a chain can end on a paid seat). */
export function ashRouter(o: { baseUrl?: string; defaultsFile?: string } = {}): Preset {
  const file = o.defaultsFile ?? BAKEOFF_DEFAULTS;
  let picks: Record<string, { seat?: unknown }>;
  try {
    picks = JSON.parse(readFileSync(file, "utf8")) as Record<string, { seat?: unknown }>;
  } catch (e) {
    throw new PresetError(`the bake-off defaults could not be read from ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const baseUrl = o.baseUrl ?? process.env.ORBS_ROUTER ?? "http://localhost:4000/v1";
  const seat = (role: string): Endpoint | null => {
    const s = picks[role]?.seat;
    if (s === undefined) return null;
    if (typeof s !== "string" || !ASH_ROUTER_FREE_SEATS.includes(s)) {
      throw new PresetError(`the ${role} seat ${JSON.stringify(s)} is not a known free seat; paid seats need the owner's OK per run`);
    }
    // Free seats cost nothing; the price says so where the router reports no cost (a streamed reply).
    return { name: `${role}:${s}`, baseUrl, model: s, extra: { disable_fallbacks: true }, price: { inputPerM: 0, outputPerM: 0 } };
  };
  return { id: "ash-router", title: "This machine's router (free seats only)", own: seat("own"), big: seat("big"), teacher: seat("teacher") };
}
