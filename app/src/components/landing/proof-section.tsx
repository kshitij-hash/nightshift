// The receipts. Everything above this section is a claim; this is the part a
// reader can check without the page.
//
// Three rows, because three is what a landing can hold without becoming the
// board. Each one is a mainnet transaction with its block and its hash, and the
// caption says exactly how many charges the count is drawn from, so a reader
// who sees three rows under a larger number knows the difference is the older
// history rather than a rounding. Under the table are the addresses and the two
// published packages, and under those the one link to the full board.

import {
  fmtBlock,
  fmtStrk,
  GATE,
  truncate,
  VAULT,
  VOYAGER_CONTRACT,
  VOYAGER_TX,
} from "../../config";
import type { Charge } from "../../lib/board";
import { cn } from "../../lib/utils";
import { Link } from "@tanstack/react-router";

import { utcStamp } from "../board/derive";
import { HashCopy, SectionHead, StatusDot } from "../board/primitives";
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

const SHOWN = 3;

const pad2 = (n: number) => String(n).padStart(2, "0");

function tableCaption(total: number, shown: number, snapshot: boolean): string {
  const scope =
    total > shown
      ? `The last ${shown} of ${total} charges at this vault.`
      : `Every one of the ${total} charge${total === 1 ? "" : "s"} at this vault.`;
  const source = snapshot
    ? "These rows are committed snapshot data, not a live read, and each one is still checkable on Voyager without this page."
    : "Every row is a mainnet transaction, checkable on Voyager without this page.";
  return `${scope} ${source}`;
}

type ReceiptRow = { key: string; value: string; href: string | null; hash: boolean };

function receiptRows(creatorId: string | null): ReceiptRow[] {
  const rows: ReceiptRow[] = [
    { key: "vault v4", value: VAULT, href: VOYAGER_CONTRACT(VAULT), hash: true },
    { key: "tier gate", value: GATE, href: VOYAGER_CONTRACT(GATE), hash: true },
  ];
  // Only when a schedule was read. A creator id is not derivable from a charge
  // event, so an unread one gets no row rather than a placeholder.
  if (creatorId !== null) {
    rows.push({ key: "creator", value: creatorId, href: null, hash: true });
  }
  rows.push(
    {
      key: "npm nightshift-verify",
      value: "verifies a presentation against vault state",
      href: "https://www.npmjs.com/package/nightshift-verify",
      hash: false,
    },
    {
      key: "npm strk20-preflight",
      value: "preflights a pool action before signing",
      href: "https://www.npmjs.com/package/strk20-preflight",
      hash: false,
    },
  );
  return rows;
}

