#!/usr/bin/env python3
"""Controls for the home's tests (PLAN 1.2_t; CLAUDE.md rule 4): each mutant plants one real
defect in a scratch copy of packages/home (or packages/terminal, PLAN 1.9_t, or packages/app, or the
kit's own code, kit/orbs_kit, PLAN 4.7_t), and the named suite must go red. The repo itself is never
touched.

    pnpm check:controls      # runs this after tools/check_controls.py
    tools/home_mutants.py --only terminal/    # just the mutants whose file, name or suite has this text
    tools/home_mutants.py --only home/ --part 1/2   # every second one of them, from the first
    tools/home_mutants.py --only vault --only board  # those of either
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
KIT = REPO / "kit"

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
        ('    if (!whole && !parts.length) return live.filter((m) => m.role !== "summary");', '    if (true) return live.filter((m) => m.role !== "summary");'),
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
        ("        let passed = !res.isError;", "        let passed = true;"),
    ], ["board.test.ts"]),
    ("a test that cannot fail is accepted", "src/plans/board.ts", [
        ("    if (CANNOT_FAIL.test(command)) throw", "    if (false) throw"),
    ], ["board.test.ts"]),
    ("a feature ticks without its test row", "src/plans/board.ts", [
        ('        .prepare("UPDATE board SET box = ?, evidence = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)")',
         '        .prepare("UPDATE board SET box = ?, evidence = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?) AND test = 0")'),
    ], ["board.test.ts"]),
    ("a visual row ticks without pagecheck", "src/plans/board.ts", [
        ("        if (page && !pageCheck) {", "        if (false) {"),
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
        ('const r = await run(this.#tool, ["store", `--label=Orbz: ChatGPT sign-in`, "service", SERVICE, "key", key], value);',
         'const r = await run(this.#tool, ["store", `--label=Orbz: ChatGPT sign-in`, "service", SERVICE, "key", key, value], value);'),
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
        ("    this.#saved = { ...this.#saved, gemini: { model, lite } };", "    this.#saved = { ...this.#saved, gemini: { model, lite, key: k } as { model: string } };"),
    ], ["brains.test.ts"]),
    ("an AQ. key, AI Studio's kind now, is turned away as not a key", "src/brain/brains.ts", [
        ("    if (!/^[\\w.-]{20,}$/.test(k))", "    if (!/^[\\w-]{20,}$/.test(k))"),
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
        ('    this.#inbox.enqueue(left[0]!.orb, conversation, "turn", "", { data: { team } });', '    for (const o of left.splice(0)) this.#inbox.enqueue(o.orb, conversation, "turn", "", { data: { team: { ...team, role: o.role } } });'),
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
        ("  const p = inWorkspace(root, path);\n  if (!p) throw new OutsideError(path);", "  const p = join(root, path);"),
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
    ("a lesson learned leaves no mark on the conversation", "src/agent/tools.ts", [
        ("        ctx.note?.(`Memory updated: ${lines.at(-1)}`, { memory: lines.at(-1) }); // the chip on the conversation (PLAN 2.4)\n", ""),
    ], ["lessons.test.ts"]),
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
        ("      const r = await this.#calls(msg, 0, ctx, tctx, step, at, false); // a habit is tested code: no repeat guard\n      if (r === \"repeated\") return { outcome: \"ok\", summary: \"repeated\" };\n      if (r !== \"done\") return this.#ended(r, ctx);\n    }\n    return null;",
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
        ("own?.system ?? null].filter(Boolean)", "null].filter(Boolean)"),
    ], ["playbook.test.ts"]),
    ("his own brain's cost is billed as the big brain's", "src/agent/loop.ts", [
        ('          tier: own ? "own" : "big", model: ep.model,', '          tier: "big", model: ep.model,'),
    ], ["playbook.test.ts"]),
    ("the morning card counts his own brain's run as the big brain's too", "src/gym/card.ts", [
        ('(e.data.tier === "habit" || e.data.tier === "own") && typeof e.data.run', 'e.data.tier === "habit" && typeof e.data.run'),
    ], ["playbook.test.ts"]),
    # connectors (PLAN 4.2)
    ("a connector's tool runs without asking", "src/connectors/tools.ts", [
        ('    decision: "ask",', '    decision: "allow",'),
    ], ["connectors.test.ts"]),
    ("a connector's sending tool may be 'always' allowed", "src/connectors/tools.ts", [
        ("    floor: () => toolFloor(tool.name),", "    floor: () => toolFloor(tool.name).slice(0, 0),"),
    ], ["connectors.test.ts"]),
    ("a connector's answer is trusted", "src/connectors/tools.ts", [
        ('    untrusted: "document",\n', ""),
    ], ["connectors.test.ts"]),
    ("a connector's secret is written into its file", "src/connectors/connectors.ts", [
        ("    this.#save({ ...this.specs(), [name]: spec });", "    this.#save({ ...this.specs(), [name]: { ...spec, kept: secrets } as Spec });"),
    ], ["connectors.test.ts"]),
    ("a removed connector keeps its secret", "src/connectors/connectors.ts", [
        ("    for (const v of Object.values(\"command\" in spec ? spec.env ?? {} : spec.headers ?? {})) if (isSecret(v)) await store.delete(", "    for (const v of Object.values(\"command\" in spec ? spec.env ?? {} : spec.headers ?? {})) if (isSecret(v) && v.secret === \"never\") await store.delete("),
    ], ["connectors.test.ts"]),
    ("a server that never shakes hands holds the home", "src/connectors/connectors.ts", [
        ("      await deadline(client.connect(transport), this.#o.handshakeMs ?? HANDSHAKE_MS, `the ${name} connector`);", "      await client.connect(transport);"),
    ], ["connectors.test.ts"]),
    ("the floor reads nothing in a tool's name", "src/rules/floor.ts", [
        ("  if (words.some((w) => CHANGES.test(w)) && words.some((w) => ON_CALENDAR.test(w))) hits.push(", "  if (words.length < 0) hits.push("),
    ], ["connectors.test.ts"]),
    # mail, no middleman (PLAN 4.2)
    ("a mail account is kept without signing in", "src/connectors/mail.ts", [
        ("    const c = await Imap.open({ ...a, password }, this.#o.timeoutMs ? { timeoutMs: this.#o.timeoutMs } : {}); // refused here, nothing kept", "    const c = { close() {} };"),
    ], ["mail.test.ts"]),
    ("a mail trigger fires on what was there", "src/connectors/mail.ts", [
        ("          if (cursor === null || validity !== c.uidValidity) return", "          if (cursor !== null && validity !== c.uidValidity) return"),
    ], ["mail.test.ts"]),
    ("a draft forgets what it answers", "src/connectors/imap.ts", [
        ("    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),\n", ""),
    ], ["mail.test.ts"]),
    ("plain IMAP to anywhere", "src/connectors/imap.ts", [
        ('    if (!tls && a.host !== "127.0.0.1" && a.host !== "localhost") throw', "    if (!tls && a.host.length < 0) throw"),
    ], ["mail.test.ts"]),
    ("a mail's words are trusted", "src/connectors/mail.ts", [
        ('      untrusted: "mail",\n', ""),
    ], ["mail.test.ts"]),
    # replies you owe (PLAN 4.5)
    ("a newsletter is a reply you owe", "src/connectors/mail.ts", [
        ("          if (h.automated || NO_REPLY.test(from) || mine.has(from)) continue;", "          if (NO_REPLY.test(from) || mine.has(from)) continue;"),
    ], ["mail.test.ts"]),
    ("a no-reply sender is owed a reply", "src/connectors/mail.ts", [
        ("          if (h.automated || NO_REPLY.test(from) || mine.has(from)) continue;", "          if (h.automated || mine.has(from)) continue;"),
    ], ["mail.test.ts"]),
    ("your own mail is a reply you owe", "src/connectors/mail.ts", [
        ("          if (h.automated || NO_REPLY.test(from) || mine.has(from)) continue;", "          if (h.automated || NO_REPLY.test(from)) continue;"),
    ], ["mail.test.ts"]),
    ("a reply already sent is still owed", "src/connectors/imap.ts", [
        ("UID SEARCH UNANSWERED SINCE ${d.getDate()}", "UID SEARCH SINCE ${d.getDate()}"),
    ], ["mail.test.ts"]),
    ("the day leaves the replies you owe out", "src/day.ts", [
        ("    const owed = h.mail && Object.keys(h.mail.accounts()).length ? (await h.mail.owed(now)).owed : [];", "    const owed: Owed[] = [];"),
    ], ["day.test.ts"]),
    # the day (PLAN 4.5): Ash's carried day on what the home hands in
    ("the day leaves the orbs' bills off its list", "src/day.ts", [
        ('    .flatMap((e) => (e.kind === "bill" || e.kind === "reminder" ? [e] : []))', "    .flatMap((e) => (e.kind === \"bill\" && e.kind !== \"bill\" ? [e] : []))"),
    ], ["day.test.ts"]),
    ("the day names no clash", "src/day.ts", [
        ("      clashes: clashes.map(", "      clashes: clashes.slice(0, 0).map("),
    ], ["day.test.ts"]),
    ("the day hands the kit tomorrow, not today", "src/day.ts", [
        ("  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();", "  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();"),
    ], ["day.test.ts"]),
    # a trigger's event is from outside (a subject line, a feed's title)
    ("a trigger's event reaches the model unfenced", "src/agent/loop.ts", [
        ("item.text.slice(0, outside) + (await this.#o.guard.fence(`${ctx.conversation}:${randomUUID()}`, item.text.slice(outside)))", "item.text"),
    ], ["mail.test.ts"]),
    ("a trigger's turn is not marked as outside", "src/agent/loop.ts", [
        ('      if (outside !== null) this.#o.guard.mark(`${ctx.conversation}#${asked.id}`, "trigger", String(item.data.trigger ?? ""));\n', ""),
    ], ["mail.test.ts"]),
    ("a trigger says nothing of where its event starts", "src/triggers.ts", [
        ("      data: { trigger: t.id, event: e.id, at: e.at, outside: head.length },", "      data: { trigger: t.id, event: e.id, at: e.at },"),
    ], ["mail.test.ts"]),
    ("where a trigger's event starts is taken for one of its fields", "src/gym/finder.ts", [
        ('"at", "outside", "team"', '"at", "team"'),
    ], ["finder.test.ts"]),
    ("a trade on a connector does not ask", "src/rules/floor.ts", [
        ("|order|sell|trade|swap|withdraw|deposit|stake|unstake|bridge|bet|", "|order|bet|"),
    ], ["connectors.test.ts"]),
    ("an order on an exchange does not ask", "src/rules/floor.ts", [
        ("  /\\b(binance|kraken|robinhood|etoro|alpaca|bybit|okx|kucoin|bitstamp|bitfinex|uniswap)\\b/i,\n  /\\b(sell|trade|swap|withdraw|stake|unstake)\\b/i,\n", ""),
    ], ["connectors.test.ts"]),
    # your Google and Microsoft accounts (PLAN 4.2)
    ("a sign-in that comes back with another state is taken", "src/connectors/accounts.ts", [
        ('      if (q.get("state") !== state) {', '      if (q.get("state") !== state && q.get("state") === "never") {'),
    ], ["accounts.test.ts"]),
    ("the code is exchanged without its verifier", "src/connectors/accounts.ts", [
        ('{ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, scope: p.mailScope }', '{ grant_type: "authorization_code", code, redirect_uri: redirectUri, scope: p.mailScope }'),
    ], ["accounts.test.ts"]),
    ("Gmail's drafts go to a new folder called Drafts", "src/connectors/imap.ts", [
        ('      if (m && /\\\\Drafts\\b/i.test(m[1]!)) return', '      if (m && m[1] === "never") return'),
    ], ["accounts.test.ts"]),
    ("cancelled Google events are on the calendar", "src/connectors/accounts.ts", [
        ('        if (e.status === "cancelled" || !e.start) continue;', '        if (!e.start) continue;'),
    ], ["accounts.test.ts"]),
    ("a calendar Google hides is read too", "src/connectors/accounts.ts", [
        (".filter((c) => c.selected || c.primary);", ".filter((c) => c.id !== \"\");"),
    ], ["accounts.test.ts"]),
    ("a Teams meeting's time is read as the home's own", "src/connectors/accounts.ts", [
        ("      const utc = (s: string): number => Date.parse(/[zZ]|[+-]\\d\\d:\\d\\d$/.test(s) ? s : `${s}Z`);", "      const utc = (s: string): number => new Date(s.replace(/\\.\\d+$/, \"\")).getTime();"),
    ], ["accounts.test.ts"]),
    ("Microsoft's new refresh token is thrown away", "src/connectors/accounts.ts", [
        ("    if (t.refresh_token && t.refresh_token !== refresh) await store.set(`account:${name}:refresh`, t.refresh_token); // Microsoft rolls it\n", ""),
    ], ["accounts.test.ts"]),
    ("disconnecting leaves the mail behind", "src/home.ts", [
        ("    if (this.mail.accounts()[name]?.oauth === name) await this.mail.remove(name);\n", ""),
    ], ["accounts.test.ts"]),
    ("a provider with no app registered starts a sign-in anyway", "src/connectors/accounts.ts", [
        ("    if (!client) throw new AccountError(`this home has no ${p.title} app registered yet (docs/accounts.md)`);\n    this.#signIn?.cancel", "    this.#signIn?.cancel"),
    ], ["accounts.test.ts"]),
    # your own calendars, by their ICS addresses (PLAN 4.2)
    ("a recurrence keeps the home's clock, not its own zone's", "src/connectors/ics.ts", [
        ("  const at = (y: number, mo: number, d: number): number => instant(y, mo, d, h, mi, sec, start.zone);", "  const at = (y: number, mo: number, d: number): number => new Date(y, mo, d, new Date(start.t).getHours(), new Date(start.t).getMinutes(), sec).getTime();"),
    ], ["calendars.test.ts"]),
    ("a moved meeting is at its old time too", "src/connectors/ics.ts", [
        ('series ? (replaced.get(ps.find((p) => p.name === "UID")?.value ?? "") ?? new Set()) : new Set()', "new Set()"),
    ], ["calendars.test.ts"]),
    ("a called-off meeting is still on", "src/connectors/ics.ts", [
        ('    if (/^CANCELLED$/i.test(ps.find((p) => p.name === "STATUS")?.value ?? "")) continue;', '    if (ps.length < 0) continue;'),
    ], ["calendars.test.ts"]),
    ("the second Tuesday is read as the same date each month", "src/connectors/ics.ts", [
        ('    else if (r.FREQ === "MONTHLY" && (nthDays.length || monthDays.length)) {', '    else if (r.FREQ === "MONTHLY" && nthDays.length < 0) {'),
    ], ["calendars.test.ts"]),
    ("Outlook's zone names are read as the home's time", "src/connectors/ics.ts", [
        ("params.TZID ? (WINDOWS[params.TZID] ?? params.TZID) : null", "params.TZID ? params.TZID : null"),
    ], ["calendars.test.ts"]),
    ("a rule the reader does not know is guessed at", "src/connectors/ics.ts", [
        ("  if (Object.keys(r).some((k) => !READ_PARTS.has(k)) || (r.BYDAY && r.FREQ === \"YEARLY\") ||", "  if ("),
    ], ["calendars.test.ts"]),
    ("a daily rule's weekdays are not read", "src/connectors/ics.ts", [
        (".filter(() => !byDay.length || byDay.includes(new Date(Date.UTC(Y, M, D + step * interval)).getUTCDay()))", ""),
    ], ["calendars.test.ts"]),
    ("a holiday is only on its first day", "src/calendar.ts", [
        ("    if (!e.allDay) return [one(e.start)];", "    if (e.allDay || !e.allDay) return [one(e.start)];"),
    ], ["calendars.test.ts"]),
    ("a taken-out day still happens", "src/connectors/ics.ts", [
        ("t < to && !skip.has(t) ?", "t < to ?"),
    ], ["calendars.test.ts"]),
    ("a monthly event on the 31st lands on the 1st", "src/connectors/ics.ts", [
        ("} else if (r.FREQ === \"MONTHLY\") candidates = lands(Y, M + step * interval, D) ? [at(Y, M + step * interval, D)] : [];", "} else if (r.FREQ === \"MONTHLY\") candidates = [at(Y, M + step * interval, D)];"),
    ], ["calendars.test.ts"]),
    ("folded lines are not joined", "src/connectors/ics.ts", [
        ('  const lines = text.replace(/\\r?\\n[ \\t]/g, "").split(/\\r?\\n/);', '  const lines = text.split(/\\r?\\n/);'),
    ], ["calendars.test.ts"]),
    ("a page is taken for a calendar", "src/connectors/calendars.ts", [
        ("    if (!/BEGIN:VCALENDAR/i.test(text)) throw", "    if (text.length < 0) throw"),
    ], ["calendars.test.ts"]),
    ("a calendar's address is kept in its file", "src/connectors/calendars.ts", [
        ("    this.#save({ ...this.#specs(), [name]: { label: label.trim().slice(0, 60) || name } });", "    this.#save({ ...this.#specs(), [name]: { label: label.trim().slice(0, 60) || name, url } as { label: string } });"),
    ], ["calendars.test.ts"]),
    ("a calendar's reason names its secret", "src/connectors/calendars.ts", [
        ("    if (!r.ok) throw new CalendarError(hide(r.reason ?? `the calendar's address answered ${r.status ?? \"nothing\"}`, url));", "    if (!r.ok) throw new CalendarError(`${r.reason ?? \"no answer\"} from ${url}`);"),
    ], ["calendars.test.ts"]),
    ("a calendar is never read again", "src/connectors/calendars.ts", [
        ("      if (!k || this.#o.now() - k.at >= REFRESH_MS) {", "      if (!k) {"),
    ], ["calendars.test.ts"]),
    ("a failing calendar loses its events", "src/connectors/calendars.ts", [
        ('              return { text: last?.text ?? "", at:', '              return { text: "", at:'),
    ], ["calendars.test.ts"]),
    ("your calendar's events are left off the calendar", "src/api.ts", [
        ("      return { entries: withEvents(entries, await home.calendars.events(span.start, span.end), span) };", "      return { entries: withEvents(entries, [], span) };"),
    ], ["calendars.test.ts"]),
    ("a calendar's words are trusted", "src/connectors/calendars.ts", [
        ('      untrusted: "calendar",\n', ""),
    ], ["calendars.test.ts"]),
    ("a phone adds a connector that runs a program on the box", "src/api.ts", [
        ('      if (remote && "command" in spec) throw', '      if (remote && "command" in spec && remote.length < 0) throw'),
    ], ["devices.test.ts"]),
    ("a mail account is kept as given, unchecked", "src/connectors/mail.ts", [
        ("    const a = accountOf(given);\n    const c = await Imap.open({ ...a, password },", "    const a = given;\n    const c = await Imap.open({ ...a, password },"),
    ], ["mail.test.ts"]),
    # a file you give him (PLAN 2.4, attach)
    ("a file you give him overwrites the one before", "src/workspace.ts", [
        ('      writeFileSync(at, bytes, { flag: "wx" }); // never over one that is there', '      writeFileSync(at, bytes, { flag: "w" }); // never over one that is there'),
    ], ["workspace.test.ts"]),
    ("a file's name keeps its way up", "src/workspace.ts", [
        ("  const last = name.split(/[/\\\\]/).pop() ?? \"\";", "  const last = name;"),
    ], ["workspace.test.ts"]),
    ("a hidden name stays hidden", "src/workspace.ts", [
        ('.replace(/^[. ]+/, "")', ""),
    ], ["workspace.test.ts"]),
    ("a file you give him has no size limit", "src/api.ts", [
        ("    if (size > cap) throw new HttpError(413,", "    if (size > cap * 1000) throw new HttpError(413,"),
    ], ["workspace.test.ts"]),
    # the schedule editor's rules (PLAN 2.4)
    ("a schedule may run every 5 minutes, or unevenly", "src/schedule-rules.ts", [
        ("export const EVERY_MINUTES = [15, 20, 30] as const;", "export const EVERY_MINUTES = [5, 15, 20, 30, 45] as const;"),
    ], ["schedule-rules.test.ts"]),
    ("Sunday is day 7 to cron", "src/schedule-rules.ts", [
        ('days.map((d) => d % 7).sort((a, b) => a - b).join(",")', 'days.map((d) => d).sort((a, b) => a - b).join(",")'),
    ], ["schedule-rules.test.ts"]),
    ("weekdays are said day by day", "src/schedule-rules.ts", [
        ('        if (days.join() === "1,2,3,4,5") return `Weekdays at ${at}`;\n', ""),
    ], ["schedule-rules.test.ts"]),
    ("the editor keeps another pattern than it previewed", "src/api.ts", [
        ("      const cron = cronFor(ruleOf(b.rule));", '      const cron = cronFor(ruleOf(b.rule)) && "0 9 * * *";'),
    ], ["schedule-rules.test.ts"]),
    ("an orb sets itself a schedule without asking", "src/agent/tools.ts", [
        ('    decision: "ask", // work that comes back on its own, unwatched: the person says yes to it first', '    decision: "allow",'),
    ], ["schedule-rules.test.ts"]),
    ("a schedule that cannot be one reaches you as a card", "src/agent/tools.ts", [
        ("        cronFor(ruleFromArgs(a));\n        return null;", "        return null;"),
    ], ["schedule-rules.test.ts"]),
    # the keychain, one per machine, shared by every home (PLAN 1.10)
    ("every home reads every home's secrets", "src/chatgpt/store.ts", [
        ("    return (await this.#inner.get(this.#prefix + key)) ?? (this.#legacy ? this.#inner.get(key) : null);", "    return (await this.#inner.get(this.#prefix + key)) ?? this.#inner.get(key);"),
    ], ["store-scope.test.ts"]),
    ("the default home loses its sign-in", "src/chatgpt/store.ts", [
        ("    return (await this.#inner.get(this.#prefix + key)) ?? (this.#legacy ? this.#inner.get(key) : null);", "    return (await this.#inner.get(this.#prefix + key)) ?? (this.#legacy ? null : null);"),
    ], ["store-scope.test.ts"]),
    # the personal web app's home side (PLAN 2.7)
    ("a revoked device keeps its way in", "src/sessions.ts", [
        ("    if (!r || r.revoked_at !== null || r.expires_at < now) return null;", "    if (!r || r.expires_at < now) return null;"),
    ], ["devices.test.ts"]),
    ("the second door answers to any name", "src/api.ts", [
        ("    if (!remote.includes(name) || (host !== name && host !== `${name}:${port}`)) throw", "    if (remote.length < 0) throw"),
    ], ["devices.test.ts"]),
    ("the second door takes the loopback token", "src/api.ts", [
        ("  const byToken = !remote && got.length === want.length", "  const byToken = got.length === want.length"),
    ], ["devices.test.ts"]),
    ("the second door's cookie is not Secure", "src/api.ts", [
        ('${remote ? "; Secure" : ""}', '${remote ? "" : ""}'),
    ], ["devices.test.ts"]),
    ("a stranger makes a passkey", "src/api.ts", [
        ('  if (method === "POST" && url.pathname === "/passkeys/sign-in/options" && door) return home.passkeys.getOptions(where);', '  if (method === "POST" && url.pathname === "/passkeys/sign-in/options" && door) return home.passkeys.getOptions(where);\n  if (method === "POST" && url.pathname === "/passkeys/new/options" && door) return home.passkeys.createOptions(where, "a stranger");'),
    ], ["devices.test.ts"]),
    ("a sign-in another site asked for is taken", "src/passkeys.ts", [
        ("    if (data.origin !== where.origin || data.crossOrigin === true) throw", "    if (data.crossOrigin === true) throw"),
    ], ["devices.test.ts"]),
    ("a challenge is good twice", "src/passkeys.ts", [
        ("    if (typeof data.challenge === \"string\") this.#challenges.delete(data.challenge); // used once, right or wrong\n", ""),
    ], ["devices.test.ts"]),
    ("a passkey for another name is taken", "src/passkeys.ts", [
        ("    if (!d.rpIdHash.equals(sha256(where.rpId))) throw", "    if (d.rpIdHash.length < 0) throw"),
    ], ["devices.test.ts"]),
    ("a sign-in without the person verified is taken", "src/passkeys.ts", [
        ("    if (!(d.flags & UP) || !(d.flags & UV)) throw", "    if (!(d.flags & UP)) throw"),
    ], ["devices.test.ts"]),
    ("a passkey's signature is never checked", "src/passkeys.ts", [
        ("    if (!ok) throw new PasskeyError(", "    if (!ok && false) throw new PasskeyError("),
    ], ["devices.test.ts"]),
    ("a passkey whose counter went back is taken", "src/passkeys.ts", [
        ("    if ((d.signCount !== 0 || row.sign_count !== 0) && d.signCount <= row.sign_count) throw", "    if (false) throw"),
    ], ["devices.test.ts"]),
    ("a flood of challenges is all kept", "src/passkeys.ts", [
        ("    while (this.#challenges.size >= CHALLENGES_KEPT) this.#challenges.delete(", "    while (this.#challenges.size >= CHALLENGES_KEPT * 1000) this.#challenges.delete("),
    ], ["devices.test.ts"]),
    ("a passkey made is taken as a sign-in", "src/passkeys.ts", [
        ("    if (data.type !== type) throw", "    if (data.type === undefined) throw"),
    ], ["devices.test.ts"]),
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
    ("a link out of the workspace is read without asking", "src/rules/rank.ts", [
        ("      return real === root || real.startsWith(root + sep);", "      return real.length > 0;"),
    ], ["rank.test.ts"]),
    ("a glob passes as reading", "src/rules/rank.ts", [
        ("""'"*?[\\]]/;""", """'"]/;"""),
    ], ["rank.test.ts"]),
    ("a flag that follows links passes as reading", "src/rules/rank.ts", [
        ("!RUNS_SOMETHING.test(t) && !FOLLOWS.test(t) && ", "!RUNS_SOMETHING.test(t) && "),
    ], ["rank.test.ts"]),
    ("the guard checks no workspace for rank", "src/rules/guard.ts", [
        (", workspace: workspaceOf(this.#o.dataDir, at.orb) })", " })"),
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
        ("  if (!o.mini && RESEARCHERS.includes(o.specialty)) parts.push(RESEARCH_METHOD);\n", ""),
    ], ["web.test.ts"]),
    # the fundamental analyst (owner, 10-07)
    ("the fundamental analyst does not read the books", "src/brain/constitution.ts", [
        ('  if (!o.mini && o.specialty === "fundamentals") parts.push(FUNDAMENTALS_METHOD);\n', ""),
    ], ["constitution.test.ts"]),
    ("asked, the fundamental analyst forgets how to read the books", "src/agent/standing.ts", [
        ('  if (role === "asked" && o.specialty === "fundamentals") parts.push(FUNDAMENTALS_METHOD); // asked to look at a company or a coin\n', ""),
    ], ["constitution.test.ts"]),
    # his computer (PLAN 4.1): his own browser, its proxy, the vault, a page checked before it is done
    ('his browser is given your home folder', 'src/computer/browser.ts', [
        ('  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share") };', '  return { ...env, HOME: process.env.HOME ?? home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share") };'),
    ], ['computer-profile.test.ts']),
    ("his browser is handed the home's whole environment", 'src/computer/browser.ts', [
        ('  if (process.platform === "win32") return { ...(process.env as Record<string, string>) };', '  if (process.platform === "win32" || home) return { ...(process.env as Record<string, string>), HOME: home };'),
    ], ['computer-profile.test.ts']),
    ('reset keeps his sign-ins', 'src/computer/browser.ts', [
        ('    rmSync(profileOf(this.#o.dataDir, orb), { recursive: true, force: true });\n', ''),
    ], ['computer-profile.test.ts']),
    ('his browser goes round the proxy', 'src/computer/browser.ts', [
        ('        proxy: { server: proxy.server, bypass: "<-loopback>" },\n', ''),
    ], ['computer.test.ts']),
    ('taken over, he acts anyway', 'src/computer/browser.ts', [
        ('    if (this.#taken.has(orb)) throw new ComputerError("the person has your computer right now: wait until they hand it back");\n', ''),
    ], ['computer.test.ts']),
    ("a field's label words are not read", 'src/computer/browser.ts', [
        ('        return [...labels, ...by, i.getAttribute("aria-label"),', '        return [i.getAttribute("aria-label"),'),
    ], ['computer.test.ts']),
    ("a click's whole label is not read", 'src/computer/tools.ts', [
        ('            covers(clickFloor(asked), clickFloor(label)) && (consents(asked) || !consents(label))', '            true'),
    ], ['computer.test.ts']),
    ('a risky click does not ask', 'src/computer/tools.ts', [
        ('      floor: (a) => clickFloor(s(a.text)),\n', ''),
    ], ['computer.test.ts']),
    ('typing into a page needs no fresh yes', 'src/computer/tools.ts', [
        ('      act: "send", // words leave him for a page: after reading one, a fresh yes (Ash\'s one-way switch)\n', ''),
    ], ['computer.test.ts']),
    ('a field named short of its label is typed into', 'src/computer/tools.ts', [
        ('            covers(fieldFloor(field), fieldFloor(label)) ? null :', '            true ? null :'),
    ], ['computer.test.ts']),
    ('a page that echoes a password is read with it in', 'src/computer/tools.ts', [
        ('  const words = async (text: string): Promise<string> => vault.scrub(text);', '  const words = async (text: string): Promise<string> => text;'),
    ], ['computer.test.ts']),
    ('check_page looks at the web', 'src/computer/tools.ts', [
        ('    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "check_page checks a page you built: one served on this machine (localhost), or a file in your workspace";\n', ''),
    ], ['pagecheck.test.ts']),
    ('check_page reads outside the workspace', 'src/computer/tools.ts', [
        ('          if (!inWorkspace(ctx.workspace, s(a.path))) return { content: `${s(a.path)} is outside your workspace.`, isError: true };\n', ''),
    ], ['pagecheck.test.ts']),
    ('a consent click goes without asking', 'src/rules/guard.ts', [
        ('    const defaultDecision = def.decisionFor?.(args) ?? def.decision;', '    const defaultDecision = def.decision;'),
    ], ['computer.test.ts']),
    ('a password goes to any site', 'src/computer/vault.ts', [
        ('    const here = this.#entries().filter((e) => e.site === host);', '    const here = this.#entries();'),
    ], ['vault.test.ts', 'computer.test.ts']),
    ('a sealed password is not bound to its entry', 'src/computer/vault.ts', [
        ('    c.setAAD(AAD(site, username));\n', ''),
        ('      d.setAAD(AAD(e.site, e.username));\n', ''),
    ], ['vault.test.ts']),
    ('a password is hidden only as written', 'src/computer/vault.ts', [
        ('      for (const form of [p, encodeURIComponent(p), Buffer.from(p, "utf8").toString("base64")]) {', '      for (const form of [p]) {'),
    ], ['vault.test.ts']),
    ('the log says whose password was saved', 'src/computer/vault.ts', [
        ('    this.#o.events.append("vault.saved", { site }); // never the username\'s password, nor the username', '    this.#o.events.append("vault.saved", { site, username });'),
    ], ['vault.test.ts']),
    ('the proxy lets a private address through', 'src/computer/proxy.ts', [
        ('    const c = await checkUrl(`http://${shown}:${port}/`);\n    if (c.ok) return c;', '    const c = { ok: true as const, address: host, reason: shown };\n    if (c.ok) return c;'),
    ], ['computer.test.ts']),
    ('a visual row ticks on its test alone', 'src/plans/board.ts', [
        ('          passed = v.verdict === "pass";', '          passed = true;'),
    ], ['pagecheck.test.ts']),
    ('a visual row starts without its page', 'src/plans/board.ts', [
        ('    if (visual && !named) throw new BoardError(', '    if (visual && !named && false) throw new BoardError('),
    ], ['board.test.ts']),
    ("a row's page may be outside the workspace", 'src/plans/board.ts', [
        ('  return p.startsWith("/") || p.split(/[\\\\/]/).includes("..") ? null : p.replace(/^\\.\\//, "");', '  return p;'),
    ], ['board.test.ts']),
    ("a row's page may be someone else's site", 'src/plans/board.ts', [
        ('      return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(p).hostname) ? p : null;', '      return p;'),
    ], ['board.test.ts']),
    # the first of a kind leads it; his age and his days in the company; let go, he still learns (owner, 10-02)
    ("every orb starts a Junior", "src/inbox.ts", [
        ('level: starts ?? (first ? "Senior" : "Junior")', 'level: starts ?? "Junior"'),
    ], ["levels.test.ts"]),
    ("every orb starts the Senior", "src/inbox.ts", [
        ('level: starts ?? (first ? "Senior" : "Junior")', 'level: starts ?? "Senior"'),
    ], ["levels.test.ts"]),
    ("an orb let go still counts as one of his kind", "src/inbox.ts", [
        ('"SELECT 1 FROM orbs WHERE specialty = ? AND let_go_at IS NULL LIMIT 1"', '"SELECT 1 FROM orbs WHERE specialty = ? LIMIT 1"'),
    ], ["levels.test.ts"]),
    ("the level he was hired at is forgotten", "src/gym/levels.ts", [
        ('  return events.ofType("orb.added").find((e) => e.orb === orb)?.data.level === "Senior" ? "Senior" : "Junior";', '  return "Junior";'),
    ], ["levels.test.ts"]),
    ("his days in the company count from his first hire", "src/gym/levels.ts", [
        ("hired: back?.at ?? orb.createdAt", "hired: orb.createdAt"),
    ], ["levels.test.ts"]),
    ("his age restarts when he is rehired", "src/gym/levels.ts", [
        ("return { born: orb.createdAt,", "return { born: back?.at ?? orb.createdAt,"),
    ], ["levels.test.ts"]),
    ("an orb let go stops learning", "src/gym/night.ts", [
        ("    for (const [orb, left] of away) found.push(", "    for (const [orb, left] of [] as [string, number][]) found.push("),
    ], ["night.test.ts"]),
    ("an orb let go learns on the office's window", "src/gym/night.ts", [
        ("found.push(...findHotPaths(events, { since: left - WINDOW_DAYS * DAY_MS })", "found.push(...findHotPaths(events, { since: clock.now() - WINDOW_DAYS * DAY_MS })"),
    ], ["night.test.ts"]),
    ("the office learns from work of any age", "src/gym/night.ts", [
        ("    const found = findHotPaths(events, { since: clock.now() - WINDOW_DAYS * DAY_MS })", "    const found = findHotPaths(events, { since: 0 })"),
    ], ["night.test.ts"]),
    # lessons on his own canvas: planned in the kit, judged with what it shows (PLAN 4.4)
    ('a lesson goes on past its last step', 'src/lessons.ts', [
        ('    if (c.step >= c.lesson.steps.length) {', '    if (false) {'),
    ], ['lesson.test.ts']),
    ('an unjudged answer counts as right', 'src/lessons.ts', [
        ('    return { correct: j.correct, say: j.say };', '    return { correct: j.correct ?? true, say: j.say };'),
    ], ['lesson.test.ts']),
    ("the kit's model calls go unanswered", 'src/kit.ts', [
        ('      if (!this.#o.sample) throw new Error("the home answers no model calls for the kit here");', '      throw new Error("the home answers no model calls for the kit here");'),
    ], ['lesson.test.ts']),
    ('the canvas runs any script', 'src/api.ts', [
        ('script-src ${hashes.join(" ") || "\'none\'"}', "script-src 'unsafe-inline'"),
    ], ['lesson.test.ts']),
    ('anyone may frame the canvas', 'src/api.ts', [
        ("frame-ancestors 'self'; base-uri 'none'; form-action 'none'", "frame-ancestors *; base-uri 'none'; form-action 'none'"),
    ], ['lesson.test.ts']),
    ('an unjudged answer notes something about you', 'src/lessons.ts', [
        ('    if (j.correct !== null) {', '    if (true) {'),
    ], ['lesson.test.ts']),
    # his voice and his ears, through the door (PLAN 4.3)
    ('a recording of any size is heard', 'src/api.ts', [
        ('const VOICE_CAP = 5 * 1024 * 1024;', 'const VOICE_CAP = 5 * 1024 * 1024 * 1024;'),
    ], ['voice.test.ts']),
    ("his ears listen for anyone's name", 'src/api.ts', [
        ('      return await ask(`voice_${parts[3]}`, { audio, name: who.name });', '      return await ask(`voice_${parts[3]}`, { audio, name: "Ash" });'),
    ], ['voice.test.ts']),
    ('a voice for an orb who is not there', 'src/api.ts', [
        ('    const who = home.inbox.orb(orb);\n    if (!who) throw new HttpError(404, `no orb "${orb}"`);\n    const kit = home.kit;', '    const who = home.inbox.orb(orb) ?? { name: orb };\n    const kit = home.kit;'),
    ], ['voice.test.ts']),
    # his screen and terminal live, your hands on them, his sandbox (PLAN 4.6)
    ("a page standing still stays blank until it paints", 'src/computer/browser.ts', [
        ('    if (now && w.viewers.has(frame)) frame(now);\n', ''),
    ], ['live.test.ts']),
    ('his act does not wait for your hand', 'src/computer/tools.ts', [
        ('        try {\n          await c.waitForHands(ctx.orb, ctx.signal);\n          const r = await c.open(ctx.orb, s(a.url));', '        try {\n          const r = await c.open(ctx.orb, s(a.url));'),
    ], ['live.test.ts']),
    ('a stop does not end his wait', 'src/computer/browser.ts', [
        ('      else signal?.addEventListener("abort", stop, { once: true });', '      else void stop;'),
    ], ['live.test.ts']),
    ('your hands work before you take him over', 'src/computer/browser.ts', [
        ('    if (!this.#taken.has(orb)) throw new ComputerError("take the computer over first");\n    const s = await this.#session(orb);', '    const s = await this.#session(orb);'),
    ], ['live.test.ts']),
    ('an address by your hands is not guarded', 'src/computer/browser.ts', [
        ('      const ok = await checkUrl(h.url);\n      if (!ok.ok) throw new ComputerError(`not opened: ${ok.reason}`);\n', ''),
    ], ['live.test.ts']),
    ('frames go on after the last watcher', 'src/computer/browser.ts', [
        ('      if (w.viewers.size || this.#watches.get(orb) !== w) return;', '      return;'),
    ], ['live.test.ts']),
    ("a command's output reaches you only at its end", 'src/agent/tools.ts', [
        ('      o.onOutput?.(chunk);\n', ''),
    ], ['live.test.ts']),
    ('your terminal works before you take him over', 'src/home.ts', [
        ('    if (!this.computers.takenOver(orb)) throw new Error("take the computer over first");\n    const call = `you-${++this.#yours}`;', '    const call = `you-${++this.#yours}`;'),
    ], ['live.test.ts']),
    ('his sandbox shows what is not his', 'src/computer/sandbox.ts', [
        ('    for (const h of hidden) a.push("--tmpfs", h);\n', ''),
    ], ['live.test.ts']),
    ("his sandbox keeps the home's environment", 'src/computer/sandbox.ts', [
        ('    a.push("--clearenv", ', '    a.push('),
    ], ['live.test.ts']),
    ('his own shell runs outside his sandbox', 'src/agent/tools.ts', [
        ('      return runCommand(s(a.command), ctx.workspace, t, ctx.signal, { wrap: ctx.sandbox, onOutput: ctx.onOutput });', '      return runCommand(s(a.command), ctx.workspace, t, ctx.signal, { onOutput: ctx.onOutput });'),
    ], ['live.test.ts']),
    # the team on its board: claims, agreed changes, asks, the lead, reviews, the chatter (PLAN 5.1, 5.2, 5.4)
    ('two orbs hold the same row', 'src/claims.ts', [
        ('      if (row) throw new ClaimError(', '      if (false) throw new ClaimError('),
    ], ['team-board.test.ts']),
    ('a folder does not hold what is in it', 'src/claims.ts', [
        ('const meets = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);', 'const meets = (a: string, b: string): boolean => a === b;'),
    ], ['team-board.test.ts']),
    ('a silent claim never goes stale', 'src/claims.ts', [
        ('stale: r.finished === null && this.#clock.now() - pulse > STALE_MS', 'stale: false'),
    ], ['team-board.test.ts']),
    ('the log does not replay a recovered claim', 'src/claims.ts', [
        ('      if (c) c.orb = String(e.data.by);', '      if (c) c.orb = c.orb;'),
    ], ['team-board.test.ts']),
    ('a hand-off forgets what changed', 'src/claims.ts', [
        ('    const changed = Object.keys(after).filter((p) => before[p] !== after[p]).sort();', '    const changed: string[] = [];'),
    ], ['team-board.test.ts']),
    ('one orb alone changes the plan', 'src/amendments.ts', [
        ('    if (by === a.proposer) throw new AmendmentError(', '    if (false) throw new AmendmentError('),
    ], ['team-board.test.ts']),
    ('a request of a request of a request goes on', 'src/team-tools.ts', [
        ('        if (depth > DEPTH) return', '        if (false) return'),
    ], ['team-board.test.ts']),
    ('@mentions are not read', 'src/team.ts', [
        ('    const order = named.length ? named : [...members];', '    const order = [...members];'),
    ], ['team-board.test.ts']),
    ('the lead does not speak first', 'src/team.ts', [
        ('    const turns = lead && order.includes(lead) ? [lead, ...order.filter((m) => m !== lead)] : order;', '    const turns = order;'),
    ], ['team-board.test.ts']),
    ("a file another orb claimed is anyone's to write", 'src/agent/tools.ts', [
        ("      return who ? `${s(a.path)} is ${who}'s: it is in what ${who} claimed. Ask ${who}, or claim rows of your own.` : null;", '      return null;'),
    ], ['team-board.test.ts']),
    ("a junior's row ticks without a review", 'src/plans/board.ts', [
        ('        if (passed && REVIEWED.includes(levelOf(ctx.orb)) && parseTabConversation(ctx.conversation)) {', '        if (false) {'),
    ], ['team-board.test.ts']),
    ('a Senior of another kind reviews while his own kind has one', 'src/plans/board.ts', [
        ('  if (them && ofKind.length && me.specialty !== them.specialty) return', '  if (false) return'),
    ], ['team-board.test.ts']),
    ('the chatter leaves a tick out', 'src/chatter.ts', [
        ('          return `Row ${String(d.row)} is done [x]${d.reviewer ? `, reviewed by ${name(d.reviewer)}` : ""}.`;', '          return null;'),
    ], ['team-board.test.ts']),
    ("another orb's board work never reaches the others", 'src/agent/conversation.ts', [
        ('      else if (m.role === "notice" && o.me && m.orb !== o.me && m.meta.board === true) out.push({ role: "user", content: `[Board]: ${m.content}` });\n', ''),
    ], ['team-board.test.ts']),
    ("a session's computer shows anyone its files", 'src/api.ts', [
        ('      if (!s || ![...s.brainstorm, ...s.floor].includes(orb)) throw new HttpError(404,', '      if (!s) throw new HttpError(404,'),
    ], ['team-board.test.ts']),
    # how the org works, a habit passed on, the weekly card, letting go and rehiring, the door's org chart (PLAN 5.4-5.6)
    ('rows go to whoever joined first', 'src/org.ts', [
        ('.sort((a, b) => Number(covers(b)) - Number(covers(a)) || weight(b) - weight(a) || rank(b) - rank(a) || a.createdAt - b.createdAt)', '.sort((a, b) => a.createdAt - b.createdAt)'),
    ], ['org.test.ts']),
    ("a row's files tell nothing of its kind", 'src/org.ts', [
        ('    const a = BY_EXTENSION[m[1]!.toLowerCase()];\n    if (a) return a;', '    const a = undefined;\n    if (a) return a;'),
    ], ['org.test.ts']),
    ('a kind is led by whoever joined last', 'src/org.ts', [
        ('rank(b) - rank(a) || (b.xp ?? 0) - (a.xp ?? 0) || a.createdAt - b.createdAt)) if (!by.has(m.specialty))', 'rank(b) - rank(a) || (b.xp ?? 0) - (a.xp ?? 0) || b.createdAt - a.createdAt)) if (!by.has(m.specialty))'),
    ], ['org.test.ts']),
    ('a junior passes habits on', 'src/org.ts', [
        ('        if (LEVELS.indexOf(me.level) < LEVELS.indexOf("Senior")) return "Mentoring is a Senior\'s: pass habits on once you are one.";\n', ''),
    ], ['org.test.ts']),
    ('a habit passed on stays keyed to its giver', 'src/gym/share.ts', [
        ('const rekey = (s: string, from: string, to: string): string => (s.startsWith(`${from}|`) ? `${to}|${s.slice(from.length + 1)}` : s);', 'const rekey = (s: string, _from: string, _to: string): string => s;'),
    ], ['org.test.ts']),
    ('the gap is not practised first', 'src/gym/night.ts', [
        ('    found.sort((a, b) => gapFirst(a) - gapFirst(b)); // stable: the most approved first, within each\n', ''),
    ], ['org.test.ts']),
    ('an orb away gets a weekly card', 'src/gym/night.ts', [
        ('      if (p.away || !cardDue(events, p.id, { hired: p.hired, now: clock.now() })) continue;', '      if (!cardDue(events, p.id, { hired: p.hired, now: clock.now() })) continue;'),
    ], ['org.test.ts']),
    ('the weekly card comes every night', 'src/gym/performance.ts', [
        ('  return o.now - last >= WEEK_MS;', '  return true;'),
    ], ['org.test.ts']),
    ('his habits go to an orb who is away', 'src/home.ts', [
        ('      if (!to || to.letGoAt !== null || handTo === orb) throw new Error(', '      if (!to) throw new Error('),
    ], ['org.test.ts']),
    ('the org chart names no lead', 'src/api.ts', [
        ('    return { chief, leads: Object.fromEntries(bySpecialty), heads:', '    return { chief, leads: {}, heads:'),
    ], ['org.test.ts']),
    ('a career page leaves his habits out', 'src/api.ts', [
        ('      habits: habitsOf(home.events, home.dataDir, orb).map((h) => {', '      habits: habitsOf(home.events, home.dataDir, "nobody").map((h) => {'),
    ], ['org.test.ts']),
    ('a weekly card is no notice', 'src/notices.ts', [
        ('    } else if (e.type === "performance.card" && e.orb) {', '    } else if (e.type === "performance.card" && e.orb && false) {'),
    ], ['org.test.ts']),
    ('rehiring someone in the office restarts his days in the company', 'src/inbox.ts', [
        ('    if (o.letGoAt === null) return o; // in the office already: his days in the company go on\n', ''),
    ], ['org.test.ts']),
    ('letting an orb go twice hands his habits on twice', 'src/home.ts', [
        ('    if (who && who.letGoAt !== null) return { orb: who, handed }; // gone already: his habits were handed on then, or kept\n', ''),
    ], ['org.test.ts']),
    # a message said aloud, and what he hears over himself (PLAN 4.7)
    ('a message said aloud is answered as if read', 'src/agent/loop.ts', [
        ('        aloud: ctx.items.some((i) => i.data.said === true),', '        aloud: false,'),
    ], ['voice.test.ts']),
    ('the door forgets a message was said', 'src/api.ts', [
        ('{ said: b.said === true }', '{ said: false }'),
    ], ['voice.test.ts']),
    ('every message is taken as said', 'src/inbox.ts', [
        ('o.said ? { data: { said: true } } : {}', '{ data: { said: true } }'),
    ], ['voice.test.ts']),
    ('what you said over him is judged without what he was saying', 'src/api.ts', [
        ('saying: (url.searchParams.get("saying") ?? "").slice(0, 2000)', 'saying: ""'),
    ], ['voice.test.ts']),
    # no orb is a he or a she (owner, 10-03)
    ("an orb is never told that no orb is a he or a she", "src/agent/standing.ts", [
        ("    NO_HE_OR_SHE,\n", ""),
    ], ["voice.test.ts"]),
    # office life (PLAN 5.9): who meets, friendships, lessons on your yes, who fits
    ('office life is on in a test home', 'src/home.ts', [
        ('      on: opts.social?.on ?? false,', '      on: opts.social?.on ?? true,'),
    ], ['social.test.ts']),
    ('the tick never brings orbs together', 'src/home.ts', [
        ("    this.social.due(); // two free orbs meet, in the office's day (PLAN 5.9)\n", ''),
    ], ['social.test.ts']),
    ('the home does not wake for a meeting', 'src/home.ts', [
        ('this.reading.nextAt(), this.social.nextAt(), ', 'this.reading.nextAt(), '),
    ], ['social.test.ts']),
    ('an orb with work waiting meets', 'src/home.ts', [
        ('      free: (orb) => !db.prepare(', '      free: (orb) => true || !db.prepare('),
    ], ['social.test.ts']),
    ('orbs meet at night', 'src/social/social.ts', [
        ('this.#retryAt);\n    if (!inOfficeDay(Math.max(at, this.#clock.now()))) at = nextOpening(Math.max(at, this.#clock.now()));\n', 'this.#retryAt);\n'),
        ('    if (now < this.nextAt()! || !inOfficeDay(now)) return null;', '    if (now < this.nextAt()!) return null;'),
    ], ['social.test.ts']),
    ('a lesson is learned without your yes', 'src/social/social.ts', [
        ('        this.#events.append("social.lesson", { lesson: l.id, from, to, line, names: [nameOf(from), nameOf(to)] });', '        this.#o.learned.add(to, line);\n        this.#events.append("social.lesson", { lesson: l.id, from, to, line, names: [nameOf(from), nameOf(to)] });'),
    ], ['social.test.ts']),
    ('Not now still teaches', 'src/social/social.ts', [
        ('    this.#db.prepare("UPDATE shared_lessons SET state = \'dropped\', settled_at = ? WHERE id = ?").run(this.#clock.now(), id);', '    this.#o.learned.add(l.to_orb, (this.#db.prepare("SELECT line FROM shared_lessons WHERE id = ?").get(id) as { line: string }).line);\n    this.#db.prepare("UPDATE shared_lessons SET state = \'dropped\', settled_at = ? WHERE id = ?").run(this.#clock.now(), id);'),
    ], ['social.test.ts']),
    ('a lesson is offered again', 'src/social/social.ts', [
        ('!theirs.has(l) && !offered.has(`${to}\\0${l}`)', '!theirs.has(l)'),
    ], ['social.test.ts']),
    ('a lesson between orbs who are not friends', 'src/social/rules.ts', [
        ('  if (o.lesson && o.score >= 20) kinds.push', '  if (o.lesson) kinds.push'),
    ], ['social-rules.test.ts']),
    ('traits get on one way only', 'src/social/rules.ts', [
        ('w * (over(a[x]) * over(b[y]) + over(b[x]) * over(a[y]))', 'w * (over(a[x]) * over(b[y]))'),
    ], ['social-rules.test.ts']),
    ('Nerve against Calm does not rub', 'src/social/rules.ts', [
        (' - rub("Nerve", "Calm", 0.9)', ''),
    ], ['social-rules.test.ts']),
    ('the same two meet twice running', 'src/social/rules.ts', [
        ('x !== a && !same(x)', 'x !== a'),
    ], ['social-rules.test.ts']),
    ('the sociable start no more meetings', 'src/social/rules.ts', [
        ('    return 1 + (t.Humour + t.Care + t.Pace) / 30;', '    return t ? 1 : 1;'),
    ], ['social-rules.test.ts']),
    ('a friend is never likelier to be met', 'src/social/rules.ts', [
        ('(x) => 1 + Math.max(0, score(a, x)) / 50', '() => 1'),
    ], ['social-rules.test.ts']),
    ('friendships never move', 'src/social/social.ts', [
        ('    const after = clampScore(before + delta);', '    const after = clampScore(before);'),
    ], ['social.test.ts']),
    ('good friends go unsaid', 'src/social/social.ts', [
        ('      if (before < 50 && after >= 50) this.#events.append("social.friends", { a: x, b: y, names: [nameOf(x), nameOf(y)] });\n', ''),
    ], ['social.test.ts']),
    ("a bet goes without asking", "src/rules/floor.ts", [
        ("|deposit|stake|unstake|bridge|bet|bets|wager|wagers|parlay)$/],", "|deposit|stake|unstake|bridge)$/],"),
    ], ["connectors.test.ts"]),
    # what a request costs (PLAN 1.13) and Orbs' own values (1.14; owner, 10-07)
    ("every orb has every tool again", "src/agent/groups.ts", [
        ('  if (o.specialty === "general" || o.family === null) return new Set(all.map((g) => g.id));', "  return new Set(all.map((g) => g.id));"),
    ], ["tool-groups.test.ts"]),
    ("more_tools loads nothing", "src/agent/loop.ts", [
        ("        loaded.add(g.id);\n", ""),
    ], ["tool-groups.test.ts"]),
    ("a kind used before is not kept to hand", "src/agent/loop.ts", [
        ("      if (g) loaded.add(g.id);\n", ""),
    ], ["tool-groups.test.ts"]),
    ("an older step's page is sent whole", "src/agent/conversation.ts", [
        ("return at < turnAt ? trimOld(r) : at < wholeFrom ? trimStale(r) : r;", "return at < turnAt ? trimOld(r) : r;"),
    ], ["session-cost.test.ts"]),
    ("a step's own pages are cut before it reads them", "src/agent/conversation.ts", [
        ("export const STEPS_WHOLE = 2;", "export const STEPS_WHOLE = 0;"),
    ], ["session-cost.test.ts"]),
    ("an orb stands for nothing", "src/agent/standing.ts", [
        ("    light ? valuesBrief(o.orbName) : valuesFor(o.orbName),\n", ""),
    ], ["values.test.ts"]),
    ("the owner's claims block comes back", "src/brain/constitution.ts", [
        ('  claims: { to: "replaced", by:', '  claims: { to: "core", by:'),
    ], ["values.test.ts"]),
    ("the plans come without how to plan", "src/brain/constitution.ts", [
        ('const PLANNING: When = { groups: ["plans"], tools: ["propose_plan", "plan_templates"] };', 'const PLANNING: When = { tools: ["propose_plan", "plan_templates"] };'),
    ], ["values.test.ts"]),
    ("a search brings no search craft", "src/brain/constitution.ts", [
        ('const SEARCHING: When = { groups: ["reading"], tools: ["web_search", "web_fetch"] };', 'const SEARCHING: When = { groups: ["reading"] };'),
    ], ["values.test.ts"]),
    ("the summary no longer says to go on", "src/agent/conversation.ts", [
        (" (go on from here: the latest request is the one to finish, and what this says is done is done):", ":"),
    ], ["lab.test.ts"]),
    # moments (PLAN 5.19; owner, 10-07: "more micro interactions ... but not too many")
    ("a moment moves no friendship", "src/social/social.ts", [
        ("    const after = clampScore(before + m.delta);", "    const after = clampScore(before);"),
    ], ["social.test.ts"]),
    # both night checks (10-07): either alone keeps the night quiet (nextMomentAt moves a moment due at night to the
    # morning, momentDue refuses one at night), so a defect in one only was no defect at all
    ("orbs run into each other at night", "src/social/social.ts", [
        ("    let at = Math.max(last ? last.at + Math.round(gap) : 0, this.#momentRetryAt);\n    if (!inOfficeDay(Math.max(at, this.#clock.now()))) at = nextOpening(Math.max(at, this.#clock.now()));\n",
         "    let at = Math.max(last ? last.at + Math.round(gap) : 0, this.#momentRetryAt);\n"),
        ("    if (now < this.nextMomentAt()! || !inOfficeDay(now)) return null;\n    const m = this.moment();", "    if (now < this.nextMomentAt()!) return null;\n    const m = this.moment();"),
    ], ["social.test.ts"]),
    ("a moment pulls an orb out of a meeting", "src/social/social.ts", [
        ("    const free = office.map((o) => o.id).filter((id) => this.#o.free(id) && !meeting.has(id));", "    const free = office.map((o) => o.id).filter((id) => this.#o.free(id));"),
    ], ["social.test.ts"]),
    ("moments come every minute", "src/social/social.ts", [
        ("export const MOMENT_GAP_MIN_MS = 6 * MIN;", "export const MOMENT_GAP_MIN_MS = 1 * MIN;"),
    ], ["social.test.ts"]),
    # the board's daily report (PLAN 5.18; owner, 10-07): from 08:00, each idea an orb's, its XP yours to give
    # the numbers behind the home page, as charts (PLAN 2.19; owner, 10-08)
    ("the charts' days end yesterday", "src/stats.ts", [
        ("now.getDate() - (n - 1 - i)", "now.getDate() - (n - i)"),
    ], ["stats.test.ts"]),
    ("a call no orb made goes without a name", "src/stats.ts", [
        ('(id === null ? "No orb" :', '(id === null ? "" :'),
    ], ["stats.test.ts"]),
    ("XP taken back counts as earned", "src/stats.ts", [
        ("      if (amount >= 0) l.earned += amount;\n      else l.lost += -amount;", "      l.earned += Math.abs(amount);"),
    ], ["stats.test.ts"]),
    ("the charts never count the cache", "src/stats.ts", [
        ("      l.cached += num(e.data.cached_tokens);\n", ""),
    ], ["stats.test.ts"]),
    ("the report goes out before 08:00", "src/report.ts", [
        ("    if (this.#making || now < reportTimeOn(now)) return null;", "    if (this.#making) return null;"),
    ], ["report.test.ts"]),
    ("the same orbs pitch every day", "src/report.ts", [
        ("  return [...office].sort((a, b) => lastAsked(a.id) - lastAsked(b.id) || seat(a.id) - seat(b.id)", "  return [...office].sort((a, b) => seat(a.id) - seat(b.id)"),
    ], ["report.test.ts"]),
    ("an approved idea gives its orb no XP", "src/gym/xp.ts", [
        ("        if (e.orb) this.#give(e.orb, XP.ideaApproved, \"an idea you approved from the board's report\", e);\n", ""),
    ], ["report.test.ts"]),
    ("an idea is judged twice", "src/report.ts", [
        ("    if (found.verdict) throw new Error(`that idea is already ${found.verdict}`);\n", ""),
    ], ["report.test.ts"]),
    ("the orbs do not hear the ideas you approved", "src/company.ts", [
        ("  if (o.ideas?.length) lines.push(", "  if (false) lines.push("),
    ], ["report.test.ts"]),
    ("a run that failed counts as a job done", "src/report.ts", [
        ('        if (orb && e.data.outcome === "ok") jobs.set(', "        if (orb) jobs.set("),
    ], ["report.test.ts"]),
    # ideas that fit what the company can spend (PLAN 5.20; owner, 10-08: "the user may not have any money to start with")
    ("a pitch is not told what the company can spend", "src/report.ts", [
        ("    `${budgetLine(o.budget, o)} ${free ?", "    `${free ?"),
    ], ["report.test.ts"]),
    ("an idea that costs more than the company can spend is kept", "src/report.ts", [
        ("  if (start > cap.start || month > cap.month) return", "  if (false) return"),
    ], ["report.test.ts"]),
    ("an idea that does not say what it costs is kept", "src/report.ts", [
        ('  if (start === null || month === null) return "does not say what it costs";', "  if (start === null || month === null) return null;"),
    ], ["report.test.ts"]),
    ("an idea that does not fit is never asked again", "src/report.ts", [
        ("          const again = readPitch(await this.#o.ask(o.id, ", "          const again = null && readPitch(await this.#o.ask(o.id, "),
    ], ["report.test.ts"]),
    ("a cost a month is read as a cost to start", "src/report.ts", [
        ("monthly\\b|\\/m\\b|pm\\b)/.test(after)) month ??= Math.round(top);", "monthly\\b|\\/m\\b|pm\\b)/.test(after)) start ??= Math.round(top);"),
    ], ["report.test.ts"]),
    ("a cost per sale counts against the budget", "src/report.ts", [
        ("(?:sale|order|transaction|user|customer|signup|booking)s?\\b/.test(after)) continue;", "(?:sale|order|transaction|user|customer|signup|booking)s?\\b/.test(after)) void 0;"),
    ], ["report.test.ts"]),
    ("the orbs never hear what the company can spend", "src/company.ts", [
        ("  lines.push(`${budgetLine(o.budget ?? null", "  if (false) lines.push(`${budgetLine(o.budget ?? null"),
    ], ["company.test.ts"]),
    ("the budget is never kept", "src/about.ts", [
        ("    this.#db.prepare(\"INSERT INTO about (key, value, updated_at) VALUES ('budget', ?, ?)", "    if (false) this.#db.prepare(\"INSERT INTO about (key, value, updated_at) VALUES ('budget', ?, ?)"),
    ], ["report.test.ts", "company.test.ts"]),
    ("a budget below nothing is kept", "src/about.ts", [
        ('      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw', '      if (false) throw'),
    ], ["report.test.ts"]),
    ("the door ignores a budget", "src/api.ts", [
        ("      if (b.budget !== undefined) home.about.setBudget(b.budget);\n", ""),
    ], ["report.test.ts"]),
    # the company's board (owner, 10-07): odd, its officers by their posts, everyone's election, proposals voted
    ("the board has an even number of seats", "src/boardroom.ts", [
        ("  const odd = orbs % 2 ? orbs : orbs - 1;", "  const odd = orbs;"),
    ], ["boardroom.test.ts"]),
    ("an orb votes for itself", "src/boardroom.ts", [
        ("      if (c.id === voter.id) continue;\n", ""),
    ], ["boardroom.test.ts"]),
    ("the officers are voted onto the board, not seated by their posts", "src/boardroom.ts", [
        ('  const officers = new Set(["ceo", "assistant", "cfo"].map((s) => officer(office, s)?.id).filter(Boolean));', "  const officers = new Set<string>();"),
    ], ["boardroom.test.ts"]),
    ("a proposal carries without a majority", "src/boardroom.ts", [
        ("    const carried = yes > no;", "    const carried = yes > 0;"),
    ], ["boardroom.test.ts"]),
    ("the board is not elected again when it grows", "src/boardroom.ts", [
        ("if (!last || last.size !== seatsFor(office.length) || ", "if (!last || "),
    ], ["boardroom.test.ts"]),
    ("the orbs do not hear what the board decided", "src/company.ts", [
        ('  if (o.decisions?.length) lines.push(`The board has decided: ${o.decisions.map((d) => `"${d}"`).join("; ")}.`);\n', ""),
    ], ["boardroom.test.ts"]),
    # the company (owner, 10-07): the CEO and your assistant first; each department with its head; the tandem
    ("anyone joins before your CEO", "src/company.ts", [
        ("  if (next && specialty !== next) return `Appoint your ${POST[next]} first", "  if (false && next && specialty !== next) return `Appoint your ${POST[next]} first"),
    ], ["company.test.ts"]),
    ("a department opens without its head", "src/company.ts", [
        ("  if (specialty !== head && !office.includes(head)) return `Hire a ${POST[head]} first", "  if (false) return `Hire a ${POST[head]} first"),
    ], ["company.test.ts"]),
    ("a bill is the assistant's though there is a CFO", "src/home.ts", [
        ("    if (cfo && me) return { id: cfo.id, name: cfo.name };\n", ""),
    ], ["company.test.ts"]),
    ("the CEO is not told it works with your assistant", "src/company.ts", [
        ("send ${F} the result through ${pa ? pa.name : \"the assistant\"} in a few lines", "report when it is done"),
    ], ["company.test.ts"]),
    ("your company's name is not kept", "src/api.ts", [
        ('      if (typeof b.company === "string") home.about.setCompany(b.company);\n', ""),
    ], ["app-door.test.ts", "company.test.ts", "onboarding.test.ts"]),
    ("a department is headed by the wrong post", "src/org.ts", [
        ("bySpecialty.get(HEAD_OF[f]) ?? null", "bySpecialty.get(HEAD_OF.exec) ?? null"),
    ], ["org.test.ts"]),
    # the home page's look at the office (owner, 10-07)
    ("a run never heard to finish counts as work for ever", "src/dashboard.ts", [
        ("filter((r) => now - r.at < STALE_RUN_MS && ids.has(r.orb))", "filter((r) => ids.has(r.orb))"),
    ], ["dashboard.test.ts"]),
    ("an answered card still waits for you", "src/dashboard.ts", [
        ('  for (const e of home.events.ofType("card.resolved")) cards.delete(Number(e.data.card));\n', ""),
    ], ["dashboard.test.ts"]),
    ("XP taken back is not taken off the week", "src/dashboard.ts", [
        ('for (const e of [...home.events.ofType("xp.earned"), ...home.events.ofType("xp.lost")]) {', 'for (const e of home.events.ofType("xp.earned")) {'),
    ], ["dashboard.test.ts"]),
    ("next week comes up as if it were the next two days", "src/dashboard.ts", [
        ("dayOf(today + 2 * DAY_MS))", "dayOf(today + 7 * DAY_MS))"),
    ], ["dashboard.test.ts"]),
    ("an orb let go's work is the office's latest", "src/dashboard.ts", [
        ("recentWork(home.events, null, { limit: 6 }).filter((w) => ids.has(w.orb))", "recentWork(home.events, null, { limit: 6 })"),
    ], ["dashboard.test.ts"]),
    # the lead let go (owner, 10-07): the next one up, the most experienced of a level
    ("the lead goes to who joined first, not the most experienced", "src/org.ts", [
        (" || (b.xp ?? 0) - (a.xp ?? 0) || a.createdAt - b.createdAt)", " || a.createdAt - b.createdAt)"),
    ], ["org.test.ts"]),
    # what every orb wants (owner, 10-07): the top of the office's XP table
    ("an orb does not want to be the best", "src/agent/standing.ts", [
        ("  if (o.ambition) parts.push(o.ambition);\n", ""),
    ], ["org.test.ts"]),
    ("the office's table is upside down", "src/home.ts", [
        ("xp: xp[o.id] ?? 0 })).sort((a, b) => b.xp - a.xp);", "xp: xp[o.id] ?? 0 })).sort((a, b) => a.xp - b.xp);"),
    ], ["org.test.ts"]),
    ("an orb is told it leads when it does not", "src/agent/standing.ts", [
        ("  if (at === 0) return `You lead", "  if (at >= 0) return `You lead"),
    ], ["org.test.ts"]),
    ('an orb does not know its friends', 'src/agent/standing.ts', [
        ('  if (o.colleagues) parts.push(o.colleagues); // its friends and frictions in the office (PLAN 5.9)\n', ''),
    ], ['social.test.ts']),
    ('who fits ignores friendships', 'src/org.ts', [
        (' + gets.get(m.id)!.score * FRIEND_XP;', ';'),
    ], ['social.test.ts']),
    ('friendship outranks the work', 'src/org.ts', [
        ('.sort((a, b) => Number(covers(b)) - Number(covers(a)) || weight(b) - weight(a) ||', '.sort((a, b) => weight(b) - weight(a) || Number(covers(b)) - Number(covers(a)) ||'),
    ], ['social.test.ts']),
    ('any traits are taken', 'src/social/rules.ts', [
        ('    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 40) return null;\n', ''),
    ], ['social-rules.test.ts']),
    # the reading library (PLAN 3.12): robots.txt by the RFC, the manners, the reach, the tools
    ('robots.txt is never consulted', 'src/reading/reading.ts', [
        ('        if (!allowed(rules, pathOf(url))) {', '        if (false) {'),
    ], ['reading.test.ts']),
    ('the first rule found wins, not the longest', 'src/reading/robots.ts', [
        ('if (!best || r.pattern.length > best.pattern.length ||', 'if (!best || r.pattern.length < best.pattern.length ||'),
    ], ['reading-rules.test.ts']),
    ('a tie goes to Disallow', 'src/reading/robots.ts', [
        (' || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;', ') best = r;'),
    ], ['reading-rules.test.ts']),
    ('our own group is never chosen', 'src/reading/robots.ts', [
        ('  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));', '  const chosen = groups.filter((g) => g.agents.includes("*"));'),
    ], ['reading-rules.test.ts']),
    ('$ anchors nothing', 'src/reading/robots.ts', [
        ('  const anchored = pattern.endsWith("$");', '  const anchored = false;'),
    ], ['reading-rules.test.ts']),
    ('the address is compared as it came', 'src/reading/robots.ts', [
        ('  const path = normalizePath(pathAndQuery || "/");', '  const path = pathAndQuery || "/";'),
    ], ['reading-rules.test.ts']),
    ("a site's Crawl-delay is not kept", 'src/reading/reading.ts', [
        ('const delayOf = (r: Robots): number => Math.max(MIN_DELAY_MS, (r.crawlDelay ?? 0) * 1000);', 'const delayOf = (_r: Robots): number => MIN_DELAY_MS;'),
    ], ['reading.test.ts']),
    ('pages are asked with no wait between', 'src/reading/reading.ts', [
        ('    if (wait > 0 && !signal.aborted) await this.#sleep(wait, signal);', '    void wait;'),
    ], ['reading.test.ts']),
    ('the reach is the whole site', 'src/reading/pages.ts', [
        ('(u.pathname.startsWith(reach.prefix) || u.pathname === reach.prefix.slice(0, -1))', 'true'),
    ], ['reading.test.ts']),
    ('the reach is every site', 'src/reading/pages.ts', [
        ('    return u.hostname.toLowerCase() === reach.host && (', '    return ('),
    ], ['reading.test.ts']),
    ('a noindex page is kept', 'src/reading/reading.ts', [
        ('        if (noindex) {', '        if (false) {'),
    ], ['reading.test.ts']),
    ('X-Robots-Tag is not read', 'src/reading/reading.ts', [
        ('const header = headerDirectives(res.headers?.["x-robots-tag"]);', 'const header = headerDirectives(undefined);'),
    ], ['reading.test.ts']),
    ("a nofollow page's links are followed", 'src/reading/reading.ts', [
        ('        if (!nofollow && depth < MAX_DEPTH)', '        if (depth < MAX_DEPTH)'),
    ], ['reading.test.ts']),
    ('a rel=nofollow link is followed', 'src/reading/pages.ts', [
        ('    if ((a.rel ?? "").toLowerCase().split(/\\s+/).includes("nofollow")) continue;\n', ''),
    ], ['reading.test.ts', 'reading-rules.test.ts']),
    ('redirects are followed unchecked', 'src/reading/reading.ts', [
        ('          maxRedirects: 0,\n', ''),
    ], ['reading.test.ts']),
    ('a page is asked again without its ETag', 'src/reading/reading.ts', [
        ('            ...(had?.etag && { "if-none-match": had.etag }),\n', ''),
    ], ['reading.test.ts']),
    ('a 304 is not a read', 'src/reading/reading.ts', [
        ('        if (status === 304 && had) {', '        if (false) {'),
    ], ['reading.test.ts']),
    ("429 does not end a site's read", 'src/reading/reading.ts', [
        ('        if (status === 429 || status === 503) {', '        if (false) {'),
    ], ['reading.test.ts']),
    ('Retry-After is forgotten', 'src/reading/reading.ts', [
        ('const next = Math.max(nextReadAt(now, src.every_days), retryAt ?? 0);', 'const next = nextReadAt(now, src.every_days);'),
    ], ['reading.test.ts']),
    ('a read has no page cap', 'src/reading/reading.ts', [
        ('      while (queue.length && report.asked < PAGES_PER_READ &&', '      while (queue.length && report.asked < PAGES_PER_READ * 4 &&'),
    ], ['reading.test.ts']),
    ('an unreachable robots.txt allows all', 'src/reading/reading.ts', [
        ('      return status === "ok" ? parseRobots(res.body ?? "") : status === "unavailable" ? ALLOW_ALL : DISALLOW_ALL;', '      return status === "ok" ? parseRobots(res.body ?? "") : ALLOW_ALL;'),
    ], ['reading.test.ts']),
    ('a private address is followed', 'src/reading/reading.ts', [
        ('    if (!check.ok) throw new ReadingError(check.reason);\n', ''),
    ], ['reading.test.ts']),
    ('robots.txt is fetched for every read', 'src/reading/reading.ts', [
        ('    const fresh = kept && now - kept.fetched_at <', '    const fresh = false && kept && now - kept.fetched_at <'),
    ], ['reading.test.ts']),
    ('a canonical copy is kept', 'src/reading/reading.ts', [
        ('        if (page.canonical && page.canonical !== url && inReach(page.canonical, reach)) {', '        if (false) {'),
    ], ['reading.test.ts']),
    ('a PDF is kept as text', 'src/reading/reading.ts', [
        ('        const kind = isText(ct, res.body ?? "");', '        const kind = isText(ct, res.body ?? "") ?? "text";'),
    ], ['reading.test.ts']),
    ("the library's search is not fenced", 'src/reading/tools.ts', [
        ('      describe: (a) => `search the reading library for "${s(a.query)}"`,\n      decision: "allow",\n      untrusted: "page",', '      describe: (a) => `search the reading library for "${s(a.query)}"`,\n      decision: "allow",'),
    ], ['reading.test.ts']),
    ('web_search says nothing of the library', 'src/reading/tools.ts', [
        ('      return hint ? { ...out, content: `${out.content}\\n\\n${hint}` } : out;', '      return hint ? out : out;'),
    ], ['reading.test.ts']),
    ("the home does not wake for the night's read", 'src/home.ts', [
        ('this.recruiter.nextAt(), this.reading.nextAt(), this.social.nextAt(), ', 'this.recruiter.nextAt(), this.social.nextAt(), '),
    ], ['reading.test.ts']),
    ('the tick never reads', 'src/home.ts', [
        ("    void this.reading.due(); // the reading library's next read, one at a time (PLAN 3.12)\n", ''),
    ], ['reading.test.ts']),
    ('a first read is a notice', 'src/notices.ts', [
        ('    } else if (e.type === "reading.read" && e.orb && !e.data.first) {', '    } else if (e.type === "reading.read" && e.orb) {'),
    ], ['reading.test.ts']),
    ("an unfollowed source's pages stay", 'src/reading/reading.ts', [
        ('      this.#db.prepare("DELETE FROM reading_pages WHERE source = ?").run(id);\n', ''),
    ], ['reading.test.ts']),
    # the recruiter: positions, applicants, an interview, hire and pass (PLAN 5.8)
    ("All ticks only the first position", "src/recruiter.ts", [
        ("      for (const specialty of new Set(specialties)) {", "      for (const specialty of new Set(specialties.slice(0, 1))) {"),
    ], ["recruiter.test.ts"]),
    ("a wrong name in the list still changes the rest", "src/recruiter.ts", [
        ('    for (const s of specialties) if (!(s in SPECIALTY_FAMILIES)) throw new RecruiterError(`"${s}" is not a kind of work`);\n', ""),
    ], ["recruiter.test.ts"]),
    ("an unticked position's applicants stay in sight", 'src/recruiter.ts', [
        ('      .filter((r) => open.has(r.specialty))', '      .filter(() => true)'),
    ], ['recruiter.test.ts']),
    ('every look brings new applicants', 'src/recruiter.ts', [
        ("        if (today > 0) continue; // today's came already\n", ''),
    ], ['recruiter.test.ts']),
    ('applicants never take other jobs', 'src/recruiter.ts', [
        ('now - WAIT_DAYS * DAY_MS', 'now - 1000 * DAY_MS'),
    ], ['recruiter.test.ts']),
    # the list turns over once a day (owner, 10-06)
    ("yesterday's applicants stay through the day's turn", 'src/recruiter.ts', [
        ('(created_at <= ? OR (day < ? AND id NOT IN (SELECT applicant FROM interviews)))', '(created_at <= ? OR (day < ? AND 0))'),
    ], ['recruiter.test.ts']),
    ('an applicant you began to interview leaves at the turn', 'src/recruiter.ts', [
        ('(day < ? AND id NOT IN (SELECT applicant FROM interviews))', '(day < ?)'),
    ], ['recruiter.test.ts']),
    ("the list turns over only when someone looks", 'src/home.ts', [
        ('    this.recruiter.due(); // the Recruiter\'s list turns over at midnight (PLAN 5.8)\n', ''),
    ], ['recruiter.test.ts']),
    ("the home does not wake for the day's turn", 'src/home.ts', [
        ('this.school.nextAt(), this.recruiter.nextAt(), this.reading', 'this.school.nextAt(), this.reading'),
    ], ['recruiter.test.ts']),
    ('an applicant is told it may use tools', 'src/recruiter.ts', [
        ('    "You have no tools and no computer yet: you can only talk. Do not offer to do work before you are hired, and never claim to have done something.",\n', ''),
    ], ['recruiter.test.ts']),
    ('an interview forgets what was said', 'src/home.ts', [
        ('[{ role: "system", content: interviewSystem(who) }, ...before, { role: "user", content: said }]', '[{ role: "system", content: interviewSystem(who) }, { role: "user", content: said }]'),
    ], ['recruiter.test.ts']),
    ('an interview costs nothing', 'src/home.ts', [
        ('    this.spend.record({ tier: "big", model: ep.model, costUsd: res.costUsd, costSource: res.costSource, promptTokens: res.promptTokens, completionTokens: res.completionTokens });\n    const answer = res.text.trim() || "…";', '    const answer = res.text.trim() || "…";'),
    ], ['recruiter.test.ts']),
    ("a hired orb's interview is lost", 'src/home.ts', [
        ('    for (const m of this.recruiter.interview(applicant)) {', '    for (const m of this.recruiter.interview(applicant).slice(0, 0)) {'),
    ], ['recruiter.test.ts']),
    ('the first of a kind would start a Junior', 'src/home.ts', [
        ('const startsAs = (s: string): Level => (office.some((o) => o.specialty === s) ? "Junior" : "Senior");', 'const startsAs = (s: string): Level => "Junior";'),
    ], ['recruiter.test.ts']),
    ('the least qualified applies first', 'src/home.ts', [
        ('.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.diplomas.length - a.diplomas.length || b.xp - a.xp);', '.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.diplomas.length - b.diplomas.length || a.xp - b.xp);'),
    ], ['recruiter.test.ts']),
    ('a let-go orb of any kind applies again', 'src/home.ts', [
        ('.filter((o) => o.letGoAt !== null && positions.includes(o.specialty))', '.filter((o) => o.letGoAt !== null)'),
    ], ['recruiter.test.ts']),
    ('a hired applicant can be hired again', 'src/recruiter.ts', [
        ('"SELECT id, specialty, seed, day, created_at FROM applicants WHERE id = ? AND state = \'waiting\'"', '"SELECT id, specialty, seed, day, created_at FROM applicants WHERE id = ?"'),
    ], ['recruiter.test.ts']),
    ('a hired applicant comes without its look', 'src/home.ts', [
        ('const made = this.inbox.addOrb(orb.id, orb.name, a.specialty, orb.look);', 'const made = this.inbox.addOrb(orb.id, orb.name, a.specialty, {});'),
    ], ['recruiter.test.ts']),
    # school: a term, its classes, its exam and its diplomas (PLAN 5.7)
    ('a note is kept that did not raise the exam', 'src/school/school.ts', [
        ('(s.kept_score === null || score > s.kept_score)', '(s.kept_score === null || score >= s.kept_score)'),
    ], ['school.test.ts']),
    ("a lesson keeps the exam's questions", 'src/school/school.ts', [
        ('    lesson = withoutExam(lesson, exam);\n', ''),
    ], ['school.test.ts']),
    ('the practice is the exam', 'src/school/school.ts', [
        ('if (s.kind === "maths") return mathsPractice(s.seed + done + 1, exam, 3);', 'if (s.kind === "maths") return exam.slice(0, 3);'),
    ], ['school.test.ts']),
    ('a diploma at the mark once', 'src/school/school.ts', [
        ('last.length === 2 && last.every((x) => x.score! >= mark)', 'last.length >= 1 && last.slice(-1).every((x) => x.score! >= mark)'),
    ], ['school.test.ts']),
    ('a diploma promotes', 'src/school/school.ts', [
        ('      this.#events.append("school.graduated", { subject: s.id, name: s.name, kind: s.kind, score: kept }, { orb });\n', '      this.#events.append("school.graduated", { subject: s.id, name: s.name, kind: s.kind, score: kept }, { orb });\n      this.#events.append("orb.promoted", { from: "Senior", to: "Staff" }, { orb });\n'),
    ], ['school.test.ts']),
    ('Talking with you does not wait for your thumbs', 'src/school/school.ts', [
        ('    if (s.kind === "talking") return { answers: list.map((a) => ({ ...a, up: null })), score: null, state: "waiting" };\n', ''),
    ], ['school.test.ts']),
    ('a missing verdict counts as no', 'src/school/school.ts', [
        ('    if (judged.some((v) => v === null)) return { answers: list, score: null, state: "void" };\n', ''),
    ], ['school.test.ts']),
    ('a thumb on a graded sitting is taken', 'src/school/school.ts', [
        ('if (!row || row.state !== "waiting") throw', 'if (!row) throw'),
    ], ['school.test.ts']),
    ('school takes the whole night', 'src/school/school.ts', [
        ('if (!stopped && this.#asked >= share) stopped', 'if (false) stopped'),
    ], ['school.test.ts']),
    ("one orb's subjects take the night first", 'src/school/school.ts', [
        ('const queue = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => (l[i] ? [l[i]] : []))).flat();', 'const queue = lists.flat();'),
    ], ['school.test.ts']),
    ("a term's end leaves answers waiting for thumbs", 'src/school/school.ts', [
        ('      this.#db.prepare("UPDATE school_sittings SET state = \'void\' WHERE state = \'waiting\' AND subject IN (SELECT id FROM school_subjects WHERE term = ?)").run(t.id);\n', ''),
    ], ['../../app/test/school-view.test.ts']),
    ('rehiring leaves the term open', 'src/home.ts', [
        ('    this.school.end(orb, "rehired");\n', ''),
    ], ['school.test.ts']),
    ('an orb in the office goes to school', 'src/home.ts', [
        ('    if (o.letGoAt === null) throw new SchoolError(`only an orb you let go goes to school: ${o.name} is in the office`);\n', ''),
    ], ['school.test.ts']),
    ('a class past the spend cap goes on', 'src/home.ts', [
        ('      ask: async (who, orb, messages, maxTokens) => {\n        this.spend.check();\n', '      ask: async (who, orb, messages, maxTokens) => {\n'),
    ], ['school.test.ts']),
    ('the notebook stays at school', 'src/agent/standing.ts', [
        ('if (!cut && o.notebook?.length) parts.push(', 'if (false && o.notebook?.length) parts.push('),
    ], ['school.test.ts']),
    ('a diploma counts for any row', 'src/org.ts', [
        ('diplomas(m.id).find((d) => inSubject(text, d.kind, d.name)) ?? null', 'diplomas(m.id)[0] ?? null'),
    ], ['school.test.ts']),
    ('a diploma counts for nothing', 'src/org.ts', [
        ('(studied.get(m.id) ? DIPLOMA_XP : 0)', '0'),
    ], ['school.test.ts']),
    ("the door's thumb marks another answer", 'src/api.ts', [
        ('home.school.thumb(Number(parts[2]), Number(parts[4]), b.up === true);', 'home.school.thumb(Number(parts[2]), Number(parts[4]) + 1, b.up === true);'),
    ], ['school.test.ts']),
    # sessions that cost little and say little (PLAN 5.10, owner 10-06)
    ('every orb takes a whole turn again (10-06: five full turns a message)', 'src/team.ts', [
        ('role: named.length || i === 0 ? "lead" : "chime"', 'role: "lead" as const'),
    ], ['team.test.ts']),
    ('a chime-in is handed every tool', 'src/agent/loop.ts', [
        ('toolSpecs(role === "chime" ? [] : this.#toolsFor(loaded))', 'toolSpecs(this.#toolsFor(loaded))'),
    ], ['team.test.ts']),
    ('a pass is posted as a reply', 'src/agent/loop.ts', [
        ('if (role === "chime" && (isPass(r.text) || !r.text.trim())) {', 'if (role === "chime" && !r.text.trim()) {'),
    ], ['team.test.ts']),
    ('a chime-in reads the whole history, calls and results', 'src/agent/loop.ts', [
        ('talk: role === "chime", brief: role === "asked" })];', 'talk: false, brief: role === "asked" })];'),
    ], ['team.test.ts']),
    ('an approved session plan is not dealt (10-06: Ash took all nine rows)', 'src/home.ts', [
        ('        this.#deal(card, plan);\n', ''),
    ], ['session-cost.test.ts']),
    ('rows dealt to the best fit, however many it has', 'src/team.ts', [
        ('const to = ranked.find((m) => out[m]!.length < floor || (out[m]!.length < share && over > 0))!;', 'const to = ranked[0]!;'),
    ], ['session-cost.test.ts']),
    ('claim_rows takes any number of rows', 'src/team-tools.ts', [
        ('if (members.length > 1 && would.size > share) {', 'if (false) {'),
    ], ['session-cost.test.ts']),
    ("an earlier turn's results go to the model whole", 'src/agent/conversation.ts', [
        ('return at < turnAt ? trimOld(r) : at < wholeFrom', 'return at < turnAt ? r : at < wholeFrom'),
    ], ['session-cost.test.ts']),
    ("a request to another orb begins this orb's turn", 'src/agent/conversation.ts', [
        ('m.role === "user" && (m.meta.asked === undefined || m.meta.asked === o.me));', 'm.role === "user");'),
    ], ['session-cost.test.ts']),
    ('a deleted session keeps its chats', 'src/team.ts', [
        ('        this.#db.prepare("DELETE FROM messages WHERE conversation = ?").run(conversation);\n', ''),
    ], ['session-cost.test.ts']),
    ("a deleted session's last run writes after it is gone", 'src/team.ts', [
        ('await Promise.all(TABS.map((tab) => this.#inbox.drop(tabConversation(id, tab))));', 'void Promise.all(TABS.map((tab) => this.#inbox.drop(tabConversation(id, tab))));'),
    ], ['session-cost.test.ts']),
    # what changes from run to run, after the conversation on the plan (owner, 10-07: "cut token costs ... while still
    # keeping the current flow and logic")
    ('the note before the conversation, on the plan', 'src/agent/loop.ts', [
        ('      if (after) messages.push({ role: "system", content: after });', '      if (after) messages.splice(1, 0, { role: "system", content: after });'),
    ], ['chatgpt.test.ts']),
    ('the note in the instructions on the plan too', 'src/agent/loop.ts', [
        ('const after = ep.plan === "chatgpt" ? note : null;', 'const after = null as string | null;'),
    ], ['chatgpt.test.ts']),
    ('another brain reads the note before its instructions', 'src/agent/loop.ts', [
        ('const system = [standing, after ? null : note, own?.system ?? null]', 'const system = [after ? null : note, standing, own?.system ?? null]'),
    ], ['chatgpt.test.ts']),
    ('the place on the XP table in the instructions, the wish gone', 'src/agent/loop.ts', [
        ('ambition: this.#o.ambition ? AMBITION : null,', 'ambition: this.#o.ambition?.(ctx.orb) ?? null,'),
    ], ['chatgpt.test.ts']),
    ('the plan is sent no cache key', 'src/agent/loop.ts', [
        ('brief: role === "chime", cacheKey },', 'brief: role === "chime" },'),
    ], ['chatgpt.test.ts']),
    ("every conversation of an orb shares one cache key", 'src/agent/loop.ts', [
        ('.update(`${ctx.orb}\\u0000${ctx.conversation}`)', '.update(ctx.orb)'),
    ], ['chatgpt.test.ts']),
    ("the cache key carries the orb's and the conversation's names", 'src/agent/loop.ts', [
        ('const cacheKey = createHash("sha256").update(`${ctx.orb}\\u0000${ctx.conversation}`).digest("hex").slice(0, 32);', 'const cacheKey = `${ctx.orb}:${ctx.conversation}`;'),
    ], ['chatgpt.test.ts']),
    ('a refused cache key fails the turn', 'src/agent/responses.ts', [
        ('  if (field && field in asked) {', '  if (field && field in BRIEF_FIELDS) {'),
    ], ['chatgpt.test.ts']),
    # what the brains cost, read back (PLAN 1.16)
    ('the cache is said to serve all that was read', 'src/brain/cost.ts', [
        ('      l.cached += count(r.data.cached_tokens);', '      l.cached += count(r.data.prompt_tokens);'),
    ], ['cost.test.ts']),
    ('every call is counted as a chat', 'src/brain/cost.ts', [
        ('const kind = typeof r.data.turn === "string" ? r.data.turn : r.conversation ? "chat" : "other";', 'const kind = "chat";'),
    ], ['cost.test.ts']),
    ("the probe says served without its control", 'src/brain/cost.ts', [
        ('const served = !failed && again.cached > control.cached && again.cached > first.cached;', 'const served = !failed && again.cached > first.cached;'),
    ], ['cost.test.ts']),
    ("the probe's control asks what the repeat asked", 'src/brain/cost.ts', [
        ('const control = await ask(text(tag()));', 'const control = await ask(same);'),
    ], ['cost.test.ts']),
    ('a chime-in carries the big constitution', 'src/brain/constitution.ts', [
        ('if (!(o.mini ? MINI.includes(s.key) : loads(SECTION_MAP[s.key], o.specialty, o)) || !s.body) continue;', 'if (!loads(SECTION_MAP[s.key], o.specialty, o) || !s.body) continue;'),
    ], ['session-cost.test.ts']),
    ("a stream error's code read only at its top (10-06)", 'src/agent/responses.ts', [
        ('errorOf({ code: e.code ?? e.error?.code, type: e.error?.type, message: e.message ?? e.error?.message })', 'errorOf({ code: e.code, message: e.message })'),
    ], ['chatgpt.test.ts']),
    ("one model's usage limit pauses the whole plan", 'src/chatgpt/chatgpt.ts', [
        ('      if (this.#model(false) || this.#model(true)) return; // another model of the plan still answers\n', ''),
    ], ['chatgpt.test.ts']),
    ('the first-listed flagship is the default', 'src/chatgpt/chatgpt.ts', [
        ('this.#reg.model = defaultMain(models);', 'this.#reg.model = models[0]?.slug ?? null;'),
    ], ['chatgpt.test.ts']),
    ('helpers run on the main model', 'src/home.ts', [
        ('endpoint: (o) => (o?.light ? this.lightBrain() : ', 'endpoint: (o) => (false ? this.lightBrain() : '),
    ], ['chatgpt.test.ts']),
    ('a chime-in thinks and talks at length', 'src/agent/responses.ts', [
        ('{ ...(body.brief && BRIEF_FIELDS), ...(body.cacheKey', '{ ...(body.cacheKey'),
    ], ['chatgpt.test.ts']),
    ('a field the plan refuses fails the turn', 'src/agent/responses.ts', [
        ('  if (field && field in asked) {', '  if (false) {'),
    ], ['chatgpt.test.ts']),
    # Ash's guards and recitation (owner, 10-07)
    ("a reply may repeat one sentence forever", "src/agent/loopguard.ts", [
        ("    if (this.#run.n >= RUN) return this.#trip(\"run\", sentence, this.#run.n, key);\n", ""),
    ], ["guards.test.ts"]),
    ("a cycle of two sentences goes on", "src/agent/loopguard.ts", [
        ("    if (this.#history.length >= WINDOW_MIN && new Set(this.#history).size <= DISTINCT) {", "    if (false) {"),
    ], ["guards.test.ts"]),
    ("a code block can trip the guard", "src/agent/loopguard.ts", [
        ("    if (was || this.#fence) return null;\n", ""),
    ], ["guards.test.ts"]),
    ("a looped reply is kept whole", "src/agent/loop.ts", [
        ("        const kept = r.text.slice(0, t.cutAt).trim();", "        const kept = r.text.trim();"),
    ], ["guards.test.ts"]),
    ("a repeated call says nothing", "src/agent/loop.ts", [
        ("      if (times > 1 && !result.isError) {", "      if (false) {"),
    ], ["guards.test.ts"]),
    ("a repeating turn never ends", "src/agent/loop.ts", [
        ("      if (times >= REPEAT_LIMIT) {", "      if (false) {"),
    ], ["guards.test.ts"]),
    ("the plan is never restated", "src/agent/loop.ts", [
        ("      if (recital) messages.push({ role: \"system\", content: recital });\n", ""),
    ], ["guards.test.ts"]),
    ("a finished plan is still restated", "src/plans/recite.ts", [
        ("    if (!open.length) continue;\n", ""),
    ], ["guards.test.ts"]),
    ("another orb's rows are restated to it", "src/plans/recite.ts", [
        ("if (c.orb === o.orb) mine.set", "if (c.plan) mine.set"),
    ], ["guards.test.ts"]),
    ("the restatement goes in the instructions, first", "src/agent/responses.ts", [
        ("    if (m.role === \"system\" && input.length) input.push", "    if (false) input.push"),
    ], ["guards.test.ts"]),
    ("a reply written only in reasoning is shown as nothing", "src/agent/loop.ts", [
        ("        r.text = `${REASONING_SALVAGE_MARK}\\n\\n${r.reasoning.trim()}`;\n", ""),
    ], ["guards.test.ts"]),
    ("the model is never asked to write its reply", "src/agent/loop.ts", [
        ("          nudge = REASONING_NUDGE;", "          nudge = null;"),
    ], ["guards.test.ts"]),
    ("condensing swallows everything at once", "src/agent/loop.ts", [
        ("    const section = parts < MAX_PARTS;", "    const section = false;"),
    ], ["survive.test.ts"]),
    ("the parts pile up and are never folded", "src/agent/loop.ts", [
        ("    const section = parts < MAX_PARTS;", "    const section = true;"),
    ], ["survive.test.ts"]),
    ("a part's summary goes missing from what the model reads", "src/agent/conversation.ts", [
        ("    return [...(whole ? [whole] : []), ...parts, ...live.filter", "    return [...(whole ? [whole] : []), ...live.filter"),
    ], ["survive.test.ts"]),
    # the career page's growth (owner, 10-07)
    ("an exchange of ideas records nothing of what was said", "src/social/social.ts", [
        ("      const ideas = kind === \"ideas\" ? [x, y].map", "      const ideas = false ? [x, y].map"),
    ], ["social.test.ts"]),
    ("a pass counts as work", "src/worklog.ts", [
        ("    if (!s || NOT_WORK.test(s)) continue;", "    if (!s) continue;"),
    ], ["social.test.ts"]),
    # the team's notes on what it read (owner, 10-07)
    ("a teammate reads the same page again", "src/agent/tools.ts", [
        ("      if (notes && kept && kept.by !== ctx.orb) {", "      if (false) {"),
    ], ["notes.test.ts"]),
    ("a page read in a session is never kept for the team", "src/agent/tools.ts", [
        ("      if (notes && !out.isError && !out.stoppedByUser) notes.keepPage(s(a.url), ctx.orb, out.content);\n", ""),
    ], ["notes.test.ts"]),
    ("a note is written again for every teammate", "src/agent/tools.ts", [
        ("        const note = kept.note ?? (ctx.summarize", "        const note = (ctx.summarize"),
    ], ["notes.test.ts"]),
    ("an orb is handed a note on its own reading", "src/agent/tools.ts", [
        ("      if (notes && kept && kept.by !== ctx.orb) {", "      if (notes && kept) {"),
    ], ["notes.test.ts"]),
    ("a page a day old is served from the notes", "src/notes.ts", [
        ("    if (this.#now() - head.at > FRESH_MS) return null; // the home's clock, not the file's\n", ""),
    ], ["notes.test.ts"]),
    ("a chat with one orb keeps team notes", "src/agent/loop.ts", [
        ("      ...(parseTabConversation(ctx.conversation) && {\n        teamNotes:", "      ...(true && {\n        teamNotes:"),
    ], ["notes.test.ts"]),
    ("an asked orb reads the whole session (Ash: a subagent sees only its brief)", "src/agent/conversation.ts", [
        ("    if (o.brief && o.me) {", "    if (false) {"),
    ], ["session-cost.test.ts"]),
    ("any number of orbs work on asks at once", "src/team.ts", [
        ("    if (busy.size >= MAX_ASKED) throw", "    if (false) throw"),
    ], ["session-cost.test.ts"]),
    ("Gemini's thought signatures are dropped (10-06)", 'src/agent/stream.ts', [
        ('tool_calls: m.tool_calls.map(({ sig, ...c }) => (gemini ? { ...c, extra_content: { google: { thought_signature: sig ?? FOREIGN_SIGNATURE } } } : c)),', 'tool_calls: m.tool_calls.map(({ sig: _sig, ...c }) => c),'),
    ], ['brains.test.ts']),
    ("Gemini's own signature is never kept", 'src/agent/stream.ts', [
        ('          if (typeof sig === "string" && sig) c.sig = sig;\n', ''),
    ], ['brains.test.ts']),
    ('a light turn on Gemini stays on the flash', 'src/brain/brains.ts', [
        ('return ep.chain === "gemini" && lite ? { ...ep, model: lite } : ep;', 'return ep;'),
    ], ['brains.test.ts']),
]

