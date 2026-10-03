// A lesson on his canvas (PLAN 4.4), in his computer: Ash's canvas (teach/canvas.html, carried,
// served by the home) a step at a time. A step's words are its caption and its drawing plays; its
// question waits for your answer, judged with what the canvas shows; Tell me has him answer it from
// the drawing; Next moves on; Stop ends it. His words are spoken when his replies are (4.3).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Character } from "../orb/spec.ts";
import type { LessonState, Office } from "../home/link.ts";
import { speak, stopSpeaking } from "../orb/speech.ts";

/** The canvas's own API (window.teach); every op resolves when its animation ends. */
type Teach = Record<string, (...a: unknown[]) => Promise<unknown>> & { ready?: boolean; facts: () => Record<string, unknown> };
/** Ash's driver names (teachcanvas.py) where the canvas's differ. */
const ALIAS: Record<string, string> = { init: "makeSet", prepare: "rate" };
const SKIP = new Set(["refit", "zoom"]); // nothing to do on a canvas that fills its frame

const button: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "8px 12px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 34, flex: "0 0 auto" };

export function LessonView({ home, orb, lesson, voice }: { home: Office; orb: Character; lesson: LessonState; voice: { speed: number; speaks: boolean } }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [drawnTo, setDrawnTo] = useState(0); // the steps played on the canvas so far
  const [answer, setAnswer] = useState("");
  const [said, setSaid] = useState<{ text: string; correct: boolean | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const step = lesson.steps[lesson.step - 1];
  const teach = (): Teach | null => ((frame.current?.contentWindow as unknown as { teach?: Teach } | null)?.teach ?? null);

  // the canvas plays each step it has not played yet, in order (all of them after a reload)
  useEffect(() => {
    if (!ready) return;
    let gone = false;
    void (async () => {
      const t = teach();
      if (!t) return;
      for (let n = drawnTo + 1; n <= lesson.step && !gone; n++) {
        const st = lesson.steps[n - 1]!;
        await t.caption?.(st.text);
        for (const op of st.do) {
          const [name, ...args] = op as [string, ...unknown[]];
          if (SKIP.has(name)) continue;
          const fn = t[ALIAS[name] ?? name];
          if (fn) await fn(...args);
        }
        if (!gone) setDrawnTo(n);
      }
    })();
    return () => {
      gone = true;
    };
  }, [ready, lesson.step]);

  // a new step: his words, and the question, spoken when his replies are
  useEffect(() => {
    setSaid(null);
    setAnswer("");
    if (step && voice.speaks) void speak(home, orb, voice.speed, [step.text, step.question].filter(Boolean).join(" "));
    return () => stopSpeaking();
  }, [lesson.id, lesson.step]);

  const facts = (): Record<string, unknown> => teach()?.facts() ?? {};
  const act = (fn: () => Promise<void>): void => {
    setBusy(true);
    fn().catch((e: Error) => setSaid({ text: e.message, correct: null })).finally(() => setBusy(false));
  };
  const reply = (text: string, correct: boolean | null): void => {
    setSaid({ text, correct });
    if (voice.speaks && text) void speak(home, orb, voice.speed, text);
  };

  return (
    <div data-lesson={lesson.id} style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ flex: "1 1 auto", minWidth: 0, font: "700 14px/20px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lesson.title}</span>
        <span data-step style={{ flex: "0 0 auto", font: "500 12px/16px var(--font)", color: "var(--text-3)" }}>{`Step ${lesson.step} of ${lesson.steps.length}`}</span>
      </div>
      <iframe
        ref={frame}
        title={`${orb.name}'s canvas`}
        src={home.lessonCanvasUrl()}
        onLoad={() => {
          // the canvas says when its API is up
          const wait = (tries: number): void => {
            if (teach()?.ready) setReady(true);
            else if (tries > 0) setTimeout(() => wait(tries - 1), 100);
          };
          wait(100);
        }}
        style={{ width: "100%", aspectRatio: "16 / 9", border: 0, borderRadius: 10, background: "var(--raised)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}
      />
      {step && <p data-step-text style={{ margin: 0, font: "400 14px/20px var(--font)", color: "var(--text-1)" }}>{step.text}</p>}
      {step?.question && <p data-question style={{ margin: 0, font: "600 14px/20px var(--font)", color: "var(--text-1)" }}>{step.question}</p>}
      {said && (
        <p data-said={said.correct === null ? "unjudged" : said.correct ? "right" : "not-yet"} style={{ margin: 0, font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>
          {said.text}
        </p>
      )}
      {step?.question && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!answer.trim() || busy) return;
            act(async () => {
              const j = await home.lessonAnswer(orb, answer.trim(), facts());
              reply(j.say, j.correct);
            });
          }}
          style={{ display: "flex", gap: 8, minWidth: 0 }}
        >
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            aria-label="Your answer"
            placeholder="Your answer"
            style={{ flex: "1 1 auto", minWidth: 0, font: "400 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" }}
          />
          <button type="submit" disabled={busy || !answer.trim()} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", opacity: answer.trim() ? 1 : 0.5 }}>
            Answer
          </button>
        </form>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {step?.question && (
          <button type="button" disabled={busy} onClick={() => act(async () => reply(await home.lessonExplain(orb, facts()), null))} style={button}>
            Tell me
          </button>
        )}
        <button type="button" disabled={busy || drawnTo < lesson.step} onClick={() => act(async () => void (await home.lessonNext(orb)))} style={button}>
          {lesson.step >= lesson.steps.length ? "Finish" : "Next"}
        </button>
        <button type="button" disabled={busy} onClick={() => act(async () => void (await home.lessonStop(orb)))} style={button}>
          Stop
        </button>
      </div>
    </div>
  );
}
