// PLAN 3.9: does the section map (packages/home/src/brain/constitution.ts) place every section of
// the owner's constitution? Reads the headings only, and prints names, never the text, so nothing
// of the owner's file lands in the repo or a log. `node tools/constitution_check.ts [FILE]`
// (default ~/.serge/CONSTITUTION.trimmed.v3.md). Exit 1 on a gap.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { coverage, MINI, parseSections, SECTION_MAP, SPECIALTY_FAMILIES, loads, type Specialty } from "../packages/home/src/brain/constitution.ts";

const file = process.argv[2] ?? join(homedir(), ".serge", "CONSTITUTION.trimmed.v3.md");
const text = readFileSync(file, "utf8");
const sections = parseSections(text);
const { unplaced, stale } = coverage(text);
const by = { core: 0, work: 0, morals: 0, replaced: 0 };
for (const s of sections) {
  const p = SECTION_MAP[s.key];
  if (p) by[p.to]++;
}
console.log(`${sections.length} sections: ${by.core} core, ${by.work} by specialty, ${by.morals} morals (left out), ${by.replaced} replaced by Orbs' own`);
for (const k of unplaced) console.log(`  GAP     ${k}: no place in the map`);
for (const k of stale) console.log(`  STALE   ${k}: mapped, but no longer in the file`);
// the mini constitution (PLAN 5.10) names core sections: one gone from the file would leave it thinner, silently
const keys = sections.map((s) => s.key);
const miniGone = MINI.filter((k) => !keys.includes(k));
for (const k of miniGone) console.log(`  MINI    ${k}: in the mini constitution, but no longer in the file`);
// every specialty loads the core and something of its own, or says it has only the core
const thin = (Object.keys(SPECIALTY_FAMILIES) as Specialty[]).filter((sp) => !sections.some((s) => SECTION_MAP[s.key]?.to === "work" && loads(SECTION_MAP[s.key], sp)));
if (thin.length) console.log(`  core only: ${thin.join(", ")}`);
process.exit(unplaced.length || stale.length || miniGone.length ? 1 : 0);
