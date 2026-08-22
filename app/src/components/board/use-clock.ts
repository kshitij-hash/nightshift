// The board's one running number: a clock anchored to the chain, not to the
// browser. It starts at the head block's timestamp and advances locally at
// 1 Hz, so what ticks on screen is the chain's notion of the time and every
// derived figure (T+, T-) shares that origin. A snapshot render freezes it,
// because nothing moved after the snapshot block and a running clock would
// imply otherwise.

import { useEffect, useState } from "react";

/** Unix seconds, ticking once a second while running. Returns the anchor
 *  itself when running is false or no anchor is known yet. */
export function useChainClock(anchorTs: number | null, running: boolean): number {
  // Re-anchoring is derived state, not a side effect: a fresh read arrives and
  // the clock restarts from it in the same render, with no extra paint at the
  // stale value in between. The wall clock is only ever read inside the
  // interval effect, so the render itself stays pure.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  if (anchorTs !== null && anchor !== anchorTs) {
    setAnchor(anchorTs);
    setElapsed(0);
  }

  useEffect(() => {
    if (!running || anchor === null) return;
    const startedAt = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running, anchor]);

  if (anchorTs === null) return 0;
  return running && anchor !== null ? anchor + elapsed : anchorTs;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Motion that carries information stays; motion that only decorates goes.
 *  Components read this to drop the ambient loop entirely rather than leaving
 *  a paused animation on the element. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
