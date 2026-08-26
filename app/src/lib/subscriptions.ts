// The subscriptions one browser can prove it owns.
//
// This is the read behind /manage, and it is the only read in the product that
// starts from a secret rather than from an address. Nothing about it leaves the
// machine.
//
// HOW IT FINDS THEM. A commitment is poseidon(subscriber secret, creator_id),
// so a browser holding the secret can recompute every commitment it could ever
// have made, given the list of creator ids. The vault publishes that list:
// CreatorRegistered indexes creator_id in keys[1]. So:
//
//   1. one scan of CreatorRegistered            -> every creator at this vault
//   2. commitmentOf(secret, id) for each        -> candidates, in this browser
//   3. one key-filtered scan of Subscribed      -> which candidates exist
//   4. schedule_of + tier_of on the survivors   -> what each one actually is
//
// COST. Two event scans and two view calls per surviving subscription, whatever
// the vault's size. Step 3 is the reason: the keys filter takes a SET at each
// position, so asking "which of these N commitments was ever subscribed" is one
// round trip rather than N, and the view calls in step 4 are then paid only for
// subscriptions that really exist. Calling schedule_of on every candidate would
// have worked too (it answers creator_id 0 for an unknown commitment) but costs
// one round trip per creator the vault has ever registered, forever. Past
// MAX_KEY_FILTER_VALUES candidates the filter itself gets unwieldy, so the scan
// falls back to selector-only and the filtering happens here, the same
// trade-off src/lib/creator/ledger.ts makes for the same reason.
//
// WHAT IT DOES NOT DO. It does not touch key material: the caller derives the
// candidate commitments through src/lib/wallet/keys.ts, which reads the stored
// secret and returns public values only. This module never sees a secret and
// has no parameter that could carry one.

import { VAULT, VAULT_DEPLOY_BLOCK } from "../config";
import { readSchedule } from "./schedule";
import type { Schedule } from "./schedule";
import { EVENT, feltPad } from "./selectors";
import { scanEvents } from "./rpc/events";
import type { RpcClient } from "./rpc/client";
import { readMany, tierOf } from "./rpc/views";
import { MAX_KEY_FILTER_VALUES } from "./creator/ledger";

/** One commitment this browser can derive, before anything is known about
 *  whether the chain has heard of it. */
export type Candidate = { creatorId: string; commitment: string };

export type Subscription = {
  creatorId: string;
  commitment: string;
  schedule: Schedule;
  /** tier_of(creator_id, tier).amount: what one period costs. null when the
   *  read failed, which drops the "covers N more charges" line rather than
   *  printing a coverage figure with an invented denominator. */
  tierPriceWei: bigint | null;
  /** The block this subscription was recorded at. */
  subscribedBlock: number;
};

export type SubscriptionRead = {
  subscriptions: Subscription[];
  /** Creator ids the vault has registered. Its length is the candidate count,
   *  which is what the page cites when it says how wide the search was. */
  creatorIds: string[];
  /** True when either scan hit its page cap: some subscription of this
   *  browser's could be missing from the list below. */
  truncated: boolean;
  /** Labels for reads that failed or were capped. */
  partial: string[];
};

const u = (f: string | undefined): bigint => BigInt(f ?? "0x0");

// --- incremental scan caches -------------------------------------------------
//
// Both scans below read append-only history (a creator registered stays
// registered; a Subscribed event stays emitted), so each caches what it saw
// with a high-water block and re-scans only the blocks since. Same pattern
// and same rules as lib/board.ts: a truncated scan never advances the mark,
// views are never cached, and a cache that fails to parse is discarded.
// Guarded for non-browser callers (the node test bundles), and gated to the
// default vault so a caller reading some other address never mixes caches.

const CREATORS_CACHE_KEY = "nightshift.creators.scan.v1";
const SUBS_CACHE_KEY = "nightshift.subs.scan.v1";

function loadCache<T>(key: string): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function saveCache(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage refused; the next load pays the full scan again
  }
}

