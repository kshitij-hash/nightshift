// One subscription, as the reader's own object.
//
// The card answers the four questions a subscriber actually has, in the order
// they ask them: who is being paid, how much is left, when the next charge
// fires, and how many periods have gone. Escrow is stated in charges first and
// STRK second, because "covers 2 more charges" is the question and "2.00 STRK"
// is the arithmetic behind it.
//
// The verbs live inside the card, at the object they act on, and pressing one
// opens the existing flow panel below it rather than a modal. The card stays
// readable while the flow runs, so the object and the action are never
// separated and nothing has to be remembered across a dialog.

import { CADENCES } from "../../lib/wallet/core";
import { coveredCharges, nextChargeBlock, subscriptionState } from "../../lib/subscriptions";
import type { Subscription } from "../../lib/subscriptions";
import { cn } from "../../lib/utils";
import { fmtBlock, fmtStrk, SECONDS_PER_BLOCK, truncate } from "../../config";
import { hms } from "../board/derive";
import type { TickState } from "../board/derive";
import { HashCopy, StatusDot } from "../board/primitives";
import { TickBar } from "../board/tick-bar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

/** The ladder's own words for a period length. A cadence off the ladder never
 *  reaches the chain, so anything else is a raw block count. */
function cadenceLabel(periodBlocks: number): string {
  const known = CADENCES.find((c) => c.blocks === periodBlocks);
  return known
    ? `${known.label}, ${periodBlocks} blocks`
    : `${periodBlocks} blocks per period`;
}

/** One square per period, from the schedule alone. next_period only advances
 *  when the vault charges, so everything below it is charged and everything
 *  above it is not; the one at the cursor is open or still ahead depending on
 *  the head block. */
export function scheduleTicks(s: Subscription, headBlock: number): TickState[] {
  const { nPeriods, nextPeriod, startBlock, periodBlocks, cancelled } = s.schedule;
  return Array.from({ length: nPeriods }, (_, i): TickState => {
    if (i < nextPeriod) return "ok";
    if (cancelled) return "future";
    const windowBlock = startBlock + i * periodBlocks;
    if (i === nextPeriod && headBlock >= windowBlock) return "open";
    return "future";
  });
}

function Readout({
  label,
  value,
  caption,
  accent = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1 px-5 py-4", className)}>
      <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">{label}</span>
      <div
        className={cn("font-semibold tabular-nums", accent ? "text-ns-accent" : "text-text-strong")}
        style={{ fontSize: 24, lineHeight: 1.15 }}
      >
        {value}
      </div>
      <span className="text-[11px] leading-[1.45] text-text-caption">{caption}</span>
    </div>
  );
}

const TAG: Record<ReturnType<typeof subscriptionState>, string> = {
  active: "ACTIVE",
  exhausted: "EXHAUSTED",
  cancelled: "CANCELLED",
};

export function SubscriptionCard({
  subscription,
  headBlock,
  /** Chain-anchored seconds, ticking. Drives the countdown. */
  now,
  headTimestamp,
  /** True while this card's flow panel is open below it. */
  acting,
  onAct,
  children,
}: {
  subscription: Subscription;
  headBlock: number;
  now: number;
  headTimestamp: number;
  acting: boolean;
  onAct: () => void;
  /** The flow panel, rendered inside the card when a verb has been pressed. */
  children?: React.ReactNode;
}) {
  const s = subscription;
  const state = subscriptionState(s);
  const live = state === "active";
  const covers = coveredCharges(s);
  const block = nextChargeBlock(s);
  const ticks = scheduleTicks(s, headBlock);
  const charged = ticks.filter((t) => t === "ok").length;

  // The countdown is an estimate and the caption says which block it is
  // counting to, because the charge is block gated and not clock gated.
  const secsToWindow =
    block === null ? null : (block - headBlock) * SECONDS_PER_BLOCK - (now - headTimestamp);
  const overdue = secsToWindow !== null && secsToWindow <= 0;

  return (
    <div
      className={cn(
        "flex flex-col border bg-surface-panel",
        acting ? "border-ns-accent" : "border-border-panel",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border-panel px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <StatusDot state={live ? "live" : "settled"} size={8} beat={live} />
          <span className="text-[15px] font-medium text-text-strong">
            creator{" "}
            <HashCopy
              value={s.creatorId}
              display={truncate(s.creatorId)}
              tone="strong"
              className="text-[15px]"
            />
          </span>
          <span className="text-[11px] leading-[1.45] text-text-caption">
            tier {s.schedule.tier}
            {s.tierPriceWei !== null ? ` · ${fmtStrk(s.tierPriceWei)} STRK per period` : ""} ·{" "}
            {cadenceLabel(s.schedule.periodBlocks)}
          </span>
        </div>
        <Badge variant="outline">{TAG[state]}</Badge>
      </div>

      <div className="flex flex-col border-b border-border-panel md:flex-row">
        <Readout
          label="ESCROW REMAINING"
          className="border-b border-border-panel md:border-r md:border-b-0"
          value={
            <>
              {fmtStrk(s.schedule.escrowWei)}
              <span className="text-[12px] font-normal text-text-label"> STRK</span>
            </>
          }
          caption={
            covers === null
              ? "the per-period amount could not be read, so no coverage is claimed"
              : covers === 0
                ? "covers no further charge"
                : `covers ${covers} more charge${covers === 1 ? "" : "s"}`
          }
        />
        <Readout
          label="NEXT CHARGE"
          className="border-b border-border-panel md:border-r md:border-b-0"
          accent={live && !overdue}
          value={
            secsToWindow === null ? (
              <span className="text-text-label">·:·:·</span>
            ) : overdue ? (
              <span className="text-ns-accent">00:00:00</span>
            ) : (
              hms(secsToWindow)
            )
          }
          caption={
            block === null
              ? s.schedule.cancelled
                ? "cancelled, so no further period will be charged"
                : "every period this subscription bought has been charged"
              : overdue
                ? `block ${fmtBlock(block)} passed · period ${String(s.schedule.nextPeriod).padStart(2, "0")} is chargeable now`
                : `block ${fmtBlock(block)} · period ${String(s.schedule.nextPeriod).padStart(2, "0")} · estimated at ~${SECONDS_PER_BLOCK} s a block`
          }
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-5 py-4 md:flex-[1.2]">
          <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">PERIODS</span>
          <TickBar states={ticks} label={null} width={30} />
          <span className="text-[11px] leading-[1.45] text-text-caption">
            {charged} of {ticks.length} charged
            {block !== null ? ` · window ${String(s.schedule.nextPeriod).padStart(2, "0")} next` : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
        <span className="text-[11px] leading-[1.45] text-text-caption">
          commitment{" "}
          <HashCopy
            value={s.commitment}
            display={truncate(s.commitment)}
            tone="caption"
            className="text-[11px]"
          />{" "}
          · derived in this browser from the key that created it
        </span>
        <Button
          variant="destructive"
          size="md"
          aria-expanded={acting}
          onClick={onAct}
        >
          {acting ? "close" : live ? "cancel" : "reclaim"}
        </Button>
      </div>

      {acting && children ? (
        <div className="border-t border-ns-accent px-5 py-5">{children}</div>
      ) : null}
    </div>
  );
}
