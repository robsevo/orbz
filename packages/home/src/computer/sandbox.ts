// His own sandbox (PLAN 4.6): every command he runs (and the home's own run of a row's test) runs
// inside it. On Linux it is bubblewrap:
//
//   the machine's own files              read only (its programs, its libraries)
//   /home, /root, /mnt, /media, /srv     emptied: nobody's files, the box's own included
//   /run/user                            emptied: no session's sockets (D-Bus, so no keyring)
//   the home's data                      emptied: no other orb's work, no keys, no database
//   his workspace and a home of his own  bound back, writable: the only places he can change
//   the folders on PATH                  bound back read only, so his commands still find their tools
//   the network                          kept: a command can still fetch a package
//   his process tree                     in a namespace of its own, gone the moment the run is
//   the environment                      cleared: the home's own variables can hold keys
//
// Where there is no bubblewrap that works (macOS, Windows, a container without user namespaces),
// a command runs as it always did, under the rules and the floor, and the home says so once.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { delimiter, resolve, sep } from "node:path";

export type Argv = [string, string[]];
export type Wrap = (argv: Argv) => Argv;

/** The places a sandbox empties, besides the home's own data: where people's files live. */
const PEOPLES = ["/home", "/root", "/mnt", "/media", "/srv", "/run/media", "/run/user"];

let found: string | null | undefined;
/** A bubblewrap that really starts here (user namespaces allowed), or null. Looked for once. */
export function bubblewrap(): string | null {
  if (found !== undefined) return found;
  found = null;
  if (process.platform !== "linux") return found;
  const bin = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"].find((p) => existsSync(p));
  if (!bin) return found;
  const tried = spawnSync(bin, ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-all", "--die-with-parent", "true"], { timeout: 10_000 });
  if (tried.status === 0) found = bin;
  return found;
}

const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** What his commands are wrapped in: his workspace and his own home writable, the home's data and
 * everyone's files out of sight. Null where no sandbox can start (the caller says so). */
export function sandboxFor(o: { workspace: string; home: string; dataDir: string }): Wrap | null {
  const bin = bubblewrap();
  if (!bin) return null;
  mkdirSync(o.workspace, { recursive: true });
  mkdirSync(o.home, { recursive: true, mode: 0o700 });
  const ws = real(o.workspace);
  const mine = real(o.home);
  const data = real(o.dataDir);
  const hidden = [...PEOPLES.filter((d) => existsSync(d)).map(real), data];
  // the folders on PATH that a hidden place would otherwise take away (~/.local/bin, a node manager)
  const tools = [...new Set((process.env.PATH ?? "").split(delimiter).filter(Boolean).map(real))].filter(
    (d) => existsSync(d) && hidden.some((h) => inside(d, h)) && !inside(d, data),
  );
  return ([cmd, args]) => {
    // /run itself stays (name lookups often live there, /etc/resolv.conf pointing into it)
    const a = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
    for (const h of hidden) a.push("--tmpfs", h);
    for (const t of tools) a.push("--ro-bind", t, t);
    a.push("--bind", ws, ws, "--bind", mine, mine, "--chdir", ws);
    a.push("--clearenv", "--setenv", "HOME", mine, "--setenv", "TMPDIR", "/tmp", "--setenv", "PATH", process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", "--setenv", "LANG", process.env.LANG ?? "C.UTF-8", "--setenv", "TERM", "dumb");
    a.push("--unshare-all", "--share-net", "--die-with-parent", "--new-session", "--", cmd, ...args);
    return [bin, a];
  };
}
