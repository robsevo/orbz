// The app's build (PLAN 2.x). Relative paths, so the same build is served by the home from any path
// and opened by the render harness from a scratch server.
//
// Installable (PLAN 2.7): the build writes the web app manifest and the page's theme colour from
// the tokens (the only place a colour is written), with icons drawn from the orb itself
// (`public/icons/`, made by `tools/shoot_icons.ts`).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_THEME, SURFACES } from "./src/design/tokens.ts";
import { hex } from "./src/design/color.ts";

const ground = hex(SURFACES[DEFAULT_THEME].ground); // the splash a phone shows: the default theme's page

function installable(): Plugin {
  // each icon's address carries a stamp of what is in it: a phone keeps the icon it once fetched for an
  // address however it is served (owner, 10-04: "orbz logo still not changed for mobile"), so a new icon
  // needs a new address
  const icon = (file: string): string => `icons/${file}?v=${createHash("sha256").update(readFileSync(new URL(`./public/icons/${file}`, import.meta.url))).digest("hex").slice(0, 10)}`;
  const manifest = {
    name: "Orbz",
    short_name: "Orbz",
    description: "Your office of orbs: assistants that work on their own computer and form habits.",
    start_url: "./orbs.html",
    scope: "./",
    display: "standalone",
    background_color: ground,
    theme_color: ground,
    icons: [
      { src: icon("orbs-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon("orbs-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon("orbs-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return {
    name: "orbs-installable",
    transformIndexHtml: {
      order: "pre",
      handler: (html, ctx) =>
        ctx.filename.endsWith("orbs.html")
          ? html.replace(
              "</head>",
              `    <link rel="manifest" href="manifest.webmanifest" />\n    <meta name="theme-color" content="${ground}" />\n    <link rel="icon" type="image/png" sizes="32x32" href="${icon("orbs-32.png")}" />\n    <link rel="icon" type="image/png" sizes="16x16" href="${icon("orbs-16.png")}" />\n    <link rel="apple-touch-icon" sizes="180x180" href="${icon("orbs-apple-180.png")}" />\n    <meta name="apple-mobile-web-app-title" content="Orbz" />\n  </head>`,
            )
          : html,
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: `${JSON.stringify(manifest, null, 1)}\n` });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), installable()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { orbs: "orbs.html", specimen: "specimen.html" } },
  },
});
