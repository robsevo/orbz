# The habit spike (PLAN 0.2)

**Question:** if an orb turns the work you approved into tested code every night, does it get
cheaper while staying right — and does it ever answer something it shouldn't?

Three tasks from the Dots film, on generated fixtures with a known right answer:

| Task | What the orb does | What stays with a model |
|---|---|---|
| `inbox` | sorts an inbox into needs-reply / bills / newsletters / fyi, parses bills | a one-line headline |
| `invoice` | drafts the invoice a client just agreed to in an email thread | the cover note |
| `calendar` | finds what a new meeting clashes with and the next 3 free slots | the reschedule note |

**Day:** one fresh case goes through the ladder: a promoted habit answers if it can; otherwise the
big brain does (`bedrock-brain`). The right answer stands in for your approval.
**Night:** the teacher (`think-brain`) writes a habit from the approved cases; the harness re-runs
every approved case through it inside `bwrap` (no network, no home folder, read-only disk) and
promotes it only if all pass.
**After 20 days:** held-out cases and planted odd cases (another currency, an all-day event, a
weekend meeting, an unfamiliar invoice term) go through the habit alone.

A habit only answers if three layers agree:

1. **familiar input** — a fingerprint learned by code from the approved inputs (keys, formats,
   unusual characters, weekday patterns)
2. **the teacher's guard** — the habit's own check
3. **a plausible answer** — a fingerprint learned by code from the approved outputs (a list that was
   never empty, a total that was always positive — once at least 10 approved answers back the rule)

Layers 1 and 3 exist because the first pilot showed layer 2 alone let 3 of 4 odd calendars through.

**Absorb before re-teaching.** When a case falls back and is approved, the harness first runs the
*current* habit on it. If the habit gets it right, only the familiarity checks were in the way: the
case joins the evidence and the fingerprints are re-learned, for zero teacher tokens. Only a case the
habit gets wrong pays for a recompile.

## Verdict

**GO — 3 of 3 fresh seeds (12, 13, 14) passed all four gates on all three tasks**, with the same
code: 100% held-out accuracy (97–100% answered), 0 odd inputs answered wrongly, token drops of
37–163×, break-even between day 4 and day 15. Full tables, history and caveats:
[`docs/spike-go-no-go.md`](../docs/spike-go-no-go.md).

## Go / no-go (PLAN 0.2_t)

G1 ≥ 60% of steps on habits over the last 5 days · G2 ≥ 95% of the held-out cases the habit
answers are right · G3 tokens per run down ≥ 10× · G4 zero wrong habit answers on odd inputs.

## Run

```bash
python3 test_spike.py                       # the harness's own tests (no model calls)
python3 aggregate.py runs/A runs/B runs/C   # the verdict across seeds -> ../docs/spike-go-no-go.md
python3 run_spike.py                        # the spike: free seats only, fallbacks disabled
python3 run_spike.py --tasks calendar --days 6 --heldout 8 --odd 4   # a quick pilot
```

Results go to `runs/<stamp>/` (`results.json`, `report.md`, `calls.jsonl`, the habits' code) and
the latest report to `../docs/spike-results.md`. Every call is in the ledger with its tokens.
