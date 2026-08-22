// Which feed rows are new since the page opened, so the feed can report an
// arrival once and then be still again.
//
// The first paint is not an arrival: everything already on chain when the page
// opened is history, and history gets the load stagger, not the accent flash.
// A row's entrance kind never changes after it is decided, so its animation
// style never changes either, so it runs exactly once.

import { useEffect, useRef, useState } from "react";

export type EntranceKind = "load" | "arrival";

/** Returns the entrance each row key has earned. */
export function useRowEntrance(keys: string[]): (key: string) => EntranceKind {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(keys);
  const seen = initial.current;
  return (key: string) => (seen.has(key) ? "load" : "arrival");
}

/**
 * Fires true for one short beat when the newest charge changes, and never on
 * the first read. The instrument's core uses it to flare once.
 */
export function useArrivalPulse(newestKey: string | null, ms: number): boolean {
  const previous = useRef<string | null | undefined>(undefined);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const wasFirst = previous.current === undefined;
    const changed = !wasFirst && previous.current !== newestKey;
    previous.current = newestKey;
    if (!changed || newestKey === null) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(id);
  }, [newestKey, ms]);

  return on;
}
