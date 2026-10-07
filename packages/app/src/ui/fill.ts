// A room that fits the screen (owner, 10-07: "scrolling bar on the WHOLE CONVO that doesnt go past the
// screen just the chat cause or else i have to scroll ALLL THE WAY DOWN TO FIND SOMETHING AND ALL THE WAY
// UP AGAIN AFTER"). The room is as tall as what is left of the window below its top (the main area's own
// bottom margin kept), so the page never scrolls: what is inside it does, the conversation first.
import { useLayoutEffect, type RefObject } from "react";

export function useFillScreen(ref: RefObject<HTMLElement | null>, min = 360): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      const main = el.closest("main");
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const screen = window.visualViewport?.height ?? window.innerHeight;
      el.style.height = `${Math.max(min, Math.floor(screen - top - pad))}px`;
    };
    fit();
    const again = requestAnimationFrame(fit); // once the fonts and the header have settled
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(again);
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [ref, min]);
}
