// Paginated starknet_getEvents.
//
// The bug this exists to kill. site/src/rpc.ts asks for chunk_size 500 and
// reads `events` once, ignoring `continuation_token`. Past 500 events on a
// vault the board silently drops everything after the first page and shows a
// history that looks complete. Nothing in the response says "there is more"
// unless you look at the token.
//
// So: this wrapper follows the token to the end, and when it hits its own page
// cap it says so in the return value. A caller that gets truncated: true has to
// decide what to show; it can no longer be lied to by omission. The cap exists
// because an unbounded loop against a public endpoint is its own outage.
//
// This module does not touch site/src/rpc.ts. Wiring the board onto it is a
// separate change.

import type { RpcClient } from "./client";

export type RawEvent = {
  from_address: string;
  keys: string[];
  data: string[];
  block_hash?: string;
  block_number: number;
  transaction_hash: string;
};

export type EventScan = {
  events: RawEvent[];
  /** True when the page cap stopped the scan with a continuation token still
   *  outstanding. The event list is a PREFIX of the real history. */
  truncated: boolean;
  /** Pages actually fetched. */
  pages: number;
};

export type BlockId = { block_number: number } | "latest" | "pending";

export type ScanOptions = {
  /** Contract address to scan. */
  address: string;
  from: BlockId;
  to?: BlockId;
  /**
   * Key filter, positional. keys[0] is the set of allowed selectors, keys[1]
   * the set of allowed values for the first #[key] field, and so on. An empty
   * array at a position matches anything. Examples:
   *   [[EVENT.Charged]]                        every Charged
   *   [[EVENT.Charged], [commitment]]          one subscription's charges
   *   [[EVENT.Claimed, EVENT.ClaimedPublic], creatorIds]   both, several ids
   */
  keys?: string[][];
  /** Events per page. The RPC spec caps this server-side too. */
  chunkSize?: number;
  /** Hard page cap. 20 pages at 500 per page is 10,000 events. */
  maxPages?: number;
};

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_MAX_PAGES = 20;

export async function scanEvents(
  client: RpcClient,
  opts: ScanOptions,
): Promise<EventScan> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const events: RawEvent[] = [];
  let continuation: string | undefined;
  let pages = 0;

  for (;;) {
    const filter: Record<string, unknown> = {
      from_block: opts.from,
      to_block: opts.to ?? "latest",
      address: opts.address,
      chunk_size: chunkSize,
    };
    if (opts.keys && opts.keys.length > 0) filter.keys = opts.keys;
    if (continuation !== undefined) filter.continuation_token = continuation;

    const page = await client.call<{
      events: RawEvent[];
      continuation_token?: string;
    }>("starknet_getEvents", [filter]);
    pages += 1;
    events.push(...(page.events ?? []));
    continuation = page.continuation_token;

    if (continuation === undefined || continuation === null) {
      return { events, truncated: false, pages };
    }
    if (pages >= maxPages) {
      // The token is still live. Report the prefix and say it is a prefix.
      return { events, truncated: true, pages };
    }
  }
}

/** Runs several scans and folds their truncation flags together, so a caller
 *  gets one honest "some of this is a prefix" bit for a whole assembly. */
export async function scanMany(
  client: RpcClient,
  scans: ReadonlyArray<{ label: string; opts: ScanOptions }>,
): Promise<{
  byLabel: Map<string, EventScan>;
  truncated: boolean;
  /** Labels of scans that threw. Their entry is absent from byLabel. */
  failed: string[];
}> {
  const results = await Promise.all(
    scans.map(async (s) => {
      try {
        return { label: s.label, scan: await scanEvents(client, s.opts) };
      } catch {
        return { label: s.label, scan: null };
      }
    }),
  );
  const byLabel = new Map<string, EventScan>();
  const failed: string[] = [];
  let truncated = false;
  for (const r of results) {
    if (r.scan === null) {
      failed.push(r.label);
      continue;
    }
    byLabel.set(r.label, r.scan);
    truncated ||= r.scan.truncated;
  }
  return { byLabel, truncated, failed };
}
