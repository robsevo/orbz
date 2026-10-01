// The plan gate (PLAN 1.7), ported from Ash's `plan-gate.sh` and `plan-doc-gate.sh`: a plan is
// checked BEFORE the person sees it, by checks ordered by how hard they are to fake.
//
//   HARD (never shown, however many tries)
//     the house shape: the header, numbered rows, a `_t` test row under every feature, no
//       feature ahead of its test — a feature without a test can be skipped without a mark
//     a typed count that disagrees with the rows — counts are generated, never typed
//     a "plan" of one feature — small enough to just do; a one-line task gets no plan
//     after "go with it, but X": a plan with no rows added — X was not planned
//   SOFT (sent back twice, then shown with the objections attached, as in Ash)
//     a cited file that does not exist and is not marked new — the filesystem answers
//     declared phases that are not there; a resubmission that changed nothing
//     depth by tier (files cited): verification and a boundary; then a rejected alternative;
//       then behaviour at scale, failure modes and a rollback
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type Counts, counts, type Parsed, parse, shape, wrongCounts } from "./format.ts";

export type GateResult = { hard: string[]; soft: string[]; tier: number; counts: Counts; parsed: Parsed };

const PATH_RE = /`([^`\n]+?)`|(?<![\w/.])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]{1,5})(?![\w/])/g;
const EXTS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".py", ".go", ".rs", ".rb", ".java", ".sh", ".sql", ".json", ".yaml", ".yml", ".toml", ".md", ".css", ".html"];
const NEW_MARK = /\(new\)|\bnew file\b|\bcreate[sd]?\b|\badd(?:ing|s)?\b/i;
const HEAVY_NOUN = /\b(schema|migration|migrate|auth|authz|authent|token|session|protocol|encrypt|password|credential|payment|tenant|permission)\b/i;
const STRUCTURAL_VERB = /\b(add|introduce|create|new|drop|remove|delete|alter|change|replace|redesign|rewrite|restructure|rotate|expire|invalidate)\b/i;

export function gate(plan: string, o: { roots: string[]; previous?: string | null; changedFrom?: string | null }): GateResult {
  const parsed = parse(plan);
  const c = counts(parsed);
  const hard = [...shape(plan, parsed), ...wrongCounts(plan, c)];
  const features = parsed.rows.filter((r) => !r.test).length;
  if (features > 0 && features < 2) hard.push("it is one feature: small enough to just do, so do it — no plan needed");
  if (o.changedFrom) {
    const before = parse(o.changedFrom).rows.filter((r) => !r.test).length;
    if (features <= before) hard.push(`the person asked for a change and it has no new rows (${features} features, ${before} before): plan the change as rows`);
  }

  const soft: string[] = [];
  const cited = citations(plan);
  const missing = cited.filter((p) => !markedNew(plan, p) && !exists(p, o.roots));
  if (missing.length) soft.push(`it cites ${missing.length} file(s) that do not exist and are not marked new: ${missing.slice(0, 6).join(", ")}. Read before planning, or mark the file (new)`);
  if (o.previous && similar(o.previous, plan)) soft.push("it is the plan already sent back, nearly unchanged: read the objections and the files they point at, and change what they say");
  const declared = declaredRange(plan);
  if (declared) {
    const absent = [];
    for (let n = declared[0]; n <= declared[1]; n++) if (!parsed.phases.includes(n)) absent.push(n);
    if (absent.length >= 2) soft.push(`it says it covers phases ${declared[0]}-${declared[1]} but ${absent.join(", ")} are absent`);
  }
  const perPhase = new Map<number, number>();
  for (const r of parsed.rows) if (!r.test) perPhase.set(r.phase, (perPhase.get(r.phase) ?? 0) + 1);
  const thin = [...perPhase].filter(([, n]) => n < 2).map(([p]) => p);
  if (thin.length && parsed.phases.length > 1) soft.push(`phase ${thin.join(", ")} has a single feature row: break it into micro-features, each built and tested on its own`);

  let tier = cited.length >= 1 ? 1 : 0;
  if (cited.length >= 4) tier = 2;
  const heavy = plan.split(/[.\n;]/).some((s) => HEAVY_NOUN.test(s) && STRUCTURAL_VERB.test(s));
  if (cited.length > 10 || (heavy && cited.length >= 3)) tier = 3;
  const has = (...res: RegExp[]): boolean => res.some((re) => re.test(plan));
  if (tier >= 1) {
    if (!has(/\bverif/i, /\btest/i, /\bcheck(ed|s)?\b/i, /\bconfirm/i, /\bassert/i, /\bmeasure/i)) soft.push("no step says how it will be VERIFIED");
    if (!has(/does not\b/i, /out of scope/i, /\bnot doing\b/i, /\bwon'?t\b/i, /\bexclud/i, /\bdefer/i, /^\s*#{1,6}\s*(the\s+)?(boundary|boundaries|scope|non-?goals?|not doing)\b/im)) {
      soft.push("it never states its BOUNDARY — what it deliberately does not do");
    }
  }
  if (tier >= 2 && !has(/\binstead of\b/i, /\balternative/i, /\brejected\b/i, /\bconsidered\b/i, /\brather than\b/i, /\btrade-?off/i)) soft.push("no ALTERNATIVE is named: one real approach rejected, and why");
  if (tier >= 3) {
    if (!has(/\b10x\b/i, /\bscal/i, /\bgrow/i, /\bunder load\b/i, /\bthroughput\b/i, /\bn (is|stays|remains)\b/i, /\bO\(/)) soft.push("a big change with nothing said about behaviour at scale");
    if (!has(/\bfail/i, /\berror\b/i, /\btimeout\b/i, /\bretry\b/i, /\bpartial\b/i, /\bdegrade/i)) soft.push("a big change with no failure modes named");
    if (!has(/\brollback\b/i, /\brevert\b/i, /\bundo\b/i, /\bback ?out\b/i, /\brestore\b/i)) soft.push("a big change with no way back (rollback) named");
  }
  return { hard, soft, tier, counts: c, parsed };
}

function citations(plan: string): string[] {
  const out: string[] = [];
  for (const m of plan.matchAll(PATH_RE)) {
    let tok = (m[1] ?? m[2] ?? "").trim();
    if (!tok || tok.includes(" ") || tok.startsWith("@") || /^https?:/.test(tok)) continue;
    if (tok.startsWith("./")) tok = tok.slice(2);
    if (!EXTS.some((e) => tok.endsWith(e))) continue;
    if (/[<>{}]/.test(tok) || /^\.[A-Za-z0-9]+$/.test(tok) || /^[A-Za-z]\.[A-Za-z0-9]+$/.test(tok)) continue; // templates, bare extensions, x.py
    out.push(tok);
  }
  return [...new Set(out)];
}

function markedNew(plan: string, path: string): boolean {
  const lines = plan.split("\n");
  for (const [i, line] of lines.entries()) {
    if (!line.includes(path)) continue;
    if (NEW_MARK.test(line)) return true;
    if (line.trimStart().startsWith("|") && /\[\s\]/.test(line)) return true; // an unchecked row is future work
    for (let j = Math.max(0, i - 8); j < i; j++) {
      const prev = lines[j]!;
      if (prev.trim() && NEW_MARK.test(prev) && (/^\s*[#\-*>]/.test(prev) || prev.trimEnd().endsWith(":"))) return true;
    }
  }
  return false;
}

function exists(p: string, roots: string[]): boolean {
  if (p.startsWith("~")) return existsSync(join(homedir(), p.slice(1)));
  if (isAbsolute(p)) return existsSync(p);
  if (roots.some((r) => existsSync(join(r, p)))) return true;
  // a file named from a subdirectory (`voice.py` for `orb/daemon/voice.py`): look for the name,
  // a few levels deep, as Ash's gate does — a search can only find a file that is really there
  const name = p.split("/").at(-1)!;
  return roots.some((r) => findName(r, name, 5));
}

function findName(dir: string, name: string, depth: number): boolean {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.name === name && e.isFile())) return true;
  if (depth <= 0) return false;
  return entries.some((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".") && findName(join(dir, e.name), name, depth - 1));
}

const SKIP = new Set(["node_modules", ".git", ".venv", "__pycache__", "dist", "build"]);

function declaredRange(plan: string): [number, number] | null {
  let lo: number | null = null;
  let hi: number | null = null;
  for (const m of plan.matchAll(/\bphases?\s+(\d{1,2})\s*(?:[-‐-―−]|to|through|thru)\s*(\d{1,2})\b/gi)) {
    const start = plan.lastIndexOf("\n", m.index) + 1;
    const end = plan.indexOf("\n", m.index);
    const line = plan.slice(start, end < 0 ? undefined : end);
    if (/\b(not?|never|exclud\w*|out of scope|beyond|defer\w*|omit\w*|skip\w*|later|future|separate)\b/i.test(line)) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a < b && b - a <= 40) {
      lo = lo === null ? a : Math.min(lo, a);
      hi = hi === null ? b : Math.max(hi, b);
    }
  }
  return lo === null || hi === null ? null : [lo, hi];
}

/** Nearly the same plan: 98% of the lines in common, whitespace and case aside. */
function similar(a: string, b: string): boolean {
  const lines = (s: string): Set<string> => new Set(s.toLowerCase().split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean));
  const x = lines(a);
  const y = lines(b);
  const both = [...x].filter((l) => y.has(l)).length;
  return both / Math.max(x.size, y.size, 1) >= 0.98;
}
