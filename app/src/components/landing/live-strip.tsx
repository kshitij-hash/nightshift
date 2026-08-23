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

import { fmtBlock, fmtStrk, truncate, VOYAGER_CONTRACT, VOYAGER_TX, VAULT } from "../../config";
import type { Charge } from "../../lib/board";
import { cn } from "../../lib/utils";
import { utcTime } from "../board/derive";
import { StatusDot } from "../board/primitives";
import { LiveNumber } from "../dashboard/tile";
import { Badge } from "../ui/badge";

export type StripData = {
  activeSubscriptions: number;
  charges: Charge[];
  escrowWei: bigint;
  headBlock: number;
  snapshot: boolean;
};

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
      {children}
      {/* Two lines at most. A caption clipped mid-word would be the one part
          of this strip that stops carrying its basis. */}
      <span className="line-clamp-2 text-[10.5px] leading-[1.35] text-text-caption">{caption}</span>
    </div>
  );
}

function Numeral({ value, decimals = 0, unit }: { value: number; decimals?: number; unit?: string }) {
  return (
    <span
      className="font-semibold tabular-nums text-text-strong"
      style={{ fontSize: 20, lineHeight: 1.1 }}
    >
      <LiveNumber value={value} decimals={decimals} />
      {unit ? <span className="text-[11px] font-normal text-text-label"> {unit}</span> : null}
    </span>
  );
}

export function LiveStrip({ data }: { data: StripData }) {
  const last = data.charges[0];
  const withAmount = data.charges.filter((c) => c.amountWei !== null);
  const grossWei = withAmount.reduce((sum, c) => sum + (c.amountWei ?? 0n), 0n);
  const commitment = last ? truncate(last.commitment) : null;

  return (
    /* The dividers are the 1px gaps: the container's own colour shows through
       between the cells, which lands a hairline on exactly the internal edges
       in both layouts and needs no nth-child arithmetic to place them. On a
       phone the four cells wrap to 2 by 2 with the last spanning both columns,
       because it is a sentence and the other three are numerals. */
    <div className="grid grid-cols-2 gap-px border-y border-border-hairline bg-border-row md:flex md:flex-row">
      <Cell
        label="SUBSCRIPTIONS"
        caption={commitment ? `commitment ${commitment}` : "no live subscription decoded"}
      >
        <Numeral value={data.activeSubscriptions} />
      </Cell>

      <Cell
        label="CHARGES FIRED"
        caption={
          withAmount.length === data.charges.length
            ? `${fmtStrk(grossWei)} STRK gross, from Charged events`
            : `${fmtStrk(grossWei)} STRK gross · ${data.charges.length - withAmount.length} rows carry no amount`
        }
      >
        <Numeral value={data.charges.length} />
      </Cell>

      <Cell
        label="IN CUSTODY"
        caption="escrow still held, summed across vault generations"
      >
        <Numeral value={Number(fmtStrk(data.escrowWei))} decimals={2} unit="STRK" />
      </Cell>

      {/* The empty half of the second grid row, so the container's divider
          colour does not paint a solid block there. Absent on desktop. */}
      <div aria-hidden="true" className="bg-surface-sunken md:hidden" />

      <Cell
        label="LAST CHARGE"
        className="col-span-2 md:flex-[1.6]"
        caption={
          last
            ? `${utcTime(last.timestamp)} UTC · tx ${truncate(last.txHash)}` +
              (last.amountWei !== null ? ` · ${fmtStrk(last.amountWei)} STRK` : "") +
              ` · period ${String(last.periodIndex).padStart(2, "0")}`
            : "no charge has been decoded at this vault yet"
        }
      >
        {last ? (
          <span className="flex flex-wrap items-baseline gap-2">
            <StatusDot state={data.snapshot ? "pending" : "live"} size={6} beat={!data.snapshot} />
            <span className="text-[14px] text-text-default">
              block{" "}
              <span className="font-medium text-ns-accent tabular-nums">
                {fmtBlock(last.block)}
              </span>
              , nobody at a keyboard
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
          <span className="flex items-baseline gap-2">
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
