// PLAN 5.32_t, what a chart can add (owner, 10-11: "right click and add lets say indicators"; "time before a bar closes
// too"), pure:
//   - each indicator the chart draws is the one the home's strategies read: the same values on the same bars (moving
//     averages, an EMA over a series that begins with gaps, Wilder's RSI, MACD's three, Bollinger's three);
//   - VWAP from each UTC midnight, nothing until a day has traded;
//   - a study added at its usual numbers in a colour not yet worn; numbers kept inside what each allows;
//   - what this browser kept, read back: anything not a study left out, the first chart's when nothing was kept;
//   - the time left on the bar forming now: bars on whole steps of their timeframe from the epoch, in UTC.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as home from "../../home/src/desk/indicators.ts";
import { closesAt, leftText, paneText } from "../src/ui/candles.ts";
import { bollinger, drawStudy, ema, FIRST, macd, PALETTE, readKept, rsi, saneNumbers, sma, studyLabel, vwap, withStudy } from "../src/ui/studies.ts";

// a market's walk: seeded, so every run reads the same bars
function walk(n: number, seed = 7): { t: number; o: number; h: number; l: number; c: number; v: number }[] {
  let s = seed;
  const rnd = (): number => ((s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = Math.max(1, p * (1 + (rnd() - 0.5) * 0.04));
    return { t: Date.UTC(2026, 9, 1) + i * 3_600_000, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 100 + rnd() * 900 };
  });
}

test("each indicator is the home's: the same values on the same bars", () => {
  const bars = walk(400);
  const c = bars.map((b) => b.c);
  for (const n of [2, 9, 20, 50, 200]) {
    assert.deepEqual(sma(c, n), home.sma(c, n), `MA ${n}`);
    assert.deepEqual(ema(c, n), home.ema(c, n), `EMA ${n}`);
  }
  const gaps = [NaN, NaN, NaN, ...c.slice(3)];
  assert.deepEqual(ema(gaps, 9), home.ema(gaps, 9), "an EMA over a series that begins with gaps (MACD's signal) begins where it does");
  for (const n of [2, 7, 14, 30]) assert.deepEqual(rsi(c, n), home.rsi(c, n), `RSI ${n}`);
  for (const [f, s, g] of [[12, 26, 9], [5, 35, 5]] as const) assert.deepEqual(macd(c, f, s, g), home.macd(c, f, s, g), `MACD ${f} ${s} ${g}`);
  for (const [n, k] of [[20, 2], [10, 1.5]] as const) assert.deepEqual(bollinger(c, n, k), home.bollinger(c, n, k), `BB ${n} ${k}`);
  // what the chart draws for each is those values
  assert.deepEqual(drawStudy({ id: "r", kind: "rsi", n: [14], hue: "amber" }, bars).lines[0]!.values, home.rsi(c, 14));
  const m = drawStudy({ id: "m", kind: "macd", n: [12, 26, 9], hue: "cyan" }, bars);
  assert.deepEqual([m.lines.map((l) => l.label), m.hist], [["MACD", "Signal"], home.macd(c, 12, 26, 9).hist]);
  assert.notEqual(m.lines[0]!.hue, m.lines[1]!.hue, "MACD's two lines in two colours");
});

test("VWAP from each UTC midnight: a day's traded prices weighed by their volume; none until a day has traded", () => {
  const H = 3_600_000;
  const day = Date.UTC(2026, 9, 1);
  const bar = (t: number, h: number, l: number, c: number, v: number) => ({ t, o: c, h, l, c, v });
  const v = vwap([bar(day + 22 * H, 12, 9, 9, 0), bar(day + 23 * H, 12, 9, 9, 100), bar(day + 24 * H, 6, 3, 3, 50), bar(day + 25 * H, 9, 6, 6, 150)]);
  assert.ok(Number.isNaN(v[0]!), "nothing traded yet that day");
  assert.equal(v[1], 10, "(12 + 9 + 9) / 3");
  assert.equal(v[2], 4, "a new UTC day starts again: (6 + 3 + 3) / 3");
  assert.equal(v[3], (4 * 50 + 7 * 150) / 200, "weighed by volume");
});

