// The grab sheet's page (grab.html): the full-screen sheet of Grab and Shelf (sol/README.md "Grab and Shelf"). Its own
// small tree, like the notch's: the sheet, the delegated press, its own stylesheet over the palette.
import React from "react";
import ReactDOM from "react-dom/client";
import { installPress } from "../motion";
import Sheet from "./Sheet";
import "../palette.css";
import "./grab.css";

installPress();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sheet />
  </React.StrictMode>,
);
