// The first open (PLAN 2.5; owner, 2026-10-01: "when a user opens the app for the first time we
// want an onboarding process. a fun one, like what should we call you? backstory for the orbs,
// your their new CEO etc", and "we should start with only 1 orb, the one we make at the
// beginning"). It plays like the opening of a game. Your first orb wakes up on an empty office
// floor, still a plain glass bean with no name; he asks what to call you, makes you the office's
// CEO, and asks you to make him: his name, his look, what he is good at. The story is data, here,
// so a check can read every line; `Onboarding.tsx` plays it.
import type { Character } from "../orb/spec.ts";

export type Person = { name: string; since: number };

/** Who tells it: your first orb, before you have made him (a plain bean, no name yet). */
export const NEWBORN: Character = {
  name: "", personality: "steady", specialty: "general", seed: 7, hue: "azure", hue2: null, finish: "glass",
  shape: "bean", eyes: "classic", hat: "none", glasses: "none", voice: "am_michael", goo: 0.6,
};
/** What his nameplate says until he has a name. */
export const NEWBORN_PLATE = "Your first orb";

/** One beat. A line is said by an orb ("new" is the one you are about to make); `{name}` is you. */
export type Beat =
  | { kind: "say"; who: string; text: string }
  | { kind: "ask-name" }
  | { kind: "ceo" }
  | { kind: "brains" }
  | { kind: "hire" };

export const STORY: readonly Beat[] = [
  { kind: "say", who: "new", text: "Oh! Hello. I think I just woke up." },
  { kind: "say", who: "new", text: "I'm an orb: a little glass someone who lives on your computer and gets things done." },
  { kind: "say", who: "new", text: "Before anything else, what should I call you?" },
  { kind: "ask-name" },
  { kind: "say", who: "new", text: "{name}. Nice. That has a ring to it." },
  { kind: "say", who: "new", text: "So, here's the thing. This is an office. Right now it's an empty floor, a desk, and me." },
  { kind: "say", who: "new", text: "Every office needs someone at the top. So, {name}, if you'll take the job..." },
  { kind: "ceo" },
  { kind: "say", who: "new", text: "Congratulations, boss. You're the CEO. And I'm your first hire." },
  { kind: "say", who: "new", text: "Here's how it works. You hand me work, I do it, and anything that matters waits for your OK." },
  { kind: "say", who: "new", text: "And every night I practise, so I get quicker at the things you ask for most. You can hire more of us whenever you like." },
  // the brains (owner, 10-02: "after asking name and showing CEO badge, ask user to sign into chatgpt
  // and input gemini api key and if they want to add a local coder, then go to create orb screen")
  { kind: "say", who: "new", text: "First, though, I need a brain to think with. Give me one or two, and I'll use the first that can answer." },
  { kind: "brains" },
  { kind: "say", who: "new", text: "One problem: I don't have a name yet. Or a look. Or a thing I'm good at. Will you make me?" },
  { kind: "hire" },
];

/** The story for this office: a line is said only by one who is there (your first orb always is). */
export function storyFor(names: readonly string[]): Beat[] {
  return STORY.filter((b) => b.kind !== "say" || b.who === "new" || names.includes(b.who));
}

/** A line with the person in it. */
export const line = (text: string, p: Pick<Person, "name"> | null): string => text.replaceAll("{name}", p?.name ?? "boss");

/** The first beat a skip lands on: the name, if we have none yet, else the brains (setting up, not
 * story: skipping the story never skips choosing what he thinks with), else the hire. */
export function skipTo(person: Pick<Person, "name"> | null, story: readonly Beat[] = STORY): number {
  if (!person) return story.findIndex((b) => b.kind === "ask-name");
  const brains = story.findIndex((b) => b.kind === "brains");
  return brains >= 0 ? brains : story.findIndex((b) => b.kind === "hire");
}

/** What a name has to be: something to call you, short enough for a nameplate. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; why: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, why: "I need something to call you." };
  if (name.length > 24) return { ok: false, why: "A little shorter, for the nameplate (24 letters at most)." };
  return { ok: true, name };
}

// Remembered in the browser for now: a per-person convenience until the home keeps "about you"
// (PLAN 2.4), when this moves there.
const KEY = "orbs.person";

export function loadPerson(): Person | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") as Person | null;
    return v && typeof v.name === "string" && v.name ? v : null;
  } catch {
    return null;
  }
}

export function savePerson(p: Person): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // a private window: remembered for as long as the page is open
  }
}

/** `?intro=0` skips it (the render checks), the way `?splash=0` skips the splash. */
export const introWanted = (): boolean => {
  try {
    return new URLSearchParams(location.search).get("intro") !== "0";
  } catch {
    return true;
  }
};
