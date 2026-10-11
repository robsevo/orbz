// The specialty map (PLAN 3.7): what each orb is really good at, from what it did, never from what
// it says. Every run is tagged with an area by code, from the files it touched (by their kind) and
// the tools it used; a run with no sign of any area is left untagged (no classifier guesses yet:
// the plan keeps one only as a tie-break, and a tie here goes to the first area that tied).
//   - The radar: per area, the XP its runs earned (xp.ts, read off the ledger, so it matches it
//     exactly) and its pass rate (approved / judged).
//   - Niche tendencies: words in an orb's approved work (file names, commands, addresses) that it
//     uses far more often than the office does, e.g. "invoices" for one that keeps billing.
import type { EventLog } from "../events.ts";
import { trace } from "../agent/trace.ts";
import { ledger } from "./xp.ts";

export const AREAS = ["frontend", "backend", "data", "devops", "design", "research", "writing", "inbox", "scheduling", "finance", "bookings", "teaching", "desk"] as const;
export type Area = (typeof AREAS)[number];

export const BY_EXTENSION: Record<string, Area> = {
  tsx: "frontend", jsx: "frontend", css: "frontend", scss: "frontend", html: "frontend", vue: "frontend", svelte: "frontend",
  ts: "backend", js: "backend", mjs: "backend", py: "backend", go: "backend", rs: "backend", java: "backend", rb: "backend", php: "backend",
  csv: "data", tsv: "data", sql: "data", parquet: "data", ipynb: "data", xlsx: "data",
  yml: "devops", yaml: "devops", sh: "devops", tf: "devops", dockerfile: "devops",
  svg: "design", fig: "design", sketch: "design", png: "design",
  md: "writing", txt: "writing", docx: "writing",
  ics: "scheduling", eml: "inbox", mbox: "inbox",
};
const BY_TOOL: Record<string, Area> = {
  web_search: "research", web_fetch: "research", move_reminder: "scheduling", list_reminders: "scheduling",
  // reverse engineering is finding out how something works, with evidence (PLAN 4.8)
  inspect_binary: "research", inspect_app: "research", inspect_contract: "research", inspect_capture: "research",
  // the desk (PLAN 5.25)
  market_prices: "desk", market_chart: "desk", backtest_strategy: "desk", propose_strategy: "desk", run_strategy: "desk",
  paper_trade: "desk", desk_book: "desk", market_note: "desk", wallet_holdings: "desk", propose_swap: "desk",
  token_search: "desk", token_info: "desk",
};
const DEVOPS_COMMAND = /\b(git|docker|kubectl|systemctl|terraform|ansible|nginx)\b/;
const FINANCE_WORDS = /\b(stripe|invoices?|receipts?|ledger|payments?|payroll|tax|vat)\b/i;

export type RunTags = { run: number; orb: string; area: Area | null; words: string[]; approved: boolean; judged: boolean };

const extOf = (p: string): string => {
  const base = p.split("/").pop()!.toLowerCase();
  return base === "dockerfile" ? "dockerfile" : base.includes(".") ? base.split(".").pop()! : "";
};

/** One run's area, by code: a vote for each file touched (its kind), each tool, each sign in a command. */
export function tagRun(events: EventLog, run: number): { area: Area | null; words: string[] } {
  const votes = new Map<Area, number>();
  const words = new Set<string>();
  const vote = (a: Area | undefined, n = 1): void => {
    if (a) votes.set(a, (votes.get(a) ?? 0) + n);
  };
  for (const s of trace(events, run)) {
    if (s.kind !== "model") continue;
    for (const c of (s.data.tool_calls ?? []) as { name: string; arguments: string }[]) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
      } catch {
        /* the call as written */
      }
      vote(BY_TOOL[c.name]);
      if (c.name === "remind") vote(args.kind === "bill" ? "finance" : "scheduling");
      const text = [args.path, args.command, args.url, args.query, args.title].filter((v): v is string => typeof v === "string").join(" ");
      if (typeof args.path === "string") vote(BY_EXTENSION[extOf(args.path)]);
      if (typeof args.command === "string") {
        if (DEVOPS_COMMAND.test(args.command)) vote("devops");
        for (const m of args.command.matchAll(/[\w./-]+\.(\w+)\b/g)) vote(BY_EXTENSION[m[1]!.toLowerCase()]);
      }
      if (FINANCE_WORDS.test(text)) vote("finance");
      for (const w of text.toLowerCase().split(/[^a-z]+/)) if (w.length >= 4) words.add(w);
    }
  }
  let area: Area | null = null;
  let most = 0;
  for (const a of AREAS) if ((votes.get(a) ?? 0) > most) [area, most] = [a, votes.get(a)!];
  return { area, words: [...words] };
}

