// Dev only (ship.html?dev=ship): the stamp and the new-stable line on their own, in a frame shaped like the action
// board's head and the composer under it, so Ship (#33) can be looked at and shot before See's ActionBoard mounts it.
// Everything is faked by cowork/stable.ts under ?dev=ship; nothing is sent anywhere.
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { Stamp } from "./Stamp";
import { StableLine } from "./StableLine";
import "../face.css";
import "../work/work.css";

function Frame() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--page)", color: "var(--ink)", font: "13px -apple-system, system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>actions</span>
        <span style={{ color: "var(--mute)", fontSize: 12 }}>main · 2dc6b98</span>
        <span style={{ flex: 1 }} />
        <Stamp others={["Frank", "Isaac"]} />
      </header>
      <div style={{ flex: 1 }} />
      <div style={{ padding: "0 22px 22px", maxWidth: 760, width: "100%", alignSelf: "center", boxSizing: "border-box" }}>
        <StableLine />
        <div style={{ height: 52, border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface)", color: "var(--mute)", padding: "15px 14px", boxSizing: "border-box", fontSize: 13 }}>Ask Sol…</div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><Frame /></StrictMode>);
