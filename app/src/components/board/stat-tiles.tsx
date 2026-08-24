// The three figures that answer "what has this vault done" without scrolling.
// Every tile carries its basis in the caption, including the awkward part of
// the basis. A tile whose number cannot be explained in one line does not
// belong on this page.
//
// The block is not part of a basis. All three tiles are read at the same head
// block, so it is stated once beside the row rather than three times under
// three different rules.

import NumberFlow from "@number-flow/react";
import { useState } from "react";

import { fmtBlock, fmtStrk } from "../../config";
import { NUMBER_OPACITY_TIMING, NUMBER_TIMING } from "./motion";

/** The accent wash that reports a numeral just changed. It runs once per
 *  change and leaves nothing behind. */
function Flash({ token, children }: { token: string; children: React.ReactNode }) {
  const [run, setRun] = useState(0);
  const [seen, setSeen] = useState(token);
  // Derived during render, not in an effect: the wash belongs to the same
  // paint as the new number, not to the one after it.
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

export function StatTile({
  label,
  value,
  unit,
  caption,
  token,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  caption: string;
  token: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border border-border-panel px-5 py-4">
      <div className="text-[11px] font-medium tracking-[0.18em] text-text-label">{label}</div>
      <div
        className="font-semibold tabular-nums text-text-strong"
        style={{ fontSize: 20, lineHeight: 1.2, letterSpacing: "-0.01em" }}
      >
        <Flash token={token}>{value}</Flash>
        {unit ? <span className="text-[14px] font-normal text-text-label"> {unit}</span> : null}
      </div>
      <div className="text-[11px] leading-[1.45] text-text-caption">{caption}</div>
    </div>
  );
}

export type StatRowProps = {
  custodyWei: bigint;
  chargeCount: number;
  activeSubscriptions: number;
  vaultBreakdown: string;
  asOfBlock: number;
  /** Snapshot renders do not roll: nothing changed while you watched. */
  still: boolean;
};

export function StatRow(p: StatRowProps) {
  const custody = Number(fmtStrk(p.custodyWei));
  return (
    <div className="flex flex-col gap-2">
      {/* All three figures come from one read, so the block they were read at
          is one line above them rather than the same number printed three
          times under three different rules. */}
      <div className="flex justify-end">
        <span className="text-[11px] leading-[1.45] text-text-caption">
          as of block {fmtBlock(p.asOfBlock)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="STRK IN CUSTODY"
          token={String(p.custodyWei)}
          value={
            p.still ? (
              custody.toFixed(2)
            ) : (
              <NumberFlow
                value={custody}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                transformTiming={NUMBER_TIMING}
                opacityTiming={NUMBER_OPACITY_TIMING}
              />
            )
          }
          unit="STRK"
          caption="escrow remaining plus unclaimed creator claimable, all vault generations"
        />
        <StatTile
          label="CHARGES FIRED"
          token={String(p.chargeCount)}
          value={
            p.still ? (
              p.chargeCount
            ) : (
              <NumberFlow
                value={p.chargeCount}
                transformTiming={NUMBER_TIMING}
                opacityTiming={NUMBER_OPACITY_TIMING}
              />
            )
          }
          caption={`charge events decoded from mainnet logs, ${p.vaultBreakdown}`}
        />
        <StatTile
          label="SUBSCRIPTIONS"
          token={String(p.activeSubscriptions)}
          value={
            p.still ? (
              p.activeSubscriptions
            ) : (
              <NumberFlow
                value={p.activeSubscriptions}
                transformTiming={NUMBER_TIMING}
                opacityTiming={NUMBER_OPACITY_TIMING}
              />
            )
          }
          caption="commitments the vaults still report active"
        />
      </div>
    </div>
  );
}
