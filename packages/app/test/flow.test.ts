// A case's money drawn as ZachXBT draws it (PLAN 5.42): desk/flow.ts, pure. Controls are planted in
// tools/home_mutants.py (a funder drawn right of what it funded, the pools drawn, a way out left of the trail).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseEdge, CaseNode, CaseRole } from "../src/home/link.ts";
import { amountText, coinsIn, layout, mainRole, when } from "../src/desk/flow.ts";

const T = Date.parse("2026-10-12T12:00:00Z");
const n = (address: string, ...roles: CaseRole[]): CaseNode => ({ address, roles, label: null, coins: ["solana:M"] });
const e = (from: string, to: string, amount: number, asset = "SOL", count = 1): CaseEdge => ({ from, to, asset, amount, count, first: T, last: T, sigs: [`${from}-${to}`] });

test("the money in columns as it ran: a funder's funder, the funder, the deployer, its first hands, a wallet paid, the way out; the pool left out", () => {
  const nodes = [n("GRAN", "funder"), n("MOM", "funder"), n("DEV", "deployer"), n("B1", "first"), n("B2", "first"), n("MULE"), n("CEX", "busy"), n("CURVE", "pool"), n("H1", "holder")];
  const edges = [e("GRAN", "MOM", 3), e("MOM", "DEV", 1), e("MOM", "B1", 0.5), e("MOM", "B2", 0.5), e("DEV", "MULE", 3), e("MULE", "CEX", 3), e("B1", "CURVE", 0.4), e("CURVE", "B1", 1e8, "MINTADDR"), e("H1", "DEV", 2)];
  const f = layout(nodes, edges, { minColW: 100, maxColW: 100, rowH: 50, pad: 20, assets: { MINTADDR: "BUNDL" } });
  const col = Object.fromEntries(f.nodes.map((p) => [p.node.address, p.col]));
  assert.ok(!("CURVE" in col), "the pool is not drawn");
  assert.ok(col.GRAN! < col.MOM! && col.MOM! < col.DEV! && col.DEV! < col.B1!, "funders left of what they funded, its own funder further left");
  assert.equal(col.B1, col.B2, "the first hands side by side");
  assert.ok(col.MULE! > col.DEV!, "a wallet the deployer paid, right of it");
  assert.equal(col.CEX, Math.max(...Object.values(col)), "the way out on the far right");
  assert.deepEqual([...new Set(Object.values(col))].sort((a, b) => a - b), [...Array(new Set(Object.values(col)).size).keys()], "no empty column");
  assert.ok(!f.edges.some((d) => d.edge.to === "CURVE" || d.edge.from === "CURVE"), "nor its transfers");
  const back = f.edges.find((d) => d.edge.from === "H1")!;
  assert.match(back.path, /^M[\d.]+,[\d.]+ C/, "a transfer back to the left is drawn");
  assert.ok(back.mid.y < Math.min(back.from.y, back.to.y), "as a loop over the top");
  assert.equal(f.edges.find((d) => d.edge.from === "MOM" && d.edge.to === "DEV")!.label, "1.00 SOL");
  assert.equal(f.width, 20 * 2 + (new Set(Object.values(col)).size - 1) * 100);
  assert.equal(f.hidden, 0);
});

test("more wallets than fit: the deployer, first hands, funders and ways out kept before holders and plain wallets", () => {
  const nodes = [n("DEV", "deployer"), n("F", "funder"), n("X", "busy"), ...Array.from({ length: 40 }, (_, i) => n(`W${String(i).padStart(2, "0")}`))];
  const f = layout(nodes, [e("F", "DEV", 1)], { max: 10 });
  const kept = f.nodes.map((p) => p.node.address);
  assert.ok(["DEV", "F", "X"].every((a) => kept.includes(a)));
  assert.equal(kept.length, 10);
  assert.equal(f.hidden, 33);
});

test("a wallet drawn as the most telling thing it is; amounts and times as the chart says them", () => {
  assert.equal(mainRole(n("A", "holder", "first")), "first");
  assert.equal(mainRole(n("A", "funder", "busy")), "busy", "an exchange that funded someone is still an exchange");
  assert.equal(mainRole(n("A")), "wallet");
  assert.deepEqual([amountText(1_479_076), amountText(22_976), amountText(250), amountText(3), amountText(0.0123)], ["1.48M", "23.0K", "250", "3.00", "0.012"]);
  assert.equal(when(T), "Oct 12, 12:00");
});

