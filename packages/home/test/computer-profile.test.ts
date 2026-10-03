// PLAN 4.1_t: "your Chrome profile is untouched". This whole file runs as if a scratch folder were
// your home (HOME, before anything else is opened), with a Chrome and a Chromium profile in it, so
// that whatever goes wrong here, nothing can reach the real one:
//   - his browser runs on a profile of its own, in the home's data, and with a home folder of its
//     own: nothing in yours changes, not a byte, not a new file;
//   - it is started with its own HOME, and none of the home's own variables (which can hold keys);
//   - his profile keeps his sign-ins across a sleep, and a reset ends them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { chromiumPath, profileOf } from "../src/computer/browser.ts";
import { agentHome } from "./helpers.ts";
import { web } from "./fakes/web.ts";

const EXE = chromiumPath(); // found in the real home, before it is swapped
if (!EXE) throw new Error("no Chromium for his browser: set ORBS_CHROME, or `npx playwright install chromium`");
const PERSON = mkdtempSync(join(tmpdir(), "orbs-person-"));
process.env.HOME = PERSON;
process.env.ORBS_TEST_KEY = "sk-dummy-but-key-shaped-5678"; // a key in the home's own environment
process.on("exit", () => rmSync(PERSON, { recursive: true, force: true }));

/** Every file under `dir`, by its path, as a hash and a time: to prove a folder is untouched. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash("sha256").update(readFileSync(p)).digest("hex") + ":" + statSync(p).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

/** The environments of the processes started on his profile (Linux shows them in /proc): the
 * browser itself and its crash handlers. Its renderers, GPU and utility processes are left out:
 * Chromium's sandbox starts them with their environment cleared. */
function browserEnvs(profile: string): string[][] {
  const out: string[][] = [];
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmd.includes(profile) || cmd.includes("--type=")) continue;
      out.push(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean));
    } catch {
      // gone, or not ours to read
    }
  }
  return out;
}

test("his browser is his own: your Chrome profile and your home are untouched; his keeps his sign-ins across a sleep, and a reset ends them", { timeout: 120_000 }, async (t) => {
  const site = await web(t);
  for (const browser of ["google-chrome", "chromium"]) {
    mkdirSync(join(PERSON, ".config", browser, "Default"), { recursive: true });
    writeFileSync(join(PERSON, ".config", browser, "Default", "Preferences"), '{"the_person": true}');
    writeFileSync(join(PERSON, ".config", browser, "Default", "Cookies"), "the person's cookies");
  }
  const before = snapshot(PERSON);
  const { home, dataDir } = await agentHome(t, [], { computer: { executable: EXE } });
  await home.computers.open("juniper", site.url("shop.test", "/cookie"));
  assert.match((await home.computers.read("juniper")).text, /cookie: none/);
  if (process.platform === "linux") {
    const envs = browserEnvs(profileOf(dataDir, "juniper"));
    assert.ok(envs.length > 0, "his browser is running, on his profile");
    for (const env of envs) {
      assert.ok(env.some((v) => v.startsWith(`HOME=${join(dataDir, "orbs", "juniper")}`)), `started with a home of its own: ${env.find((v) => v.startsWith("HOME="))}`);
      assert.ok(!env.some((v) => v === `HOME=${PERSON}`), "never yours");
      assert.ok(!env.some((v) => v.startsWith("ORBS_TEST_KEY=")), "and none of the home's own variables, which can hold keys");
    }
  }
  await home.computers.sleep("juniper");
  assert.equal(home.computers.awake("juniper"), false);
  await home.computers.open("juniper", site.url("shop.test", "/cookie"));
  assert.match((await home.computers.read("juniper")).text, /cookie: seen=1/, "his profile kept the site's cookie across a sleep");
  assert.ok(existsSync(profileOf(dataDir, "juniper")), "his profile is in the home's data");
  await home.computers.reset("juniper");
  assert.equal(existsSync(profileOf(dataDir, "juniper")), false, "reset: his profile is gone");
  await home.computers.open("juniper", site.url("shop.test", "/cookie"));
  assert.match((await home.computers.read("juniper")).text, /cookie: none/, "a fresh browser: signed out everywhere");
  await home.computers.sleep("juniper");
  assert.deepEqual(snapshot(PERSON), before, "nothing in your home changed: not a byte, not a new file");
  assert.deepEqual(home.events.ofType("computer.reset").map((e) => (e.data as { orb: string }).orb), ["juniper"]);
});
