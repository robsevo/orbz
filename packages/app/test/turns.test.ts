// PLAN 4.7_t, the turns of a conversation by voice, by code (src/orb/turns.ts): a conversation
// played into the machine sample by sample, the home's answers given by hand. No microphone, no
// network, no clock: what is measured is where each turn starts and ends.
//   - his name once, then turns with no name, until a quiet spell or "thanks Hazel";
//   - patience: words that trail, or a turn that does not sound finished, wait 5 s, not 1.4;
//   - the first pause's words serve at the end, unless you said more; a stale answer ends nothing;
//   - over him: an "mhm" or his own words never stop him; you taking the floor does, from your voice;
//   - "didn't catch that" for what Whisper doubted; a cough sends nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Act, ENDPOINT_S, endsConversation, IDLE_S, PATIENT_S, RATE, Turns, withoutCall } from "../src/orb/turns.ts";

const CHUNK = 2048; // the page's script processor hands over this many samples at a time
const LOUD = 0.05;
type He = { speaking: boolean; busy: boolean };
const IDLE: He = { speaking: false, busy: false };

/** Plays `seconds` of sound at `level` into the machine; every act it asked for, in order. */
function play(t: Turns, seconds: number, level: number, he: He = IDLE): Act[] {
  const acts: Act[] = [];
  for (let i = 0; i < Math.round((seconds * RATE) / CHUNK); i++) acts.push(...t.hear(CHUNK, level, he));
  return acts;
}
const kinds = (acts: Act[]): string[] => acts.map((a) => (a.kind === "ears" ? `ears:${a.ears}` : a.kind === "cue" ? `cue:${a.cue}` : a.kind));
const asked = (acts: Act[], kind: string): Act | undefined => acts.find((a) => a.kind === kind);
const turn = (words: string, o: Partial<{ finished: boolean; p: number; hold: boolean; unsure: boolean }> = {}) => ({ finished: false, p: 0.99, hold: false, unsure: false, words, ...o });

/** A machine already called by name, following your turn. */
function called(): Turns {
  const t = new Turns("Hazel");
  const a = play(t, 1.5, LOUD);
  assert.ok(asked(a, "woken"), "a voice is asked about for his name");
  assert.deepEqual(kinds(t.woke({ woken: true })), ["ears:called", "cue:hop"], "called: he leans in");
  return t;
}

test("his name once: then your next words are your next turn, until a quiet spell", () => {
  const t = called();
  let a = play(t, 0.5, 0);
  assert.ok(asked(a, "turn"), "your first pause is asked about");
  assert.deepEqual(t.turned(turn("Hey Hazel, what is on today?", { finished: true })), [{ kind: "heard", words: "what is on today?" }, { kind: "ears", ears: "conversing" }], "your words, without the call");
  assert.equal(t.mode, "between");
  // the next words, no name: a turn of their own
  assert.deepEqual(kinds(play(t, 1, LOUD).filter((x) => x.kind === "ears")), ["ears:called"], "no 'hey Hazel' needed");
  a = play(t, 0.5, 0);
  const heard = t.turned(turn("And tomorrow?", { finished: true }));
  assert.deepEqual(heard.find((x) => x.kind === "heard"), { kind: "heard", words: "And tomorrow?" });
  // a quiet spell with him idle ends it; while he works or speaks, the spell does not run
  assert.equal(kinds(play(t, IDLE_S + 5, 0, { speaking: false, busy: true })).length, 0, "while he works, the conversation waits");
  assert.equal(kinds(play(t, IDLE_S - 1, 0)).length, 0);
  assert.deepEqual(kinds(play(t, 2, 0)), ["ears:listening"], "a quiet spell: his name again");
  assert.equal(t.mode, "asleep");
});

test("'thanks Hazel' ends the conversation and is not sent; a thank-you with more in it is a turn", () => {
  assert.equal(endsConversation(withoutCall("Thanks, Hazel.", "Hazel"), "Hazel"), true);
  assert.equal(endsConversation("that's all", "Hazel"), true);
  assert.equal(endsConversation("thanks Hazel, and one more thing", "Hazel"), false);
  const t = called();
  play(t, 0.5, 0);
  assert.deepEqual(kinds(t.turned(turn("Thank you, Hazel.", { finished: true }))), ["cue:hop", "ears:listening"]);
  assert.equal(t.mode, "asleep");
});

test("patience: words that trail, or a turn that does not sound finished, wait 5 s; the first pause's words serve", () => {
  for (const answer of [turn("I want to book a table for", { hold: true, p: 0.98 }), turn("so I was thinking", { p: 0.2 })]) {
    const t = called();
    play(t, 0.5, 0);
    assert.deepEqual(kinds(t.turned(answer)), ["cue:nod"], "he nods at your pause");
    assert.equal(kinds(play(t, PATIENT_S - 0.8, 0)).length, 0, `still yours past ${ENDPOINT_S} s`);
    const end = play(t, 1, 0);
    assert.deepEqual(kinds(end), ["heard", "ears:conversing"], "and over at 5 s, on the words already heard: no second hearing");
  }
  // CONTROL: sounding unfinished-ish but over the line, it ends at 1.4 s
  const t = called();
  play(t, 0.5, 0);
  t.turned(turn("Is it raining", { p: 0.9 }));
  assert.deepEqual(kinds(play(t, ENDPOINT_S, 0)), ["heard", "ears:conversing"]);
});

