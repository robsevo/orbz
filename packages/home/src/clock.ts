// Time for the home. A sleeping computer splits time in two: the wall clock keeps counting
// through a suspend, timers do not (libuv runs them on the monotonic clock, which stops while
// the machine sleeps). The home compares the two to notice that it slept, and the tests drive a
// FakeClock that sleeps on purpose.

export interface Clock {
  /** Wall-clock milliseconds since the epoch. */
  now(): number;
  /** Monotonic milliseconds. They stop while the machine sleeps. */
  mono(): number;
  /** Runs `fn` after `ms` of monotonic time. Returns a cancel function. */
  timer(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  mono: () => performance.now(),
  timer(ms, fn) {
    const t = setTimeout(fn, Math.max(0, ms));
    return () => clearTimeout(t);
  },
};

type Pending = { at: number; seq: number; fn: () => void };

/** A clock for tests: time moves only when the test says so. */
export class FakeClock implements Clock {
  #wall: number;
  #mono = 0;
  #seq = 0;
  #timers: Pending[] = [];

  constructor(start: number | string) {
    this.#wall = typeof start === "string" ? Date.parse(start) : start;
    if (Number.isNaN(this.#wall)) throw new Error(`FakeClock: unreadable start time ${String(start)}`);
  }

  now(): number {
    return this.#wall;
  }

  mono(): number {
    return this.#mono;
  }

  timer(ms: number, fn: () => void): () => void {
    const t: Pending = { at: this.#mono + Math.max(0, ms), seq: ++this.#seq, fn };
    this.#timers.push(t);
    return () => {
      this.#timers = this.#timers.filter((x) => x !== t);
    };
  }

  /** The machine is awake for `ms`: due timers fire in order, and what they start may settle. */
  async advance(ms: number): Promise<void> {
    const end = this.#mono + ms;
    await settle(); // timers armed by work already in flight count too
    for (;;) {
      const next = this.#timers
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.#timers = this.#timers.filter((t) => t !== next);
      this.#wall += next.at - this.#mono;
      this.#mono = next.at;
      next.fn();
      await settle();
    }
    this.#wall += end - this.#mono;
    this.#mono = end;
    await settle();
  }

  /** The machine sleeps for `ms`: the wall clock moves and no timer fires. */
  suspend(ms: number): void {
    this.#wall += ms;
  }
}

/** Lets promise chains started by a timer run to their next real wait. */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
}
