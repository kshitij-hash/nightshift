// What is hidden and what is provable, then the machine that makes both true.
//
// The claim comes first as two lines and nothing else, because it is the one
// sentence a reader has to leave with. FIG. 1 follows, drawn from the same
// vault and schedule reads the board's instrument runs on, so the drawing
// cannot say something the chain does not. The card-authorization analogy now
// lives in the hero, where a first-time reader actually needs it; the side
// note here carries the custody fact instead, because it is the question a
// reader of FIG. 1 is left with: who can move the money.

import type { Schedule } from "../../lib/schedule";
import { cn } from "../../lib/utils";
import { Mechanism } from "../board/mechanism-figure";
import { SectionHead } from "../board/primitives";
import { mechanismLabels } from "../board/story-band";

const ROWS: Array<[string, string, boolean]> = [
  ["HIDDEN", "your wallet.", false],
  ["PROVABLE", "your tier is valid and your payment is current.", true],
];

export function HiddenProvable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col border border-border-panel">
      {ROWS.map(([key, value, lit], i) => (
        <div
          key={key}
          className={cn(
            "flex flex-wrap items-baseline gap-x-6 gap-y-1",
            compact ? "px-4 py-4" : "px-6 py-5",
            i > 0 && "border-t border-border-panel",
            lit && "bg-surface-sunken",
          )}
        >
          <span
            className={cn(
              "shrink-0 text-[11px] font-medium tracking-[0.18em]",
              compact ? "w-[74px]" : "w-[96px]",
              lit ? "text-ns-accent" : "text-text-label",
            )}
          >
            {key}
          </span>
          <span
            className="font-semibold text-text-strong"
            style={{
              fontSize: compact ? 17 : 24,
              lineHeight: 1.25,
              letterSpacing: "-0.01em",
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// The three "never" clauses this used to carry are the board's six-step
// LEGEND, and FIG. 1 below engraves the same facts. Two lines, then the
// figure.
const PROSE =
  "Your deposit sits inside the pool under the vault's rules. Once per period the vault pays " +
  "the creator and marks the period spent, so nothing can charge it twice. FIG. 1 traces one " +
  "charge end to end.";

const CUSTODY_NOTE =
  "Anyone can fire a charge that is due; funds leave only with the creator's signature.";

export function MechanismSection({
  schedule,
  perPeriodWei,
  charged,
  compact,
}: {
  schedule: Schedule | null;
  perPeriodWei: bigint | null;
  charged: number;
  compact: boolean;
}) {
  const labels = mechanismLabels(schedule, perPeriodWei, charged);
  return (
    <section className="flex flex-col gap-5">
      <SectionHead note="the claim, then the contract that enforces it">
        // WHAT IS HIDDEN, WHAT IS PROVABLE
      </SectionHead>

      <HiddenProvable compact={compact} />

      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <p className="max-w-[76ch] text-[13.5px] leading-[1.7] text-text-prose">{PROSE}</p>
        {!compact ? (
          <p className="max-w-[42ch] text-[12px] leading-[1.5] text-text-caption lg:text-right">
            {CUSTODY_NOTE}
          </p>
        ) : null}
      </div>

      {/* The figure scales against its viewBox, so on a wide screen it just
          takes the measure it is given. On a phone that measure would push its
          engraved labels under 3px and turn the evidence into decoration, so
          there it keeps a legible width and scrolls sideways inside its own
          container. The container scrolls; the page does not. */}
      {compact ? (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto border border-border-panel bg-surface-sunken py-4 pl-4">
            <div className="w-[1100px]">
              <Mechanism labels={labels} />
            </div>
          </div>
          <p className="text-[11px] leading-[1.45] text-text-caption">
            FIG. 1 is 1100px wide. Scroll it sideways.
          </p>
        </div>
      ) : (
        <div className="border border-border-panel bg-surface-sunken px-4 py-4 lg:px-7">
          <Mechanism labels={labels} />
        </div>
      )}

      {compact ? (
        <p className="border-t border-border-row pt-3 text-[12px] leading-[1.5] text-text-caption">
          {CUSTODY_NOTE}
        </p>
      ) : null}
    </section>
  );
}
