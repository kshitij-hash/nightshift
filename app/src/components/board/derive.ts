// Pure derivations behind the board. Everything here is arithmetic over the
// vault read and the schedule read; nothing is invented, and every function
// returns null rather than a guess when the inputs do not support an answer.

import { SECONDS_PER_BLOCK } from "../../config";
import type { BoardState, Charge } from "../../lib/board";
import type { Schedule } from "../../lib/schedule";

/** gray filled = charged inside its window · orange = charged late or missed ·
 *  outline = window open or still ahead. No third color, no green. */
export type TickState = "ok" | "late" | "open" | "future";

export type WindowInfo = {
  /** First block at which the next period may be charged. */
  block: number | null;
  /** Estimated wall clock for that block, seconds. Estimated, because block
   *  time is an average and the charge itself is block-gated, not clock-gated. */
  ts: number | null;
  /** One period in seconds, at the current block cadence. */
  periodSecs: number | null;
  /** Every period in the schedule has been charged. */
  complete: boolean;
  cancelled: boolean;
  /** The window opened already and the period is still uncharged. */
  overdue: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** hh:mm:ss from a second count, floored at zero. */
export function hms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Full UTC stamp, the form every timestamp on this page uses. */
export function utcStamp(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Clock time only, for the readout that ticks. */
export function utcTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The commitment the instrument tracks: the newest one the live vault
 *  charged. Older vault generations have no schedule_of to read. */
export function liveCommitment(charges: Charge[]): string | null {
  const v4 = charges.find((c) => c.vault === "v4");
  return v4 ? v4.commitment : null;
}

export function deriveWindow(
  schedule: Schedule | null | undefined,
  headBlock: number,
  headTs: number,
): WindowInfo {
  const empty: WindowInfo = {
    block: null,
    ts: null,
    periodSecs: null,
    complete: false,
    cancelled: false,
    overdue: false,
  };
  if (!schedule || schedule.periodBlocks <= 0) return empty;
  const periodSecs = schedule.periodBlocks * SECONDS_PER_BLOCK;
  const complete = schedule.nextPeriod >= schedule.nPeriods;
  if (complete || schedule.cancelled) {
    return { ...empty, periodSecs, complete, cancelled: schedule.cancelled };
  }
  const block = schedule.startBlock + schedule.nextPeriod * schedule.periodBlocks;
  return {
    block,
    ts: headTs + (block - headBlock) * SECONDS_PER_BLOCK,
    periodSecs,
    complete: false,
    cancelled: false,
    overdue: headBlock >= block,
  };
}

/** One square per period across the known schedule. Falls back to one square
 *  per charge when no schedule was read, so the bar never claims a denominator
 *  it does not have. */
export function deriveTicks(
  schedule: Schedule | null | undefined,
  charges: Charge[],
  headBlock: number,
): TickState[] {
  if (!schedule || schedule.nPeriods <= 0) {
    const commitment = liveCommitment(charges);
    const count = commitment
      ? charges.filter((c) => BigInt(c.commitment) === BigInt(commitment)).length
      : charges.length;
    return Array.from({ length: count }, () => "ok" as const);
  }
  const mine = charges.filter(
    (c) => BigInt(c.commitment) === BigInt(schedule.commitment),
  );
  return Array.from({ length: schedule.nPeriods }, (_, i): TickState => {
    const charge = mine.find((c) => c.periodIndex === i);
    const windowBlock = schedule.startBlock + i * schedule.periodBlocks;
    if (charge) {
      return charge.block < windowBlock + schedule.periodBlocks ? "ok" : "late";
    }
    if (i < schedule.nextPeriod) return "late";
    if (schedule.cancelled) return "future";
    return headBlock >= windowBlock ? "open" : "future";
  });
}

/** How far after its window opened a charge landed, in blocks. null when no
 *  schedule was read, because without one the window block is not known. */
export function chargeLagBlocks(
  schedule: Schedule | null | undefined,
  charge: Charge | null,
): number | null {
  if (!schedule || !charge || schedule.periodBlocks <= 0) return null;
  if (BigInt(charge.commitment) !== BigInt(schedule.commitment)) return null;
  const windowBlock = schedule.startBlock + charge.periodIndex * schedule.periodBlocks;
  return charge.block - windowBlock;
}

/** The per-period amount, taken from a charge that actually carried one. The
 *  v2 vault emitted no amount, so those rows stay out of this. */
export function perPeriodAmount(charges: Charge[], commitment: string | null): bigint | null {
  const match = charges.find(
    (c) =>
      c.amountWei !== null &&
      (commitment === null || BigInt(c.commitment) === BigInt(commitment)),
  );
  return match ? match.amountWei : null;
}

/** Charges of one commitment, newest first. */
export function chargesOf(charges: Charge[], commitment: string | null): Charge[] {
  if (commitment === null) return [];
  return charges.filter((c) => BigInt(c.commitment) === BigInt(commitment));
}

/** How many charges the board decoded per vault generation, for the caption
 *  that has to say where the count came from. */
export function vaultBreakdown(state: BoardState): string {
  const count = (v: Charge["vault"]) => state.charges.filter((c) => c.vault === v).length;
  return `v4 ${count("v4")}, v3 ${count("v3")}, v2 ${count("v2")}`;
}
