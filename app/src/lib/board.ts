// Board read path, lib style: transport (./rpc/client), pagination-safe
// event scanning (./rpc/events), felt decoding, and the committed-snapshot
// fallback all live here. src/query/useBoard.ts owns caching, the refetch
// interval, and stale-while-revalidate on top of this; it never retries
// around this file's own endpoint failover (Query's queryFn just calls
// readBoard() once per tick with retry: false).
//
// This supersedes site/src/rpc.ts's inline board reader: that file asks
// starknet_getEvents for chunk_size 500 and reads `events` once, silently
// dropping anything past the first page. This module scans through
// ./rpc/events.ts, which follows the continuation token and reports
// truncation in provenance instead of hiding it.

import {
  POOL,
  STRK,
  VAULT,
  VAULT_DEPLOY_BLOCK,
  VAULT_V2,
  VAULT_V2_DEPLOY_BLOCK,
  VAULT_V3,
  VAULT_V3_DEPLOY_BLOCK,
} from "../config";
import { EVENT, LEGACY_EVENT, VAULT_SELECTOR } from "./selectors";
import type { RpcClient } from "./rpc/client";
import { scanEvents } from "./rpc/events";
import type { RawEvent } from "./rpc/events";
import { getRpcClient } from "./rpc-instance";
import snapshotJson from "./snapshot.json";

export type Charge = {
  txHash: string;
  block: number;
  timestamp: number;
  periodIndex: number;
  commitment: string;
  /** Which vault emitted it: v2 "Released", v3 or v4 "Charged". */
  vault: "v2" | "v3" | "v4";
  /** Charged amount in wei. Only v3/v4 Charged carries it; v2 Released has
   *  no amount field, so it stays null rather than a fabricated value. */
  amountWei: bigint | null;
};

export type BoardProvenance = {
  source: "rpc" | "snapshot";
  /** The block the committed snapshot was taken at. Present only when
   *  source is "snapshot". */
  snapshotBlock?: number;
  /** True when any event scan hit its page cap: some list below is a prefix. */
  truncated: boolean;
  /** Labels for reads that failed or were capped, human-readable. */
  partial: string[];
};

export type BoardState = {
  provenance: BoardProvenance;
  headBlock: number;
  headTimestamp: number;
  escrowWei: bigint;
  activeSubscriptions: number;
  /** Subscriptions ever opened at this vault lineage: one per Subscribed
   *  event, across v2, v3 and v4, never decremented. Cumulative on purpose.
   *  activeSubscriptions above is the live count and goes to zero the moment
   *  every schedule is spent or cancelled; this one is the count of
   *  subscriptions the vault has actually taken. */
  subscriptionsCreated: number;
  charges: Charge[];
  subscribedEndBlocks: number[];
  /** n_periods of the live v3/v4 subscription: the honest denominator for
   *  the period ticker. null when no live subscription is known (e.g. the
   *  snapshot has no per-subscription detail). */
  livePeriods: number | null;
};

const u = (f: string | undefined): bigint => BigInt(f ?? "0x0");

async function callRaw(
  client: RpcClient,
  address: string,
  selector: string,
  calldata: string[],
): Promise<string[]> {
  return client.call<string[]>("starknet_call", [
    { contract_address: address, entry_point_selector: selector, calldata },
    "latest",
  ]);
}

