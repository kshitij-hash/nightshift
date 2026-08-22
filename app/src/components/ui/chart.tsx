// Recharts wrapper in the shadcn shape, de-defaulted hard.
//
// What this component exists to erase:
//   - Recharts' animation defaults. Every series in this product sets
//     isAnimationActive={false}. The ONE animation allowed on a chart is a
//     first-mount draw-in, and it runs from here, on our easing, never from
//     Recharts' own easing curve.
//   - Recharts' legend. There is no <Legend> in this codebase. Series are
//     named where they are drawn, with a direct label.
//   - Recharts' tooltip chrome. The tooltip is a data annotation: 11px mono,
//     one hairline border, no shadow, fade only.
//   - Recharts' default palette. Colors come from --chart-1..5 and nowhere
//     else, so both themes swap with the rest of the page.
//
// The draw-in is measured, not guessed: the line path is asked for its own
// length and the dash offset animates from that length to zero, which is the
// only way to draw a stroke of unknown length. Under reduced motion the
// chart is simply drawn, already finished, on the first paint.

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import type { TooltipContentProps } from "recharts";

import { cn } from "../../lib/utils";

const EASE_OUT = "cubic-bezier(0.25, 1, 0.5, 1)";
const DRAW_MS = 700;
const BAR_FADE_MS = 600;
/** ResponsiveContainer measures before it paints, so the series can be one or
 *  two frames behind the effect. Give it a bounded number of frames rather
 *  than an open-ended observer. */
const MAX_WAIT_FRAMES = 40;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The one sanctioned chart animation: first mount only, never on refresh.
 * Lines draw left to right on stroke-dashoffset; bars fade the layer they
 * sit behind. Both run on EASE_OUT and both are skipped entirely when the
 * reader asked for less motion.
 */
function useFirstMountDrawIn(enabled: boolean) {
  const host = React.useRef<HTMLDivElement | null>(null);
  const played = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || played.current) return;
    if (reducedMotion()) {
      played.current = true;
      return;
    }
    const node = host.current;
    if (!node) return;

    let frame = 0;
    let raf = 0;
    const tick = () => {
      const lines = node.querySelectorAll<SVGPathElement>("path.recharts-line-curve");
      const bars = node.querySelectorAll<SVGElement>("path.recharts-rectangle");
      if (lines.length === 0 && bars.length === 0) {
        if (frame++ > MAX_WAIT_FRAMES) return;
        raf = window.requestAnimationFrame(tick);
        return;
      }
      played.current = true;
      for (const bar of bars) {
        bar.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: BAR_FADE_MS,
          easing: EASE_OUT,
        });
      }
      for (const line of lines) {
        const length = line.getTotalLength();
        if (!Number.isFinite(length) || length === 0) continue;
        line.animate(
          [
            { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
            { strokeDasharray: `${length}`, strokeDashoffset: "0" },
          ],
          { duration: DRAW_MS, easing: EASE_OUT },
        );
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [enabled]);

  return host;
}

export function ChartContainer({
  height,
  children,
  className,
  drawIn = true,
  label,
}: {
  height: number;
  children: React.ReactElement;
  className?: string;
  /** Off for a chart that re-renders in place; the draw-in is a first-mount
   *  event and re-running it would report a state change that never happened. */
  drawIn?: boolean;
  /** Read out to assistive technology in place of the chart graphics. */
  label: string;
}) {
  const host = useFirstMountDrawIn(drawIn);
  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      style={{ height }}
      className={cn(
        "w-full",
        // axis + grid, in our tokens rather than Recharts' grays
        "[&_.recharts-cartesian-axis-line]:stroke-border-panel",
        "[&_.recharts-cartesian-axis-tick-line]:stroke-transparent",
        "[&_.recharts-cartesian-axis-tick_text]:fill-[var(--text-caption)]",
        "[&_.recharts-cartesian-axis-tick_text]:text-[10px]",
        "[&_.recharts-cartesian-grid_line]:stroke-border-row",
        "[&_.recharts-reference-line_line]:stroke-border-panel",
        // the hover cursor is a hairline, not a translucent block
        "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-[var(--accent-wash)]",
        "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border-field",
        "[&_.recharts-surface]:outline-none",
        className,
      )}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export type ChartTooltipRenderProps = TooltipContentProps<number, string>;

/**
 * The data-annotation tooltip. One border, no shadow, mono at the micro role.
 * `describe` gets the raw datum so a caller can put a block height or a tx
 * hash in the annotation without this component knowing what a charge is.
 */
export function ChartTooltipContent<T>({
  active,
  payload,
  describe,
}: {
  active?: boolean;
  payload?: ChartTooltipRenderProps["payload"];
  describe: (datum: T) => React.ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as T | undefined;
  if (datum === undefined) return null;
  return (
    <div className="border border-border-panel bg-surface-panel px-2.5 py-2 font-mono text-[11px] leading-[1.45] text-text-default">
      {describe(datum)}
    </div>
  );
}
