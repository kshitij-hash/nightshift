// The charge feed: every charge these vaults fired, newest first, with the
// block and the receipt that prove it. This is the audit path on the board,
// so nothing here is summarized and nothing is rounded away.
//
// The nullifier column renders the derivation h(commitment ‖ period) rather
// than invented hex: the vault consumes the nullifier in storage and does not
// publish it in the event, so the expression is the honest thing to show.

import { fmtBlock, fmtStrk, truncate, VOYAGER_TX } from "../../config";
import type { Charge } from "../../lib/board";
import type { Schedule } from "../../lib/schedule";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableCellNumeric,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { utcStamp } from "./derive";
import type { WindowInfo } from "./derive";
import { HashCopy, SectionHead, StatusDot } from "./primitives";
import type { DotState } from "./primitives";
import { useRowEntrance } from "./use-fresh-rows";

const pad2 = (n: number) => String(n).padStart(2, "0");

export type FeedRow = {
  key: string;
  dot: DotState;
  vaultTag: string;
  period: string;
  time: string;
  block: number;
  amount: string | null;
  nullifier: string;
  nullifierTitle: string;
  txDisplay: string | null;
  txFull: string | null;
  status: string;
  href: string | null;
  muted: boolean;
};

function chargeStatus(schedule: Schedule | null | undefined, c: Charge): string {
  if (!schedule || schedule.periodBlocks <= 0) return "CHARGED";
  if (BigInt(c.commitment) !== BigInt(schedule.commitment)) return "CHARGED";
  const windowBlock = schedule.startBlock + c.periodIndex * schedule.periodBlocks;
  return c.block < windowBlock + schedule.periodBlocks ? "ON SCHEDULE" : "LATE";
}

export function buildFeedRows(
  charges: Charge[],
  schedule: Schedule | null | undefined,
  window: WindowInfo,
): FeedRow[] {
  const rows: FeedRow[] = charges.map((c) => ({
    key: `${c.txHash}:${c.periodIndex}`,
    dot: "settled",
    vaultTag: c.vault.toUpperCase(),
    period: pad2(c.periodIndex),
    time: `${utcStamp(c.timestamp)} UTC`,
    block: c.block,
    amount: c.amountWei !== null ? fmtStrk(c.amountWei) : null,
    nullifier: `h(${truncate(c.commitment, 6, 4)} ‖ ${pad2(c.periodIndex)})`,
    nullifierTitle:
      `nullifier = h(commitment ‖ period). commitment ${c.commitment} · ` +
      `period ${pad2(c.periodIndex)} · click to copy the expression`,
    txDisplay: truncate(c.txHash, 6, 4),
    txFull: c.txHash,
    status: chargeStatus(schedule, c),
    href: VOYAGER_TX(c.txHash),
    muted: false,
  }));

  if (schedule && window.block !== null) {
    rows.push({
      key: "pending",
      dot: "pending",
      vaultTag: "",
      period: pad2(schedule.nextPeriod),
      time: window.overdue ? "window open, uncharged" : "not charged yet",
      block: window.block,
      amount: null,
      nullifier: "not derivable until charged",
      nullifierTitle: "the nullifier is consumed by the charge that spends it",
      txDisplay: null,
      txFull: null,
      status: window.overdue ? "WINDOW OPEN" : "PENDING",
      href: null,
      muted: true,
    });
  } else if (schedule && window.complete) {
    const after = schedule.startBlock + schedule.nPeriods * schedule.periodBlocks;
    rows.push({
      key: "complete",
      dot: "pending",
      vaultTag: "",
      period: pad2(schedule.nPeriods),
      time: "outside the schedule",
      block: after,
      amount: null,
      nullifier:
        schedule.escrowWei === 0n
          ? "no nullifier · escrow spent"
          : "no nullifier · schedule ended",
      nullifierTitle: `the subscription bought ${schedule.nPeriods} periods and all of them were charged`,
      txDisplay: null,
      txFull: null,
      status: "NO FURTHER PERIODS",
      href: null,
      muted: true,
    });
  }
  return rows;
}

const LOAD_STAGGER_MS = 20;
const MAX_STAGGERED = 10;

function entranceStyle(kind: "load" | "arrival", index: number): React.CSSProperties {
  if (kind === "arrival") {
    return { animation: "ns-row-in var(--dur-base) var(--ease-out) both" };
  }
  return {
    animation: "ns-row-in var(--dur-base) var(--ease-out) both",
    animationDelay: `${Math.min(index, MAX_STAGGERED) * LOAD_STAGGER_MS}ms`,
  };
}

const FLASH_STYLE: React.CSSProperties = {
  animation: "ns-row-flash var(--flash-row) var(--ease-out) forwards",
};

/** A phone card is one element, so its entrance and its flash share one
 *  animation shorthand instead of being split across row and cell. */
function cardStyle(kind: "load" | "arrival", index: number): React.CSSProperties {
  if (kind === "arrival") {
    return {
      animation:
        "ns-row-in var(--dur-base) var(--ease-out) both, ns-row-flash var(--flash-row) var(--ease-out) forwards",
    };
  }
  return entranceStyle(kind, index);
}

