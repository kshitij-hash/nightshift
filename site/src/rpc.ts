// Plain JSON-RPC reads — no SDK, no keys. Falls back through RPC_URLS, then
// to the committed snapshot; the UI labels which source it is showing.

import {
  POOL,
  RPC_URLS,
  STRK,
  VAULT,
  VAULT_DEPLOY_BLOCK,
  VAULT_V2,
  VAULT_V2_DEPLOY_BLOCK,
  VAULT_V3,
  VAULT_V3_DEPLOY_BLOCK,
} from "./config";
import snapshotJson from "./snapshot.json";

// starknet_keccak("Released") etc. — precomputed selectors for event keys.
// v2 charge events are named Released; v3 renamed them Charged. Subscribed
// keeps its name across versions but NOT its data layout — decode per vault.
const SELECTOR_RELEASED =
  "0x0127adceb04d96dd7337eb363a9dd96b0fe957ce88be4b770ba4ef9fdc970f7f";
const SELECTOR_CHARGED =
  "0x0185ca81badbc5dd12754d07ca82c20ece8887f3e68ce333c631ac3e4faaaa6a";
const SELECTOR_SUBSCRIBED =
  "0x001757823b1d7233f8d4a0e3b3766c8a572e33e572b950f099f5338858558d78";
// accounted / is_active entry point selectors.
const SEL_ACCOUNTED =
  "0x019fcbfd1cca23ace0b1d37e31b7215f7c14f51f0aecda59ccbc8cbd93e4a98e";
const SEL_IS_ACTIVE =
  "0x028cd1b9b7a6254f5219ad13ceac17ed7e5c245c1b5f97c1a9c7f69d59cd819f";

export type Charge = {
  txHash: string;
  block: number;
  timestamp: number;
  periodIndex: number;
  commitment: string;
  /** Which vault emitted it: v2 "Released", v3 or v4 "Charged". */
  vault: "v2" | "v3" | "v4";
  /** Charged amount in wei. Only v3 Charged carries it (data[2]); v2
   *  Released has no amount field, so it stays null. */
  amountWei: bigint | null;
};

export type BoardState = {
  source: "rpc" | "snapshot";
  snapshotBlock?: number;
  headBlock: number;
  headTimestamp: number;
  escrowWei: bigint;
  activeSubscriptions: number;
  charges: Charge[];
  subscribedEndBlocks: number[];
  /** n_periods of the live v3 subscription: the honest denominator for the
   *  period ticker. null when no live v3 sub is known (e.g. snapshot mode). */
  livePeriods: number | null;
};

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: http ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result as T;
}

