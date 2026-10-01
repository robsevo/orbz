// Child process for the durable-card test: asks for something that needs approval, says
// "card <id>" when the card opens (or "waiting <id>" once the run has ended waiting), and waits to
// be killed with SIGKILL.
import { Home } from "../../src/home.ts";

const [dataDir, modelUrl, when] = process.argv.slice(2);
if (!dataDir || !modelUrl) throw new Error("usage: card-then-die.ts <dataDir> <modelUrl> [opened|waiting]");
const home = Home.open({
  dataDir,
  protect: [],
  spendCapUsd: null,
  brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: modelUrl, model: "m", retries: 0 }, teacher: null } },
});
home.inbox.addOrb("juniper", "Juniper");
home.events.listen((e) => {
  if (when !== "waiting" && e.type === "card.opened") {
    process.stdout.write(`card ${e.data.card}\n`);
    // Hold the run right here, inside the step that opened the card, so the kill lands before the
    // run is recorded as ended: the restart must find an interrupted run, not a finished one.
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      // busy on purpose
    }
  }
  if (when === "waiting" && e.type === "run.finished" && e.data.outcome === "waiting") {
    process.stdout.write(`waiting ${home.conversations.openCard("chat:1")?.id}\n`);
  }
});
home.start();
home.inbox.send("juniper", "chat:1", "write the marker");
setInterval(() => {}, 60_000);
