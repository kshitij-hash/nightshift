// Assembles everything the chain knows about one or more creators into a
// single typed record. Fetching lives here; arithmetic lives in metrics.mjs and
// never touches the network.
//
// What this reads, and why each read is shaped the way it is:
//
//   Subscribed          creator_id is NOT indexed on this event (only the
//                       commitment is), so the creator filter has to happen
//                       client-side on data[0]. One scan over the vault's
//                       Subscribed history, filtered locally.
//   schedule_of         per commitment. The event only carries n_periods; the
//                       tier, cadence, escrow, cursor and cancel flag are state.
//   periods_due         per commitment. Cheaper and more truthful than
//                       recomputing the vault's loop from a stale head block.
//   tier_of             per distinct (creator_id, tier). Tier price is what
//                       turns a period count into money.
//   Charged             key-filtered. See CHARGED SCAN STRATEGY below.
//   Claimed +           both index creator_id, so ONE scan with
//   ClaimedPublic       keys [[Claimed, ClaimedPublic], creatorIds] covers
//                       every creator and both events. The keys filter is
//                       positional and each position is a set of alternatives.
//   Cancelled +         both index commitment. Same trick, one scan.
//   Reclaimed
//   Presented (gate)    indexes commitment AND verifier_id. creator_id rides in
//                       data[1] and cannot be filtered server-side, so this is
//                       key-filtered on the commitment set and then checked
//                       against the creator ids locally.
//   claimable_of        per creator: the charged-but-unsettled balance.
//   claim_pub_nonce_of  per creator: the nonce the next public claim binds.
//
// CHARGED SCAN STRATEGY. Charged indexes the commitment, so there are two ways
// to get one creator's charges:
//   (a) one scan per commitment, keys [[Charged], [commitment]]
//   (b) one scan for all of them, keys [[Charged], [c1, c2, ...]]
// (b) is a single round trip regardless of how many commitments there are,
// because the keys filter takes a SET at each position. So (b) is chosen
// whenever the commitment set fits MAX_KEY_FILTER_VALUES; per-commitment
// scanning would cost one round trip each and buys nothing. Past that size the
// filter itself gets unwieldy, so the fallback is (c): one selector-only scan,
// keys [[Charged]], filtered client-side on keys[1]. (c) costs one page per 500
// events on the whole vault rather than per 500 of ours, which is why it is the
// fallback and not the default.
//
// Multiple creator ids are merged into one ledger on purpose: a creator running
// several registrations (one per token, or one per product) reads their own
// local sum without any of the ids being linked on chain.

import { GATE, VAULT, VAULT_DEPLOY_BLOCK } from "../../config";
import { EVENT, GATE_EVENT, feltEq, feltPad } from "../selectors";
import { BlockTimeResolver } from "../rpc/blocktime";
import type { BlockTime } from "../rpc/blocktime";
import type { RpcClient } from "../rpc/client";
import { scanEvents } from "../rpc/events";
import type { RawEvent } from "../rpc/events";
import {
  claimPubNonceOf,
  claimableOf,
  periodsDue,
  readMany,
  scheduleOf,
  tierOf,
} from "../rpc/views";
import type { Felt, Schedule } from "../rpc/views";

export type { Felt, Schedule };

/** Above this many commitments the key filter stops being the cheap option and
 *  the scan falls back to selector-only plus a client-side filter. */
export const MAX_KEY_FILTER_VALUES = 64;

export type EventStamp = {
  block: number;
  txHash: string;
  /** Present only when opts.withTimestamps was set. */
  time?: BlockTime;
};

export type CommitmentRecord = EventStamp & {
  commitment: Felt;
  /** From the Subscribed event's data[0]. */
  creatorId: Felt;
  /** From the Subscribed event's data[1]. The schedule below is authoritative
   *  where the two can disagree; this is what the chain announced at subscribe. */
  nPeriodsAtSubscribe: number;
  /** null when schedule_of could not be read; the commitment is then listed in
   *  provenance.partial. */
  schedule: Schedule | null;
  /** vault periods_due, or null when the read failed. */
  periodsDue: number | null;
  /** tier_of(creator_id, tier).amount, or null when unknown. */
  tierPriceWei: bigint | null;
  /** tier_of(creator_id, tier).token. */
  token: Felt | null;
};

export type ChargeRecord = EventStamp & {
  commitment: Felt;
  periodIndex: number;
  amountWei: bigint;
  /** Whoever fired the charge. The keeper account, for an unattended run. */
  by: Felt;
};

export type ClaimRecord = EventStamp & { creatorId: Felt; amountWei: bigint };
export type ClaimPublicRecord = ClaimRecord & { to: Felt };
export type CancelRecord = EventStamp & { commitment: Felt };
export type ReclaimRecord = EventStamp & { commitment: Felt; amountWei: bigint };
export type PresentationRecord = EventStamp & {
  commitment: Felt;
  verifierId: Felt;
  expiryBlock: number;
  creatorId: Felt;
  tier: number;
};