/** Every finished run, tagged, with whether the person approved it (or judged it at all). */
export function tagged(events: EventLog): RunTags[] {
  const verdict = new Map<number, string>();
  for (const f of events.ofType("trace.feedback")) verdict.set(Number(f.data.run), String(f.data.verdict));
  return events
    .ofType("run.finished")
    .filter((f) => f.data.outcome === "ok" && f.orb)
    .map((f) => {
      const run = Number(f.data.run);
      return { run, orb: f.orb!, ...tagRun(events, run), approved: verdict.get(run) === "approve", judged: verdict.has(run) };
    });
}

export type Radar = Record<Area, { xp: number; passRate: number | null; runs: number }>;

/** An orb's radar: per area, the XP its runs earned (off the ledger) and how often you approved them. */
export function radarOf(events: EventLog, orb: string): Radar {
  const runs = tagged(events).filter((r) => r.orb === orb);
  const areaOfRun = new Map(runs.map((r) => [r.run, r.area]));
  // which run each piece of evidence was about (a verdict names its run); what took XP back
  // counts against the run the XP it took back came from
  const runOfEvidence = new Map(events.ofType("trace.feedback").map((f) => [f.seq, Number(f.data.run)]));
  const sourceOfEntry = new Map(ledger(events).map((x) => [x.seq, x.source]));
  const undoes = new Map(events.ofType("xp.lost").map((l) => [l.seq, Number(l.data.undoes)]));
  const radar = Object.fromEntries(AREAS.map((a) => [a, { xp: 0, passRate: null as number | null, runs: 0 }])) as Radar;
  for (const x of ledger(events)) {
    if (x.orb !== orb) continue;
    const evidence = undoes.get(x.seq) ? sourceOfEntry.get(undoes.get(x.seq)!)! : x.source;
    // a trade's XP names its own area (the desk's, PLAN 5.25): no run is behind it
    const area = (x.area && (AREAS as readonly string[]).includes(x.area) ? (x.area as Area) : undefined) ?? areaOfRun.get(runOfEvidence.get(evidence) ?? -1);
    if (area) radar[area].xp += x.amount;
  }
  for (const a of AREAS) {
    const mine = runs.filter((r) => r.area === a);
    const judged = mine.filter((r) => r.judged);
    radar[a].runs = mine.length;
    radar[a].passRate = judged.length ? judged.filter((r) => r.approved).length / judged.length : null;
  }
  return radar;
}

/** The orb's niche tendencies: words in at least `min` of its approved runs, and at least `times`
 * as often per run as in the rest of the office's (its own runs would drown the average it is
 * measured against). Most telling first. */
export function nichesOf(events: EventLog, orb: string, o: { min?: number; times?: number } = {}): { word: string; runs: number; ratio: number }[] {
  const min = o.min ?? 5;
  const times = o.times ?? 3;
  const approved = tagged(events).filter((r) => r.approved);
  const mine = approved.filter((r) => r.orb === orb);
  const rest = approved.filter((r) => r.orb !== orb);
  if (!mine.length) return [];
  const count = (rs: RunTags[], w: string): number => rs.filter((r) => r.words.includes(w)).length;
  const out: { word: string; runs: number; ratio: number }[] = [];
  for (const w of new Set(mine.flatMap((r) => r.words))) {
    const n = count(mine, w);
    if (n < min) continue;
    const elsewhere = rest.length ? count(rest, w) / rest.length : 0;
    const ratio = elsewhere ? n / mine.length / elsewhere : Infinity; // no one else does it at all
    if (ratio >= times) out.push({ word: w, runs: n, ratio });
  }
  return out.sort((a, b) => b.runs - a.runs || b.ratio - a.ratio);
}
