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
  reverse: "build", // owner, 10-10: reverse engineering, REA's logic made ours (PLAN 4.8)
  // owner, 10-10: the desk (PLAN 5.25), its own department, opened by its head
  deskhead: "desk", dealer: "desk", quant: "desk", onchain: "desk", risk: "desk", quantres: "desk", quantdev: "desk", riskanalyst: "desk",
  planning: "think", lead: "think", product: "think", research: "think", factcheck: "think", analyst: "think", architect: "think",
  design: "make", writing: "make", editing: "make", marketing: "make", social: "make", video: "make",
  office: "business", sales: "business", support: "business", people: "business", operations: "business", paperwork: "business",
  // owner, 10-07: "add a few more positions and its own category": Finance, every money orb in it (the CFO's), and
  // the Executive, every department's head
  accountant: "finance", investor: "finance", crypto: "finance", money: "finance",
  fundamentals: "finance", // owner, 10-07: the forensic analyst of stocks and crypto
  assistant: "life", tutor: "life", coach: "life", dietitian: "life", trainer: "life", health: "life", chef: "life", travel: "life",
  home: "life", events: "life", career: "life", language: "life",
  ceo: "exec", cfo: "exec", coo: "exec", cto: "exec", cmo: "exec", chiefofstaff: "exec",
  sports: "think", // owner, 10-07: "add a Sports stats and odds skill too"
} as const;
export type Specialty = keyof typeof SPECIALTY_FAMILIES;
export type Family = (typeof SPECIALTY_FAMILIES)[Specialty];

export type Placement =
  | { to: "core" }
  | { to: "morals"; why: string }
  | { to: "replaced"; by: string }
  /** `when`: also loaded, from the next step, for any orb that has one of these kinds of tools to hand (agent/groups.ts)
   * or has used one of these tools in the conversation (owner, 10-07: "we still want everything to be there and
   * available, just when it needs to be"). */
  | { to: "work"; families?: Family[]; specialties?: Specialty[]; when?: When };
/** What brings a craft section to an orb outside its department: a kind of tools it has, a tool it has used. */
export type When = { groups?: string[]; tools?: string[] };
/** What an orb has to hand and has done in this conversation, for `When`. */
export type Using = { kinds?: ReadonlySet<string>; used?: ReadonlySet<string> };

const core = { to: "core" } as const;
const morals = (why: string): Placement => ({ to: "morals", why });
const work = (families: Family[], specialties: Specialty[] = [], when?: When): Placement => ({ to: "work", families, specialties, ...(when && { when }) });
// a craft section follows the tools that use it (owner, 10-07: "it still has to be really good, planning as well ... just
// when it needs to be"): planning with the plans, how to search with a search, delegating with the team or an ask,
// coding with a command run, a page's design with a page checked
const PLANNING: When = { groups: ["plans"], tools: ["propose_plan", "plan_templates"] };
const SEARCHING: When = { groups: ["reading"], tools: ["web_search", "web_fetch"] };
const DELEGATING: When = { groups: ["team"], tools: ["ask_orb"] };
const CODING: When = { tools: ["shell"] };

/** Where every section of the owner's constitution goes, by its heading. The first heading (the
 * agent's own title) is `title`. Read the map as the owner's decision written down: change a
 * placement here, never the owner's file. */
