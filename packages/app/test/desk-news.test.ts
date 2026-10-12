// The news screen's arithmetic (PLAN 5.43): desk/news.ts, pure. Controls are planted in tools/home_mutants.py (could
// move it read as any kind at all, a coin's filter keeping every story).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { NewsStory } from "../src/home/link.ts";
import { facets, filtered, MOVING, moveWords } from "../src/desk/news.ts";

const s = (id: string, coins: string[], kinds: string[], weight: number): NewsStory => ({ id, source: "A", title: id, summary: "", url: `https://a.example/${id}`, at: 0, coins, kinds, weight, moves: {} });
const items = [s("etf", ["BTC", "ETH"], ["etf"], 4), s("buy", ["BTC"], ["buyer"], 3), s("quiet", [], [], 0), s("list", ["SOL"], ["listing"], 2)];

test("the filters a list offers: its coins and kinds, the most first", () => {
  assert.deepEqual(facets(items), { coins: [["BTC", 2], ["ETH", 1], ["SOL", 1]], kinds: [["etf", 1], ["buyer", 1], ["listing", 1]] });
});

test("a filter applied: everything, what could move it, a coin, a kind", () => {
  assert.equal(MOVING, 3);
  assert.deepEqual(filtered(items, { kind: "all" }).map((x) => x.id), ["etf", "buy", "quiet", "list"]);
  assert.deepEqual(filtered(items, { kind: "moving" }).map((x) => x.id), ["etf", "buy"], "a listing (2) has moved prices less: not marked");
  assert.deepEqual(filtered(items, { kind: "coin", coin: "BTC" }).map((x) => x.id), ["etf", "buy"]);
  assert.deepEqual(filtered(items, { kind: "type", type: "listing" }).map((x) => x.id), ["list"]);
  assert.deepEqual([moveWords(0.0123), moveWords(-0.004), moveWords(0)], ["+1.2%", "−0.4%", "+0.0%"]);
});
