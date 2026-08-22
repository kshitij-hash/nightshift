// Churn, measured rather than modelled.
//
// Every figure here is counted over commitments that can never charge again.
// A subscription one period into a three-period schedule has not churned, and
// averaging it in as a zero would report churn the chain has not seen. Where
// there is nothing to measure the tile says so in words instead of printing a
// zero that reads like an answer.

import type { CreatorLedger } from "../../lib/creator";
import type { allMetrics } from "../../lib/creator";
import { churnFigures, isFloor, strk } from "./derive";
import { LiveNumber, MetricTile } from "./tile";

type Metrics = ReturnType<typeof allMetrics>;

export function ChurnTiles({
  metrics,
  ledger,
}: {
  metrics: Metrics;
  ledger: CreatorLedger;
}) {
  const churn = churnFigures(ledger);
  const floor = isFloor(ledger);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <MetricTile
        label="ENDED WHEN ESCROW RAN OUT"
        token={`${churn.endedOnEscrow}:${churn.ended}`}
        value={
          <>
            <LiveNumber value={churn.endedOnEscrow} />
            <span className="text-text-label"> / </span>
            <LiveNumber value={churn.ended} />
          </>
        }
        floor={floor}
        basis="commitments that can never charge again, split by why: escrow spent against a subscriber cancel"
        footer={
          <p className="max-w-[46ch] text-[10px] leading-[1.5] text-text-caption">
            {churn.endedOnCancel === 0
              ? "No subscriber has cancelled. A subscription ends when its escrow is spent. It does not renew itself, and the vault cannot ask."
              : `${churn.endedOnCancel} ended on a subscriber cancel, which returns the remaining escrow to the subscriber on reclaim. The rest ran their escrow out.`}
          </p>
        }
      />

      <MetricTile
        label="MEDIAN PERIODS CHARGED"
        token={String(churn.medianPeriodsCharged)}
        value={
          churn.medianPeriodsCharged === null ? (
            <span className="text-[15px] font-normal text-text-prose">nothing has ended yet</span>
          ) : (
            <LiveNumber
              value={churn.medianPeriodsCharged}
              decimals={Number.isInteger(churn.medianPeriodsCharged) ? 0 : 1}
            />
          )
        }
        floor={floor && churn.medianPeriodsCharged !== null}
        basis="median of the charge count over commitments that can never charge again"
        footer={
          churn.ended === 1 ? (
            <p className="max-w-[46ch] text-[10px] leading-[1.5] text-text-caption">
              One subscription has ended, so the median is that subscription.
            </p>
          ) : null
        }
      />

      <MetricTile
        label="REFUNDED TO SUBSCRIBERS"
        token={String(metrics.refundLeakage.value)}
        value={<LiveNumber value={strk(metrics.refundLeakage.value)} decimals={2} />}
        unit="STRK"
        floor={floor}
        basis={metrics.refundLeakage.basis}
        caveat={metrics.refundLeakage.caveat}
      />
    </div>
  );
}
