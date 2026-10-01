// Runs every TypeScript test with node:test. `node --test <glob>` exits 0 when the glob matches
// nothing, so a moved or misnamed suite would pass silently; here zero test files is a failure.
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const files = globSync("packages/*/test/**/*.test.ts");
if (files.length === 0) {
  console.error("no TypeScript tests found under packages/*/test — an empty suite is not a pass");
  process.exit(1);
}
const run = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(run.status ?? 1);
