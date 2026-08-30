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
          Computed from public mainnet events. Anyone can derive this.
        </p>
      </div>
      <p className="text-[11px] leading-[1.5] text-text-caption">
        source: the public event log of vault{" "}
        <HashCopy value={VAULT} display={truncate(VAULT)} className="text-[11px]" /> ·{" "}
        {capped ? "scan stopped short" : "scan complete"} to block {fmtBlock(ledger.headBlock)}
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
          ? "The scan stopped before reaching the newest block, so every figure below is a floor rather than a total. Refreshing is safe and picks up where it left off."
          : "At least one read failed, so the figures below are computed over what did arrive. Each affected tile says so."}
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
        {ids.length === 1 ? "That id has" : "Those ids have"} no activity at this vault, so there
        is nothing to show. Either the id is wrong, or this creator has not been registered here
        yet.
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
          Nothing was found on chain for this id. Anyone running the same scan would see the same.
        </p>
      )}
      <a href={EVENTS_LINK} target="_blank" rel="noreferrer" className="w-fit text-[12px]">
        verify on voyager ↗
      </a>
    </div>
  );
}

/** Registered on chain, zero subscribers so far. The state every creator is
 *  in for the gap between registering and their first subscriber, and the one
 *  moment this page must not read like an error: the id is real, the ladder
 *  is live, and the only thing missing is the link being shared. */
export function FreshCreator({
  entries,
}: {
  entries: Array<{ id: Felt; tiers: Array<{ index: number; amountWei: bigint }> }>;
}) {
  const strk = (wei: bigint) => {
    const whole = wei / 10n ** 18n;
    const frac = (wei % 10n ** 18n) / 10n ** 16n;
    return `${whole}.${frac.toString().padStart(2, "0")}`;
  };
  return (
    <div className="flex flex-col gap-5 border border-border-panel bg-surface-panel px-6 py-7">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="verified">REGISTERED · NO SUBSCRIBERS YET</Badge>
        <span className="text-[11px] tracking-[0.14em] text-text-label uppercase">
          the ladder is live on chain
        </span>
      </div>
      <p className="max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
        {entries.length === 1 ? "This id is" : "These ids are"} registered at
        the vault with the prices below. Nothing has been subscribed against
        {entries.length === 1 ? " it" : " them"} yet, so there are no figures
        to derive - the moment a subscription lands, this page becomes the
        ledger. Until then, the whole job is sharing the link.
      </p>
      <div className="flex flex-col gap-4">
        {entries.map((e) => (
          <div key={e.id} className="flex flex-col gap-2 border-t border-border-row pt-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[12px] text-text-label">creator</span>
              <HashCopy value={e.id} display={truncate(e.id)} className="text-[12px]" />
              <span className="text-[12px] text-text-caption">
                {e.tiers.map((t) => `tier ${t.index} · ${strk(t.amountWei)} STRK`).join("  ·  ")}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[12px] text-text-label">share link</span>
              <HashCopy
                value={`${window.location.origin}/subscribe?creator=${e.id}`}
                display={`${window.location.host}/subscribe?creator=${truncate(e.id)}`}
                className="text-[12px]"
              />
            </div>
          </div>
        ))}
      </div>
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
        {parts.length === 1 ? "This id was" : "These ids were"} not read: a creator id is 0x
        followed by up to 64 hex characters. Fix the id and paste it again.
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
