import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/index.css";

// Keep one release of compatibility with cached legacy 404 pages.
let legacy = false;
try {
  const redirect = sessionStorage.redirect;
  if (redirect) {
    delete sessionStorage.redirect;
    const url = new URL(redirect, location.origin);
    if (url.origin === location.origin) {
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      legacy = true;
    }
  }
} catch { /* Storage may be disabled. Navigation still works. */ }
const container = document.getElementById("root")!;
const app = <React.StrictMode><BrowserRouter basename={import.meta.env.BASE_URL}><App /></BrowserRouter></React.StrictMode>;
if (container.hasChildNodes() && !legacy) hydrateRoot(container, app);
else createRoot(container).render(app);
