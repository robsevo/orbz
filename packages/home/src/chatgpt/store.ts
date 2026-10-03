// Where the ChatGPT tokens live (PLAN 1.10): the OS keychain. On Linux that is the Secret Service
// through `secret-tool`, on macOS the login keychain through `security -i`. Either way the secret
// goes in on stdin, never on the command line, where any user's `ps` could read it. A machine
// without a keychain (a headless always-on box, Windows for now) keeps them in a file only its
// owner can read, and the status says so. Tests use the memory store, or a stand-in tool.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SecretStore {
  readonly kind: "keychain" | "file" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const SERVICE = "orbs";

function run(cmd: string, args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    const c = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    c.stdout.on("data", (b: Buffer) => (out += b.toString()));
    c.stderr.on("data", (b: Buffer) => (err += b.toString()));
    c.once("error", (e) => ok({ code: -1, out: "", err: e.message }));
    c.once("close", (code) => ok({ code: code ?? -1, out, err }));
    // a tool that exits without reading (no Secret Service to talk to) closes its end first: the
    // write fails with EPIPE, and its exit code, not the write, says what happened
    c.stdin.on("error", () => {});
    c.stdin.end(input ?? "");
  });
}

export class KeychainStore implements SecretStore {
  readonly kind = "keychain" as const;
  readonly #tool: string;
  readonly #mac: boolean;

  constructor(o: { tool?: string; platform?: NodeJS.Platform } = {}) {
    this.#mac = (o.platform ?? process.platform) === "darwin";
    this.#tool = o.tool ?? (this.#mac ? "security" : "secret-tool");
  }

  /** Whether a keychain answers here: a lookup of a key nobody stored comes back "not found",
   * not an error (no Secret Service, no D-Bus, no tool). */
  async available(): Promise<boolean> {
    const r = this.#mac
      ? await run(this.#tool, ["find-generic-password", "-s", SERVICE, "-a", "__orbs_probe__"])
      : await run(this.#tool, ["lookup", "service", SERVICE, "key", "__orbs_probe__"]);
    if (this.#mac) return r.code === 0 || r.code === 44; // 44: the item could not be found
    return r.code === 0 || (r.code === 1 && !r.err.trim());
  }

  async get(key: string): Promise<string | null> {
    if (this.#mac) {
      const r = await run(this.#tool, ["find-generic-password", "-s", SERVICE, "-a", key, "-w"]);
      return r.code === 0 ? Buffer.from(r.out.trim(), "base64").toString("utf8") : null;
    }
    const r = await run(this.#tool, ["lookup", "service", SERVICE, "key", key]);
    return r.code === 0 && r.out ? r.out.replace(/\n$/, "") : null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.#mac) {
      // in interactive mode the command, secret included, is read from stdin; base64 keeps it one word
      const b64 = Buffer.from(value, "utf8").toString("base64");
      const r = await run(this.#tool, ["-i"], `add-generic-password -U -s ${SERVICE} -a ${key} -l "Orbs: ChatGPT sign-in" -w ${b64}\n`);
      if (r.code !== 0) throw new Error(`the keychain refused the secret (${r.err.trim().slice(0, 200) || `exit ${r.code}`})`);
      return;
    }
    const r = await run(this.#tool, ["store", `--label=Orbs: ChatGPT sign-in`, "service", SERVICE, "key", key], value);
    if (r.code !== 0) throw new Error(`the keychain refused the secret (${r.err.trim().slice(0, 200) || `exit ${r.code}`})`);
  }

  async delete(key: string): Promise<void> {
    if (this.#mac) await run(this.#tool, ["delete-generic-password", "-s", SERVICE, "-a", key]);
    else await run(this.#tool, ["clear", "service", SERVICE, "key", key]);
  }
}

/** A JSON file readable by its owner only, for a machine with no keychain. */
export class FileStore implements SecretStore {
  readonly kind = "file" as const;
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  #all(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.#file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  #save(all: Record<string, string>): void {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  async get(key: string): Promise<string | null> {
    return this.#all()[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#save({ ...this.#all(), [key]: value });
  }

  async delete(key: string): Promise<void> {
    const all = this.#all();
    delete all[key];
    this.#save(all);
  }
}

export class MemoryStore implements SecretStore {
  readonly kind = "memory" as const;
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

/** One home's entries in a keychain the whole machine shares: each key carries the home's own
 * prefix, so two homes (a test's, in a temporary folder, and yours) never read each other's
 * secrets. The default home also reads the entries it wrote before they had a prefix. */
export class HomeScopedStore implements SecretStore {
  readonly kind: SecretStore["kind"];
  readonly #inner: SecretStore;
  readonly #prefix: string;
  readonly #legacy: boolean;

  constructor(inner: SecretStore, dataDir: string, o: { legacy: boolean }) {
    this.#inner = inner;
    this.kind = inner.kind;
    this.#prefix = `home-${createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 12)}:`;
    this.#legacy = o.legacy;
  }

  async get(key: string): Promise<string | null> {
    return (await this.#inner.get(this.#prefix + key)) ?? (this.#legacy ? this.#inner.get(key) : null);
  }

  async set(key: string, value: string): Promise<void> {
    await this.#inner.set(this.#prefix + key, value);
  }

  async delete(key: string): Promise<void> {
    await this.#inner.delete(this.#prefix + key);
    if (this.#legacy) await this.#inner.delete(key);
  }
}

/** The home a person runs by default: $ORBS_HOME, else ~/.orbs (as `pnpm start` picks it). */
export const defaultHome = (): string => resolve(process.env.ORBS_HOME ?? join(homedir(), ".orbs"));

/** The keychain when one answers here (this home's entries only), else a file in the data
 * directory. Windows uses the file until a store that takes the secret on stdin is wired (cmdkey
 * would put it on the command line). */
export async function defaultStore(dataDir: string): Promise<SecretStore> {
  if (process.platform === "linux" || process.platform === "darwin") {
    const k = new KeychainStore();
    if (await k.available()) return new HomeScopedStore(k, dataDir, { legacy: resolve(dataDir) === defaultHome() });
  }
  return new FileStore(join(dataDir, "secrets.json"));
}
