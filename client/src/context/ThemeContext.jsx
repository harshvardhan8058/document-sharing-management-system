import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "dsms.theme";
const THEMES = ["nebula", "daybreak"];

/**
 * Theme state, resolved once at the top of the tree.
 *
 * This lives in a provider rather than a plain hook because a hook would run
 * per-consumer: the sign-in screen (which does not use it) rendered in the dark
 * theme declared on `<html>`, while the dashboard flipped to light — two
 * different themes inside one session.
 *
 * The default is `nebula`. The dark theme *is* the product's identity, so the
 * OS preference is treated as a hint for first-time visitors only, and an
 * explicit choice always wins.
 */
function readStored() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : null;
  } catch {
    // Private-browsing modes can throw on storage access.
    return null;
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStored() || "nebula");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "nebula" ? "dark" : "light";
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* the in-memory value still applies for this session */
    }
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === "nebula" ? "daybreak" : "nebula"),
    [theme, setTheme]
  );

  const value = useMemo(
    () => ({ theme, setTheme, toggle, isDark: theme === "nebula" }),
    [theme, setTheme, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
