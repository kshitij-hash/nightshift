// One row per commitment, with the lifecycle carried by state tags rather
// than by a color or an icon a reader has to learn.
//
// Below the table's breakpoint the same rows render as cards, one definition
// list each, rather than as a table the reader has to drag sideways. A page
// that scrolls horizontally on a phone is a layout failure, and a nine-column
// table on a 390px screen is that failure.
//
// The escrow column is labelled CONTRACTED, not "escrow in": the vault
// publishes the remaining escrow and the tier price, so the amount a
// subscription committed to is tier price times n_periods. That is a
// multiplication this page did, not a deposit it watched land.

import { fmtStrk, truncate, VOYAGER_TX } from "../../config";
import { Badge } from "../ui/badge";
import { HashCopy } from "../board/primitives";
import {
  Table,
  TableBody,
  TableCell,
  TableCellNumeric,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { STATE_IS_LIVE, stampUtc } from "./derive";
import type { SubscriptionRow, SubState } from "./derive";

/** Each tag carries its own definition, on the tag, instead of in a paragraph
 *  of five definitions under the table that a reader has to hold in their head
 *  while they scan rows. */
const STATE_MEANING: Record<SubState, string> = {
  ACTIVE: "the vault would charge again.",
  ENTITLED: "a gate would admit right now.",
  ARREARS: "a period is past its due height and uncharged.",
  CANCELLED: "the subscriber signed a cancel.",
  EXHAUSTED: "escrow can no longer cover the next charge.",
};

const MONEY_MEANING: Record<string, string> = {
  CONTRACTED:
    "the tier price times n_periods from schedule_of, which is what the subscription committed to.",
  "ESCROW LEFT": "what the vault still holds against this commitment.",
};

/** A header cell that answers what its column measures. */
function DefinedHead({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[36ch]">{MONEY_MEANING[label]}</TooltipContent>
    </Tooltip>
  );
}

function StateTags({ states }: { states: SubState[] }) {
  if (states.length === 0) {
    return <span className="text-[12px] text-text-caption">no schedule read</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {states.map((s) => (
        <Tooltip key={s}>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Badge
                variant="outline"
                className={STATE_IS_LIVE[s] ? "border-ns-accent text-ns-accent" : undefined}
              >
                {s}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[36ch]">{STATE_MEANING[s]}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

const amount = (wei: bigint | null) => (wei === null ? "unread" : fmtStrk(wei));

/** Timestamps drop their UTC suffix inside the table because the column
 *  header carries it once for the whole column. Everywhere a stamp appears
 *  on its own, the suffix comes with it. */
const stampCell = (ts: number | undefined) =>
  ts === undefined ? "none" : stampUtc(ts).replace(" UTC", "");

function ReceiptLink({
  tx,
  label,
  compact = false,
}: {
  tx: string;
  label: string;
  compact?: boolean;
}) {
  return (
    <a
      href={VOYAGER_TX(tx)}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className="inline-flex min-h-11 items-center px-2 text-[12px] whitespace-nowrap md:min-h-6"
    >
      {compact ? "↗" : "verify on voyager ↗"}
    </a>
  );
}

/** The table's own truncation, tighter than the page default so nine columns
 *  of audit data fit a desktop without the reader dragging sideways. */
const shortHash = (hex: string) => truncate(hex, 4, 4);

export function SubscriptionTable({ rows }: { rows: SubscriptionRow[] }) {
  return (
    <>
      {/* Desktop and tablet: the audit path, nine columns, numerics right. */}
      <div className="hidden border border-border-hairline lg:block">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2.5">COMMITMENT</TableHead>
              <TableHead className="px-2.5">TIER</TableHead>
              <TableHead className="px-2.5">CADENCE (BLOCKS)</TableHead>
              <TableHead className="px-2.5 text-right">PERIODS</TableHead>
              <TableHead className="px-2.5 text-right">
                <DefinedHead label="CONTRACTED" />
              </TableHead>
              <TableHead className="px-2.5 text-right">
                <DefinedHead label="ESCROW LEFT" />
              </TableHead>
              <TableHead className="px-2.5">FIRST CHARGE (UTC)</TableHead>
              <TableHead className="px-2.5">LAST CHARGE (UTC)</TableHead>
              <TableHead className="px-2.5">STATE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.commitment}>
                <TableCell className="px-2.5 text-text-strong">
                  <span className="inline-flex items-center gap-1">
                    <HashCopy value={r.commitment} display={shortHash(r.commitment)} tone="strong" />
                    <ReceiptLink
                      compact
                      tx={r.subscribeTx}
                      label={`subscribe receipt for ${shortHash(r.commitment)} on voyager`}
                    />
                  </span>
                </TableCell>
                <TableCell className="px-2.5">{r.tier === null ? "unread" : r.tier}</TableCell>
                <TableCell className="px-2.5 text-text-caption">{r.cadenceShort}</TableCell>
                <TableCellNumeric className="px-2.5 text-text-strong">
                  {r.chargedPeriods} / {r.nPeriods}
                </TableCellNumeric>
                <TableCellNumeric className="px-2.5">
                  {amount(r.contractedWei)}
                  <span className="text-text-label"> STRK</span>
                </TableCellNumeric>
                <TableCellNumeric className="px-2.5 text-text-strong">
                  {amount(r.escrowLeftWei)}
                  <span className="text-text-label"> STRK</span>
                </TableCellNumeric>
                <TableCell className="px-2.5 text-text-caption">
                  {stampCell(r.firstCharge?.time?.ts)}
                </TableCell>
                <TableCell className="px-2.5 text-text-caption">
                  {stampCell(r.lastCharge?.time?.ts)}
                </TableCell>
                <TableCell className="px-2.5">
                  <StateTags states={r.states} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Narrow: one card per commitment, same fields, same order. */}
      <div className="flex flex-col gap-3 lg:hidden">
        {rows.map((r) => (
          <div
            key={r.commitment}
            className="flex flex-col gap-3 border border-border-panel bg-surface-panel px-4 py-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <HashCopy
                value={r.commitment}
                display={truncate(r.commitment)}
                tone="strong"
                className="text-[13px]"
              />
              <StateTags states={r.states} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px] leading-[1.45]">
              <dt className="text-text-label">tier</dt>
              <dd className="text-text-default">{r.tier === null ? "unread" : r.tier}</dd>
              <dt className="text-text-label">cadence</dt>
              <dd className="text-text-default">{r.cadence}</dd>
              <dt className="text-text-label">periods</dt>
              <dd className="text-text-default tabular-nums">
                {r.chargedPeriods} / {r.nPeriods}
              </dd>
              <dt className="text-text-label">contracted</dt>
              <dd className="text-text-default tabular-nums">
                {amount(r.contractedWei)}
                <span className="text-text-label"> STRK</span>
              </dd>
              <dt className="text-text-label">escrow left</dt>
              <dd className="text-text-default tabular-nums">
                {amount(r.escrowLeftWei)}
                <span className="text-text-label"> STRK</span>
              </dd>
              <dt className="text-text-label">first charge</dt>
              <dd className="text-text-default">
                {r.firstCharge ? stampUtc(r.firstCharge.time?.ts) : "none"}
              </dd>
              <dt className="text-text-label">last charge</dt>
              <dd className="text-text-default">
                {r.lastCharge ? stampUtc(r.lastCharge.time?.ts) : "none"}
              </dd>
            </dl>
            <ReceiptLink
              tx={r.subscribeTx}
              label={`subscribe receipt for ${truncate(r.commitment)} on voyager`}
            />
          </div>
        ))}
      </div>
    </>
  );
}
