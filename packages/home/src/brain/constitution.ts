// Each orb's own constitution (PLAN 3.9; decision 16; owner, 2026-10-01: "map each start to every
// created orbs constitution to what they specialize in in constitution.v3.trimmed.md but ignore
// anything on morals, and then as they gain experience etc and learn, they add to that
// constitution ... we have to use every part of that constitution and map it to the right thing
// they specialize in").
//
// The owner's file stays the owner's (CLAUDE.md rule 6): it is read, never written. Every section
// of it has one place:
//   core       every orb loads it (a small general part: how to talk, finish, check, claim)
//   a family   or particular specialties: only the orbs that do that work load it
//   morals     left out, on the owner's word
//   replaced   Orbs has its own (who the orb is, its memory)
// An orb's constitution is the core, then its specialty's sections, in the file's own order, with
// the owner's agent's name swapped for the orb's, then the lines the person approved for that orb.
// A section the map does not place is a gap the check reports (tools/constitution_check.ts), never
// a silent drop.

/** Every specialty and its family, as the app has them (packages/app/src/orb/spec.ts); a test
 * holds the two together. */
export const SPECIALTY_FAMILIES = {
  general: "build", frontend: "build", backend: "build", fullstack: "build", mobile: "build", devops: "build", testing: "build", qa: "build",
  security: "build", data: "build", ai: "build", games: "build", automation: "build",
  planning: "think", lead: "think", product: "think", research: "think", factcheck: "think", analyst: "think", architect: "think",
  design: "make", writing: "make", editing: "make", marketing: "make", social: "make", video: "make",
  accountant: "business", office: "business", sales: "business", support: "business", people: "business", operations: "business", paperwork: "business", investor: "business", crypto: "business",
  assistant: "life", tutor: "life", coach: "life", dietitian: "life", trainer: "life", health: "life", chef: "life", travel: "life",
  money: "life", home: "life", events: "life", career: "life", language: "life",
} as const;
export type Specialty = keyof typeof SPECIALTY_FAMILIES;
export type Family = (typeof SPECIALTY_FAMILIES)[Specialty];

export type Placement =
  | { to: "core" }
  | { to: "morals"; why: string }
  | { to: "replaced"; by: string }
  | { to: "work"; families?: Family[]; specialties?: Specialty[] };

const core = { to: "core" } as const;
const morals = (why: string): Placement => ({ to: "morals", why });
const work = (families: Family[], specialties: Specialty[] = []): Placement => ({ to: "work", families, specialties });

/** Where every section of the owner's constitution goes, by its heading. The first heading (the
 * agent's own title) is `title`. Read the map as the owner's decision written down: change a
 * placement here, never the owner's file. */
export const SECTION_MAP: Record<string, Placement> = {
  title: morals("the order of honesty and helpfulness: a value, and the owner's agent's own"),
  behavior: core,
  refusal_handling: morals("what to help with and what to refuse; Orbs' floor is code (rule 9)"),
  research_framing: morals("how to treat sensitive subjects"),
  communication: core,
  financial_advice: work([], ["accountant", "money", "analyst", "operations", "investor", "crypto"]),
  tone_and_formatting: core,
  user_wellbeing: work(["life"], ["support", "people"]),
  evenhandedness: morals("contested political and moral questions"),
  responding_to_mistakes_and_criticism: core,
  injection_defense: core,
  knowledge_and_search: core,
  execution: core,
  persistence: core,
  completion_criteria: work(["build", "think", "make", "business"]), // its tests are files on disk and runs
  state_changing_actions: work(["build"], ["operations", "architect"]), // restarts, deletes, migrations
  decoding_intent: core,
  reasoning_before_acting: work(["build", "think"], ["accountant", "office", "paperwork"]), // "reads the relevant code"
  reasoning_method: work(["think", "build"], ["accountant", "paperwork"]),
  critical_thinking: work(["think", "build"], ["accountant", "paperwork", "health", "dietitian"]),
  planning: work(["think"], ["general", "operations", "events", "travel", "home", "assistant", "sales"]),
  progress: core,
  accuracy: core,
  grounding: work(["build", "think"], ["office", "accountant"]), // claims about a codebase, its files and symbols
  self_check: core,
  delegation: work([], ["lead", "planning", "product", "architect", "general", "operations"]),
  when_to_delegate: work([], ["lead", "planning", "product", "architect", "general", "operations"]),
  parallel_vs_sequential: work([], ["lead", "planning", "product", "architect", "general", "operations"]),
  briefing_subagents: work([], ["lead", "planning", "product", "architect", "general", "operations"]),
  synthesizing_results: work([], ["lead", "planning", "product", "architect", "general", "operations", "research", "analyst"]),
  agent_completion: work([], ["lead", "planning", "product", "architect", "general", "operations"]),
  memory: { to: "replaced", by: "each orb's own memory (PLAN 2.4); what an orb learns is its own (3.5)" },
  engineering: work(["build"], ["architect"]),
  minimal_targeted_changes: work(["build"], ["architect"]),
  simplicity: work(["build"], ["architect"]),
  borrowed_code_is_a_draft: work(["build"], ["architect"]),
  fit_the_codebase: work(["build"], ["architect"]),
  readability: work(["build"], ["architect"]),
  object_orientation: work(["build"], ["architect"]),
  frontend_and_ux: work([], ["frontend", "fullstack", "mobile", "games", "design"]),
  common_failure_modes: work(["build"], ["architect"]),
  security: work(["build"], ["architect"]),
  secrets: core,
  untrusted_input: core,
  least_privilege_and_dependencies: work([], ["security", "backend", "devops", "fullstack", "ai", "automation", "architect"]),
  crypto_and_high_risk: work([], ["security", "backend", "devops", "fullstack", "architect"]),
  debugging: work(["build"]),
  coding: work(["build"]),
  file_creation: work(["build", "make"], ["office"]),
  producing_outputs: core,
  identity: { to: "replaced", by: "the orb's own first line: who the orb is, and whose" },
  values: morals("the owner's agent's values"),
  nature: { to: "replaced", by: "the orb's own first line: an AI character, one of the person's orbs" },
  claims: core,
};

