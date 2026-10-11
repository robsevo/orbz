// What a reverse engineer's tools say, as text an orb (and you) can read: the facts first, the evidence named (the file,
// the channel, the library), what could not be read said plainly, cut to a length a model can hold (PLAN 4.8).
import type { AppFacts } from "./app.ts";
import type { Program, Strings } from "./binary.ts";
import type { EvmFacts } from "./evm.ts";
import type { HarFacts } from "./har.ts";

const CAP = 14_000;
const list = (xs: string[], n: number): string => (xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} … and ${(xs.length - n).toLocaleString("en-US")} more`);
const yes = (v: boolean | string | null): string => (v === null ? "not said" : v === true ? "yes" : v === false ? "no" : v);
export const cap = (t: string): string => (t.length <= CAP ? t : `${t.slice(0, CAP)}\n… (cut at ${CAP.toLocaleString("en-US")} characters: ask about one part for more)`);
const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);

export function programText(p: Program, o: { file: string; size: number; sha256: string; strings: Strings | null; match: string | null }): string {
  const out = [
    `${o.file}: ${p.format}, ${p.bits}-bit ${p.machine}, ${p.kind}. ${kb(o.size)}, sha256 ${o.sha256}.`,
    p.entry ? `Entry: ${p.entry}.` : "No entry point (a library or an object).",
    "",
    `Hardening: ${Object.entries(p.hardening).map(([k, v]) => `${k} ${yes(v)}`).join("; ")}.`,
    ...p.notes.map((n) => `- ${n}`),
    "",
    `Libraries it loads (${p.libraries.length}): ${p.libraries.length ? list(p.libraries, 40) : "none"}.`,
    `Imports (${p.imports.length}): ${p.imports.length ? list(p.imports, 80) : "none"}.`,
    `Exports (${p.exports.length}): ${p.exports.length ? list(p.exports, 60) : "none"}.`,
    "",
    `Sections (${p.sections.length}):`,
    ...p.sections.slice(0, 60).map((s) => `  ${s.name || "(unnamed)"}  ${s.flags}  ${kb(s.size)} at ${s.addr}`),
  ];
  if (o.strings) out.push("", stringsText(o.strings, o.match));
  out.push("", "Nothing was run. For its instructions, a disassembler (objdump -d, Ghidra) is a command away; ask before running one.");
  return cap(out.join("\n"));
}

export function stringsText(s: Strings, match: string | null): string {
  const out = [`Strings: ${s.count.toLocaleString("en-US")} printable runs.`];
  if (match) out.push(`Matching ${match} (${s.matched.length}):`, ...s.matched.slice(0, 80).map((m) => `  ${m}`));
  if (s.interesting.length) out.push("Worth a look:", ...s.interesting.slice(0, 60).map((i) => `  [${i.kind}] ${i.text}`));
  if (!match) out.push("A sample:", ...s.sample.slice(0, 20).map((x) => `  ${x}`));
  return out.join("\n");
}

export function appText(a: AppFacts, file: string): string {
  const out = [
    `${file}: ${a.what}${a.pkg.name ? `, ${a.pkg.name}${a.pkg.version ? ` ${a.pkg.version}` : ""}` : ""}${a.pkg.electron ? ` (Electron ${a.pkg.electron})` : ""}.`,
    a.pkg.description ? `It says of itself: ${a.pkg.description}` : "",
    `${a.counts.files.toLocaleString("en-US")} files; ${a.counts.ownScripts.toLocaleString("en-US")} of its own scripts (${a.counts.read.toLocaleString("en-US")} read), ${a.counts.scripts - a.counts.ownScripts} in its dependencies; ${a.counts.pages} pages; ${a.counts.native} native add-ons; ${a.counts.maps} source maps.`,
    `Entry: ${a.entry ?? "not found"}${a.preloads.length ? `; preloads: ${a.preloads.join(", ")}` : ""}.`,
  ].filter(Boolean);
  if (a.channels.length || a.dynamicChannels.length) {
    out.push("", `IPC channels (${a.channels.length}):`);
    for (const c of a.channels.slice(0, 80))
      out.push(`  "${c.channel}": ${c.handled.length ? `handled in ${c.handled.join(", ")}` : "handled nowhere it says"}; ${c.called.length ? `called from ${c.called.join(", ")}` : "called from no page script read"}${c.sent.length ? `; sent to pages from ${c.sent.join(", ")}` : ""}.`);
    const lonely = a.channels.filter((c) => !c.handled.length && c.called.length).map((c) => c.channel);
    if (lonely.length) out.push(`  Called but never handled in what was read: ${list(lonely, 20)} (a handler in code not read, or dead).`);
    if (a.dynamicChannels.length) out.push(`  Channels made at run time (${a.dynamicChannels.length}): ${a.dynamicChannels.slice(0, 10).map((d) => `${d.side}.${d.op}(${d.expr}) in ${d.file}`).join("; ")}.`);
  }
  if (a.exposed.length) out.push("", "What preloads expose to the page:", ...a.exposed.map((e) => `  window.${e.name} (${e.file}): ${e.keys.length ? e.keys.join(", ") : "built at run time"}`));
  if (a.windows.length) out.push("", `Windows (${a.windows.length}):`, ...a.windows.slice(0, 20).map((w) => `  in ${w.file}: ${Object.entries(w.prefs).map(([k, v]) => `${k}: ${v}`).join(", ") || "default web preferences"}`));
  if (a.risky.length) out.push("", "Worth a look for safety:", ...a.risky.slice(0, 30).map((r) => `  ${r.what} (${r.file})`));
  if (a.native.length) out.push("", "Native code:", ...a.native.slice(0, 30).map((n) => `  ${n.what === "a native add-on (compiled code: inspect_binary reads it)" ? n.file : `${n.what} in ${n.file}`}`));
  if (a.powers.length) out.push("", "What its scripts can do to the machine:", ...a.powers.map((p) => `  ${p.power}: ${p.files.join(", ")}`));
  if (a.hosts.length) out.push("", `Addresses it names (${a.hosts.length}): ${list(a.hosts, 40)}.`);
  if (a.sources.length) out.push("", "Original sources from its source maps:", ...a.sources.map((s) => `  ${s.from}: ${s.files} files${s.withText ? `, ${s.withText} with their text` : ""}: ${s.sample.join(", ")}`));
  if (a.pkg.dependencies.length) out.push("", `Its dependencies (${a.pkg.dependencies.length}): ${list(a.pkg.dependencies, 50)}.`);
  if (a.graph.length) out.push("", "Which of its files import which:", ...a.graph.slice(0, 40).map((g) => `  ${g.file} → ${g.imports.join(", ")}`));
  if (a.limits.length) out.push("", "Not read, or read only in part:", ...a.limits.map((l) => `  ${l}`));
  out.push("", "Nothing was run. A minified name means little; a channel, a string and a setting mean what they say.");
  return cap(out.join("\n"));
}

export function evmText(e: EvmFacts, file: string): string {
  const out = [
    `${file}: EVM bytecode, ${kb(e.size)}${e.creation ? " (creation code read down to its runtime)" : ""}${e.compiler ? `, built by ${e.compiler}` : ""}${e.push0 ? ", uses PUSH0 (Shanghai or later)" : ""}.`,
    e.proxy ? `It is ${e.proxy}.` : "",
    `Functions its dispatcher answers (${e.functions.length}):`,
    ...e.functions.map((f) => `  ${f.selector}  ${f.name ?? "(not a well-known one: a signature database may name it)"}${f.watch ? "  ← worth a look" : ""}`),
    `Opcodes worth counting: ${Object.entries(e.opcodes).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`,
    ...e.notes.map((n) => `- ${n}`),
    "",
    "Read from its bytes alone: arguments, storage and what each function does need its verified source or a decompiler.",
  ].filter(Boolean);
  return cap(out.join("\n"));
}

export function harText(h: HarFacts, file: string): string {
  const out = [
    `${file}: a network capture (HAR ${h.version}), ${h.entries.toLocaleString("en-US")} requests${h.span ? `, ${h.span.from} to ${h.span.to}` : ""}.`,
    "",
    `Hosts (${h.hosts.length}):`,
    ...h.hosts.slice(0, 30).map((x) => `  ${x.host}: ${x.requests} requests, ${kb(x.bytes)}`),
    "",
    `Endpoints (${h.endpoints.length}), the busiest first:`,
    ...h.endpoints.slice(0, 60).map((e) => `  ${e.method} ${e.host}${e.path} ×${e.count}, ${e.statuses.join("/") || "no status"}, ${e.types.join("/")}${e.sends.length ? `; sends {${e.sends.slice(0, 12).join(", ")}}` : ""}${e.answers.length ? `; answers {${e.answers.slice(0, 12).join(", ")}}` : ""}`),
  ];
  if (h.graphql.length) out.push("", `GraphQL operations: ${list(h.graphql, 40)}.`);
  if (h.websockets) out.push(`Websockets: ${h.websockets}.`);
  if (h.credentials.length) out.push("", "Credentials it carries (names only, never their values):", ...h.credentials.slice(0, 30).map((c) => `  ${c}`));
  if (h.cookies.length) out.push(`Cookies by name: ${list(h.cookies, 40)}.`);
  out.push(...h.notes.map((n) => `- ${n}`));
  return cap(out.join("\n"));
}
