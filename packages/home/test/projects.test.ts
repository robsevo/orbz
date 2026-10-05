// Your projects folder (owner, 10-04: "all projects should also go into a file, add that in settings, that we
// can add that"): every session's and every orb's files copied to a folder of yours after a run, and on
// asking; changed files again, nothing deleted; a folder must be a whole path and not in the home's data;
// off, nothing is copied; a test home starts off.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { workspaceOf } from "../src/workspace.ts";
import { agentHome } from "./helpers.ts";

test("every project's files go to your folder, by name; changed files again; nothing deleted", async (t) => {
  const h = await agentHome(t, []);
  const out = mkdtempSync(join(tmpdir(), "orbs-projects-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(h.home.projects.state().on, false, "a test home starts with it off");
  h.home.inbox.addOrb("basil", "Basil", "chef");
  const ws = workspaceOf(h.dataDir, "basil");
  mkdirSync(join(ws, "recipes"), { recursive: true });
  writeFileSync(join(ws, "recipes", "lemon-chicken-for-5.md"), "# Lemon chicken pasta, for 5\n");
  const session = h.home.team.create("Pumpkin Week", { brainstorm: ["basil"], floor: ["basil"] });
  mkdirSync(h.home.sessionWorkspace(session.id), { recursive: true });
  writeFileSync(join(h.home.sessionWorkspace(session.id), "poster.html"), "<h1>Pumpkin Week</h1>");
  // controls: off, nothing; a relative path, the home's own data: refused
  assert.equal(h.home.projects.sync(), 0);
  assert.throws(() => h.home.projects.set({ dir: "Orbz Projects" }), /whole path/);
  assert.throws(() => h.home.projects.set({ dir: join(h.dataDir, "inside") }), /home's own data/);
  // on: copied, each under its name
  const s = h.home.projects.set({ dir: out, on: true });
  assert.equal(s.last?.files, 2);
  assert.equal(readFileSync(join(out, "Basil's work", "recipes", "lemon-chicken-for-5.md"), "utf8"), "# Lemon chicken pasta, for 5\n");
  assert.equal(readFileSync(join(out, "Pumpkin Week", "poster.html"), "utf8"), "<h1>Pumpkin Week</h1>");
  // nothing new, nothing copied; a changed file, again; a file gone from the workspace stays in the folder
  assert.equal(h.home.projects.sync(), 0);
  writeFileSync(join(ws, "recipes", "lemon-chicken-for-5.md"), "# Lemon chicken pasta, for 6\n");
  assert.equal(h.home.projects.sync(), 1);
  assert.match(readFileSync(join(out, "Basil's work", "recipes", "lemon-chicken-for-5.md"), "utf8"), /for 6/);
  rmSync(join(h.home.sessionWorkspace(session.id), "poster.html"));
  h.home.projects.sync();
  assert.ok(existsSync(join(out, "Pumpkin Week", "poster.html")), "never deletes in your folder");
  // after a run finishes, by itself (a moment later)
  writeFileSync(join(ws, "shopping-list.md"), "- 3 chicken breasts\n");
  h.home.events.append("run.finished", { outcome: "ok" }, { orb: "basil", conversation: "chat:basil" });
  for (let i = 0; i < 40 && !existsSync(join(out, "Basil's work", "shopping-list.md")); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(join(out, "Basil's work", "shopping-list.md")), "a run finished: its files are in your folder");
  // through the door
  const d = await serve(h.home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json", "x-orbs": "1" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.equal(((await call("GET", "/projects")).json.projects as { dir: string }).dir, out);
  assert.equal((await call("POST", "/projects", { dir: "relative/path" })).status, 400);
  assert.equal(((await call("POST", "/projects", { on: false })).json.projects as { on: boolean }).on, false);
  assert.equal(((await call("POST", "/projects/sync")).json.projects as { on: boolean }).on, false);
});
