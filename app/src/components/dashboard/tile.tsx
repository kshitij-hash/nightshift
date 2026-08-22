// The dashboard's metric tile.
//
// A tile is three things stacked, in this order, always: the label, the
// figure, and the basis the figure was derived from. A number whose basis
// cannot be printed under it does not go on this page. Where the data layer
// also returned a caveat, the tile carries an affordance that opens it in
// place, rather than a hover-only tooltip that a touch reader can never see.
//
// Rhythm is deliberately looser than the board: 32px of padding around a
// tile here, against 20px there. The two surfaces are not supposed to
// measure the same.

import NumberFlow from "@number-flow/react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { usePrefersReducedMotion } from "./use-media";

const NUMBER_TIMING = { duration: 480, easing: "cubic-bezier(0.25, 1, 0.5, 1)" } as const;
const OPACITY_TIMING = { duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)" } as const;

/**
 * The accent wash that reports a figure just changed, once, then leaves
 * nothing behind. Under reduced motion the wash is kept and shortened by the
 * global rule, because color carries the information here.
 */
function Flash({ token, children }: { token: string; children: React.ReactNode }) {
  const [run, setRun] = useState(0);
  const [seen, setSeen] = useState(token);
  // Derived during render, not in an effect: the wash belongs to the same
  // paint as the new figure, not to the paint after it.
  if (token !== seen) {
    setSeen(token);
    setRun((n) => n + 1);
  }
  return (
    <span
      key={run}
      className="inline-block"
      style={
        run > 0
          ? { animation: "ns-value-flash var(--flash-number) var(--ease-out) forwards" }
          : undefined
      }
    >
      {children}
    </span>
  );
}

/**
 * A figure that rolls per digit when a poll finds a new event, and sits still
 * otherwise. NumberFlow is the only numeric engine on this surface; reduced
 * motion swaps the digits instantly instead.
 */
export function LiveNumber({
  value,
  decimals = 0,
}: {
  value: number;
  decimals?: number;
}) {
  const still = usePrefersReducedMotion();
  const format = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  } as const;
  if (still) return <>{value.toLocaleString("en-US", format)}</>;
  return (
    <NumberFlow
      value={value}
      format={format}
      transformTiming={NUMBER_TIMING}
      opacityTiming={OPACITY_TIMING}
    />
  );
}

export function CaveatDisclosure({ caveat }: { caveat: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex w-fit min-h-11 items-center rounded-sm border border-border-field px-1.5",
          "text-[10px] font-medium tracking-[0.14em] uppercase md:min-h-6",
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open ? "text-ns-accent border-ns-accent" : "text-text-label hover:text-ns-accent",
        )}
      >
        {open ? "caveat, shown" : "caveat"}
      </button>
      {open ? (
        <p className="max-w-[46ch] text-[11px] leading-[1.45] text-text-caption">{caveat}</p>
      ) : null}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  unit,
  basis,
  caveat,
  /** Prefixed to the figure when a scan was capped and the number is a floor. */
  floor = false,
  /** Changes when the figure changes; drives the one-shot accent wash. */
  token,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  basis: string;
  caveat?: string;
  floor?: boolean;
  token: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 border border-border-panel bg-surface-panel px-6 py-7",
        className,
      )}
    >
      <div className="text-[10px] font-medium tracking-[0.18em] text-text-label">{label}</div>
      <div
        className="font-semibold tabular-nums text-text-strong"
        style={{ fontSize: 30, lineHeight: 1.1, letterSpacing: "-0.01em" }}
      >
        {floor ? <span className="text-text-label">{"≥ "}</span> : null}
        <Flash token={token}>{value}</Flash>
        {unit ? <span className="text-[13px] font-normal text-text-label"> {unit}</span> : null}
      </div>
      <p className="max-w-[46ch] text-[10px] leading-[1.5] text-text-caption">
        {floor ? "counted in the range that was read, not a total. " : null}
        {basis}
      </p>
      {footer}
      {caveat ? <CaveatDisclosure caveat={caveat} /> : null}
    </div>
  );
}
