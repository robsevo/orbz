// Opens a link in the person's browser (the ChatGPT sign-in, PLAN 1.10). $ORBS_OPEN names another
// opener (a test's stand-in, a browser of the person's choosing). A failure to open is not an
// error: the link is always printed too.
import { spawn } from "node:child_process";

export function openUrl(url: string): void {
  const custom = process.env.ORBS_OPEN;
  const [cmd, ...args] = custom
    ? [custom]
    : process.platform === "darwin"
      ? ["open"]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", '""']
        : ["xdg-open"];
  try {
    const c = spawn(cmd!, [...args, url], { stdio: "ignore", detached: true });
    c.on("error", () => {});
    c.unref();
  } catch {
    // printed; the person can open it
  }
}
