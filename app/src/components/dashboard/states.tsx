// Provenance, and the three answers that are not the happy path.
//
// The provenance strip is a designed element of this page, not fine print.
// It is the first thing under the masthead because it is the first thing a
// reader needs: where these numbers came from, and what it cost to get them.
// The answer is that they came from public mainnet events and cost nothing,
// because no key was used and none is needed.
//
// The other three states get the same weight as the happy path. An unknown
// creator is written out, never rendered as tiles full of zeros, because a
// zero is a measurement and there was nothing to measure. A capped scan says
// its numbers are a floor. A rejected id says which id and why.

import { fmtBlock, truncate, VAULT, VOYAGER_CONTRACT } from "../../config";
import type { CreatorLedger, Felt } from "../../lib/creator";
import { Badge } from "../ui/badge";
import { HashCopy, StatusDot } from "../board/primitives";

const EVENTS_LINK = `${VOYAGER_CONTRACT(VAULT)}#events`;

/** The masthead chip: which chain, and how far the scan got. */
export function ChainChip({ headBlock, live }: { headBlock: number | null; live: boolean }) {
  return (
    // The "MAINNET ·" qualifier hides below md so the chip fits the phone
    // chrome's one row; it stays in the DOM for a screen reader.
    <span className="inline-flex items-center gap-2 border border-border-panel px-2 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label md:px-2.5">
      <StatusDot state={live ? "live" : "pending"} size={6} beat={live} />
      <span className="hidden md:inline">MAINNET&nbsp;·&nbsp;</span>
      <span className="sr-only md:hidden">MAINNET · </span>
      {headBlock === null ? "NO READ YET" : `BLOCK ${fmtBlock(headBlock)}`}
    </span>
  );
}

export function ProvenanceBanner({
  ledger,
  live,
}: {
  ledger: CreatorLedger;
  /** The 120 second poll is running, so the vault is being watched right now. */
  live: boolean;
}) {
  const capped = ledger.provenance.truncated;
  return (
    <div className="flex flex-col gap-3 border border-border-panel bg-surface-sunken px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <StatusDot state={live ? "live" : "pending"} size={8} beat={live} />
        <p className="text-[13px] leading-[1.6] text-text-prose">
          Computed from public mainnet events. Anyone can derive this, and no key was used.
        </p>
      </div>
      <p className="text-[11px] leading-[1.5] text-text-caption">
        source: Subscribed, Charged, Claimed, Cancelled, Reclaimed and Presented events at vault{" "}
        <HashCopy value={VAULT} display={truncate(VAULT)} className="text-[11px]" /> ·{" "}
        {capped ? "scan stopped at its page cap" : "scan complete"} to block{" "}
        {fmtBlock(ledger.headBlock)}
      </p>
    </div>
  );
}

/** A scan hit its page cap, or a single read failed. Either way the page
 *  says what it read before it says what it found. */
export function PartialScanBanner({ ledger }: { ledger: CreatorLedger }) {
  const capped = ledger.provenance.truncated;
  const notes = ledger.provenance.partial;
  if (!capped && notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border border-ns-accent bg-surface-sunken px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-ns-accent text-ns-accent">
          {capped ? "PARTIAL SCAN" : "INCOMPLETE READ"}
        </Badge>
        <span className="text-[11px] leading-[1.5] tracking-[0.14em] text-text-label uppercase">
          {notes.length} read{notes.length === 1 ? "" : "s"} came back short of block{" "}
          {fmtBlock(ledger.headBlock)}
        </span>
      </div>
      <p className="max-w-[860px] text-[13px] leading-[1.7] text-text-prose">
        {capped
          ? "The node returned its page limit before the scan reached the head block. Every count and every sum below is a floor rather than a total, and each tile is marked with a floor sign until a full scan lands. Re-reading a range cannot double count an event, so a refresh is safe."
          : "At least one read came back empty or failed outright. The figures below are computed over what did arrive, and each tile carries the failure in its caveat."}
      </p>
      <ul className="flex flex-col gap-1">
        {notes.map((n) => (
          <li key={n} className="text-[11px] leading-[1.45] text-text-caption">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Valid hex, scanned cleanly, matched nothing. */
export function UnknownCreator({
  ids,
  ledger,
}: {
  ids: Felt[];
  ledger: CreatorLedger;
}) {
  const incomplete = ledger.provenance.truncated || ledger.provenance.partial.length > 0;
  return (
    <div className="flex flex-col gap-5 border border-border-panel bg-surface-panel px-6 py-7">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">NO EVENTS AT THIS VAULT</Badge>
        <span className="text-[11px] tracking-[0.14em] text-text-label uppercase">
          scan reached block {fmtBlock(ledger.headBlock)} and matched 0 events
        </span>
      </div>
      <p className="max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
        {ids.length === 1 ? "That id has" : "Those ids have"} no Subscribed, Charged or Claimed
        event at this vault, so there is nothing to derive. Either the id is wrong, or this creator
        has not been registered here yet. Nothing was stored, and the page will look the same if you
        reload it.
      </p>
      <ul className="flex flex-col gap-1">
        {ids.map((id) => (
          <li key={id} className="text-[12px] text-text-caption">
            <HashCopy value={id} display={truncate(id)} className="text-[12px]" /> · no events
          </li>
        ))}
      </ul>
      {incomplete ? (
        <p className="max-w-[70ch] text-[12px] leading-[1.6] text-text-caption">
          One caution: this scan did not finish, so an empty result is not proof of absence here.
          Reload once the read completes before concluding anything from it.
        </p>
      ) : (
        <p className="max-w-[70ch] text-[12px] leading-[1.6] text-text-caption">
          The empty result is a fact about the chain, not a failure of this page. The same scan is
          reproducible from the event log.
        </p>
      )}
      <a href={EVENTS_LINK} target="_blank" rel="noreferrer" className="w-fit text-[12px]">
        verify on voyager ↗
      </a>
    </div>
  );
}

/** ?creator= carried something that is not a felt. Say which, and why. */
export function RejectedIds({ raw }: { raw: string }) {
  const parts = raw.split(",").filter((p) => p.length > 0);
  return (
    <div className="flex flex-col gap-2 border border-ns-accent bg-surface-sunken px-5 py-4">
      <Badge variant="outline" className="border-ns-accent text-ns-accent">
        ID REJECTED
      </Badge>
      <p className="max-w-[70ch] text-[13px] leading-[1.7] text-text-prose">
        {parts.length === 1 ? "This id was" : "These ids were"} not read, because a creator id is a
        felt252: 0x followed by 1 to 64 hex digits, and nothing else. Fix the id and paste it again.
      </p>
      <ul className="flex flex-col gap-1">
        {parts.map((p) => (
          <li key={p} className="font-mono text-[12px] break-all text-text-caption">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
