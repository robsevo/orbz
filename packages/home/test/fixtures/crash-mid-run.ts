// Child process for the crash test: starts a run that never ends, queues one more message behind
// it, says "running", and waits to be killed with SIGKILL.
import { Home } from "../../src/home.ts";

const dataDir = process.argv[2];
if (!dataDir) throw new Error("usage: crash-mid-run.ts <dataDir>");
let started!: () => void;
const running = new Promise<void>((r) => (started = r));
const home = Home.open({
  dataDir,
  protect: [],
  runner: {
    run: () => {
      started();
      return new Promise(() => {});
    },
  },
});
home.inbox.addOrb("juniper", "Juniper");
home.inbox.send("juniper", "chat:1", "the job that was cut off");
await running;
home.inbox.send("juniper", "chat:1", "sent after it");
process.stdout.write("running\n");
setInterval(() => {}, 60_000);