type CreatorsCache = { upTo: number; creatorIds: string[] };
type SubsCache = {
  upTo: number;
  /** The candidate set this cache was scanned under. A different set means a
   *  different key filter, so the cache is only trusted when it matches. */
  candidateKey: string;
  /** decimal commitment -> block its Subscribed event landed at. */
  found: Record<string, number>;
};

/** Every creator id the vault has registered, deduplicated by value rather
 *  than by string, because RPC nodes are not consistent about padding. */
export async function readVaultCreators(
  client: RpcClient,
  vault: string = VAULT,
): Promise<{ creatorIds: string[]; truncated: boolean; partial: string[] }> {
  const partial: string[] = [];
  const cached = vault === VAULT ? loadCache<CreatorsCache>(CREATORS_CACHE_KEY) : null;
  try {
    const headBlock = await client.call<number>("starknet_blockNumber", []);
    const from = cached !== null ? Math.min(cached.upTo + 1, headBlock) : VAULT_DEPLOY_BLOCK;
    const scan = await scanEvents(client, {
      address: vault,
      from: { block_number: from },
      to: { block_number: headBlock },
      keys: [[EVENT.CreatorRegistered]],
    });
    if (scan.truncated) {
      partial.push(`CreatorRegistered: page cap hit after ${scan.pages} pages`);
    }
    const seen = new Set<string>(cached?.creatorIds ?? []);
    const creatorIds: string[] = [...(cached?.creatorIds ?? [])];
    for (const e of scan.events) {
      const id = feltPad(e.keys[1] ?? "0x0");
      if (u(id) === 0n || seen.has(id)) continue;
      seen.add(id);
      creatorIds.push(id);
    }
    if (vault === VAULT && !scan.truncated) {
      saveCache(CREATORS_CACHE_KEY, { upTo: headBlock, creatorIds } satisfies CreatorsCache);
    }
    return { creatorIds, truncated: scan.truncated, partial };
  } catch (e) {
    partial.push(`CreatorRegistered: ${e instanceof Error ? e.message : String(e)}`);
    // A failed incremental read still knows what the last clean read knew.
    return { creatorIds: cached?.creatorIds ?? [], truncated: false, partial };
  }
}

/**
 * Which of the candidate commitments the vault has actually heard of, and what
 * each one is. Never throws: a failed read degrades into `partial` the way
 * every other read in this codebase does, because a wallet page that throws
 * away a reader's whole subscription list over one bad response is worse than
 * one that says which part it could not read.
 */
