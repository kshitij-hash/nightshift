// Everything the dashboard needs that is arithmetic rather than markup.
//
// The rule this file follows: nothing here invents a number. Each function
// either reads a field the ledger already decoded, or states in its own doc
// comment which fields it combined and how, so the caption a tile prints can
// be checked against the code that produced it.

import type {
  ChargeRecord,
  CommitmentRecord,
  CreatorLedger,
  Felt,
} from "../../lib/creator";
import { isEntitled, isFunded } from "../../lib/creator";
import { fmtStrk, utc } from "../../config";

/** Blocks per billing period on the vault's three-rung ladder. */
const PERIOD_HOUR = 2100;
const PERIOD_DAY = 50400;
const PERIOD_WEEK = 352800;

/** Two felts name the same thing when their numeric values match, never when
 *  their strings do: 0x396c and 0x0396c are one address. */
export const sameFelt = (a: Felt, b: Felt) => BigInt(a) === BigInt(b);

export const strk = (wei: bigint) => Number(fmtStrk(wei));

/** `08-22 04:14:37 UTC`, the only timestamp format on this surface. */
export function stampUtc(ts: number | undefined): string {
  if (ts === undefined) return "unknown";
  const t = utc(ts);
  return `${t.date} ${t.time} UTC`;
}

/** `08-22 04:14`, for an axis tick where seconds do not fit. */
export function shortUtc(ts: number | undefined): string {
  if (ts === undefined) return "";
  const t = utc(ts);
  return `${t.date} ${t.time.slice(0, 5)}`;
}

/** The word for a period length. The vault refuses anything off its three-rung
 *  ladder at subscribe, so "off ladder" means a decode problem, not a plan. */
export function cadenceWord(periodBlocks: number | null): string {
  if (periodBlocks === null) return "unknown";
  if (periodBlocks === PERIOD_HOUR) return "hourly";
  if (periodBlocks === PERIOD_DAY) return "daily";
  if (periodBlocks === PERIOD_WEEK) return "weekly";
  return "off ladder";
}

export function cadenceLabel(periodBlocks: number | null): string {
  if (periodBlocks === null) return "unknown";
  return `${cadenceWord(periodBlocks)} · ${periodBlocks} blocks`;
}

/** The lifecycle tags a commitment can carry at once. A commitment that is
 *  funded and inside a paid window is both ACTIVE and ENTITLED, and hiding
 *  one of them behind the other would make the table say less than the chain. */
export type SubState = "ACTIVE" | "ENTITLED" | "ARREARS" | "CANCELLED" | "EXHAUSTED";

/** ACTIVE and ARREARS are the two that want a reader's attention, so they are
 *  the two that get the accent. The rest are settled history, in gray. */
export const STATE_IS_LIVE: Record<SubState, boolean> = {
  ACTIVE: true,
  ARREARS: true,
  ENTITLED: false,
  CANCELLED: false,
  EXHAUSTED: false,
};

export type SubscriptionRow = {
  commitment: Felt;
  creatorId: Felt;
  subscribeTx: string;
  subscribedAt: number | undefined;
  tier: number | null;
  /** "hourly · 2100 blocks", for the card layout. */
  cadence: string;
  /** "hourly · 2100", for the table, where the header carries the unit. */
  cadenceShort: string;
  chargedPeriods: number;
  nPeriods: number;
  /** tier price times n_periods: what the schedule commits to, not a deposit
   *  this page watched land. */
  contractedWei: bigint | null;
  escrowLeftWei: bigint | null;
  firstCharge: ChargeRecord | null;
  lastCharge: ChargeRecord | null;
  states: SubState[];
};

function statesOf(c: CommitmentRecord, headBlock: number): SubState[] {
  const s = c.schedule;
  const out: SubState[] = [];
  if (!s) return out;
  if (s.cancelled) out.push("CANCELLED");
  else if (!isFunded(c)) out.push("EXHAUSTED");
  else out.push("ACTIVE");
  if (isEntitled(c, headBlock)) out.push("ENTITLED");
  if (typeof c.periodsDue === "number" && c.periodsDue > 0) out.push("ARREARS");
  return out;
}

export function subscriptionRows(ledger: CreatorLedger): SubscriptionRow[] {
  const byCommitment = new Map<string, ChargeRecord[]>();
  for (const ch of ledger.charges) {
    const key = BigInt(ch.commitment).toString();
    const list = byCommitment.get(key);
    if (list) list.push(ch);
    else byCommitment.set(key, [ch]);
  }

  return ledger.commitments
    .map((c): SubscriptionRow => {
      const charges = (byCommitment.get(BigInt(c.commitment).toString()) ?? [])
        .slice()
        .sort((a, b) => a.block - b.block);
      const s = c.schedule;
      const nPeriods = s ? s.nPeriods : c.nPeriodsAtSubscribe;
      return {
        commitment: c.commitment,
        creatorId: c.creatorId,
        subscribeTx: c.txHash,
        subscribedAt: c.time?.ts,
        tier: s ? s.tier : null,
        cadence: cadenceLabel(s ? s.periodBlocks : null),
        cadenceShort: s ? `${cadenceWord(s.periodBlocks)} · ${s.periodBlocks}` : "unknown",
        chargedPeriods: charges.length,
        nPeriods,
        contractedWei: c.tierPriceWei === null ? null : c.tierPriceWei * BigInt(nPeriods),
        escrowLeftWei: s ? s.escrowWei : null,
        firstCharge: charges[0] ?? null,
        lastCharge: charges.length > 0 ? charges[charges.length - 1]! : null,
        states: statesOf(c, ledger.headBlock),
      };
    })
    .sort((a, b) => (b.subscribedAt ?? 0) - (a.subscribedAt ?? 0));
}

