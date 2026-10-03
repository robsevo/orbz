// A demo crew (owner, 2026-10-01: "we should start with only 1 orb, the one we make at the
// beginning"): an office starts with the orb you make in the first open, and this crew is only
// for looking round a preview (Settings fills a preview's office with it) and for the render
// checks, which seed it.
import { ASH, type Character } from "./spec.ts";

export const DEMO_CREW: Character[] = [
  ASH,
  { name: "Oscar", personality: "dapper", specialty: "backend", seed: 11, hue: "iris", hue2: null, finish: "glass", shape: "pebble", eyes: "ovals", hat: "top hat", glasses: "monocle", voice: "bm_fable", goo: 0.3 },
  { name: "Luna", personality: "dreamy", specialty: "design", seed: 12, hue: "teal", hue2: "lavender", finish: "glass", shape: "ghost", eyes: "huge", hat: "antenna", glasses: "cat-eye", voice: "af_sky", goo: 0.9 },
  { name: "Daisy", personality: "cheerful", specialty: "frontend", seed: 13, hue: "rose", hue2: null, finish: "pearl", shape: "teddy", eyes: "big", hat: "bow", glasses: "hearts", voice: "af_bella", goo: 0.75 },
  { name: "Milo", personality: "curious", specialty: "research", seed: 14, hue: "lime", hue2: null, finish: "glass", shape: "drop", eyes: "big", hat: "sprout", glasses: "big round", voice: "am_puck", goo: 0.6 },
  { name: "Theo", personality: "sleepy", specialty: "data", seed: 15, hue: "violet", hue2: null, finish: "smoke", shape: "kitty", eyes: "droopy", hat: "headphones", glasses: "none", voice: "af_sky", goo: 0.65 },
  { name: "Hazel", personality: "wise", specialty: "planning", seed: 16, hue: "honey", hue2: null, finish: "glass", shape: "moon", eyes: "close", hat: "crown", glasses: "reading", voice: "bm_george", goo: 0.35 },
  { name: "Rosie", personality: "cozy", specialty: "assistant", seed: 17, hue: "leaf", hue2: null, finish: "glass", shape: "cloud", eyes: "classic", hat: "beanie", glasses: "none", voice: "af_heart", goo: 0.8 },
  { name: "Benny", personality: "silly", specialty: "fullstack", seed: 18, hue: "coral", hue2: "marigold", finish: "glass", shape: "bean", eyes: "big", hat: "party hat", glasses: "stars", voice: "am_puck", goo: 0.85 },
  { name: "June", personality: "shy", specialty: "writing", seed: 19, hue: "orchid", hue2: null, finish: "pearl", shape: "drop", eyes: "droopy", hat: "flower", glasses: "round", voice: "af_aoede", goo: 0.6 },
  { name: "Nico", personality: "techy", specialty: "testing", seed: 20, hue: "amber", hue2: null, finish: "glass", shape: "squircle", eyes: "dots", hat: "none", glasses: "goggles", voice: "am_michael", goo: 0.45 },
  { name: "Ada", personality: "dapper", specialty: "accountant", seed: 22, hue: "jade", hue2: null, finish: "glass", shape: "egg", eyes: "beans", hat: "eyeshade", glasses: "half-rims", voice: "bf_emma", goo: 0.35 },
  { name: "Cal", personality: "brave", specialty: "trainer", seed: 23, hue: "apricot", hue2: null, finish: "neon", shape: "blob", eyes: "wide", hat: "sweatband", glasses: "sport", voice: "am_fenrir", goo: 0.7 },
  { name: "Gus", personality: "grumpy", specialty: "devops", seed: 21, hue: "mint", hue2: null, finish: "black", shape: "cub", eyes: "beans", hat: "hard hat", glasses: "shades", voice: "am_fenrir", goo: 0.4 },
];