function ChargeRows({ charges }: { charges: Charge[] }) {
  return (
    <>
      {charges.map((c) => (
        <TableRow key={`${c.txHash}:${c.periodIndex}`}>
          <TableCell className="w-[24px]">
            <StatusDot state="settled" size={7} />
          </TableCell>
          <TableCell className="w-[78px] text-text-strong">{pad2(c.periodIndex)}</TableCell>
          <TableCell className="w-[196px] text-[13px]">{`${utcStamp(c.timestamp)} UTC`}</TableCell>
          <TableCellNumeric className="w-[128px] text-left text-ns-accent">
            {fmtBlock(c.block)}
          </TableCellNumeric>
          <TableCellNumeric className="w-[128px] text-text-strong">
            {c.amountWei === null ? (
              "·"
            ) : (
              <>
                {fmtStrk(c.amountWei)}
                <span className="font-normal text-text-label"> STRK</span>
              </>
            )}
          </TableCellNumeric>
          <TableCell className="text-[13px]">
            <HashCopy value={c.txHash} display={truncate(c.txHash)} className="text-[13px]" />
          </TableCell>
          <TableCell className="w-[34px] text-[13px]">
            <a
              href={VOYAGER_TX(c.txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-6 items-center"
              title={`${c.txHash} · open this transaction on voyager`}
            >
              <span aria-hidden="true">↗</span>
              <span className="sr-only">open on voyager</span>
            </a>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function ChargeCards({ charges }: { charges: Charge[] }) {
  return (
    <div className="border border-border-hairline">
      {charges.map((c) => (
        <div
          key={`${c.txHash}:${c.periodIndex}`}
          className="flex flex-col gap-2 border-t border-border-row bg-surface-panel px-3.5 py-3 first:border-t-0"
        >
          <div className="flex items-center gap-2">
            <StatusDot state="settled" size={7} />
            <span className="text-[12.5px] text-text-strong">{pad2(c.periodIndex)}</span>
            {c.amountWei !== null ? (
              <span className="ml-1 text-[12.5px] font-medium text-text-strong">
                {fmtStrk(c.amountWei)}
                <span className="font-normal text-text-label"> STRK</span>
              </span>
            ) : null}
            <a
              href={VOYAGER_TX(c.txHash)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex h-11 w-11 items-center justify-center"
            >
              <span aria-hidden="true">↗</span>
              <span className="sr-only">open on voyager</span>
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-text-caption">
            <span>{`${utcStamp(c.timestamp)} UTC`}</span>
            <span className="text-ns-accent">{fmtBlock(c.block)}</span>
            <HashCopy
              value={c.txHash}
              display={truncate(c.txHash)}
              tone="caption"
              className="text-[10.5px]"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProofSection({
  charges,
  creatorId,
  snapshot,
  compact,
}: {
  charges: Charge[];
  creatorId: string | null;
  snapshot: boolean;
  compact: boolean;
}) {
  const shown = charges.slice(0, SHOWN);
  const caption = tableCaption(charges.length, shown.length, snapshot);

  return (
    <section className="flex flex-col gap-4">
      <SectionHead note="read over JSON-RPC, no key, snapshot fallback labelled">
        {snapshot ? "// THE RECEIPTS · MAINNET, SNAPSHOT" : "// THE RECEIPTS · MAINNET, LIVE"}
      </SectionHead>

      {shown.length === 0 ? (
        <p className="border border-border-hairline px-5 py-4 text-[13px] leading-[1.7] text-text-prose">
          No charge has been decoded at this vault yet. The vault event log on Voyager carries the
          same events this page reads, and it will show the first one before this page does.
        </p>
      ) : compact ? (
        <>
          <ChargeCards charges={shown} />
          <p className="text-[11px] leading-[1.5] text-text-caption">{caption}</p>
        </>
      ) : (
        <div className="border border-border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[24px]" />
                <TableHead className="w-[78px]">PERIOD</TableHead>
                <TableHead className="w-[196px]">TIME (UTC)</TableHead>
                <TableHead className="w-[128px]">BLOCK</TableHead>
                <TableHead className="w-[128px] text-right">AMOUNT</TableHead>
                <TableHead>TX</TableHead>
                <TableHead className="w-[34px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <ChargeRows charges={shown} />
            </TableBody>
            <TableCaption>{caption}</TableCaption>
          </Table>
        </div>
      )}

      {/* Two columns on a wide screen: five label-and-value rows at full width
          would be five near-empty lines on a page that is already long. The
          dividers are the 1px gaps, which land a hairline on every internal
          edge of either layout without counting children. */}
      <dl className="grid gap-px border border-border-hairline bg-border-row lg:grid-cols-2">
        {receiptRows(creatorId).map((r, i, rows) => (
          <div
            key={r.key}
            className={cn(
              "flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-surface-page px-4 py-2.5",
              // An odd row count would leave the last grid cell empty, and an
              // empty cell here is a solid block of divider colour.
              i === rows.length - 1 && rows.length % 2 === 1 && "lg:col-span-2",
            )}
          >
            <dt className="w-[130px] shrink-0 text-[11px] leading-[1.45] text-text-caption lg:w-[150px]">
              {r.key}
            </dt>
            <dd className="min-w-0 flex-1 text-[12px] lg:text-right">
              {r.hash ? (
                <HashCopy value={r.value} display={truncate(r.value)} className="text-[12px]" />
              ) : (
                <a href={r.href ?? undefined} target="_blank" rel="noreferrer">
                  {r.value} <span aria-hidden="true">↗</span>
                </a>
              )}
              {r.hash && r.href ? (
                <>
                  {" "}
                  <a href={r.href} target="_blank" rel="noreferrer" className="text-[12px]">
                    <span aria-hidden="true">↗</span>
                    <span className="sr-only">{`open ${r.key} on voyager`}</span>
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-4 border border-border-panel bg-surface-sunken px-5 py-4">
        <div className="flex flex-col gap-1">
          <Link to="/board" className="text-[15px] font-medium">
            the full board <span aria-hidden="true">→</span> /board
          </Link>
          <span className="text-[11px] leading-[1.45] text-text-caption">
            every charge, the instrument, the demo replay
          </span>
        </div>
        <span className="max-w-[38ch] text-[11px] leading-[1.45] text-text-caption lg:text-right">
          the board reads mainnet with no key and says SNAPSHOT when the read fails
        </span>
      </div>
    </section>
  );
}
