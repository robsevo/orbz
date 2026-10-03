// An orb's age and his days in the company, as the card says them (owner, 10-02): days, then years
// and days once there is a year; a year from a date to the same date; daylight saving moves no day.
process.env.TZ = "America/Toronto"; // a zone that changes its clocks, before any date is made
import assert from "node:assert/strict";
import { test } from "node:test";
import { span } from "../src/orb/age.ts";

const at = (y: number, m: number, d: number, h = 9): number => new Date(y, m - 1, d, h).getTime();

test("days, then years and days once there is a year", () => {
  assert.equal(span(at(2026, 10, 2), at(2026, 10, 2)), "0 days", "made today");
  assert.equal(span(at(2026, 10, 2), at(2026, 10, 3)), "1 day");
  assert.equal(span(at(2026, 10, 2), at(2026, 10, 3, 8)), "0 days", "not a whole day yet");
  assert.equal(span(at(2026, 10, 2), at(2027, 10, 1)), "364 days");
  assert.equal(span(at(2026, 10, 2), at(2027, 10, 2)), "1 year", "a year to the day");
  assert.equal(span(at(2026, 10, 2), at(2027, 11, 11)), "1 year, 40 days");
  assert.equal(span(at(2026, 10, 2), at(2028, 10, 3)), "2 years, 1 day", "a leap day in between is still a year to the date");
  assert.equal(span(at(2026, 10, 2), at(2026, 9, 1)), "0 days", "a clock that went back says no time, never less");
});

test("daylight saving moves no day: a month across a change is that month's days", () => {
  assert.equal(span(at(2027, 3, 1), at(2027, 4, 1)), "31 days", "the clocks go forward on 14 March");
  assert.equal(span(at(2026, 10, 2), at(2026, 11, 2)), "31 days", "and back on 1 November");
  assert.equal(span(at(2026, 3, 8, 1), at(2026, 3, 9, 1)), "1 day", "the short day itself is a day");
});
