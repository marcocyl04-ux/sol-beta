import { defineConfig, transformWithOxc, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// A person's own button (sol/home/buttons, src/buttons/own.tsx) that does not parse is served and built as a module
// that throws, so it is one line on the shelf, never a red face or a failed build.
const ownButtons = (): Plugin => ({
  name: "sol-own-buttons",
  enforce: "pre",
  async transform(code, id) {
    if (!/\/home\/buttons\/[^/]+\.tsx$/.test(id)) return null;
    try { await transformWithOxc(code, id, { lang: "tsx" }); return null; }
    catch (e) {
      const m = String((e as Error)?.message ?? e).replace(/\u001b\[[0-9;]*m/g, "");   // eslint-disable-line no-control-regex
      const why = /\[[A-Z_]+\]\s*(.+)/.exec(m)?.[1] ?? m.split("\n")[0], at = /\.tsx:(\d+):\d+/.exec(m)?.[1];
      return `throw new Error(${JSON.stringify(`it does not parse${at ? ` at line ${at}` : ""}: ${why}`)});`;
    }
  },
});

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [ownButtons(), react()],
  // a person's own buttons live outside the face (sol/home/buttons): their react is the face's, from here
  resolve: { dedupe: ["react", "react-dom"] },

  // the pages: the desktop face, the phone doorway (served by the engine at /away), the notch, the first run is the face itself (#134), the grab sheet
  build: {
    rollupOptions: {
      input: { index: "index.html", away: "away.html", notch: "notch.html", grab: "grab.html", vibe: "vibe.html" },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // no red page over the window on a compile error: the face draws it in the part under work (src/hot.ts, issue #15)
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
          overlay: false,
        }
      : { overlay: false },
    // the face reads design data from sol/design (tempo.json)
    fs: { allow: [".."] },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
