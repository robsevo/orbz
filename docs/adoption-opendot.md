# Open Dot → Orbs: adoption map (ideas only)

Source read: `composio-community/open-dot` @ `f838e17` (created 2026-09-29). **No licence** — no
LICENSE file, no `license` field in `package.json` — so its code is all-rights-reserved. Orbs takes
the *ideas* below and implements them from scratch. `tools/copyscan/copyscan.py` runs against the
checkout and must stay CLEAN (PLAN 0.4_t). Reusing any actual file needs Composio to add MIT or
Apache-2.0 first; that request is the owner's to post.

`[ ]` not built · `[x]` built in Orbs, its test green, copyscan clean.

| # | Idea | Where they do it | Orbs row | Orbs home (planned) | Status |
|---|---|---|---|---|---|
| O.1 | An inbox per agent: one run at a time, batched per destination, an after-queue, pause / resume / stop, status (idle · working · waiting · paused) and a live activity line | `src/server/agent/runtime.ts` | 1.2 | `packages/home/src/inbox.ts` — durable (theirs lives in memory); their in-memory after-queue becomes O.2's saved resume, queued as an inbox item | [x] |
| O.2 | Durable card pauses: the pending run (response, calls, index, card, trigger) is saved; answering resumes at the exact call; a new message expires the card and closes the remaining calls | `runtime.ts` (pending state, resolve, close) | 1.5 | `packages/home/src/cards.ts` | [ ] |
| O.3 | Tool metadata: label, plain-words `describe(args)` for rule matching, default decision, precheck, detail, pause kind (question · approval · connect) | `src/server/agent/tools.ts` | 1.5 | `packages/home/src/tools/` | [ ] |
| O.4 | Plain-English rules matched by a small model; never > ask > allow; cautious when the matcher fails; "Always allow" on a card writes a rule | `src/server/agent/review.ts` | 1.6 | `packages/home/src/rules.ts` (on top of the code floor) | [ ] |
| O.5 | Each schedule and trigger gets its own conversation; trigger runs start from fresh context; unwatched runs report with a titled update | `runtime.ts`, `src/server/agent/prompt.ts` | 1.2, 1.5 | `packages/home/src/schedule.ts`, `triggers.ts` (own conversation + fresh context: done in 1.2; the titled update waits for 1.5) | [ ] |
| O.6 | Cron schedules that never overlap a still-running job | `src/server/scheduler.ts` | 1.2 | `packages/home/src/schedule.ts` — plus catch-up: missed due times fold into one run on waking (theirs are skipped) | [x] |
| O.7 | Browser driven by visible text (click by label, type into a named field, read the page) for models with no vision; risky words (pay, buy, book, send, submit, delete, cancel…) default to ask | `src/server/computer/dom-actions.ts` | 4.1 | `packages/home/src/computer/browser.ts` | [ ] |
| O.8 | Computer lifecycle — wake, sleep, reset, take over, hand back — and mode choice (cloud → docker → local folder) | `src/server/computer/index.ts` | 4.1 | `packages/home/src/computer/` | [ ] |
| O.9 | Password vault: encrypted at rest, key in the OS keychain, typed into the page, never shown to the model | `src/server/vault.ts` | 4.1 | `packages/home/src/vault.ts` | [ ] |
| O.10 | Group channels: a lead plus @mentions; delegation to another agent with a depth limit; the helper's reply shown in the channel | `runtime.ts`, `prompt.ts` | 5.1 | `packages/home/src/team.ts` | [ ] |
| O.11 | Starter characters with a purpose each, and a look editor | `src/lib/look.ts`, `src/components/LookEditor.tsx` | 2.2, 2.5 | `packages/web/src/character/` (our own bean family) | [ ] |
| O.12 | A voice call's transcript folded into the next text turn | `runtime.ts`, `src/server/voice.ts` | 4.3 | `kit/` voice + `packages/home/src/inbox.ts` | [ ] |

**Deliberately not taken:** the Next.js server (Orbs' home is a plain Node process that runs
headless), OpenAI Responses-API threads (Orbs speaks plain OpenAI-compatible chat to any brain and
keeps its own trimmed history), Composio at the centre (optional add-on), E2B as the default computer.
