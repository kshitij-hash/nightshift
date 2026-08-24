// The live strip: one thin row, four facts, and the only thing above the fold
// that moves.
//
// It is deliberately not the hero. The hero carries no numbers and no buttons,
// so the first number a reader meets is this one, at the size of a readout
// rather than the size of a claim. Three numerals and one sentence, each with
// the basis it was read from underneath it.
//
// Every value here comes from the same board read the instrument runs on. When
// that read fails the strip does not go quiet and it does not invent: the
// last-charge cell swaps its Voyager link for a SNAPSHOT badge naming the block
// the committed data was taken at, and the heartbeat stops, because nothing is
// being watched.
//
// The read in flight is the same component with `data={null}`, not a separate
// placeholder rendered somewhere else. That is the whole reason the strip does
// not move when the read lands: the container, the four cells, their padding,
// their labels and the three reserved slot heights are literally the same
// markup in both states, so there is no second layout to keep in step and no
// way for one to drift from the other. What is unknown is a bar; what is known
// before any read - the four labels, the fact that there are four cells and
// which is the wide one - is printed, because it is true either way.
//
// The two slot heights below are the load-bearing measurements: the value slot
// is pinned to the tallest thing that can stand in it, and the caption slot
// reserves the two lines line-clamp-2 allows. A cell that sized itself to its
// content would be a different height before and after the read, and every
// pixel of that difference is the page jumping under a reader who has already
// started reading.

import { useEffect, useState } from "react";

import { fmtBlock, fmtStrk, truncate, VOYAGER_CONTRACT, VOYAGER_TX, VAULT } from "../../config";
import type { Charge } from "../../lib/board";
import { cn } from "../../lib/utils";
import { utcTime } from "../board/derive";
import { StatusDot } from "../board/primitives";
import { usePrefersReducedMotion } from "../dashboard/use-media";
import { LiveNumber } from "../dashboard/tile";
import { Badge } from "../ui/badge";

export type StripData = {
  /** Subscriptions opened, cumulative, never decremented. The live count is
   *  the wrong lead for this strip: it is zero whenever every schedule so far
   *  has been spent or cancelled, and a zero cannot be the first number a
   *  reader meets. The caption under it says it is cumulative. */
  subscriptionsCreated: number;
  charges: Charge[];
  escrowWei: bigint;
  headBlock: number;
  snapshot: boolean;
};

/**
 * Every cell's value slot is exactly this tall, whether it holds a rolling
 * numeral, a sentence with a dot and a link, or the bar standing in for one.
 *
 * A fixed height, not a minimum. The three numerals are NumberFlow, which is
 * taller than its own line box: it renders each digit inside a mask it can
 * roll through, and at 20px that mask is 32px against the 22px the text alone
 * would occupy. The last-charge cell is different again, 24px, set by the
 * minimum hit target on the Voyager link inside it. Under reduced motion
 * NumberFlow is not rendered at all and the numeral is 22px of plain text.
 * Three different natural heights for one row of an instrument, and the
 * tallest of them is the one the row is. Pinning it here is what makes the
 * loading state, the loaded state, and the reduced-motion state the same
 * shape, and what stops the strip from resizing when the read lands.
 */
const VALUE_H = 32;

/** A placeholder fill, at the measurement of the value it stands in for. Flat,
 *  not a shimmer: a strip that has not read the chain yet has nothing to
 *  report, and a sweeping highlight would be reporting activity. */
function Bar({ w, h }: { w: number | string; h: number }) {
  return (
    <span
      aria-hidden="true"
      className="block rounded-none bg-surface-fill"
      style={{ width: w, height: h, maxWidth: "100%" }}
    />
  );
}

