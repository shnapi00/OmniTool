import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Globally disable default WebView2 context menu (Back, Forward, Reload, Inspect)
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Disable developer hotkeys like F5, Ctrl+R, F12, Ctrl+Shift+I, Ctrl+U
window.addEventListener("keydown", (e) => {
  if (
    e.key === "F5" ||
    (e.ctrlKey && (e.key === "r" || e.key === "R")) ||
    e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i")) ||
    (e.ctrlKey && (e.key === "u" || e.key === "U"))
  ) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
