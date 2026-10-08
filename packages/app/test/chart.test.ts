// PLAN 5.6_t, 5.12_t: the org chart's tree by code (owner, 10-08: "Org chart needs to be nicer too lol. like a family
// tree or corporate latter"): you, the CEO, each department's head under the CEO, each team under its head.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chartOf, departmentOf, type Chart } from "../src/rooms/chart.ts";

/** Everyone on a tree, in the order it hangs. */
const everyone = (c: Chart): string[] =>
  [c.ceo, ...c.executive.flatMap((k) => [k.lead, ...k.rest]), ...c.branches.flatMap((b) => [b.head, ...b.team.flatMap((k) => [k.lead, ...k.rest])])].filter((x): x is string => !!x);

test("an officer works in the department its post heads; anyone else in its own kind's", () => {
  assert.deepEqual(
    ["ceo", "cto", "chiefofstaff", "cmo", "cfo", "coo", "assistant", "frontend", "writing", "accountant"].map(departmentOf),
    ["exec", "build", "think", "make", "finance", "business", "life", "build", "make", "finance"],
  );
});

test("the tree: the CEO at its top, each department under its head, every orb on it once and a head only at its branch's top", () => {
  const orbs = [
    { id: "max", specialty: "ceo" }, { id: "pip", specialty: "assistant" }, { id: "gus", specialty: "cto" },
    { id: "ada", specialty: "frontend" }, { id: "bea", specialty: "frontend" }, { id: "tess", specialty: "cto" },
    { id: "cy", specialty: "writing" }, { id: "rex", specialty: "ceo" },
  ];
  const c = chartOf({
    leads: { ceo: "max", assistant: "pip", cto: "gus", frontend: "ada", writing: "cy" },
    heads: { exec: "max", build: "gus", think: null, make: null, finance: null, business: null, life: "pip" },
    orbs,
  });
  assert.equal(c.ceo, "max");
  // a second CEO stands under the CEO; a second CTO in Build, under the CTO, never leading it
  assert.deepEqual(c.executive, [{ kind: "ceo", lead: null, rest: ["rex"] }]);
  // the departments in the company's order, those with someone in them: Make with no CMO yet, Life its head alone
  assert.deepEqual(c.branches.map((b) => [b.family, b.head]), [["build", "gus"], ["make", null], ["life", "pip"]]);
  assert.deepEqual(c.branches[0]!.team, [{ kind: "frontend", lead: "ada", rest: ["bea"] }, { kind: "cto", lead: null, rest: ["tess"] }], "its own kinds first, an officer's post last");
  assert.deepEqual(c.branches[1]!.team, [{ kind: "writing", lead: "cy", rest: [] }]);
  assert.deepEqual(c.branches[2]!.team, [], "Pip heads Life, so Pip is not in its team as well");
  assert.deepEqual(everyone(c).sort(), orbs.map((o) => o.id).sort(), "every orb once");
  const back = chartOf({ leads: { ceo: "max", assistant: "pip", cto: "gus", frontend: "ada", writing: "cy" }, heads: { exec: "max", build: "gus", life: "pip" }, orbs: [...orbs].reverse() });
  assert.deepEqual(back.branches.map((b) => b.team.map((k) => k.kind)), c.branches.map((b) => b.team.map((k) => k.kind)), "the same kinds in the same order, whoever joined first");
});

test("an office with no heads yet (a home from before the company): no CEO, each officer leading its kind where its post would head", () => {
  const c = chartOf({ leads: { cto: "gus", frontend: "ada" }, orbs: [{ id: "gus", specialty: "cto" }, { id: "ada", specialty: "frontend" }] });
  assert.equal(c.ceo, null);
  assert.deepEqual(c.branches, [{ family: "build", head: null, team: [{ kind: "frontend", lead: "ada", rest: [] }, { kind: "cto", lead: "gus", rest: [] }] }]);
  assert.deepEqual(chartOf({ leads: {}, orbs: [] }), { ceo: null, executive: [], branches: [] }, "an empty office: you alone");
});
