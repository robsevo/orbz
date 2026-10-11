// What the reverse engineer's tools ask for, answered (PLAN 4.8). The reading itself runs on a worker thread of its own
// with a ceiling on its memory and its time, so a file built to blow up a reader costs a refusal, never the home: the
// worker is ended at the deadline, and a reader that throws says why.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { Worker } from "node:worker_threads";
import { readApp } from "./app.ts";
import { kindOf, readClass, readElf, readFat, readMachO, readPe, readWasm, readZip, sha256, stringsOf, type Program } from "./binary.ts";
import { Unreadable } from "./bytes.ts";
import { bytecodeOf, readEvm } from "./evm.ts";
import { readHar } from "./har.ts";
import { appText, cap, evmText, harText, programText, stringsText } from "./report.ts";

export type Ask =
  | { kind: "binary"; path: string; match: string | null }
  | { kind: "app"; path: string }
  | { kind: "contract"; path: string | null; hex: string | null }
  | { kind: "capture"; path: string };
export type Answer = { text: string; isError?: boolean };

/** The largest file read whole. */
export const MAX_FILE = 512 * 1024 * 1024;

const whyOf = (e: unknown): string => (e instanceof Unreadable ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** The answer, on this thread (the worker calls it; tests may too). */
export function answer(ask: Ask): Answer {
  try {
    if (ask.kind === "contract") {
      const text = ask.hex ?? readFileSync(ask.path!, "utf8");
      return { text: evmText(readEvm(bytecodeOf(text)), ask.path ? basename(ask.path) : "the bytecode given") };
    }
    if (ask.kind === "capture") return { text: harText(readHar(readFileSync(ask.path, "utf8")), basename(ask.path)) };
    if (ask.kind === "app") return { text: appText(readApp(ask.path), basename(ask.path)) };
    const st = statSync(ask.path);
    if (st.isDirectory()) return { text: appText(readApp(ask.path), basename(ask.path)) };
    if (st.size > MAX_FILE) return { text: `${basename(ask.path)} is ${(st.size / 1024 / 1024).toFixed(0)} MB: over the ${MAX_FILE / 1024 / 1024} MB read whole. Its first bytes: ${kindOf(readFileSync(ask.path).subarray(0, 4096))}.`, isError: true };
    const buf = readFileSync(ask.path);
    const file = basename(ask.path);
    const kind = kindOf(buf, file);
    let match: RegExp | null = null;
    if (ask.match) {
      try {
        match = new RegExp(ask.match, "i");
      } catch {
        match = new RegExp(ask.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }
    }
    const strings = (): ReturnType<typeof stringsOf> => stringsOf(buf, { match });
    const program = (p: Program): Answer => ({ text: programText(p, { file, size: buf.length, sha256: sha256(buf), strings: strings(), match: ask.match }) });
    if (kind === "elf") return program(readElf(buf));
    if (kind === "pe") return program(readPe(buf));
    if (kind === "macho") return program(readMachO(buf));
    if (kind === "macho-fat") {
      const f = readFat(buf);
      const first = f.slices.find((s) => s.program);
      const head = `${file}: a universal Mach-O with ${f.slices.length} slices: ${f.slices.map((s) => `${s.machine} (${s.program ? "read" : `unreadable: ${s.why}`})`).join(", ")}. The first readable slice:\n\n`;
      return first?.program ? { text: cap(head + programText(first.program, { file, size: buf.length, sha256: sha256(buf), strings: strings(), match: ask.match })) } : { text: head + "none could be read", isError: true };
    }
    if (kind === "asar") return { text: appText(readApp(ask.path), file) };
    if (kind === "har") return { text: harText(readHar(buf.toString("utf8")), file) };
    if (kind === "evm-hex") return { text: evmText(readEvm(bytecodeOf(buf.toString("utf8"))), file) };
    if (kind === "zip") {
      const z = readZip(buf);
      const big = [...z.entries].sort((a, b) => b.size - a.size).slice(0, 15);
      return { text: cap([`${file}: ${z.what}, ${z.entries.length.toLocaleString("en-US")} entries, sha256 ${sha256(buf)}.`, "Its largest entries:", ...big.map((e) => `  ${e.name} (${e.size.toLocaleString("en-US")} bytes)`), "Its entries:", ...z.entries.slice(0, 150).map((e) => `  ${e.name}`), "To read what is inside, unzip it in your workspace and read the parts."].join("\n")) };
    }
    if (kind === "wasm") {
      const w = readWasm(buf);
      return { text: cap([`${file}: a WebAssembly module (version ${w.version}), ${w.functions} functions of its own, sha256 ${sha256(buf)}.`, `It imports from its host (${w.imports.length}): ${w.imports.slice(0, 80).join(", ") || "nothing"}.`, `It exports (${w.exports.length}): ${w.exports.slice(0, 80).join(", ") || "nothing"}.`, "", stringsText(strings(), ask.match)].join("\n")) };
    }
    if (kind === "java-class") return { text: cap(`${file}: a Java class file, ${readClass(buf).java}. A Java decompiler (CFR, Procyon) reads it back to source.\n\n${stringsText(strings(), ask.match)}`) };
    const words: Record<string, string> = { dex: "Android DEX bytecode (JADX reads it back to Java)", pdf: "a PDF document", text: "text", unknown: "data of no kind it knows" };
    return { text: cap(`${file}: ${words[kind] ?? kind}, ${buf.length.toLocaleString("en-US")} bytes, sha256 ${sha256(buf)}.\n\n${stringsText(strings(), ask.match)}`) };
  } catch (e) {
    return { text: `It could not be read: ${whyOf(e)}.`, isError: true };
  }
}

/** The answer, read on a worker with at most `memoryMb` of heap and `timeoutMs` to finish. */
export function readOffThread(ask: Ask, o: { signal?: AbortSignal; timeoutMs?: number; memoryMb?: number } = {}): Promise<Answer> {
  return new Promise((resolve) => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: ask, resourceLimits: { maxOldGenerationSizeMb: o.memoryMb ?? 384, maxYoungGenerationSizeMb: 48 } });
    let done = false;
    const finish = (a: Answer): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", stop);
      void w.terminate();
      resolve(a);
    };
    const stop = (): void => finish({ text: "Stopped by the user.", isError: true });
    const timer = setTimeout(() => finish({ text: `It took longer than ${Math.round((o.timeoutMs ?? 60_000) / 1000)} s to read, so it was stopped: ask about one part of it.`, isError: true }), o.timeoutMs ?? 60_000);
    o.signal?.addEventListener("abort", stop);
    w.on("message", (a: Answer) => finish(a));
    w.on("error", (e) => finish({ text: `It could not be read: ${/heap|memory/i.test(String(e)) ? "it needed more memory than a reading is given" : whyOf(e)}.`, isError: true }));
    w.on("exit", (code) => finish({ text: `It could not be read (the reader stopped, code ${code}).`, isError: true }));
  });
}
