// No zoom into a text box on a phone (owner, 10-07: "mobile also, when pressing on a text box, dont zoom in").
// An iPhone zooms the page into any field it judges too small to read. The app's fields are 16 px on a phone (the
// stylesheet's touch rules), which should be enough, and still the iPhone zoomed. `maximum-scale=1` in the viewport
// stops it for good. iOS keeps pinch-to-zoom anyway (since iOS 10 it ignores the cap for your own pinch), but
// Android would honour the cap and lose pinch-to-zoom, and Android never zooms into a field: so the cap is set on
// iOS alone. Pure, given the page and the browser, so a test can hand it any of them.

/** An iPhone, an iPod or an iPad (an iPad asks for the desktop site, and says it is a Mac with a touch screen). */
export function isIOS(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
}

/** Caps the viewport's scale on iOS, once. Says whether it did. */
export function noFieldZoom(doc: { querySelector(sel: string): { content: string } | null }, nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  const meta = doc.querySelector('meta[name="viewport"]');
  if (!meta || !isIOS(nav) || /maximum-scale/.test(meta.content)) return false;
  meta.content = `${meta.content}, maximum-scale=1`;
  return true;
}
