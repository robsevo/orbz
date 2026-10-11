// Keccak-256 as Ethereum uses it (the original Keccak padding, 0x01, not SHA-3's 0x06, so Node's "sha3-256" is a
// different hash): a contract function's selector is the first four bytes of the hash of its signature, and an address's
// EIP-55 checksum is read off the hash of its lowercase hex. Our own code, the reference algorithm on 32-bit halves.

const RC_HI = new Uint32Array([
  0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000,
]);
const RC_LO = new Uint32Array([
  0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001, 0x80008081, 0x00008009, 0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
  0x8000808b, 0x0000008b, 0x00008089, 0x00008003, 0x00008002, 0x00000080, 0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008,
]);
// the rotation of each lane, and where it moves (rho and pi together), in the reference order
const ROT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

function permute(lo: Uint32Array, hi: Uint32Array): void {
  const cLo = new Uint32Array(5);
  const cHi = new Uint32Array(5);
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) {
      cLo[x] = lo[x]! ^ lo[x + 5]! ^ lo[x + 10]! ^ lo[x + 15]! ^ lo[x + 20]!;
      cHi[x] = hi[x]! ^ hi[x + 5]! ^ hi[x + 10]! ^ hi[x + 15]! ^ hi[x + 20]!;
    }
    for (let x = 0; x < 5; x++) {
      const nLo = cLo[(x + 1) % 5]!;
      const nHi = cHi[(x + 1) % 5]!;
      const dLo = cLo[(x + 4) % 5]! ^ ((nLo << 1) | (nHi >>> 31));
      const dHi = cHi[(x + 4) % 5]! ^ ((nHi << 1) | (nLo >>> 31));
      for (let y = 0; y < 25; y += 5) {
        lo[y + x] = lo[y + x]! ^ dLo;
        hi[y + x] = hi[y + x]! ^ dHi;
      }
    }
    // rho and pi
    let curLo = lo[1]!;
    let curHi = hi[1]!;
    for (let i = 0; i < 24; i++) {
      const j = PI[i]!;
      const r = ROT[i]!;
      const tLo = lo[j]!;
      const tHi = hi[j]!;
      let rLo: number, rHi: number;
      if (r === 32) [rLo, rHi] = [curHi, curLo];
      else if (r < 32) [rLo, rHi] = [(curLo << r) | (curHi >>> (32 - r)), (curHi << r) | (curLo >>> (32 - r))];
      else [rLo, rHi] = [(curHi << (r - 32)) | (curLo >>> (64 - r)), (curLo << (r - 32)) | (curHi >>> (64 - r))];
      lo[j] = rLo;
      hi[j] = rHi;
      curLo = tLo;
      curHi = tHi;
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      const rowLo = lo.slice(y, y + 5);
      const rowHi = hi.slice(y, y + 5);
      for (let x = 0; x < 5; x++) {
        lo[y + x] = rowLo[x]! ^ (~rowLo[(x + 1) % 5]! & rowLo[(x + 2) % 5]!);
        hi[y + x] = rowHi[x]! ^ (~rowHi[(x + 1) % 5]! & rowHi[(x + 2) % 5]!);
      }
    }
    // iota
    lo[0] = lo[0]! ^ RC_LO[round]!;
    hi[0] = hi[0]! ^ RC_HI[round]!;
  }
}

/** Keccak-256 of bytes (a string is read as UTF-8). */
export function keccak256(input: Uint8Array | string): Uint8Array {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136; // bytes: 1600 - 2 * 256 bits
  const lo = new Uint32Array(25);
  const hi = new Uint32Array(25);
  // pad: the message, 0x01, zeros, 0x80 in the last byte of the block
  const blocks = Math.floor(data.length / rate) + 1;
  const padded = new Uint8Array(blocks * rate);
  padded.set(data);
  padded[data.length] = padded[data.length]! ^ 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! ^ 0x80;
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < rate / 8; i++) {
      const o = b * rate + i * 8;
      lo[i] = lo[i]! ^ (padded[o]! | (padded[o + 1]! << 8) | (padded[o + 2]! << 16) | (padded[o + 3]! << 24));
      hi[i] = hi[i]! ^ (padded[o + 4]! | (padded[o + 5]! << 8) | (padded[o + 6]! << 16) | (padded[o + 7]! << 24));
    }
    permute(lo, hi);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) out[i * 8 + k] = (lo[i]! >>> (8 * k)) & 0xff;
    for (let k = 0; k < 4; k++) out[i * 8 + 4 + k] = (hi[i]! >>> (8 * k)) & 0xff;
  }
  return out;
}

export const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A function's four-byte selector from its signature ("transfer(address,uint256)" → "a9059cbb"). */
export const selectorOf = (signature: string): string => hex(keccak256(signature)).slice(0, 8);
