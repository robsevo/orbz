// A ZIP of our own (PLAN 4.9): an .xlsx is a ZIP of XML parts, so a workbook is written and read here, with Node's
// own deflate and CRC-32 and nothing else. Writing: every part deflated, names in UTF-8. Reading: by the central
// directory (the one place a ZIP's sizes are sure), each part inflated with a ceiling, so a small file that would
// inflate to gigabytes stops at the ceiling instead of filling the memory. ZIP64 (a part over 4 GB) is refused.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export class ZipError extends Error {}

/** A part read out of a ZIP is at most this big, inflated. */
export const PART_CAP = 32 * 1024 * 1024;

const dosTime = (d: Date): number => (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
const dosDate = (d: Date): number => ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

/** The parts, in order, as one ZIP. */
export function zip(parts: { name: string; data: Buffer | string }[], at = new Date(1980, 0, 1)): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const p of parts) {
    const raw = typeof p.data === "string" ? Buffer.from(p.data, "utf8") : p.data;
    const packed = deflateRawSync(raw, { level: 9 });
    const name = Buffer.from(p.name, "utf8");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // the name is UTF-8
    local.writeUInt16LE(8, 8); // deflated
    local.writeUInt16LE(dosTime(at), 10);
    local.writeUInt16LE(dosDate(at), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime(at), 12);
    entry.writeUInt16LE(dosDate(at), 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42); // the rest (extra, comment, disk, attributes) stay 0
    chunks.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}

/** A ZIP's parts by name, each inflated only when it is asked for. */
export function unzip(buf: Buffer): { names: string[]; read: (name: string) => Buffer | null } {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("it is not a ZIP (no end of its directory)");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (at === 0xffffffff) throw new ZipError("a ZIP64 file is not read here");
  const entries = new Map<string, { method: number; packed: number; size: number; local: number }>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new ZipError("its directory is broken");
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new ZipError("a ZIP64 file is not read here");
    entries.set(buf.subarray(at + 46, at + 46 + nameLen).toString("utf8"), { method, packed, size, local });
    at += 46 + nameLen + extra + comment;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw new ZipError(`${name}: its header is broken`);
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.packed);
      if (data.length < e.packed) throw new ZipError(`${name} is cut short`);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new ZipError(`${name} is packed in a way not read here (method ${e.method})`);
      if (e.size > PART_CAP) throw new ZipError(`${name} is too big to read (${e.size} bytes)`);
      try {
        return inflateRawSync(data, { maxOutputLength: PART_CAP });
      } catch (err) {
        throw new ZipError(`${name} could not be unpacked: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