test("you went on: a stale pause ends nothing, and new words are heard again", () => {
  const t = called();
  play(t, 0.5, 0);
  play(t, 0.6, LOUD); // you go on while the first pause is being asked about
  assert.deepEqual(t.turned(turn("Book a table", { finished: true })), [], "an answer about a pause that is over ends nothing");
  play(t, 0.5, 0);
  t.turned(turn("Book a table for two", { p: 0.9 })); // the second pause: not finished
  const end = play(t, ENDPOINT_S, 0);
  assert.ok(!asked(end, "turn"), "nothing said since the second pause: its words serve");
  assert.deepEqual(end.find((x) => x.kind === "heard"), { kind: "heard", words: "Book a table for two" });
});

test("over him: an 'mhm' or his own words never stop him; you taking the floor does, from where your voice began", () => {
  const t = called();
  play(t, 0.5, 0);
  t.turned(turn("Tell me about the moon.", { finished: true }));
  const SPEAKING: He = { speaking: true, busy: true };
  play(t, 2, 0, SPEAKING);
  assert.equal(kinds(play(t, 0.25, LOUD, SPEAKING)).length, 0, "a sound too short is not even asked about");
  play(t, 1, 0, SPEAKING);
  let a = play(t, 0.5, LOUD, SPEAKING);
  const mhm = asked(a, "overlap");
  assert.ok(mhm, "a voice over him is asked about");
  assert.deepEqual(t.overheard({ kind: "backchannel" }), [], "an 'mhm': he goes on");
  play(t, 1, 0, SPEAKING);
  a = play(t, 0.5, LOUD, SPEAKING);
  assert.ok(asked(a, "overlap"));
  assert.deepEqual(t.overheard({ kind: "echo" }), [], "his own words coming back: he goes on");
  play(t, 1, 0, SPEAKING);
  a = play(t, 0.5, LOUD, SPEAKING);
  const mine = asked(a, "overlap") as Act & { from: number };
  assert.deepEqual(kinds(t.overheard({ kind: "interrupt" })), ["interrupt", "ears:called"], "you take the floor: he stops and listens");
  const ask = asked(play(t, 0.5, 0), "turn") as (Act & { from: number }) | undefined;
  assert.equal(ask?.from, mine.from, "your turn began where your voice over him did");
});

test("a voice that goes on past his tail is your turn from its start; his own tail is not", () => {
  const t = called();
  play(t, 0.5, 0);
  t.turned(turn("Go on.", { finished: true }));
  const SPEAKING: He = { speaking: true, busy: false };
  play(t, 1, 0, SPEAKING);
  play(t, 0.2, LOUD, SPEAKING); // a voice starts as he finishes
  assert.equal(kinds(play(t, 0.2, LOUD)).length, 0, "just after he stops: not decided yet");
  assert.deepEqual(kinds(play(t, 0.3, LOUD)), ["ears:called"], "it goes on: your turn");
  // CONTROL: his own voice in the room, a moment after he stops, starts nothing
  const u = called();
  play(u, 0.5, 0);
  u.turned(turn("Go on.", { finished: true }));
  play(u, 1, 0, SPEAKING);
  assert.equal(kinds(play(u, 0.2, LOUD)).length, 0, "his tail, not your turn");
});

test("'didn't catch that' for what Whisper doubted; a cough sends nothing", () => {
  const t = called();
  play(t, 0.5, 0);
  assert.deepEqual(kinds(t.turned(turn("Where I'm sitting, I'm not sitting.", { finished: true, unsure: true }))), ["missed", "ears:conversing"], "doubted: nothing reaches his brain");
  play(t, 1, LOUD);
  play(t, 0.5, 0);
  assert.deepEqual(kinds(t.turned(turn("", { finished: false, p: 0.9 }))), ["cue:nod"]);
  assert.deepEqual(kinds(play(t, ENDPOINT_S, 0)), ["ears:conversing"], "no words at all: nothing sent, nothing said");
});

test("asleep, he wakes only to his name; a failed question is asked again", () => {
  const t = new Turns("Hazel");
  const a = play(t, 1.5, LOUD);
  assert.ok(asked(a, "woken"));
  assert.deepEqual(t.woke({ woken: false }), [], "not his name");
  assert.equal(t.mode, "asleep");
  play(t, 1.2, LOUD);
  t.failed();
  assert.ok(asked(play(t, 1.3, LOUD), "woken"), "after a failure, the next moment asks again");
});
