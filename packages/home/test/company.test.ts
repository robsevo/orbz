// PLAN 5.13_t and 5.14_t, the company, on a real home (owner, 10-07: "Your first orb is the CEO, you must appoint one
// before apointing any orbs, and a personal assistant"; "for every section in recruiter they need to unlock, they need
// to hire the cfo for example first, but ceo and personal assistant is mandatory"; "these two work in tandem"; "the role
// of the CFO is to keep all info there for you"):
//   - the door takes the CEO first, then your assistant, then each department's people only with its head; a refusal
//     says why, and so do a position opened and an applicant hired;
//   - each is told its part: the CEO and the assistant in tandem, the CFO the books, a money orb its CFO, everyone the
//     company and its Founder; nothing before there is a company (control);
//   - a bill is the CFO's to keep, a reminder the assistant's;
//   - your company's name is kept, beside yours.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { companyLine } from "../src/company.ts";
import { agentHome } from "./helpers.ts";

test("the door: the CEO first, then your assistant, then each department with its head; a refusal says why", async (t) => {
  const { home } = await agentHome(t, []);
  home.inbox.letGo("juniper"); // an empty office
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const hire = (id: string, specialty: string) => call("POST", "/orbs", { id, name: id[0]!.toUpperCase() + id.slice(1), specialty, look: {} });
  let r = await hire("ada", "frontend");
  assert.deepEqual([r.status, r.json.error], [409, "Appoint your CEO first: your CEO and your personal assistant come before anyone else."]);
  assert.equal((await hire("pip", "assistant")).status, 409, "not even the assistant before the CEO");
  assert.equal((await hire("max", "ceo")).status, 200, "the CEO first");
  assert.equal((await hire("ada", "frontend")).status, 409, "then your assistant");
  assert.equal((await hire("pip", "assistant")).status, 200);
  r = await hire("ada", "frontend");
  assert.deepEqual([r.status, r.json.error], [409, "Hire a CTO first: they open Build."]);
  assert.equal((await hire("tia", "tutor")).status, 200, "Life is open: its head is your assistant");
  assert.equal((await call("PUT", "/recruiter/positions/investor", { open: true })).status, 409, "a position too: Finance needs its CFO");
  assert.equal((await call("PUT", "/recruiter/positions", { specialties: ["cfo", "investor"], open: true })).status, 409, "and in a list");
  assert.equal((await call("PUT", "/recruiter/positions/cfo", { open: true })).status, 200, "the CFO's position is the Executive's, open");
  assert.equal((await hire("ivy", "cto")).status, 200, "an executive");
  assert.equal((await hire("ada", "frontend")).status, 200, "and Build is open with its CTO");
  // an applicant is held to it too
  const cfoApplicant = home.recruiting().applicants.find((a) => a.specialty === "cfo")!;
  home.recruiter.setPosition("crypto", true); // opened past the door, as the home's own test may
  const crypto = home.recruiting().applicants.find((a) => a.specialty === "crypto")!;
  assert.equal((await call("POST", `/applicants/${crypto.id}/hire`, { id: "coin", name: "Coin", look: {} })).status, 409, "no money orb without a CFO");
  assert.equal((await call("POST", `/applicants/${cfoApplicant.id}/hire`, { id: "fin", name: "Fin", look: {} })).status, 200);
  assert.equal((await call("POST", `/applicants/${crypto.id}/hire`, { id: "coin", name: "Coin", look: {} })).status, 200, "with one, it can");
});