test("a study added at its usual numbers in a colour not yet worn; its numbers kept inside what each allows", () => {
  let list = withStudy([], "ema");
  list = withStudy(list, "ema");
  list = withStudy(list, "rsi");
  assert.deepEqual(list.map((s) => [s.kind, s.n, s.hue]), [["ema", [20], PALETTE[0]], ["ema", [20], PALETTE[1]], ["rsi", [14], PALETTE[2]]]);
  assert.equal(new Set(list.map((s) => s.id)).size, 3, "each its own");
  assert.equal(studyLabel({ id: "b", kind: "bb", n: [20, 2], hue: "violet" }), "BB 20 2");
  assert.deepEqual(saneNumbers("ema", [1]), [2], "no shorter than it can be");
  assert.deepEqual(saneNumbers("bb", [20, 2.3]), [20, 2.5], "Bollinger's width by halves");
  assert.deepEqual(saneNumbers("macd", [30, 20, 9]), [30, 31, 9], "a slow average slower than the fast one");
  assert.equal(saneNumbers("rsi", [Number.NaN]), null, "not a number is no number");
  assert.equal(saneNumbers("rsi", [14, 3]), null);
});

test("what this browser kept, read back: anything not a study left out; the first chart's when nothing was kept", () => {
  assert.deepEqual(readKept(null), { studies: FIRST, strategies: [] });
  assert.deepEqual(readKept("{not json"), { studies: FIRST, strategies: [] });
  const kept = readKept(JSON.stringify({
    studies: [{ id: "rsi1", kind: "rsi", n: [500], hue: "amber" }, { id: "x", kind: "astrology", n: [], hue: "amber" }, { id: "e", kind: "ema", n: [9], hue: "not-a-hue" }, { id: "v", kind: "vwap", n: [], hue: "pink" }],
    strategies: [{ id: 3, mode: "paper" }, { id: 4, mode: "maybe" }, { id: "5", mode: "live" }],
  }));
  assert.deepEqual(kept.studies.map((s) => [s.kind, s.n]), [["rsi", [100]], ["vwap", []]], "an unknown kind or colour left out, a number held to its range");
  assert.deepEqual(kept.strategies, [{ id: 3, mode: "paper" }]);
  assert.deepEqual(readKept(JSON.stringify({ studies: [], strategies: [] })).studies, [], "a chart cleared stays clear");
});

test("the time left on the bar forming now: bars on whole steps of their timeframe from the epoch, in UTC", () => {
  const at = (s: string): number => Date.parse(s);
  assert.equal(closesAt("15m", at("2026-10-11T10:07:30Z")), at("2026-10-11T10:15:00Z"));
  assert.equal(leftText(closesAt("15m", at("2026-10-11T10:07:30Z"))! - at("2026-10-11T10:07:30Z")), "07:30");
  assert.equal(closesAt("4h", at("2026-10-11T05:00:00Z")), at("2026-10-11T08:00:00Z"), "a 4-hour bar closes at 08:00 UTC");
  assert.equal(leftText(3 * 3_600_000), "3:00:00");
  assert.equal(closesAt("1d", at("2026-10-11T23:59:59.500Z")), at("2026-10-12T00:00:00Z"));
  assert.equal(leftText(500), "00:01", "a part of a second still left is a second");
  assert.equal(closesAt("1h", at("2026-10-11T10:00:00Z")), at("2026-10-11T11:00:00Z"), "a bar opening now closes a whole hour on");
  assert.equal(closesAt("3m", 0), null, "a timeframe the desk does not have has no clock");
  assert.deepEqual([paneText(56.214), paneText(-0.000001234), paneText(0)], ["56.21", "-0.00000123", "0.00"]);
});
