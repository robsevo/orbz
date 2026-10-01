// `pnpm start [--data DIR]`: the headless home, one command, on this computer or any always-on box.
// Data lives in --data, else $ORBS_HOME, else ~/.orbs. The door's port and token go to
// <data>/home.json. Exit codes: 0 stopped cleanly, 3 another home already holds the data directory.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "./api.ts";
import { HomeLockedError } from "./db.ts";
import { Home } from "./home.ts";
import type { Runner } from "./inbox.ts";
import { version } from "./version.ts";

// `pnpm start -- --data DIR` hands the "--" through; read past it.
const argv = process.argv.slice(2);
const { values } = parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options: { data: { type: "string" } } });
const dataDir = values.data ?? process.env.ORBS_HOME ?? join(homedir(), ".orbs");

// The agent loop arrives with PLAN 1.4-1.5. Until then a run says so instead of pretending.
const runner: Runner = {
  async run(ctx) {
    ctx.activity("no brain is wired in yet (PLAN 1.4)");
    return { summary: "no brain yet" };
  },
};

let home: Home;
try {
  home = Home.open({ dataDir, runner });
} catch (e) {
  if (e instanceof HomeLockedError) {
    console.error(e.message);
    process.exit(3);
  }
  throw e;
}
home.start();
const door = await serve(home);
console.log(`orbs home ${version} ready on http://127.0.0.1:${door.port} (data ${home.dataDir}, pid ${process.pid})`);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`orbs home stopping (${signal})`);
  await door.close();
  await home.close();
  process.exit(0);
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
