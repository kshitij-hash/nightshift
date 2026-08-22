// Placeholder board route: proves the pipe end to end. Raw, undesigned -
// the real board layout (heartbeat instrument, tick bar, choreography) is
// the next phase. This just has to render live vault data honestly,
// including the SNAPSHOT badge when the RPC fallback engages.
import NumberFlow from "@number-flow/react";
import { useSearch } from "@tanstack/react-router";

import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableCellNumeric,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { fmtBlock, fmtStrk, truncate, utc, VOYAGER_TX } from "../config";
import { useBoard } from "../query/useBoard";

export function BoardRoute() {
  const search = useSearch({ from: "/" });
  const { data, isPending, isError, error } = useBoard();

  if (isPending) {
    return (
      <div className="max-w-[1120px] mx-auto px-4 py-8 space-y-4">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    // readBoard() itself never throws - it falls back to the snapshot on
    // total RPC failure - so reaching this branch means something upstream
    // of the query broke, not a chain-read failure.
    return (
      <div className="max-w-[1120px] mx-auto px-4 py-8">
        <p className="text-[14px] text-destructive">
          Board query failed to run: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    );
  }

  const lastCharge = data.charges[0];
  const head = utc(data.headTimestamp);

  return (
    <div className="max-w-[1120px] mx-auto px-4 py-8 space-y-6">
      <div className="text-[13px] uppercase tracking-[0.2em] text-text-label">
        // BOARD - DECODED FROM MAINNET EVENTS
      </div>

      {data.provenance.source === "snapshot" && (
        <div className="flex items-center gap-2 rounded-md border border-border-panel px-3 py-2 text-[12px] text-text-caption">
          <Badge variant="outline">SNAPSHOT</Badge>
          <span>
            Every configured RPC endpoint failed. Showing the committed snapshot from block{" "}
            {fmtBlock(data.provenance.snapshotBlock ?? 0)}.
          </span>
        </div>
      )}
      {data.provenance.source === "rpc" && data.provenance.partial.length > 0 && (
        <div className="rounded-md border border-border-panel px-3 py-2 text-[12px] text-text-caption">
          Partial read: {data.provenance.partial.join("; ")}
        </div>
      )}
      {search.demo && (
        <div className="text-[12px] text-text-caption">
          <Badge variant="outline">DEMO WINDOW</Badge> replay data requested via ?demo=1 - board
          still shows the live read path in this scaffold.
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-hairline bg-border-hairline sm:grid-cols-4">
        <div className="bg-surface-panel p-4">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-text-label">
            HEAD BLOCK
          </div>
          <div className="text-[28px] leading-none font-semibold tabular-nums">
            <NumberFlow value={data.headBlock} />
          </div>
          <div className="mt-1 text-[12px] text-text-caption">
            {head.date} {head.time} UTC
          </div>
        </div>
        <div className="bg-surface-panel p-4">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-text-label">
            ESCROW
          </div>
          <div className="text-[28px] leading-none font-semibold tabular-nums">
            {fmtStrk(data.escrowWei)}
          </div>
          <div className="mt-1 text-[12px] text-text-caption">STRK across all vaults</div>
        </div>
        <div className="bg-surface-panel p-4">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-text-label">
            ACTIVE SUBSCRIPTIONS
          </div>
          <div className="text-[28px] leading-none font-semibold tabular-nums">
            {data.activeSubscriptions}
          </div>
        </div>
        <div className="bg-surface-panel p-4">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-text-label">
            CHARGE COUNT
          </div>
          <div className="text-[28px] leading-none font-semibold tabular-nums">
            {data.charges.length}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[13px] font-medium text-text-label">LAST CHARGE</div>
        {lastCharge ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TX</TableHead>
                <TableHead>VAULT</TableHead>
                <TableHead>COMMITMENT</TableHead>
                <TableHead className="text-right">PERIOD</TableHead>
                <TableHead className="text-right">AMOUNT</TableHead>
                <TableHead>WHEN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <a
                    href={VOYAGER_TX(lastCharge.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-text-link hover:underline"
                  >
                    {truncate(lastCharge.txHash)}
                  </a>
                </TableCell>
                <TableCell>{lastCharge.vault}</TableCell>
                <TableCell>{truncate(lastCharge.commitment)}</TableCell>
                <TableCellNumeric>{lastCharge.periodIndex}</TableCellNumeric>
                <TableCellNumeric>
                  {lastCharge.amountWei !== null ? `${fmtStrk(lastCharge.amountWei)} STRK` : "-"}
                </TableCellNumeric>
                <TableCell>
                  {utc(lastCharge.timestamp).date} {utc(lastCharge.timestamp).time} UTC
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <p className="text-[13px] text-text-caption">No charges recorded yet.</p>
        )}
      </div>
    </div>
  );
}