# the app (PLAN 2.x): paths are inside packages/app
APP_MUTANTS: list[tuple[str, str, list[tuple[str, str]], list[str]]] = [
    # the living orb's moods (PLAN 2.3)
    ("your no makes him hop", "src/orb/mood.ts", [
        ('        return d.status === "denied" ? "pout"', '        return d.status === "denied" ? "hop"'),
    ], ["mood.test.ts"]),
    ("a run outranks a card waiting for you", "src/orb/mood.ts", [
        ('    if (this.#cards.size) return "waiting";\n    if (this.#runs.size) return this.#tool ? "working" : "thinking";', '    if (this.#runs.size) return this.#tool ? "working" : "thinking";\n    if (this.#cards.size) return "waiting";'),
    ], ["mood.test.ts"]),
    ("another orb's news moves his mood", "src/orb/mood.ts", [
        ("    if (e.orb !== this.#orb) return null;\n", ""),
    ], ["mood.test.ts"]),
    ("he sleeps at noon", "src/orb/mood.ts", [
        ("  return h >= 23 || h < 6;", "  return h >= 0;"),
    ], ["mood.test.ts"]),
    # the brains in Settings (PLAN 1.11)
    ("the brains panel shows no order", "src/rooms/Brains.tsx", [
        ("        {(now?.order ?? []).map((b, i) => (", "        {(now ? [] : []).map((b: BrainsNow[\"order\"][number], i: number) => ("),
    ], ["brains.test.ts"]),
    ("a key stays on the page after it is kept", "src/rooms/Brains.tsx", [
        ("        if (draft.trim()) save(draft.trim());\n        setDraft(\"\");", "        if (draft.trim()) save(draft.trim());"),
    ], ["brains.test.ts"]),
    ("every listener opens its own stream", "src/home/link.ts", [
        ("      return watch(on);", "      return sharedStream()(on);"),
    ], ["notices.test.ts"]),
    ("his card says Junior whatever he is", "src/orbs.tsx", [
        ('`${standing?.level ?? startsAs ?? "Junior"} · ', '`${"Junior"} · '),
    ], ["morning.test.ts"]),
    ("the side menu shows no mood", "src/orbs.tsx", [
        ('                  {moods[idOf(c.name)] && moods[idOf(c.name)] !== "idle" && (', "                  {false && ("),
    ], ["notices.test.ts"]),
    ("a card already waiting is not his mood when the page opens", "src/orb/useMood.ts", [
        ('    for (const n of ns) if (n.kind === "approval" && n.card !== null) machines.get(n.orb)?.hear(', '    for (const n of ns) if (n.kind === "never" && n.card !== null) machines.get(n.orb)?.hear('),
    ], ["notices.test.ts"]),
    ("your message never says what you gave him", "src/rooms/Talk.tsx", [
        ("...given.map((p) => `[Attached: ${p}]`)", "...given.map(() => \"\")"),
    ], ["attach.test.ts"]),
    # the schedule editor (PLAN 2.4)
    ("the editor's preview is not the home's", "src/rooms/ScheduleEditor.tsx", [
        ("      o.home.schedulePreview(rule).then(", '      Promise.resolve({ words: "Every day at 09:00", next: [] as number[] }).then('),
    ], ["schedule-editor.test.ts"]),
    ("the editor offers every 5 minutes", "src/rooms/ScheduleEditor.tsx", [
        ("  ...[15, 20, 30].map((n) =>", "  ...[5, 15, 20, 30].map((n) =>"),
    ], ["schedule-editor.test.ts"]),
    ("a schedule cannot be removed from its day", "src/rooms/Calendar.tsx", [
        ("act(home.removeSchedule(e.id))", "act(Promise.resolve())"),
    ], ["schedule-editor.test.ts"]),
    # the app's way in from other devices (PLAN 2.7)
    ("the opening screen offers no passkey sign-in", "src/ui/Splash.tsx", [
        ("              {signIn && /not signed in/.test(why) && (", "              {signIn && why === \"never\" && ("),
    ], ["devices.test.ts"]),
    ("Settings shows no devices", "src/rooms/Settings.tsx", [
        ("      {o.home && <Devices home={o.home} />}", "      {o.home && null}"),
    ], ["devices.test.ts"]),
    ("a passkey is sent without what its authenticator made", "src/home/link.ts", [
        ("attestationObject: b64u(r.attestationObject) }", "attestationObject: b64u(r.clientDataJSON) }"),
    ], ["devices.test.ts"]),
    ("a phone's QR code is of another link", "src/rooms/Devices.tsx", [
        ("<QrCode text={link} size={200}", "<QrCode text={`${link}x`} size={200}"),
    ], ["devices.test.ts"]),
    # your connections in Settings (PLAN 4.2)
    ("Settings shows no connections", "src/rooms/Settings.tsx", [
        ("      {o.home && <Connections home={o.home} />}", "      {o.home && null}"),
    ], ["connections.test.ts"]),
    ("a connector's secret goes in its spec, not the keychain", "src/rooms/Connections.tsx", [
        ("{ spec: { command, args, env: { [m[1]!]: { secret: m[1]!.toLowerCase() } } }, secrets: { [m[1]!.toLowerCase()]: m[2]! } }", "{ spec: { command, args, env: { [m[1]!]: m[2]! } }, secrets: {} }"),
    ], ["connections.test.ts"]),
    ("a mail server on this machine is asked for TLS", "src/rooms/Connections.tsx", [
        ("...(/^(127\\.0\\.0\\.1|localhost|::1)$/.test(host) && { tls: false })", "...(host === \"\" && { tls: false })"),
    ], ["connections.test.ts"]),
    ("a calendar's address stays on the page once it is kept", "src/rooms/Connections.tsx", [
        ("() => setCal({ label: \"\", address: \"\" })", "() => setCal((c) => ({ ...c, label: \"\" }))"),
    ], ["connections.test.ts"]),
    ("your calendar's events can be moved like his reminders", "src/rooms/Calendar.tsx", [
        ('                {e.kind !== "event" && <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>', '                {<span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>'),
    ], ["connections.test.ts"]),
    ("a catalog program floats to its latest release", "src/home/catalog.ts", [
        ("npx -y @modelcontextprotocol/server-filesystem@2026.8.31 /path", "npx -y @modelcontextprotocol/server-filesystem /path"),
    ], ["catalog.test.ts"]),
    ("the pin check passes anything", "src/home/catalog.ts", [
        ("  if (!pkg) return false;", "  if (pkg !== undefined || !pkg) return true;"),
    ], ["catalog.test.ts"]),
    ("Notifications never shows your day", "src/rooms/Notices.tsx", [
        ('      {today && "brief" in today && <YourDayCard day={today} go={o.go} />}', '      {today && "brief" in today && null}'),
    ], ["connections.test.ts"]),
    # the opening story's music (owner, 10-02)
    ("the music plays out of key", "src/ui/music.ts", [
        ("  { root: 34, tones: [58, 62, 65] }, // B flat", "  { root: 34, tones: [58, 61, 65] }, // B flat"),
    ], ["music.test.ts"]),
    ("the music never loops", "src/ui/music.ts", [
        ("  const looped = n < INTRO_BARS ? n : INTRO_BARS + ((n - INTRO_BARS) % LOOP_BARS);", "  const looped = n;"),
    ], ["music.test.ts"]),
    ("the music plays with the sounds off", "src/ui/music.ts", [
        ("  if (running || !soundsOn()) return;", "  if (running) return;"),
    ], ["onboarding.test.ts"]),
    ("the music plays on after the story", "src/onboarding/Onboarding.tsx", [
        ("    stopMusic();\n    onDone(", "    onDone("),
        ("  useEffect(() => () => stopMusic(), []); // the story over: it fades out\n", ""),
    ], ["onboarding.test.ts"]),
    # themes besides light and dark (owner, 10-02)
    ("a chosen theme is overridden by the system's", "src/design/tokens.ts", [
        ("    `@media (prefers-color-scheme: light) { :root:not([data-theme]) { color-scheme: light; ${themeVars(\"light\")} } }`,\n", ""),
        ("    ...chosen,", "    ...chosen,\n    `@media (prefers-color-scheme: light) { :root:not([data-theme=\"dark\"]) { color-scheme: light; ${themeVars(\"light\")} } }`,"),
    ], ["render.test.ts"]),
    ("a theme wears the other base's hues", "src/design/tokens.ts", [
        ("    hueRules(baseOf(t), `:root[data-theme=\"${t}\"] `),", "    hueRules(baseOf(t) === \"dark\" ? \"light\" : \"dark\", `:root[data-theme=\"${t}\"] `),"),
    ], ["render.test.ts"]),
    ("the theme you chose is forgotten on a reload", "src/orbs.tsx", [
        ("applyTheme(savedTheme(), false);", "applyTheme(null, false);"),
    ], ["render.test.ts"]),
    # a voice heard before it is chosen (owner, 10-02)
    ("pressing a voice plays nothing", "src/orbs.tsx", [
        ("                      preview(v.id, P.speed); // heard as he will speak: his personality's pace\n", ""),
    ], ["voice-preview.test.ts"]),
    ("a voice is previewed at the wrong pace", "src/orb/preview.ts", [
        ("  a.playbackRate = speed;", "  a.playbackRate = 1;"),
    ], ["voice-preview.test.ts"]),
    ("two previews talk over each other", "src/orb/preview.ts", [
        ("export function preview(id: string, speed = 1): void {\n  playing?.pause();", "export function preview(id: string, speed = 1): void {"),
    ], ["voice-preview.test.ts"]),
    ("the samples are looked for in the wrong place", "src/orb/preview.ts", [
        ("  return `voices/${list[take % list.length] ?? `${id}.mp3`}`;", "  return `voice/${list[take % list.length] ?? `${id}.mp3`}`;"),
    ], ["voice-preview.test.ts"]),
    ("the build writes no manifest", "vite.config.ts", [
        ('      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: `${JSON.stringify(manifest, null, 1)}\\n` });', "      void manifest;"),
    ], ["install.test.ts"]),
    # the QR code a phone pairs by (PLAN 2.7)
    ("a QR code says another mask than it was drawn with", "src/ui/qr.ts", [
        ("  flip(best);\n  format(best);", "  flip(best);\n  format((best + 1) % 8);"),
    ], ["qr.test.ts"]),
    ("a QR code's error correction is the wrong code", "src/ui/qr.ts", [
        ("    root = mul(root, 0x02);", "    root = mul(root, 0x03);"),
    ], ["qr.test.ts"]),
    ("a long QR code's blocks are not interleaved", "src/ui/qr.ts", [
        ("  for (let i = 0; i < parts[0]!.length; i++) for (const p of parts) if", "  for (const p of parts) for (let i = 0; i < parts[0]!.length; i++) if"),
    ], ["qr.test.ts"]),
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
        ("    `@media (prefers-color-scheme: light) { ${hueRules(\"light\", \":root:not([data-theme]) \")} }`,\n", ""),
        ("    hueRules(baseOf(t), `:root[data-theme=\"${t}\"] `),\n", ""),
    ], ["render.test.ts"]),
    ("the smallest type falls under the floor", "src/design/tokens.ts", [
        ("  caption2: [11, 13, 400],", "  caption2: [9, 13, 400],"),
    ], ["design.test.ts", "render.test.ts"]),
    ("the harness sees no contrast", "test/harness.ts", [
        ("      if (ratio < need - 0.01) out.push(", "      if (ratio < 0) out.push("),
    ], ["render.test.ts"]),
    ("the harness does not see a spill", "test/harness.ts", [
        ("      if (!inScroller && (r.left < -1 || r.right > vw + 1)) out.push(", "      if (false) out.push("),
    ], ["render.test.ts"]),
    ("the harness counts a word on the line it begins on", "test/harness.ts", [
        ("        const rect = [...r.getClientRects()].filter((x) => x.width > 0).at(-1);",
         "        const rect = [...r.getClientRects()].filter((x) => x.width > 0)[0];"),
    ], ["render.test.ts"]),
    ("the harness reads a program's lines as prose", "test/harness.ts", [
        ('block.closest("svg, code, pre")', 'block.closest("svg")'),
    ], ["render.test.ts"]),
    # the chats on a phone, and approving from a notice (owner, 10-08)
    ("an approval's notice cannot be answered", "src/rooms/Notices.tsx", [
        ('{n.kind === "approval" && n.card !== null && (', "{false && ("),
    ], ["notices.test.ts"]),
    ("Approve on a notice denies", "src/rooms/Notices.tsx", [
        ('onClick={() => answer(n, "approve")}', 'onClick={() => answer(n, "deny")}'),
    ], ["notices.test.ts"]),
    ("a request's command runs together in one paragraph", "src/ui/Asked.tsx", [
        ('whiteSpace: "pre-wrap"', 'whiteSpace: "normal"'),
    ], ["notices.test.ts"]),
    ("a long decision squeezes its AGREED under its mark", "src/rooms/Talk.tsx", [
        ('style={{ letterSpacing: ".1em", fontSize: 11, color: "var(--accent)", whiteSpace: "nowrap", flex: "0 0 auto" }}',
         'style={{ letterSpacing: ".1em", fontSize: 11, color: "var(--accent)" }}'),
    ], ["sessions.test.ts"]),
    ("the box keeps words too long for it", "src/rooms/Talk.tsx", [
        ("placeholder={hint}", "placeholder={o.placeholder}"),
    ], ["sessions.test.ts"]),
    ("the box does not grow with what is written", "src/rooms/Talk.tsx", [
        ("useLayoutEffect(grow, [draft]);", "useLayoutEffect(() => {}, [draft]);"),
    ], ["sessions.test.ts"]),
    ("Send stretches with the box", "src/rooms/Talk.tsx", [
        ('<div style={{ display: "flex", alignItems: "flex-end", gap: 8, minWidth: 0 }}>', '<div style={{ display: "flex", gap: 8, minWidth: 0 }}>'),
    ], ["sessions.test.ts"]),
    # any colour, Dark, the strand in hex (PLAN 2.20; owner, 10-08)
    ("one of the 24 is drawn other than it was", "src/orb/spec.ts", [
        ("sat: f.sat * (own ? own.sat : dark ? DARK_GLASS.sat : 1),", "sat: f.sat * (own ? own.sat : dark ? DARK_GLASS.sat : 1.05),"),
    ], ["colours.test.ts"]),
    ("Dark is not dark", "src/orb/spec.ts", [
        ("export const DARK_GLASS = { sat: 0.12, val: 0.34 } as const;", "export const DARK_GLASS = { sat: 0.12, val: 0.8 } as const;"),
    ], ["colours.test.ts", "creator.test.ts"]),
    ("any colour is drawn at the wrong hue", "src/orb/colour.ts", [
        ("return { turn: turnFor(c.h),", "return { turn: turnFor(0),"),
    ], ["colours.test.ts"]),
    ("the first strands' white and black change places", "src/orb/strand.ts", [
        ('const accessory = (): (AccessoryHue | null)[] => [null, ...STRAND_HUES, "white", "black"];', 'const accessory = (): (AccessoryHue | null)[] => [null, ...STRAND_HUES, "black", "white"];'),
    ], ["colours.test.ts"]),
    ("a strand drops its colours", "src/orb/strand.ts", [
        ("    for (const t of tints) if (t) n = n * RGB + BigInt(Number.parseInt(t.slice(1), 16));\n", ""),
    ], ["colours.test.ts"]),
    ("Dark's words are a colour", "src/design/tokens.ts", [
        ('dark: oklch(0.8, 0.012, 255)', 'dark: oklch(0.8, 0.15, 255)'),
    ], ["design.test.ts"]),
    ("a hat in any colour counts as coral", "src/orb/dna.ts", [
        ('["hat", c.hatTint ? nearestHue(c.hatTint) : c.hatHue,', '["hat", c.hatTint ? "coral" : c.hatHue,'),
    ], ["colours.test.ts"]),
    ("a picked colour never reaches the orb", "src/orbs.tsx", [
        ("onPick={(tint) => edit({ tint, hue: nearestHue(tint) })}", "onPick={() => {}}"),
    ], ["creator.test.ts"]),
    ("the hat's any colour does nothing", "src/orbs.tsx", [
        ("onTint={(hatTint) => edit({ hatTint, hatHue: null })}", "onTint={() => {}}"),
    ], ["creator.test.ts"]),
    ("one of the 24 leaves any colour on", "src/orbs.tsx", [
        ("onPick={() => edit({ hue: h, tint: null })}", "onPick={() => edit({ hue: h })}"),
    ], ["creator.test.ts"]),
    ("a look read back drops Dark", "src/orb/spec.ts", [
        ('hue: pick("hue", (v) => typeof v === "string" && (hues.includes(v) || v === "dark")),', 'hue: pick("hue", (v) => typeof v === "string" && hues.includes(v)),'),
    ], ["colours.test.ts"]),
    # the charts (PLAN 2.19; owner, 10-08: "when we press on brain today it brings us to settings?")
    ("Brain today still opens Settings", "src/rooms/Home.tsx", [
        ('go={() => go({ room: "stats", tab: "brain" })}', 'go={() => go({ room: "settings" })}'),
    ], ["stats-view.test.ts"]),
    ("XP this week opens the org chart", "src/rooms/Home.tsx", [
        ('go={() => go({ room: "stats", tab: "xp" })}', 'go={() => go({ room: "org" })}'),
    ], ["stats-view.test.ts"]),
    ("the charts show a week whatever you pick", "src/rooms/Stats.tsx", [
        ("onClick={() => setDays(n)}", "onClick={() => setDays(7)}"),
    ], ["stats-view.test.ts"]),
    ("a new call never shows on the charts", "src/rooms/Stats.tsx", [
        ("wait = window.setTimeout(() => ((wait = 0), load()), 4_000);", "wait = window.setTimeout(() => (wait = 0), 4_000);"),
    ], ["stats-view.test.ts"]),
    # the bottom rooms and the hallways (owner, 10-08: "Gym, Classroom, Library and Interview room, plus the hallway fix")
    ("the night's gym sits them at their desks again", "src/floor/plan.ts", [
        ('  if (mood === "gym") return "gym";', ""),
    ], ["floor.test.ts"]),
    ("a lesson between friends stays at a desk", "src/floor/plan.ts", [
        ('return { ...base, place: "classroom", label:', "return { ...base, label:"),
    ], ["floor.test.ts"]),
    ("the bottom rooms have no doors", "src/floor/plan.ts", [
        ("door: { x: x + door, w: 90 }, wall: LOW };", "door: { x: x + door, w: 0 }, wall: LOW };"),
    ], ["floor.test.ts"]),
    ("the hallway is a road again", "src/floor/art.tsx", [
        ('          <rect x={48} y={c.y + 16} width={W - 96} height={c.h - 32} rx={5} style={st("hairline", 1.5)} />',
         '          <rect x={48} y={c.y + 16} width={W - 96} height={c.h - 32} rx={5} style={st("hairline", 1.5)} />\n          <path d={`M60 ${c.y + c.h / 2} H${W - 60}`} style={{ ...st("hairline", 1.5), strokeDasharray: "10 14" }} />'),
    ], ["floor-view.test.ts"]),
    ("no one waits in the interview room", "src/floor/Floor.tsx", [
        ("...applicants.slice(0, WAITING.length).map((a, i) => {", "...applicants.slice(0, 0).map((a, i) => {"),
    ], ["floor-view.test.ts"]),
    ("an orb at school is not in the classroom", "src/floor/Floor.tsx", [
        ("      setSchool(away.filter((c) => there.has(idOf(c.name))));", "      setSchool([]);"),
    ], ["floor-view.test.ts"]),
    ("the interview room miscounts who else applied", "src/floor/Floor.tsx", [
        ("{`+${applicants.length - WAITING.length} more`}", "{`+${applicants.length} more`}"),
    ], ["floor-view.test.ts"]),
    ("a phone's keyboard shrinks the room again", "src/ui/fill.ts", [
        ("      el.style.height = DVH ? `max(${min}px, calc(100dvh - ${above}px))` : `${Math.max(min, Math.floor(window.innerHeight - above))}px`;",
         "      el.style.height = `${Math.max(min, Math.floor((window.visualViewport?.height ?? window.innerHeight) - above))}px`;"),
        ('    window.addEventListener("resize", fit); // a turned phone',
         '    window.visualViewport?.addEventListener("resize", fit);\n    window.addEventListener("resize", fit); // a turned phone'),
    ], ["sessions.test.ts"]),
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
        ("  p.streak = t - p.pressed < COMBO_MS ? Math.min(p.streak + 1, 6) : 0;", "  p.streak = 0;"),
    ], ["feel.test.ts"]),
    ("the sound switch is ignored", "src/ui/sound.ts", [
        ("  if (!on) return;\n  const lift = pace(", "  const lift = pace("),
    ], ["feel.test.ts"]),
    ("a click that pops", "src/ui/sound.ts", [
        ("dur: 0.045, gain, attack: 0.0015 }", "dur: 0.045, gain, attack: 0 }"),
    ], ["feel.units.test.ts", "feel.test.ts"]),
    ("a double press clicks twice", "src/ui/sound.ts", [
        ("  if (t - (p.last[sound] ?? -1e9) < QUIET_MS) return null;\n", ""),
    ], ["feel.test.ts"]),
    ("every button clicks again", "src/ui/feel.ts", [
        ('  if (el.getAttribute("aria-pressed") === "false") return "pick";\n  return null;', '  if (el.getAttribute("aria-pressed") === "false") return "pick";\n  return "tap";'),
    ], ["feel.test.ts"]),
    ("a choice already made clicks again", "src/ui/feel.ts", [
        ('  if (el.getAttribute("aria-pressed") === "false") return "pick";', '  if (el.hasAttribute("aria-pressed")) return "pick";'),
    ], ["feel.test.ts"]),
    ("the click is a high tok again", "src/ui/sound.ts", [
        ("      return click(0, 170, 0.25);", "      return click(0, 540, 0.25);"),
    ], ["feel.test.ts"]),
    ("a Hiring tag sits under the orbs", "src/floor/Floor.tsx", [
        ('translate: "-50% 0", zIndex: H + 10, ...tag, cursor: "pointer",', 'translate: "-50% 0", zIndex: h.z, ...tag, cursor: "pointer",'),
    ], ["recruiter-view.test.ts"]),
    # a calmer floor and its moments (PLAN 5.19; owner, 10-07: "slow down the amount of things they do ... lively pace
    # please, but goofy and funny as well")
    ("orbs go back for food straight after eating", "src/floor/plan.ts", [
        ("    if (busy.pois.has(id) || (ate && FOOD.has(id))) return;", "    if (busy.pois.has(id)) return;"),
    ], ["floor.test.ts"]),
    ("orbs stay only seconds anywhere", "src/floor/plan.ts", [
        ("Math.round((20 + r() * 25) * (0.8 + traits.Calm / 30) * 1000)", "Math.round((7 + r() * 11) * (0.8 + traits.Calm / 30) * 1000)"),
    ], ["floor.test.ts"]),
    ("a moment leaves an orb's mood alone", "src/orb/mood.ts", [
        ('    if (e.type === "social.moment" && (e.data?.a === this.#orb || e.data?.b === this.#orb)) {', '    if (false && e.type === "social.moment" && (e.data?.a === this.#orb || e.data?.b === this.#orb)) {'),
    ], ["mood.test.ts"]),
    ("the floor ignores a moment", "src/floor/Floor.tsx", [
        ("    const moment = sent === null ? live.current.moments.find(", "    const moment = sent !== sent ? live.current.moments.find("),
    ], ["social-view.test.ts"]),
    ("a moment's lines are never said", "src/floor/Floor.tsx", [
        ("                setSpeech((sp) => ({ ...sp, [id]: say.line }));", "                void id;"),
    ], ["social-view.test.ts"]),
    # the board's report in the app (PLAN 5.18), the office as a camera room, an orb's page, the lab's flask (owner, 10-07)
    ("the report's notice does not open it", "src/rooms/Notices.tsx", [
        ('onClick={() => o.go({ room: "report" })}', "onClick={() => undefined}"),
    ], ["report-view.test.ts"]),
    # what the company can spend, in the app (PLAN 5.20; owner, 10-08): asked, kept, changed on the report and in Settings
    ("the first open never asks what the company can spend", "src/onboarding/story.ts", [
        ('  { kind: "ask-budget" },\n', ""),
    ], ["onboarding.test.ts"]),
    ("a skip skips what the company can spend", "src/onboarding/story.ts", [
        ('  if (!person?.budget && at("ask-budget") >= 0) return at("ask-budget");\n', ""),
    ], ["onboarding.test.ts"]),
    ("the first open's budget never reaches the home", "src/home/link.ts", [
        ("...(p.company && { company: p.company }), ...(p.budget && { budget: p.budget }) })", "...(p.company && { company: p.company }) })"),
    ], ["link.test.ts"]),
    ("the report never asks what the company can spend", "src/rooms/Report.tsx", [
        ("      {person && (!budget || choosing ? (", "      {person && budget && (choosing ? ("),
    ], ["report-view.test.ts"]),
    ("the report asks even once you have said", "src/rooms/Report.tsx", [
        ("      {person && (!budget || choosing ? (", "      {person && (true ? ("),
    ], ["report-view.test.ts"]),
    ("Change does nothing", "src/rooms/Report.tsx", [
        ("<button data-budget-change onClick={() => setChoosing(true)}", "<button data-budget-change onClick={() => undefined}"),
    ], ["report-view.test.ts"]),
    ("a budget chosen on the report is not kept", "src/rooms/Report.tsx", [
        ("    if (person) keep({ ...person, budget: b });\n", ""),
    ], ["report-view.test.ts"]),
    ("your own amounts are never kept", "src/ui/Budget.tsx", [
        ('    setWhy("");\n    onPick(r.budget);\n', '    setWhy("");\n'),
    ], ["report-view.test.ts"]),
    ("Settings' budget does nothing", "src/rooms/Settings.tsx", [
        ("onPick={(b) => o.rename({ ...o.person!, budget: b })}", "onPick={() => undefined}"),
    ], ["report-view.test.ts"]),
    ("an idea's costs are not shown", "src/rooms/Report.tsx", [
        ("                      {x.start !== undefined && <><span style={factHead}>Costs</span>", "                      {false && <><span style={factHead}>Costs</span>"),
    ], ["report-view.test.ts"]),
    ("the ideas left out are not counted on the page", "src/rooms/Report.tsx", [
        ("            {r.left ? (", "            {false ? ("),
    ], ["report-view.test.ts"]),
    ("an idea's verdict is never sent", "src/rooms/Report.tsx", [
        ("const judge = (id: string, verdict: \"approve\" | \"pass\"): void => void home.judgeIdea(id, verdict)", "const judge = (id: string, verdict: \"approve\" | \"pass\"): void => void Promise.resolve(id + verdict)"),
    ], ["report-view.test.ts"]),
    ("the camera's glass is back over the orbs", "src/floor/camera.tsx", [
        ('      <div style={{ position: "relative", minWidth: 0 }}>{children}</div>\n', '      <div style={{ position: "relative", minWidth: 0 }}>{children}<div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(to bottom, rgba(0, 0, 0, .13) 0 1px, transparent 1px 3px)" }} /></div>\n'),
    ], ["floor-view.test.ts"]),
    ("the camera's clock stops", "src/floor/camera.tsx", [
        ("    const t = setInterval(() => setNow(new Date()), 1000);", "    const t = setInterval(() => undefined, 1000);"),
    ], ["floor-view.test.ts"]),
    ("an orb's gestures are as loud as its moods", "src/orbs.tsx", [
        ('style={{ font: "600 12px/16px var(--font)", color: "var(--text-3)", background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", border: 0, borderRadius: 8,', 'style={{ font: "600 13px/18px var(--font)", color: "var(--text-2)", background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", border: 0, borderRadius: 8,'),
    ], ["phones.test.ts"]),
    ("the lab's mark is a star again", "src/orbs.tsx", [
        ('{navItem("The lab", room === "lab", { room: "lab" }, <FlaskIcon />)}', '{navItem("The lab", room === "lab", { room: "lab" }, "✦")}'),
    ], ["nav.test.ts"]),
    # the board in the app (owner, 10-07): the Board room's table, the org chart's board
    ("a board vote does not gather at the Board room's table", "src/floor/Floor.tsx", [
        ('        if (e.type === "board.proposed" && Array.isArray(d.members)) setMeeting(', '        if (false && e.type === "board.proposed" && Array.isArray(d.members)) setMeeting('),
    ], ["floor-view.test.ts"]),
    ("the org chart hides the board", "src/rooms/Org.tsx", [
        ("      {board && (\n        <section aria-label=\"The board\" data-board", "      {false && board && (\n        <section aria-label=\"The board\" data-board"),
    ], ["org-view.test.ts"]),
    # the company in the app (owner, 10-07)
    ("the creator offers everything before your CEO", "src/orbs.tsx", [
        ('      {tab === "Specialty" && founding && (', '      {tab === "Specialty" && false && founding && ('),
        ('      {tab === "Specialty" && !founding && (', '      {tab === "Specialty" && ('),
    ], ["creator.test.ts"]),
    ("your CEO never shows you round", "src/orbs.tsx", [
        ('introWanted() && !toured()) setTouring(made);', 'introWanted() && !toured()) void made;'),
    ], ["onboarding.test.ts"]),
    ("the home page's middle is not your CEO", "src/rooms/Home.tsx", [
        ("  const shown = ceo ? [...others.slice(0, half), ceo, ...others.slice(half)] : others;", "  const shown = ceo ? [ceo, ...others] : others;"),
    ], ["home-view.test.ts"]),
    ("the CEO does not glow", "src/orb/Orb.tsx", [
        ('  const rank = character.specialty === "ceo" ? "ceo" : character.specialty === "cfo" ? "cfo" : null;', '  const rank = null as "ceo" | "cfo" | null;'),
    ], ["home-view.test.ts"]),
    ("a locked department's positions can be pressed", "src/rooms/Recruiter.tsx", [
        ("data-position={k} disabled={shut}", "data-position={k} disabled={false}"),
    ], ["recruiter-view.test.ts"]),
    ("the app's rule drifts from the home's", "src/orb/company.ts", [
        ('  if (!family || family === "exec") return null;', '  if (!family || family === "exec" || family === "finance") return null;'),
    ], ["company.test.ts"]),
    # the home page, what the app opens on (owner, 10-07)
    ("the app opens on the office again", "src/ui/nav.ts", [
        ('  if (parts[0] === "office") return { room: "office", orb: parts[1] ?? null };\n  return { room: "home" };', '  if (parts[0] === "office") return { room: "office", orb: parts[1] ?? null };\n  return { room: "office", orb: null };'),
    ], ["nav.test.ts", "home-view.test.ts"]),
    ("a pairing link lands on the office", "src/home/link.ts", [
        ('      if (location.hash.includes("pair=")) history.replaceState(null, "", "#/home");', '      if (location.hash.includes("pair=")) history.replaceState(null, "", "#/office");'),
    ], ["home-view.test.ts"]),
    # every side scroll, in a track with arrows (owner, 10-07)
    ("a side scroll has no arrows", "src/ui/Balanced.tsx", [
        ("      {over && arrow(-1, left)}", "      {null}"),
        ("      {over && arrow(1, right)}", "      {null}"),
    ], ["phones.test.ts"]),
    ("an arrow does not move its row", "src/ui/Balanced.tsx", [
        ("    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8),", "    el.scrollBy({ left: 0,"),
    ], ["phones.test.ts"]),
    ("an arrow is never dimmed where there is no more", "src/ui/Balanced.tsx", [
        ("tabIndex={-1} disabled={!on}", "tabIndex={-1} disabled={false}"),
    ], ["phones.test.ts"]),
    ("an arrow's hit area reaches past its row", "src/design/tokens.ts", [
        ('top: -6px; bottom: -6px; left: 0; right: 0; }', 'top: -6px; bottom: -6px; left: -6px; right: -6px; }'),
    ], ["phones.test.ts"]),
    # the phone's rooms, less zoomed (owner, 10-07)
    ("a phone's room fills the screen again", "src/floor/plan.ts", [
        ("export const VIEW_PAD = { x: 50, y: 30 };", "export const VIEW_PAD = { x: 10, y: 10 };"),
    ], ["floor-view.test.ts"]),
    # no zoom into a text box on an iPhone (owner, 10-07)
    ("an iPhone zooms into a text box", "src/ui/zoom.ts", [
        ("  meta.content = `${meta.content}, maximum-scale=1`;\n", ""),
    ], ["zoom.test.ts", "phones.test.ts"]),
    ("Android loses pinch-to-zoom", "src/ui/zoom.ts", [
        ("  if (!meta || !isIOS(nav) || /maximum-scale/.test(meta.content)) return false;", "  if (!meta || /maximum-scale/.test(meta.content)) return false;"),
    ], ["zoom.test.ts", "phones.test.ts"]),
    # Chat and the career, right above who the orb is (owner, 10-07)
    ("Chat and Career leave the orb's name", "src/orbs.tsx", [
        ("\n                onChat={() => go({ room: \"chat\", orb: me.name })} onCareer={() => go({ room: \"career\", orb: me.name })} />", " />"),
    ], ["phones.test.ts"]),
    ("the career page's orb sits at the left on a phone", "src/rooms/Career.tsx", [
        ('flexDirection: phone ? "column" : "row"', 'flexDirection: "row"'),
    ], ["phones.test.ts"]),
    # the Recruiter's departments and All (owner, 10-07)
    ("a department shows every department's positions", "src/rooms/Recruiter.tsx", [
        ("        {(group ? [group] : families).map((f) => {", "        {families.map((f) => {"),
    ], ["recruiter-view.test.ts"]),
    ("All ticks one position at a time", "src/rooms/Recruiter.tsx", [
        ("  const tickShown = (): void => void home.setPositions(shownKinds, !allShown)", "  const tickShown = (): void => void Promise.all(shownKinds.map((k) => home.setPosition(k, !allShown))).then((r) => r.at(-1)!)"),
    ], ["recruiter-view.test.ts"]),
    ("the career page does not mark the orb on the table", "src/rooms/Career.tsx", [
        ('aria-current={i === at ? "true" : undefined}', "aria-current={undefined}"),
    ], ["org-view.test.ts"]),
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
        ('focus: "the books: bills and when they are due, budgets, receipts, taxes; tells you before a bill is due"', 'focus: "the books: budgets, receipts, taxes"'),
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
        ('text.replaceAll("{name}", p?.name ?? "boss")', 'text.replaceAll("{name}", "boss")'),
    ], ["onboarding.test.ts"]),
    ("the story plays again at every open", "src/onboarding/story.ts", [
        ('    return v && typeof v.name === "string" && v.name ? v : null;', "    return v && false ? v : null;"),
    ], ["onboarding.test.ts", "nav.test.ts"]),
    ("skipping the story skips the name", "src/onboarding/story.ts", [
        ('  if (!person && at("ask-name") >= 0) return at("ask-name");\n', ''),
    ], ["onboarding.test.ts"]),
    ("skipping the story skips the brains", "src/onboarding/story.ts", [
        ('  return brains >= 0 ? brains : at("hire");', '  return at("hire");'),
    ], ["onboarding.test.ts"]),
    ("the first open never asks what he thinks with", "src/onboarding/story.ts", [
        ('  { kind: "brains" },\n', ''),
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
        ('      if (location.hash.includes("pair=")) history.replaceState(null, "", "#/home");\n', ""),
    ], ["link.test.ts"]),
    ("a reply never shows as it streams", "src/rooms/Talk.tsx", [
        ('        setLive((l) => ({ ...l, [d.orb]: (l[d.orb] ?? "") + d.delta }));', "        void d;"),
    ], ["link.test.ts", "sessions.test.ts"]),
    ("approving a card in a conversation does nothing", "src/rooms/Talk.tsx", [
        ("    o.home.answer(card.id, choice).then(load, (e: Error) => setSaid(e.message));", "    void choice;"),
    ], ["link.test.ts", "sessions.test.ts"]),
    ("an effect hands React scrollIntoView's Promise (as written first: the page tears down)", "src/rooms/Org.tsx", [
        ("  useEffect(() => {\n    if (away && sending) document.querySelector(`[data-away=\"${CSS.escape(sending)}\"]`)?.scrollIntoView({ block: \"center\" });\n  }, [away, sending]);", "  useEffect(() => (away && sending ? document.querySelector(`[data-away=\"${CSS.escape(sending)}\"]`)?.scrollIntoView({ block: \"center\" }) : undefined) as unknown as void, [away, sending]);"),
    ], ["org-view.test.ts"]),
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
        ('accCol: c.hatHue ? tone(c.hatHue, c.hue) : paint(w.main, c.hue),', "accCol: paint(w.main, c.hue),"),
    ], ["spec.test.ts", "creator.test.ts"]),
    ("the frames' colour paints nothing", "src/orb/spec.ts", [
        ('    specsCol: c.glassesHue ? tone(c.glassesHue, c.hue) : paint(g.frame, c.hue),', "    specsCol: paint(g.frame, c.hue),"),
    ], ["spec.test.ts"]),
    ("choosing an accessory's colour does nothing", "src/orbs.tsx", [
        ("            <Swatch hue={h.name} size={28} on={value === h.name} label={`${what} in ${h.name}`} onPick={() => onPick(h.name)} />", "            <Swatch hue={h.name} size={28} on={value === h.name} label={`${what} in ${h.name}`} onPick={() => undefined} />"),
    ], ["creator.test.ts"]),
    ("an accessory's colour is lost when he is kept", "src/orb/spec.ts", [
        ('    hatHue: typeof c.hatHue === "string" && (hues.includes(c.hatHue) || c.hatHue === "white" || c.hatHue === "black") ? (c.hatHue as AccessoryHue) : c.hatHue === null ? null : base.hatHue ?? null,', "    hatHue: null,"),
    ], ["spec.test.ts", "creator.test.ts"]),
    ("hats sit where they did on every shape (no fit)", "src/orb/spec.ts", [
        ("  const Y = Math.max(Math.min(head(-FIT_AT), head(FIT_AT)) - beanDrop, peak);", "  const Y = -S0.d[1] * (1 + outline(S0, -Math.PI / 2));"),
    ], ["spec.test.ts"]),
    ("his shape shows inside a hat: his ears drawn over it again", "src/orb/glsl.ts", [
        ("  float nd = db/Rg;\n\n  if (nd < 1.04) {", "  float nd = db/Rg;\n  // his ears in front of a hat, as if through it\n  float earT = uShapeD.x < 0.3 ? uShapeC.z*(exp(-pow((ang0 + 1.5707963 - uShapeC.w)/uShapeD.x, 2.0)) + exp(-pow((ang0 + 1.5707963 + uShapeC.w)/uShapeD.x, 2.0))) : 0.0;\n  float Rskull = Rs - uShapeD.y*Rg*earT*(1.0 + 0.5*uSquash*cos(2.0*ang0));\n  float earFront = earT > 0.005 ? smoothstep(Rskull - 1.5, Rskull + 1.5, length(p))*smoothstep(1.0, 1.0 - 2.6/Rg, nd) : 0.0;\n\n  if (nd < 1.04) {"),
        ("      col = aa >= 1.0 ? c : mix(col, c, aa);                        // in front of all of him, his ears too (owner, 10-03); solid,", "      col = mix(col, c, aa*(1.0 - earFront));"),
    ], ["characters.test.ts"]),
    ("a hat is drawn see-through", "src/orb/glsl.ts", [
        ("      col = aa >= 1.0 ? c : mix(col, c, aa);                        // in front of all of him, his ears too (owner, 10-03); solid,", "      col = mix(col, c, aa*0.5);"),
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
        ("            {shown && <Computer key={idOf(shown.name)} home={o.home} orb={shown} messages={messages} busy={busy[idOf(shown.name)]} big session={o.session.id} />}", "            {null}"),
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
        ("    o.home.labOf(q).then(setLab, (e: Error) => setSaid(e.message));", "    o.home.labOf(\"\").then(setLab, (e: Error) => setSaid(e.message));"),
    ], ["lab.test.ts"]),
    ("Reopen opens the old brainstorm", "src/rooms/Lab.tsx", [
        ('    home.reopen(id).then((s) => o.go({ room: "sessions", id: s.id, tab: "brainstorm" }), (e: Error) => setSaid(e.message));', '    void home; o.go({ room: "sessions", id, tab: "brainstorm" });'),
    ], ["lab.test.ts"]),
    ("the specimen scrolls sideways on a phone", "src/specimen.tsx", [
        ('gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))"', 'gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))"'),
    ], ["render.test.ts"]),
    # his computer's browser and your passwords (PLAN 4.1)
    ('his face is not drawn on his screen', 'src/rooms/Computer.tsx', [
        ('          {s.cursor && (', '          {false && s.cursor && ('),
    ], ['browser-view.test.ts']),
    ('his Browser tab keeps an old still', 'src/rooms/Computer.tsx', [
        ('        event: (e) => (e.orb === id && e.type.startsWith("computer.") ? setScreenNews((n) => n + 1) : undefined),\n', '        event: () => undefined,\n'),
    ], ['browser-view.test.ts']),
    ('a reset in one press', 'src/rooms/Computer.tsx', [
        ('          <button onClick={() => setAsking(true)} style={button}>', '          <button onClick={() => act("reset")} style={button}>'),
    ], ['browser-view.test.ts']),
    ('a saved password stays in its field', 'src/rooms/Passwords.tsx', [
        ('    setPassword(""); // out of the page at once, whatever the home says\n', ''),
    ], ['browser-view.test.ts']),
    # his age, his days in the company, and where a new orb starts (owner, 10-02)
    ("years are never said", "src/orb/age.ts", [
        ("  if (!years) return d;", "  if (true) return d;"),
    ], ["age.test.ts"]),
    ("daylight saving moves a day", "src/orb/age.ts", [
        ("  const a = new Date(wall(from));\n  const b = wall(to);", "  const a = new Date(from);\n  const b = to;"),
    ], ["age.test.ts"]),
    ("a day is said before it is whole", "src/orb/age.ts", [
        ("  const days = Math.max(0, Math.floor(", "  const days = Math.max(0, Math.round("),
    ], ["age.test.ts"]),
    ("his card does not say his age", "src/orbs.tsx", [
        ("        {!onRename && standing && (", "        {false && standing && ("),
    ], ["morning.test.ts"]),
    ("a new orb's sheet does not say where he starts", "src/orbs.tsx", [
        ("        {onRename && startsAs && (", "        {false && startsAs && ("),
    ], ["creator.test.ts"]),
    ("every new orb starts the Senior on his sheet", "src/orbs.tsx", [
        ("  const startsAs = (making ? !office.some((o) => o.specialty === me.specialty)", "  const startsAs = (making ? true"),
    ], ["creator.test.ts"]),
    # his lesson in the Lesson tab (PLAN 4.4)
    ('the canvas plays no step', 'src/rooms/Lesson.tsx', [
        ('          if (fn) await fn(...args);', '          if (false && fn) await fn(...args);'),
    ], ['lesson-view.test.ts']),
    ("Ash's names for the canvas's calls are not read", 'src/rooms/Lesson.tsx', [
        ('          const fn = t[ALIAS[name] ?? name];', '          const fn = t[name];'),
    ], ['lesson-view.test.ts']),
    ('the Lesson tab does not open when a lesson begins', 'src/rooms/Computer.tsx', [
        ('        if (open && l) setTab("Lesson");\n', ''),
    ], ['lesson-view.test.ts']),
    # his voice and his ears in the app (PLAN 4.3)
    ("a slow answer cuts the start of your turn", "src/orb/turns.ts", [
        ("    this.#follow(ask.from); // the call and what follows it are one turn, however slow the answer", "    this.#follow(this.#total);"),
    ], ["voice.test.ts"]),
    ('a stop lets him finish his phrase', 'src/orb/speech.ts', [
        ('  current.stop();\n  current = null;\n  record(', '  current = null;\n  record('),
    ], ['voice.test.ts']),
    ('Stop does not end his run', 'src/rooms/Talk.tsx', [
        ('    if (o.voice) o.home.stop(o.voice.orb).catch(() => {});\n', ''),
    ], ['voice.test.ts']),
    ('the call stays in front of your message', 'src/orb/turns.ts', [
        ('  return text.replace(new RegExp(', '  return text || text.replace(new RegExp('),
    ], ['turns.test.ts', 'voice.test.ts']),
    ('his name never wakes him', 'src/orb/turns.ts', [
        ('    if (!ask || !w.woken || this.#mode !== "asleep") return [];', '    if (true) return [];'),
    ], ['turns.test.ts']),
    # his screen live in the app, your hands and his terminal (PLAN 4.6)
    ('a press on his screen goes nowhere', 'src/rooms/Computer.tsx', [
        ('              hand({ kind: "click", x: Math.round(((e.clientX - r.left) / r.width) * width), y: Math.round(((e.clientY - r.top) / r.height) * height) });\n', ''),
    ], ['live-view.test.ts']),
    ('the terminal takes your commands without your having him', 'src/rooms/Computer.tsx', [
        ('      {yours && (', '      {(yours || true) && ('),
    ], ['live-view.test.ts']),
    ('his live screen shows only once you take over', 'src/rooms/Computer.tsx', [
        ('  const live = watching || state.takenOver; // in your hands, you see him as he is', '  const live = state.takenOver;'),
    ], ['live-view.test.ts']),
    # the team's board on the Floor and the shared computer (PLAN 5.1)
    ("the Floor's computer reads his own workspace, not the team's", 'src/rooms/Sessions.tsx', [
        (' big session={o.session.id} />}', ' big />}'),
    ], ['team-board-view.test.ts']),
    ('the board shows no one holding a row', 'src/rooms/Board.tsx', [
        ('                  {c && (', '                  {false && c && ('),
    ], ['team-board-view.test.ts']),
    ('your Approve does nothing', 'src/rooms/Board.tsx', [
        ('onClick={() => act(home.reviewRow(p.id, r.row, true, ""))}', 'onClick={() => undefined}'),
    ], ['team-board-view.test.ts']),
    # the org chart, career pages, the weekly card, letting go and rehiring in the app (PLAN 5.5, 5.6)
    ('the org chart shows no lead first', 'src/rooms/Org.tsx', [
        ('    const cards = [t.lead ? card(t.lead, { lead: true }) : null, ...t.rest.map((id) => card(id))].filter(Boolean);', '    const cards = [...t.rest.map((id) => card(id))].filter(Boolean);'),
    ], ['org-view.test.ts']),
    # the org chart as a tree (owner, 10-08: "like a family tree or corporate latter")
    ("the org chart's tree has no lines", "src/rooms/Org.tsx", [
        ('      <style>{TREE_CSS}</style>\n', ''),
    ], ['org-view.test.ts']),
    ('the org chart never hangs down like a family tree', 'src/rooms/Org.tsx', [
        ('  const down = width >= Math.max(1, chart.branches.length) * COLUMN;', '  const down = width < 0;'),
    ], ['org-view.test.ts']),
    ('a head stands in its own team as well', 'src/rooms/chart.ts', [
        ('return { kind: k, lead: lead && !isHead.has(lead) ? lead : null,', 'return { kind: k, lead,'),
    ], ['chart.test.ts']),
    ('a second CTO works in the Executive, not under the CTO in Build', 'src/rooms/chart.ts', [
        ('  if (family !== "exec") return family;\n', '  return family;\n'),
    ], ['chart.test.ts']),
    ('a face does not open his career page', 'src/rooms/Org.tsx', [
        ('onClick={() => open(c)}', 'onClick={() => undefined}'),
    ], ['org-view.test.ts']),
    ('Rehire does nothing', 'src/rooms/Org.tsx', [
        ('onClick={() => void home.rehire(o.id).then(() => rehired(), (e: Error) => setSaid(e.message))}', 'onClick={() => undefined}'),
    ], ['org-view.test.ts']),
    ('his habits are not handed on', 'src/orbs.tsx', [
        ('onClick={() => onDelete(handTo || undefined)}', 'onClick={() => onDelete(undefined)}'),
    ], ['org-view.test.ts']),
    ('his career page does not say his age', 'src/rooms/Career.tsx', [
        ('{`Age ${span(c.born, c.now)} · ', '{`${span(c.born, c.now)} · '),
    ], ['org-view.test.ts']),
    ('a weekly card opens no career page', 'src/rooms/Notices.tsx', [
        ('onClick={() => o.go({ room: "career", orb: c.name })}', 'onClick={() => undefined}'),
    ], ['org-view.test.ts']),
    # a real conversation: the turns, by code, and the page (PLAN 4.7)
    ('the conversation needs his name every turn', 'src/orb/turns.ts', [
        ('    const acts: Act[] = [];\n    this.#mode = "between";', '    const acts: Act[] = [];\n    this.#mode = "asleep";'),
    ], ['turns.test.ts']),
    ('a quiet spell never ends the conversation', 'src/orb/turns.ts', [
        ('      if (!he.busy && s(this.#total - Math.max(this.#idleFrom, this.#voicedAt)) >= IDLE_S) {', '      if (false) {'),
    ], ['turns.test.ts']),
    ('the conversation ends while he works', 'src/orb/turns.ts', [
        ('      if (he.speaking || he.busy) this.#idleFrom = this.#total;\n', ''),
        ('      if (!he.busy && s(this.#total', '      if (s(this.#total'),
    ], ['turns.test.ts']),
    ('a trailing turn ends at 1.4 s', 'src/orb/turns.ts', [
        ('    this.#wait = t.hold || t.p < UNFINISHED_P ? PATIENT_S : ENDPOINT_S;', '    this.#wait = ENDPOINT_S;'),
    ], ['turns.test.ts']),
    ("the first pause's words are heard again", 'src/orb/turns.ts', [
        ('      if (this.#early && this.#early.at >= this.#voicedAt) return this.#end(', '      if (false) return this.#end('),
    ], ['turns.test.ts']),
    ('a stale pause ends your turn', 'src/orb/turns.ts', [
        ('    if (this.#voicedAt > ask.to) return []; // you went on', '    if (false) return []; // you went on'),
    ], ['turns.test.ts']),
    ("an 'mhm' stops him", 'src/orb/turns.ts', [
        ('    if (o.kind === "interrupt") {', '    if (o.kind !== "echo") {'),
    ], ['turns.test.ts']),
    ('his own words coming back stop him', 'src/orb/turns.ts', [
        ('    if (o.kind === "interrupt") {', '    if (o.kind !== "backchannel") {'),
    ], ['turns.test.ts']),
    ("an interruption's turn starts where it was answered", 'src/orb/turns.ts', [
        ('      this.#follow(ask.from); // your turn began where your voice did', '      this.#follow(this.#total); // your turn began where your voice did'),
    ], ['turns.test.ts']),
    ('his own tail starts a turn', 'src/orb/turns.ts', [
        ('      if (voiced && s(this.#total - this.#heQuietAt) >= TAIL_S) {', '      if (voiced) {'),
    ], ['turns.test.ts']),
    ("'thanks Hazel' is sent as a message", 'src/orb/turns.ts', [
        ('    else if (said && endsConversation(said, this.#name)) {', '    else if (false) {'),
    ], ['turns.test.ts']),
    ('a doubted turn is sent', 'src/orb/turns.ts', [
        ('    if (unsure) acts.push({ kind: "missed" });', '    if (false) acts.push({ kind: "missed" });'),
    ], ['turns.test.ts']),
    ('a sound too short to matter is asked about', 'src/orb/turns.ts', [
        ('s(this.#voicedAt - this.#overAskedTo) >= OVERLAP_S', 's(this.#voicedAt - this.#overAskedTo) >= 0'),
    ], ['turns.test.ts']),
    ('hands-free sends what you said as typed', 'src/rooms/Talk.tsx', [
        ('      heard: (w) => void o.send(w, { said: true }).catch(', '      heard: (w) => void o.send(w).catch('),
    ], ['voice.test.ts']),
    ('what no one could make out is never answered', 'src/orb/ears.ts', [
        ('      else if (a.kind === "missed") o.missed?.();', '      else if (a.kind === "missed") undefined;'),
    ], ['voice.test.ts']),
    ('you cannot talk over him', 'src/rooms/Talk.tsx', [
        ('      interrupt: stop, // you took the floor', '      interrupt: () => undefined, // you took the floor'),
    ], ['voice.test.ts']),
    ('he does not lean in when called', 'src/rooms/Chat.tsx', [
        ('          onCue={(c) => setCue((g) => ({ name: c, n: (g?.n ?? 0) + 1 }))}', '          onCue={() => undefined}'),
    ], ['voice.test.ts']),
    # the recruiter's room (PLAN 5.8)
    ('a tick opens no position', 'src/rooms/Recruiter.tsx', [
        ('onClick={() => tick(k)}', 'onClick={() => undefined}'),
    ], ['recruiter-view.test.ts']),
    ('an applicant is drawn from another seed', 'src/rooms/Recruiter.tsx', [
        ('const c = applicant(a.seed, k as Kind, taken);', 'const c = applicant(a.seed + 1, k as Kind, taken);'),
    ], ['recruiter-view.test.ts']),
    ('Hire does nothing', 'src/rooms/Recruiter.tsx', [
        ('const hire = (id: number, c: Character): void => void home.hireApplicant(id, c).then(hired, (e: Error) => setSaid(e.message));', 'const hire = (_id: number, _c: Character): void => undefined;'),
    ], ['recruiter-view.test.ts']),
    ('Pass does nothing', 'src/rooms/Recruiter.tsx', [
        ('const pass = (id: number): void => void home.passApplicant(id).catch((e: Error) => setSaid(e.message));', 'const pass = (_id: number): void => undefined;'),
    ], ['recruiter-view.test.ts']),
    # phones first (PLAN 2.17), and a meeting kept in place on coming back (5.9)
    ("a finger's targets are small again", 'src/orbs.tsx', [
        ('select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]) { min-height: 44px !important; }', 'select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]) { min-height: 0; }'),
    ], ['phones.test.ts']),
    ('an iPhone zooms into a text field', 'src/orbs.tsx', [
        ('  input, select, textarea { font-size: max(16px, 1em) !important; }\n', ''),
    ], ['phones.test.ts']),
    ("the floor's tags lose their finger's room", 'src/orbs.tsx', [
        ('  .orbs-tag::after { content: ""; position: absolute; inset: -13px; }\n', ''),
    ], ['phones.test.ts']),
    ("a month's days must each be 44 wide", 'src/orbs.tsx', [
        ('  .orbs-calday { min-width: 24px !important; }\n', ''),
        ('button:not(.orbs-tag):not(.orbs-calday):not(.orbs-narrow), [role="button"]:not(.orbs-tag) { min-width: 44px !important; }', 'button:not(.orbs-tag):not(.orbs-narrow), [role="button"]:not(.orbs-tag) { min-width: 44px !important; }'),
    ], ['phones.test.ts']),
    ('a small phone keeps its margins', 'src/orbs.tsx', [
        ('  main.orbs-main { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }\n', ''),
    ], ['phones.test.ts']),
    ("a chat's header never wraps", 'src/rooms/Chat.tsx', [
        ('<header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px",', '<header style={{ display: "flex", alignItems: "center", gap: "8px 12px",'),
    ], ['phones.test.ts']),
    ('a meeting is walked to again on coming back', 'src/floor/Floor.tsx', [
        ('instant || homeNow - meet.at > MEET_WALK_MS);', 'instant);'),
    ], ['social-view.test.ts']),
    ("a device's own clock times the meetings", 'src/floor/Floor.tsx', [
        ('        skew.current = x.now - Date.now(),\n', '        skew.current = 0,\n'),
    ], ['social-view.test.ts']),
    # office life in the app (PLAN 5.9)
    ("a meeting by a wall stands off the floor", 'src/floor/plan.ts', [
        ('  const inside = (x: number): number => Math.min(W - 48, Math.max(48, x));\n  const toward = spot.at.x > W - 90 ? -1 : spot.at.x < 90 ? 1 : 0;', '  const inside = (x: number): number => x;\n  const toward = 0;'),
    ], ['floor.test.ts']),
    ('the app never tells the home its traits', 'src/orbs.tsx', [
        ('      home.setTraits(idOf(c.name), traits).catch(() => traitsSent.current.delete(c.name));', '      void traits;'),
    ], ['social-view.test.ts']),
    ("the floor ignores the home's meetings", 'src/floor/Floor.tsx', [
        ('    if (meet) {\n      s.mood = mood;', '    if (false && meet) {\n      s.mood = mood;'),
    ], ['social-view.test.ts']),
    ("a ping-pong game the home decided has no ball", 'src/floor/Floor.tsx', [
        ('at: where, ...(s.hold.poi && { poi: s.hold.poi }) } }));', 'at: where, ...(plan.kind === "poi" && { poi: plan.poi }) } }));'),
    ], ['social-view.test.ts']),
    ('Keep it does nothing', 'src/rooms/Notices.tsx', [
        ('<button data-sound="pick" onClick={() => lesson(n, true)}', '<button data-sound="pick" onClick={() => undefined}'),
    ], ['social-view.test.ts']),
    ('the profile shows no colleagues', 'src/orbs.tsx', [
        ('      {friends && friends.length > 0 && <Colleagues', '      {false && friends && <Colleagues'),
    ], ['social-view.test.ts']),
    # the reading library in the lab (PLAN 3.12)
    ('Stop following does not ask first', 'src/rooms/Lab.tsx', [
        ('<button onClick={() => setStopping(x.id)} style={{ ...button, justifySelf: "start" }}>', '<button onClick={() => stop(x.id)} style={{ ...button, justifySelf: "start" }}>'),
    ], ['lab.test.ts']),
    ("the lab's search finds no read pages", 'src/rooms/Lab.tsx', [
        ('      {q && reading && reading.hits.length > 0 && (', '      {false && reading && ('),
    ], ['lab.test.ts']),
    ('the reading notice leads nowhere', 'src/rooms/Notices.tsx', [
        ('                      {n.kind === "reading" && (', '                      {false && ('),
    ], ['lab.test.ts']),
    ('the lab never loads the reading library', 'src/rooms/Lab.tsx', [
        ('    o.home.readingOf(q).then(setReading, (e: Error) => setSaid(e.message));\n', ''),
    ], ['lab.test.ts']),
    # a window made wide with the phone's menu open (owner, 10-06)
    ("a window made wide keeps the phone's menu open", 'src/orbs.tsx', [
        ('    if (!phone) setMenu(false);', '    if (!phone) void 0;'),
    ], ['nav.test.ts']),
    ("the phone's scrim stays in a desk's layout", 'src/orbs.tsx', [
        ('    if (!phone) setMenu(false);', '    if (!phone) void 0;'),
        ('{menu && phone && <div className="orbs-scrim"', '{menu && <div className="orbs-scrim"'),
        ('.orbs-scrim { display: none; }\n', ''),
    ], ['nav.test.ts']),
    # the app opens on the office, never New orb (owner, 10-06)
    ("every launch is kept on New orb", 'src/orbs.tsx', [
        ('    else history.replaceState({ orbs: 0 }, "");', '    else history.replaceState({ orbs: 0 }, "", routeHash(routeOf()));'),
    ], ['link.test.ts']),
    # the floor's Hiring tags open on who applied to their department (owner, 10-06)
    ("the floor's Hiring tag opens the Recruiter's top", 'src/floor/Floor.tsx', [
        ('onClick={() => go({ room: "recruiter", family: z })}', 'onClick={() => go({ room: "recruiter" })}'),
    ], ['recruiter-view.test.ts']),
    ("a department's page shows everyone", 'src/rooms/Recruiter.tsx', [
        ('const inDept = (k: string): boolean => !dept || familyOf(k) === dept;', 'const inDept = (_k: string): boolean => true;'),
    ], ['recruiter-view.test.ts']),
    ("a department's applicants stay below the positions", 'src/rooms/Recruiter.tsx', [
        ('applying.current?.scrollIntoView({ block: "start" })', 'undefined'),
    ], ['recruiter-view.test.ts']),
    ("the department buttons go nowhere", 'src/rooms/Recruiter.tsx', [
        ('onClick={() => pick(f)}', 'onClick={() => undefined}'),
    ], ['recruiter-view.test.ts']),
    ("an interview's answer is never shown", 'src/rooms/Recruiter.tsx', [
        ('(answer) => setLines((l) => [...l, { role: "orb", text: answer, at: Date.now() }]),', '() => undefined,'),
    ], ['recruiter-view.test.ts']),
    ('Rehire from the recruiter does nothing', 'src/rooms/Recruiter.tsx', [
        ('onClick={() => void home.rehire(r.id).then(hired, (e: Error) => setSaid(e.message))}', 'onClick={() => undefined}'),
    ], ['recruiter-view.test.ts']),
    ("a hired applicant's look is never sent", 'src/home/link.ts', [
        ('await call(`../applicants/${applicant}/hire`, { method: "POST", body: JSON.stringify({ id, name, look }) });', 'await call(`../applicants/${applicant}/hire`, { method: "POST", body: JSON.stringify({ id, name, look: {} }) });'),
    ], ['recruiter-view.test.ts']),
    # the voices: only the good ones, not Whisper, none female or male (10-03)
    ('a voice graded D or F is offered again', 'src/orb/spec.ts', [
        ('export const offered = (v: Voice): boolean => !/^[DF]/.test(GRADES[v.id] ?? "") && v.id !== "af_nicole";', 'export const offered = (v: Voice): boolean => v.id !== "af_nicole";'),
    ], ['spec.test.ts']),
    ('Whisper is offered again', 'src/orb/spec.ts', [
        ('export const offered = (v: Voice): boolean => !/^[DF]/.test(GRADES[v.id] ?? "") && v.id !== "af_nicole";', 'export const offered = (v: Voice): boolean => !/^[DF]/.test(GRADES[v.id] ?? "");'),
    ], ['spec.test.ts']),
    ('a voice is called female or male again', 'src/orb/spec.ts', [
        ('accent: lang, english:', 'accent: `${lang} ${k[1] === "f" ? "female" : "male"}`, english:'),
    ], ['spec.test.ts']),
    ('a brave orb starts on a voice graded F', 'src/orb/spec.ts', [
        ('voices: ["am_fenrir", "af_kore", "am_michael"]', 'voices: ["am_adam", "am_fenrir", "af_kore"]'),
    ], ['spec.test.ts']),
    ("the creator's American voices include the weak ones", 'src/orbs.tsx', [
        ('["American", VOICES.filter((v) => v.accent === "American" && offered(v))],', '["American", VOICES.filter((v) => v.accent === "American")],'),
    ], ['voice-preview.test.ts']),
    # the phone and the press (10-03): an iPhone's icon, the title bar's, Copy link, a move's light
    ('an iPhone is shown the rounded icon, whose clear corners it paints black', 'vite.config.ts', [
        ('<link rel="apple-touch-icon" sizes="180x180" href="${icon("orbs-apple-180.png")}" />', '<link rel="apple-touch-icon" href="${icon("orbs-192.png")}" />'),
    ], ['install.test.ts']),
    ("the window's title bar has no icon of ours", 'vite.config.ts', [
        ('<link rel="icon" type="image/png" sizes="32x32" href="${icon("orbs-32.png")}" />\\n    <link rel="icon" type="image/png" sizes="16x16" href="${icon("orbs-16.png")}" />\\n    ', ''),
    ], ['install.test.ts']),
    ('Copy link copies nothing', 'src/rooms/Devices.tsx', [
        ('onClick={() => void navigator.clipboard.writeText(link).then(', 'onClick={() => void Promise.resolve().then('),
    ], ['devices.test.ts']),
    ('a pressed move does not light up', 'src/orbs.tsx', [
        ('...(flash?.g === g && { animation: `${flash.n % 2 ? "orbs-flash-a" : "orbs-flash-b"} 900ms ease-out` })', '...(false && { animation: "" })'),
    ], ['feel.test.ts']),
    ('a second press of a move does not light it again', 'src/orbs.tsx', [
        ('${flash.n % 2 ? "orbs-flash-a" : "orbs-flash-b"}', 'orbs-flash-a'),
    ], ['feel.test.ts']),
    # the creator, more of everything (owner, 10-03): shapes, eyes, hats, glasses, white and black
    ("a new shape is an old one by another name", "src/orb/spec.ts", [
        ("  owl: shape({ tall: 0.06, belly: 0.95, wide: 0.08, ears: 0.13, earSpread: 0.52, earWidth: 0.07, scale: 0.86 }),", "  owl: shape({ tall: 0.06, belly: 0.9, wide: 0.06, ears: 0.2, earSpread: 0.78, earWidth: 0.24, scale: 0.84 }),"),
    ], ["spec.test.ts"]),
    ("a white hat is painted his accent", "src/orb/spec.ts", [
        ('const tone = (h: AccessoryHue, hue: HueName): [number, number, number] => (h === "white" || h === "black" ? paint(h, hue) : paint("accent", h));', 'const tone = (h: AccessoryHue, hue: HueName): [number, number, number] => (h === "black" ? paint(h, hue) : paint("accent", h === "white" ? hue : h));'),
    ], ["spec.test.ts", "creator.test.ts"]),
    ("black frames are lost when he is kept", "src/orb/spec.ts", [
        ('    glassesHue: typeof c.glassesHue === "string" && (hues.includes(c.glassesHue) || c.glassesHue === "white" || c.glassesHue === "black") ?', '    glassesHue: typeof c.glassesHue === "string" && (hues.includes(c.glassesHue) || c.glassesHue === "white") ?'),
    ], ["spec.test.ts"]),
    ("a new hat has no drawing", "src/orb/glsl.ts", [
        ("  if (id == 40) {", "  if (id == 400) {"),
    ], ["spec.test.ts"]),
    ("a new pair of glasses has no drawing", "src/orb/glsl.ts", [
        ("    else if (id == 21) d = ", "    else if (id == 210) d = "),
    ], ["spec.test.ts"]),
    ("two hats share a number", "src/orb/spec.ts", [
        ('  "unicorn horn": { id: 40, main: "gold", second: "cream", tilt: 0 },', '  "unicorn horn": { id: 39, main: "gold", second: "cream", tilt: 0 },'),
    ], ["spec.test.ts"]),
    ("the antlers' ring is drawn under him too", "src/orb/glsl.ts", [
        ("float band = max(max(abs(length(q - vec2(0.0, 0.76)) - 0.72) - 0.03, abs(q.x) - 0.20), q.y - 0.2);", "float band = max(abs(length(q - vec2(0.0, 0.76)) - 0.72) - 0.03, abs(q.x) - 0.20);"),
    ], ["characters.test.ts"]),
    ("the white swatch does nothing", "src/orbs.tsx", [
        ("title={cap(m)} onClick={() => onPick(m)} data-material={m}", "title={cap(m)} onClick={() => undefined} data-material={m}"),
    ], ["creator.test.ts"]),
    # the row as it stood before 10-07 (a phone's 44-wide buttons, no wrap): with the page numbers 32 wide
    # (`orbs-narrow`), five pages fit a phone unwrapped, so the wrap is kept for the roster's growth
    ("the page numbers spill past a phone's width", "src/ui/Paged.tsx", [
        ('style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 5, rowGap: 6 }}', 'style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}'),
        ('<button className="orbs-narrow" aria-label="Previous page"', '<button aria-label="Previous page"'),
        ('              className="orbs-narrow"\n              aria-label={`Page ${p + 1}`}', '              aria-label={`Page ${p + 1}`}'),
        ('<button className="orbs-narrow" aria-label="Next page"', '<button aria-label="Next page"'),
    ], ["office.test.ts", "creator.test.ts"]),
    # the New orb seat and the menu's New orb, inviting (owner, 10-03)
    ("the New orb seat is an empty outline again", "src/orbs.tsx", [
        ('background: "radial-gradient(80% 70% at 50% 30%, var(--accent-fill), var(--accent-wash) 75%)",', 'background: "transparent",'),
    ], ["office.test.ts"]),
    ("the New orb seat's words are grey", "src/orbs.tsx", [
        ('<span style={{ font: "700 15px/20px var(--font)", color: "var(--accent)" }}>New orb</span>', '<span style={{ font: "700 15px/20px var(--font)", color: "var(--text-2)" }}>New orb</span>'),
    ], ["office.test.ts"]),
    ("the New orb seat's orb is faint", "src/orbs.tsx", [
        ('<Orb character={making ? me : NEWBORN} size={100} poke={false} gesture={seatHop ? { name: "hop", n: seatHop } : null} />', '<Orb character={making ? me : NEWBORN} size={100} poke={false} gesture={seatHop ? { name: "hop", n: seatHop } : null} style={{ opacity: 0.6 }} />'),
    ], ["office.test.ts"]),
    ("the menu's New orb is a plain row", "src/orbs.tsx", [
        ('{ room: "new" }, "+", 0, true)', '{ room: "new" }, "+", 0, false)'),
    ], ["office.test.ts"]),
    ("the menu's New orb looks like the page you are on", "src/orbs.tsx", [
        ('...(invite && { background: "var(--accent)", color: "var(--ground)",', '...(invite && { background: "var(--accent-wash)", color: "var(--text-1)",'),
    ], ["office.test.ts"]),
    ("the New orb seat shows the newborn while you make one", "src/orbs.tsx", [
        ('<Orb character={making ? me : NEWBORN} size={100}', '<Orb character={NEWBORN} size={100}'),
    ], ["office.test.ts"]),
    ("the New orb seat keeps the newborn's colour while you make one", "src/orbs.tsx", [
        ("                  data-orb={making ? me.hue : NEWBORN.hue}\n", "                  data-orb={NEWBORN.hue}\n"),
    ], ["office.test.ts"]),
    # the black line through every hat (owner, 10-04): a GPU paints pow of a negative base NaN, black
    ("a pow's base dips below zero again (the top of his head)", "src/orb/glsl.ts", [
        ("float veinMask = pow(max(0.0, 1.0 - abs(N.y)), 1.1)", "float veinMask = pow(1.0 - abs(N.y), 1.1)"),
    ], ["spec.test.ts"]),
    ("a square is a pow again", "src/orb/glsl.ts", [
        ("exp(-sq((a - 0.35)/0.55))", "exp(-pow((a - 0.35)/0.55, 2.0))"),
    ], ["spec.test.ts"]),
    ("a solid hat lets what is under it through", "src/orb/glsl.ts", [
        ("      col = aa >= 1.0 ? c : mix(col, c, aa);", "      col = mix(col, c, aa);"),
    ], ["spec.test.ts"]),
    # school's room: send, rate, a syllabus, a pass mark, the report card (PLAN 5.7)
    ('Send to school does nothing', 'src/rooms/School.tsx', [
        ('onClick={() => void home.sendToSchool(orb, subjects, mark).then(sent, (e: Error) => setSaid(e.message))}', 'onClick={() => undefined}'),
    ], ['school-view.test.ts']),
    ('a thumb up does nothing', 'src/rooms/School.tsx', [
        ('onClick={() => void home.thumb(s.rate!.sitting, a.n, true).catch((e: Error) => said(e.message))}', 'onClick={() => undefined}'),
    ], ['school-view.test.ts']),
    ('a changed syllabus is not saved', 'src/rooms/School.tsx', [
        ('void home.setSyllabus(s.id, editing.split("\\n")).then(', 'void Promise.resolve().then('),
    ], ['school-view.test.ts']),
    ('the pass mark you pick is ignored', 'src/rooms/School.tsx', [
        ('onClick={() => setMark(m)}', 'onClick={() => undefined}'),
    ], ['school-view.test.ts']),
    ('the career page has no report card', 'src/rooms/Career.tsx', [
        ('      <ReportCard home={home} orb={idOf(orb.name)} name={orb.name} />\n', ''),
    ], ['school-view.test.ts']),
    ('the recruiter hides diplomas', 'src/rooms/Recruiter.tsx', [
        (', ...r.diplomas.map((d) => `🎓 ${d}`)]', ']'),
    ], ['school-view.test.ts']),
    # sessions that cost little and say little (PLAN 5.10), and Midnight the default (owner 10-06)
    ("the conversation grows the page again (10-07: ALL THE WAY DOWN ... AND ALL THE WAY UP)", 'src/rooms/Sessions.tsx', [
        ('  useFillScreen(room); // the session is the screen', '  // useFillScreen(room); // the session is the screen'),
    ], ['sessions.test.ts']),
    ('new words pull you down while you read back', 'src/rooms/Talk.tsx', [
        ('    if (atEnd.current) el.scrollTop = el.scrollHeight;\n    else setUnseen(true);', '    el.scrollTop = el.scrollHeight;'),
    ], ['sessions.test.ts']),
    ("a private chat grows the page", 'src/rooms/Chat.tsx', [
        ('  useFillScreen(room); // the chat is the screen', '  // useFillScreen(room); // the chat is the screen'),
    ], ['sessions.test.ts']),
    ('Delete it deletes nothing', 'src/rooms/Sessions.tsx', [
        ('o.home.deleteSession(id).then(', 'Promise.resolve().then('),
    ], ['sessions.test.ts']),
    ("the system's theme until you choose", 'src/ui/theme.ts', [
        ('return v !== null && v in THEMES ? (v as ThemeId) : DEFAULT_THEME;', 'return v !== null && v in THEMES ? (v as ThemeId) : null;'),
    ], ['render.test.ts']),
    ("the phone's menu squeezes its lines (10-06: CEO Rob cut at the bottom)", 'src/orbs.tsx', [
        ('  .orbs-side > :not(:last-child) { flex-shrink: 0; } /* the office\'s list, last, is the part that gives way and scrolls */\n', ''),
    ], ['phones.test.ts']),
    ('letting an orb go never offers school', 'src/orbs.tsx', [
        ('onClick={() => onDelete(handTo || undefined, true)}', 'onClick={() => onDelete(handTo || undefined)}'),
    ], ['org-view.test.ts']),
    ('light is paper white again', 'src/design/tokens.ts', [
        ('    card: parseHex("#E6E9EE"),', '    card: parseHex("#FFFFFF"),'),
        ('    ground: parseHex("#CDD1D9"),', '    ground: parseHex("#E9E9EE"),'),
    ], ['design.test.ts']),
    ('rose is pale again', 'src/design/tokens.ts', [
        ('ground: parseHex("#EAC2D0"), card: parseHex("#F7DCE5"), side: parseHex("#EEC8D5")', 'ground: parseHex("#EFE1E6"), card: parseHex("#FFF8FA"), side: parseHex("#F8ECF0")'),
    ], ['design.test.ts']),
    ('sand is paper again', 'src/design/tokens.ts', [
        ('ground: parseHex("#E0CDA8"), card: parseHex("#F0E3C8"), side: parseHex("#E6D3AE")', 'ground: parseHex("#EEE8DC"), card: parseHex("#FCF9F3"), side: parseHex("#F4EEE3")'),
    ], ['design.test.ts']),
    ("light's walls are its card", 'src/design/tokens.ts', [
        ('wall: parseHex("#A9B3C4")', 'wall: parseHex("#E6E9EE")'),
    ], ['design.test.ts']),
    ("a narrow Floor squeezes the work and the chat into slivers again", 'src/orbs.tsx', [
        ('  .orbs-convo.orbs-beside[data-view="work"] > .orbs-talk, .orbs-convo.orbs-beside[data-view="talk"] > .orbs-pane { display: none; }\n', ''),
    ], ['sessions.test.ts']),
    ("a pane's rows shrink to fit, cutting what is in them", 'src/orbs.tsx', [
        ('.orbs-pane { overflow-y: auto; overscroll-behavior: contain; grid-auto-rows: max-content; }', '.orbs-pane { overflow-y: auto; overscroll-behavior: contain; }'),
    ], ['sessions.test.ts']),
    ("the browser's own scroll bars", 'src/orbs.tsx', [
        ('* { scrollbar-width: thin; scrollbar-color: var(--quiet) transparent; }', ''),
    ], ['sessions.test.ts']),
    ('System is forgotten, and Midnight comes back', 'src/ui/theme.ts', [
        ('globalThis.localStorage?.setItem(KEY, t ?? SYSTEM);', 'if (t) globalThis.localStorage?.setItem(KEY, t); else globalThis.localStorage?.removeItem(KEY);'),
    ], ['render.test.ts']),
    # the hats as models (owner, 10-09: "dont cheap out on them. make them nice, to industry standards")
    ('a hat is lit flat, as the cut-outs were', 'src/orb/glsl.ts', [
        ('  vec3 N = normalize(vN);\n  if (!gl_FrontFacing) N = -N;\n  gFW = fwidth(vUV);', '  vec3 N = vec3(0.0, 0.0, 1.0);\n  if (!gl_FrontFacing) N = -N;\n  gFW = fwidth(vUV);'),
    ], ['characters.test.ts']),
    ('the party hat is huge again', 'src/orb/hats/models.ts', [
        ('  const r0 = 0.2;\n  const H = 0.5;\n  const y0 = seatAt(r0) - 0.014;', '  const r0 = 0.2;\n  const H = 0.98;\n  const y0 = seatAt(r0) - 0.014;'),
    ], ['hats.test.ts']),
    ('the crown floats off his head', 'src/orb/hats/models.ts', [
        ('  const th = 0.016;\n  const y0 = seatAt(r0) - 0.012;', '  const th = 0.016;\n  const y0 = seatAt(r0) + 0.1;'),
    ], ['hats.test.ts']),
    ("the antenna's glow is drawn off its bead", 'src/orb/hats/models.ts', [
        ('  if (id === 4) return { kind: 1, at: seen(BEAD.at), a: BEAD.r, b: BEAD.r, slot: "second" };', '  if (id === 4) return { kind: 1, at: seen(ANTENNA_TOP), a: BEAD.r, b: BEAD.r, slot: "second" };'),
    ], ['hats.test.ts']),
    ("the hats' shader numbers its materials its own way", 'src/orb/glsl.ts', [
        ('const int FELT = 0, KNIT = 1, FUR = 2,', 'const int FELT = 0, KNIT = 2, FUR = 1,'),
    ], ['hats.test.ts']),
    ('his hat sits lower than his glow is drawn', 'src/orb/glsl.ts', [
        ('  float R = uR;\n  float Rg = R * breath * (1.0 + AWAKE_GROW*wakeEase + WAKE_POP*uWake);\n  float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.03*Rg;', '  float R = uR;\n  float Rg = R * breath * (1.0 + AWAKE_GROW*wakeEase + WAKE_POP*uWake);\n  float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.13*Rg;'),
    ], ['hats.test.ts']),
    ('nothing hides what goes round behind his head', 'src/orb/renderer.ts', [
        ('    gl.drawElements(gl.TRIANGLES, this.#head.count, gl.UNSIGNED_INT, 0);\n', ''),
    ], ['characters.test.ts']),
    ('his hat casts no shadow on him', 'src/orb/renderer.ts', [
        ('const SHADE = 0.4;', 'const SHADE = 0;'),
    ], ['characters.test.ts']),
    ('a hat with no model is worn as nothing', 'src/orb/hats/models.ts', [
        ('  37: sombrero, 38: tiara,', '  38: tiara,'),
    ], ['spec.test.ts']),
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


