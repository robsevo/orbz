import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { version } from "../src/index.ts";

test("the home reports its own package version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(version, pkg.version);
});
