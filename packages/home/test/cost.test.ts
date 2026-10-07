// PLAN 1.16_t, what the brains cost, read back: by model and kind of turn, with the share the cache served; `pnpm cost`
// on a home's log (since when, one conversation's); the probe tells a cache that serves from one that does not, and
// from one that serves its control as much (CLAUDE.md rule 4).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { forgetRefused } from "../src/agent/responses.ts";
import { cachedShare, costTable, probeCache } from "../src/brain/cost.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { Home } from "../src/home.ts";
import { browse, fakeChatGPT } from "./fakes/chatgpt.ts";
import { agentHome, tempDir } from "./helpers.ts";

const TOOL = join(import.meta.dirname, "..", "..", "..", "tools", "cost.ts");

const spent = (model: string, turn: string | null, input: number, cached: number, output: number, conversation: string | null = "chat:ash") =>
  ({ orb: "ash", conversation, data: { model, prompt_tokens: input, completion_tokens: output, ...(cached && { cached_tokens: cached }), ...(turn && { turn }) } });

test("the cost by model and kind of turn: the cache's share; a chat, and what no conversation asked, told apart; the most read first", () => {
  const { lines, total } = costTable([
    spent("terra", "lead", 10_000, 8_000, 300),
    spent("terra", "lead", 12_000, 9_000, 200),
    spent("luna", "chime", 2_000, 0, 50),
    spent("terra", null, 5_000, 1_000, 100),
    spent("terra", null, 800, 0, 20, null),
  ]);
  assert.deepEqual(lines.map((l) => [l.model, l.kind, l.calls, l.input, l.cached, l.output]), [
    ["terra", "lead", 2, 22_000, 17_000, 500],
    ["terra", "chat", 1, 5_000, 1_000, 100],
    ["luna", "chime", 1, 2_000, 0, 50],
    ["terra", "other", 1, 800, 0, 20],
  ]);
  assert.deepEqual([total.calls, total.input, total.cached, total.output], [5, 29_800, 18_000, 670]);
  assert.equal(cachedShare(lines[0]!), 77);
  assert.equal(cachedShare({ input: 0, cached: 0 }), 0, "nothing read, nothing to share");
});

test("`pnpm cost` reads a running home's log, from a copy: since when, one conversation's; what it cannot read is refused; a home off the plan has nothing to probe", async (t) => {
  const dir = tempDir(t);
  // left open while the tool reads: a running home holds its database alone
  const home = Home.open({ dataDir: dir, protect: [], spendCapUsd: null });
  t.after(() => home.close());
  home.spend.record({ tier: "big", model: "gpt-5.6-terra", costUsd: 0, costSource: "price-table", promptTokens: 10_000, completionTokens: 300, cachedTokens: 8_000, orb: "ash", conversation: "team:3:brainstorm", turn: "lead" });
  home.spend.record({ tier: "big", model: "gpt-5.6-luna", costUsd: 0, costSource: "price-table", promptTokens: 2_000, completionTokens: 50, orb: "pip", conversation: "chat:pip" });
  const cost = (...args: string[]) => spawnSync(process.execPath, [TOOL, "--data", dir, ...args], { encoding: "utf8" });
  const all = cost();
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /: 2 calls\./);
  assert.match(all.stdout, /gpt-5\.6-terra\s+lead\s+1\s+10,000\s+8,000\s+80%\s+300\n/);
  assert.match(all.stdout, /gpt-5\.6-luna\s+chat\s+1\s+2,000\s+0\s+0%\s+50\n/);
  assert.match(all.stdout, /all\s+all\s+2\s+12,000\s+8,000\s+67%\s+350\n/);
  const team = cost("--conversation", "team:3");
  assert.match(team.stdout, /in team:3\*: 1 call\./);
  assert.doesNotMatch(team.stdout, /luna/, "only that conversation's");
  assert.match(cost("--since", "2099-01-01T00:00").stdout, /: 0 calls\./, "nothing since then");
  const bad = cost("--since", "soon");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /say 30m, 6h, 2d/);
  const probe = cost("--probe");
  assert.equal(probe.status, 2);
  assert.match(probe.stderr, /never signed in to ChatGPT/);
  home.spend.record({ tier: "big", model: "gpt-5.6-terra", costUsd: 0, costSource: "price-table", promptTokens: 1_000, completionTokens: 10, orb: "ash", conversation: "chat:ash" });
  assert.match(cost().stdout, /: 3 calls\./, "the home went on writing, undisturbed, and the next read sees it");
  const none = spawnSync(process.execPath, [TOOL, "--data", tempDir(t)], { encoding: "utf8" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /there is no home there/);
});

test("the probe: the same instructions twice and a control changed from its first line, one cache key; served only when the repeat beats the control (controls: a cache that serves nothing, one that serves the control as much)", async (t) => {
  const openai = await fakeChatGPT(t);
  const h = await agentHome(t, [], { chatgpt: { store: new MemoryStore(), issuer: openai.issuer, apiBase: openai.apiBase } });
  const { url, done } = await h.home.chatgpt.begin();
  await browse(url);
  await done;
  forgetRefused();
  t.after(forgetRefused);
  const ep = h.home.chatgpt.endpoint({ light: true })!;
  const probe = async (cached: [number, number, number]) => {
    openai.script = cached.map((c) => ({ chunks: ["ok"], cached: c, input: 1_500 }));
    const at = openai.responses.length;
    const p = await probeCache(ep, { settleMs: 0 });
    return { p, bodies: openai.responses.slice(at).map((r) => r.body) };
  };
  const { p, bodies } = await probe([0, 1_280, 0]);
  assert.equal(p.served, true, p.said);
  assert.equal(p.said, "The plan's cache served 1,280 of 1,500 tokens on the repeat (85%); the control, its first line changed, had 0.");
  const ins = bodies.map((b) => String(b.instructions));
  assert.equal(ins[1], ins[0], "the same instructions again");
  const [head, rest] = [(s: string) => s.slice(0, s.indexOf("\n")), (s: string) => s.slice(s.indexOf("\n"))];
  assert.notEqual(head(ins[2]!), head(ins[0]!), "the control's first line differs");
  assert.equal(rest(ins[2]!), rest(ins[0]!), "and nothing after it");
  assert.ok(ins[0]!.length / 4 > 1_024, "past the 1,024 tokens a cache needs");
  assert.ok(bodies[0]!.prompt_cache_key && bodies.every((b) => b.prompt_cache_key === bodies[0]!.prompt_cache_key), "one cache key for the three");
  const none = await probe([0, 0, 0]);
  assert.equal(none.p.served, false);
  assert.match(none.p.said, /served nothing from its cache on the repeat \(1,500 tokens read at the full price\)/);
  const blind = await probe([0, 1_280, 1_280]);
  assert.equal(blind.p.served, false);
  assert.match(blind.p.said, /cannot tell the cache's work apart/);
});
