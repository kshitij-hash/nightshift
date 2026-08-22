// Media queries this surface reads at render time.
//
// The global CSS rule in tokens/motion.css collapses CSS animations and
// transitions on its own. It cannot reach the two engines that animate
// outside CSS: NumberFlow's per-digit roll and the chart's draw-in, both of
// which drive the Web Animations API directly. Those two ask here.
//
// The width query exists for one reason: the chart cannot express "drop the
// per-bar labels below this width" in CSS, because those labels are SVG text
// laid out from a measured plot area. Everything else on this page responds
// in CSS, at the framework's breakpoints.

import { useEffect, useState } from "react";

function useMediaQuery(query: string): boolean {
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

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Below the md breakpoint: the phone layout. */
export function useIsNarrow(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
