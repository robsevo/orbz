// PLAN 2.7_t (a phone paired by QR code): the QR codes we draw (src/ui/qr.ts) are read back by a
// real reader (zbarimg), from a single letter to the longest link a version 10 holds, and a link
// too long for it is refused rather than drawn wrong.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { qr } from "../src/ui/qr.ts";

const reader = spawnSync("zbarimg", ["--version"]).status === 0;

/** The code as a PGM picture: four modules of quiet zone, each module 6 pixels. */
function pgm(m: boolean[][]): Buffer {
  const scale = 6;
  const side = (m.length + 8) * scale;
  const px = Buffer.alloc(side * side, 255);
  m.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) px.fill(0, ((y + 4) * scale + dy) * side + (x + 4) * scale, ((y + 4) * scale + dy) * side + (x + 5) * scale);
  }));
  return Buffer.concat([Buffer.from(`P5\n${side} ${side}\n255\n`), px]);
}

test("every code we draw is read back as what it says, version 1 to 10", { skip: reader ? false : "no zbarimg here" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbs-qr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const link = "https://box.tail1234.ts.net:8443/app/orbs.html#pair=Qm9iJ3MgcGhvbmUgcGFpcmluZw";
  const cases = ["a", "Orbs", link, `${link}&more=${"x".repeat(60)}`, "é ✓ 🙂 unicode too", "y".repeat(213)];
  for (const text of cases) {
    const m = qr(text);
    assert.equal(m.length % 4, 1, "a QR code's side is 4v + 17");
    const file = join(dir, `${m.length}.pgm`);
    writeFileSync(file, pgm(m));
    const read = execFileSync("zbarimg", ["--raw", "-q", file]).toString("utf8").replace(/\n$/, "");
    assert.equal(read, text, `version ${(m.length - 17) / 4}`);
  }
  assert.equal(qr("y".repeat(213)).length, 57, "the longest, at version 10");
});

test("too long for a version 10 is refused, never drawn wrong", () => {
  assert.throws(() => qr("y".repeat(214)), /too long for a QR code here/);
});
