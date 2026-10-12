// The majors (owner, 10-11: "have top 10 cryptos clickable on the top there where you see the up and down"; "put the
// majors on top"): the app's list is the home's, so a major the tape shows is one the home can chart and trade.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SYMBOLS as HOME } from "../../home/src/desk/strategy.ts";
import { ROUTES } from "../../home/src/desk/orders.ts";
import { MAJOR_ROUTES, SYMBOLS } from "../src/desk/kit.ts";

test("the app's majors are the home's", () => {
  assert.deepEqual([...SYMBOLS], [...HOME]);
});

test("where a major is swapped from your wallet is where the home swaps it (owner, 10-11: \"add the ability to trade the top 10 too\")", () => {
  assert.deepEqual(MAJOR_ROUTES, ROUTES);
});
