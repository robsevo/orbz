#!/usr/bin/env python3
"""Controls for the home's tests (PLAN 1.2_t; CLAUDE.md rule 4): each mutant plants one real
defect in a scratch copy of packages/home (or packages/terminal, PLAN 1.9_t), and the named suite
must go red. The repo itself is never touched.

    pnpm check:controls      # runs this after tools/check_controls.py
    tools/home_mutants.py --only terminal/    # just the mutants whose file, name or suite has this text
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOME_PKG = REPO / "packages" / "home"
TERMINAL_PKG = REPO / "packages" / "terminal"
APP_PKG = REPO / "packages" / "app"

# (the defect, the file, its edits as (exact text, replacement), the suites that must go red)
MUTANTS: list[tuple[str, str, list[tuple[str, str]], list[str]]] = [
    ("schedules skip missed times (Open Dot)", "src/schedule.ts", [
        ("      if (!missedTimes) continue;",
         "      if (!missedTimes || missedTimes.count > 1) { if (missedTimes) this.#db.prepare('UPDATE schedules SET last_due = ? WHERE id = ?').run(missedTimes.due, s.id); continue; }"),
    ], ["home.test.ts"]),
    ("triggers drop what happened during sleep", "src/triggers.ts", [
        ("      if (t.started) for (const e of [...got.events].sort((a, b) => a.at - b.at)) if (this.#deliver(t, e)) n++;",
         "      if (t.started) for (const e of [...got.events].sort((a, b) => a.at - b.at)) if (this.#clock.now() - e.at < 10 * 60_000 && this.#deliver(t, e)) n++;"),
    ], ["home.test.ts"]),
    ("tripwire hashed after the sensor (Ash before 09-10)", "src/loops.ts", [
        ("    const before = hashFiles(globs);", "    let before = hashFiles(globs);"),
        ("        plan = await untilAborted(Promise.resolve(def.sense(abort.signal)), abort.signal);",
         "        plan = await untilAborted(Promise.resolve(def.sense(abort.signal)), abort.signal); before = hashFiles(globs);"),
    ], ["loops.test.ts"]),
    ("two runs at once for one orb", "src/inbox.ts", [
        ("    if (this.#closed || this.#active.has(orb)) return;",
         "    if (this.#closed) return; if (this.#active.has(orb) && this.queued(orb).length === 0) return;"),
    ], ["inbox.test.ts"]),
    ("no batching: one item per run", "src/inbox.ts", [
        ("      batch.push(it);\n", "      batch.push(it);\n      break;\n"),
    ], ["inbox.test.ts"]),
    ("a crash drops the cut-off work", "src/inbox.ts", [
        ('if (outcome === "paused" || outcome === "shutdown" || outcome === "interrupted") {',
         'if (outcome === "paused" || outcome === "shutdown") {'),
    ], ["inbox.test.ts"]),
    ("the event log allows UPDATE", "src/db.ts", [
        ("  CREATE TRIGGER events_no_update BEFORE UPDATE ON events\n    BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;\n", ""),
    ], ["events.test.ts"]),
    # the kit's supervisor (PLAN 1.3)
    ("the kit restarts forever (no crash-loop give-up)", "src/kit.ts", [
        ("    if (this.#restarts.length >= CRASH_LOOP_RESTARTS) {", "    if (false) {"),
    ], ["kit.test.ts"]),
    ("the kit restarts with no backoff", "src/kit.ts", [
        ("    const wait = Math.min(15_000, 1000 * 2 ** (this.#restarts.length - 1));", "    const wait = 1000;"),
    ], ["kit.test.ts"]),
    ("the kit inherits ASH_* from the home", "src/kit.ts", [
        ('    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ASH_")) env[k] = v;\n'
         '    Object.assign(env, {',
         '    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;\n'
         '    Object.assign(env, {'),
    ], ["kit.test.ts"]),
    ("a death mid-call surfaces as a vague error, not its reason", "src/kit.ts", [
        ("        g.onDeath.then((why): never => {\n          throw new KitDiedError(tool, why);\n        }),",
         "        new Promise<never>(() => {}),"),
        ("      const err = g.died !== null && !(e instanceof KitDiedError) ? new KitDiedError(tool, g.died) : e;",
         "      const err = e;"),
    ], ["kit.test.ts"]),
    # the brain ladder (PLAN 1.4)
    ("a spend cap becomes a fall-through to another brain", "src/brain/ladder.ts", [
        ("    this.#o.spend.check(); // throws SpendCapError: never caught here",
         "    try { this.#o.spend.check(); } catch (e) { return { why: String(e) }; }"),
    ], ["ladder.test.ts"]),
    ("no cap check before a brain call", "src/brain/ladder.ts", [
        ("    this.#o.spend.check(); // throws SpendCapError: never caught here\n", ""),
    ], ["ladder.test.ts"]),
    ("a tripped guard falls through silently", "src/brain/ladder.ts", [
        ('fell, said: passedOn ? sentence(task.kind, fell, "big") : null });', 'fell, said: null });'),
    ], ["ladder.test.ts"]),
    ("the provider's reported cost is ignored", "src/brain/openai.ts", [
        ('  const header = headers.get("x-litellm-response-cost");', '  const header = null as string | null;'),
    ], ["ladder.test.ts"]),
    ("the router preset leaves fallbacks on", "src/brain/presets.ts", [
        ("extra: { disable_fallbacks: true }, price:", "extra: {}, price:"),
    ], ["ladder.test.ts"]),
    # the agent loop (PLAN 1.5)
    ("a stop throws the partial reply away", "src/agent/loop.ts", [
        ('        if (r.text) conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: r.text, meta: { stopped: true } });\n', ""),
    ], ["stop.test.ts"]),
    ("a stop does not reach a running command", "src/agent/tools.ts", [
        ('    signal?.addEventListener("abort", onAbort, { once: true });\n    child.on("error", (e) => finish({ content: `The command failed', '    child.on("error", (e) => finish({ content: `The command failed'),
    ], ["tools.test.ts"]),
    ("a stop kills the shell but not its children", "src/agent/tools.ts", [
        ('    else process.kill(-child.pid, "SIGKILL");', '    else child.kill("SIGKILL");'),
    ], ["tools.test.ts"]),
    ("a new message does not expire the open card", "src/agent/loop.ts", [
        ("      if (open) this.#expire(open, ctx);\n", ""),
    ], ["agent.test.ts"]),
    ("a re-run after a crash is taken for a new message", "src/agent/loop.ts", [
        ("      if (conv.hasItem(ctx.conversation, item.id)) continue;\n      const open", "      const open"),
    ], ["agent.test.ts"]),
    ("a denied card runs its call anyway", "src/agent/loop.ts", [
        ('    else if (card.status === "denied") result = { content: DENIED };\n', ""),
    ], ["agent.test.ts"]),
    ("compaction summaries are ignored", "src/agent/conversation.ts", [
        ('    if (!summary) return live.filter((m) => m.role !== "summary");', '    if (summary || !summary) return live.filter((m) => m.role !== "summary");'),
    ], ["survive.test.ts"]),
    ("listeners hear an event before it is committed", "src/events.ts", [
        ("    afterCommit(this.#db, () => {", "    ((fn: () => void) => fn())(() => {"),
    ], ["events.test.ts"]),
    # rules and the floor (PLAN 1.6)
    ("a rule's allow loosens the floor", "src/rules/policy.ts", [
        ("  for (const h of f.floor) {\n    d = strictest(d, \"ask\");", "  for (const h of f.floor) {\n    d = f.rule.decision === \"allow\" ? d : strictest(d, \"ask\");"),
    ], ["rules.test.ts"]),
    ("a protected write is only asked about, not refused", "src/rules/policy.ts", [
        ("  if (protectedHit) return { decision: \"never\",", "  if (protectedHit && false) return { decision: \"never\","),
    ], ["rules.test.ts"]),
    ("the one-way switch is ignored", "src/rules/policy.ts", [
        ("  if (f.oneway && !f.oneway.allowed) {\n    d = strictest(d, \"ask\");", "  if (f.oneway && !f.oneway.allowed) {"),
    ], ["rules.test.ts"]),
    ("away is not read-only", "src/rules/policy.ts", [
        ("  if (f.mode === \"away\" && f.outward) {\n    d = strictest(d, \"ask\");", "  if (f.mode === \"away\" && f.outward) {"),
    ], ["rules.test.ts"]),
    ("a rule matcher that fails means allow", "src/rules/rules.ts", [
        ('          decision: decision ? strictest(decision, "ask") : "ask",', '          decision: decision ?? null,'),
    ], ["rules.test.ts"]),
    ("'always' is accepted on a card the floor raised", "src/home.ts", [
        ("      if (card.meta.mayAlways !== true) throw", "      if (false) throw"),
    ], ["rules.test.ts"]),
    ("untrusted text reaches the model unfenced", "src/rules/guard.ts", [
        ("    if (!def.untrusted || r.stoppedByUser) return r;", "    if (true) return r;"),
    ], ["rules.test.ts"]),
    ("traces keep what the kit was asked to redact", "src/home.ts", [
        ('                const r = await kit.call("redact_text", { text });', '                const r = text;'),
    ], ["rules.test.ts"]),
    ("two concurrent kit starts spawn two kits", "src/kit.ts", [
        ("    this.#starting ??= this.#start().finally(() => (this.#starting = null));\n    return this.#starting;", "    return this.#start();"),
    ], ["kit.test.ts"]),
    # plan cards and the gate (PLAN 1.7)
    ("a feature without its test row reaches the person", "src/plans/format.ts", [
        ("    if (!next || next.id !== r.id || !next.test) out.push(", "    if (false) out.push("),
    ], ["plans.test.ts"]),
    ("a typed count is trusted", "src/plans/gate.ts", [
        ("  const hard = [...shape(plan, parsed), ...wrongCounts(plan, c)];", "  const hard = [...shape(plan, parsed)];"),
    ], ["plans.test.ts"]),
    ("soft objections are never sent back", "src/plans/plans.ts", [
        ("export const SEND_BACKS = 2;", "export const SEND_BACKS = 0;"),
    ], ["plans.test.ts"]),
    ("a change with no new rows is shown", "src/plans/gate.ts", [
        ("    if (features <= before) hard.push(", "    if (false) hard.push("),
    ], ["plans.test.ts"]),
    ("a one-feature plan is shown", "src/plans/gate.ts", [
        ("  if (features > 0 && features < 2) hard.push(", "  if (false) hard.push("),
    ], ["plans.test.ts"]),
    ("a shown plan's text can be rewritten", "src/db.ts", [
        ("  CREATE TRIGGER plans_body_frozen BEFORE UPDATE OF body, shown ON plans\n    BEGIN SELECT RAISE(ABORT, 'a shown plan is history: its text is never edited'); END;\n", ""),
    ], ["plans.test.ts"]),
    # row by row, ticked with proof (PLAN 1.8)
    ("a failing test ticks the row", "src/plans/board.ts", [
        ("        const passed = !res.isError;", "        const passed = true;"),
    ], ["board.test.ts"]),
    ("a test that cannot fail is accepted", "src/plans/board.ts", [
        ("    if (CANNOT_FAIL.test(command)) throw", "    if (false) throw"),
    ], ["board.test.ts"]),
    ("a feature ticks without its test row", "src/plans/board.ts", [
        ('        .prepare("UPDATE board SET box = ?, evidence = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)")',
         '        .prepare("UPDATE board SET box = ?, evidence = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?) AND test = 0")'),
    ], ["board.test.ts"]),
    ("a visual row ticks without pagecheck", "src/plans/board.ts", [
        ("    if (this.#visual(plan, row)) throw", "    if (false) throw"),
    ], ["board.test.ts"]),
    ("one failed spawn counted as two deaths", "src/kit.ts", [
        ("      if (g.died !== null) return;\n      if (partial.trim())", "      if (partial.trim())"),
    ], ["kit.test.ts"]),
    # the home's data is the person's (10-01: ~/.orbs was 0755, home.db 0644)
    ("an old home's folder is left open to every user", "src/db.ts", [
        ("  if (fresh || existsSync(file) || readdirSync(dataDir).length === 0) chmodSync(dataDir, 0o700);\n", ""),
    ], ["privacy.test.ts"]),
    ("the database is created with the umask's mode", "src/db.ts", [
        ('  closeSync(openSync(file, "a", 0o600));\n', ""),
    ], ["privacy.test.ts"]),
    ("an old home's database keeps its loose mode", "src/db.ts", [
        ("  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);\n", ""),
    ], ["privacy.test.ts"]),
    # Continue with ChatGPT (PLAN 1.10)
    ("the sign-in's state is not checked", "src/chatgpt/chatgpt.ts", [
        ('      if (q.get("state") !== state) {', "      if (false) {"),
    ], ["chatgpt.test.ts"]),
    ("the ID token's signature is not checked", "src/chatgpt/oauth.ts", [
        ("  if (!signed) throw", "  if (false) throw"),
    ], ["chatgpt.test.ts"]),
    ("the ID token's issuer is not checked", "src/chatgpt/oauth.ts", [
        ("  if (claims.iss !== o.issuer) throw", "  if (false) throw"),
    ], ["chatgpt.test.ts"]),
    ("the ID token's audience is not checked", "src/chatgpt/oauth.ts", [
        ("  if (!aud.includes(o.audience)) throw", "  if (false) throw"),
    ], ["chatgpt.test.ts"]),
    ("the ID token's nonce is not checked", "src/chatgpt/oauth.ts", [
        ("  if (claims.nonce !== o.nonce) throw", "  if (false) throw"),
    ], ["chatgpt.test.ts"]),
    ("an expired ID token is accepted", "src/chatgpt/oauth.ts", [
        ('  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw', "  if (false) throw"),
    ], ["chatgpt.test.ts"]),
    ("the PKCE verifier is not sent", "src/chatgpt/oauth.ts", [
        ("    code_verifier: p.verifier,", '    code_verifier: "",'),
    ], ["chatgpt.test.ts"]),
    ("a token is written into the event log", "src/chatgpt/chatgpt.ts", [
        ('this.#o.events.append("chatgpt.connected", { email: who.email, sharing, model: this.#reg.model });',
         'this.#o.events.append("chatgpt.connected", { email: who.email, sharing, model: this.#reg.model, token: t.accessToken });'),
    ], ["chatgpt.test.ts"]),
    ("a usage limit is not passed to the next brain", "src/agent/loop.ts", [
        ("      if (r.limited && ep.plan) {", "      if (false) {"),
    ], ["chatgpt.test.ts"]),
    ("every reply wears the plan's badge", "src/agent/loop.ts", [
        ("      const meta = { ...(ep.plan && { plan: ep.plan }),", '      const meta = { plan: "chatgpt",'),
    ], ["chatgpt.test.ts"]),
    ("a usage limit says nothing of Manage usage", "src/agent/loop.ts", [
        ('{ limit: why, action: { label: "Manage usage", url: MANAGE_USAGE } }', "{ limit: why }"),
    ], ["chatgpt.test.ts"]),
    ("a usage limit does not pause the plan", "src/chatgpt/chatgpt.ts", [
        ("      this.#paused = { until: this.#o.clock.now() + this.#o.pauseMs, why };\n", "      this.#paused = { until: 0, why };\n"),
    ], ["chatgpt.test.ts"]),
    ("a token is used until the moment it lapses", "src/chatgpt/chatgpt.ts", [
        ("    if (t.expiresAt - 60_000 > this.#o.clock.now()) return t.accessToken;", "    if (t.expiresAt > this.#o.clock.now()) return t.accessToken;"),
    ], ["chatgpt.test.ts"]),
    ("a reply without response.completed counts", "src/agent/responses.ts", [
        ('    if (!completed) return fail("the reply ended before it completed", null);\n', ""),
    ], ["chatgpt.test.ts"]),
    ("the keychain is handed the secret on its command line", "src/chatgpt/store.ts", [
        ('const r = await run(this.#tool, ["store", `--label=Orbs: ChatGPT sign-in`, "service", SERVICE, "key", key], value);',
         'const r = await run(this.#tool, ["store", `--label=Orbs: ChatGPT sign-in`, "service", SERVICE, "key", key, value], value);'),
    ], ["chatgpt.test.ts"]),
    # the brain order (PLAN 1.11)
    ("Gemini is asked before ChatGPT", "src/brain/brains.ts", [
        ('      { id: "chatgpt", label: "ChatGPT", endpoint: o.chatgpt, setup: "sign in with ChatGPT (/chatgpt)" },\n      { id: "gemini", label: "Gemini", endpoint: () => this.#gemini(), setup: "add a Gemini API key in Settings" },\n',
         '      { id: "gemini", label: "Gemini", endpoint: () => this.#gemini(), setup: "add a Gemini API key in Settings" },\n      { id: "chatgpt", label: "ChatGPT", endpoint: o.chatgpt, setup: "sign in with ChatGPT (/chatgpt)" },\n'),
    ], ["brains.test.ts"]),
    ("a brain at its limit does not step aside", "src/agent/loop.ts", [
        ("      if (r.error && ep.chain && !r.text && !r.toolCalls.length && this.#o.chain) {", "      if (false) {"),
    ], ["brains.test.ts"]),
    ("no second pass: one refusal is the error", "src/agent/loop.ts", [
        ("        if (++passes < 3) {", "        if (++passes < 1) {"),
    ], ["brains.test.ts", "stop.test.ts"]),
    ("a brain that rested is never first again", "src/brain/chain.ts", [
        ("      if (r && r.until > now) continue;", "      if (r) continue;"),
    ], ["brains.test.ts", "chain.test.ts"]),
    ("a refused Gemini key is kept", "src/brain/brains.ts", [
        ('    if (res.status === 400 || res.status === 401 || res.status === 403) throw new KeyRefusedError("Gemini refused that key.");\n', ""),
    ], ["brains.test.ts"]),
    ("the Gemini key is written into brains.json", "src/brain/brains.ts", [
        ("    this.#saved = { ...this.#saved, gemini: { model } };", "    this.#saved = { ...this.#saved, gemini: { model, key: k } as { model: string } };"),
    ], ["brains.test.ts"]),
    ("the error says nothing of how to set a brain up", "src/brain/chain.ts", [
        ('    if (s.state === "absent") return `${cap(s.label)}: not set up (${s.setup})`;', '    if (s.state === "absent") return `${cap(s.label)}: not set up`;'),
    ], ["brains.test.ts", "chain.test.ts"]),
    # each orb's own constitution (PLAN 3.9)
    ("morals leak into every orb's constitution", "src/brain/constitution.ts", [
        ('  refusal_handling: morals("what to help with and what to refuse; Orbs\' floor is code (rule 9)"),', "  refusal_handling: core,"),
    ], ["constitution.test.ts"]),
    ("a heading in a fenced example counts as a section", "src/brain/constitution.ts", [
        ("    if (/^\\s*(```|~~~)/.test(line)) fence = !fence;\n", ""),
    ], ["constitution.test.ts"]),
    ("a section the map has not placed is dropped", "src/brain/constitution.ts", [
        ("  if (!p) return true;", "  if (!p) return false;"),
    ], ["constitution.test.ts"]),
    ("one learned file for every orb", "src/brain/learned.ts", [
        ('    return join(this.#dir, orb, "learned.md");', '    return join(this.#dir, "learned.md");'),
    ], ["constitution.test.ts"]),
    ("the owner's agent's name stays in the orb's", "src/brain/constitution.ts", [
        ("  const agent = ownersAgent(o.owner);", "  const agent = null as string | null;"),
    ], ["constitution.test.ts"]),
    ("the orb's specialty is ignored", "src/agent/standing.ts", [
        ('specialty: o.specialty ?? "general", orbName', 'specialty: "general", orbName'),
    ], ["constitution.test.ts"]),
    # the app's way in (PLAN 2.4)
    ("a pairing link works twice", "src/sessions.ts", [
        ("    this.#codes.delete(h); // good once, right or wrong\n", ""),
    ], ["app-door.test.ts"]),
    ("a change through a session needs no header of the app's", "src/api.ts", [
        ('  if (bySession && method !== "GET" && req.headers["x-orbs"] !== "1") throw', '  if (false) throw'),
    ], ["app-door.test.ts"]),
    ("the door serves files outside the app", "src/api.ts", [
        ('  if (!file.startsWith(dir.endsWith(sep) ? dir : dir + sep) || rel.startsWith("..")) throw new HttpError(404, "not part of the app");\n', ""),
    ], ["app-door.test.ts"]),
    ("letting an orb go leaves him in the office", "src/inbox.ts", [
        ('      this.#db.prepare("UPDATE orbs SET let_go_at = ? WHERE id = ?").run(this.#clock.now(), id);\n', ""),
    ], ["app-door.test.ts"]),
    ("an orb let go still takes work", "src/inbox.ts", [
        ("    if (who.letGoAt !== null) throw new Error(", "    if (false) throw new Error("),
    ], ["app-door.test.ts"]),
    # sessions (PLAN 2.9)
    ("a session's orbs all speak at once", "src/team.ts", [
        ('    this.#inbox.enqueue(left[0]!, conversation, "turn", "", { data: { team } });', '    for (const o of left.splice(0)) this.#inbox.enqueue(o, conversation, "turn", "", { data: { team } });'),
    ], ["team.test.ts"]),
    ("another orb's words reach him as his own", "src/agent/conversation.ts", [
        ("      if (o.me && m.orb !== o.me && (m.role === \"assistant\" || m.role === \"tool\")) {", "      if (false) {"),
    ], ["team.test.ts"]),
    ("a round goes on while an orb waits on a card", "src/team.ts", [
        ('      if (e.data.outcome === "waiting") return;\n', ""),
    ], ["team.test.ts"]),
    ("an orb never answers another orb", "src/agent/loop.ts", [
        ('    const answered = tail?.role === "assistant" && tail.orb === ctx.orb && !tail.toolCalls?.length', '    const answered = tail?.role === "assistant" && !tail.toolCalls?.length'),
    ], ["team.test.ts"]),
    ("agree records nothing", "src/agent/tools.ts", [
        ("      ctx.note?.(`✓ Agreed: ${d}`, { agreed: d });\n", ""),
    ], ["team.test.ts"]),
    ("a session's turn runs as if no one were there (your rules ignored)", "src/agent/loop.ts", [
        ('    const attended = ctx.items.some((i) => i.source === "chat" || i.source === "turn" || typeof i.data.resume === "number");', '    const attended = ctx.items.some((i) => i.source === "chat" || typeof i.data.resume === "number");'),
    ], ["team.test.ts"]),
    ("his computer reads a file outside his workspace", "src/workspace.ts", [
        ("  const p = inWorkspace(workspaceOf(dataDir, orb), path);\n  if (!p) throw new OutsideError(path);", "  const p = join(workspaceOf(dataDir, orb), path);"),
    ], ["workspace.test.ts"]),
    ("his computer lists a link that leads out", "src/workspace.ts", [
        ("    const p = inWorkspace(root, rel);\n    if (!p) continue; // a link that leads out of it is not shown", "    const p = join(at, name);"),
    ], ["workspace.test.ts"]),
    ("a big file is sent whole", "src/workspace.ts", [
        ("  const n = Math.min(s.size, READ_CAP);", "  const n = s.size;"),
    ], ["workspace.test.ts"]),
    ("a bill comes up every hour", "src/notices.ts", [
        ("      this.#add(`reminder:${r.id}`, {", "      this.#add(`reminder:${r.id}:${now}`, {"),
    ], ["notices.test.ts"]),
    ("a bill comes up on its day, not ahead", "src/notices.ts", [
        ("  const at = new Date(y, mo - 1, d - aheadDays, h, mi);", "  const at = new Date(y, mo - 1, d, h, mi);"),
    ], ["notices.test.ts"]),
    ("an answered card's notice stays out", "src/notices.ts", [
        ('      this.#settle("card = ?", Number(e.data.card));\n', ""),
    ], ["notices.test.ts"]),
    ("finished work piles up", "src/notices.ts", [
        ("      this.#settle(\"kind = 'done' AND conversation = ?\", e.conversation);\n", ""),
    ], ["notices.test.ts"]),
    ("putting a notice away is not told to the other devices", "src/notices.ts", [
        ('    if (!n.changes) throw new Error(`no notice ${id} out`);\n    this.#events.append("notice.put_away", { notices: [id] });', '    if (!n.changes) throw new Error(`no notice ${id} out`);'),
    ], ["notices.test.ts"]),
    ("the remind tool keeps nothing", "src/agent/tools.ts", [
        ("        const r = ctx.remind({ kind,", "        const r = { id: 0, comesUpAt: 0 } ?? ctx.remind({ kind,"),
    ], ["notices.test.ts"]),
    ("an orb moves what is on your calendar silently", "src/agent/tools.ts", [
        ('    floor: () => [{ category: "calendar", why: FLOOR_WORDS.calendar }],\n', ""),
    ], ["calendar.test.ts"]),
    ("a schedule's new time swaps its hour and minute", "src/schedule.ts", [
        ("    const cron = [String(minute), String(hour), ...f.slice(2)].join(\" \");", "    const cron = [String(hour), String(minute), ...f.slice(2)].join(\" \");"),
    ], ["calendar.test.ts"]),
    ("the calendar leaves the schedules out", "src/calendar.ts", [
        ("  for (const s of o.schedules.list()) {", "  for (const s of o.schedules.list().filter(() => false)) {"),
    ], ["calendar.test.ts"]),
    ("a paused schedule leaves the calendar", "src/calendar.ts", [
        ("  for (const s of o.schedules.list()) {", "  for (const s of o.schedules.list().filter((x) => x.enabled)) {"),
    ], ["calendar.test.ts"]),
    ("the lab forgets what was agreed", "src/lab.ts", [
        ('      agreed: said.filter((m) => m.role === "notice" && typeof m.meta.agreed === "string").map((m) => String(m.meta.agreed)),', "      agreed: [] as string[],"),
    ], ["lab.test.ts"]),
    ("a plan in the lab shows its frozen boxes, not the board's", "src/lab.ts", [
        ("box: live.get(id) ?? r.box };", "box: r.box };"),
    ], ["lab.test.ts"]),
    ("the lab's search misses a plan's rows", "src/lab.ts", [
        ("    plans: plans.filter((p) => has(p.title, ...p.rows.flatMap((r) => [r.feature, r.description]))).sort(", "    plans: plans.filter((p) => has(p.title)).sort("),
    ], ["lab.test.ts"]),
    ("a reopened brainstorm forgets what was agreed", "src/lab.ts", [
        ('  o.conversations.add({ conversation, orb, role: "summary", content: lines.join("\\n\\n") });\n', ""),
    ], ["lab.test.ts"]),
    ("what one orb agreed stays his", "src/agent/conversation.ts", [
        ('      else if (m.role === "notice" && o.me && m.orb !== o.me && typeof m.meta.agreed === "string") out.push({ role: "user", content: `[Agreed]: ${m.meta.agreed}` });\n', ""),
    ], ["lab.test.ts"]),
    ("a one-off task qualifies for a habit", "src/gym/finder.ts", [
        ("export const MIN_APPROVED = 3;", "export const MIN_APPROVED = 1;"),
    ], ["finder.test.ts"]),
    ("a corrected run counts as approved", "src/gym/finder.ts", [
        ("approved: verdict.get(run) === \"approve\",", "approved: verdict.has(run),"),
    ], ["finder.test.ts"]),
    ("another data shape counts as the same task", "src/gym/finder.ts", [
        ('  const shape = `${tools.join(">") || "(no tools)"}${t.fields.length ? ` {${t.fields.join(",")}}` : ""}`;', '  const shape = `${tools.join(">") || "(no tools)"}`;'),
    ], ["finder.test.ts"]),
    ("approving a job twice pays twice", "src/gym/xp.ts", [
        ('        if (e.data.verdict === "approve" && earlier?.data.verdict !== "approve") {', '        if (e.data.verdict === "approve") {'),
    ], ["xp.test.ts"]),
    ("the daily cap is not kept", "src/gym/xp.ts", [
        ("      const granted = Math.min(amount, room);", "      const granted = amount + room * 0;"),
    ], ["xp.test.ts"]),
    ("an undo takes nothing back", "src/gym/xp.ts", [
        ('        this.#takeBack([Number(e.data.source)], `undone: ${String(e.data.what ?? "it")}`, e);\n', ""),
    ], ["xp.test.ts"]),
    ("a restart pays for the same evidence again", "src/gym/xp.ts", [
        ('    const done = Math.max(0, ...ledger(events).map((e) => e.source), ...events.ofType("xp.considered").map((e) => Number(e.data.source)));', "    const done = 0;"),
    ], ["xp.test.ts"]),
    ("the radar counts XP taken back as earned", "src/gym/specialty.ts", [
        ("    if (area) radar[area].xp += x.amount;", "    if (area) radar[area].xp += Math.abs(x.amount);"),
    ], ["specialty.test.ts"]),
    ("a niche is measured against an average its own runs make", "src/gym/specialty.ts", [
        ("    const elsewhere = rest.length ? count(rest, w) / rest.length : 0;", "    const elsewhere = count(approved, w) / approved.length;"),
    ], ["specialty.test.ts"]),
    ("an orb learns a lesson without your yes", "src/agent/tools.ts", [
        ('    decision: "ask",\n    floor: () => [{ category: "lessons", why: FLOOR_WORDS.lessons }],', '    decision: "allow",'),
    ], ["lessons.test.ts"]),
    ("a lesson that must never be learned reaches you", "src/agent/tools.ts", [
        ('      const v = ctx.lessonGate ? await ctx.lessonGate(s(a.line)) : { ok: true, reason: "" };', '      const v = { ok: true, reason: "" };'),
    ], ["lessons.test.ts"]),
    ("the morning card counts a failed run as an answer", "src/gym/card.ts", [
        ('} else if (e.type === "run.finished" && e.data.outcome === "ok" && !byHabit.has(Number(e.data.run))) night(e.orb).big++;', '} else if (e.type === "run.finished" && !byHabit.has(Number(e.data.run))) night(e.orb).big++;'),
    ], ["card.test.ts"]),
    ("a quiet night still makes a card", "src/gym/card.ts", [
        ("  return orbs.length ? { day, orbs } : null;", "  return { day, orbs };"),
    ], ["card.test.ts"]),
    ("the morning card counts a habit's run as the big brain's too", "src/gym/card.ts", [
        (" && !byHabit.has(Number(e.data.run))) night(e.orb).big++;", ") night(e.orb).big++;"),
    ], ["habit-runs.test.ts"]),
    # habits (PLAN 3.2, 3.3)
    ("a run of two mails is one case", "src/gym/cases.ts", [
        ("  if (!first || items.length > 1) return null;", "  if (!first) return null;"),
    ], ["cases.test.ts"]),
    ("the brief carries every run, whole", "src/gym/compile.ts", [
        ("  const shown = cases.slice(-BRIEF_RUNS).map(", "  const shown = cases.slice(-BRIEF_RUNS * 100).map("),
    ], ["compile.test.ts"]),
    ("a habit is promoted on the teacher's word", "src/gym/compile.ts", [
        ("    if (!r.ok) return done(false, `run ${k.run}: ${r.why}`);\n", ""),
    ], ["compile.test.ts"]),
    ("a rejected habit is kept anyway", "src/gym/compile.ts", [
        ("  for (const k of o.cases) {\n    const r = await replay(step, k);", "  await o.kit(\"habit_learn_steps\", { habit_dir: dir, code, inputs: o.cases.map((k) => k.input), version });\n  for (const k of o.cases) {\n    const r = await replay(step, k);"),
    ], ["compile.test.ts"]),
    ("the home runs a habit on an input it was never proved on", "src/home.ts", [
        ('{ habit_dir: h.dir, input, done }', '{ habit_dir: h.dir, input, done, check_input: false }'),
    ], ["compile.test.ts"]),
    ("a rolled-back habit still answers", "src/gym/steps.ts", [
        ("    if (back.has(`${orb}|${key}|${version}`)) continue;\n", ""),
    ], ["habit-runs.test.ts"]),
    ("a habit answers a chat too", "src/agent/loop.ts", [
        ("      if (!ctx.fresh) return null; // only what a schedule or a trigger asked: a chat is the brain's\n", ""),
    ], ["habit-runs.test.ts"]),
    ("a habit's call skips the guard and the floor", "src/agent/loop.ts", [
        ("      const r = await this.#calls(msg, 0, ctx, tctx, step, at);\n      if (r !== \"done\") return this.#ended(r, ctx);\n    }\n    return null;",
         "      this.#result(msg, call, await runTool(this.#tools.get(call.name)!, next.call.args, tctx), ctx);\n      const r = \"done\" as \"done\" | \"waiting\" | \"stopped\";\n      if (r !== \"done\") return this.#ended(r, ctx);\n    }\n    return null;"),
    ], ["habit-runs.test.ts"]),
    ("a habit goes on past your no", "src/agent/loop.ts", [
        (" || r.content === DENIED || r.content === EXPIRED) return", ") return"),
    ], ["habit-runs.test.ts"]),
    ("a habit's refusal is not kept for tonight", "src/agent/loop.ts", [
        ('    this.#o.events.append("habit.fell", { kind: h.key, task: h.task, version: h.version, run: ctx.run, why }, { orb: ctx.orb, conversation: ctx.conversation });\n', ""),
    ], ["habit-runs.test.ts"]),
    ("the night writes a habit for a chat", "src/gym/night.ts", [
        ('      if (!c.trigger.startsWith("schedule:") && !c.trigger.startsWith("trigger:")) continue;\n', ""),
    ], ["night.test.ts"]),
    ("the night asks the teacher again with nothing new", "src/gym/night.ts", [
        ("        if (c.runs.every((r) => tried.has(r) || answered.has(r))) return null;\n", ""),
    ], ["night.test.ts"]),
    ("a habit that works is written again every night", "src/gym/night.ts", [
        ("        if (c.runs.every((r) => tried.has(r) || answered.has(r))) return null;", "        if (c.runs.every((r) => tried.has(r))) return null;"),
    ], ["night.test.ts"]),
    ("the own brain sits again for runs it answered itself", "src/gym/night.ts", [
        ("    if (all.length && runs.every((r) => sat.has(r) || answered.has(r))) return null;", "    if (all.length && runs.every((r) => sat.has(r))) return null;"),
    ], ["playbook.test.ts"]),
    ("a recompile overwrites the version before", "src/gym/night.ts", [
        ("    return version + 1;\n  }\n\n  /** The runs a habit", "    return 1;\n  }\n\n  /** The runs a habit"),
    ], ["night.test.ts"]),
    ("the teacher's cost is spent on no one", "src/gym/night.ts", [
        ("            this.#o.spend?.record(", "            void this.#o.spend; void ("),
    ], ["night.test.ts"]),
    ("the night runs every tick", "src/gym/night.ts", [
        ("    if (last) return Number(last.data.night) + DAY_MS;", "    if (last) return Number(last.data.night);"),
    ], ["night.test.ts"]),
    ("a new home's first night never comes", "src/gym/night.ts", [
        ("    return nightOf(began) + DAY_MS;", "    return nightOf(this.#o.clock.now() + began * 0) + DAY_MS;"),
    ], ["night.test.ts"]),
    ("closing the home does not wait for the night", "src/home.ts", [
        ("    await this.gym.close();\n", ""),
    ], ["night.test.ts"]),
    ("a teacher cut short by closing is a rejection", "src/gym/compile.ts", [
        ("    if (o.signal?.aborted) throw e;\n", ""),
    ], ["night.test.ts"]),
    ("a kit still starting at close writes to a closed log", "src/home.ts", [
        ("      if (!this.#closed) this.events.append(\"kit.start_failed\"", "      this.events.append(\"kit.start_failed\""),
    ], ["night.test.ts"]),
    ("a habit you took back still answers", "src/gym/steps.ts", [
        ('[...events.ofType("habit.rolled_back"), ...events.ofType("habit.undone")]', '[...events.ofType("habit.rolled_back")]'),
    ], ["undo.test.ts"]),
    ("an undo takes no XP back", "src/home.ts", [
        ("      this.events.append(\"undo\", { source: promoted.seq, what: `the habit ${u.habit} v${u.version}` }, { orb: u.orb });\n", ""),
    ], ["undo.test.ts"]),
    ("an undo costs a rollback's XP too", "src/home.ts", [
        ('      this.events.append("habit.undone", { kind: u.habit, version: u.version }, { orb: u.orb });', '      this.events.append("habit.undone", { kind: u.habit, version: u.version }, { orb: u.orb });\n      this.events.append("habit.rolled_back", { kind: u.habit, version: u.version }, { orb: u.orb });'),
    ], ["undo.test.ts"]),
    ("a lesson undone stays learned", "src/home.ts", [
        ("    this.learned.remove(u.orb, u.index);\n", ""),
    ], ["undo.test.ts"]),
    ("the card offers a habit you took back", "src/gym/card.ts", [
        ("      if (!undone.has(`${e.orb}|${String(e.data.kind)}|${version}`)) n.undo.push(", "      n.undo.push("),
    ], ["card.test.ts"]),
    ("the night's promotions are left off its card", "src/gym/card.ts", [
        ('    if (e.type === "habit.promoted" && e.orb && e.at >= nightFrom && e.at < nightTo) {', '    if (e.type === "habit.promoted" && e.orb && e.at >= from + nightFrom * 0 && e.at < to + nightTo * 0) {'),
    ], ["card.test.ts"]),
    # the exam (PLAN 3.5), by Ash's run.mjs
    ("the exam is one coin flip a case", "src/gym/exam.ts", [
        ("  const k = o.k ?? K;", "  const k = 1 + (o.k ?? K) * 0;"),
    ], ["exam.test.ts"]),
    ("a rate limit counts as a failure", "src/gym/exam.ts", [
        ("continue; // no evidence either way", "{ n++; continue; } // no evidence either way"),
    ], ["exam.test.ts"]),
    ("another model's baseline is compared as if the same", "src/gym/exam.ts", [
        ("  if (base.brain && now.brain && base.brain !== now.brain) return", "  if (false) return"),
    ], ["exam.test.ts"]),
    ("a coin flip is compared with a rate", "src/gym/exam.ts", [
        ("  if ((base.k > 1) !== (now.k > 1)) return", "  if (false) return"),
    ], ["exam.test.ts"]),
    ("a sitting cut short is judged", "src/gym/exam.ts", [
        ("  if (now.missing.length) return", "  if (false) return"),
    ], ["exam.test.ts"]),
    ("the whole sitting's fall is not a regression", "src/gym/exam.ts", [
        ("  const fell = base.suite !== null", "  const fell = false && base.suite !== null"),
    ], ["exam.test.ts"]),
    ("one sample a case clears the bar", "src/gym/exam.ts", [
        ("  if (!s || s.missing.length || s.k < 2 || s.suite === null) return false;", "  if (!s || s.missing.length || s.suite === null) return false;"),
    ], ["exam.test.ts"]),
    ("a brain's exam reads its claim, not its calls", "src/gym/cases.ts", [
        ("      if (i < c.steps.length) return { ok: false, why: `it answered after", "      if (i < c.steps.length && o.answer !== \"said\") return { ok: false, why: `it answered after"),
    ], ["exam.test.ts"]),
    # the own brain's playbook (PLAN 3.4)
    ("the own brain's exam includes the answers it was shown", "src/gym/night.ts", [
        ("cases: cases.slice(0, -EXAMPLES), k:", "cases, k:"),
    ], ["playbook.test.ts"]),
    ("a task moves to the own brain under the bar", "src/gym/steps.ts", [
        ("  if (!last || last.data.earned !== true) return null;", "  if (!last) return null;"),
    ], ["playbook.test.ts"]),
    ("a refused playbook replaces the one before", "src/gym/night.ts", [
        ('    const accepted = v.verdict === "pass" || v.verdict === "incomparable";', "    const accepted = v.verdict !== null;"),
    ], ["playbook.test.ts"]),
    ("the own brain sits again with nothing new", "src/gym/night.ts", [
        ("    if (all.length && runs.every((r) => sat.has(r) || answered.has(r))) return null;", "    if (false) return null;"),
    ], ["playbook.test.ts"]),
    ("the playbook kept is not the one sat", "src/gym/night.ts", [
        ("...(accepted && { system: x.pb.system })", '...(accepted && { system: "" })'),
    ], ["playbook.test.ts"]),
    ("his own brain answers a chat too", "src/agent/loop.ts", [
        ("    if (!ctx.fresh) return null;\n    const asks = seen.filter((i) => i.source !== \"system\");\n    return asks.length", "    const asks = seen.filter((i) => i.source !== \"system\");\n    return asks.length"),
    ], ["playbook.test.ts"]),
    ("his own brain's failure ends the run", "src/agent/loop.ts", [
        ("      if (r.error && own && !r.text && !r.toolCalls.length) {", "      if (r.error && own && !r.text && !r.toolCalls.length && false) {"),
    ], ["playbook.test.ts"]),
    ("his own brain answers without its playbook", "src/agent/loop.ts", [
        ("content: own ? `${standing}\\n\\n${own.system}` : standing }", "content: standing }"),
    ], ["playbook.test.ts"]),
    ("his own brain's cost is billed as the big brain's", "src/agent/loop.ts", [
        ('          tier: own ? "own" : "big", model: ep.model,', '          tier: "big", model: ep.model,'),
    ], ["playbook.test.ts"]),
    ("the morning card counts his own brain's run as the big brain's too", "src/gym/card.ts", [
        ('(e.data.tier === "habit" || e.data.tier === "own") && typeof e.data.run', 'e.data.tier === "habit" && typeof e.data.run'),
    ], ["playbook.test.ts"]),
    # what rank widens (PLAN 3.8, rules/rank.ts)
    ("rank widens a command that is not a reader", "src/rules/rank.ts", [
        ("  if (!READERS.has(program!)) return false;\n", ""),
    ], ["rank.test.ts"]),
    ("a reader's run-something flag passes as reading", "src/rules/rank.ts", [
        ("rest.every((t) => !RUNS_SOMETHING.test(t) && ", "rest.every((t) => "),
    ], ["rank.test.ts"]),
    ("a path out of the workspace passes as reading", "src/rules/rank.ts", [
        ('!t.startsWith("/") && !t.startsWith("~") && ', ""),
    ], ["rank.test.ts"]),
    ("shell syntax passes as reading", "src/rules/rank.ts", [
        ("  if (!c || SYNTAX.test(c)) return false;", "  if (!c) return false;"),
    ], ["rank.test.ts"]),
    ("rank widens below Senior", "src/rules/rank.ts", [
        ("  if (LEVELS.indexOf(o.level) < LEVELS.indexOf(WIDENS_AT) || o.family", "  if (o.family"),
    ], ["rank.test.ts"]),
    ("rank widens outside a Build specialty", "src/rules/rank.ts", [
        (' || o.family !== "build" || o.background', " || o.background"),
    ], ["rank.test.ts"]),
    ("rank overrides your own rule", "src/rules/policy.ts", [
        ('  if (f.rule.decision === null && d === "ask" && f.rank) {', '  if (d === "ask" && f.rank) {'),
    ], ["rank.test.ts"]),
    ("rank lowers the floor", "src/rules/policy.ts", [
        ("  for (const h of f.floor) {", "  for (const h of f.rank ? [] : f.floor) {"),
    ], ["rank.test.ts"]),
    ("rank waives being away", "src/rules/policy.ts", [
        ('  if (f.mode === "away" && f.outward) {', '  if (f.mode === "away" && f.outward && !f.rank) {'),
    ], ["rank.test.ts"]),
    ("no orb's rank reaches the guard", "src/home.ts", [
        ("        return o ? { level: levelOf(this.events, orb), family: SPECIALTY_FAMILIES[o.specialty] } : null;", "        return o && null;"),
    ], ["rank.test.ts"]),
    # levels and promotions (PLAN 3.8)
    ("XP alone earns a promotion", "src/gym/levels.ts", [
        ("  if (tasks.length < need.tasks) missing.push(", "  if (false) missing.push("),
    ], ["levels.test.ts"]),
    ("a regression is forgotten at once", "src/gym/levels.ts", [
        ("    .filter((e) => e.orb === orb && e.at >= since)", "    .filter((e) => e.orb === orb && e.at >= o.now + since * 0)"),
    ], ["levels.test.ts"]),
    ("work outside its specialty counts toward it", "src/gym/levels.ts", [
        ("    .filter(([, runs]) => !areas || areaOf(events, runs).some((a) => areas.includes(a)))", "    .filter(([, runs]) => !areas || runs.length >= 0)"),
    ], ["levels.test.ts"]),
    ("a habit you took back still counts toward a level", "src/gym/levels.ts", [
        ('  const gone = new Set([...events.ofType("habit.rolled_back"), ...events.ofType("habit.undone")].map(', '  const gone = new Set([...events.ofType("habit.rolled_back")].map('),
    ], ["levels.test.ts"]),
    ("the night promotes on its own", "src/gym/night.ts", [
        ('      events.append("promotion.proposed", { from: p.from, to: p.to, evidence: p.evidence }, { orb: o.id });', '      events.append("promotion.proposed", { from: p.from, to: p.to, evidence: p.evidence }, { orb: o.id });\n      events.append("orb.promoted", { from: p.from, to: p.to }, { orb: o.id });'),
    ], ["levels.test.ts"]),
    ("a promotion is proposed every night", "src/gym/night.ts", [
        ("      if (events.ofType(\"promotion.proposed\", settled).some((e) => e.orb === o.id && e.data.to === p.to)) continue;\n", ""),
    ], ["levels.test.ts"]),
    ("you can promote past the evidence", "src/home.ts", [
        ('    if (!p.ready) throw new Error(`not yet: ${p.missing.join("; ")}`);\n', ""),
    ], ["levels.test.ts"]),
    ("you can skip a level", "src/home.ts", [
        ("    if (!p || p.to !== to) throw new Error(", "    if (!p) throw new Error("),
    ], ["levels.test.ts"]),
    ("a promotion's notice stays after your answer", "src/notices.ts", [
        ('    } else if ((e.type === "orb.promoted" || e.type === "promotion.declined") && e.orb) {\n      this.#settle("kind = \'promotion\' AND orb = ?", e.orb);', '    } else if (e.type === "never.happens" && e.orb) {\n      this.#settle("kind = \'promotion\' AND orb = ?", e.orb);'),
    ], ["levels.test.ts"]),
    ("the loop lets a promoted orb skip a card", "src/agent/loop.ts", [
        ('        } else if (def.pause || v!.decision === "ask") {', '        } else if (def.pause || (v!.decision === "ask" && levelOf(this.#o.events, ctx.orb) === "Junior")) {'),
        ('import { taskOf } from "../gym/finder.ts";', 'import { taskOf } from "../gym/finder.ts";\nimport { levelOf } from "../gym/levels.ts";'),
    ], ["levels.test.ts"]),
    ("a held exam pays every night", "src/gym/xp.ts", [
        ("        if (e.data.earned === true && !held) this.#give(", "        if (e.data.earned === true) this.#give("),
    ], ["xp.test.ts"]),
    ("an exam that no longer holds keeps its XP", "src/gym/xp.ts", [
        ("        else if (e.data.earned !== true && held) {", "        else if (e.data.earned !== true && held && false) {"),
    ], ["xp.test.ts"]),
    ("a refused sitting moves XP", "src/gym/xp.ts", [
        ("        if (!e.orb || e.data.accepted !== true) return;", "        if (!e.orb) return;"),
    ], ["xp.test.ts"]),
    # plan templates (PLAN 3.2)
    ("a template is kept without the gate's yes", "src/gym/templates.ts", [
        ("    if (why.length) refused.push({ shape, why });", "    if (why.length < 0) refused.push({ shape, why });"),
    ], ["templates.test.ts"]),
    ("two approved plans make a template", "src/gym/templates.ts", [
        ("    if (ps.length < MIN_APPROVED) continue;", "    if (ps.length < MIN_APPROVED - 1) continue;"),
    ], ["templates.test.ts"]),
    ("a declined plan counts toward a template", "src/gym/templates.ts", [
        ('    if (p.orb !== orb || p.status !== "approved") continue;', '    if (p.orb !== orb || p.status === "submitted") continue;'),
    ], ["templates.test.ts"]),
    ("a template keeps the old plan's ticks", "src/gym/templates.ts", [
        ('    const body = newest.body.replace(/\\[(x|~)\\]/gi, "[ ]");', "    const body = newest.body;"),
    ], ["templates.test.ts"]),
    ("the night keeps a template again every night", "src/gym/templates.ts", [
        ("    if (known.has(`${t.shape}|${t.plans.join(\",\")}`)) continue;\n", ""),
    ], ["templates.test.ts"]),
    ("one orb's templates are another's", "src/gym/templates.ts", [
        ("    if (e.orb !== orb) continue;\n    byShape.set(", "    byShape.set("),
    ], ["templates.test.ts"]),
    ("a habit's refusal still answers", "src/agent/loop.ts", [
        ('      if ("refused" in next) return this.#fell(ctx, s.h, next.refused, step);\n', '      if ("refused" in next) { this.#fell(ctx, s.h, next.refused, step); return { outcome: "ok", summary: "" }; }\n'),
    ], ["habit-runs.test.ts"]),
    # the researchers' tools (PLAN 3.10)
    ("the web tools may reach loopback", "src/agent/net.ts", [
        ("    a === 0 || a === 10 || a === 127 ||", "    a === 0 || a === 10 ||"),
    ], ["web.test.ts"]),
    ("an IPv4-mapped address in hex slips through", "src/agent/net.ts", [
        ("  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);\n", "  const hex = null as RegExpExecArray | null;\n"),
    ], ["web.test.ts"]),
    ("the connection's own lookup is not checked (DNS rebinding)", "src/agent/net.ts", [
        ("      const bad = list.find((a) => refused(a.address));\n      if (bad) return cb(", "      const bad = undefined as { address: string } | undefined;\n      if (bad) return cb("),
    ], ["web.test.ts"]),
    ("a long page is cut by score, not kept in its order", "src/agent/web.ts", [
        ("  return { text: scored.filter((s) => keep.has(s.i)).map((s) => s.p).join(\"\\n\\n\"), trimmed: true };", "  return { text: [...scored].sort((a, b) => b.score - a.score).filter((s) => keep.has(s.i)).map((s) => s.p).join(\"\\n\\n\"), trimmed: true };"),
    ], ["web.test.ts"]),
    ("a blocked domain the provider returned is passed on", "src/agent/web.ts", [
        ("  if (block.length) results = results.filter((r) => !block.some((d) => domainMatch(hostOf(String(r.url)), d)));\n", ""),
    ], ["web.test.ts"]),
    ("researchers lose their method", "src/brain/constitution.ts", [
        ("  if (RESEARCHERS.includes(o.specialty)) parts.push(RESEARCH_METHOD);\n", ""),
    ], ["web.test.ts"]),
]

# the app (PLAN 2.x): paths are inside packages/app
APP_MUTANTS: list[tuple[str, str, list[tuple[str, str]], list[str]]] = [
    ("a light-mode hue is too pale to read", "src/design/tokens.ts", [
        ("const LIGHT_TARGET = 4.8;", "const LIGHT_TARGET = 3.0;"),
    ], ["design.test.ts"]),
    ("the token lint is blind to named colours", "test/lint.ts", [
        ('[NAMED, "a named colour"], ', ""),
    ], ["design.test.ts"]),
    ("Ash loses his azure", "src/design/tokens.ts", [
        ("dark: i === 0 ? AZURE : oklch(a.L, a.C, angle)", "dark: oklch(a.L, a.C, angle + 4)"),
    ], ["design.test.ts"]),
    ("an orb's colour does not follow the light theme", "src/design/tokens.ts", [
        ("    hueRules(\"light\", ':root[data-theme=\"light\"] '),\n", ""),
        ("    `@media (prefers-color-scheme: light) { ${hueRules(\"light\", ':root:not([data-theme=\"dark\"]) ')} }`,\n", ""),
    ], ["render.test.ts"]),
    ("the smallest type falls under the floor", "src/design/tokens.ts", [
        ("  caption2: [11, 13, 400],", "  caption2: [9, 13, 400],"),
    ], ["design.test.ts", "render.test.ts"]),
    ("the harness does not see a spill", "test/harness.ts", [
        ("      if (!inScroller && (r.left < -1 || r.right > vw + 1)) out.push(", "      if (false) out.push("),
    ], ["render.test.ts"]),
    ("a mouth is drawn below his eyes", "src/orb/glsl.ts", [
        ("      body = mix(body, eyeC, eyeA*0.92*faceA);",
         "      body = mix(body, eyeC, eyeA*0.92*faceA);\n      body = mix(body, eyeC, smoothstep(0.03, 0.012, abs(length(f - vec2(0.0, 0.30)) - 0.12)) * step(0.34, f.y) * step(abs(f.x), 0.12) * faceA);"),
    ], ["characters.test.ts"]),
    ("a borrowed name slips into the list", "src/orb/spec.ts", [
        ('  "Oscar", "Luna",', '  "Oscar", "Alfred", "Luna",'),
    ], ["spec.test.ts"]),
    ("a voice keeps Kokoro's name for it", "src/orb/spec.ts", [
        ('af_bella: "Sunny",', 'af_bella: "Bella",'),
    ], ["spec.test.ts"]),
    ("the same dice make a different orb", "src/orb/spec.ts", [
        ("    name: orbName(r),", "    name: orbName(Math.random),"),
    ], ["spec.test.ts"]),
    ("a shape is too big for its box", "src/orb/spec.ts", [
        ("bumps: 7, bumpSize: 0.065, scale: 0.87 }),", "bumps: 7, bumpSize: 0.065, scale: 1.45 }),"),
    ], ["characters.test.ts"]),
    ("a hat floats off the top of his head", "src/orb/glsl.ts", [
        ("*(1.0 - 0.5*uSquash) - 0.03*Rg;", "*(1.0 - 0.5*uSquash) + 0.55*Rg;"),
    ], ["characters.test.ts"]),
    ("a created orb can still be edited", "src/orbs.tsx", [
        ("{making ? <Creator me={me} edit={edit}", "{true ? <Creator me={me} edit={edit}"),
    ], ["office.test.ts"]),
    ("deleting an orb does not ask", "src/orbs.tsx", [
        ('<button onClick={() => setAsking(true)} style={{ ...s.btn, justifySelf: "start"', '<button onClick={onDelete} style={{ ...s.btn, justifySelf: "start"'),
    ], ["office.test.ts"]),
    ("a name already in the office is allowed", "src/orbs.tsx", [
        ("taken(name) ? `Someone in the office", "false ? `Someone in the office"),
    ], ["office.test.ts"]),
    ("a grid leaves one item alone", "src/ui/balance.ts", [
        ("export function balanceColumns(n: number, max: number): number | null {\n  if (n <= max)", "export function balanceColumns(n: number, max: number): number | null {\n  if (n > max) return max;\n  if (n <= max)"),
    ], ["feel.units.test.ts", "office.test.ts"]),
    ("a press does not squish", "src/design/tokens.ts", [
        ("translate: 0 1px; scale: .94;", "translate: 0 1px; scale: 1;"),
    ], ["feel.test.ts"]),
    ("the click sounds on the release, not the press", "src/ui/feel.ts", [
        ('  doc.addEventListener("pointerdown", down, true);', '  doc.addEventListener("pointerup", down, true);'),
    ], ["feel.test.ts"]),
    ("quick presses do not climb", "src/ui/sound.ts", [
        ("    streak = t - last < 650 ? Math.min(streak + 1, 6) : 0;", "    streak = 0;"),
    ], ["feel.test.ts"]),
    ("the sound switch is ignored", "src/ui/sound.ts", [
        ("  if (!on) return;\n  const t = performance.now();", "  const t = performance.now();"),
    ], ["feel.test.ts"]),
    ("a click that pops", "src/ui/sound.ts", [
        ("dur: 0.065, gain, attack: 0.0015 }", "dur: 0.065, gain, attack: 0 }"),
    ], ["feel.units.test.ts", "feel.test.ts"]),
    ("he does not react to what you choose", "src/orbs.tsx", [
        ("    if (g && Object.keys(patch).length < 4", "    if (false && g && Object.keys(patch).length < 4"),
    ], ["feel.test.ts"]),
    ("glasses are not drawn", "src/orb/glsl.ts", [
        ("  if (uSpecs > 0.5) {", "  if (uSpecs > 99.0) {"),
    ], ["characters.test.ts"]),
    ("sunglasses are clear", "src/orb/glsl.ts", [
        ("    col = mix(col, uLensCol*0.85, lensA*uLensDark);", "    col = mix(col, uLensCol*0.85, lensA*0.0);"),
    ], ["characters.test.ts"]),
    ("a hat takes his glasses off", "src/orb/spec.ts", [
        ("    specs: g.id,", '    specs: c.hat === "none" ? g.id : 0,'),
    ], ["spec.test.ts"]),
    ("the accountant forgets the bills", "src/orb/spec.ts", [
        ('focus: "the books: bills and when they are due, budgets, receipts, taxes; he tells you before a bill is due"', 'focus: "the books: budgets, receipts, taxes"'),
    ], ["spec.test.ts"]),
    ("a dietitian stops saying what he is not", "src/orb/spec.ts", [
        (', limits: "Not a licensed dietitian: general guidance; a doctor for anything medical." }', " }"),
    ], ["spec.test.ts"]),
    ("the sheet hides what a role is not", "src/orbs.tsx", [
        ('      {"limits" in SPECIALTIES[c.specialty] && (', '      {false && "limits" in SPECIALTIES[c.specialty] && ('),
    ], ["office.test.ts"]),
    ("two finishes look alike", "src/orb/spec.ts", [
        ('  neon: { label: "Neon", sat: 1.7, val: 1.12, tint: 1, glow: 0.35 },', '  neon: { label: "Neon", sat: 1, val: 1 },'),
    ], ["characters.test.ts"]),
    ("two across, the odd one out is left alone", "src/ui/balance.ts", [
        ("  if (max === 2) return { cols: 2, spans: [...Array(n - 1).fill(1), 2] };", "  if (max === 2) return { cols: 2, spans: Array(n).fill(1) };"),
    ], ["feel.units.test.ts", "office.test.ts"]),
    ("the splash flashes by without its waking", "src/ui/Splash.tsx", [
        ("new Promise((r) => setTimeout(r, calm ? 300 : WAKE_MS))", "Promise.resolve()"),
    ], ["splash.test.ts"]),
    ("the splash does not wait for a slow home", "src/ui/Splash.tsx", [
        ("const waited = Promise.all([ready(), ", "const waited = Promise.all([Promise.resolve(), "),
    ], ["splash.test.ts"]),
    ("a home that cannot be reached is not said", "src/ui/Splash.tsx", [
        ("const waited = Promise.all([ready(), ", "const waited = Promise.all([ready().catch(() => undefined), "),
    ], ["splash.test.ts"]),
    ("?splash=0 is ignored", "src/ui/Splash.tsx", [
        ('    return new URLSearchParams(location.search).get("splash") !== "0";', "    return true;"),
    ], ["splash.test.ts"]),
    # the first open (PLAN 2.5), the side menu, the eyes
    ("the story goes on without a name", "src/onboarding/story.ts", [
        ('  if (!name) return { ok: false, why: "I need something to call you." };', "  if (false) return { ok: false, why: \"\" };"),
    ], ["onboarding.test.ts"]),
    ("the story forgets the name it was told", "src/onboarding/story.ts", [
        ('export const line = (text: string, p: Pick<Person, "name"> | null): string => text.replaceAll("{name}", p?.name ?? "boss");', 'export const line = (text: string, p: Pick<Person, "name"> | null): string => text.replaceAll("{name}", "boss");'),
    ], ["onboarding.test.ts"]),
    ("the story plays again at every open", "src/onboarding/story.ts", [
        ('    return v && typeof v.name === "string" && v.name ? v : null;', "    return v && false ? v : null;"),
    ], ["onboarding.test.ts", "nav.test.ts"]),
    ("skipping the story skips the name", "src/onboarding/story.ts", [
        ('  return person ? story.findIndex((b) => b.kind === "hire") : story.findIndex((b) => b.kind === "ask-name");', '  return story.findIndex((b) => b.kind === "hire");'),
    ], ["onboarding.test.ts"]),
    ("a press does not finish the line", "src/onboarding/Onboarding.tsx", [
        ("      if (typer.current) clearInterval(typer.current);\n", ""),
    ], ["onboarding.test.ts"]),
    ("the side menu's Back goes nowhere", "src/orbs.tsx", [
        ('    <button onClick={() => history.back()} disabled={depth === 0} aria-label="Back"', '    <button onClick={() => undefined} disabled={depth === 0} aria-label="Back"'),
    ], ["nav.test.ts"]),
    ("going somewhere is not an address", "src/orbs.tsx", [
        ('    history.pushState({ orbs: depth + 1 }, "", routeHash(r));\n', ""),
    ], ["nav.test.ts"]),
    ("the phone menu stays open after a choice", "src/orbs.tsx", [
        ("  const go = (r: Route): void => {\n    setMenu(false);\n", "  const go = (r: Route): void => {\n"),
    ], ["nav.test.ts"]),
    ("a wink is an eye style again", "src/orb/spec.ts", [
        ("  close: { a: [0.13, 1, 0.18, 0.08], b: [1, 0, 0, 0] },", "  close: { a: [0.13, 1, 0.18, 0.08], b: [1, 0, 0, 0] },\n  wink: { a: [0.138, 1, 0.26, 0.1], b: [1, 0, 0, 1] },"),
    ], ["spec.test.ts"]),
    ("the wink gesture shuts no eye", "src/orb/life.ts", [
        ("      if (x > 0.12 && x < 0.72) f.wink = 1;\n", ""),
    ], ["feel.units.test.ts"]),
    ("the app never finds its home", "src/home/link.ts", [
        ("  if (!res.ok || !(res.headers.get(\"content-type\") ?? \"\").includes(\"json\")) return null;\n  return { office: doorOffice(base) };", "  return null;"),
    ], ["link.test.ts"]),
    ("a spent pairing code stays on the address", "src/home/link.ts", [
        ('      if (location.hash.includes("pair=")) history.replaceState(null, "", "#/office"); // the code is spent: off the address\n', ""),
    ], ["link.test.ts"]),
    ("a reply never shows as it streams", "src/rooms/Talk.tsx", [
        ('        setLive((l) => ({ ...l, [d.orb]: (l[d.orb] ?? "") + d.delta }));', "        void d;"),
    ], ["link.test.ts", "sessions.test.ts"]),
    ("approving a card in a conversation does nothing", "src/rooms/Talk.tsx", [
        ("    o.home.answer(card.id, choice).then(load, (e: Error) => setSaid(e.message));", "    void choice;"),
    ], ["link.test.ts", "sessions.test.ts"]),
    ("an effect hands React scrollIntoView's Promise (as written first: the page tears down)", "src/rooms/Talk.tsx", [
        ("  useEffect(() => {\n    end.current?.scrollIntoView({ block: \"end\" });\n  }, [messages.length, live, card?.id]);", "  useEffect(() => end.current?.scrollIntoView({ block: \"end\" }) as unknown as void, [messages.length, live, card?.id]);"),
    ], ["link.test.ts", "sessions.test.ts"]),
    ("any new message wipes every orb's streamed words (as first written)", "src/rooms/Talk.tsx", [
        ("    setMessages(r.messages);\n    o.onMessages?.(r.messages);", "    if (r.messages.length !== messages.length) setLive({});\n    setMessages(r.messages);\n    o.onMessages?.(r.messages);"),
    ], ["sessions.test.ts"]),
    ("a made orb's address stays the creator's", "src/orbs.tsx", [
        ('    history.replaceState(history.state, "", routeHash({ room: "office", orb: made.name }));\n', ""),
    ], ["onboarding.test.ts", "link.test.ts"]),
    ("the home's orbs arrive and the office stays on the creator", "src/orbs.tsx", [
        ('      if (r.room === "new" && v.kind === "new") return v; // the creator, because you asked for it', '      if (v.kind === "new") return v;'),
    ], ["link.test.ts"]),
    ("a session starts with no title", "src/rooms/Sessions.tsx", [
        ('    if (!t) return setWhy("A session needs a title: what is it for?");\n', ""),
    ], ["sessions.test.ts"]),
    ("bringing someone in, or sending him out, never reaches the home", "src/rooms/Sessions.tsx", [
        ("set={(next) => o.home.bring(o.session.id, o.tab, next).then(o.changed, () => {})}", "set={() => undefined}"),
    ], ["sessions.test.ts"]),
    ("what was agreed is not on the stage", "src/rooms/Sessions.tsx", [
        ('  const agreed = messages.filter((m) => m.role === "notice" && typeof m.meta.agreed === "string");', "  const agreed: Message[] = [];"),
    ], ["sessions.test.ts"]),
    ("an orb's computer never shows what came back", "src/rooms/work.ts", [
        ("args, result: r?.content ?? null, failed:", "args, result: null, failed:"),
    ], ["work.test.ts"]),
    ("a session's tabs are not addresses", "src/ui/nav.ts", [
        ('  if (r.room === "sessions") return r.id === null ? "#/sessions" : `#/session/${r.id}/${r.tab}`;', '  if (r.room === "sessions") return "#/sessions";'),
    ], ["sessions.test.ts"]),
    ("a private chat is filed with every other chat", "src/home/link.ts", [
        ("export const chatOf = (c: Pick<Character, \"name\">): string => `chat:${idOf(c.name)}`;", "export const chatOf = (c: Pick<Character, \"name\">): string => \"chat:main\";"),
    ], ["link.test.ts"]),
    ("a short page is left short (no empty slots)", "src/ui/Paged.tsx", [
        ("            {Array.from({ length: PER_PAGE - slice.length }, (_, k) => (", "            {Array.from({ length: 0 }, (_, k) => ("),
    ], ["creator.test.ts"]),
    ("the pages are two across", "src/ui/pages.ts", [
        ("export const ACROSS = 3;", "export const ACROSS = 2;"),
    ], ["creator.test.ts"]),
    ("a picture tab has no page numbers", "src/ui/Paged.tsx", [
        ("      {pages > 1 && (\n        <nav", "      {false && (\n        <nav"),
    ], ["creator.test.ts"]),
    ("a roll that lands on another page stays where it was", "src/ui/Paged.tsx", [
        ("    if (at >= 0 && pageOf(at) !== page) {\n      setWent(pageOf(at) > page ? \"on\" : \"back\");\n      setPage(pageOf(at));\n    }\n", ""),
    ], ["creator.test.ts"]),
    ("a hat's colour paints nothing", "src/orb/spec.ts", [
        ('accCol: c.hatHue ? paint("accent", c.hatHue) : paint(w.main, c.hue),', "accCol: paint(w.main, c.hue),"),
    ], ["spec.test.ts", "creator.test.ts"]),
    ("the frames' colour paints nothing", "src/orb/spec.ts", [
        ('    specsCol: c.glassesHue ? paint("accent", c.glassesHue) : paint(g.frame, c.hue),', "    specsCol: paint(g.frame, c.hue),"),
    ], ["spec.test.ts"]),
    ("choosing an accessory's colour does nothing", "src/orbs.tsx", [
        ("            <Swatch hue={h.name} size={28} on={value === h.name} label={`${what} in ${h.name}`} onPick={() => onPick(h.name)} />", "            <Swatch hue={h.name} size={28} on={value === h.name} label={`${what} in ${h.name}`} onPick={() => undefined} />"),
    ], ["creator.test.ts"]),
    ("an accessory's colour is lost when he is kept", "src/orb/spec.ts", [
        ('    hatHue: typeof c.hatHue === "string" && hues.includes(c.hatHue) ? c.hatHue : c.hatHue === null ? null : base.hatHue ?? null,', "    hatHue: null,"),
    ], ["spec.test.ts", "creator.test.ts"]),
    ("hats sit where they did on every shape (no fit)", "src/orb/spec.ts", [
        ("  const Y = Math.max(Math.min(head(-FIT_AT), head(FIT_AT)) - beanDrop, peak);", "  const Y = -S0.d[1] * (1 + outline(S0, -Math.PI / 2));"),
    ], ["spec.test.ts"]),
    ("a hat hides his ears", "src/orb/glsl.ts", [
        ("      col = mix(col, c, aa*(1.0 - earFront));                       // his ears in front of it, the hat behind them", "      col = mix(col, c, aa);"),
    ], ["characters.test.ts"]),
    ("a bunny's hat sits on his ears' tips", "src/orb/spec.ts", [
        ("  const S: ShapeNumbers = ears ? { ...S0, c: [S0.c[0], S0.c[1], 0, S0.c[3]] } : S0;", "  const S: ShapeNumbers = S0;"),
    ], ["spec.test.ts"]),
    ("a wide shape's close-up is cut at the sides", "src/orb/Orb.tsx", [
        ('    () => (framing === "portrait" ? { ...PORTRAIT, radius: Math.min(PORTRAIT.radius, PORTRAIT.w / 2 / (halfWidth(character.shape) + PORTRAIT.edge + 0.04)) } : DESIGN),', '    () => (framing === "portrait" ? PORTRAIT : DESIGN),'),
    ], ["characters.test.ts"]),
    ("the shader ignores the fit", "src/orb/glsl.ts", [
        ("    float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.03*Rg;", "    float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + shapeR(-1.5707963))*(1.0 - 0.5*uSquash) - 0.03*Rg;"),
    ], ["characters.test.ts"]),
    ("a quoted comma splits a CSV's field", "src/rooms/work.ts", [
        ("    } else if (ch === '\"' && field === \"\") quoted = true;", "    } else if (false) quoted = true;"),
    ], ["work.test.ts"]),
    ("the bars are drawn from a number written as text", "src/rooms/work.ts", [
        ('  const value = keys.find((k) => recs.every((r) => typeof r[k] === "number" && Number.isFinite(r[k])));', '  const value = keys.find((k) => recs.every((r) => r[k] !== undefined && Number.isFinite(Number(r[k]))));'),
    ], ["work.test.ts"]),
    ("a decision shows as work on his computer", "src/rooms/work.ts", [
        ('      if (c.name === "agree") continue; // a decision shows as ✓ Agreed, not as work\n', ""),
    ], ["work.test.ts"]),
    ("the dataset counts its header as a row", "src/rooms/Computer.tsx", [
        ("          {body.length} {body.length === 1 ? \"row\" : \"rows\"} · {cols}", "          {rows.length} {rows.length === 1 ? \"row\" : \"rows\"} · {cols}"),
    ], ["computer.test.ts"]),
    ("his page runs its scripts beside the app", "src/rooms/Computer.tsx", [
        ('sandbox="" srcDoc={file.text}', 'sandbox="allow-scripts allow-same-origin" srcDoc={file.text}'),
    ], ["computer.test.ts"]),
    ("the cursor points at what he did not touch", "src/rooms/Computer.tsx", [
        ("    if (!el) {\n      setAt(null);\n      return;\n    }", "    if (!el) return;"),
    ], ["computer.test.ts"]),
    ("the cursor never goes where he worked", "src/rooms/Computer.tsx", [
        ("    const el = root.querySelector<HTMLElement>(`[data-act=\"${CSS.escape(latest.id)}\"]`);", "    const el = root.querySelector<HTMLElement>(\"[data-act]\");"),
    ], ["computer.test.ts"]),
    ("finishing is silent", "src/rooms/Computer.tsx", [
        ('      play("create");\n', ""),
    ], ["computer.test.ts"]),
    ("the Floor shows no one's computer", "src/rooms/Sessions.tsx", [
        ("            {shown && <Computer key={idOf(shown.name)} home={o.home} orb={shown} messages={messages} busy={busy[idOf(shown.name)]} big />}", "            {null}"),
    ], ["sessions.test.ts"]),
    ("the side menu does not count what waits", "src/orbs.tsx", [
        ('{navItem("Notifications", room === "notices", { room: "notices" }, "◔", notices.notices.length)}', '{navItem("Notifications", room === "notices", { room: "notices" }, "◔")}'),
    ], ["notices.test.ts"]),
    ("a notice put away on one device stays on another", "src/rooms/Notices.tsx", [
        ('        if (e.type === "notice.added" || e.type === "notice.put_away") reload();', '        if (e.type === "notice.added") reload();'),
    ], ["notices.test.ts"]),
    ("an approval opens nowhere", "src/rooms/Notices.tsx", [
        ("  const c = n.conversation;\n  if (!c) return null;", "  const c = n.conversation;\n  if (c || !c) return null;"),
    ], ["notices.test.ts"]),
    ("the calendar's week starts on Sunday", "src/rooms/Calendar.tsx", [
        ("  const lead = (first.getDay() + 6) % 7; // days since Monday", "  const lead = first.getDay();"),
    ], ["calendar.test.ts"]),
    ("moving a bill in the calendar reaches nowhere", "src/rooms/Calendar.tsx", [
        ("act(home.moveReminder(e.id, e.time ? `${ev.target.value}T${e.time}` : ev.target.value))", "act(Promise.resolve())"),
    ], ["calendar.test.ts"]),
    ("a schedule's time in the calendar reaches nowhere", "src/rooms/Calendar.tsx", [
        ("set={(time) => act(home.setSchedule(e.id, { time }))}", "set={() => act(Promise.resolve())}"),
    ], ["calendar.test.ts"]),
    ("the lab's search looks for nothing", "src/rooms/Lab.tsx", [
        ("    if (o.home) o.home.labOf(q).then(setLab, (e: Error) => setSaid(e.message));", "    if (o.home) o.home.labOf(\"\").then(setLab, (e: Error) => setSaid(e.message));"),
    ], ["lab.test.ts"]),
    ("Reopen opens the old brainstorm", "src/rooms/Lab.tsx", [
        ('    home.reopen(id).then((s) => o.go({ room: "sessions", id: s.id, tab: "brainstorm" }), (e: Error) => setSaid(e.message));', '    void home; o.go({ room: "sessions", id, tab: "brainstorm" });'),
    ], ["lab.test.ts"]),
    ("the specimen scrolls sideways on a phone", "src/specimen.tsx", [
        ('gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))"', 'gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))"'),
    ], ["render.test.ts"]),
]

# the `orbs` terminal (PLAN 1.9): paths are inside packages/terminal
TERMINAL_MUTANTS: list[tuple[str, str, list[tuple[str, str]], list[str]]] = [
    ("Esc does not stop the run", "src/app.ts", [
        ("      else if (busy) stop();", "      else if (busy) void 0;"),
    ], ["terminal.test.ts"]),
    ("after a stop the screen still says he is working", "src/app.ts", [
        ("        setBusy(false);\n        setActivity(null);\n        setRunning(null);\n", "        setActivity(null);\n        setRunning(null);\n"),
    ], ["terminal.test.ts"]),
    ("after a stop the keys are read but nothing is drawn (Ash's Ink freeze, as seen)", "src/app.ts", [
        ("  useInput((ch, key) => {\n", "  const frozen = useRef(false);\n  useInput((ch, key) => {\n    if (frozen.current) return;\n"),
        ("      else if (busy) stop();", "      else if (busy) { stop(); frozen.current = true; }"),
    ], ["terminal.test.ts"]),
    ("a stopped reply's words are dropped (the freeze's cause)", "src/app.ts", [
        ("        return m.content.trim() ? [{ key: k, kind: \"speech\"", "        return m.content.trim() && m.meta.stopped !== true ? [{ key: k, kind: \"speech\""),
    ], ["terminal.test.ts"]),
    ("a reply's live copy is left on screen beside the committed one", "src/app.ts", [
        ("        setSettling((s) => (s && fresh.some((m) => m.id === s.msg) ? null : s));", "        setSettling((s) => s);"),
    ], ["terminal.test.ts"]),
    ("a card's record is shown before it is answered", "src/app.ts", [
        ('          if (!status || status === "pending") {', "          if (false) {"),
    ], ["terminal.test.ts"]),
    ("a call's row is drawn before it has run", "src/app.ts", [
        ("        return m.content.trim() ? [{ key: k, kind: \"speech\"", "        if ((m.toolCalls ?? []).length) return [{ key: `${k}x`, kind: \"tool\", verb: \"Ran\", what: oneLine(this.running?.[1] ?? \"\") }];\n        return m.content.trim() ? [{ key: k, kind: \"speech\""),
    ], ["terminal.test.ts"]),
    ("a card answers to any key", "src/app.ts", [
        ("      const k = cardKeys(card!).find(([c]) => c === ch.toLowerCase());",
         "      const k = cardKeys(card!).find(([c]) => c === ch.toLowerCase()) ?? cardKeys(card!)[0];"),
    ], ["terminal.test.ts"]),
    ("an Enter typed in the same read as its text is lost", "src/app.ts", [
        ("    ch.split(/\\r\\n?|\\n/).forEach(", "    [ch.replace(/[\\r\\n]+/g, \" \")].forEach("),
    ], ["terminal.test.ts"]),
    ("\"always\" offered when the home did not offer it", "src/app.ts", [
        ("  if (card.meta.mayAlways === true) keys.push(", "  keys.push("),
    ], ["units.test.ts"]),
    ("the bean gets a mouth", "src/bean.ts", [
        ("  return null; // no mouth: his eyes are the face", "  return kind !== \"none\" && dy === 4 && Math.abs(dx - 0.5) <= 1.5 ? EYE : null;"),
    ], ["units.test.ts"]),
    ("the terminal shows the plan's badge whoever answered", "src/app.ts", [
        ('        if (!m.meta.stopped && !m.meta.error) this.plan = m.meta.plan === "chatgpt";', "        this.plan = true;"),
    ], ["terminal.test.ts"]),
    ("the screen model ignores erases (a desync would read as fine)", "test/screen.ts", [
        ('      case "K":\n', '      case "K":\n        break;\n'),
    ], ["units.test.ts"]),
]


def copy_home(tmp: Path) -> Path:
    """A scratch copy laid out like the repo: packages/home and packages/terminal beside the real
    kit/ and docs/ (linked, used read-only), so a copied test finds everything the real one does.
    Returns the copied packages/ directory."""
    pkgs = tmp / "packages"
    if pkgs.exists():
        shutil.rmtree(pkgs)
    for src in (HOME_PKG, TERMINAL_PKG, APP_PKG):
        work = pkgs / src.name
        shutil.copytree(src, work, symlinks=True, ignore=shutil.ignore_patterns("node_modules", "dist", "renders"))
        (work / "node_modules").symlink_to(src / "node_modules", target_is_directory=True)
    for shared in ("kit", "docs"):  # read-only inputs the home's tests use (the kit, the bake-off defaults)
        if not (tmp / shared).exists():
            (tmp / shared).symlink_to(REPO / shared, target_is_directory=True)
    if not (tmp / "tsconfig.base.json").exists():  # the app's build reads it (Vite follows tsconfig's extends)
        (tmp / "tsconfig.base.json").symlink_to(REPO / "tsconfig.base.json")
    return pkgs


def run_suites(work: Path, suites: list[str]) -> subprocess.CompletedProcess[str]:
    """The suites (paths inside `work`, the copied packages/), each test given a minute. A run that
    still hangs past ten is red too: a defect that makes a test hang has been caught as surely as
    one that makes it fail."""
    # as the gate runs them (tools/run-ts-tests.mjs): half the cores at once, two minutes a test;
    # every core at once starved the picture suites past their limit (10-02)
    at = max(2, (os.cpu_count() or 4) // 2)
    cmd = ["node", "--test", "--test-timeout=120000", f"--test-concurrency={at}", *[str(work / s) for s in suites]]
    # its own process group, so a hung run is ended with everything it started (a planted defect
    # that spawns two kits leaves one nobody will stop)
    p = subprocess.Popen(cmd, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=600)
        return subprocess.CompletedProcess(cmd, p.returncode, out, "")
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, _ = p.communicate()
        return subprocess.CompletedProcess(cmd, 124, (out or "") + "\n[hung past 600 s]", "")


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # progress shows as it happens, even into a file
    fails = 0
    planted = [(name, f"home/{rel}", edits, [f"home/test/{s}" for s in ss]) for name, rel, edits, ss in MUTANTS]
    planted += [(name, f"terminal/{rel}", edits, [f"terminal/test/{s}" for s in ss]) for name, rel, edits, ss in TERMINAL_MUTANTS]
    planted += [(name, f"app/{rel}", edits, [f"app/test/{s}" for s in ss]) for name, rel, edits, ss in APP_MUTANTS]
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
        planted = [m for m in planted if only in m[1] or only in m[0] or any(only in s for s in m[3])]
        if not planted:
            print(f"no mutant matches --only {only!r}")
            return 1
    suites = sorted({s for *_, ss in planted for s in ss})
    with tempfile.TemporaryDirectory(prefix="orbs-mutants-") as td:
        tmp = Path(td)
        # M.0, the control for every line below: the copy with NOTHING planted must be green.
        # If it is red (a path the copy lacks, a missing dependency), every mutant would be
        # "caught" for that reason instead of its own, and this tool would prove nothing.
        base = run_suites(copy_home(tmp), suites)
        print(f"{'PASS' if base.returncode == 0 else 'FAIL'}  M.0 the scratch copy, unmutated, is green")
        if base.returncode != 0:
            print("\n".join("    " + l for l in (base.stdout + base.stderr).splitlines()[-25:]))
            print("the baseline is red, so the mutants below would prove nothing")
            return 1
        for name, rel, edits, suites_for in planted:
            work = copy_home(tmp)
            f = work / rel
            text = f.read_text()
            gone = [old for old, _ in edits if old not in text]
            if gone:
                print(f"FAIL  {name}: an anchor is gone from {rel}; update the mutant: {gone[0][:60]!r}")
                fails += 1
                continue
            for old, new in edits:
                text = text.replace(old, new, 1)
            f.write_text(text)
            caught = run_suites(work, suites_for).returncode != 0
            print(f"{'PASS' if caught else 'FAIL'}  M: {', '.join(s.split('/test/')[-1] for s in suites_for)} catches: {name}")
            fails += not caught
    print("ALL PASS" if not fails else f"{fails} FAILED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
