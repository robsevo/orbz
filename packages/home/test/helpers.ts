import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { Home, type HomeOptions } from "../src/home.ts";
import type { RunContext, RunResult, Runner } from "../src/inbox.ts";
import type { TriggerEvent, TriggerSource } from "../src/triggers.ts";
import { fakeModel, type FakeModel, type Turn } from "./fakes/model.ts";

export function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "orbs-home-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A runner that records every run. With `hold`, each run waits until released (or stopped). */
export class Recorder implements Runner {
  readonly runs: RunContext[] = [];
  hold = false;
  /** Ignore the stop signal (a runner that hangs). */
  deaf = false;
  fail: string | null = null;
  maxActive = new Map<string, number>();
  readonly #active = new Map<string, number>();
  readonly #waiting: (() => void)[] = [];

  async run(ctx: RunContext): Promise<RunResult> {
    this.runs.push(ctx);
    const n = (this.#active.get(ctx.orb) ?? 0) + 1;
    this.#active.set(ctx.orb, n);
    this.maxActive.set(ctx.orb, Math.max(n, this.maxActive.get(ctx.orb) ?? 0));
    try {
      if (this.hold) {
        await new Promise<void>((resolve) => {
          this.#waiting.push(resolve);
          if (!this.deaf) ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (this.fail) throw new Error(this.fail);
      return { summary: `did ${ctx.items.length}` };
    } finally {
      this.#active.set(ctx.orb, (this.#active.get(ctx.orb) ?? 1) - 1);
    }
  }

  /** Lets the oldest held run finish. */
  release(): void {
    this.#waiting.shift()?.();
  }

  /** The texts of each run's items, run by run. */
  texts(): string[][] {
    return this.runs.map((r) => r.items.map((i) => i.text));
  }
}

export function openHome(
  t: TestContext,
  opts: Partial<HomeOptions> & { dataDir?: string } = {},
): { home: Home; clock: FakeClock; runner: Recorder; dataDir: string } {
  const dataDir = opts.dataDir ?? tempDir(t);
  const clock = (opts.clock as FakeClock | undefined) ?? new FakeClock("2026-10-01T05:00:00Z");
  const runner = (opts.runner as Recorder | undefined) ?? new Recorder();
  const home = Home.open({ protect: [], ...opts, dataDir, clock, runner });
  t.after(() => home.close());
  return { home, clock, runner, dataDir };
}

/** A mailbox the tests drop mail into. Its cursor is the index of the next unseen message. */
export class FakeMailbox implements TriggerSource {
  readonly mail: TriggerEvent[] = [];
  everyMs = 5 * 60_000;
  down: string | null = null;
  polls = 0;

  async poll(_config: Record<string, unknown>, cursor: string | null) {
    this.polls++;
    if (this.down) throw new Error(this.down);
    if (cursor === null) return { events: [], cursor: String(this.mail.length) };
    const from = Number(cursor);
    return { events: this.mail.slice(from), cursor: String(this.mail.length) };
  }

  arrive(id: string, at: number, from: string): void {
    this.mail.push({ id, at, summary: `New email from ${from}`, data: { from } });
  }
}

/** A home whose runner is the agent loop, on a scripted streaming model, with the orb juniper. */
export async function agentHome(t: TestContext, script: Turn[], more: Partial<HomeOptions> = {}): Promise<{ home: Home; model: FakeModel; dataDir: string }> {
  const model = await fakeModel(t, script);
  const dataDir = more.dataDir ?? tempDir(t);
  const home = Home.open({
    dataDir,
    protect: [],
    spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    ...more,
  });
  t.after(() => home.close());
  if (!home.inbox.orb("juniper")) home.inbox.addOrb("juniper", "Juniper");
  home.start();
  return { home, model, dataDir };
}
