// Mail about bills, the gym's running example (PLAN 3.2): runs that keep each bill as a reminder,
// as the event log has them, and the habit a teacher would write for them, by hand.
import type { EventLog } from "../../src/events.ts";

/** Mails about bills, each read against bills.csv and kept as a reminder, each approved (runs from `first`). */
export function approved(events: EventLog, orb: string, subjects = ["Rent", "Gym", "Water"], first = 101, reply = (subject: string) => `Kept ${subject} for you.`): number[] {
  return subjects.map((subject, n) => {
    const run = first + n;
    const where = { orb, conversation: "trigger:t1" };
    events.append("run.started", { run, items: [run] }, where);
    events.append("trace.step", { run, step: 0, kind: "input", items: [{ id: run, source: "trigger", text: `[Trigger: bills] New email: ${subject}`, data: { trigger: "t1", subject } }] }, where);
    events.append("trace.step", { run, step: 1, kind: "model", text: "", tool_calls: [{ id: "a", name: "read_file", arguments: JSON.stringify({ path: "bills.csv" }) }] }, where);
    events.append("trace.step", { run, step: 2, kind: "tool", call_id: "a", name: "read_file", result: "rent,1200\n" }, where);
    events.append("trace.step", { run, step: 3, kind: "model", text: "", tool_calls: [{ id: "b", name: "remind", arguments: JSON.stringify({ kind: "bill", title: subject, due: "2026-10-06" }) }] }, where);
    events.append("trace.step", { run, step: 4, kind: "tool", call_id: "b", name: "remind", result: "Kept (bill 1)." }, where);
    events.append("trace.step", { run, step: 5, kind: "model", text: reply(subject), tool_calls: [] }, where);
    events.append("run.finished", { run, outcome: "ok" }, where);
    events.append("trace.feedback", { run, verdict: "approve" }, where);
    return run;
  });
}

/** The habit for them: read the bills, keep the one the mail is about, say so. */
export const GOOD = `def guard(inp):
    if not isinstance(inp.get("data", {}).get("subject"), str):
        return "no subject"
    return None

def step(inp, done):
    subject = inp["data"]["subject"]
    if len(done) == 0:
        return {"call": {"name": "read_file", "args": {"path": "bills.csv"}}}
    if len(done) == 1:
        return {"call": {"name": "remind", "args": {"kind": "bill", "title": subject, "due": "2026-10-06"}}}
    return {"output": "Kept " + subject + " for you."}
`;

/** A teacher's reply around some code, with the claim a teacher makes (never read). */
export const reply = (code: string): string => `Here is the habit.\n\n\`\`\`python\n${code}\`\`\`\n\nAll runs pass.`;
