// Typed wrappers over starknet_call for the vault and gate read views.
//
// Every decode below was written against src/vault.cairo and src/gate.cairo,
// not against a doc. Where a return type is a Cairo tuple, the felts come back
// flat in declaration order:
//
//   vault schedule_of(commitment)
//     -> (creator_id: felt252, tier: u8, period_blocks: u64, start_block: u64,
//         n_periods: u32, escrow: u128, next_period: u32, cancelled: bool)
//     EIGHT felts. u128 escrow is ONE felt here (a u128 fits a felt252), unlike
//     a u256 return which would be two.
//   vault tier_of(creator_id, tier) -> (token: ContractAddress, amount: u128)
//   vault claimable_of(creator_id) -> u128            one felt
//   vault periods_due(commitment) -> u32              one felt
//   vault period_charged(commitment, period_index: u64) -> bool   0 or 1
//   vault claim_pub_nonce_of(creator_id) -> felt252
//   vault owner_key_of(commitment) -> felt252
//   vault accounted(token) -> u256                    TWO felts, low then high
//   gate  presentable(commitment) -> bool             0 or 1
//   gate  vault() -> ContractAddress
//
// A view that reverts (unknown commitment on a strict entry point, node
// hiccup) surfaces as a thrown RpcFailure. Callers that want a partial answer
// use readMany, which records the failures instead of losing the whole batch.

import { GATE, VAULT } from "../../config";
import { GATE_SELECTOR, VAULT_SELECTOR } from "../selectors";
import type { RpcClient } from "./client";
import { mapWithConcurrency } from "./blocktime";

export const VIEW_CONCURRENCY = 5;

/** Hex felt, as the node returns it. Never string-compare two of these. */
export type Felt = string;

export type Schedule = {
  creatorId: Felt;
  tier: number;
  periodBlocks: number;
  startBlock: number;
  nPeriods: number;
  escrowWei: bigint;
  nextPeriod: number;
  cancelled: boolean;
};

const u = (felt: Felt | undefined): bigint => BigInt(felt ?? "0x0");
const n = (felt: Felt | undefined): number => Number(u(felt));
const bool = (felt: Felt | undefined): boolean => u(felt) !== 0n;

async function callView(
  client: RpcClient,
  address: string,
  selector: string,
  calldata: Felt[],
): Promise<Felt[]> {
  return client.call<Felt[]>("starknet_call", [
    { contract_address: address, entry_point_selector: selector, calldata },
    "latest",
  ]);
}

/** The eight-felt schedule tuple. Returns null for an unknown commitment,
 *  which the vault reports as creator_id 0 rather than a revert. */
export async function scheduleOf(
  client: RpcClient,
  commitment: Felt,
  vault: string = VAULT,
): Promise<Schedule | null> {
  const r = await callView(client, vault, VAULT_SELECTOR.schedule_of, [commitment]);
  if (r.length < 8) throw new Error(`schedule_of: expected 8 felts, got ${r.length}`);
  const creatorId = r[0]!;
  if (u(creatorId) === 0n) return null;
  return {
    creatorId,
    tier: n(r[1]),
    periodBlocks: n(r[2]),
    startBlock: n(r[3]),
    nPeriods: n(r[4]),
    escrowWei: u(r[5]),
    nextPeriod: n(r[6]),
    cancelled: bool(r[7]),
  };
}

export type Tier = { token: Felt; amountWei: bigint };

export async function tierOf(
  client: RpcClient,
  creatorId: Felt,
  tier: number,
  vault: string = VAULT,
): Promise<Tier> {
  const r = await callView(client, vault, VAULT_SELECTOR.tier_of, [
    creatorId,
    `0x${tier.toString(16)}`,
  ]);
  return { token: r[0] ?? "0x0", amountWei: u(r[1]) };
}

export async function claimableOf(
  client: RpcClient,
  creatorId: Felt,
  vault: string = VAULT,
): Promise<bigint> {
  const r = await callView(client, vault, VAULT_SELECTOR.claimable_of, [creatorId]);
  return u(r[0]);
}

export async function periodsDue(
  client: RpcClient,
  commitment: Felt,
  vault: string = VAULT,
): Promise<number> {
  const r = await callView(client, vault, VAULT_SELECTOR.periods_due, [commitment]);
  return n(r[0]);
}

/** period_index is a u64 on this entry point even though the Charged event
 *  carries the same number as a u32. One felt either way. */
export async function periodCharged(
  client: RpcClient,
  commitment: Felt,
  periodIndex: number,
  vault: string = VAULT,
): Promise<boolean> {
  const r = await callView(client, vault, VAULT_SELECTOR.period_charged, [
    commitment,
    `0x${periodIndex.toString(16)}`,
  ]);
  return bool(r[0]);
}

export async function claimPubNonceOf(
  client: RpcClient,
  creatorId: Felt,
  vault: string = VAULT,
): Promise<bigint> {
  const r = await callView(client, vault, VAULT_SELECTOR.claim_pub_nonce_of, [creatorId]);
  return u(r[0]);
}

export async function ownerKeyOf(
  client: RpcClient,
  commitment: Felt,
  vault: string = VAULT,
): Promise<Felt> {
  const r = await callView(client, vault, VAULT_SELECTOR.owner_key_of, [commitment]);
  return r[0] ?? "0x0";
}

/** The gate's entitlement read. This is the rule, not vault.is_active: the raw
 *  liveness flag is false during the final fully-paid period, and false for
 *  every n_periods = 1 schedule the moment its one period is charged. */
export async function presentable(
  client: RpcClient,
  commitment: Felt,
  gate: string = GATE,
): Promise<boolean> {
  const r = await callView(client, gate, GATE_SELECTOR.presentable, [commitment]);
  return bool(r[0]);
}

/** The vault a gate reads, as set at deploy. An integrator pins this before
 *  trusting the gate's receipts; a class hash is not identity. */
export async function gateVault(
  client: RpcClient,
  gate: string = GATE,
): Promise<Felt> {
  const r = await callView(client, gate, GATE_SELECTOR.vault, []);
  return r[0] ?? "0x0";
}

export type ViewBatch<T> = {
  ok: Map<string, T>;
  /** Keys whose read threw, with the message. */
  failed: Array<{ key: string; error: string }>;
};

/** Fans a per-key view out with bounded concurrency and keeps the failures
 *  rather than rejecting the whole batch. */
export async function readMany<T>(
  keys: readonly string[],
  read: (key: string) => Promise<T>,
  concurrency: number = VIEW_CONCURRENCY,
): Promise<ViewBatch<T>> {
  const results = await mapWithConcurrency(keys, concurrency, async (key) => {
    try {
      return { key, value: await read(key), error: null as string | null };
    } catch (e) {
      return {
        key,
        value: null as T | null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
  const ok = new Map<string, T>();
  const failed: Array<{ key: string; error: string }> = [];
  for (const r of results) {
    if (r.error !== null) failed.push({ key: r.key, error: r.error });
    else ok.set(r.key, r.value as T);
  }
  return { ok, failed };
}
