import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { Router } from "./lib/router";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";

import "./styles/index.css";

/**
 * Provider order matters:
 *   Theme     — resolved before anything paints, so every screen agrees
 *   Router    — must wrap anything that reads the location
 *   Toast     — AuthProvider raises toasts when a session expires
 *   Auth      — everything else depends on the session
 */
/**
 * Register the offline shell.
 *
 * Production only: a service worker in front of the Vite dev server would serve
 * stale modules and make hot reload behave inexplicably. It never caches /api —
 * see public/sw.js for why that matters here.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // An unavailable service worker costs offline support and nothing else.
    });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <Router>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </Router>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
