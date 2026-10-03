// PLAN 4.2_t, the one-click catalog: every program in it is pinned to one release (so nothing
// pushed tomorrow runs unasked), every address is HTTPS, every preset fills the form the home
// accepts, and the pin check itself refuses what floats.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, pinned } from "../src/home/catalog.ts";

test("every program in the catalog is pinned; every address is HTTPS; each one once", () => {
  assert.ok(CATALOG.length > 0);
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length, "each preset once");
  for (const c of CATALOG) {
    if (c.kind === "url") assert.match(c.where, /^https:\/\//, `${c.id}: HTTPS only`);
    else {
      assert.ok(pinned(c.where), `${c.id}: pinned to one release (${c.where})`);
      assert.ok(/^(npx|uvx) /.test(c.where), `${c.id}: run by a package runner the person has`);
    }
    if (c.fill) assert.ok(c.where.includes("/path/to/"), `${c.id}: what to fill in is there to see`);
  }
});

test("the pin check refuses what floats (its control)", () => {
  for (const floats of ["npx -y @modelcontextprotocol/server-memory", "npx -y @scope/pkg@latest", "uvx mcp-server-time", "uvx mcp-server-time>=1.0", "npx -y"]) {
    assert.equal(pinned(floats), false, floats);
  }
  for (const holds of ["npx -y @modelcontextprotocol/server-memory@2026.8.31", "uvx mcp-server-git==2026.8.18 --repository /x", "/usr/local/bin/my-server --flag"]) {
    assert.equal(pinned(holds), true, holds);
  }
});
