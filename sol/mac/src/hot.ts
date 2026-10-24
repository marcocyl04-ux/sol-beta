// Vite's hot updates, as the page hears them (issue #15). Each page (main, notch, island) imports this once from its
// main.tsx and hears its own updates: an update that landed makes its parts shimmer (renovation.landed), a compile
// error is drawn in the taped part whose file it names (never Vite's red page: vite.config.ts turns the overlay off),
// and a full reload leaves a mark so the page comes back saying so. On the bundled face there is no import.meta.hot:
// nothing here runs, and the tape follows the engine's events alone.
// Part of the fence: the seat never edits this file (home/CLAUDE.md).
import { landed, compileError, reloading } from "./renovation";

type Update = { type: string; path: string; acceptedPath?: string };

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", (p: { updates?: Update[] }) => {
    const paths = (p.updates ?? []).flatMap((u) => [u.path, u.acceptedPath ?? ""]).filter(Boolean);
    if (paths.length) landed([...new Set(paths)]);
  });
  import.meta.hot.on("vite:error", (p: { err?: { message?: string; id?: string; loc?: { file?: string } } }) => {
    const err = p.err ?? {};
    compileError(err.id ?? err.loc?.file ?? "", err.message ?? "it does not build");
  });
  import.meta.hot.on("vite:beforeFullReload", () => reloading());
}

export {};
