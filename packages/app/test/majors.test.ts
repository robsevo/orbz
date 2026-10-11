// The majors (owner, 10-11: "have top 10 cryptos clickable on the top there where you see the up and down"; "put the
// majors on top"): the app's list is the home's, so a major the tape shows is one the home can chart and trade.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SYMBOLS as HOME } from "../../home/src/desk/strategy.ts";
import { SYMBOLS } from "../src/desk/kit.ts";

test("the app's majors are the home's", () => {
  assert.deepEqual([...SYMBOLS], [...HOME]);
});
