// PLAN 5.13_t, the rule the app and the home share (owner, 10-07: "for every section in recruiter they need to unlock,
// they need to hire the cfo for example first, but ceo and personal assistant is mandatory"): the app's copy gives the
// home's answers for every kind of work in every office along the way; and the rule itself: the CEO, then your
// assistant, before anyone; then the Executive; every other department with its head.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as home from "../../home/src/company.ts";
import * as app from "../src/orb/company.ts";
import { SPECIALTIES } from "../src/orb/spec.ts";

const OFFICES: string[][] = [[], ["ceo"], ["assistant"], ["ceo", "assistant"], ["ceo", "assistant", "cfo"], ["ceo", "assistant", "cto", "frontend"], ["ceo", "assistant", "coo", "cmo", "chiefofstaff", "cfo", "cto"]];

test("the app's rule is the home's, for every kind of work in every office along the way", () => {
  for (const office of OFFICES) {
    for (const k of Object.keys(SPECIALTIES)) assert.equal(app.whyNot(k, office), home.whyNot(k, office), `${k} in [${office}]`);
    assert.deepEqual(app.openDepartments(office), home.openDepartments(office), `[${office}]`);
    assert.equal(app.nextFounding(office), home.nextFounding(office));
  }
  assert.deepEqual(app.HEAD_OF, home.HEAD_OF);
});

test("the CEO, then your assistant, before anyone; then the Executive; every other department with its head", () => {
  assert.equal(app.whyNot("ceo", []), null, "the CEO first");
  assert.match(app.whyNot("assistant", []) ?? "", /Appoint your CEO first/);
  assert.match(app.whyNot("frontend", ["ceo"]) ?? "", /Appoint your personal assistant first/);
  assert.equal(app.whyNot("assistant", ["ceo"]), null, "then the assistant");
  assert.deepEqual(app.openDepartments(["ceo", "assistant"]), ["exec", "life"], "the Executive, and Life (its head the assistant)");
  assert.equal(app.whyNot("cfo", ["ceo", "assistant"]), null, "an executive, once the two are in");
  assert.match(app.whyNot("investor", ["ceo", "assistant"]) ?? "", /^Hire a CFO first: they open Finance\.$/);
  assert.equal(app.whyNot("investor", ["ceo", "assistant", "cfo"]), null, "Finance open with its CFO");
  assert.match(app.whyNot("frontend", ["ceo", "assistant", "cfo"]) ?? "", /Hire a CTO first: they open Build/);
  assert.equal(app.whyNot("tutor", ["ceo", "assistant"]), null, "Life is open: its head is the assistant");
});
