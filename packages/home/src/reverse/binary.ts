// A binary's anatomy, read statically (PLAN 4.8; owner, 10-10: "add reverse engineering capabilities to orbz as a
// persona ... verif logic and make it our own"): what kind of file it is, and for a program (ELF on Linux, PE on Windows,
// Mach-O on Apple's systems, a fat Mach-O's slices) its machine, its entry, its sections and segments, the libraries it
// loads, what it imports and exports, its hardening, and its strings. Nothing is run; every read is bounds-checked
// (bytes.ts), so a lying header is refused with why.
//
// Logic ported from REA (https://github.com/morluto/rea), MIT License, Copyright (c) 2026 morluto: the facts REA reports
// for a native binary (sections, symbols, strings, imports, mitigation candidates, Apple bundle anatomy), here read by
// our own parsers instead of Hopper, Ghidra, otool or pwntools. Rewritten for Orbz; see docs/third-party/rea.md.
import { createHash } from "node:crypto";
import { Bytes, bounded, Unreadable } from "./bytes.ts";

export type Kind =
  | "elf" | "pe" | "macho" | "macho-fat" | "java-class" | "wasm" | "zip" | "asar" | "dex" | "pdf" | "har" | "evm-hex" | "text" | "unknown";

export type Section = { name: string; addr: string; offset: number; size: number; flags: string };
export type Hardening = Record<string, boolean | string | null>;
export type Program = {
  format: "ELF" | "PE" | "Mach-O";
  bits: 32 | 64;
  machine: string;
  kind: string;
  entry: string | null;
  sections: Section[];
  libraries: string[];
  imports: string[];
  exports: string[];
  hardening: Hardening;
  notes: string[];
};

