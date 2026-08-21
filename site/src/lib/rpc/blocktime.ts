// Block number to wall-clock timestamp, with a stated confidence bit.
//
// Every event the vault emits carries a block number and no timestamp. Turning
// 200 event blocks into 200 starknet_getBlockWithTxHashes calls is how a board
// gets rate-limited off a public endpoint. So:
//
//   - a Map cache, shared for the life of the resolver
//   - bounded concurrency (5 in flight) over the blocks it does fetch
//   - a fetch budget; blocks past the budget, and blocks whose fetch failed,
//     are LINEARLY INTERPOLATED from two anchor blocks that were fetched
//   - every entry says which it is: { ts, estimated }
//
// The estimated flag is the point. An interpolated timestamp on a ~1.7s chain
// drifts with real block cadence, and a UI that prints an estimate as if it
// were read from the chain is lying at the second granularity. Callers should
// render estimates differently, or not at all.

import { SECONDS_PER_BLOCK } from "../../config";
import type { RpcClient } from "./client";

export type BlockTime = {
  /** Unix seconds. */
  ts: number;
  /** True when this came from interpolation, not from a block read. */
  estimated: boolean;
};

export type BlockTimeOptions = {
  /** Max blocks fetched in one resolve() call. Defaults to 40. */
  fetchBudget?: number;
  /** Simultaneous in-flight block reads. Defaults to 5. */
  concurrency?: number;
};

export const DEFAULT_FETCH_BUDGET = 40;
export const DEFAULT_CONCURRENCY = 5;

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export class BlockTimeResolver {
  private readonly cache = new Map<number, BlockTime>();
  private readonly client: RpcClient;
  private readonly fetchBudget: number;
  private readonly concurrency: number;

  constructor(client: RpcClient, opts: BlockTimeOptions = {}) {
    this.client = client;
    this.fetchBudget = opts.fetchBudget ?? DEFAULT_FETCH_BUDGET;
    this.concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  }

  /** Every timestamp read from a block so far, for anchor picking and reuse. */
  known(): ReadonlyMap<number, BlockTime> {
    return this.cache;
  }

  private async fetchOne(block: number): Promise<number | null> {
    try {
      const b = await this.client.call<{ timestamp: number }>(
        "starknet_getBlockWithTxHashes",
        [{ block_number: block }],
      );
      return typeof b?.timestamp === "number" ? b.timestamp : null;
    } catch {
      return null;
    }
  }

  async resolve(blocks: Iterable<number>): Promise<Map<number, BlockTime>> {
    const wanted = [...new Set(blocks)].sort((a, b) => a - b);
    const missing = wanted.filter((b) => !this.cache.has(b));

    // Anchors first: the lowest and highest blocks wanted. Two real reads at
    // the ends make the interpolation between them a measurement of this
    // window's actual cadence rather than a guess at the chain's.
    const anchors =
      missing.length > 1 ? [missing[0]!, missing[missing.length - 1]!] : missing.slice(0, 1);
    const rest = missing.filter((b) => !anchors.includes(b));
    const budgeted = rest.slice(0, Math.max(0, this.fetchBudget - anchors.length));
    const toFetch = [...anchors, ...budgeted];

    await mapWithConcurrency(toFetch, this.concurrency, async (block) => {
      const ts = await this.fetchOne(block);
      if (ts !== null) this.cache.set(block, { ts, estimated: false });
    });

    const measured = [...this.cache.entries()]
      .filter(([, v]) => !v.estimated)
      .sort((a, b) => a[0] - b[0]);

    // Slope from the two furthest-apart measured blocks, falling back to the
    // configured nominal block time when fewer than two exist.
    let slope = SECONDS_PER_BLOCK;
    let originBlock: number | null = null;
    let originTs = 0;
    if (measured.length >= 2) {
      const lo = measured[0]!;
      const hi = measured[measured.length - 1]!;
      if (hi[0] !== lo[0]) slope = (hi[1].ts - lo[1].ts) / (hi[0] - lo[0]);
      originBlock = lo[0];
      originTs = lo[1].ts;
    } else if (measured.length === 1) {
      originBlock = measured[0]![0];
      originTs = measured[0]![1].ts;
    }

    const out = new Map<number, BlockTime>();
    for (const block of wanted) {
      const hit = this.cache.get(block);
      if (hit) {
        out.set(block, hit);
        continue;
      }
      if (originBlock === null) {
        // Nothing was readable. Refusing to invent a timestamp is the honest
        // move; the caller renders a blank instead of a fabricated clock.
        continue;
      }
      // Estimates are deliberately NOT cached: caching one would stop a later
      // resolve() from ever reading that block for real.
      out.set(block, {
        ts: Math.round(originTs + (block - originBlock) * slope),
        estimated: true,
      });
    }
    return out;
  }
}
