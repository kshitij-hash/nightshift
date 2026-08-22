// The provenance strip. It is a first-class element of this page, not fine
// print: if the read did not come from a live node, the page says so before it
// says anything else, in the same anatomy every time. A badge, one paragraph
// that states what is stale and what is still checkable, and a link out.

import { fmtBlock, VOYAGER_CONTRACT, VAULT } from "../../config";
import { Badge } from "../ui/badge";
import { StatusDot } from "./primitives";

export type BoardMode = "live" | "snapshot" | "demo";

/** The masthead chip: which chain, which block, or which failure. */
export function ChainChip({ mode, headBlock }: { mode: BoardMode; headBlock: number }) {
  const live = mode === "live";
  return (
    <span className="inline-flex items-center gap-2 border border-border-panel px-2.5 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label">
      <StatusDot state={live ? "live" : "pending"} size={6} beat={live} />
      {mode === "snapshot"
        ? "RPC UNREACHABLE · SERVING SNAPSHOT"
        : mode === "demo"
          ? `DEMO REPLAY · BLOCK ${fmtBlock(headBlock)}`
          : `MAINNET · BLOCK ${fmtBlock(headBlock)}`}
    </span>
  );
}

export function SnapshotBanner({ snapshotBlock }: { snapshotBlock: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border border-ns-accent bg-surface-sunken px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-ns-accent text-ns-accent">
          SNAPSHOT @ BLOCK {fmtBlock(snapshotBlock)}
        </Badge>
        <p className="max-w-[860px] text-[13px] leading-[1.7] text-text-prose">
          Every configured JSON-RPC endpoint failed. This page is rendering from data committed to
          the repository at block {fmtBlock(snapshotBlock)}, not from a live node. Every row below
          is still checkable on Voyager. Nothing here was refreshed after that block, and the clock
          is not running.
        </p>
      </div>
      <a
        href={`${VOYAGER_CONTRACT(VAULT)}#events`}
        target="_blank"
        rel="noreferrer"
        className="text-[12px]"
      >
        check the source on voyager ↗
      </a>
    </div>
  );
}

export function DemoBanner({
  landed,
  total,
  intervalSecs,
}: {
  landed: number;
  total: number;
  intervalSecs: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border border-ns-accent bg-surface-sunken px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-ns-accent text-ns-accent">
          DEMO REPLAY
        </Badge>
        <p className="max-w-[860px] text-[13px] leading-[1.7] text-text-prose">
          This board was opened with ?demo=1. The vault read is the real one, and so are the rows:
          the last {total} charges are held back and re-fired every {intervalSecs} seconds so the
          arrival choreography can be watched on demand. {landed} of {total} have landed in this
          pass. Nothing was added, nothing was invented, and the countdown on the dial is the replay
          timer, not a chain deadline. Drop the query parameter for the live board.
        </p>
      </div>
    </div>
  );
}

export function PartialBanner({ notes }: { notes: string[] }) {
  return (
    <div className="border border-border-panel bg-surface-sunken px-5 py-3">
      <p className="text-[12px] leading-[1.5] text-text-caption">
        Partial read. Some of this page is a prefix of the real history: {notes.join("; ")}.
      </p>
    </div>
  );
}
