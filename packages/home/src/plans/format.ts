// The house plan format (PLAN 1.7; CLAUDE.md rule 1), read by code: phase tables of
// `| # | Feature | Description | Done |`, a `_t` test row right under every feature, `[ ]` `[~]`
// `[x]` boxes, and a feature's box never ahead of its test's. Counts are generated here, never
// typed (rule 3): a number a script can compute is a number nobody should be trusted to type.
// tools/plan_counts.py holds the same rules for the repo's own PLAN.md.

export type Box = "[ ]" | "[~]" | "[x]";
export type Row = { phase: number; id: string; test: boolean; box: Box; line: number; text: string };
export type Parsed = { rows: Row[]; phases: number[]; problems: string[] };
export type Counts = { features: Map<number, number>; tests: Map<number, number>; boxes: Record<Box, number> };

const PHASE = /^\s*#{1,4}\s*PHASE\s+(\d{1,2})\b/i;
const ROW = /^\|\s*\**\s*(\d{1,2})\.(\d{1,2})(_t)?\s*\**\s*\|.*\|\s*(\[[ ~xX]\])\s*\|\s*$/;
const HEADER = /^\s*\|\s*#\s*\|\s*Feature\s*\|\s*Description\s*\|\s*Done\s*\|\s*$/im;
const RANK: Record<Box, number> = { "[ ]": 0, "[~]": 1, "[x]": 2 };

export function parse(plan: string): Parsed {
  const rows: Row[] = [];
  const phases: number[] = [];
  const problems: string[] = [];
  let phase: number | null = null;
  plan.split("\n").forEach((line, i) => {
    const p = PHASE.exec(line);
    if (p) {
      phase = Number(p[1]);
      phases.push(phase);
      return;
    }
    const m = ROW.exec(line.trim());
    if (!m) return;
    const id = `${Number(m[1])}.${Number(m[2])}`;
    if (phase === null || Number(m[1]) !== phase) {
      problems.push(`row ${id} sits outside its phase's table`);
      return;
    }
    rows.push({ phase, id, test: Boolean(m[3]), box: m[4]!.toLowerCase() as Box, line: i + 1, text: line.trim() });
  });
  return { rows, phases, problems };
}

/** The structural rules: the house header, a test row under every feature, no feature ahead of its test. */
export function shape(plan: string, parsed: Parsed): string[] {
  const out = [...parsed.problems];
  if (!HEADER.test(plan)) out.push("it has no table with the header `| # | Feature | Description | Done |`");
  const features = parsed.rows.filter((r) => !r.test);
  if (!features.length) out.push("it has no numbered feature rows (`| 1.1 | … | [ ] |`)");
  for (const [i, r] of parsed.rows.entries()) {
    if (r.test) continue;
    const next = parsed.rows[i + 1];
    if (!next || next.id !== r.id || !next.test) out.push(`feature ${r.id} has no ${r.id}_t test row right under it`);
    else if (RANK[r.box] > RANK[next.box]) out.push(`feature ${r.id} is ${r.box} but its test ${r.id}_t is ${next.box}: a feature is never ahead of its test`);
  }
  return out;
}

export function counts(parsed: Parsed): Counts {
  const features = new Map<number, number>();
  const tests = new Map<number, number>();
  const boxes: Record<Box, number> = { "[ ]": 0, "[~]": 0, "[x]": 0 };
  for (const r of parsed.rows) {
    const m = r.test ? tests : features;
    m.set(r.phase, (m.get(r.phase) ?? 0) + 1);
    boxes[r.box]++;
  }
  return { features, tests, boxes };
}

/** The count summary, generated: what the person sees under every plan. */
export function summary(c: Counts): string {
  const phases = [...new Set([...c.features.keys(), ...c.tests.keys()])].sort((a, b) => a - b);
  const total = (m: Map<number, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
  const lines = ["| Phase | Features | Test rows |", "|---|---|---|"];
  for (const p of phases) lines.push(`| Phase ${p} | ${c.features.get(p) ?? 0} | ${c.tests.get(p) ?? 0} |`);
  lines.push(`| **Total** | ${total(c.features)} | ${total(c.tests)} |`);
  const n = c.boxes["[ ]"] + c.boxes["[~]"] + c.boxes["[x]"];
  lines.push("", `${n} boxes: ${c.boxes["[x]"]} \`[x]\`, ${c.boxes["[~]"]} \`[~]\`, ${c.boxes["[ ]"]} \`[ ]\`. (Counted by the home, not typed.)`);
  return lines.join("\n");
}

/** Counts the plan typed that do not match its own rows. A typed count is checked, never trusted. */
export function wrongCounts(plan: string, c: Counts): string[] {
  const out: string[] = [];
  const totalF = [...c.features.values()].reduce((a, b) => a + b, 0);
  const totalT = [...c.tests.values()].reduce((a, b) => a + b, 0);
  const boxes = c.boxes["[ ]"] + c.boxes["[~]"] + c.boxes["[x]"];
  for (const m of plan.matchAll(/^\|\s*Phase\s+(\d{1,2})\b[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/gim)) {
    const p = Number(m[1]);
    if (Number(m[2]) !== (c.features.get(p) ?? 0) || Number(m[3]) !== (c.tests.get(p) ?? 0)) {
      out.push(`the summary says Phase ${p} has ${m[2]} features and ${m[3]} test rows; its rows say ${c.features.get(p) ?? 0} and ${c.tests.get(p) ?? 0}`);
    }
  }
  for (const m of plan.matchAll(/^\|\s*\**Total\**\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/gim)) {
    if (Number(m[1]) !== totalF || Number(m[2]) !== totalT) out.push(`the total says ${m[1]} and ${m[2]}; the rows say ${totalF} and ${totalT}`);
  }
  // the boxes line; prose like "Phases 0-3 (28 features)" counts a part, so it is not checked
  for (const m of plan.matchAll(/^(\d+) boxes(?::\s*(\d+) `\[x\]`,\s*(\d+) `\[~\]`,\s*(\d+) `\[ \]`)?/gm)) {
    const typed = [Number(m[1]), m[2], m[3], m[4]].map((v) => (v === undefined ? undefined : Number(v)));
    const real = [boxes, c.boxes["[x]"], c.boxes["[~]"], c.boxes["[ ]"]];
    if (typed.some((v, i) => v !== undefined && v !== real[i])) {
      out.push(`it says "${m[0]}"; the rows say ${boxes} boxes: ${c.boxes["[x]"]} [x], ${c.boxes["[~]"]} [~], ${c.boxes["[ ]"]} [ ]`);
    }
  }
  return [...new Set(out)];
}
