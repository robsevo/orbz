// The turns of a conversation by voice (PLAN 4.7: Tavus's turn-taking, Sparrow-2, made of our own
// parts), all by code and all counted in samples: no microphone, no network and no clock of its own,
// so a test can play it a whole conversation, sample by sample. The page (ears.ts) hands it each
// piece of sound as it comes and whether he is speaking or working; it says what to do (ask the home
// about a stretch of the sound, send your words, stop him, nod), and takes the home's answers back.
//
//   asleep     waiting for his name ("hey Hazel"): asked about the last 2.5 s, now and then, only
//              after a voice
//   following  your turn: it ends when you sound finished at your first pause (Smart Turn, with
//              words that do not trail off) or after 1.4 s of quiet; words that trail ("a table
//              for...", "um") or a turn that does not sound finished wait 5 s, and he nods
//   between    the conversation goes on with no name (owner, 10-03): your next words are your next
//              turn, until a quiet spell (20 s, him idle) or "thanks Hazel"; while he speaks, a voice
//              over him is asked about: his own words coming back, an "mhm" (he goes on), or you
//              taking the floor (he stops, and your turn has begun where your voice did)

export const RATE = 16000;
/** Louder than this (RMS) is someone speaking. */
export const VOICED = 0.012;
/** A pause this long asks whether you have finished; this long ends the turn whatever it says. */
export const EARLY_S = 0.4;
export const ENDPOINT_S = 1.4;
/** ...and this long when your words trail off, or you do not sound finished (Sparrow-2 holds a
 * thinking pause 6 to 8 s; a turn here is never cut short of 5). */
export const PATIENT_S = 5;
/** Smart Turn under this: you do not sound finished. */
export const UNFINISHED_P = 0.5;
/** A quiet spell this long, with him idle, ends the conversation: his name again after it. */
export const IDLE_S = 20;
/** A voice over him this long is asked about (a shorter sound is not even sent). */
export const OVERLAP_S = 0.4;
/** A turn starts a little before the voice was loud enough to count. */
export const PREROLL_S = 0.25;
/** Just after he stops speaking, what the microphone hears is still his voice in the room. */
export const TAIL_S = 0.35;
export const WINDOW_S = 2.5;
export const LONGEST_TURN_S = 20;
/** How often, while someone talks, the last moments are asked about for his name. */
const POLL_S = 1.2;

export type Ears = "listening" | "called" | "hearing" | "conversing";
export type Ask = { kind: "woken" | "turn" | "overlap"; from: number; to: number; final?: boolean };
export type Act = Ask | { kind: "heard"; words: string } | { kind: "missed" } | { kind: "interrupt" } | { kind: "ears"; ears: Ears } | { kind: "cue"; cue: "hop" | "nod" };
export type Turned = { finished: boolean; p: number; hold: boolean; words: string; unsure: boolean };
export type Overheard = { kind: "echo" | "backchannel" | "interrupt" | "nothing" | string };

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What was said, without the call in front of it ("Hey Hazel, what's on?" → "what's on?"). */
export function withoutCall(text: string, name: string): string {
  return text.replace(new RegExp(`^\\s*(?:(?:hey|hi|hello|okay|ok|yo)[,\\s]+)?${escape(name)}[,.!?\\s]*`, "i"), "").trim();
}

/** Whether `said` (the call already taken off) ends the conversation: "thanks", "that's all",
 * "bye Hazel", "stop listening", said alone. "Thanks Hazel, and one more thing" is a turn. */
export function endsConversation(said: string, name: string): boolean {
  const n = escape(name);
  const t = said.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  return new RegExp(`^(?:(?:ok|okay|alright|great|perfect) )?(?:thanks|thank you|cheers|that's all|that is all|that's it|bye|goodbye|good night|stop listening|go to sleep|never mind|nevermind)(?: (?:so much|very much))?(?: ${n.toLowerCase()})?$`).test(t);
}

