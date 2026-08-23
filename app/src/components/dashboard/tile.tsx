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
import { CaveatDisclosure } from "../board/primitives";
import { usePrefersReducedMotion } from "./use-media";

// The caveat affordance lives with the other shared primitives now: the board
// and the verify surface open the same kind of fine print with it.
export { CaveatDisclosure };

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

/**
 * A basis reads as one or more clauses. The clauses that carry the arithmetic
 * stay under the figure, where a reader checks the label against the rule; the
 * clauses that say why the rule is the right one are reasoning, and they go
 * behind the caveat toggle with the rest of the fine print.
 *
 * The split is on the shape of a clause rather than on a hand-kept list, so a
 * basis edited in the metrics layer still lands on the right side of the line.
 */
const FORMULA = /[=<>*]|^(sum|mean|count|histogram|median|schedule_of|vault |not cancelled)/;

export function splitBasis(basis: string): { formula: string; reasoning: string | null } {
  const clauses = basis
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  let cut = clauses.length;
  for (let i = 0; i < clauses.length; i++) {
    if (!FORMULA.test(clauses[i]!)) {
      cut = i;
      break;
    }
  }
  if (cut === 0) return { formula: basis, reasoning: null };
  return {
    formula: clauses.slice(0, cut).join(" · "),
    reasoning: cut < clauses.length ? clauses.slice(cut).join(". ") : null,
  };
}

export function MetricTile({
  label,
  value,
  unit,
  basis,
  /** "checked at block N", kept out of the basis string so the split cannot
   *  push it behind the toggle with the reasoning. */
  asOf,
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
  asOf?: string;
  caveat?: string;
  floor?: boolean;
  token: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  // The formula and the block it was checked at stay under the figure. The
  // reasoning behind the rule joins the caveat, so one affordance holds
  // everything a reader can ask for and the tile stays three lines tall.
  const split = splitBasis(basis);
  const formula = asOf ? `${split.formula} · ${asOf}` : split.formula;
  const behind = [split.reasoning, caveat].filter((s) => s).join(" ") || undefined;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 border border-border-panel bg-surface-panel px-6 py-7",
        className,
      )}
    >
      <div className="text-[11px] font-medium tracking-[0.18em] text-text-label">{label}</div>
      <div
        className="font-semibold tabular-nums text-text-strong"
        style={{ fontSize: 20, lineHeight: 1.2, letterSpacing: "-0.01em" }}
      >
        {floor ? <span className="text-text-label">{"≥ "}</span> : null}
        <Flash token={token}>{value}</Flash>
        {unit ? <span className="text-[13px] font-normal text-text-label"> {unit}</span> : null}
      </div>
      <p className="max-w-[46ch] text-[11px] leading-[1.5] text-text-caption">
        {floor ? "counted in the range that was read, not a total. " : null}
        {formula}
      </p>
      {footer}
      {behind ? <CaveatDisclosure caveat={behind} /> : null}
    </div>
  );
}
