// `pnpm start [--data DIR] [--brain ash-router] [--name NAME --cert FILE --key FILE [--remote-port N]]`:
// the headless home, one command, on this computer or any always-on box. With a name and its
// certificate (a domain's, or a private network's such as Tailscale's `tailscale cert`), it opens a
// second door for the person's other devices (PLAN 2.7): HTTPS on that name only.
// Data lives in --data, else $ORBS_HOME, else ~/.orbs. The door's port and token go to
// <data>/home.json. Exit codes: 0 stopped cleanly, 3 another home already holds the data directory.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "./api.ts";
import { HomeLockedError } from "./db.ts";
import { Home } from "./home.ts";
import { ashRouter, type Preset } from "./brain/presets.ts";
import { version } from "./version.ts";

// `pnpm start -- --data DIR` hands the "--" through; read past it.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    data: { type: "string" }, brain: { type: "string" },
    name: { type: "string", multiple: true }, cert: { type: "string" }, key: { type: "string" }, "remote-port": { type: "string" },
  },
});
const dataDir = values.data ?? process.env.ORBS_HOME ?? join(homedir(), ".orbs");

// The brain (PLAN 1.4): until the setup wizard (2.5) stores a choice, it is named here.
// Without one, an orb says in the chat that no brain is set up.
const presets: Record<string, () => Preset> = { "ash-router": () => ashRouter() };
const choice = values.brain ?? process.env.ORBS_BRAIN_PRESET;
if (choice && !presets[choice]) {
  console.error(`unknown --brain ${choice}; known: ${Object.keys(presets).join(", ")}`);
  process.exit(2);
}

// the second door: a name, and the certificate and key for it, or nothing at all
const names = values.name ?? (process.env.ORBS_REMOTE_NAME ? process.env.ORBS_REMOTE_NAME.split(",") : []);
const certFile = values.cert ?? process.env.ORBS_REMOTE_CERT;
const keyFile = values.key ?? process.env.ORBS_REMOTE_KEY;
if (names.length && (!certFile || !keyFile)) {
  console.error("--name needs --cert and --key: the second door is HTTPS only (a domain's certificate, or `tailscale cert NAME`)");
  process.exit(2);
}
const remotePort = Number(values["remote-port"] ?? process.env.ORBS_REMOTE_PORT ?? 8443);
// the app's own door on this machine: the same port each start (the browser keeps your theme and the rest by
// address), unless it is taken; ORBS_PORT=0 for any
const localPort = Number(process.env.ORBS_PORT ?? 47070);

let home: Home;
try {
  home = Home.open({ dataDir, kit: true, projects: { on: true }, ...(choice && { brain: { preset: presets[choice]!() } }) });
} catch (e) {
  if (e instanceof HomeLockedError) {
    console.error(e.message);
    process.exit(3);
  }
  throw e;
}
home.start();
home.projects.sync(); // your projects folder has what there is at once, then after every finished run
const door = await serve(home, { port: localPort, portFallback: true, ...(names.length && { remote: { names, cert: readFileSync(certFile!), key: readFileSync(keyFile!), port: remotePort } }) });
console.log(`orbs home ${version} ready on http://127.0.0.1:${door.port} (data ${home.dataDir}, pid ${process.pid})`);
// the app, on this machine: a link good once, for five minutes (PLAN 2.4)
console.log(`open the app: ${door.pairLink()}`);
if (door.remote) console.log(`for your other devices: https://${names[0]}${door.remote.port === 443 ? "" : `:${door.remote.port}`}/app/ (pair a phone from Settings, or sign in with your passkey)`);

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