/** What a file is, by its first bytes (and, for text, its shape). */
export function kindOf(b: Uint8Array, name = ""): Kind {
  const at = (i: number) => b[i] ?? -1;
  const ascii = (s: string, from = 0) => [...s].every((c, i) => at(from + i) === c.charCodeAt(0));
  if (ascii("\x7fELF")) return "elf";
  if (ascii("MZ")) return "pe";
  const be = b.length >= 4 ? ((at(0) << 24) | (at(1) << 16) | (at(2) << 8) | at(3)) >>> 0 : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(be)) return "macho";
  if (be === 0xcafebabe || be === 0xcafebabf) {
    // a fat Mach-O and a Java class share their magic: a fat header's count of slices is small, a class's version is not
    const n = b.length >= 8 ? ((at(4) << 24) | (at(5) << 16) | (at(6) << 8) | at(7)) >>> 0 : 0;
    return n > 0 && n < 40 ? "macho-fat" : "java-class";
  }
  if (ascii("\0asm")) return "wasm";
  if (ascii("PK\x03\x04") || ascii("PK\x05\x06")) return "zip";
  if (ascii("dex\n")) return "dex";
  if (ascii("%PDF")) return "pdf";
  if (b.length >= 16 && at(0) === 4 && at(1) === 0 && at(2) === 0 && at(3) === 0 && /\.asar$/i.test(name)) return "asar";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 4096)).replace(/^﻿/, "").trimStart();
  if (/^\{\s*"log"\s*:/.test(head)) return "har";
  if (/^(0x)?[0-9a-fA-F\s]+$/.test(head.slice(0, 2000)) && head.replace(/\s/g, "").replace(/^0x/, "").length >= 20) return "evm-hex";
  const printable = b.subarray(0, 4096).filter((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128).length;
  return printable >= Math.min(b.length, 4096) * 0.95 ? "text" : "unknown";
}

export const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

// ── ELF ───────────────────────────────────────────────────────────────────────────────────────────
const ELF_MACHINES: Record<number, string> = { 3: "x86", 8: "MIPS", 20: "PowerPC", 21: "PowerPC 64", 22: "S390", 40: "ARM", 62: "x86-64", 183: "AArch64", 243: "RISC-V", 258: "LoongArch" };
const ELF_TYPES: Record<number, string> = { 1: "relocatable object", 2: "executable", 3: "shared object or position-independent executable", 4: "core dump" };
const MAX_SECTIONS = 4096;
const MAX_SYMBOLS = 400_000;

export function readElf(buf: Uint8Array): Program {
  const r = new Bytes(buf);
  const cls = r.u8(4, "the ELF class");
  if (cls !== 1 && cls !== 2) throw new Unreadable(`ELF class ${cls} is neither 32 nor 64-bit`);
  const data = r.u8(5, "the ELF byte order");
  if (data !== 1 && data !== 2) throw new Unreadable(`ELF byte order ${data} is neither little nor big-endian`);
  r.little = data === 1;
  const b64 = cls === 2;
  const type = r.u16(16, "the ELF type");
  const machine = r.u16(18, "the ELF machine");
  const word = (at: number, what: string) => (b64 ? r.u64(at, what) : r.u32(at, what));
  const entry = b64 ? r.hex64(24) : `0x${r.u32(24).toString(16)}`;
  const phoff = word(b64 ? 32 : 28, "the program headers' offset");
  const shoff = word(b64 ? 40 : 32, "the section headers' offset");
  const phentsize = r.u16(b64 ? 54 : 42);
  const phnum = bounded(r.u16(b64 ? 56 : 44), MAX_SECTIONS, "program headers");
  const shentsize = r.u16(b64 ? 58 : 46);
  const shnum = bounded(r.u16(b64 ? 60 : 48), MAX_SECTIONS, "section headers");
  const shstrndx = r.u16(b64 ? 62 : 50);
  const notes: string[] = [];

  // sections
  type Sh = { name: number; type: number; flags: number; addr: string; offset: number; size: number; link: number; entsize: number };
  const sh: Sh[] = [];
  if (shoff && shnum) {
    if (shentsize < (b64 ? 64 : 40)) throw new Unreadable(`a section header of ${shentsize} bytes is too small`);
    r.need(shoff, shnum * shentsize, "the section headers");
    for (let i = 0; i < shnum; i++) {
      const o = shoff + i * shentsize;
      sh.push(b64
        ? { name: r.u32(o), type: r.u32(o + 4), flags: r.u64(o + 8), addr: r.hex64(o + 16), offset: r.u64(o + 24), size: r.u64(o + 32), link: r.u32(o + 40), entsize: r.u64(o + 56) }
        : { name: r.u32(o), type: r.u32(o + 4), flags: r.u32(o + 8), addr: `0x${r.u32(o + 12).toString(16)}`, offset: r.u32(o + 16), size: r.u32(o + 20), link: r.u32(o + 24), entsize: r.u32(o + 36) });
    }
  }
  const names = sh[shstrndx];
  const nameOf = (s: Sh): string => (names && names.type !== 8 && names.offset + s.name < buf.length ? r.cstr(names.offset + s.name, 256) : "");
  const flagsOf = (f: number): string => `${f & 2 ? "A" : ""}${f & 1 ? "W" : ""}${f & 4 ? "X" : ""}` || "-";
  const sections: Section[] = sh.slice(1).map((s) => ({ name: nameOf(s), addr: s.addr, offset: s.offset, size: s.size, flags: flagsOf(s.flags) }));

  // segments
  const ph: { type: number; flags: number; offset: number; filesz: number }[] = [];
  if (phoff && phnum) {
    r.need(phoff, phnum * phentsize, "the program headers");
    for (let i = 0; i < phnum; i++) {
      const o = phoff + i * phentsize;
      ph.push(b64 ? { type: r.u32(o), flags: r.u32(o + 4), offset: r.u64(o + 8), filesz: r.u64(o + 32) } : { type: r.u32(o), flags: r.u32(o + 24), offset: r.u32(o + 4), filesz: r.u32(o + 16) });
    }
  }
  const interp = ph.find((p) => p.type === 3);
  if (interp && interp.offset < buf.length) notes.push(`its loader: ${r.cstr(interp.offset, 256)}`);

  // symbols: the dynamic ones (what it imports and exports) and the full table, when it was not stripped
  const symbolsIn = (table: Sh): { name: string; bind: number; type: number; shndx: number }[] => {
    const strings = sh[table.link];
    if (!strings) return [];
    const size = b64 ? 24 : 16;
    const n = bounded(Math.floor(table.size / size), MAX_SYMBOLS, "symbols");
    r.need(table.offset, n * size, "the symbol table");
    const out = [];
    for (let i = 1; i < n; i++) {
      const o = table.offset + i * size;
      const name = r.u32(o);
      const info = r.u8(b64 ? o + 4 : o + 12);
      const shndx = r.u16(b64 ? o + 6 : o + 14);
      out.push({ name: r.cstr(strings.offset + name, 512), bind: info >> 4, type: info & 15, shndx });
    }
    return out;
  };
  const dynsym = sh.find((s) => s.type === 11);
  const symtab = sh.find((s) => s.type === 2);
  const dyn = dynsym ? symbolsIn(dynsym) : [];
  const all = symtab ? symbolsIn(symtab) : [];
  const imports = [...new Set(dyn.filter((s) => s.shndx === 0 && s.name).map((s) => s.name))];
  const exports = [...new Set(dyn.filter((s) => s.shndx !== 0 && s.bind !== 0 && (s.type === 1 || s.type === 2) && s.name).map((s) => s.name))];

  // the dynamic section: the libraries it needs, and how it binds
  const libraries: string[] = [];
  let bindNow = false;
  let pieFlag = false;
  const dynamic = sh.find((s) => s.type === 6);
  if (dynamic) {
    const strings = sh[dynamic.link];
    const size = b64 ? 16 : 8;
    const n = bounded(Math.floor(dynamic.size / size), MAX_SYMBOLS, "dynamic entries");
    for (let i = 0; i < n; i++) {
      const o = dynamic.offset + i * size;
      const tag = b64 ? r.u64(o) : r.u32(o);
      const val = b64 ? r.u64(o + 8) : r.u32(o + 4);
      if (tag === 0) break;
      if (tag === 1 && strings) libraries.push(r.cstr(strings.offset + val, 256)); // DT_NEEDED
      if (tag === 30 && val & 8) bindNow = true; // DT_FLAGS: DF_BIND_NOW
      if (tag === 0x6ffffffb) {
        if (val & 1) bindNow = true; // DF_1_NOW
        if (val & 0x08000000) pieFlag = true; // DF_1_PIE
      }
      if ((tag === 15 || tag === 29) && strings) notes.push(`it looks for libraries in ${r.cstr(strings.offset + val, 256)}`); // RPATH, RUNPATH
    }
  }
  const names2 = new Set([...dyn, ...all].map((s) => s.name));
  const stack = ph.find((p) => p.type === 0x6474e551);
  const hardening: Hardening = {
    "NX (stack not executable)": stack ? !(stack.flags & 1) : null,
    PIE: type === 3 && (pieFlag || Boolean(interp)),
    RELRO: ph.some((p) => p.type === 0x6474e552) ? (bindNow ? "full" : "partial") : "none",
    "stack canary": names2.has("__stack_chk_fail") || names2.has("__stack_chk_guard"),
    FORTIFY: [...names2].some((n) => /^__\w+_chk$/.test(n) && n !== "__stack_chk_fail"),
    stripped: !symtab,
  };
  if (all.length) notes.push(`${all.filter((s) => s.type === 2).length.toLocaleString("en-US")} functions named in its symbol table`);
  return {
    format: "ELF", bits: b64 ? 64 : 32, machine: ELF_MACHINES[machine] ?? `machine ${machine}`, kind: ELF_TYPES[type] ?? `type ${type}`,
    entry: entry === "0x0" ? null : entry, sections, libraries, imports, exports, hardening, notes,
  };
}

// ── PE (Windows) ──────────────────────────────────────────────────────────────────────────────────
const PE_MACHINES: Record<number, string> = { 0x14c: "x86", 0x8664: "x86-64", 0xaa64: "ARM64", 0x1c4: "ARM (Thumb-2)", 0x200: "Itanium", 0xa641: "ARM64EC" };
const SUBSYSTEMS: Record<number, string> = { 1: "native", 2: "Windows GUI", 3: "Windows console", 9: "Windows CE", 10: "EFI application", 14: "Xbox" };

export function readPe(buf: Uint8Array): Program {
  const r = new Bytes(buf, true);
  const lfanew = r.u32(0x3c, "the PE header's offset");
  if (r.u32(lfanew, "the PE signature") !== 0x4550) throw new Unreadable("an MZ file with no PE signature: a DOS program, or damaged");
  const coff = lfanew + 4;
  const machine = r.u16(coff);
  const nsec = bounded(r.u16(coff + 2), 96, "sections");
  const optSize = r.u16(coff + 16);
  const chars = r.u16(coff + 18);
  const opt = coff + 20;
  const magic = r.u16(opt, "the optional header");
  if (magic !== 0x10b && magic !== 0x20b) throw new Unreadable(`optional header magic 0x${magic.toString(16)} is neither PE32 nor PE32+`);
  const b64 = magic === 0x20b;
  const entryRva = r.u32(opt + 16);
  const imageBase = b64 ? r.hex64(opt + 24) : `0x${r.u32(opt + 28).toString(16)}`;
  const subsystem = r.u16(opt + 68);
  const dll = r.u16(opt + 70);
  const ndirs = Math.min(16, r.u32(opt + (b64 ? 108 : 92)));
  const dirs = Array.from({ length: ndirs }, (_, i) => ({ rva: r.u32(opt + (b64 ? 112 : 96) + i * 8), size: r.u32(opt + (b64 ? 116 : 100) + i * 8) }));
  const secAt = opt + optSize;
  r.need(secAt, nsec * 40, "the section table");
  const secs = Array.from({ length: nsec }, (_, i) => {
    const o = secAt + i * 40;
    return { name: r.fixed(o, 8), vsize: r.u32(o + 8), va: r.u32(o + 12), rawSize: r.u32(o + 16), raw: r.u32(o + 20), chars: r.u32(o + 36) };
  });
  const toOff = (rva: number): number | null => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize));
    return s ? s.raw + (rva - s.va) : null;
  };
  const sections: Section[] = secs.map((s) => ({
    name: s.name, addr: `0x${s.va.toString(16)}`, offset: s.raw, size: s.rawSize,
    flags: `${s.chars & 0x40000000 ? "R" : ""}${s.chars & 0x80000000 ? "W" : ""}${s.chars & 0x20000000 ? "X" : ""}` || "-",
  }));
  const notes: string[] = [];

  // imports: each DLL's descriptor, then its names (or ordinals)
  const libraries: string[] = [];
  const imports: string[] = [];
  const imp = dirs[1];
  if (imp?.rva) {
    let o = toOff(imp.rva);
    for (let d = 0; o !== null && d < 1024; d++, o += 20) {
      const thunkRva = r.u32(o) || r.u32(o + 16);
      const nameRva = r.u32(o + 12);
      if (!thunkRva && !nameRva) break;
      const nameOff = toOff(nameRva);
      const dllName = nameOff === null ? "?" : r.cstr(nameOff, 256);
      libraries.push(dllName);
      let t = toOff(thunkRva);
      for (let k = 0; t !== null && k < 20_000; k++, t += b64 ? 8 : 4) {
        const v = b64 ? r.u64(t) : r.u32(t);
        if (!v) break;
        const byOrdinal = b64 ? r.u32(t + 4) >>> 31 === 1 : v >>> 31 === 1;
        if (byOrdinal) imports.push(`${dllName}!#${v & 0xffff}`);
        else {
          const hint = toOff(v & 0x7fffffff);
          if (hint !== null) imports.push(`${dllName}!${r.cstr(hint + 2, 256)}`);
        }
      }
    }
  }
  // exports by name
  const exports: string[] = [];
  const exp = dirs[0];
  if (exp?.rva) {
    const o = toOff(exp.rva);
    if (o !== null) {
      const n = bounded(r.u32(o + 24), 200_000, "exported names");
      const namesAt = toOff(r.u32(o + 32));
      if (namesAt !== null) for (let i = 0; i < n; i++) {
        const at = toOff(r.u32(namesAt + i * 4));
        if (at !== null) exports.push(r.cstr(at, 256));
      }
      const own = toOff(r.u32(o + 12));
      if (own !== null) notes.push(`its own name: ${r.cstr(own, 256)}`);
    }
  }
  const clr = dirs[14];
  if (clr?.rva && clr.size) {
    notes.push("a .NET assembly: its code is CIL, readable with a .NET decompiler (ILSpy, dnSpy)");
    const c = toOff(clr.rva);
    const meta = c === null ? null : toOff(r.u32(c + 8));
    if (meta !== null && r.u32(meta) === 0x424a5342) notes.push(`its runtime: ${r.cstr(meta + 16, Math.min(255, r.u32(meta + 12)))}`); // "BSJB"
  }
  const hardening: Hardening = {
    "ASLR (dynamic base)": Boolean(dll & 0x40),
    "high-entropy ASLR": Boolean(dll & 0x20),
    "DEP (NX compatible)": Boolean(dll & 0x100),
    "Control Flow Guard": Boolean(dll & 0x4000),
    "no SEH": Boolean(dll & 0x400),
    "signed (Authenticode)": Boolean(dirs[4]?.size),
  };
  return {
    format: "PE", bits: b64 ? 64 : 32, machine: PE_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`,
    kind: `${chars & 0x2000 ? "DLL" : "program"} (${SUBSYSTEMS[subsystem] ?? `subsystem ${subsystem}`})`,
    entry: entryRva ? `0x${entryRva.toString(16)} (image base ${imageBase})` : null, sections, libraries, imports, exports, hardening, notes,
  };
}

// ── Mach-O (Apple) ────────────────────────────────────────────────────────────────────────────────
const CPUS: Record<number, string> = { 7: "x86", 0x01000007: "x86-64", 12: "ARM", 0x0100000c: "ARM64", 0x0200000c: "ARM64_32", 18: "PowerPC", 0x01000012: "PowerPC 64" };
const MACHO_TYPES: Record<number, string> = { 1: "object", 2: "executable", 6: "dynamic library", 7: "dynamic linker", 8: "bundle", 9: "dylib stub", 10: "debug symbols", 11: "kernel extension" };
const PLATFORMS: Record<number, string> = { 1: "macOS", 2: "iOS", 3: "tvOS", 4: "watchOS", 6: "Mac Catalyst", 7: "iOS simulator", 11: "visionOS" };

export function readMachO(buf: Uint8Array): Program {
  const r = new Bytes(buf, true);
  const magic = r.u32(0);
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) r.little = false;
  const b64 = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const cpu = r.u32(4);
  const filetype = r.u32(12);
  const ncmds = bounded(r.u32(16), 4096, "load commands");
  const flags = r.u32(24);
  let o = b64 ? 32 : 28;
  const sections: Section[] = [];
  const libraries: string[] = [];
  const notes: string[] = [];
  let entry: string | null = null;
  let signed = false;
  let encrypted: boolean | null = null;
  let symtab: { symoff: number; nsyms: number; stroff: number } | null = null;
  const vers = (v: number) => `${v >>> 16}.${(v >>> 8) & 0xff}.${v & 0xff}`;
  for (let i = 0; i < ncmds; i++) {
    const cmd = r.u32(o, "a load command");
    const size = r.u32(o + 4);
    if (size < 8) throw new Unreadable(`load command ${i} is ${size} bytes long`);
    r.need(o, size, "a load command");
    if (cmd === 0x1 || cmd === 0x19) {
      // a segment and its sections
      const seg = r.fixed(o + 8, 16);
      const nsect = bounded(r.u32(o + (cmd === 0x19 ? 64 : 48)), 512, "sections");
      let s = o + (cmd === 0x19 ? 72 : 56);
      for (let k = 0; k < nsect; k++, s += cmd === 0x19 ? 80 : 68) {
        const prot = r.u32(o + (cmd === 0x19 ? 60 : 44)); // the segment's initial protection
        sections.push({
          name: `${seg},${r.fixed(s, 16)}`, addr: cmd === 0x19 ? r.hex64(s + 32) : `0x${r.u32(s + 32).toString(16)}`,
          offset: r.u32(s + (cmd === 0x19 ? 48 : 40)), size: cmd === 0x19 ? r.u64(s + 40) : r.u32(s + 36),
          flags: `${prot & 1 ? "R" : ""}${prot & 2 ? "W" : ""}${prot & 4 ? "X" : ""}` || "-",
        });
      }
    } else if (cmd === 0xc || cmd === 0x80000018 || cmd === 0x8000001f || cmd === 0x80000023) {
      const name = r.cstr(o + r.u32(o + 8), size);
      libraries.push(cmd === 0x80000018 ? `${name} (weak)` : cmd === 0x8000001f ? `${name} (re-exported)` : name);
    } else if (cmd === 0xd) notes.push(`it is the library ${r.cstr(o + r.u32(o + 8), size)}`);
    else if (cmd === 0x80000028) entry = `0x${r.u64(o + 8).toString(16)} (from the start of its text)`;
    else if (cmd === 0x5 && !entry) {
      // LC_UNIXTHREAD: the entry is the program counter in its starting thread state (after the flavour and the count)
      const flavor = r.u32(o + 8);
      const pc = cpu === 0x01000007 && flavor === 4 ? r.u64(o + 16 + 16 * 8) : cpu === 7 && flavor === 1 ? r.u32(o + 16 + 10 * 4) : cpu === 0x0100000c && flavor === 6 ? r.u64(o + 16 + 32 * 8) : null;
      entry = pc === null ? "set by its starting thread state" : `0x${pc.toString(16)} (its starting thread state)`;
    }
    else if (cmd === 0x1d) signed = true;
    else if (cmd === 0x21 || cmd === 0x2c) encrypted = r.u32(o + 16) !== 0;
    else if (cmd === 0x2) symtab = { symoff: r.u32(o + 8), nsyms: bounded(r.u32(o + 12), 2_000_000, "symbols"), stroff: r.u32(o + 16) };
    else if (cmd === 0x32) notes.push(`built for ${PLATFORMS[r.u32(o + 8)] ?? `platform ${r.u32(o + 8)}`} ${vers(r.u32(o + 12))} or later`);
    else if (cmd === 0x1b) notes.push(`its UUID: ${[...r.slice(o + 8, 16)].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
    else if (cmd === 0x8000001c) notes.push(`it looks for libraries in ${r.cstr(o + r.u32(o + 8), size)}`);
    o += size;
  }
  const imports: string[] = [];
  const exports: string[] = [];
  if (symtab) {
    const size = b64 ? 16 : 12;
    r.need(symtab.symoff, symtab.nsyms * size, "the symbol table");
    for (let i = 0; i < symtab.nsyms; i++) {
      const s = symtab.symoff + i * size;
      const type = r.u8(s + 4);
      if (type & 0xe0) continue; // a debugging entry
      const name = r.cstr(symtab.stroff + r.u32(s), 512);
      const ext = Boolean(type & 1);
      if (!ext || !name) continue;
      if ((type & 0x0e) === 0) imports.push(name);
      else if ((type & 0x0e) === 0x0e) exports.push(name);
    }
  }
  const hardening: Hardening = {
    PIE: Boolean(flags & 0x200000),
    "no heap execution": Boolean(flags & 0x1000000),
    "stack canary": imports.includes("___stack_chk_fail") || imports.includes("___stack_chk_guard"),
    "code signature": signed,
    "encrypted (App Store)": encrypted,
  };
  return {
    format: "Mach-O", bits: b64 ? 64 : 32, machine: CPUS[cpu] ?? `cpu 0x${cpu.toString(16)}`, kind: MACHO_TYPES[filetype] ?? `type ${filetype}`,
    entry, sections, libraries, imports: [...new Set(imports)], exports: [...new Set(exports)], hardening, notes,
  };
}