export type CreatorRecord = {
  creatorId: Felt;
  /** Charged but not yet settled, from claimable_of. null when unread. */
  claimableWei: bigint | null;
  /** The nonce the creator's next public claim signature must bind. */
  claimPubNonce: bigint | null;
};

export type Provenance = {
  source: "rpc";
  /** True when ANY scan hit its page cap. Some list in this ledger is a prefix. */
  truncated: boolean;
  /** Labels for reads that failed or were capped. Non-empty means the numbers
   *  below are computed over less than the whole history. */
  partial: string[];
};

export type CreatorLedger = {
  creators: CreatorRecord[];
  commitments: CommitmentRecord[];
  charges: ChargeRecord[];
  claims: ClaimRecord[];
  claimsPublic: ClaimPublicRecord[];
  cancels: CancelRecord[];
  reclaims: ReclaimRecord[];
  presentations: PresentationRecord[];
  headBlock: number;
  provenance: Provenance;
};

export type LedgerOptions = {
  vault?: string;
  gate?: string;
  fromBlock?: number;
  /** Page cap handed to every scan. */
  maxPages?: number;
  /** Resolve block timestamps for every event. Costs block reads; the
   *  resolver interpolates past its budget and flags what it interpolated. */
  withTimestamps?: boolean;
};

const u = (f: string | undefined): bigint => BigInt(f ?? "0x0");
const num = (f: string | undefined): number => Number(u(f));

const stamp = (e: RawEvent): EventStamp => ({
  block: e.block_number,
  txHash: e.transaction_hash,
});

