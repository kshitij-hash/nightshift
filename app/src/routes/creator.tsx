// Placeholder creator dashboard: proves useCreatorLedger + allMetrics end to
// end for a pasted ?creator= id. Plain rows, no chart, no tiles - the real
// dashboard layout is the next phase.
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableCellNumeric, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { fmtStrk } from "../config";
import { useCreatorLedger } from "../query/useCreatorLedger";

function formatMetricValue(value: unknown): string {
  if (typeof value === "bigint") return `${fmtStrk(value)} STRK`;
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return `${value.length} row(s)`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function CreatorRoute() {
  const search = useSearch({ from: "/creator" });
  const navigate = useNavigate({ from: "/creator" });
  const [draft, setDraft] = useState(search.creator ?? "");

  const creatorIds = search.creator ? [search.creator] : [];
  const { data, isPending, isError, error, isFetching } = useCreatorLedger(creatorIds);

  const submit = () => {
    void navigate({ search: (prev) => ({ ...prev, creator: draft || undefined }) });
  };

  return (
    <div className="max-w-[1120px] mx-auto px-4 py-8 space-y-6">
      <div className="text-[13px] uppercase tracking-[0.2em] text-text-label">
        // CREATOR DASHBOARD - LOCAL SUM OVER PUBLIC EVENTS
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="0x… creator id"
          className="h-8 flex-1 rounded-md border border-border-field bg-surface-field px-3 text-[13px] font-mono text-text-default outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="md" onClick={submit}>
          LOAD
        </Button>
      </div>

      {search.invalidCreator && (
        <p className="text-[12px] text-destructive">
          "{search.invalidCreator}" is not a valid 0x-hex felt. Nothing was loaded.
        </p>
      )}

      {!search.creator && !search.invalidCreator && (
        <p className="text-[13px] text-text-caption">
          Paste a creator id (or open this page with ?creator=0x...) to load its ledger.
        </p>
      )}

      {search.creator && isPending && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {search.creator && isError && (
        <p className="text-[13px] text-destructive">
          Ledger query failed to run: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {search.creator && data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-caption">
            <Badge variant="outline">{data.ledger.provenance.source.toUpperCase()}</Badge>
            {isFetching && <span>refreshing…</span>}
            <span>head block {data.ledger.headBlock.toLocaleString("en-US")}</span>
            {data.ledger.provenance.truncated && (
              <span className="text-destructive">at least one scan hit its page cap</span>
            )}
          </div>

          {data.ledger.provenance.partial.length > 0 && (
            <div className="rounded-md border border-border-panel px-3 py-2 text-[12px] text-text-caption">
              {data.ledger.provenance.partial.length} read(s) incomplete:{" "}
              {data.ledger.provenance.partial.join("; ")}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>METRIC</TableHead>
                <TableHead className="text-right">VALUE</TableHead>
                <TableHead>UNIT</TableHead>
                <TableHead>BASIS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(data.metrics).map(([key, metric]) => (
                <TableRow key={key}>
                  <TableCell className="text-text-label">{key}</TableCell>
                  <TableCellNumeric>{formatMetricValue(metric.value)}</TableCellNumeric>
                  <TableCell className="text-text-caption">{metric.unit}</TableCell>
                  <TableCell className="text-text-caption whitespace-normal">
                    {metric.basis}
                    {metric.caveat ? ` (${metric.caveat})` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