async function readFromRpc(client: RpcClient): Promise<BoardState> {
  const partial: string[] = [];
  let truncated = false;
  const note = (label: string, why: string) => partial.push(`${label}: ${why}`);

  const headBlock = await client.call<number>("starknet_blockNumber", []);
  const head = await client.call<{ timestamp: number }>(
    "starknet_getBlockWithTxHashes",
    [{ block_number: headBlock }],
  );

  const accountedOf = (vault: string) =>
    callRaw(client, vault, VAULT_SELECTOR.accounted, [STRK]).catch((e) => {
      note("accounted", `${vault}: ${e instanceof Error ? e.message : String(e)}`);
      return ["0x0", "0x0"];
    });
  const [acctV4, acctV3, acctV2] = await Promise.all([
    accountedOf(VAULT),
    accountedOf(VAULT_V3),
    accountedOf(VAULT_V2),
  ]);
  const escrowWei = u(acctV4[0]) + u(acctV3[0]) + u(acctV2[0]);

  const eventsOf = async (vault: string, fromBlock: number, label: string) => {
    const scan = await scanEvents(client, {
      address: vault,
      from: { block_number: fromBlock },
      to: "latest",
    });
    if (scan.truncated) {
      truncated = true;
      note(label, `page cap hit after ${scan.pages} pages`);
    }
    return scan.events;
  };
  const [evV4, evV3, evV2] = await Promise.all([
    eventsOf(VAULT, VAULT_DEPLOY_BLOCK, "v4 events"),
    eventsOf(VAULT_V3, VAULT_V3_DEPLOY_BLOCK, "v3 events"),
    eventsOf(VAULT_V2, VAULT_V2_DEPLOY_BLOCK, "v2 events"),
  ]);

  const charges: Charge[] = [];
  const subscribedEndBlocks: number[] = [];
  /** Every commitment any generation emitted a Subscribed for, normalised to
   *  a decimal string so the same felt written two ways lands on one entry.
   *  A commitment re-registered on a newer vault is one subscription that
   *  moved, not two that were opened, and a credibility number is the last
   *  place to count it twice. */
  const subscribedCommitments = new Set<string>();
  const sawSubscribe = (felt: string | undefined) =>
    subscribedCommitments.add(BigInt(felt ?? "0x0").toString());
  const v3Subs: { commitment: string; nPeriods: number }[] = [];
  const v4Subs: { commitment: string; nPeriods: number }[] = [];
  const tsCache = new Map<number, number>();
  const blockTs = async (n: number) => {
    if (!tsCache.has(n)) {
      const b = await client.call<{ timestamp: number }>(
        "starknet_getBlockWithTxHashes",
        [{ block_number: n }],
      );
      tsCache.set(n, b.timestamp);
    }
    return tsCache.get(n)!;
  };

  // Charge events share a data prefix across versions: commitment, period.
  // Only v3/v4 Charged add amount; v2 Released stops at the period, so its
  // amount stays null rather than a fabricated constant.
  const pushCharge = async (e: RawEvent, vault: "v2" | "v3") =>
    charges.push({
      txHash: e.transaction_hash,
      block: e.block_number,
      timestamp: await blockTs(e.block_number),
      commitment: e.data[0] ?? "0x0",
      periodIndex: Number(u(e.data[1])),
      vault,
      amountWei: vault === "v3" ? u(e.data[2]) : null,
    });

  for (const e of evV2) {
    const key = (e.keys[0] ?? "0x0").toLowerCase();
    if (BigInt(key) === BigInt(LEGACY_EVENT.Released)) {
      await pushCharge(e, "v2");
    } else if (BigInt(key) === BigInt(EVENT.Subscribed)) {
      // v2 Subscribed carries the commitment in data[0] and the schedule's
      // end block in data[1].
      subscribedEndBlocks.push(Number(u(e.data[1])));
      sawSubscribe(e.data[0]);
    }
  }
  for (const e of evV3) {
    const key = (e.keys[0] ?? "0x0").toLowerCase();
    if (BigInt(key) === BigInt(EVENT.Charged)) {
      await pushCharge(e, "v3");
    } else if (BigInt(key) === BigInt(EVENT.Subscribed)) {
      // v3 Subscribed carries (commitment, creator_id, n_periods), no end
      // block. Liveness comes from the vault's own is_active view instead.
      v3Subs.push({ commitment: e.data[0] ?? "0x0", nPeriods: Number(u(e.data[2])) });
      sawSubscribe(e.data[0]);
    }
  }
  // v4 indexes its events: the commitment sits in keys[1], not data[0], and
  // the data array shifts left relative to v3. Decoding v4 with the v3
  // layout would render garbage, which is why this branch exists.
  for (const e of evV4) {
    const key = (e.keys[0] ?? "0x0").toLowerCase();
    if (BigInt(key) === BigInt(EVENT.Charged)) {
      charges.push({
        txHash: e.transaction_hash,
        block: e.block_number,
        timestamp: await blockTs(e.block_number),
        commitment: e.keys[1] ?? "0x0",
        periodIndex: Number(u(e.data[0])),
        vault: "v4",
        amountWei: u(e.data[1]),
      });
    } else if (BigInt(key) === BigInt(EVENT.Subscribed)) {
      v4Subs.push({ commitment: e.keys[1] ?? "0x0", nPeriods: Number(u(e.data[1])) });
      sawSubscribe(e.keys[1]);
    }
  }
  charges.sort((a, b) => b.block - a.block);

  const isActiveOn = (vault: string, commitment: string) =>
    callRaw(client, vault, VAULT_SELECTOR.is_active, [commitment])
      .then((r) => u(r[0]) === 1n)
      .catch((e) => {
        note("is_active", `${vault} ${commitment}: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      });
  const [v3Active, v4Active] = await Promise.all([
    Promise.all(v3Subs.map((s) => isActiveOn(VAULT_V3, s.commitment))),
    Promise.all(v4Subs.map((s) => isActiveOn(VAULT, s.commitment))),
  ]);

  const activeSubscriptions =
    subscribedEndBlocks.filter((end) => end > headBlock).length +
    v3Active.filter(Boolean).length +
    v4Active.filter(Boolean).length;

  // The period ticker tracks the live subscription, v4 first. Its n_periods
  // (from the Subscribed event) is the honest denominator; the contract
  // charges each period at most once, so the count can never exceed it.
  const v4Idx = v4Active.findIndex(Boolean);
  const v3Idx = v3Active.findIndex(Boolean);
  const livePeriods =
    v4Idx >= 0 ? v4Subs[v4Idx]!.nPeriods : v3Idx >= 0 ? v3Subs[v3Idx]!.nPeriods : null;

  return {
    provenance: { source: "rpc", truncated, partial },
    headBlock,
    headTimestamp: head.timestamp,
    escrowWei,
    activeSubscriptions,
    // A cancel or an exhausted schedule takes a subscription out of
    // activeSubscriptions and leaves this one where it is, because it
    // happened.
    subscriptionsCreated: subscribedCommitments.size,
    charges,
    subscribedEndBlocks,
    livePeriods,
  };
}

type SnapshotShape = {
  headBlock: number;
  headTimestamp: number;
  escrowWei: string;
  activeSubscriptions: number;
  charges: Array<{
    txHash: string;
    block: number;
    timestamp: number;
    periodIndex: number;
    commitment: string;
  }>;
  subscribedEndBlocks: number[];
};

function readFromSnapshot(): BoardState {
  const s = snapshotJson as SnapshotShape;
  return {
    provenance: {
      source: "snapshot",
      snapshotBlock: s.headBlock,
      truncated: false,
      partial: [],
    },
    headBlock: s.headBlock,
    headTimestamp: s.headTimestamp,
    escrowWei: BigInt(s.escrowWei),
    activeSubscriptions: s.activeSubscriptions,
    // The committed snapshot carries only the v2 Subscribed list, so this is
    // what it can honestly say. It is a floor, and it is labelled SNAPSHOT
    // everywhere it is shown.
    subscriptionsCreated: s.subscribedEndBlocks.length,
    // The committed snapshot predates the per-row amount/vault fields. Show
    // it as a v3 row with no decoded amount rather than a fabricated one.
    charges: s.charges.map((c) => ({ ...c, vault: "v3" as const, amountWei: null })),
    subscribedEndBlocks: s.subscribedEndBlocks,
    livePeriods: null,
  };
}

/**
 * Reads the board from live RPC; on total failure (every configured
 * endpoint exhausted), falls back to the committed snapshot. Never throws -
 * the fallback IS the error path, and its result carries
 * provenance.source: "snapshot" so a caller renders an honest badge instead
 * of an error boundary.
 */
export async function readBoard(client: RpcClient = getRpcClient()): Promise<BoardState> {
  try {
    return await readFromRpc(client);
  } catch {
    return readFromSnapshot();
  }
}

export { POOL };