export async function readSubscriptions(
  client: RpcClient,
  candidates: readonly Candidate[],
  vault: string = VAULT,
): Promise<Omit<SubscriptionRead, "creatorIds">> {
  const partial: string[] = [];
  let truncated = false;
  if (candidates.length === 0) return { subscriptions: [], truncated, partial };

  const byCommitment = new Map(candidates.map((c) => [BigInt(c.commitment).toString(), c]));
  const keys = candidates.map((c) => feltPad(c.commitment));
  const fits = keys.length <= MAX_KEY_FILTER_VALUES;

  // The cache is trusted only under the exact candidate set it was scanned
  // with: a new candidate means a new key filter, and events for it may sit
  // anywhere in history, so the scan starts over from the deploy block.
  const candidateKey = [...keys].sort().join(",");
  const cachedRaw = vault === VAULT ? loadCache<SubsCache>(SUBS_CACHE_KEY) : null;
  const cached = cachedRaw !== null && cachedRaw.candidateKey === candidateKey ? cachedRaw : null;

  const foundBlocks = new Map<string, number>(
    Object.entries(cached?.found ?? {}).map(([k, v]) => [k, v]),
  );
  try {
    const headBlock = await client.call<number>("starknet_blockNumber", []);
    const from = cached !== null ? Math.min(cached.upTo + 1, headBlock) : VAULT_DEPLOY_BLOCK;
    const scan = await scanEvents(client, {
      address: vault,
      from: { block_number: from },
      to: { block_number: headBlock },
      keys: fits ? [[EVENT.Subscribed], keys] : [[EVENT.Subscribed]],
    });
    if (scan.truncated) {
      truncated = true;
      partial.push(`Subscribed: page cap hit after ${scan.pages} pages`);
    }
    for (const e of scan.events) {
      const key = u(e.keys[1]).toString();
      if (!byCommitment.has(key)) continue;
      foundBlocks.set(key, e.block_number);
    }
    if (vault === VAULT && !scan.truncated) {
      saveCache(SUBS_CACHE_KEY, {
        upTo: headBlock,
        candidateKey,
        found: Object.fromEntries(foundBlocks),
      } satisfies SubsCache);
    }
  } catch (e) {
    partial.push(`Subscribed: ${e instanceof Error ? e.message : String(e)}`);
    if (cached === null) return { subscriptions: [], truncated, partial };
    // A failed incremental read still knows what the last clean read found;
    // the schedules below are read fresh either way.
  }
  const found: Array<{ candidate: Candidate; block: number }> = [...foundBlocks.entries()]
    .map(([key, block]) => ({ candidate: byCommitment.get(key), block }))
    .filter((f): f is { candidate: Candidate; block: number } => f.candidate !== undefined);

  // readSchedule returns null for a commitment the vault does not know, which
  // is the second gate: an event without a schedule behind it gets no card.
  const schedules = await readMany(
    found.map((f) => f.candidate.commitment),
    (commitment) => readSchedule(commitment, client),
  );
  for (const f of schedules.failed) partial.push(`schedule_of: ${f.key}: ${f.error}`);

  const live = found.filter((f) => schedules.ok.get(f.candidate.commitment));
  const tierKeys = [
    ...new Set(
      live.map((f) => {
        const s = schedules.ok.get(f.candidate.commitment)!;
        return `${s.creatorId}#${s.tier}`;
      }),
    ),
  ];
  const tiers = await readMany(tierKeys, (key) => {
    const [id, t] = key.split("#");
    return tierOf(client, id!, Number(t), vault);
  });
  for (const f of tiers.failed) partial.push(`tier_of: ${f.key}: ${f.error}`);

  const subscriptions: Subscription[] = live.map((f) => {
    const schedule = schedules.ok.get(f.candidate.commitment)!;
    const tier = tiers.ok.get(`${schedule.creatorId}#${schedule.tier}`);
    return {
      creatorId: f.candidate.creatorId,
      commitment: f.candidate.commitment,
      schedule,
      tierPriceWei: tier ? tier.amountWei : null,
      subscribedBlock: f.block,
    };
  });
  // Newest first: the subscription a reader just made is the one they came for.
  subscriptions.sort((a, b) => b.subscribedBlock - a.subscribedBlock);
  return { subscriptions, truncated, partial };
}

/** What a card says about a subscription in one word. Cancelled first, because
 *  a cancelled subscription with escrow left is still cancelled. */
export type SubscriptionState = "active" | "exhausted" | "cancelled";

export function subscriptionState(s: Subscription): SubscriptionState {
  if (s.schedule.cancelled) return "cancelled";
  if (s.schedule.nextPeriod >= s.schedule.nPeriods) return "exhausted";
  if (s.tierPriceWei !== null && s.tierPriceWei > 0n && s.schedule.escrowWei < s.tierPriceWei) {
    return "exhausted";
  }
  return "active";
}

/** How many further charges the escrow covers. null when the per-period amount
 *  could not be read, because a coverage figure without a price behind it is a
 *  guess dressed as a count. */
export function coveredCharges(s: Subscription): number | null {
  if (s.tierPriceWei === null || s.tierPriceWei <= 0n) return null;
  const affordable = Number(s.schedule.escrowWei / s.tierPriceWei);
  const remaining = Math.max(0, s.schedule.nPeriods - s.schedule.nextPeriod);
  // The vault will not charge past the schedule it sold, however much escrow is
  // sitting there, so the smaller of the two is the honest answer.
  return Math.min(affordable, remaining);
}

/** The first block the next period may be charged at, or null when there is no
 *  next period to wait for. */
export function nextChargeBlock(s: Subscription): number | null {
  if (s.schedule.cancelled) return null;
  if (s.schedule.nextPeriod >= s.schedule.nPeriods) return null;
  if (s.schedule.periodBlocks <= 0) return null;
  return s.schedule.startBlock + s.schedule.nextPeriod * s.schedule.periodBlocks;
}