export class Turns {
  readonly #name: string;
  #mode: "asleep" | "following" | "between" = "asleep";
  #total = 0; // samples heard so far: every position below is one of these
  #voicedAt = -Infinity; // the last voiced sample
  #since = 0; // samples since the name was last asked about
  #asked: Ask | null = null; // the one question in flight
  #turnFrom = 0; // where the turn being followed began
  #pauseAsked = false; // this pause was asked about (more silence is not news about what you said)
  #wait = ENDPOINT_S; // how long quiet ends this turn
  #early: { at: number; words: string; unsure: boolean } | null = null; // what the first pause heard
  #idleFrom = 0; // between turns: since when nothing has happened, him idle
  #heQuietAt = -Infinity; // when he last stopped speaking
  #wasSpeaking = false;
  #overFrom: number | null = null; // a voice over him began here...
  #overAskedTo = 0; // ...and was asked about up to here

  constructor(name: string) {
    this.#name = name;
  }

  get mode(): "asleep" | "following" | "between" {
    return this.#mode;
  }

  /** A piece of sound, `n` samples at `level` RMS, while he is (or is not) speaking or working. */
  hear(n: number, level: number, he: { speaking: boolean; busy: boolean }): Act[] {
    this.#total += n;
    this.#since += n;
    if (level > VOICED) {
      this.#voicedAt = this.#total;
      this.#pauseAsked = false;
    }
    if (this.#wasSpeaking && !he.speaking) this.#heQuietAt = this.#total;
    this.#wasSpeaking = he.speaking;
    const s = (samples: number): number => samples / RATE;
    const voiced = this.#voicedAt === this.#total;
    const quiet = s(this.#total - this.#voicedAt);
    const acts: Act[] = [];

    if (this.#mode === "asleep") {
      if (!this.#asked && s(this.#since) >= POLL_S && quiet < 1.5) {
        this.#since = 0;
        acts.push(this.#ask({ kind: "woken", from: Math.max(0, this.#total - WINDOW_S * RATE), to: this.#total }));
      }
      return acts;
    }

    if (this.#mode === "between") {
      if (he.speaking || he.busy) this.#idleFrom = this.#total;
      if (he.speaking) {
        // a voice over him: asked about once it has lasted OVERLAP_S, and again while it goes on
        if (voiced && this.#overFrom === null) {
          const onset = this.#total - n;
          this.#overFrom = Math.max(0, onset - PREROLL_S * RATE); // what is sent starts a little before...
          this.#overAskedTo = onset; // ...but how long it lasted counts from the voice
        }
        if (this.#overFrom !== null && quiet >= 0.6 && !this.#asked) this.#overFrom = null; // it ended: an "mhm" too short to ask about, or answered
        else if (this.#overFrom !== null && !this.#asked && s(this.#voicedAt - this.#overAskedTo) >= OVERLAP_S) {
          acts.push(this.#ask({ kind: "overlap", from: this.#overFrom, to: this.#total }));
        }
        return acts;
      }
      const over = this.#overFrom;
      if (over !== null && s(this.#total - this.#heQuietAt) < TAIL_S) return acts; // he just stopped: his own voice may still be in the room
      this.#overFrom = null;
      if (voiced && over !== null) {
        // he finished while you were talking over him, and you went on: your turn began where your voice did
        this.#follow(over);
        return [{ kind: "ears", ears: "called" }];
      }
      if (voiced && s(this.#total - this.#heQuietAt) >= TAIL_S) {
        // your next turn, with no name (the conversation goes on)
        this.#follow(Math.max(0, this.#total - n - PREROLL_S * RATE));
        return [{ kind: "ears", ears: "called" }];
      }
      if (!he.busy && s(this.#total - Math.max(this.#idleFrom, this.#voicedAt)) >= IDLE_S) {
        this.#mode = "asleep";
        this.#since = 0;
        return [{ kind: "ears", ears: "listening" }];
      }
      return acts;
    }

    // following your turn
    if (this.#asked) return acts; // one question at a time; the sound goes on being counted
    const long = s(this.#total - this.#turnFrom) >= LONGEST_TURN_S - 0.5;
    if (quiet >= this.#wait || long) {
      // the words the first pause heard serve, if nothing was said since: no second hearing
      if (this.#early && this.#early.at >= this.#voicedAt) return this.#end(this.#early.words, this.#early.unsure, this.#early.at);
      acts.push(this.#ask({ kind: "turn", from: this.#turnFrom, to: this.#total, final: true }), { kind: "ears", ears: "hearing" });
    } else if (quiet >= EARLY_S && !this.#pauseAsked) {
      this.#pauseAsked = true;
      acts.push(this.#ask({ kind: "turn", from: this.#turnFrom, to: this.#total }));
    }
    return acts;
  }

  /** The home's answer: was that him being called? */
  woke(w: { woken: boolean }): Act[] {
    const ask = this.#take("woken");
    if (!ask || !w.woken || this.#mode !== "asleep") return [];
    this.#follow(ask.from); // the call and what follows it are one turn, however slow the answer
    return [{ kind: "ears", ears: "called" }, { kind: "cue", cue: "hop" }];
  }

  /** The home's answer about your turn: at your first pause, or once it ended. */
  turned(t: Turned): Act[] {
    const ask = this.#take("turn");
    if (!ask || this.#mode !== "following") return [];
    if (ask.final) return this.#end(t.words, t.unsure, ask.to);
    if (this.#voicedAt > ask.to) return []; // you went on while it was asked: the answer is about a pause that is over
    if (t.finished) return this.#end(t.words, t.unsure, ask.to);
    this.#early = { at: ask.to, words: t.words, unsure: t.unsure };
    this.#wait = t.hold || t.p < UNFINISHED_P ? PATIENT_S : ENDPOINT_S;
    return [{ kind: "cue", cue: "nod" }]; // he is with you: a small nod at your pause
  }

  /** The home's answer about a voice over him. */
  overheard(o: Overheard): Act[] {
    const ask = this.#take("overlap");
    if (!ask || this.#mode !== "between") return [];
    if (o.kind === "interrupt") {
      this.#overFrom = null;
      this.#follow(ask.from); // your turn began where your voice did
      return [{ kind: "interrupt" }, { kind: "ears", ears: "called" }];
    }
    if (o.kind === "echo") this.#overFrom = null; // his own voice: a new voice is asked about afresh
    else this.#overAskedTo = ask.to; // an "mhm": asked again only if the voice goes on
    return [];
  }

  /** The question in flight failed (the home did not answer): the next moment may ask again. */
  failed(): void {
    this.#asked = null;
  }

  #ask(a: Ask): Ask {
    this.#asked = a;
    return a;
  }

  #take(kind: Ask["kind"]): Ask | null {
    const a = this.#asked;
    if (!a || a.kind !== kind) return null;
    this.#asked = null;
    return a;
  }

  #follow(from: number): void {
    this.#mode = "following";
    this.#turnFrom = from;
    this.#pauseAsked = false;
    this.#wait = ENDPOINT_S;
    this.#early = null;
  }

  #end(words: string, unsure: boolean, at: number): Act[] {
    const acts: Act[] = [];
    this.#mode = "between";
    this.#idleFrom = this.#total;
    this.#early = null;
    const said = withoutCall(words, this.#name);
    if (unsure) acts.push({ kind: "missed" }); // "didn't catch that": nothing reaches his brain
    else if (said && endsConversation(said, this.#name)) {
      this.#mode = "asleep";
      this.#since = 0;
      return [{ kind: "cue", cue: "hop" }, { kind: "ears", ears: "listening" }];
    } else if (said) acts.push({ kind: "heard", words: said });
    // (no words at all, a cough or a door: nothing is sent, nothing said)
    if (this.#voicedAt > at) {
      this.#follow(at); // you went on while it was being heard: that is your next turn, from there
      acts.push({ kind: "ears", ears: "called" });
    } else acts.push({ kind: "ears", ears: "conversing" });
    return acts;
  }
}
