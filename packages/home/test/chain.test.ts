// PLAN 1.11_t, the order itself: ChatGPT, then Gemini, then the local coder. A brain at its limit
// or not set up steps aside and the next answers; a rested brain is first again; how long each
// rests comes from what its reply said; and the one error names every brain and why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BrainChain, explain, restFor, type Link } from "../src/brain/chain.ts";
import type { Endpoint } from "../src/brain/openai.ts";

const ep = (name: string): Endpoint => ({ name, baseUrl: `http://${name}.test/v1`, model: name });

function chain(set: { chatgpt?: boolean; gemini?: boolean; local?: boolean }, clock: () => number) {
  const links: Link[] = [
    { id: "chatgpt", label: "ChatGPT", endpoint: () => (set.chatgpt ? ep("chatgpt") : null), setup: "sign in with ChatGPT" },
    { id: "gemini", label: "Gemini", endpoint: () => (set.gemini ? ep("gemini") : null), setup: "add a Gemini key" },
    { id: "local", label: "the local coder", endpoint: () => (set.local ? ep("local") : null), setup: "start the local coder" },
  ];
  return new BrainChain(links, clock);
}

test("the order: ChatGPT first, then Gemini, then the local coder; each tagged with its place", () => {
  let now = 0;
  const all = chain({ chatgpt: true, gemini: true, local: true }, () => now);
  assert.equal(all.current()?.link.id, "chatgpt");
  assert.equal(all.current()?.ep.chain, "chatgpt");
  assert.equal(chain({ gemini: true, local: true }, () => now).current()?.link.id, "gemini", "no ChatGPT: Gemini");
  assert.equal(chain({ local: true }, () => now).current()?.link.id, "local", "neither: the local coder");
  assert.equal(chain({}, () => now).current(), null, "none set up: nothing");
});

test("a brain at its limit rests, the next answers, and the rested one is first again", () => {
  let now = 1_000_000;
  const c = chain({ chatgpt: true, gemini: true, local: true }, () => now);
  c.rest("chatgpt", "its usage limit is reached", now + 60_000);
  assert.equal(c.current()?.link.id, "gemini");
  assert.equal(c.after("chatgpt")?.label, "Gemini", "the notice names who answers next");
  c.rest("gemini", "its daily limit is reached", now + 3_600_000);
  assert.equal(c.current()?.link.id, "local");
  now += 61_000;
  assert.equal(c.current()?.link.id, "chatgpt", "ChatGPT has rested: first again");
});

test("how long a brain rests comes from its reply", () => {
  const now = 0;
  assert.deepEqual(restFor({ status: 429, message: "rate limit", retryAfterS: 20 }, now), { why: "its limit is reached", until: 20_000 });
  assert.equal(restFor({ status: 429, message: "Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier" }, now).why, "its daily limit is reached");
  assert.equal(restFor({ status: 429, message: "Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier" }, now).until, 3_600_000);
  assert.deepEqual(restFor({ status: null, message: "fetch failed: ECONNREFUSED" }, now), { why: "nothing answered", until: 60_000 });
  assert.equal(restFor({ status: 401, message: "API key not valid" }, now).why, "its key was refused");
});

test("the one error names every brain and why it is not answering", () => {
  let now = Date.parse("2026-10-01T14:00:00");
  const c = chain({ chatgpt: true }, () => now);
  c.rest("chatgpt", "its usage limit is reached", now + 3_600_000);
  const msg = explain(c.states(), 3);
  assert.match(msg, /^No brain could answer after 3 tries\./);
  assert.match(msg, /ChatGPT: its usage limit is reached, back about 15:00/);
  assert.match(msg, /Gemini: not set up/);
  assert.match(msg, /the local coder: not set up/);
  // control: a ready brain is said to be ready, never "not set up"
  assert.match(explain(chain({ gemini: true }, () => now).states(), 1), /Gemini: ready/);
});