test("coins pasted in: a mint, a pump.fun link, a DexScreener link, a desk key; each once, ten at most", () => {
  const mint = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
  const other = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  assert.deepEqual(coinsIn(`https://pump.fun/coin/${mint}\nsolana:${other}, ${mint}`), [`solana:${mint}`, `solana:${other}`]);
  assert.deepEqual(coinsIn(`https://dexscreener.com/solana/${other}`), [`solana:${other}`]);
  assert.deepEqual(coinsIn("nothing here, 0x1111111111111111111111111111111111111111"), [], "an EVM address is not a Solana coin");
  assert.equal(coinsIn(Array.from({ length: 12 }, (_, i) => `${mint.slice(0, -4)}${String(i).padStart(4, "A")}`).join(" ")).length, 10);
});

test("an exchange that paid wallets and was paid: drawn twice, its money out on the left and in on the right, as he draws one", () => {
  const nodes = [n("CEX", "busy"), n("B3", "first"), n("DEV", "deployer"), n("MULE")];
  const edges = [e("CEX", "B3", 2), e("DEV", "MULE", 3), e("MULE", "CEX", 3)];
  const f = layout(nodes, edges);
  const copies = f.nodes.filter((p) => p.node.address === "CEX");
  assert.deepEqual(copies.map((p) => p.side).sort(), ["in", "out"]);
  const outCopy = copies.find((p) => p.side === "out")!;
  const inCopy = copies.find((p) => p.side === "in")!;
  const b3 = f.nodes.find((p) => p.node.address === "B3")!;
  assert.ok(outCopy.x < b3.x, "where its money came out: left of the wallet it paid");
  assert.equal(inCopy.x, Math.max(...f.nodes.map((p) => p.x)), "where money went in: on the far right");
  assert.ok(f.edges.every((d) => d.to.x > d.from.x), "so every line runs left to right, none looping back");
  assert.equal(layout([n("ONLY", "busy")], []).nodes[0]!.side, "in", "a way out with no lines is where money ends");
});

test("the columns fit the room they have, never closer than they can be read; the words of a fan of lines never on each other", () => {
  const nodes = [n("MOM", "funder"), n("DEV", "deployer"), ...["B1", "B2", "B3", "B4"].map((a) => n(a, "first")), n("CEX", "busy")];
  const edges = [e("MOM", "DEV", 1), ...["B1", "B2", "B3", "B4"].map((a) => e("MOM", a, 0.5)), e("DEV", "CEX", 3)];
  assert.equal(layout(nodes, edges, { width: 700, pad: 50 }).width, 700, "fitted");
  assert.equal(layout(nodes, edges, { width: 300, pad: 50, minColW: 150 }).width, 50 * 2 + 3 * 150, "a phone: as close as they read, then it scrolls");
  const f = layout(nodes, edges, { width: 900 });
  const boxes = f.edges.map((d) => ({ x0: d.mid.x - 40, y0: d.mid.y - 14, x1: d.mid.x + 40, y1: d.mid.y + 12 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `${f.edges[i]!.label} and ${f.edges[j]!.label} apart`);
  }
});

test("lines that must cross: their words moved along them, never stacked on each other", () => {
  // two funders each paying the same two wallets: one crossing whatever the order, two middles on one spot (a gap this
  // tight cannot keep four labels clear of each other; it keeps them off each other's spot)
  const nodes = [n("A", "funder"), n("C", "funder"), n("B1", "first"), n("B2", "first")];
  const f = layout(nodes, ["B1", "B2"].flatMap((b) => [e("A", b, 1.5), e("C", b, 2.5)]), { width: 600 });
  for (let i = 0; i < f.edges.length; i++) for (let j = i + 1; j < f.edges.length; j++) {
    const a = f.edges[i]!.mid, b = f.edges[j]!.mid;
    assert.ok(Math.abs(a.x - b.x) >= 12 || Math.abs(a.y - b.y) >= 12, `${f.edges[i]!.label} and ${f.edges[j]!.label}: not on one spot`);
  }
});

test("a line back to the left loops over the top, inside the drawing, its words too", () => {
  const nodes = [n("DEV", "deployer"), n("B1", "first"), n("H1", "holder")];
  const f = layout(nodes, [e("H1", "DEV", 5), e("DEV", "B1", 1)]);
  const back = f.edges.find((d) => d.edge.from === "H1")!;
  const ys = [...back.path.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.min(...ys) >= 0 && back.mid.y - 16 >= 0, "nothing above the drawing's top");
  assert.ok(f.nodes.every((p) => p.y + 18 + 30 <= f.height), "nor a wallet or its name below its foot");
});