export function ChargeFeed({
  rows,
  note,
  caption,
}: {
  rows: FeedRow[];
  note: string;
  caption: string;
}) {
  const entrance = useRowEntrance(rows.map((r) => r.key));

  return (
    <div className="flex flex-col gap-3">
      <SectionHead note={note}>// CHARGE FEED · DECODED FROM MAINNET EVENTS</SectionHead>

      {/* Desktop and tablet: the full evidence table. */}
      <div className="hidden border border-border-hairline md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[24px]" />
              <TableHead className="w-[76px]">PERIOD</TableHead>
              <TableHead className="w-[200px]">TIME (UTC)</TableHead>
              <TableHead className="w-[110px]">BLOCK</TableHead>
              <TableHead className="w-[110px] text-right">AMOUNT</TableHead>
              <TableHead>NULLIFIER</TableHead>
              <TableHead className="w-[128px]">STATUS</TableHead>
              <TableHead className="w-[150px]">TX</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              // Only a real charge can arrive. The trailing pending row is a
              // statement about the schedule, not an event, so it never flashes.
              const kind = r.txFull ? entrance(r.key) : "load";
              return (
                <TableRow key={r.key} style={entranceStyle(kind, i)}>
                  <TableCell style={kind === "arrival" ? FLASH_STYLE : undefined}>
                    <StatusDot state={r.dot} size={7} />
                  </TableCell>
                  <TableCell className="text-text-strong">
                    {r.vaultTag ? (
                      <span className="mr-1.5 text-[10px] tracking-[0.08em] text-text-label">
                        {r.vaultTag}
                      </span>
                    ) : null}
                    {r.period}
                  </TableCell>
                  <TableCell className={r.muted ? "text-text-caption" : "text-[13px]"}>
                    {r.time}
                  </TableCell>
                  <TableCellNumeric
                    className={r.muted ? "text-left text-text-caption" : "text-left text-ns-accent"}
                  >
                    {fmtBlock(r.block)}
                  </TableCellNumeric>
                  <TableCellNumeric className={r.muted ? "text-text-caption" : "text-text-strong"}>
                    {r.amount === null ? (
                      "·"
                    ) : (
                      <>
                        {r.amount}
                        <span className="font-normal text-text-label"> STRK</span>
                      </>
                    )}
                  </TableCellNumeric>
                  <TableCell className="text-[13px]">
                    {r.muted ? (
                      <span className="text-text-caption">{r.nullifier}</span>
                    ) : (
                      <HashCopy
                        value={r.nullifier}
                        title={r.nullifierTitle}
                        className="text-[13px]"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        r.muted
                          ? "text-[10px] tracking-[0.14em] text-text-caption"
                          : "text-[10px] tracking-[0.14em] text-text-label"
                      }
                    >
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.href && r.txDisplay ? (
                      <a
                        href={r.href}
                        target="_blank"
                        rel="noreferrer"
                        title={`${r.txFull} · open this transaction on voyager`}
                        className="inline-flex min-h-6 items-center"
                      >
                        {r.txDisplay} <span aria-hidden="true">&nbsp;↗</span>
                      </a>
                    ) : (
                      <span className="text-text-caption">·</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableCaption>{caption}</TableCaption>
        </Table>
      </div>

      {/* Phone: the same rows as two-line cards. Same entrance, same flash. */}
      <div className="border border-border-hairline md:hidden">
        {rows.map((r, i) => {
          const kind = r.txFull ? entrance(r.key) : "load";
          return (
            <div
              key={r.key}
              className="flex flex-col gap-2 border-t border-border-row bg-surface-panel px-3.5 py-3 first:border-t-0"
              style={cardStyle(kind, i)}
            >
              <div className="flex items-center gap-2">
                <StatusDot state={r.dot} size={8} />
                <span className="text-[13px] text-text-strong">
                  {r.vaultTag ? (
                    <span className="mr-1 text-[10px] tracking-[0.08em] text-text-label">
                      {r.vaultTag}
                    </span>
                  ) : null}
                  {r.period}
                </span>
                {r.amount !== null ? (
                  <span className="ml-1.5 text-[13px] font-medium text-text-strong">
                    {r.amount}
                    <span className="font-normal text-text-label"> STRK</span>
                  </span>
                ) : null}
                <span className="ml-auto text-[10px] tracking-[0.14em] text-text-label">
                  {r.status}
                </span>
                {r.href ? (
                  <a
                    href={r.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 w-11 items-center justify-center"
                  >
                    <span aria-hidden="true">↗</span>
                    <span className="sr-only">open on voyager</span>
                  </a>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-caption">
                <span>{r.time}</span>
                <span className={r.muted ? "" : "text-ns-accent"}>{fmtBlock(r.block)}</span>
                {r.txFull && r.txDisplay ? (
                  <HashCopy
                    value={r.txFull}
                    display={r.txDisplay}
                    tone="caption"
                    className="text-[11px]"
                  />
                ) : null}
              </div>
            </div>
          );
        })}
        <p className="border-t border-border-row px-3.5 py-3 text-[12px] leading-[1.4] text-text-caption">
          {caption}
        </p>
      </div>
    </div>
  );
}
