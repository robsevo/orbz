// No zoom into a text box on a phone (owner, 10-07: "mobile also, when pressing on a text box, dont zoom in"): on
// iOS the viewport's scale is capped, once, so Safari never zooms into a field; Android and a desk keep the page as
// it was (Android would honour the cap and lose pinch-to-zoom, and never zooms into a field). The page itself, in
// Chromium as an iPhone and as an Android phone, is phones.test.ts's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isIOS, noFieldZoom } from "../src/ui/zoom.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const page = () => {
  const meta = { content: "width=device-width, initial-scale=1, viewport-fit=cover" };
  return { meta, doc: { querySelector: (sel: string) => (sel === 'meta[name="viewport"]' ? meta : null) } };
};

test("an iPhone or an iPad gets its scale capped, once; Android and a desk keep the page as it was", () => {
  const iphone = page();
  assert.equal(noFieldZoom(iphone.doc, { userAgent: IPHONE }), true);
  assert.equal(iphone.meta.content, "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1");
  assert.equal(noFieldZoom(iphone.doc, { userAgent: IPHONE }), false, "once");
  assert.equal(iphone.meta.content.match(/maximum-scale/g)!.length, 1);
  const ipad = page();
  assert.equal(noFieldZoom(ipad.doc, { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 }), true, "an iPad asking for the desktop site");
  // controls: an Android phone, and a Mac with no touch screen, are left alone
  for (const [what, nav] of [["Android", { userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 }], ["a Mac", { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 0 }]] as const) {
    const p = page();
    assert.equal(noFieldZoom(p.doc, nav), false, what);
    assert.doesNotMatch(p.meta.content, /maximum-scale/, what);
  }
  assert.equal(isIOS({ userAgent: ANDROID }), false);
  assert.equal(noFieldZoom({ querySelector: () => null }, { userAgent: IPHONE }), false, "no viewport tag: nothing to do");
});
