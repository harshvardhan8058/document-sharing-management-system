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
