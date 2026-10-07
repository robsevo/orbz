// PLAN 1.16: what the brains read and wrote, by model and kind of turn, and how much of it the cache served.
// `pnpm cost [--data DIR] [--since 30m|6h|2d|2026-10-07T09:00] [--conversation PREFIX]` reads the home's event log
// from a copy: a running home holds its database alone (packages/home/src/db.ts), so the database and its write-ahead
// log are copied to a folder of their own, read there and removed, and the home is never disturbed. `pnpm cost --probe`
// asks the ChatGPT plan whether its cache serves at all:
// three short requests on its light model, one of them a control (packages/home/src/brain/cost.ts `probeCache`). The
// probe uses the sign-in as the home keeps it and never refreshes it, so the home's own tokens are left as they are.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { refusedFields } from "../packages/home/src/agent/responses.ts";
import { cachedShare, costTable, probeCache, type CostLine } from "../packages/home/src/brain/cost.ts";
import type { Endpoint } from "../packages/home/src/brain/openai.ts";
import { lightOf, type PlanModel } from "../packages/home/src/chatgpt/chatgpt.ts";
import { RESOURCE } from "../packages/home/src/chatgpt/oauth.ts";
import { defaultHome, defaultStore } from "../packages/home/src/chatgpt/store.ts";

const { values } = parseArgs({ options: { data: { type: "string" }, since: { type: "string" }, conversation: { type: "string" }, probe: { type: "boolean" } } });
const data = values.data ?? defaultHome();
const n = (x: number): string => x.toLocaleString("en");

if (values.probe) {
  let ep: Endpoint;
  try {
    const file = (name: string): string | null => {
      try {
        return readFileSync(join(data, name), "utf8");
      } catch {
        return null;
      }
    };
    const [host, auth] = [file("chatgpt-host.json"), file("chatgpt-auth.json")];
    if (!host || !auth) throw new Error("this home has never signed in to ChatGPT (Settings: Continue with ChatGPT)");
    const hostId = (JSON.parse(host) as { hostId: string }).hostId;
    const reg = JSON.parse(auth) as { sharing?: boolean; model?: string | null; models?: PlanModel[] };
    const raw = await (await defaultStore(data)).get(`chatgpt:${hostId}`);
    if (!raw || !reg.sharing) throw new Error("this home is not using a ChatGPT plan (Settings: Continue with ChatGPT)");
    const saved = JSON.parse(raw) as { accessToken: string; expiresAt: number };
    if (saved.expiresAt - 60_000 <= Date.now()) throw new Error("the ChatGPT sign-in is due for a refresh, which the home does on its next request to the plan: send an orb a message, then probe again");
    const model = lightOf(reg.models ?? []) ?? reg.model;
    if (!model) throw new Error("the plan lists no model");
    ep = { name: "chatgpt", api: "responses", baseUrl: RESOURCE, model, plan: "chatgpt", retries: 0, token: async () => saved.accessToken };
  } catch (e) {
    console.error(`Cannot probe: ${(e as Error).message}.`);
    process.exit(2);
  }
  const p = await probeCache(ep);
  console.log(`On ${p.model}, three requests of Orbs' own text:`);
  for (const [what, c] of [["first", p.first], ["the same again", p.again], ["CONTROL, first line changed", p.control]] as const) {
    console.log(`  ${what.padEnd(28)} read ${n(c.input).padStart(6)}, from the cache ${n(c.cached).padStart(6)}, wrote ${n(c.output)}${c.error ? `  (${c.error})` : ""}`);
  }
  console.log(p.said);
  const refused = refusedFields();
  console.log(refused.includes("prompt_cache_key") ? "The plan refused the cache key: Orbz drops it." : "The plan took the cache key.");
  process.exit(p.served ? 0 : 1);
}

const since = ((): number => {
  const v = values.since ?? "24h";
  const m = /^(\d+)\s*([mhd])$/.exec(v);
  if (m) return Date.now() - Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
  const at = Date.parse(v);
  if (Number.isNaN(at)) {
    console.error(`--since ${v}: say 30m, 6h, 2d, or a date and time (2026-10-07T09:00)`);
    process.exit(2);
  }
  return at;
})();
type Row = { orb: string | null; conversation: string | null; data: string };
const copy = mkdtempSync(join(tmpdir(), "orbs-cost-"));
let read: Row[] | Error;
try {
  if (!existsSync(join(data, "home.db"))) throw new Error("there is no home there");
  for (const f of ["home.db", "home.db-wal"]) if (existsSync(join(data, f))) copyFileSync(join(data, f), join(copy, f));
  const db = new DatabaseSync(join(copy, "home.db"));
  try {
    read = db.prepare("SELECT orb, conversation, data FROM events WHERE type = 'brain.spend' AND at >= ? ORDER BY seq").all(since) as Row[];
  } finally {
    db.close();
  }
} catch (e) {
  read = e as Error;
} finally {
  rmSync(copy, { recursive: true, force: true });
}
if (read instanceof Error) {
  console.error(`Cannot read ${join(data, "home.db")}: ${read.message}`);
  process.exit(2);
}
const rows = read
  .filter((r) => !values.conversation || (r.conversation ?? "").startsWith(values.conversation))
  .map((r) => ({ orb: r.orb, conversation: r.conversation, data: JSON.parse(r.data) as Record<string, unknown> }));
const { lines, total } = costTable(rows);
const from = new Date(since).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
console.log(`Since ${from}${values.conversation ? `, in ${values.conversation}*` : ""}: ${n(total.calls)} call${total.calls === 1 ? "" : "s"}.`);
if (!total.calls) process.exit(0);
const row = (l: CostLine): string =>
  `${l.model.padEnd(22)} ${l.kind.padEnd(8)} ${n(l.calls).padStart(6)} ${n(l.input).padStart(11)} ${n(l.cached).padStart(11)} ${`${cachedShare(l)}%`.padStart(7)} ${n(l.output).padStart(9)}`;
console.log(`${"model".padEnd(22)} ${"kind".padEnd(8)} ${"calls".padStart(6)} ${"read".padStart(11)} ${"cached".padStart(11)} ${"cached%".padStart(7)} ${"wrote".padStart(9)}`);
for (const l of lines) console.log(row(l));
console.log(row(total));
console.log("cached: what the provider says it read from its cache (0 where it says nothing). The ChatGPT plan counts it at a tenth.");
