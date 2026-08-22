// One extra vault read the board needs and the board event scan cannot give
// it: the subscription schedule.
//
// The heartbeat instrument counts down to the next charge window. That window
// is start_block + period_index * period_blocks, and neither number is in any
// event the vault emits. Guessing period_blocks from the gaps between charges
// is wrong on purpose-built data: a charge may land late, so the observed gaps
// here are 2193 and 1978 blocks for a schedule whose period is exactly 2100.
// So the instrument reads the schedule from the vault instead of inferring it,
// and when the read fails it says it has no window rather than drawing one.
//
// Layered the same way as src/lib/board.ts: this file owns transport and
// decoding, src/query/useSchedule.ts owns caching and the refetch interval.

import { VAULT } from "../config";
import { getRpcClient } from "./rpc-instance";
import type { RpcClient } from "./rpc/client";
import { VAULT_SELECTOR } from "./selectors";

/** schedule_of(commitment) -> (creator_id, tier, period_blocks, start_block,
 *  n_periods, escrow, next_period, cancelled), decoded. */
export type Schedule = {
  commitment: string;
  creatorId: string;
  tier: number;
  periodBlocks: number;
  startBlock: number;
  nPeriods: number;
  escrowWei: bigint;
  /** The next period index the vault will charge. Equals nPeriods when the
   *  whole schedule has been charged. */
  nextPeriod: number;
  cancelled: boolean;
};

const u = (f: string | undefined): bigint => BigInt(f ?? "0x0");

/**
 * Reads one subscription's schedule off the live v4 vault. Returns null when
 * the call fails or the commitment is unknown to the vault, so a caller can
 * drop the countdown instead of rendering an invented one. Never throws.
 */
export async function readSchedule(
  commitment: string,
  client: RpcClient = getRpcClient(),
): Promise<Schedule | null> {
  let out: string[];
  try {
    out = await client.call<string[]>("starknet_call", [
      {
        contract_address: VAULT,
        entry_point_selector: VAULT_SELECTOR.schedule_of,
        calldata: [commitment],
      },
      "latest",
    ]);
  } catch {
    return null;
  }
  if (out.length < 8) return null;
  // creator_id 0 is the vault's "no such subscription" answer.
  if (u(out[0]) === 0n) return null;
  return {
    commitment,
    creatorId: out[0] ?? "0x0",
    tier: Number(u(out[1])),
    periodBlocks: Number(u(out[2])),
    startBlock: Number(u(out[3])),
    nPeriods: Number(u(out[4])),
    escrowWei: u(out[5]),
    nextPeriod: Number(u(out[6])),
    cancelled: u(out[7]) === 1n,
  };
}