async function readFrom(url: string): Promise<BoardState> {
  const headBlock = await rpc<number>(url, "starknet_blockNumber", []);
  const head = await rpc<{ timestamp: number }>(
    url,
    "starknet_getBlockWithTxHashes",
    [{ block_number: headBlock }],
  );

  const accountedOf = (vault: string) =>
    rpc<string[]>(url, "starknet_call", [
      {
        contract_address: vault,
        entry_point_selector: SEL_ACCOUNTED,
        calldata: [STRK],
      },
      "latest",
    ]).catch(() => ["0x0", "0x0"]);
  const [acctV4, acctV3, acctV2] = await Promise.all([
    accountedOf(VAULT),
    accountedOf(VAULT_V3),
    accountedOf(VAULT_V2),
  ]);
  const escrowWei =
    BigInt(acctV4[0] ?? "0x0") + BigInt(acctV3[0] ?? "0x0") + BigInt(acctV2[0] ?? "0x0");

  type RawEvent = {
    keys: string[];
    data: string[];
    transaction_hash: string;
    block_number: number;
  };
  const eventsOf = (vault: string, fromBlock: number) =>
    rpc<{ events: RawEvent[] }>(url, "starknet_getEvents", [
      {
        from_block: { block_number: fromBlock },
        to_block: "latest",
        address: vault,
        chunk_size: 500,
      },
    ]);
  const [evV4, evV3, evV2] = await Promise.all([
    eventsOf(VAULT, VAULT_DEPLOY_BLOCK),
    eventsOf(VAULT_V3, VAULT_V3_DEPLOY_BLOCK),
    eventsOf(VAULT_V2, VAULT_V2_DEPLOY_BLOCK),
  ]);

  const charges: Charge[] = [];
  const subscribedEndBlocks: number[] = [];
  const v3Subs: { commitment: string; nPeriods: number }[] = [];
  const v4Subs: { commitment: string; nPeriods: number }[] = [];
  const tsCache = new Map<number, number>();
  const blockTs = async (n: number) => {
    if (!tsCache.has(n)) {
      const b = await rpc<{ timestamp: number }>(
        url,
        "starknet_getBlockWithTxHashes",
        [{ block_number: n }],
      );
      tsCache.set(n, b.timestamp);
    }
    return tsCache.get(n)!;
  };

  // Charge events share a data prefix across versions: commitment (data[0]),
  // period (data[1]). Only v3 Charged adds amount (data[2]) and caller (data[3]);
  // v2 Released stops at the period, so its amount stays null.
  const pushCharge = async (e: RawEvent, vault: "v2" | "v3") =>
    charges.push({
      txHash: e.transaction_hash,
      block: e.block_number,
      timestamp: await blockTs(e.block_number),
      commitment: e.data[0] ?? "0x0",
      periodIndex: Number(BigInt(e.data[1] ?? "0x0")),
      vault,
      amountWei: vault === "v3" ? BigInt(e.data[2] ?? "0x0") : null,
    });

  for (const e of evV2.events ?? []) {
    const key = e.keys[0]?.toLowerCase() ?? "";
    if (BigInt(key) === BigInt(SELECTOR_RELEASED)) {
      await pushCharge(e, "v2");
    } else if (BigInt(key) === BigInt(SELECTOR_SUBSCRIBED)) {
      // v2 Subscribed carries the schedule's end block in data[1].
      subscribedEndBlocks.push(Number(BigInt(e.data[1] ?? "0x0")));
    }
  }
  for (const e of evV3.events ?? []) {
    const key = e.keys[0]?.toLowerCase() ?? "";
    if (BigInt(key) === BigInt(SELECTOR_CHARGED)) {
      await pushCharge(e, "v3");
    } else if (BigInt(key) === BigInt(SELECTOR_SUBSCRIBED)) {
      // v3 Subscribed carries (commitment, creator_id, n_periods) — no end
      // block. Liveness comes from the vault's own is_active view instead.
      v3Subs.push({
        commitment: e.data[0] ?? "0x0",
        nPeriods: Number(BigInt(e.data[2] ?? "0x0")),
      });
    }
  }
  // v4 indexes its events: the commitment sits in keys[1], not data[0], and
  // the data array shifts left. Decoding v4 with the v3 layout would render
  // garbage, which is why this branch exists.
  for (const e of evV4.events ?? []) {
    const key = e.keys[0]?.toLowerCase() ?? "";
    if (BigInt(key) === BigInt(SELECTOR_CHARGED)) {
      charges.push({
        txHash: e.transaction_hash,
        block: e.block_number,
        timestamp: await blockTs(e.block_number),
        commitment: e.keys[1] ?? "0x0",
        periodIndex: Number(BigInt(e.data[0] ?? "0x0")),
        vault: "v4",
        amountWei: BigInt(e.data[1] ?? "0x0"),
      });
    } else if (BigInt(key) === BigInt(SELECTOR_SUBSCRIBED)) {
      v4Subs.push({
        commitment: e.keys[1] ?? "0x0",
        nPeriods: Number(BigInt(e.data[1] ?? "0x0")),
      });
    }
  }
  charges.sort((a, b) => b.block - a.block);

  const isActiveOn = (vault: string, commitment: string) =>
    rpc<string[]>(url, "starknet_call", [
      {
        contract_address: vault,
        entry_point_selector: SEL_IS_ACTIVE,
        calldata: [commitment],
      },
      "latest",
    ])
      .then((r) => BigInt(r[0] ?? "0x0") === 1n)
      .catch(() => false);
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
    v4Idx >= 0 ? v4Subs[v4Idx].nPeriods : v3Idx >= 0 ? v3Subs[v3Idx].nPeriods : null;

  return {
    source: "rpc",
    headBlock,
    headTimestamp: head.timestamp,
    escrowWei,
    activeSubscriptions,
    charges,
    subscribedEndBlocks,
    livePeriods,
  };
}

export async function readBoard(): Promise<BoardState> {
  for (const url of RPC_URLS) {
    try {
      return await readFrom(url);
    } catch {
      // try the next endpoint
    }
  }
  const s = snapshotJson as {
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
  return {
    source: "snapshot",
    snapshotBlock: s.headBlock,
    headBlock: s.headBlock,
    headTimestamp: s.headTimestamp,
    escrowWei: BigInt(s.escrowWei),
    activeSubscriptions: s.activeSubscriptions,
    // The committed snapshot predates the per-row amount/vault fields. Show it
    // as a v3 row with no decoded amount rather than a fabricated constant.
    charges: s.charges.map((c) => ({ ...c, vault: "v3" as const, amountWei: null })),
    subscribedEndBlocks: s.subscribedEndBlocks,
    livePeriods: null,
  };
}

export { POOL };
