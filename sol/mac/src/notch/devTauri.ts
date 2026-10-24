// Dev only, outside Sol.app (a browser, the step-2 shots): a stand-in for the Tauri bridge so the notch page mounts.
// Every command fails, as it does when there is no app; window events never arrive.
const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
if (import.meta.env.DEV && !w.__TAURI_INTERNALS__) {
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "notch" }, currentWebview: { windowLabel: "notch", label: "notch" } },
    invoke: () => Promise.reject(new Error("no app")),
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}
export {};
