import React from "react";
import { installPress } from "../motion";
import ReactDOM from "react-dom/client";
import Away from "./Away";
import { start } from "../renovation";
import "../face.css";
import "./away.css";

installPress();
start();   // the page's link to the engine: the creature's state, and this face says it is the phone
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Away />
  </React.StrictMode>,
);
