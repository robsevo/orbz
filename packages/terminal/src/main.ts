#!/usr/bin/env node
// `pnpm orbs [--data DIR] [--orb ID] [--chat ID]`: the terminal for a running home (PLAN 1.9), for
// dogfooding before the app. It finds the home through `<data>/home.json` (the same --data, then
// $ORBS_HOME, then ~/.orbs as `pnpm start`), wakes the orb on the splash, then opens the chat.
// --orb names the orb (it is made if this home has none by that name); without it, the first orb.
// Exit codes: 0 left, 2 nothing to talk to, 3 no home answering.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import React from "react";
import { render } from "ink";
import { App } from "./app.ts";
import { type Card, HomeClient, type Message, NoHomeError, type Orb, type Status } from "./client.ts";
import { playSplash } from "./splash.ts";

const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: { data: { type: "string" }, orb: { type: "string" }, chat: { type: "string" } },
});
const dataDir = values.data ?? process.env.ORBS_HOME ?? join(homedir(), ".orbs");
const conversation = values.chat ?? "chat:main";

function fail(code: number, message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

let client: HomeClient;
let status: Status;
try {
  client = HomeClient.find(dataDir);
  status = await client.get<Status>("/status");
} catch (e) {
  if (e instanceof NoHomeError) fail(3, e.message);
  throw e;
}

let orb: Orb | undefined = values.orb ? status.orbs.find((o) => o.id === values.orb) : status.orbs[0];
if (!orb && values.orb) {
  const id = values.orb;
  const made = await client.post<{ orb: Orb }>("/orbs", { id, name: id.charAt(0).toUpperCase() + id.slice(1) });
  orb = { ...made.orb, queued: 0 };
}
if (!orb) fail(2, `this home has no orbs yet: \`pnpm orbs --orb <name>\` makes one`);

const plan = await client
  .get<{ chatgpt: { connected: boolean; sharing: boolean; account: { email: string | null } | null } }>("/chatgpt")
  .then((r) => r.chatgpt)
  .catch(() => null);
const brain = plan?.connected && plan.sharing
  ? { text: `ChatGPT plan${plan.account?.email ? ` · ${plan.account.email}` : ""}`, plan: true }
  : { text: "/chatgpt: your ChatGPT plan", plan: false };
const first = await client.get<{ messages: Message[]; cards: Record<string, string>; card: Card | null }>(`/conversations/${encodeURIComponent(conversation)}/messages`);
const tty = Boolean(process.stdout.isTTY);
const port = new URL(client.base).port;
await playSplash(
  process.stdout,
  {
    orb: orb.name,
    version: status.version,
    door: `127.0.0.1:${port}`,
    online: true,
    kit: status.kit?.state ?? null,
    brain,
    dataDir: status.dataDir,
    chat: `${conversation} · ${first.messages.length ? `${first.messages.length} messages` : "new"}`,
  },
  { animate: tty && process.env.ORBS_BOOT !== "0", color: tty && !process.env.NO_COLOR },
);

// Raw mode before the first frame, not after it as Ink would: a key typed the moment the prompt
// shows must not be echoed by the terminal's line mode, which also turns its Enter into a newline.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const app = render(
  React.createElement(App, {
    client,
    orb,
    conversation,
    since: status.seq,
    history: first.messages,
    cards: first.cards,
    card: first.card,
    kit: status.kit?.state ?? null,
  }),
  { exitOnCtrlC: false, patchConsole: false },
);
await app.waitUntilExit();
process.exit(0);
