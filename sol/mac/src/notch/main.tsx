import "./devTauri";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { Site, Tape } from "../Site";
import { start } from "../renovation";
import "../hot";
import "../face.css";
import "./notch.css";

// the app itself is loaded after the fence has mounted: a cold load with a broken edit in it shows the boundary, not a blank page (#16 blocker 5)
const Notch = lazy(() => import("./Notch"));

// the notch is one site of its own (its tape goes round the slab); the crew it sends down reads the same store
// the press animation comes from a seat-editable file: loaded after the mount, so a broken edit there cannot stop the page
void import("../motion").then((m) => m.installPress()).catch(() => {});
start();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Site name="notch" measure=".slab"><Suspense fallback={null}><Notch /></Suspense></Site>
    <Tape />
  </React.StrictMode>,
);
