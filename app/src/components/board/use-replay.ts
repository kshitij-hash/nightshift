// Demo replay, driven by ?demo=1.
//
// The arrival choreography is the one compound animation in the product and it
// only runs when a charge lands. On a schedule that has already been charged
// out, that can be days apart, which is no way to record or review it. So the
// replay holds back the last few REAL charges and re-fires them on a timer.
//
// Nothing is fabricated: the rows, blocks, amounts and receipts are the ones
// the vault read returned. The only invented quantity is when they appear on
// screen, and the page says so in the badge and in the banner.

import { useEffect, useState } from "react";

import type { Charge } from "../../lib/board";

/** Seconds between re-fires. Long enough that the 2 second sequence finishes
 *  and the board is visibly still again before the next one. */
export const REPLAY_INTERVAL_SECS = 8;

export type Replay = {
  charges: Charge[];
  /** How many of the held-back charges have landed in this pass. */
  landed: number;
  /** How many are held back per pass. */
  held: number;
  /** Seconds until the next re-fire. */
  secsToNext: number;
  /** 0..1 across the current step, for the dial. */
  progress: number;
};

export function useReplay(charges: Charge[], enabled: boolean): Replay | null {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setStep((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled || charges.length === 0) return null;

  const held = Math.min(charges.length > 2 ? 2 : 1, charges.length);
  const cycle = (held + 1) * REPLAY_INTERVAL_SECS;
  const t = step % cycle;
  const landed = Math.min(held, Math.floor(t / REPLAY_INTERVAL_SECS));
  const within = t % REPLAY_INTERVAL_SECS;

  return {
    charges: charges.slice(held - landed),
    landed,
    held,
    secsToNext: REPLAY_INTERVAL_SECS - within,
    progress: within / REPLAY_INTERVAL_SECS,
  };
}
