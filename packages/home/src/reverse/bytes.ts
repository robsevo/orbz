// Bytes read with every offset checked (PLAN 4.8): a file handed to a reverse engineer is untrusted, and its own
// headers say where to look, so every read is bounds-checked and a header that points outside its file is refused with
// why, never a crash, and every loop it drives has a ceiling, never a hang.
//
// Logic ported from REA (https://github.com/morluto/rea), MIT License, Copyright (c) 2026 morluto: its readers admit a
// container's extents before decoding them. Rewritten for Orbz; see docs/third-party/rea.md.

/** A file that cannot be read as what it says it is, with why. */
export class Unreadable extends Error {}

export class Bytes {
  readonly buf: Uint8Array;
  readonly #view: DataView;
  little: boolean;

  constructor(buf: Uint8Array, little = true) {
    this.buf = buf;
    this.#view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.little = little;
  }

  get length(): number {
    return this.buf.length;
  }

  /** Throws unless `n` bytes from `at` are inside the file. */
  need(at: number, n: number, what: string): void {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(n) || at < 0 || n < 0 || at + n > this.buf.length)
      throw new Unreadable(`${what} points outside the file (offset ${at}, ${n} bytes, the file is ${this.buf.length})`);
  }

  u8(at: number, what = "a byte"): number {
    this.need(at, 1, what);
    return this.buf[at]!;
  }
  u16(at: number, what = "a 16-bit field"): number {
    this.need(at, 2, what);
    return this.#view.getUint16(at, this.little);
  }
  u32(at: number, what = "a 32-bit field"): number {
    this.need(at, 4, what);
    return this.#view.getUint32(at, this.little);
  }
  i32(at: number, what = "a 32-bit field"): number {
    this.need(at, 4, what);
    return this.#view.getInt32(at, this.little);
  }
  /** A 64-bit field as a number: exact up to 2^53, which every offset in a file this size is. */
  u64(at: number, what = "a 64-bit field"): number {
    this.need(at, 8, what);
    const v = this.#view.getBigUint64(at, this.little);
    return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
  }
  /** A 64-bit address as hex, exactly (addresses can pass 2^53). */
  hex64(at: number, what = "an address"): string {
    this.need(at, 8, what);
    return `0x${this.#view.getBigUint64(at, this.little).toString(16)}`;
  }

  /** The bytes from `at`, `n` long. */
  slice(at: number, n: number, what = "a block"): Uint8Array {
    this.need(at, n, what);
    return this.buf.subarray(at, at + n);
  }

  /** A NUL-ended string from `at`, at most `max` bytes (a name with no end is cut there). */
  cstr(at: number, max = 4096): string {
    if (at < 0 || at >= this.buf.length) return "";
    let end = at;
    const stop = Math.min(this.buf.length, at + max);
    while (end < stop && this.buf[end] !== 0) end++;
    return new TextDecoder("utf-8", { fatal: false }).decode(this.buf.subarray(at, end));
  }

  /** A fixed-width field of text with its NULs trimmed (a section's 8-byte name, a segment's 16). */
  fixed(at: number, n: number): string {
    const b = this.slice(at, n, "a name");
    const end = b.indexOf(0);
    return new TextDecoder("latin1").decode(end < 0 ? b : b.subarray(0, end));
  }
}

/** Checks a count read from a file against a ceiling, so a lying header cannot drive a loop for ever. */
export function bounded(n: number, max: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Unreadable(`${what}: ${n} is not a count`);
  if (n > max) throw new Unreadable(`${what}: ${n.toLocaleString("en-US")} is more than a real file has (at most ${max.toLocaleString("en-US")} read)`);
  return n;
}
