// The candlestick chart's arithmetic (ui/candles.ts, PLAN 5.23): the price range and its round ticks, a price as a
// market's screen shows it, and the time axis: labels at round times on this device's clock, running forward, a day's start
// written as the day (10-11: labels a bar count apart read 07:00, 06:00, 05:00 left to right on 1 h bars).
process.env.TZ = "America/Toronto"; // a clock with a summer: its change on 1 November is crossed below
import assert from "node:assert/strict";
import { test } from "node:test";
import { changeText, priceText, rangeOf, ticksOf, timeText, timeTicks } from "../src/ui/candles.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const bars = (start: string, step: number, n: number): number[] => Array.from({ length: n }, (_, i) => Date.parse(start) + i * step);
const at = (t: number): string => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

test("the price range has room above and below; its ticks are round and inside it; a flat market still has a range", () => {
  const r = rangeOf([100, 120, 110]);
  assert.ok(r.lo < 100 && r.hi > 120 && Math.abs(100 - r.lo - (r.hi - 120)) < 1e-9);
  assert.deepEqual(rangeOf([5, 5]), { lo: 4.95, hi: 5.05 });
  assert.deepEqual(rangeOf([Number.NaN]), { lo: 0, hi: 1 });
  assert.deepEqual(ticksOf(78_350, 82_420, 5), [79_000, 80_000, 81_000, 82_000]);
  assert.deepEqual(ticksOf(0.0412, 0.0457, 5), [0.042, 0.043, 0.044, 0.045]);
  assert.ok(ticksOf(1, 2, 5).every((v) => v >= 1 && v <= 2));
});

test("a price as a market's screen shows it; a change always signed", () => {
  assert.equal(priceText(91_204.37), "91,204");
  assert.equal(priceText(125.43), "125.4");
  assert.equal(priceText(1.2345), "1.23");
  assert.equal(priceText(0.012345), "0.0123");
  assert.equal(priceText(0.00001234), "0.000012");
  assert.equal(priceText(Number.NaN), "–");
  assert.equal(changeText(1), "+1.00%");
  assert.equal(changeText(-0.456), "−0.46%");
  assert.equal(timeText(Date.parse("2026-10-11T01:00:00-04:00"), "1h"), "11 Oct 01:00");
  assert.equal(timeText(Date.parse("2026-10-11T00:00:00-04:00"), "1d"), "11 Oct");
});

test("the time axis: round times, forward, about as many as asked; a day's start says the day; never a bar's own odd time", () => {
  // a week of hourly bars (what the owner saw): a label at each midnight, each the day, left to right
  const week = bars("2026-10-04T13:00:00-04:00", HOUR, 160);
  const days = timeTicks(week, 8);
  assert.deepEqual(days.map((k) => k.text), ["5 Oct", "6 Oct", "7 Oct", "8 Oct", "9 Oct", "10 Oct", "11 Oct"]);
  assert.ok(days.every((k) => new Date(week[k.i]!).getHours() === 0));
  // two and a half hours of minute bars: every half hour, as times
  const morning = bars("2026-10-09T09:07:00-04:00", MIN, 160);
  assert.deepEqual(timeTicks(morning, 6).map((k) => k.text), ["09:30", "10:00", "10:30", "11:00", "11:30"]);
  // a step always holds whole bars: 4 h bars are never labelled every 6 h (that falls between bars)
  const four = bars("2026-10-01T00:00:00Z", 4 * HOUR, 60);
  const fourTicks = timeTicks(four, 12);
  const gaps = fourTicks.slice(1).map((k, j) => four[k.i]! - four[fourTicks[j]!.i]!);
  assert.ok(gaps.every((g) => g === gaps[0]) && gaps[0]! % (4 * HOUR) === 0, `evenly, in whole bars: ${fourTicks.map((k) => at(four[k.i]!)).join(", ")}`);
  // across the clock's change (1 November): days still begin at midnight, the hour that repeats changes nothing
  const fall = bars("2026-10-30T00:00:00-04:00", HOUR, 120);
  const fallTicks = timeTicks(fall, 5);
  assert.deepEqual(fallTicks.map((k) => k.text), ["31 Oct", "1 Nov", "2 Nov", "3 Nov"]);
  assert.ok(fallTicks.every((k) => new Date(fall[k.i]!).getHours() === 0));
  // half a year of daily bars: months, January as its year
  const year = bars("2026-09-15T00:00:00-04:00", DAY, 180);
  assert.deepEqual(timeTicks(year, 5).map((k) => k.text), ["Oct", "Nov", "Dec", "2027", "Feb", "Mar"]);
  // forward, always
  for (const series of [week, morning, four, fall, year]) {
    const ticks = timeTicks(series, 6);
    assert.ok(ticks.every((k, j) => j === 0 || k.i > ticks[j - 1]!.i));
  }
  assert.deepEqual(timeTicks([], 5), []);
  assert.deepEqual(timeTicks([Date.now()], 5), []);
});