test("each is told its part: the CEO and the assistant in tandem, the CFO the books, a money orb its CFO; nothing before a company", async (t) => {
  const office = [{ id: "max", name: "Max", specialty: "ceo" }, { id: "pip", name: "Pip", specialty: "assistant" }, { id: "fin", name: "Fin", specialty: "cfo" }, { id: "coin", name: "Coin", specialty: "crypto" }, { id: "ada", name: "Ada", specialty: "frontend" }];
  const at = (id: string) => companyLine({ me: office.find((o) => o.id === id)!, founder: "Robin", company: "Acme Orbs", office })!;
  assert.match(at("ada"), /^The company, Acme Orbs: Robin is its Founder; Max is the CEO and runs it; Pip is Robin's personal assistant; Fin is the CFO and keeps the books\. Take direction from the CEO and follow what the board decides\.$/m);
  // what the company can spend (PLAN 5.20, owner 10-08), for its work: never said is nothing, and nothing is free tools
  assert.match(at("ada"), /^Robin has not said yet what Acme Orbs can spend, so take it as nothing\. The company's work uses free tools and free tiers only, and signs up for nothing paid\.$/m);
  const spends = (budget: { start: number; month: number }) => companyLine({ me: office[4]!, founder: "Robin", company: "Acme Orbs", budget, office })!;
  assert.match(spends({ start: 0, month: 0 }), /^Acme Orbs has no money to spend yet\. The company's work uses free tools and free tiers only/m);
  assert.match(spends({ start: 50, month: 20 }), /^Acme Orbs can spend up to \$50 to start and \$20 a month in all, on hosting, tools and ads\. Anything the company's work costs is Robin's yes first\.$/m);
  assert.match(at("max"), /You are the CEO\. Pip keeps Robin's day and brings you what the company should do: take it, decide who does it[\s\S]*send Robin the result through Pip[\s\S]*You chair the board\./);
  assert.match(at("pip"), /You are Robin's personal assistant: you keep their day[\s\S]*Hand what is company work[\s\S]*to the CEO, Max, with ask_orb[\s\S]*the board's secretary/);
  assert.match(at("fin"), /You are the CFO: you keep every money record[\s\S]*books\/[\s\S]*Coin reports to you\.[\s\S]*Every payment, trade and transfer is Robin's yes\. You are the board's treasurer\./);
  assert.match(at("coin"), /You report to the CFO, Fin: whatever you learn or do with money, send Fin a one-line record for the books/);
  assert.equal(companyLine({ me: office[4]!, founder: "Robin", office: [office[4]!] }), null, "no company yet: nothing said (control)");

  // in a run's standing context, with the company's name kept by the home
  const { home, model } = await agentHome(t, [{ chunks: ["ok"] }, { chunks: ["ok"] }]);
  home.about.setName("Robin");
  home.about.setCompany("Acme Orbs");
  home.inbox.addOrb("max", "Max", "ceo");
  home.inbox.addOrb("pip", "Pip", "assistant");
  home.inbox.send("pip", "chat:pip", "hi");
  await home.inbox.idle();
  assert.match(String(model.agent[0]![0]!.content), /The company, Acme Orbs: Robin is its Founder; Max is the CEO[\s\S]*Robin has not said yet what Acme Orbs can spend[\s\S]*You are Robin's personal assistant/);
  assert.deepEqual(home.about.get().company, "Acme Orbs");
  // the budget changed (owner, 10-08: "Lets be able to change the budget as well"): the next turn hears it
  home.about.setBudget({ start: 50, month: 20 });
  home.inbox.send("pip", "chat:pip", "and now?");
  await home.inbox.idle();
  assert.match(String(model.agent[1]![0]!.content), /Acme Orbs can spend up to \$50 to start and \$20 a month in all/);
});

test("your company's name, through the door, is kept beside yours", async (t) => {
  const { home } = await agentHome(t, []);
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const r = await fetch(`http://127.0.0.1:${d.port}/me`, { method: "PUT", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Robin", company: "Acme Orbs" }) });
  assert.equal(r.status, 200);
  assert.deepEqual([home.about.get().name, home.about.get().company], ["Robin", "Acme Orbs"]);
});

test("a bill is the CFO's to keep, a reminder the assistant's", async (t) => {
  const { home } = await agentHome(t, []);
  home.inbox.addOrb("max", "Max", "ceo");
  home.inbox.addOrb("pip", "Pip", "assistant");
  home.inbox.addOrb("ada", "Ada", "frontend");
  assert.equal(home.plannerFor("ada", "bill").id, "pip", "no CFO yet: the assistant keeps it");
  home.inbox.addOrb("fin", "Fin", "cfo");
  assert.equal(home.plannerFor("ada", "bill").id, "fin", "with a CFO: the CFO keeps every money record");
  assert.equal(home.plannerFor("max", "bill").id, "fin");
  assert.equal(home.plannerFor("ada", "reminder").id, "pip", "a reminder stays the assistant's");
});
