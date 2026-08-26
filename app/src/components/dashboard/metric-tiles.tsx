// The six figures the dashboard leads with, each printed with the rule that
// produced it.
//
// The basis strings are not written here. They come back from the metrics
// layer alongside every value, which is the only way a caption and a number
// can be guaranteed to still agree after someone edits the arithmetic. This
// file decides layout and ordering, nothing else.
//
// Ordering is load-bearing in one place: gross revenue and the settlement
// split sit next to each other so the invariant (settled + unsettled = gross)
// can be checked by eye, on one screen, at every width.
//
// Every tile is read at the same head block, so the block is not printed six
// times under six formulas. checkedAtBlock() below is that string, for the
// section head to carry once above the grid.

import { Check } from "lucide-react";

import { fmtBlock, fmtStrk } from "../../config";
import type { CreatorLedger } from "../../lib/creator";
import type { allMetrics } from "../../lib/creator";
import { Badge } from "../ui/badge";
import { fundedPeriodsCovered, isFloor, strk } from "./derive";
import { LiveNumber, MetricTile } from "./tile";

type Metrics = ReturnType<typeof allMetrics>;

/** The head block every figure in this grid was read at, as one string. The
 *  six tiles used to end their basis with it, which put the same number on
 *  screen six times; the section head above the grid says it once instead. */
export function checkedAtBlock(ledger: CreatorLedger): string {
  return `checked at block ${fmtBlock(ledger.headBlock)}`;
}

function InvariantTag({
  holds,
  deltaWei,
  inconclusive,
}: {
  holds: boolean;
  deltaWei: bigint;
  inconclusive: boolean;
}) {
  if (inconclusive) {
    return (
      <Badge variant="outline" className="border-ns-accent text-ns-accent">
        invariant inconclusive
      </Badge>
    );
  }
  if (holds) {
    return (
      <Badge variant="verified">
        <Check aria-hidden="true" /> settled + unsettled = gross
      </Badge>
    );
  }
  const delta = deltaWei < 0n ? -deltaWei : deltaWei;
  return (
    <Badge variant="outline" className="border-ns-accent text-ns-accent">
      off by {fmtStrk(delta)} STRK
    </Badge>
  );
}

export function MetricTiles({
  metrics,
  ledger,
}: {
  metrics: Metrics;
  ledger: CreatorLedger;
}) {
  const floor = isFloor(ledger);
  const split = metrics.settledVsUnsettled.value;
  const covered = fundedPeriodsCovered(ledger);
  const inconclusive =
    ledger.provenance.truncated ||
    ledger.creators.some((c) => c.claimableWei === null || c.claimableWei === undefined);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <MetricTile
        label="GROSS REVENUE"
        token={String(metrics.grossRevenue.value)}
        value={<LiveNumber value={strk(metrics.grossRevenue.value)} decimals={2} />}
        unit="STRK"
        floor={floor}
        basis={metrics.grossRevenue.basis}
        caveat={metrics.grossRevenue.caveat}
      />

      <MetricTile
        label="SETTLED / UNSETTLED"
        token={`${split.settledWei}:${split.unsettledWei}`}
        value={
          <>
            <LiveNumber value={strk(split.settledWei)} decimals={2} />
            <span className="text-text-label"> / </span>
            <LiveNumber value={strk(split.unsettledWei)} decimals={2} />
          </>
        }
        unit="STRK"
        floor={floor}
        basis={metrics.settledVsUnsettled.basis}
        caveat={metrics.settledVsUnsettled.caveat}
        footer={
          <InvariantTag
            holds={split.invariant.holds}
            deltaWei={split.invariant.deltaWei}
            inconclusive={inconclusive}
          />
        }
      />

      <MetricTile
        label="MRR, ESCROW-BACKED"
        token={String(metrics.escrowedRunRate30d.value)}
        value={<LiveNumber value={strk(metrics.escrowedRunRate30d.value)} decimals={2} />}
        unit="STRK"
        floor={floor}
        basis={metrics.escrowedRunRate30d.basis}
        caveat={metrics.escrowedRunRate30d.caveat}
        footer={
          <p className="max-w-[46ch] text-[11px] leading-[1.5] text-text-caption">
            Escrow on hand covers {covered} further period{covered === 1 ? "" : "s"}, so this rate
            is bounded by escrow already committed.
          </p>
        }
      />

      <MetricTile
        label="ACTIVE SUBSCRIPTIONS"
        token={String(metrics.activeSubscriptions.value)}
        value={<LiveNumber value={metrics.activeSubscriptions.value} />}
        floor={floor}
        basis={metrics.activeSubscriptions.basis}
        caveat={metrics.activeSubscriptions.caveat}
      />

      <MetricTile
        label="CURRENTLY ENTITLED"
        token={String(metrics.currentlyEntitled.value)}
        value={<LiveNumber value={metrics.currentlyEntitled.value} />}
        floor={floor}
        basis={metrics.currentlyEntitled.basis}
        caveat={metrics.currentlyEntitled.caveat}
      />

      <MetricTile
        label="ARREARS"
        token={`${metrics.arrears.value.count}:${metrics.arrears.value.maxPeriodsDue}`}
        value={<LiveNumber value={metrics.arrears.value.count} />}
        unit={metrics.arrears.value.count === 1 ? "subscription" : "subscriptions"}
        floor={floor}
        basis={metrics.arrears.basis}
        caveat={metrics.arrears.caveat}
        // Zero needs no sentence: the figure above already reads 0, and the
        // basis under it says what was counted. Only a backlog gets a footer.
        footer={
          metrics.arrears.value.count === 0 ? null : (
            <p className="max-w-[46ch] text-[11px] leading-[1.5] text-text-caption">
              Worst backlog: {metrics.arrears.value.maxPeriodsDue} period(s) past their due height.
            </p>
          )
        }
      />
    </div>
  );
}
