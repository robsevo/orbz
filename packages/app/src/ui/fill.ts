// A room that fits the screen (owner, 10-07: "scrolling bar on the WHOLE CONVO that doesnt go past the
// screen just the chat cause or else i have to scroll ALLL THE WAY DOWN TO FIND SOMETHING AND ALL THE WAY
// UP AGAIN AFTER"). The room is as tall as what is left of the window below its top (the main area's own
// bottom margin kept), so the page never scrolls: what is inside it does, the conversation first.
//
// The window is the page's own (the layout viewport), never the part a phone's keyboard leaves showing (the
// visual one; owner, 10-08: "The chat in mobile navigates to a empty bottom"). The keyboard covers the page,
// and Safari pans the page up to the box you type in; a room cut down to what the keyboard left was panned
// past, onto nothing below it. 100dvh follows the browser's bars as they come and go, and never the keyboard.
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const DVH = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("height", "100dvh");

/** Whether the screen is small for a conversation (narrow or short): its room's header draws smaller. */
export function useCramped(query = "(max-width: 760px), (max-height: 720px)"): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const q = typeof matchMedia === "function" ? matchMedia(query) : null;
    if (!q) return;
    const changed = (): void => setOn(q.matches);
    // what changed before this listener was there (a first shader compile can hold effects back for seconds), or a
    // new query from the caller
    changed();
    q.addEventListener("change", changed);
    return () => q.removeEventListener("change", changed);
  }, [query]);
  return on;
}

export function useFillScreen(ref: RefObject<HTMLElement | null>, min = 360): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      const main = el.closest("main");
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const above = Math.ceil(el.getBoundingClientRect().top + window.scrollY + pad);
      el.style.height = DVH ? `max(${min}px, calc(100dvh - ${above}px))` : `${Math.max(min, Math.floor(window.innerHeight - above))}px`;
    };
    fit();
    const again = requestAnimationFrame(fit); // once the fonts and the header have settled
    window.addEventListener("resize", fit); // a turned phone, a wider window: the header above may wrap anew
    return () => {
      cancelAnimationFrame(again);
      window.removeEventListener("resize", fit);
    };
  }, [ref, min]);
}
