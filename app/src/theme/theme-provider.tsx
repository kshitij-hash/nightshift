// Hand-rolled theme provider. No next-themes: this repo is a Vite SPA, not
// Next, and the whole thing is small enough that a dependency buys nothing.
//
// Default follows prefers-color-scheme. A manual toggle overrides it and
// persists to localStorage; the override sticks across reloads until the
// user clears it or toggles back to "system". Both data-theme and
// color-scheme are set on <html> so native form controls and scrollbars
// theme correctly too, not just the CSS custom properties.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "light" | "dark";
export type ThemePreference = ThemeChoice | "system";

const STORAGE_KEY = "nightshift-theme";

type ThemeContextValue = {
  /** The theme actually applied right now. */
  theme: ThemeChoice;
  /** What the user asked for: an explicit choice, or "system". */
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  /** Flips between light and dark, setting an explicit preference. */
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme"); // dark is the unmarked :root default
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const pref = readStoredPreference();
    return pref === "system" ? (systemPrefersLight() ? "light" : "dark") : pref;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setTheme(mql.matches ? "light" : "dark");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    if (pref === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
      setTheme(systemPrefersLight() ? "light" : "dark");
    } else {
      window.localStorage.setItem(STORAGE_KEY, pref);
      setTheme(pref);
    }
  }, []);

  const toggle = useCallback(() => {
    setPreference(theme === "light" ? "dark" : "light");
  }, [theme, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setPreference, toggle }),
    [theme, preference, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
