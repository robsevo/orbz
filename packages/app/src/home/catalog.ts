// The one-click catalog (PLAN 4.2): connectors worth having, each filling in the connector form so
// you see exactly what will run, or where it connects, before you add it. Every program is pinned
// to an exact release, at least a week old when it was pinned (as the repo's own packages are), so a
// release pushed tomorrow never runs on your machine unasked. A connector's tools still ask before
// each use. Pure, so `node --test` can read it.

export type Preset = {
  id: string;
  title: string;
  /** What it lets your orbs do, in a few words. */
  what: string;
  kind: "url" | "command";
  /** The address, or the command line (a {folder} for you to fill in is said so in `fill`). */
  where: string;
  /** What to put where, if anything: shown under the form. */
  fill?: string;
  /** The secret it needs, if any: what it is called in the form. */
  secret?: string;
};

export const CATALOG: Preset[] = [
  {
    id: "github", title: "GitHub", what: "your repositories, issues and pull requests", kind: "url",
    where: "https://api.githubcopilot.com/mcp/", secret: "A GitHub token (Settings, Developer settings, fine-grained tokens)",
  },
  {
    id: "folder", title: "A folder", what: "read and change the files in one folder you choose", kind: "command",
    where: "npx -y @modelcontextprotocol/server-filesystem@2026.8.31 /path/to/the/folder", fill: "Put the folder's path at the end, in place of /path/to/the/folder.",
  },
  {
    id: "git", title: "Git", what: "a repository's history, branches and changes", kind: "command",
    where: "uvx mcp-server-git==2026.8.18 --repository /path/to/the/repository", fill: "Put the repository's path at the end, in place of /path/to/the/repository.",
  },
  { id: "time", title: "Time zones", what: "the time anywhere, and converting between zones", kind: "command", where: "uvx mcp-server-time==2026.8.18" },
];

/** Whether every program in a command line is pinned to one release (npx pkg@x.y.z, uvx pkg==x.y.z). */
export function pinned(where: string): boolean {
  const words = where.split(/\s+/);
  const at = words.findIndex((w) => w === "npx" || w === "uvx");
  if (at < 0) return true; // no package runner: nothing fetched
  const pkg = words.slice(at + 1).find((w) => !w.startsWith("-"));
  if (!pkg) return false;
  return words[at] === "npx" ? /^(@[^/]+\/)?[^@]+@\d+(\.\d+)+$/.test(pkg) : /^[A-Za-z0-9_.-]+==\d+(\.\d+)+$/.test(pkg);
}