# the kit's own code (kit/orbs_kit; the carried kit/ash is Ash's, checked by his own suites): (the
# defect, the file inside kit/, its edits, the kit suites that must go red)
KIT_MUTANTS: list[tuple[str, str, list[tuple[str, str]], list[str]]] = [
    # a real conversation's rules in the kit (PLAN 4.7)
    ("his own 'hold on' coming back stops him", 'orbs_kit/voicebox.py', [
        ('    elif len(heard) >= 3 and sum(w in mine for w in heard) / len(heard) >= 0.6:\n        kind = "echo"  # first: his own "hold on, I\'m checking", coming back, must not stop him\n    elif set(heard) & STOPS:\n        kind = "interrupt"  # "wait", "hold on": short or long, he stops\n', '    elif set(heard) & STOPS:\n        kind = "interrupt"\n    elif len(heard) >= 3 and sum(w in mine for w in heard) / len(heard) >= 0.6:\n        kind = "echo"\n'),
    ], ['test_conversation_rules.py']),
    ("a short 'mhm' Whisper wrote words for stops him", 'orbs_kit/voicebox.py', [
        ('    elif voiced <= BURST_S:\n        kind = "backchannel"  # even his name: Whisper, primed with it, writes it for a sound it cannot place\n', ''),
    ], ['test_conversation_rules.py']),
    ('his name never stops him', 'orbs_kit/voicebox.py', [
        ('    elif name.strip().lower() in heard:\n        kind = "interrupt"\n', ''),
    ], ['test_conversation_rules.py']),
    ('a long sentence heard badly is taken as said', 'orbs_kit/voicebox.py', [
        ('    return text, len(words) >= SURE_WORDS and sum(p for _, p in words) / len(words) < SURE', '    return text, False'),
    ], ['test_conversation_rules.py']),
    ('a short line is doubted on its score', 'orbs_kit/voicebox.py', [
        ('SURE_WORDS = 6', 'SURE_WORDS = 1'),
    ], ['test_conversation_rules.py']),
    ('a phantom is taken as said', 'orbs_kit/voicebox.py', [
        ('    if PHANTOMS.match(text):\n        return "", True\n', ''),
    ], ['test_conversation_rules.py']),
    ('a number ends no thought', 'orbs_kit/voicebox.py', [
        ('    last = re.findall(r"[a-z0-9\']+", t.lower())', '    last = re.findall(r"[a-z\']+", t.lower())'),
    ], ['test_conversation_rules.py']),
    ("a question ending on 'and' ends the turn", 'orbs_kit/voicebox.py', [
        ('    return not (t.endswith("?") and last[-1] in QUESTION_ENDS)', '    return not t.endswith("?")'),
    ], ['test_conversation_rules.py']),
    ('plain English swaps nothing', 'orbs_kit/voicebox.py', [
        ('    for r, to in _PLAIN:', '    for r, to in _PLAIN[:0]:'),
    ], ['test_conversation_rules.py']),
    ('a long sentence is said whole', 'orbs_kit/voicebox.py', [
        ('    if len(sentence.split()) <= LONGEST_WORDS:\n        return [sentence]', '    if True:\n        return [sentence]'),
    ], ['test_conversation_rules.py']),
    # school's exams graded by the kit (PLAN 5.7)
    ('passive voice is not measured', 'orbs_kit/school.py', [
        ('def _passive(sentence: str) -> str | None:\n', 'def _passive(sentence: str) -> str | None:\n    return None\n'),
    ], ['test_school.py']),
    ('a hard word costs nothing', 'orbs_kit/school.py', [
        ('        hard = [a for r, a in _HARD if r.search(s)]\n', '        hard = []\n'),
    ], ['test_school.py']),
    ('an instruction may run to 25 words', 'orbs_kit/school.py', [
        ('INSTRUCTION_WORDS = 20\n', 'INSTRUCTION_WORDS = 25\n'),
    ], ['test_school.py']),
    ('two instructions in a sentence pass', 'orbs_kit/school.py', [
        ('        if instruction and _instructions(s) > 1:\n', '        if False:\n'),
    ], ['test_school.py']),
    ('a wrong program passes', 'orbs_kit/school.py', [
        ('r.returncode == 0 and r.stdout.split() == t["output"].split()', 'r.returncode == 0'),
    ], ['test_school.py']),
    ('a program runs as long as it likes', 'orbs_kit/school.py', [
        ('text=True, timeout=p["run_s"], env=env,', 'text=True, env=env,'),
    ], ['test_school.py']),
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
    for shared in ("kit", "docs", "tools"):  # read-only inputs the home's tests use (the kit, the bake-off defaults, `pnpm cost`)
        if not (tmp / shared).exists():
            (tmp / shared).symlink_to(REPO / shared, target_is_directory=True)
    if not (tmp / "tsconfig.base.json").exists():  # the app's build reads it (Vite follows tsconfig's extends)
        (tmp / "tsconfig.base.json").symlink_to(REPO / "tsconfig.base.json")
    return pkgs


def copy_kit(tmp: Path) -> Path:
    """A scratch copy of the kit's own code and tests (kit/orbs_kit, kit/tests), the rest of the kit
    (Ash's carried modules, the models, its Python) linked, read only. Apart from copy_home's, whose
    kit/ stays the real one. Returns the directory that holds kit/."""
    root = tmp / "kitwork"
    if root.exists():
        shutil.rmtree(root)
    kit = root / "kit"
    kit.mkdir(parents=True)
    for part in ("orbs_kit", "tests"):
        shutil.copytree(KIT / part, kit / part, ignore=shutil.ignore_patterns("__pycache__"))
    for linked in ("ash", ".venv", "pyproject.toml", "uv.lock", ".python-version"):
        if (KIT / linked).exists():
            (kit / linked).symlink_to(KIT / linked, target_is_directory=(KIT / linked).is_dir())
    return root


def run_kit_suites(root: Path, suites: list[str]) -> subprocess.CompletedProcess[str]:
    """Kit suites (paths inside `root`), each script on the kit's own Python, as kit/tests/run.py
    runs them: red if any fails, or hangs past ten minutes."""
    py = KIT / ".venv" / "bin" / "python"
    out, code = [], 0
    for s in suites:
        try:
            r = subprocess.run([str(py), str(root / s)], cwd=root / "kit", capture_output=True, text=True, timeout=600, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            out.append(r.stdout + r.stderr)
            code = code or r.returncode
        except subprocess.TimeoutExpired:
            out.append(f"[{s} hung past 600 s]")
            code = code or 124
    return subprocess.CompletedProcess([str(py), *suites], code, "\n".join(out), "")


SUITE_CAP_S = 1800


def run_suites(work: Path, suites: list[str]) -> subprocess.CompletedProcess[str]:
    """The suites (paths inside `work`, the copied packages/), each test given two minutes. A run that
    still hangs past SUITE_CAP_S is red too: a defect that makes a test hang has been caught as surely as
    one that makes it fail. The voice suites go after the rest, one at a time, as the gate runs them."""
    # as the gate runs them (tools/run-ts-tests.mjs): a third of the cores at once, two minutes a test;
    # every core at once starved the picture suites past their limit (10-02), and half did too (the gate
    # went to a third on 10-04; this followed on 10-07, when the creator's hat colours, 21 s alone, ran past two minutes)
    at = max(2, (os.cpu_count() or 4) // 3)
    # the voice suites (Chromium's microphone, the kit's Kokoro and Whisper, all on the CPU) alone and last, as in
    # the gate (10-03); beside the others "a real conversation" heard two turns of three (10-07)
    alone = [s for s in suites if s.endswith("/voice.test.ts")]
    groups = [(g, n) for g, n in (([s for s in suites if s not in alone], at), (alone, 1)) if g]
    outs: list[str] = []
    code = 0
    for group, n in groups:
        cmd = ["node", "--test", "--test-timeout=120000", f"--test-concurrency={n}", *[str(work / s) for s in group]]
        # its own process group, so a hung run is ended with everything it started (a planted defect
        # that spawns two kits leaves one nobody will stop)
        p = subprocess.Popen(cmd, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        # thirty minutes, not ten (10-07): characters.test alone draws every hat on every shape, 33 of them,
        # and takes twelve minutes or more; ten cut a green baseline short and called it hung
        try:
            out, _ = p.communicate(timeout=SUITE_CAP_S)
            outs.append(out)
            code = code or p.returncode
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            out, _ = p.communicate()
            outs.append((out or "") + f"\n[hung past {SUITE_CAP_S} s]")
            code = 124
    return subprocess.CompletedProcess(["node", "--test", *suites], code, "\n".join(outs), "")


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # progress shows as it happens, even into a file
    fails = 0
    planted = [(name, f"home/{rel}", edits, [f"home/test/{s}" for s in ss]) for name, rel, edits, ss in MUTANTS]
    planted += [(name, f"terminal/{rel}", edits, [f"terminal/test/{s}" for s in ss]) for name, rel, edits, ss in TERMINAL_MUTANTS]
    planted += [(name, f"app/{rel}", edits, [f"app/test/{s}" for s in ss]) for name, rel, edits, ss in APP_MUTANTS]
    planted += [(name, f"kit/{rel}", edits, [f"kit/tests/{s}" for s in ss]) for name, rel, edits, ss in KIT_MUTANTS]
    if "--only" in sys.argv:
        # each --only TEXT adds the mutants whose file, name or suite has TEXT in it
        onlys = [sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--only"]
        planted = [m for m in planted if any(o in m[1] or o in m[0] or any(o in s for s in m[3]) for o in onlys)]
        if not planted:
            print(f"no mutant matches --only {' or '.join(map(repr, onlys))}")
            return 1
    if "--part" in sys.argv:
        # one share of the list, so a long run can go as several jobs, each under the 2-hour ceiling
        k, n = (int(x) for x in sys.argv[sys.argv.index("--part") + 1].split("/"))
        planted = planted[k - 1::n]
    suites = sorted({s for *_, ss in planted for s in ss if not s.startswith("kit/")})
    kit_suites = sorted({s for *_, ss in planted for s in ss if s.startswith("kit/")})
    with tempfile.TemporaryDirectory(prefix="orbs-mutants-") as td:
        tmp = Path(td)
        # M.0, the control for every line below: the copy with NOTHING planted must be green.
        # If it is red (a path the copy lacks, a missing dependency), every mutant would be
        # "caught" for that reason instead of its own, and this tool would prove nothing.
        bases = ([("the packages", run_suites(copy_home(tmp), suites))] if suites else []) + ([("the kit", run_kit_suites(copy_kit(tmp), kit_suites))] if kit_suites else [])
        for what, base in bases:
            print(f"{'PASS' if base.returncode == 0 else 'FAIL'}  M.0 the scratch copy of {what}, unmutated, is green")
            if base.returncode != 0:
                print("\n".join("    " + l for l in (base.stdout + base.stderr).splitlines()[-25:]))
                print("the baseline is red, so the mutants below would prove nothing")
                return 1
        for name, rel, edits, suites_for in planted:
            kit = rel.startswith("kit/")
            work = copy_kit(tmp) if kit else copy_home(tmp)
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
            caught = (run_kit_suites if kit else run_suites)(work, suites_for).returncode != 0
            print(f"{'PASS' if caught else 'FAIL'}  M: {', '.join(s.split('/test/')[-1] for s in suites_for)} catches: {name}")
            fails += not caught
    print("ALL PASS" if not fails else f"{fails} FAILED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
