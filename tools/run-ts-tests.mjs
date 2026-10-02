// Runs every TypeScript test with node:test. `node --test <glob>` exits 0 when the glob matches
// nothing, so a moved or misnamed suite would pass silently; here zero test files is a failure.
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { availableParallelism } from "node:os";

const files = globSync("packages/*/test/**/*.test.ts");
if (files.length === 0) {
  console.error("no TypeScript tests found under packages/*/test — an empty suite is not a pass");
  process.exit(1);
}
// A test that hangs fails after two minutes instead of holding the gate (a planted defect that
// makes a supervisor spin, or a run that never ends, must turn the gate red, not keep it waiting).
// Two, not one: the app's picture tests draw every thumbnail in software WebGL, and with the other
// suites drawing at once some honestly take more than a minute (10-02).
// Half the cores at once, not all of them: most app suites draw in their own Chromium (software
// WebGL), and eleven at once on twelve cores starved each other until long tests ran past their
// minute (10-02). Fewer at once finishes about as soon, and each test runs at its own pace.
const at = Math.max(2, Math.floor(availableParallelism() / 2));
const run = spawnSync(process.execPath, ["--test", "--test-timeout=120000", `--test-concurrency=${at}`, ...files], { stdio: "inherit" });
process.exit(run.status ?? 1);
