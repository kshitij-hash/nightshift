// The chain seam for the verify surface: the app's RpcClient dressed as the
// ChainReader src/lib/verify.ts asks for.
//
// The verification logic is deliberately provider-free so it can be loaded by
// node with no bundler (that is what the parity test does). This file is the
// only place the page and the chain meet, and it reads through the same
// rpc/views.ts wrappers every other surface uses, so the vault decode has one
// owner and one set of eyes on it.

import { VAULT } from "../../config";
import { getRpcClient } from "../../lib/rpc-instance";
import { ownerKeyOf, scheduleOf } from "../../lib/rpc/views";
import type { ChainReader } from "../../lib/verify";

/** How many blocks ahead of the head a locally generated challenge expires. */
export const CHALLENGE_WINDOW = 1000;

/**
 * One reader over the live vault.
 *
 * schedule_of comes back through views.ts, which returns null for the
 * creator_id 0 an unknown commitment reads, so it is re-flattened to the eight
 * felts the check expects. One documented difference from the reference
 * package: views.ts collapses an empty owner_key_of response to 0x0, so a node
 * that answers that call with nothing reads as unknown_commitment here where
 * the package would say rpc_error. Both refuse; a live node returns one felt.
 */
export function createVaultReader(vault: string = VAULT): ChainReader {
  const client = getRpcClient();
  return {
    async getBlockNumber(): Promise<number> {
      return await client.call<number>("starknet_blockNumber", []);
    },
    async callVault(entrypoint, calldata): Promise<bigint[]> {
      const commitment = calldata[0] ?? "0x0";
      if (entrypoint === "owner_key_of") {
        return [BigInt(await ownerKeyOf(client, commitment, vault))];
      }
      const s = await scheduleOf(client, commitment, vault);
      if (s === null) return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
      return [
        BigInt(s.creatorId),
        BigInt(s.tier),
        BigInt(s.periodBlocks),
        BigInt(s.startBlock),
        BigInt(s.nPeriods),
        s.escrowWei,
        BigInt(s.nextPeriod),
        s.cancelled ? 1n : 0n,
      ];
    },
  };
}
