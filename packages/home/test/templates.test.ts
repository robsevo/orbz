// PLAN 3.2_t (plan templates): plans you approve the same way become a template, the same way
// habits do, and a template's plan passes the gate.
//   - Three approved plans with the same features in the same order: a template (the newest, its
//     boxes back to [ ]), passed by the gate with nothing to say. Two are not enough; a declined
//     plan is not approved.
//   - A shape whose newest plan the gate objects to is not a template, and says why.
//   - The night keeps each once; the orb reads them with `plan_templates`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gate } from "../src/plans/gate.ts";
import { Gym } from "../src/gym/night.ts";
import { shapeOfPlan, templatesFor, templatesOf } from "../src/gym/templates.ts";
import { agentHome } from "./helpers.ts";

const page = (who: string, more = "") => `# A landing page for ${who}

### PHASE 1 — The page

| # | Feature | Description | Done |
|---|---|---|---|
| 1.1 | Hero | the headline and the button${more} | [x] |
| 1.1_t | Tests: hero | the headline renders; the button links to sign-up | [x] |
| 1.2 | Pricing | three plans side by side | [~] |
| 1.2_t | Tests: pricing | each plan shows its price at phone width | [~] |

It does not touch the checkout. Each row is verified by the test under it.
`;

const shop = (who: string) => `# A shop for ${who}

### PHASE 1 — The shop

| # | Feature | Description | Done |
|---|---|---|---|
| 1.1 | Catalogue | the products, from \`src/catalogue.tsx\` | [x] |
| 1.1_t | Tests: catalogue | every product shows | [x] |
| 1.2 | Basket | add and remove | [x] |
| 1.2_t | Tests: basket | the total adds up | [x] |

Each row is verified by the test under it.
`;

test("three approved the same way make a template the gate passes; two do not; a shape the gate objects to says why", async (t) => {
  const { home } = await agentHome(t, []);
  assert.deepEqual([gate(page("x"), { roots: [] }).hard, gate(page("x"), { roots: [] }).soft], [[], []], "the fixture is a plan the gate passes");
  const shown = (body: string, status: "approved" | "declined" = "approved") => {
    const p = home.plans.archive({ orb: "juniper", conversation: "chat:juniper", card: 1, body, shown: body, objections: [] });
    home.plans.mark(p.id, status);
    return p.id;
  };
  shown(page("Ada"));
  shown(page("Bo"), "declined");
  shown(page("Cy"));
  assert.deepEqual(templatesOf(home.plans.list(), "juniper").templates, [], "two approved: not yet");
  shown(page("Di", ", and a short line under it"));
  shown(shop("Ed"));
  shown(shop("Flo"));
  shown(shop("Gus"));
  const { templates, refused } = templatesOf(home.plans.list(), "juniper");
  assert.equal(shapeOfPlan(page("Ada")), "hero > pricing");
  assert.deepEqual(templates.map((x) => [x.shape, x.title, x.plans.length]), [["hero > pricing", "A landing page for Di", 3]], "the newest of them, its words and all");
  assert.ok(templates[0]!.body.includes("and a short line under it"));
  assert.ok(!/\[(x|~)\]/.test(templates[0]!.body), "its boxes back to [ ]");
  assert.deepEqual([gate(templates[0]!.body, { roots: [] }).hard, gate(templates[0]!.body, { roots: [] }).soft], [[], []], "a template's plan passes the gate");
  assert.deepEqual(refused.map((r) => r.shape), ["catalogue > basket"]);
  assert.match(refused[0]!.why.join(" "), /never states its BOUNDARY/, "approved three times, but the gate still has something to say");
});

test("the night keeps each template once; the orb reads its own with plan_templates", async (t) => {
  const { home, model } = await agentHome(t, [{ calls: [{ name: "plan_templates", args: {} }] }, { chunks: ["I'll start from the landing page."] }]);
  for (const who of ["Ada", "Bo", "Cy"]) {
    const p = home.plans.archive({ orb: "juniper", conversation: "chat:juniper", card: 1, body: page(who), shown: page(who), objections: [] });
    home.plans.mark(p.id, "approved");
  }
  const gym = new Gym({
    events: home.events, clock: home.clock, dataDir: home.dataDir, kit: async () => ({}), teacher: () => null,
    orbs: () => [{ id: "juniper", specialty: "frontend" }, { id: "milo", specialty: "writing" }], plans: () => home.plans.list(),
  });
  assert.deepEqual((await gym.night()).templates, ["juniper: A landing page for Cy"]);
  assert.deepEqual((await gym.night()).templates, [], "kept once");
  assert.deepEqual(templatesFor(home.events, "milo"), [], "his are his");
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "another landing page, for Zed");
  await home.inbox.idle();
  const result = home.conversations.history("chat:juniper").find((m) => m.role === "tool")!;
  assert.match(result.content ?? "", /^## Template: A landing page for Cy\n\n# A landing page for Cy/);
  assert.equal(model.agent.length, 2);
});
