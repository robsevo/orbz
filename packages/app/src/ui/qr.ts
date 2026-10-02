// A QR code, our own (PLAN 2.7: "a phone paired by QR code"), for the short links the home makes:
// byte mode, error correction level M, versions 1 to 10 (up to 213 bytes). The layout is the
// standard's (ISO/IEC 18004): finder, timing and alignment patterns, Reed-Solomon over GF(256)
// with blocks interleaved, the zigzag placement, and the mask that scores lowest on the standard's
// penalty rules. Pure: tests decode what it draws with a real reader (zbarimg).

/** ECC codewords per block and the number of blocks, level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

/** The modules of a version, less the function patterns: what carries data and ECC. */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver: number): number => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver]! * BLOCKS[ver]!;

// GF(256), the standard's polynomial x^8 + x^4 + x^3 + x^2 + 1
function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = mul(out[j]!, root);
      if (j + 1 < out.length) out[j] = out[j]! ^ out[j + 1]!;
    }
    root = mul(root, 0x02);
  }
  return out;
}
function remainder(data: number[], div: number[]): number[] {
  const out = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift()!;
    out.push(0);
    div.forEach((d, i) => (out[i] = out[i]! ^ mul(d, factor)));
  }
  return out;
}

/** The modules of `text` as a QR code: rows of dark (true) and light, no quiet zone. */
export function qr(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  const bitsFor = (v: number) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  while (ver <= MAX_VERSION && bitsFor(ver) > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) throw new Error(`too long for a QR code here (${bytes.length} bytes)`);

  // the data: byte mode, its length, the bytes, a terminator, then padding to the capacity
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // split into blocks, each with its ECC, then interleaved
  const blocks = BLOCKS[ver]!;
  const eccLen = ECC_PER_BLOCK[ver]!;
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const div = divisor(eccLen);
  const parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += d.length;
    const block = [...d, ...remainder(d, div)];
    if (i < shortBlocks) block.splice(d.length, 0, -1); // a gap, so every block is as long
    parts.push(block);
  }
  const codewords: number[] = [];
  for (let i = 0; i < parts[0]!.length; i++) for (const p of parts) if (p[i] !== -1) codewords.push(p[i]!);

  // the matrix: function patterns first, then the codewords in the zigzag
  const size = ver * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean) => {
    dark[y]![x] = on;
    fixed[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const at = [6];
    for (let pos = size - 7; at.length < n; pos -= step) at.splice(1, 0, pos);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(at[i]! + dx, at[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const format = (mask: number) => {
    const d = (0 << 3) | mask; // level M's bits are 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0); // reserved now, written for real once the mask is chosen
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const on = ((b >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, on);
      set(c, a, on);
    }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
        if (!fixed[y]![x] && i < codewords.length * 8) {
          dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }

  // the mask that leaves the fewest look-alikes and runs
  const flip = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (fixed[y]![x]) continue;
        const m = [(x + y) % 2, y % 2, x % 3, (x + y) % 3, (Math.floor(x / 3) + Math.floor(y / 2)) % 2, ((x * y) % 2) + ((x * y) % 3), (((x * y) % 2) + ((x * y) % 3)) % 2, (((x + y) % 2) + ((x * y) % 3)) % 2][mask]!;
        if (m === 0) dark[y]![x] = !dark[y]![x];
      }
    }
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask);
    format(mask);
    const p = penalty(dark);
    if (p < lowest) [best, lowest] = [mask, p];
    flip(mask); // undone: masking twice is the identity
  }
  flip(best);
  format(best);
  return dark;
}

/** The standard's penalty: runs of five or more, 2×2 blocks, finder look-alikes, and balance. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let p = 0;
  const lines = [...m, ...m[0]!.map((_, x) => m.map((row) => row[x]!))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    const s = line.map((d) => (d ? "1" : "0")).join("");
    for (const f of ["10111010000", "00001011101"]) for (let k = s.indexOf(f); k >= 0; k = s.indexOf(f, k + 1)) p += 40;
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) p += 3;
  const darkCount = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) * 10;
  return p;
}