function Cell({
  label,
  children,
  caption,
  className,
}: {
  label: string;
  children: React.ReactNode;
  caption: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 bg-surface-sunken px-5 py-3.5 md:px-6",
        className,
      )}
    >
      <span className="text-[11px] font-medium tracking-[0.16em] text-text-label">{label}</span>
      <span className="flex items-center" style={{ height: VALUE_H }}>
        {children}
      </span>
      {/* Two lines, reserved whether or not the caption fills them. A caption
          clipped mid-word would be the one part of this strip that stops
          carrying its basis; a caption that grows from one line to two when
          the read lands would move every section below it. */}
      <span className="line-clamp-2 min-h-[2lh] text-[10.5px] leading-[1.35] text-text-caption">
        {caption}
      </span>
    </div>
  );
}

/**
 * Mounts at 0 and moves to the real figure immediately after the first paint,
 * so NumberFlow rolls the digits into place instead of stamping them there.
 *
 * The zero is not a fabricated stat: it exists for one frame, under a fade
 * that begins at opacity 0, and the roll that replaces it is the same per-digit
 * roll every later poll uses. Off entirely under reduced motion and off for
 * every figure that was already on screen, so nothing rolls except an arrival.
 */
function useRollIn(value: number, active: boolean): number {
  const [rolled, setRolled] = useState(!active);
  // The effect is the mechanism, not an accident of one. A roll needs two
  // paints to exist: the digits have to be somewhere before they can travel
  // anywhere. Deriving this during render would collapse both into one frame
  // and stamp the figure, which is the thing this is here to avoid.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    if (!rolled) setRolled(true);
  }, [rolled]);
  return rolled ? value : 0;
}

function Numeral({
  value,
  decimals = 0,
  unit,
  arriving,
}: {
  value: number;
  decimals?: number;
  unit?: string;
  /** True on the paint that replaced the placeholder, false ever after. */
  arriving: boolean;
}) {
  const shown = useRollIn(value, arriving);
  return (
    <span
      className="font-semibold tabular-nums text-text-strong"
      style={{ fontSize: 20, lineHeight: 1.1 }}
    >
      <LiveNumber value={shown} decimals={decimals} />
      {unit ? <span className="text-[11px] font-normal text-text-label"> {unit}</span> : null}
    </span>
  );
}

/** The container, identical in both states. The dividers are the 1px gaps: the
 *  container's own colour shows through between the cells, which lands a
 *  hairline on exactly the internal edges in both layouts and needs no
 *  nth-child arithmetic to place them. On a phone the four cells wrap to 2 by 2
 *  with the last spanning both columns, because it is a sentence and the other
 *  three are numerals. */
const STRIP = "grid grid-cols-2 gap-px border-y border-border-hairline bg-border-row md:flex md:flex-row";
/** The empty half of the second grid row, so the container's divider colour
 *  does not paint a solid block there. Absent on desktop. */
const FILLER = <div aria-hidden="true" className="bg-surface-sunken md:hidden" />;
const WIDE = "col-span-2 md:flex-[1.6]";