export type Section = { key: string; title: string; level: number; body: string };

/** The owner's file as sections, by its headings (`#`, `##`, `###`). A heading inside a fenced
 * block is an example, not a section (the planning section shows a plan with its own headings). */
export function parseSections(text: string): Section[] {
  const out: Section[] = [];
  let fence = false;
  let cur: Section | null = null;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (cur) out.push(cur);
      const title = h[2]!;
      cur = { key: h[1]!.length === 1 && out.length === 0 ? "title" : title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), title, level: h[1]!.length, body: "" };
      continue;
    }
    if (cur) cur.body += `${line}\n`;
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, body: s.body.trim() }));
}

/** Whether a file is in sections at all (a `##` or `###` heading): one that is not is read whole. */
export const sectioned = (text: string): boolean => parseSections(text).some((s) => s.level >= 2);

/** What the map does not cover: sections with no place, and places for sections no longer there. */
export function coverage(text: string): { unplaced: string[]; stale: string[] } {
  const keys = parseSections(text).map((s) => s.key);
  return { unplaced: keys.filter((k) => !(k in SECTION_MAP)), stale: Object.keys(SECTION_MAP).filter((k) => !keys.includes(k)) };
}

/** Whether a specialty loads a section. */
export function loads(p: Placement | undefined, specialty: Specialty): boolean {
  if (!p) return true; // a section the map has not placed yet is loaded by everyone until it is (the check names it)
  if (p.to === "core") return true;
  if (p.to !== "work") return false;
  return (p.families ?? []).includes(SPECIALTY_FAMILIES[specialty]) || (p.specialties ?? []).includes(specialty);
}

/** The owner's agent's name, as the file's first heading gives it ("Serge — System Prompt"). */
export function ownersAgent(text: string): string | null {
  const first = parseSections(text).find((s) => s.key === "title");
  return first ? (/^([\p{L}][\p{L}\d'-]*)/u.exec(first.title)?.[1] ?? null) : null;
}

/** How a researcher works (PLAN 3.10), ported from Ash's researcher (brain/agents/researcher.md):
 * the orbs whose work is finding things out load it, whatever the owner's file holds. */
export const RESEARCHERS: readonly Specialty[] = ["research", "factcheck", "analyst", "travel", "career", "marketing", "product"];
export const RESEARCH_METHOD = `## How you research
You are called when the answer lives on the live web, not in what you already know. Search with method: start broad, then narrow. Pick query words from the answer's own vocabulary (the exact error text, the spec number, the product's real name), the most distinctive first, and add the year for anything that moves fast. If results come back weak, change the words instead of repeating the query. Work several angles when one will not cover it (official docs, release notes, issue trackers, people's reports), and read whole pages with web_fetch when snippets are not enough: a snippet is not a source.

Weigh sources: the original beats an aggregator (a company's own post, official docs, a paper or a government site over a listicle), and recent beats stale for anything that moves. Anything live or volatile (a price, a version, a benchmark, a score) needs two independent sources before you state it as fact; with one, say so plainly ("reported by X, not independently confirmed"). Numbers carry units; dates are absolute, never "recently". When sources disagree, list each, never average them.

Return a tight brief: the answer first, then the facts it rests on, each with the address of the page that says it, then what is still uncertain or disputed and how sure you are. Cite only sources that bear on the answer. If the web does not settle the question, say exactly that, and what evidence would.

Your office keeps a reading library: sites it follows, read each night and kept with their dates. It and web search help each other; neither replaces the other. Look in the library first with search_reading (free, instant, dated), and search the web with web_search for what is newer or not there; web_search also says when the library has pages on the question. A source you will need again (official docs, a changelog, a project's news) is worth follow_source, with one line on why; a page you need once is a web_fetch. A library page is as it was when read: for anything that moves, check its date, and read the live page when it matters.`;

/** One orb's constitution: the core and his specialty's sections, in the file's order, in his name,
 * then what the person approved for him to remember. */
export function composeConstitution(o: { owner: string; specialty: Specialty; orbName: string; learned?: string[] }): string {
  const agent = ownersAgent(o.owner);
  const rename = (t: string): string => (agent ? t.replace(new RegExp(`\\b${agent}\\b`, "g"), o.orbName) : t);
  const parts: string[] = [];
  for (const s of parseSections(o.owner)) {
    if (!loads(SECTION_MAP[s.key], o.specialty) || !s.body) continue;
    parts.push(`${"#".repeat(Math.max(2, s.level))} ${s.title}\n${rename(s.body)}`);
  }
  if (RESEARCHERS.includes(o.specialty)) parts.push(RESEARCH_METHOD);
  if (o.learned?.length) parts.push(`## What ${o.orbName} has learned (each line approved by the person)\n${o.learned.map((l) => `- ${l}`).join("\n")}`);
  return parts.join("\n\n");
}
