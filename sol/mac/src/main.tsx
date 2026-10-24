import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { Site, Tape } from "./Site";
import { start } from "./renovation";
import "./hot";
import "./face.css";

// the app itself is loaded after the fence has mounted: a cold load with a broken edit in it shows the boundary, not a blank page (#16 blocker 5)
const App = lazy(() => import("./App"));

// the face is wrapped whole (a part that is not one of the named sites still never blanks the window) and the tape
// sits over it, outside it, so it lives on whatever breaks under it (Site.tsx, issue #15)
// the press animation comes from a seat-editable file: loaded after the mount, so a broken edit there cannot stop the page
void import("./motion").then((m) => m.installPress()).catch(() => {});
start();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Site name="face"><Suspense fallback={null}><App /></Suspense></Site>
    <Tape />
  </React.StrictMode>,
);
