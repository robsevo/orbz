// Choices in pages (owner, 2026-10-01: "same amount of orbs and accessories per tab, with page
// numbers. 3 per row"). Every picture tab of the creator is the same grid:
//   - three across, nine to a page;
//   - the page numbers under it, with a step back and a step on;
//   - a short last page filled with empty slots, so every page is the same size and nothing is
//     left alone on a row.
// Every page is in the page from the start (each thumbnail is drawn once); only the one you are
// on shows, and it slides in from the side you went.
import { useState, type ReactNode } from "react";
import { ACROSS, pageOf, pagesFor, PER_PAGE } from "./pages.ts";

const step = { font: "800 16px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, minWidth: 32, minHeight: 34, padding: "0 8px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)" } as const;

export function Paged({ items, at, label }: { items: ReactNode[]; /** the chosen item's index: the page opens on it */ at: number; label: string }) {
  const pages = pagesFor(items.length);
  const [page, setPage] = useState(() => pageOf(at));
  const [went, setWent] = useState<"on" | "back" | null>(null);
  // a roll of the dice that lands on another page takes you there, in the same render as the roll
  // (from an effect, the page followed a frame behind the choice it shows)
  const [lastAt, setLastAt] = useState(at);
  if (at !== lastAt) {
    setLastAt(at);
    if (at >= 0 && pageOf(at) !== page) {
      setWent(pageOf(at) > page ? "on" : "back");
      setPage(pageOf(at));
    }
  }
  const go = (p: number): void => {
    const to = Math.min(pages - 1, Math.max(0, p));
    if (to === page) return;
    setWent(to > page ? "on" : "back");
    setPage(to);
  };
  return (
    <div data-paged={label} style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
      {Array.from({ length: pages }, (_, p) => {
        const slice = items.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
        return (
          <div
            key={p}
            data-page={p + 1}
            hidden={p !== page}
            role="group"
            aria-label={`${label}, page ${p + 1} of ${pages}`}
            style={{ display: p === page ? "grid" : "none", gridTemplateColumns: `repeat(${ACROSS}, minmax(0, 1fr))`, gridAutoRows: "1fr", gap: 8, animation: p === page && went ? `orbs-page-${went} 320ms var(--m-spring)` : undefined }}
          >
            {slice}
            {Array.from({ length: PER_PAGE - slice.length }, (_, k) => (
              <div key={`empty-${k}`} data-empty aria-hidden style={{ borderRadius: 14, boxShadow: "inset 0 0 0 1.5px var(--hairline)", opacity: 0.45, minHeight: 60 }} />
            ))}
          </div>
        );
      })}
      {pages > 1 && (
        <nav aria-label={`${label} pages`} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 5, rowGap: 6 }}>
          {/* as many pages as there are choices (the owner keeps asking for more): a phone's row wraps rather than spill */}
          <button className="orbs-narrow" aria-label="Previous page" disabled={page === 0} onClick={() => go(page - 1)} style={{ ...step, opacity: page === 0 ? 0.4 : 1 }}>
            ‹
          </button>
          {Array.from({ length: pages }, (_, p) => (
            <button
              key={p}
              className="orbs-narrow"
              aria-label={`Page ${p + 1}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => go(p)}
              style={{ ...step, font: "800 14px/20px var(--font)", background: p === page ? "var(--accent-fill)" : "var(--fill)", boxShadow: p === page ? "inset 0 0 0 1.5px var(--accent)" : step.boxShadow, color: p === page ? "var(--text-1)" : "var(--text-3)" }}
            >
              {p + 1}
            </button>
          ))}
          <button className="orbs-narrow" aria-label="Next page" disabled={page === pages - 1} onClick={() => go(page + 1)} style={{ ...step, opacity: page === pages - 1 ? 0.4 : 1 }}>
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