// --- revenue timeline ------------------------------------------------------

export type RevenuePoint = {
  txHash: string;
  block: number;
  ts: number | undefined;
  label: string;
  commitment: Felt;
  periodIndex: number;
  /** This charge, in STRK. */
  amount: number;
  /** Every charge up to and including this one, in STRK. */
  cumulative: number;
  /** Pre-formatted, so the direct labels on the chart need no formatter. */
  amountLabel: string;
  cumulativeLabel: string;
};

/** One point per Charged event, oldest first, with the running total carried
 *  alongside. The bars are the individual charges; the line is their sum.
 *  The category label is forced unique: two charges in the same minute would
 *  otherwise collapse into one column on a category axis. */
export function revenueSeries(ledger: CreatorLedger): RevenuePoint[] {
  const ordered = ledger.charges.slice().sort((a, b) => a.block - b.block);
  const used = new Set<string>();
  let running = 0n;
  return ordered.map((ch) => {
    running += ch.amountWei;
    let label = shortUtc(ch.time?.ts) || `block ${ch.block}`;
    if (used.has(label)) label = `${label} · ${ch.block}`;
    used.add(label);
    return {
      txHash: ch.txHash,
      block: ch.block,
      ts: ch.time?.ts,
      label,
      commitment: ch.commitment,
      periodIndex: ch.periodIndex,
      amount: strk(ch.amountWei),
      cumulative: strk(running),
      amountLabel: fmtStrk(ch.amountWei),
      cumulativeLabel: fmtStrk(running),
    };
  });
}

/**
 * How many further charges the escrow already in the vault can pay for, across
 * the subscriptions the vault would still charge. This is the bound on the run
 * rate: money already committed, not money forecast.
 */
export function fundedPeriodsCovered(ledger: CreatorLedger): number {
  let periods = 0;
  for (const c of ledger.commitments) {
    if (!isFunded(c) || !c.schedule || c.tierPriceWei === null || c.tierPriceWei === 0n) continue;
    const affordable = Number(c.schedule.escrowWei / c.tierPriceWei);
    const remaining = c.schedule.nPeriods - c.schedule.nextPeriod;
    periods += Math.min(affordable, remaining);
  }
  return periods;
}

// --- multiple creator ids --------------------------------------------------

export type IdSummary = {
  id: Felt;
  commitments: number;
  charges: number;
  grossWei: bigint;
  /** False when this id matched nothing at all in the scanned range. */
  seen: boolean;
};

/**
 * Per-id figures, split back out of a ledger that was assembled over all of
 * them at once. The split is local arithmetic over data already fetched: no
 * extra read, and nothing about the grouping leaves this browser.
 */
export function perIdSummaries(ledger: CreatorLedger, ids: Felt[]): IdSummary[] {
  const creatorOfCommitment = new Map<string, Felt>();
  for (const c of ledger.commitments) {
    creatorOfCommitment.set(BigInt(c.commitment).toString(), c.creatorId);
  }
  return ids.map((id) => {
    const commitments = ledger.commitments.filter((c) => sameFelt(c.creatorId, id));
    const charges = ledger.charges.filter((ch) => {
      const owner = creatorOfCommitment.get(BigInt(ch.commitment).toString());
      return owner !== undefined && sameFelt(owner, id);
    });
    const grossWei = charges.reduce((a, ch) => a + ch.amountWei, 0n);
    const claims = ledger.claims.filter((c) => sameFelt(c.creatorId, id)).length;
    const presentations = ledger.presentations.filter((p) => sameFelt(p.creatorId, id)).length;
    return {
      id,
      commitments: commitments.length,
      charges: charges.length,
      grossWei,
      seen: commitments.length > 0 || charges.length > 0 || claims > 0 || presentations > 0,
    };
  });
}

// --- what kind of answer is this -------------------------------------------

/** No event anywhere in the scanned range mentions any of these ids. The
 *  dashboard renders this as a written answer, never as tiles full of zeros:
 *  a zero is a measurement, and there was nothing to measure. */
export function ledgerIsEmpty(ledger: CreatorLedger): boolean {
  return (
    ledger.commitments.length === 0 &&
    ledger.charges.length === 0 &&
    ledger.claims.length === 0 &&
    ledger.claimsPublic.length === 0 &&
    ledger.cancels.length === 0 &&
    ledger.reclaims.length === 0 &&
    ledger.presentations.length === 0
  );
}

/** True when a scan stopped at its page cap, which makes every count and sum
 *  on the page a floor rather than a total. A failed single read is a
 *  different thing and shows up in provenance.partial instead. */
export const isFloor = (ledger: CreatorLedger) => ledger.provenance.truncated;