export const SECTION_MAP: Record<string, Placement> = {
  title: morals("the order of honesty and helpfulness: a value, and the owner's agent's own"),
  behavior: core,
  refusal_handling: morals("what to help with and what to refuse; Orbs' floor is code (rule 9)"),
  research_framing: morals("how to treat sensitive subjects"),
  communication: core,
  financial_advice: work(["finance"], ["analyst", "operations", "cfo", "sports"]), // odds are money too
  tone_and_formatting: core,
  user_wellbeing: work(["life"], ["support", "people", "money"]),
  evenhandedness: morals("contested political and moral questions"),
  responding_to_mistakes_and_criticism: core,
  injection_defense: core,
  // how to search, at length: the craft of the orbs that find things out (and your assistant's, who answers the day's
  // questions); every other orb carries its rule in brief (brain/values.ts SEARCH_BRIEF), 740 tokens less a request
  knowledge_and_search: work(["think", "finance", "exec"], ["general", "assistant", "research", "factcheck", "analyst", "travel", "career", "marketing", "product", "fundamentals", "sports"], SEARCHING),
  execution: core,
  persistence: core,
  completion_criteria: work(["build", "think", "make", "business", "finance", "exec"], [], PLANNING), // its tests are files on disk and runs
  state_changing_actions: work(["build"], ["operations", "architect", "cto", "coo"], CODING), // restarts, deletes, migrations
  decoding_intent: core,
  reasoning_before_acting: work(["build", "think", "finance", "exec"], ["office", "paperwork"]), // "reads the relevant code"
  reasoning_method: work(["think", "build", "finance", "exec"], ["paperwork"]),
  critical_thinking: work(["think", "build", "finance", "exec"], ["paperwork", "health", "dietitian"]),
  planning: work(["think", "exec"], ["general", "operations", "events", "travel", "home", "assistant", "sales"], PLANNING),
  // the owner's agent's own machinery, which nothing in Orbs runs (owner, 10-07: "Trim the constitution and take out things
  // we dont need ... just nothign that affects logic or the functionality it already has"): left out for every orb
  progress: { to: "replaced", by: "Orbs' own compaction: the summary a long run gets says to go on from it (agent/conversation.ts); no progress file is injected in Orbs" },
  accuracy: core,
  grounding: work(["build", "think"], ["office", "accountant"]), // claims about a codebase, its files and symbols
  self_check: core,
  delegation: work(["exec"], ["lead", "planning", "product", "architect", "general", "operations"], DELEGATING),
  when_to_delegate: work(["exec"], ["lead", "planning", "product", "architect", "general", "operations"], DELEGATING),
  parallel_vs_sequential: work(["exec"], ["lead", "planning", "product", "architect", "general", "operations"], DELEGATING),
  briefing_subagents: work(["exec"], ["lead", "planning", "product", "architect", "general", "operations"], DELEGATING),
  synthesizing_results: work(["exec"], ["lead", "planning", "product", "architect", "general", "operations", "research", "analyst", "fundamentals"], DELEGATING),
  agent_completion: { to: "replaced", by: "ask_orb's answer comes back in the conversation; Orbs has no agent output file to check" },
  memory: { to: "replaced", by: "each orb's own memory (PLAN 2.4); what an orb learns is its own (3.5)" },
  engineering: work(["build"], ["architect", "cto"]),
  minimal_targeted_changes: work(["build"], ["architect", "cto"], CODING),
  simplicity: work(["build"], ["architect", "cto"], CODING),
  borrowed_code_is_a_draft: work(["build"], ["architect", "cto"]),
  fit_the_codebase: work(["build"], ["architect", "cto"], CODING),
  readability: work(["build"], ["architect", "cto"], CODING),
  object_orientation: work(["build"], ["architect", "cto"]),
  frontend_and_ux: work([], ["frontend", "fullstack", "mobile", "games", "design"], { tools: ["check_page"] }),
  common_failure_modes: work(["build"], ["architect", "cto"], CODING),
  security: work(["build"], ["architect", "cto"]),
  secrets: core,
  untrusted_input: core,
  least_privilege_and_dependencies: work([], ["security", "backend", "devops", "fullstack", "ai", "automation", "architect"]),
  crypto_and_high_risk: work([], ["security", "backend", "devops", "fullstack", "architect"]),
  debugging: work(["build"], [], CODING),
  coding: work(["build"], [], CODING),
  file_creation: work(["build", "make", "finance", "exec"], ["office"]),
  producing_outputs: core,
  identity: { to: "replaced", by: "the orb's own first line: who the orb is, and whose" },
  values: morals("the owner's agent's values"),
  nature: { to: "replaced", by: "the orb's own first line: an AI character, one of the person's orbs" },
  claims: { to: "replaced", by: "nothing in Orbs checks a <claims> block (the owner's harness does); verifying before saying done stays, in accuracy and self_check" },
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
export function loads(p: Placement | undefined, specialty: Specialty, using: Using = {}): boolean {
  if (!p) return true; // a section the map has not placed yet is loaded by everyone until it is (the check names it)
  if (p.to === "core") return true;
  if (p.to !== "work") return false;
  if ((p.families ?? []).includes(SPECIALTY_FAMILIES[specialty]) || (p.specialties ?? []).includes(specialty)) return true;
  return Boolean(p.when && ((p.when.groups ?? []).some((g) => using.kinds?.has(g)) || (p.when.tools ?? []).some((t) => using.used?.has(t))));
}

/** The owner's agent's name, as the file's first heading gives it ("Serge — System Prompt"). */
export function ownersAgent(text: string): string | null {
  const first = parseSections(text).find((s) => s.key === "title");
  return first ? (/^([\p{L}][\p{L}\d'-]*)/u.exec(first.title)?.[1] ?? null) : null;
}

/** The mini constitution (owner, 10-06: "1 big constitution and a mini constitution for the
 * agents"): what an orb carries when it only chimes in, or does what another orb asked, in a
 * session. Core sections only, the ones about how it talks and stays honest and safe; the rest of
 * its cut (its specialty's sections, how it plans, persists, searches) is the big one, for the orb
 * leading the turn or working alone with the person. A test holds it to the core and its size. */
export const MINI: readonly string[] = ["communication", "tone_and_formatting", "accuracy", "self_check", "injection_defense", "untrusted_input", "secrets"];

/** How a researcher works (PLAN 3.10), ported from Ash's researcher (brain/agents/researcher.md):
 * the orbs whose work is finding things out load it, whatever the owner's file holds. */
export const RESEARCHERS: readonly Specialty[] = ["research", "factcheck", "analyst", "travel", "career", "marketing", "product", "fundamentals", "sports"];
export const RESEARCH_METHOD = `## How you research
You are called when the answer lives on the live web, not in what you already know. Search with method: start broad, then narrow. Pick query words from the answer's own vocabulary (the exact error text, the spec number, the product's real name), the most distinctive first, and add the year for anything that moves fast. If results come back weak, change the words instead of repeating the query. Work several angles when one will not cover it (official docs, release notes, issue trackers, people's reports), and read whole pages with web_fetch when snippets are not enough: a snippet is not a source.

Weigh sources: the original beats an aggregator (a company's own post, official docs, a paper or a government site over a listicle), and recent beats stale for anything that moves. Anything live or volatile (a price, a version, a benchmark, a score) needs two independent sources before you state it as fact; with one, say so plainly ("reported by X, not independently confirmed"). Numbers carry units; dates are absolute, never "recently". When sources disagree, list each, never average them.

Return a tight brief: the answer first, then the facts it rests on, each with the address of the page that says it, then what is still uncertain or disputed and how sure you are. Cite only sources that bear on the answer. If the web does not settle the question, say exactly that, and what evidence would.

Your office keeps a reading library: sites it follows, read each night and kept with their dates. It and web search help each other; neither replaces the other. Look in the library first with search_reading (free, instant, dated), and search the web with web_search for what is newer or not there; web_search also says when the library has pages on the question. A source you will need again (official docs, a changelog, a project's news) is worth follow_source, with one line on why; a page you need once is a web_fetch. A library page is as it was when read: for anything that moves, check its date, and read the live page when it matters.`;

/** How a fundamental analyst works (owner, 10-07: "one where the orb acts like a really good and well
 * trained fundamental analyst, looks at the compaies books, finds where they might be lying or there might
 * be a crash, like a michael burry kind of character or Mark Baum, they invest and look at every aspect of
 * companies and crypto"): a forensic reading of a company's or a coin's books, loaded by that orb alone,
 * whatever the owner's file holds. It reads and reports; every trade stays the person's (the floor's money
 * category, rule 9). */
export const FUNDAMENTALS_METHOD = `## How you read the books
You are a forensic fundamental analyst, of companies and of crypto. You read what others skip, follow the money, and say plainly where the story and the numbers part ways. Sceptical, never cynical: every view rests on evidence you can point to, not on a hunch or the crowd.

Read the primary sources, whole: the annual and quarterly filings (10-K, 10-Q, 20-F, the annual report), the notes to the statements, the auditor's report, management's discussion, the proxy, recent 8-Ks and insiders' filings (Form 4). For a coin or a token: the whitepaper, the contract and its supply schedule (unlocks, emissions, vesting), on-chain data (who holds it, the team's and the treasury's wallets, flows to exchanges), its audits, and where any yield really comes from. A press release, a deck or an influencer is the story, not the evidence.

Look for where the numbers stop adding up:
- earnings without cash: net income rising while operating cash flow does not, period after period;
- receivables or inventory growing faster than sales; revenue booked earlier, or a policy quietly changed;
- costs moved off the income statement (capitalised, "one-off", "adjusted"), and adjusted earnings drifting away from reported ones;
- debt: what falls due when, its covenants, what sits off the balance sheet, and whether cash covers the interest;
- dilution, buybacks paid for with debt, related-party deals, an auditor or a finance chief who left, late or restated filings, insiders selling;
- in crypto: supply held by a few wallets, unlocks ahead, reserves that cannot be proven, yield with no revenue behind it, leverage looped through lending, a peg that rests on confidence.
Screens (the Beneish M-score, the Altman Z-score, the Piotroski F-score) say where to look; they never replace reading.

Then stress it: what if rates, defaults, prices or volumes move against it; who is paid to say it is fine; what the market already believes, and why it may be wrong. Early looks the same as wrong for a while, so name the catalyst and the timing, or say you cannot.

Report the verdict first (sound, stretched, red flags, or trouble ahead), then three to five findings, each with its number and where it is (the filing, the period, the note or line, or the address on-chain), then what would prove you wrong, what to watch next, and how sure you are. Say fraud only when a court or a regulator has; otherwise say exactly what does not add up, and what innocent explanation could. Never tell the person to buy, sell or short: lay out the case; the decision and every trade are theirs.`;

/** One orb's constitution: the core and his specialty's sections, in the file's order, in his name,
 * then what the person approved for him to remember. */
export function composeConstitution(o: { owner: string; specialty: Specialty; orbName: string; learned?: string[]; mini?: boolean } & Using): string {
  const agent = ownersAgent(o.owner);
  const rename = (t: string): string => (agent ? t.replace(new RegExp(`\\b${agent}\\b`, "g"), o.orbName) : t);
  const parts: string[] = [];
  for (const s of parseSections(o.owner)) {
    if (!(o.mini ? MINI.includes(s.key) : loads(SECTION_MAP[s.key], o.specialty, o)) || !s.body) continue;
    parts.push(`${"#".repeat(Math.max(2, s.level))} ${s.title}\n${rename(s.body)}`);
  }
  if (!o.mini && RESEARCHERS.includes(o.specialty)) parts.push(RESEARCH_METHOD);
  if (!o.mini && o.specialty === "fundamentals") parts.push(FUNDAMENTALS_METHOD);
  if (o.learned?.length) parts.push(`## What ${o.orbName} has learned (each line approved by the person)\n${o.learned.map((l) => `- ${l}`).join("\n")}`);
  return parts.join("\n\n");
}
