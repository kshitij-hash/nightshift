// Hand-rolled theme provider. No next-themes: this repo is a Vite SPA, not
// Next, and the whole thing is small enough that a dependency buys nothing.
//
// Light is the default: a visitor with no stored choice gets light, whatever
// their operating system prefers. A manual toggle overrides it and persists to
// localStorage. "system" remains available as an explicit preference for a
// reader who asks for it, and only then does prefers-color-scheme decide.
// index.html applies the same rule inline before first paint, so there is no
// flash of the wrong theme; keep the two in step. Both data-theme and
// color-scheme are set on <html> so native form controls and scrollbars theme
// correctly too, not just the CSS custom properties.

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
/** No stored choice means light, not the operating system's preference. */
const DEFAULT_PREFERENCE: ThemePreference = "light";

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
  if (typeof window === "undefined") return DEFAULT_PREFERENCE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return DEFAULT_PREFERENCE;
}

function resolve(pref: ThemePreference): ThemeChoice {
  if (pref === "system") return systemPrefersLight() ? "light" : "dark";
  return pref;
}

function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme"); // dark is the unmarked :root default
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [theme, setTheme] = useState<ThemeChoice>(() => resolve(readStoredPreference()));

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
    window.localStorage.setItem(STORAGE_KEY, pref);
    setTheme(resolve(pref));
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
