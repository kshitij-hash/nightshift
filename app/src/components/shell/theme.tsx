// After Dark by default, Daybreak on request. The choice lives on <html> as
// data-theme and in localStorage; index.html applies it before first paint.

import { useCallback, useSyncExternalStore } from "react";

const KEY = "nightshift.theme";
export type Theme = "dark" | "light";

const listeners = new Set<() => void>();
const read = (): Theme =>
  typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

let switching: number | null = null;

export function setTheme(next: Theme): void {
  // Every colour on the page crossfades for one beat, then the transitions
  // come off again so nothing else is slowed down afterwards.
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  if (switching !== null) window.clearTimeout(switching);
  switching = window.setTimeout(() => root.removeAttribute("data-theme-switching"), 300);
  if (next === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  try {
    if (next === "light") localStorage.setItem(KEY, "light");
    else localStorage.removeItem(KEY);
  } catch {
    // storage refused; the choice lasts for this page
  }
  for (const cb of listeners) cb();
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  const toggle = useCallback(() => setTheme(read() === "light" ? "dark" : "light"), []);
  return { theme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "light" ? "After Dark" : "Daybreak";
  return (
    <button type="button" className="ad-chip" onClick={toggle} aria-label={`switch to ${next}`}>
      <span aria-hidden="true">{theme === "light" ? "☾" : "☼"}</span>
      {next}
    </button>
  );
}
