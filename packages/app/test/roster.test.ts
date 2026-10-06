// PLAN 3.9_t, the seam between the app and the home: the home cuts each orb's constitution by his
// specialty (packages/home/src/brain/constitution.ts), so its roster must be the app's, every
// specialty in the same family. A specialty added to one and not the other fails here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SPECIALTY_FAMILIES } from "../../home/src/brain/constitution.ts";
import { SPECIALTIES } from "../src/orb/spec.ts";

test("the home's roster is the app's: every specialty, in the same family", () => {
  const app = Object.fromEntries(Object.entries(SPECIALTIES).map(([k, v]) => [k, (v as { family: string }).family]));
  assert.deepEqual(app, { ...SPECIALTY_FAMILIES });
});

test("the home's seven traits are the app's DNA's (office life, PLAN 5.9: the app sends them by name)", async () => {
  const { TRAITS: home } = await import("../../home/src/social/rules.ts");
  const { TRAITS: app } = await import("../src/orb/dna.ts");
  assert.deepEqual([...home], [...app]);
});