export async function assembleCreatorLedger(
  client: RpcClient,
  creatorIds: string[],
  opts: LedgerOptions = {},
): Promise<CreatorLedger> {
  const vault = opts.vault ?? VAULT;
  const gate = opts.gate ?? GATE;
  const from = { block_number: opts.fromBlock ?? VAULT_DEPLOY_BLOCK };
  const maxPages = opts.maxPages;
  const wanted = new Set(creatorIds.map((id) => u(id)));
  const partial: string[] = [];
  let truncated = false;

  const note = (label: string, why: string) => partial.push(`${label}: ${why}`);

  // Unlike every other read below, this one has nothing to fall back on from
  // its own response: it is the head block, not a per-record value. On
  // failure the whole assembly still degrades into provenance.partial rather
  // than rejecting outright; the estimate is filled in once the event scans
  // below have run, from the highest block number any of them actually saw.
  let headBlock: number;
  let headBlockFailure: unknown;
  try {
    headBlock = await client.call<number>("starknet_blockNumber", []);
  } catch (e) {
    headBlockFailure = e;
    headBlock = opts.fromBlock ?? VAULT_DEPLOY_BLOCK; // replaced below once events are in hand
  }

  // --- Subscribed: one scan, creator filter client-side on data[0] ---------
  let subscribedEvents: RawEvent[] = [];
  try {
    const scan = await scanEvents(client, {
      address: vault,
      from,
      keys: [[EVENT.Subscribed]],
      maxPages,
    });
    subscribedEvents = scan.events;
    if (scan.truncated) {
      truncated = true;
      note("Subscribed", `page cap hit after ${scan.pages} pages`);
    }
  } catch (e) {
    note("Subscribed", e instanceof Error ? e.message : String(e));
  }

  const mine = subscribedEvents.filter((e) => wanted.has(u(e.data[0])));
  const commitments: CommitmentRecord[] = mine.map((e) => ({
    ...stamp(e),
    // keys[0] is the selector; the one indexed field follows.
    commitment: feltPad(e.keys[1] ?? "0x0"),
    creatorId: feltPad(e.data[0] ?? "0x0"),
    nPeriodsAtSubscribe: num(e.data[1]),
    schedule: null,
    periodsDue: null,
    tierPriceWei: null,
    token: null,
  }));
  const commitmentKeys = commitments.map((c) => c.commitment);
  const commitmentSet = new Set(commitmentKeys.map((c) => BigInt(c)));

  // --- schedule_of + periods_due per commitment ----------------------------
  const schedules = await readMany(commitmentKeys, (c) => scheduleOf(client, c, vault));
  for (const f of schedules.failed) note("schedule_of", `${f.key}: ${f.error}`);
  const dues = await readMany(commitmentKeys, (c) => periodsDue(client, c, vault));
  for (const f of dues.failed) note("periods_due", `${f.key}: ${f.error}`);

  for (const rec of commitments) {
    rec.schedule = schedules.ok.get(rec.commitment) ?? null;
    rec.periodsDue = dues.ok.has(rec.commitment) ? dues.ok.get(rec.commitment)! : null;
  }

  // --- tier_of per distinct (creator_id, tier) -----------------------------
  const tierKeys = [
    ...new Set(
      commitments
        .filter((c) => c.schedule !== null)
        .map((c) => `${c.schedule!.creatorId}#${c.schedule!.tier}`),
    ),
  ];
  const tiers = await readMany(tierKeys, (key) => {
    const [id, t] = key.split("#");
    return tierOf(client, id!, Number(t), vault);
  });
  for (const f of tiers.failed) note("tier_of", `${f.key}: ${f.error}`);
  for (const rec of commitments) {
    if (!rec.schedule) continue;
    const t = tiers.ok.get(`${rec.schedule.creatorId}#${rec.schedule.tier}`);
    rec.tierPriceWei = t ? t.amountWei : null;
    rec.token = t ? t.token : null;
  }

  // --- Charged -------------------------------------------------------------
  // See CHARGED SCAN STRATEGY at the top of this file.
  const chargeKeyFilterFits =
    commitmentKeys.length > 0 && commitmentKeys.length <= MAX_KEY_FILTER_VALUES;
  const charges: ChargeRecord[] = [];
  if (commitmentKeys.length > 0) {
    try {
      const scan = await scanEvents(client, {
        address: vault,
        from,
        keys: chargeKeyFilterFits
          ? [[EVENT.Charged], commitmentKeys]
          : [[EVENT.Charged]],
        maxPages,
      });
      if (scan.truncated) {
        truncated = true;
        note("Charged", `page cap hit after ${scan.pages} pages`);
      }
      for (const e of scan.events) {
        const commitment = feltPad(e.keys[1] ?? "0x0");
        if (!commitmentSet.has(BigInt(commitment))) continue;
        charges.push({
          ...stamp(e),
          commitment,
          // data: period_index (u32), amount (u128), by (ContractAddress)
          periodIndex: num(e.data[0]),
          amountWei: u(e.data[1]),
          by: feltPad(e.data[2] ?? "0x0"),
        });
      }
    } catch (e) {
      note("Charged", e instanceof Error ? e.message : String(e));
    }
  }

  // --- Claimed + ClaimedPublic: one scan, both selectors, all creators -----
  const claims: ClaimRecord[] = [];
  const claimsPublic: ClaimPublicRecord[] = [];
  if (creatorIds.length > 0) {
    try {
      const scan = await scanEvents(client, {
        address: vault,
        from,
        keys: [[EVENT.Claimed, EVENT.ClaimedPublic], creatorIds.map(feltPad)],
        maxPages,
      });
      if (scan.truncated) {
        truncated = true;
        note("Claimed/ClaimedPublic", `page cap hit after ${scan.pages} pages`);
      }
      for (const e of scan.events) {
        const creatorId = feltPad(e.keys[1] ?? "0x0");
        if (feltEq(e.keys[0] ?? "0x0", EVENT.Claimed)) {
          // data: amount (u128)
          claims.push({ ...stamp(e), creatorId, amountWei: u(e.data[0]) });
        } else if (feltEq(e.keys[0] ?? "0x0", EVENT.ClaimedPublic)) {
          // data: to (ContractAddress), amount (u128)
          claimsPublic.push({
            ...stamp(e),
            creatorId,
            to: feltPad(e.data[0] ?? "0x0"),
            amountWei: u(e.data[1]),
          });
        }
      }
    } catch (e) {
      note("Claimed/ClaimedPublic", e instanceof Error ? e.message : String(e));
    }
  }

  // --- Cancelled + Reclaimed: one scan over the commitment set -------------
  const cancels: CancelRecord[] = [];
  const reclaims: ReclaimRecord[] = [];
  if (commitmentKeys.length > 0) {
    const fits = commitmentKeys.length <= MAX_KEY_FILTER_VALUES;
    try {
      const scan = await scanEvents(client, {
        address: vault,
        from,
        keys: fits
          ? [[EVENT.Cancelled, EVENT.Reclaimed], commitmentKeys]
          : [[EVENT.Cancelled, EVENT.Reclaimed]],
        maxPages,
      });
      if (scan.truncated) {
        truncated = true;
        note("Cancelled/Reclaimed", `page cap hit after ${scan.pages} pages`);
      }
      for (const e of scan.events) {
        const commitment = feltPad(e.keys[1] ?? "0x0");
        if (!commitmentSet.has(BigInt(commitment))) continue;
        if (feltEq(e.keys[0] ?? "0x0", EVENT.Cancelled)) {
          // data is empty on Cancelled.
          cancels.push({ ...stamp(e), commitment });
        } else {
          // data: amount (u128)
          reclaims.push({ ...stamp(e), commitment, amountWei: u(e.data[0]) });
        }
      }
    } catch (e) {
      note("Cancelled/Reclaimed", e instanceof Error ? e.message : String(e));
    }
  }

  // --- Presented, from the gate -------------------------------------------
  const presentations: PresentationRecord[] = [];
  if (commitmentKeys.length > 0) {
    const fits = commitmentKeys.length <= MAX_KEY_FILTER_VALUES;
    try {
      const scan = await scanEvents(client, {
        address: gate,
        from,
        keys: fits ? [[GATE_EVENT.Presented], commitmentKeys] : [[GATE_EVENT.Presented]],
        maxPages,
      });
      if (scan.truncated) {
        truncated = true;
        note("Presented", `page cap hit after ${scan.pages} pages`);
      }
      for (const e of scan.events) {
        // keys: selector, commitment, verifier_id
        // data: expiry_block (u64), creator_id, tier (u8)
        const creatorId = feltPad(e.data[1] ?? "0x0");
        if (!wanted.has(BigInt(creatorId))) continue;
        presentations.push({
          ...stamp(e),
          commitment: feltPad(e.keys[1] ?? "0x0"),
          verifierId: feltPad(e.keys[2] ?? "0x0"),
          expiryBlock: num(e.data[0]),
          creatorId,
          tier: num(e.data[2]),
        });
      }
    } catch (e) {
      note("Presented", e instanceof Error ? e.message : String(e));
    }
  }

  // --- per-creator balances ------------------------------------------------
  const ids = creatorIds.map(feltPad);
  const claimables = await readMany(ids, (id) => claimableOf(client, id, vault));
  for (const f of claimables.failed) note("claimable_of", `${f.key}: ${f.error}`);
  const nonces = await readMany(ids, (id) => claimPubNonceOf(client, id, vault));
  for (const f of nonces.failed) note("claim_pub_nonce_of", `${f.key}: ${f.error}`);
  const creators: CreatorRecord[] = ids.map((creatorId) => ({
    creatorId,
    claimableWei: claimables.ok.has(creatorId) ? claimables.ok.get(creatorId)! : null,
    claimPubNonce: nonces.ok.has(creatorId) ? nonces.ok.get(creatorId)! : null,
  }));

  if (headBlockFailure !== undefined) {
    const seenBlocks = [
      ...commitments.map((c) => c.block),
      ...charges.map((c) => c.block),
      ...claims.map((c) => c.block),
      ...claimsPublic.map((c) => c.block),
      ...cancels.map((c) => c.block),
      ...reclaims.map((c) => c.block),
      ...presentations.map((c) => c.block),
    ];
    // A loop, not Math.max(...seenBlocks): spreading into Math.max blows the
    // call stack past roughly 65k arguments, on the exact fallback path this
    // code exists to soften (RPC already failed once to get here).
    if (seenBlocks.length > 0) {
      let highest = seenBlocks[0];
      for (const block of seenBlocks) if (block > highest) highest = block;
      headBlock = highest;
    }
    const reason = headBlockFailure instanceof Error ? headBlockFailure.message : String(headBlockFailure);
    // Not `truncated`: that flag means a scan hit its page cap and some list
    // here is a prefix, which this is not. This is a single value estimated
    // from data already in hand, flagged the same way every other failed
    // read on this ledger is flagged. The estimate is a LOWER bound: the
    // true head block can only be at or above the highest block any fetched
    // event happened to land in, so a schedule check against this headBlock
    // can read an entitlement as lapsed when it has not, never the reverse.
    note(
      "headBlock",
      `${reason}; headBlock estimated from the highest block seen across fetched events ` +
        `(a lower bound - entitlement lapse may be over-reported)`,
    );
  }

  const ledger: CreatorLedger = {
    creators,
    commitments,
    charges,
    claims,
    claimsPublic,
    cancels,
    reclaims,
    presentations,
    headBlock,
    provenance: { source: "rpc", truncated, partial },
  };

  if (opts.withTimestamps) await attachTimestamps(client, ledger);
  return ledger;
}

/** Fills EventStamp.time across every record, in one pass over the resolver so
 *  a block shared by several events is read once. */
export async function attachTimestamps(
  client: RpcClient,
  ledger: CreatorLedger,
): Promise<void> {
  const rows: EventStamp[] = [
    ...ledger.commitments,
    ...ledger.charges,
    ...ledger.claims,
    ...ledger.claimsPublic,
    ...ledger.cancels,
    ...ledger.reclaims,
    ...ledger.presentations,
  ];
  if (rows.length === 0) return;
  const resolver = new BlockTimeResolver(client);
  const times = await resolver.resolve(rows.map((r) => r.block));
  for (const row of rows) {
    const t = times.get(row.block);
    if (t) row.time = t;
  }
}
