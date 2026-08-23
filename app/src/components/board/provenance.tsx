// The provenance strip. It is a first-class element of this page, not fine
// print: if the read did not come from a live node, the page says so before it
// says anything else, in the same anatomy every time. A badge, one paragraph
// that states what is stale and what is still checkable, and a link out.

import { fmtBlock, VOYAGER_CONTRACT, VAULT } from "../../config";
import { Badge } from "../ui/badge";
import { StatusDot } from "./primitives";

export type BoardMode = "live" | "snapshot" | "demo";

/** The masthead chip: which chain, which block, or which failure.
 *
 *  On a phone the qualifier is dropped and the block number is kept, because
 *  the block is the part that changes and the chrome has one row to spend on
 *  it. The full wording is in the DOM either way, so a screen reader and a
 *  find-in-page get the whole chip at any width. */
export function ChainChip({ mode, headBlock }: { mode: BoardMode; headBlock: number }) {
  const live = mode === "live";
  const qualifier =
    mode === "snapshot" ? "RPC UNREACHABLE · SERVING" : mode === "demo" ? "DEMO REPLAY ·" : "MAINNET ·";
  const value = mode === "snapshot" ? "SNAPSHOT" : `BLOCK ${fmtBlock(headBlock)}`;
  return (
    <span className="inline-flex items-center gap-2 border border-border-panel px-2 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label md:px-2.5">
      <StatusDot state={live ? "live" : "pending"} size={6} beat={live} />
      <span className="hidden md:inline">{qualifier}&nbsp;</span>
      <span className="sr-only md:hidden">{qualifier} </span>
      {value}
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
        verify on voyager ↗
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
    <div className="flex flex-wrap items-start justify-between gap-4 border border-ns-accent bg-surface-sunken px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        {/* The badge sits on the first line of the paragraph, not on its
            optical middle: one pixel of correction against the cap height. */}
        <Badge variant="outline" className="mt-px border-ns-accent text-ns-accent">
          DEMO REPLAY
        </Badge>
        <p className="max-w-[860px] text-[13px] leading-[1.7] text-text-prose">
          Opened with ?demo=1. The vault read and the rows are real; the last {total} charges are
          held back and re-fired every {intervalSecs} seconds so the arrival can be watched on
          demand. {landed} of {total} landed this pass. The dial countdown is the replay timer, not
          a chain deadline.
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
