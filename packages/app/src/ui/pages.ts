// The arithmetic of a page of choices (ui/Paged.tsx), pure so a test can read it: three across,
// nine to a page (owner, 2026-10-01: "same amount of orbs and accessories per tab, with page
// numbers. 3 per row").
export const ACROSS = 3;
export const PER_PAGE = 9;

/** Which page holds item `i`. */
export const pageOf = (i: number): number => Math.max(0, Math.floor(i / PER_PAGE));
/** How many pages `n` items take. */
export const pagesFor = (n: number): number => Math.max(1, Math.ceil(n / PER_PAGE));