/** A fat (universal) Mach-O: its slices, each read in turn. */
export function readFat(buf: Uint8Array): { slices: { machine: string; offset: number; size: number; program: Program | null; why?: string }[] } {
  const r = new Bytes(buf, false);
  const fat64 = r.u32(0) === 0xcafebabf;
  const n = bounded(r.u32(4), 32, "slices");
  const slices = [];
  for (let i = 0; i < n; i++) {
    const o = 8 + i * (fat64 ? 32 : 20);
    const cpu = r.u32(o);
    const offset = fat64 ? r.u64(o + 8) : r.u32(o + 8);
    const size = fat64 ? r.u64(o + 16) : r.u32(o + 12);
    try {
      slices.push({ machine: CPUS[cpu] ?? `cpu 0x${cpu.toString(16)}`, offset, size, program: readMachO(r.slice(offset, size, "a slice")) });
    } catch (e) {
      slices.push({ machine: CPUS[cpu] ?? `cpu 0x${cpu.toString(16)}`, offset, size, program: null, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { slices };
}

// ── strings ───────────────────────────────────────────────────────────────────────────────────────
export type Strings = { count: number; interesting: { kind: string; text: string }[]; sample: string[]; matched: string[] };

const INTERESTING: [string, RegExp][] = [
  ["address", /\bhttps?:\/\/[^\s"'<>]{4,}/i],
  ["path", /(^|[\s"'])(\/(usr|etc|var|tmp|home|opt|Library|System|Applications|proc|dev)\/[\w./-]+|[A-Za-z]:\\[\w\\. -]+)/],
  ["email", /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/],
  ["IP address", /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/],
  ["registry key", /\bHKEY_[A-Z_]+\\|\bSOFTWARE\\/],
  ["format string", /%[-+ #0]*\d*(?:\.\d+)?[sdxXuflpc]\b.*%/],
  ["version", /\b(?:v|version\s?)\d+\.\d+(?:\.\d+)?\b/i],
  ["secret-like (shown cut)", /\b(?:api[_-]?key|secret|token|passw(?:or)?d|bearer)\b/i],
];
/** A secret-looking string is shown cut, never whole. */
const cut = (s: string): string => (s.length > 12 ? `${s.slice(0, 6)}…(${s.length} characters)` : "…");

/** The printable strings in a binary: ASCII runs and UTF-16LE runs at least `min` long; the interesting ones first. */
export function stringsOf(buf: Uint8Array, o: { min?: number; match?: RegExp | null; max?: number } = {}): Strings {
  const min = o.min ?? 6;
  const max = o.max ?? 200_000;
  const found: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= min && found.length < max) found.push(String.fromCharCode(...run));
    run = [];
  };
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]!;
    if ((c >= 32 && c < 127) || c === 9) {
      if (run.length < 4096) run.push(c);
    } else flush();
  }
  flush();
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i]!;
    if (((c >= 32 && c < 127) || c === 9) && buf[i + 1] === 0) {
      if (run.length < 4096) run.push(c);
    } else flush();
  }
  flush();
  const unique = [...new Set(found)];
  const interesting: Strings["interesting"] = [];
  for (const s of unique) {
    const hit = INTERESTING.find(([, re]) => re.test(s));
    if (hit && interesting.length < 120) interesting.push({ kind: hit[0], text: hit[0].startsWith("secret") ? cut(s) : s.slice(0, 200) });
  }
  const matched = o.match ? unique.filter((s) => o.match!.test(s)).slice(0, 200).map((s) => s.slice(0, 300)) : [];
  return { count: unique.length, interesting, sample: unique.filter((s) => s.length >= 10).slice(0, 40).map((s) => s.slice(0, 120)), matched };
}

// ── archives and other programs ───────────────────────────────────────────────────────────────────
/** A zip's entries from its central directory (an APK, a JAR, an IPA, an XPI are zips): what it is, what is in it. */
export function readZip(buf: Uint8Array): { what: string; entries: { name: string; size: number }[] } {
  const r = new Bytes(buf, true);
  // the end-of-central-directory record is in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (r.u32(i) === 0x06054b50) {
    eocd = i;
    break;
  }
  if (eocd < 0) throw new Unreadable("a zip with no end-of-central-directory record: cut short, or not a zip");
  const n = bounded(r.u16(eocd + 10), 200_000, "zip entries");
  let o = r.u32(eocd + 16, "the central directory's offset");
  const entries: { name: string; size: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (r.u32(o, "a central directory entry") !== 0x02014b50) throw new Unreadable(`zip entry ${i} is not where the directory says`);
    const size = r.u32(o + 24);
    const nameLen = r.u16(o + 28);
    const extra = r.u16(o + 30);
    const comment = r.u16(o + 32);
    entries.push({ name: new TextDecoder().decode(r.slice(o + 46, nameLen, "an entry's name")), size });
    o += 46 + nameLen + extra + comment;
  }
  const has = (re: RegExp) => entries.some((e) => re.test(e.name));
  const what = has(/^AndroidManifest\.xml$/) && has(/^classes\d*\.dex$/) ? "an Android app (APK): its code is DEX, readable with JADX"
    : has(/^Payload\/[^/]+\.app\//) ? "an iPhone app (IPA): its program is a Mach-O inside Payload/<name>.app"
    : has(/^META-INF\/MANIFEST\.MF$/) && has(/\.class$/) ? "a Java archive (JAR)"
    : has(/^manifest\.json$/) && has(/\.js$/) ? "a browser extension, or a web app's bundle"
    : "a zip archive";
  return { what, entries };
}

/** A WebAssembly module: what it imports from its host and exports to it. */
export function readWasm(buf: Uint8Array): { version: number; imports: string[]; exports: string[]; functions: number } {
  const r = new Bytes(buf, true);
  const version = r.u32(4);
  let o = 8;
  const leb = (): number => {
    let v = 0;
    let shift = 0;
    for (let k = 0; k < 5; k++) {
      const b = r.u8(o++, "a WebAssembly number");
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
      shift += 7;
    }
    throw new Unreadable("a WebAssembly number longer than five bytes");
  };
  const name = (): string => {
    const n = leb();
    return new TextDecoder().decode(r.slice(o, n, "a WebAssembly name")).slice(0, 200) + ((o += n), "");
  };
  const imports: string[] = [];
  const exports: string[] = [];
  let functions = 0;
  const KINDS = ["function", "table", "memory", "global", "tag"];
  for (let s = 0; o < buf.length && s < 1000; s++) {
    const id = r.u8(o++);
    const size = leb();
    const end = o + size;
    r.need(o, size, "a WebAssembly section");
    if (id === 2) {
      const n = bounded(leb(), 100_000, "imports");
      for (let i = 0; i < n; i++) {
        const mod = name();
        const field = name();
        const kind = r.u8(o++);
        imports.push(`${mod}.${field} (${KINDS[kind] ?? kind})`);
        // skip the import's type: a function's index, or a table, memory or global's description
        if (kind === 0) leb();
        else if (kind === 1) (o++, r.u8(o++) & 1 ? (leb(), leb()) : leb());
        else if (kind === 2) r.u8(o++) & 1 ? (leb(), leb()) : leb();
        else if (kind === 3) o += 2;
        else if (kind === 4) (o++, leb());
      }
    } else if (id === 3) functions = leb();
    else if (id === 7) {
      const n = bounded(leb(), 100_000, "exports");
      for (let i = 0; i < n; i++) {
        const field = name();
        const kind = r.u8(o++);
        leb();
        exports.push(`${field} (${KINDS[kind] ?? kind})`);
      }
    }
    o = end;
  }
  return { version, imports, exports, functions };
}

/** A Java class file's name and the Java it needs. */
export function readClass(buf: Uint8Array): { java: string } {
  const r = new Bytes(buf, false);
  const major = r.u16(6);
  return { java: major >= 45 ? `Java ${major - 44} or later (class version ${major})` : `class version ${major}` };
}
