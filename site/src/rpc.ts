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
  const [acctV3, acctV2] = await Promise.all([
    accountedOf(VAULT),
    accountedOf(VAULT_V2),
  ]);
  const escrowWei =
    BigInt(acctV3[0] ?? "0x0") + BigInt(acctV2[0] ?? "0x0");

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
  const [evV3, evV2] = await Promise.all([
    eventsOf(VAULT, VAULT_DEPLOY_BLOCK),
    eventsOf(VAULT_V2, VAULT_V2_DEPLOY_BLOCK),
  ]);

  const charges: Charge[] = [];
  const subscribedEndBlocks: number[] = [];
  const v3Commitments: string[] = [];
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

  // Charge events share a data prefix across versions: commitment, period.
  const pushCharge = async (e: RawEvent) =>
    charges.push({
      txHash: e.transaction_hash,
      block: e.block_number,
      timestamp: await blockTs(e.block_number),
      commitment: e.data[0] ?? "0x0",
      periodIndex: Number(BigInt(e.data[1] ?? "0x0")),
    });

  for (const e of evV2.events ?? []) {
    const key = e.keys[0]?.toLowerCase() ?? "";
    if (BigInt(key) === BigInt(SELECTOR_RELEASED)) {
      await pushCharge(e);
    } else if (BigInt(key) === BigInt(SELECTOR_SUBSCRIBED)) {
      // v2 Subscribed carries the schedule's end block in data[1].
      subscribedEndBlocks.push(Number(BigInt(e.data[1] ?? "0x0")));
    }
  }
  for (const e of evV3.events ?? []) {
    const key = e.keys[0]?.toLowerCase() ?? "";
    if (BigInt(key) === BigInt(SELECTOR_CHARGED)) {
      await pushCharge(e);
    } else if (BigInt(key) === BigInt(SELECTOR_SUBSCRIBED)) {
      // v3 Subscribed carries (commitment, creator_id, n_periods) — no end
      // block. Liveness comes from the vault's own is_active view instead.
      v3Commitments.push(e.data[0] ?? "0x0");
    }
  }
  charges.sort((a, b) => b.block - a.block);

  const v3Active = await Promise.all(
    v3Commitments.map((c) =>
      rpc<string[]>(url, "starknet_call", [
        {
          contract_address: VAULT,
          entry_point_selector: SEL_IS_ACTIVE,
          calldata: [c],
        },
        "latest",
      ])
        .then((r) => BigInt(r[0] ?? "0x0") === 1n)
        .catch(() => false),
    ),
  );

  const activeSubscriptions =
    subscribedEndBlocks.filter((end) => end > headBlock).length +
    v3Active.filter(Boolean).length;

  return {
    source: "rpc",
    headBlock,
    headTimestamp: head.timestamp,
    escrowWei,
    activeSubscriptions,
    charges,
    subscribedEndBlocks,
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
    charges: Charge[];
    subscribedEndBlocks: number[];
  };
  return {
    source: "snapshot",
    snapshotBlock: s.headBlock,
    headBlock: s.headBlock,
    headTimestamp: s.headTimestamp,
    escrowWei: BigInt(s.escrowWei),
    activeSubscriptions: s.activeSubscriptions,
    charges: s.charges,
    subscribedEndBlocks: s.subscribedEndBlocks,
  };
}

export { POOL };
