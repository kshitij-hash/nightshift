// Plain JSON-RPC reads — no SDK, no keys. Falls back through RPC_URLS, then
// to the committed snapshot; the UI labels which source it is showing.

import {
  POOL,
  RPC_URLS,
  STRK,
  VAULT,
  VAULT_DEPLOY_BLOCK,
} from "./config";
import snapshotJson from "./snapshot.json";

// starknet_keccak("Released") etc. — precomputed selectors for event keys.
const SELECTOR_RELEASED =
  "0x0127adceb04d96dd7337eb363a9dd96b0fe957ce88be4b770ba4ef9fdc970f7f";
const SELECTOR_SUBSCRIBED =
  "0x001757823b1d7233f8d4a0e3b3766c8a572e33e572b950f099f5338858558d78";
// balanceOf / accounted / is_active entry point selectors.
const SEL_ACCOUNTED =
  "0x019fcbfd1cca23ace0b1d37e31b7215f7c14f51f0aecda59ccbc8cbd93e4a98e";

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

  const accounted = await rpc<string[]>(url, "starknet_call", [
    {
      contract_address: VAULT,
      entry_point_selector: SEL_ACCOUNTED,
      calldata: [STRK],
    },
    "latest",
  ]).catch(() => ["0x0", "0x0"]);
  const escrowWei = BigInt(accounted[0] ?? "0x0");

  const events = await rpc<{
    events: {
      keys: string[];
      data: string[];
      transaction_hash: string;
      block_number: number;
    }[];
  }>(url, "starknet_getEvents", [
    {
      from_block: { block_number: VAULT_DEPLOY_BLOCK },
      to_block: "latest",
      address: VAULT,
      chunk_size: 500,
    },
  ]);

  const charges: Charge[] = [];
  const subscribedEndBlocks: number[] = [];
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

  for (const e of events.events ?? []) {
    const key = e.keys[0]?.toLowerCase() ?? "";
    if (BigInt(key) === BigInt(SELECTOR_RELEASED)) {
      charges.push({
        txHash: e.transaction_hash,
        block: e.block_number,
        timestamp: await blockTs(e.block_number),
        commitment: e.data[0] ?? "0x0",
        periodIndex: Number(BigInt(e.data[1] ?? "0x0")),
      });
    } else if (BigInt(key) === BigInt(SELECTOR_SUBSCRIBED)) {
      subscribedEndBlocks.push(Number(BigInt(e.data[1] ?? "0x0")));
    }
  }
  charges.sort((a, b) => b.block - a.block);

  const activeSubscriptions = subscribedEndBlocks.filter(
    (end) => end > headBlock,
  ).length;

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
