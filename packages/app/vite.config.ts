// The app's build (PLAN 2.x). Relative paths, so the same build is served by the home from any path
// and opened by the render harness from a scratch server.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { orbs: "orbs.html", specimen: "specimen.html" } },
  },
});