export function LiveStrip({ data }: { data: StripData | null }) {
  // Whether this strip stood empty before the values it is now showing.
  //
  // Decided once, on the render the read landed on, and never revised: a
  // reader who opens the page with the board already cached in Query sees no
  // arrival, because for them nothing arrived. Settled during render rather
  // than in an effect, so the decision and the paint it governs are the same
  // paint; deciding it afterwards would take the animation back off the
  // elements one frame into running it.
  const still = usePrefersReducedMotion();
  const [wasEmpty, setWasEmpty] = useState(data === null);
  const [mode, setMode] = useState<"waiting" | "arrive" | "none">("waiting");
  if (data === null && !wasEmpty) setWasEmpty(true);
  if (data !== null && mode === "waiting") setMode(wasEmpty && !still ? "arrive" : "none");
  const arriving = mode === "arrive";
  // The slots that carry values fade in where their bars stood. No travel:
  // the bar is already in the right place, and moving the value into it would
  // report a layout change that did not happen.
  const slot = arriving ? "ns-value-in" : undefined;

  if (data === null) {
    return (
      <div className={STRIP} aria-busy="true" aria-label="reading starknet mainnet">
        <Cell label="SUBSCRIPTIONS" caption={<Bar w={196} h={9} />}>
          <Bar w={26} h={15} />
        </Cell>
        <Cell label="CHARGES FIRED" caption={<Bar w={210} h={9} />}>
          <Bar w={26} h={15} />
        </Cell>
        <Cell label="IN CUSTODY" caption={<Bar w={210} h={9} />}>
          <Bar w={104} h={15} />
        </Cell>
        {FILLER}
        {/* One caption is printed rather than barred, and it is this one: the
            reader is owed a sentence saying what the page is doing, and the
            two-line reservation means one line of it costs nothing. It sits in
            the wide cell because that is the cell whose caption is a sentence
            when the read lands, and it is gone the moment there is a real
            timestamp to put there. */}
        <Cell label="LAST CHARGE" className={WIDE} caption="reading starknet mainnet">
          <span className="flex items-center gap-2">
            {/* Pending, and true: nothing is being watched yet. */}
            <StatusDot state="pending" size={6} />
            <Bar w={116} h={11} />
          </span>
        </Cell>
      </div>
    );
  }

  const last = data.charges[0];
  const withAmount = data.charges.filter((c) => c.amountWei !== null);
  const grossWei = withAmount.reduce((sum, c) => sum + (c.amountWei ?? 0n), 0n);

  return (
    <div className={STRIP}>
      <Cell
        label="SUBSCRIPTIONS"
        caption={
          <span className={slot}>opened to date, cumulative from Subscribed events</span>
        }
      >
        <span className={slot}>
          <Numeral value={data.subscriptionsCreated} arriving={arriving} />
        </span>
      </Cell>

      <Cell
        label="CHARGES FIRED"
        caption={
          <span className={slot}>{`${fmtStrk(grossWei)} STRK gross, from Charged events`}</span>
        }
      >
        <span className={slot}>
          <Numeral value={data.charges.length} arriving={arriving} />
        </span>
      </Cell>

      <Cell
        label="IN CUSTODY"
        caption={
          <span className={slot}>escrow still held, summed across vault generations</span>
        }
      >
        <span className={slot}>
          <Numeral
            value={Number(fmtStrk(data.escrowWei))}
            decimals={2}
            unit="STRK"
            arriving={arriving}
          />
        </span>
      </Cell>

      {FILLER}

      <Cell
        label="LAST CHARGE"
        className={WIDE}
        caption={
          <span className={slot}>
            {last
              ? `${utcTime(last.timestamp)} UTC · tx ${truncate(last.txHash)}` +
                (last.amountWei !== null ? ` · ${fmtStrk(last.amountWei)} STRK` : "") +
                ` · period ${String(last.periodIndex).padStart(2, "0")}`
              : "no charge has been decoded at this vault yet"}
          </span>
        }
      >
        {last ? (
          <span className={cn("flex flex-wrap items-baseline gap-2", slot)}>
            <StatusDot state={data.snapshot ? "pending" : "live"} size={6} beat={!data.snapshot} />
            <span className="text-[14px] text-text-default">
              block{" "}
              <span className="font-medium text-ns-accent tabular-nums">
                {fmtBlock(last.block)}
              </span>
            </span>
            {data.snapshot ? (
              // The read failed, so this cell stops pointing at a live
              // explorer link and says which committed block it is serving.
              <Badge variant="outline" className="border-ns-accent text-ns-accent">
                SNAPSHOT @ BLOCK {fmtBlock(data.headBlock)}
              </Badge>
            ) : (
              <a
                href={VOYAGER_TX(last.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-6 items-center text-[12px]"
                title={`${last.txHash} · open this charge on voyager`}
              >
                <span aria-hidden="true">↗</span>
                <span className="sr-only">open the last charge on voyager</span>
              </a>
            )}
          </span>
        ) : (
          <span className={cn("flex items-baseline gap-2", slot)}>
            <StatusDot state="pending" size={6} />
            <a
              href={`${VOYAGER_CONTRACT(VAULT)}#events`}
              target="_blank"
              rel="noreferrer"
              className="text-[14px]"
            >
              read the vault event log ↗
            </a>
          </span>
        )}
      </Cell>
    </div>
  );
}
