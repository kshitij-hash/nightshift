// Creator metrics: pure functions over a CreatorLedger. Nothing here fetches.
//
// Plain JS with JSDoc types, deliberately. The same arithmetic has to run in
// two places: inside the Vite/TS bundle, and under `node --test` with zero
// dependencies and zero build step. A .mjs plus a hand-written .d.mts sibling
// is the only shape that satisfies both without adding a transpiler to the
// test path. metrics.d.mts is the type surface; keep the two in step.
//
// Every function returns { value, unit, basis, caveat? }:
//   value   the number, or a small object when one number would be a lie
//   unit    what the number counts
//   basis   the exact rule, in one sentence, so a reader can check the label
//           against the Cairo instead of trusting the name
//   caveat  present only when something about this ledger weakens the number
//
// The names are the ones that ship. Where a metric can only be an estimate
// (run rate) or can only cover part of the history (a truncated scan), the
// caveat says so rather than the name hiding it.
//
// Note on what is public. Charged, Claimed, ClaimedPublic, Cancelled,
// Reclaimed and Presented are all public events, and a creator's per-creator
// topline is derivable from them by anyone reading the chain (PRIVACY.md
// limitation 2). These metrics read that public record faster than a block
// explorer; they do not make any of it less visible.

/** Blocks per billing period, from src/common.cairo. */
export const PERIOD_HOUR = 2100;
export const PERIOD_DAY = 50400;
export const PERIOD_WEEK = 352800;

/** 30 days at the ladder's day length. The run rate is denominated in this. */
export const BLOCKS_PER_30D = PERIOD_DAY * 30; // 1,512,000

/** Default on-time window for a keeper charge, in blocks (~1 hour). A cron
 *  keeper that runs every 30 minutes fires within this of the due height. */
export const DEFAULT_KEEPER_TOLERANCE_BLOCKS = PERIOD_HOUR;

/**
 * @typedef {import("./ledger").CreatorLedger} CreatorLedger
 * @typedef {import("./ledger").CommitmentRecord} CommitmentRecord
 */

/** @returns {{value: any, unit: string, basis: string, caveat?: string}} */
const metric = (value, unit, basis, caveat) =>
  caveat === undefined ? { value, unit, basis } : { value, unit, basis, caveat };

/** Appends the "this ledger is a prefix" warning to any caveat. */
const withProvenance = (ledger, caveat) => {
  const p = ledger.provenance;
  const notes = [];
  if (caveat) notes.push(caveat);
  if (p && p.truncated) {
    notes.push("the scan stopped short of the newest block, so this covers only part of the history");
  }
  if (p && p.partial && p.partial.length > 0) {
    notes.push(`${p.partial.length} read(s) came back incomplete: ${p.partial.join("; ")}`);
  }
  return notes.length === 0 ? undefined : notes.join(". ");
};

const sum = (xs) => xs.reduce((a, b) => a + b, 0n);

/**
 * Funded and running: the vault would let the next charge through.
 * @param {CommitmentRecord} c
 */
export function isFunded(c) {
  const s = c.schedule;
  if (!s || s.cancelled) return false;
  if (s.nextPeriod >= s.nPeriods) return false;
  if (c.tierPriceWei === null || c.tierPriceWei === undefined) return false;
  return s.escrowWei >= c.tierPriceWei;
}

/**
 * The gate's entitlement rule, recomputed from the schedule. NOT is_active:
 * is_active is `next_period < n_periods`, which goes false the instant the
 * final period is charged, so it reads false during a period the subscriber
 * has fully paid for, and is false for every n_periods = 1 schedule the moment
 * its one period is charged. gate.presentable is the rule that admits.
 * @param {CommitmentRecord} c
 * @param {number} headBlock
 */
export function isEntitled(c, headBlock) {
  const s = c.schedule;
  if (!s || s.cancelled) return false;
  if (s.nextPeriod === 0) return false;
  return headBlock < s.startBlock + s.periodBlocks * s.nextPeriod;
}

/** Terminated: no further charge can ever fire for this commitment. */
export function isTerminated(c) {
  const s = c.schedule;
  if (!s) return false;
  return s.cancelled || s.nextPeriod >= s.nPeriods;
}

const unknownPrice = (ledger) =>
  ledger.commitments.filter(
    (c) => c.schedule !== null && (c.tierPriceWei === null || c.tierPriceWei === undefined),
  ).length;

// ---------------------------------------------------------------------------

/** Subscriptions the vault would charge again: schedule known, not cancelled,
 *  periods left, escrow still covers one tier price. */
export function activeSubscriptions(ledger) {
  const missing = unknownPrice(ledger);
  return metric(
    ledger.commitments.filter(isFunded).length,
    "subscriptions",
    "counted when a subscription is not cancelled, has periods left, and escrow >= tier price",
    withProvenance(
      ledger,
      missing > 0
        ? `${missing} subscription(s) have no readable tier price and are excluded`
        : undefined,
    ),
  );
}

/** Subscriptions a gate would admit right now. This is the presentable rule,
 *  recomputed locally from the same schedule read the gate does. */
export function currentlyEntitled(ledger) {
  return metric(
    ledger.commitments.filter((c) => isEntitled(c, ledger.headBlock)).length,
    "subscriptions",
    "counted when a subscription is not cancelled, has paid at least one period, and its current period has not lapsed - the same rule the gate applies",
    withProvenance(
      ledger,
      "during the final fully-paid period the vault's own active flag reads differently; the gate's rule is the one that admits",
    ),
  );
}

/** Subscriptions with a period due and uncharged, plus the worst backlog. */
export function arrears(ledger) {
  const due = ledger.commitments.filter(
    (c) => typeof c.periodsDue === "number" && c.periodsDue > 0,
  );
  const maxPeriodsDue = due.reduce((m, c) => Math.max(m, c.periodsDue), 0);
  const unread = ledger.commitments.filter((c) => c.periodsDue === null).length;
  return metric(
    { count: due.length, maxPeriodsDue },
    "subscriptions, periods",
    "subscriptions with at least one period past due and uncharged; severity is the most any one of them is behind",
    withProvenance(
      ledger,
      [
        // periods_due counts by height and cursor alone. It does not look at
        // escrow, so it can report a period due that charge() would refuse
        // with NS_ESCROW_EXHAUSTED. Read this as "periods past their due
        // height", not "periods that will be collected".
        "being past due does not check escrow, so a period counted here can still be uncollectable",
        unread > 0 ? `${unread} subscription(s) could not be read` : null,
      ]
        .filter(Boolean)
        .join(". "),
    ),
  );
}

/** What 30 days of charges would move at the current tier and cadence, over
 *  the funded subscriptions only. Block-denominated, so it is an estimate of
 *  calendar rate to exactly the extent block cadence drifts. */
export function escrowedRunRate30d(ledger) {
  const active = ledger.commitments.filter(isFunded);
  const value = sum(
    active.map((c) => {
      const pb = c.schedule.periodBlocks;
      if (!pb) return 0n;
      return (c.tierPriceWei * BigInt(BLOCKS_PER_30D)) / BigInt(pb);
    }),
  );
  return metric(
    value,
    "wei per 30 days",
    "each funded subscription's tier price, scaled to a 30-day month and summed",
    withProvenance(
      ledger,
      "periods run on blocks, not clocks, so this tracks calendar time approximately; it also assumes every subscription stays funded for the full month",
    ),
  );
}

/** Escrow still sitting in the vault for funded subscriptions. Contracted, not
 *  earned: cancel makes the remainder reclaimable by the subscriber. */
export function contractedRemaining(ledger) {
  const active = ledger.commitments.filter(isFunded);
  return metric(
    sum(active.map((c) => c.schedule.escrowWei)),
    "wei",
    "the escrow the vault still holds across funded subscriptions",
    withProvenance(
      ledger,
      "escrow is refundable: cancel then reclaim returns the whole remainder to the subscriber, including a period already due but never charged",
    ),
  );
}

/** Every charge that has fired for these commitments. */
export function grossRevenue(ledger) {
  return metric(
    sum(ledger.charges.map((c) => c.amountWei)),
    "wei",
    "every charge that has landed for this creator, summed",
    withProvenance(ledger),
  );
}

/** Charged money split by where it currently sits: settled out of the vault
 *  (private pool claim or public claim) versus still claimable inside it.
 *  The vault's own accounting means the two must add up to gross. */
export function settledVsUnsettled(ledger) {
  const settledPrivateWei = sum(ledger.claims.map((c) => c.amountWei));
  const settledPublicWei = sum(ledger.claimsPublic.map((c) => c.amountWei));
  const settledWei = settledPrivateWei + settledPublicWei;
  const unreadable = ledger.creators.filter(
    (c) => c.claimableWei === null || c.claimableWei === undefined,
  ).length;
  const unsettledWei = sum(
    ledger.creators.map((c) => (c.claimableWei === null || c.claimableWei === undefined ? 0n : c.claimableWei)),
  );
  const grossWei = sum(ledger.charges.map((c) => c.amountWei));
  const deltaWei = settledWei + unsettledWei - grossWei;
  const holds = deltaWei === 0n;
  const inconclusive = unreadable > 0 || ledger.provenance.truncated;
  return metric(
    {
      settledWei,
      settledPrivateWei,
      settledPublicWei,
      unsettledWei,
      grossWei,
      invariant: { holds, deltaWei },
    },
    "wei",
    "settled = what has been claimed out of the vault; unsettled = what it still owes. Charges move money into the owed balance and claims move it out, so settled + unsettled must equal gross",
    withProvenance(
      ledger,
      inconclusive
        ? "the check is inconclusive here: a read failed or a scan stopped short, so a mismatch may be a missing input rather than a real gap"
        : holds
          ? undefined
          : "the totals do not reconcile, which means this ledger is missing charges or claims for these ids",
    ),
  );
}

const contractedWei = (c) => {
  if (c.tierPriceWei === null || c.tierPriceWei === undefined) return null;
  const n = c.schedule ? c.schedule.nPeriods : c.nPeriodsAtSubscribe;
  return c.tierPriceWei * BigInt(n);
};

/** Mean value a subscription was signed up for, across every commitment seen.
 *  This is what was contracted, not what was collected. */
export function committedLtv(ledger) {
  const values = ledger.commitments.map(contractedWei).filter((v) => v !== null);
  const value = values.length === 0 ? 0n : sum(values) / BigInt(values.length);
  return metric(
    value,
    "wei",
    "tier price * number of periods, averaged over every subscription in this ledger",
    withProvenance(
      ledger,
      values.length === 0
        ? "no subscription has a readable tier price, so this is zero rather than an average"
        : "contracted, not collected: a cancel before the last period leaves part of this unearned and reclaimable",
    ),
  );
}

/** Mean actually charged, over terminated commitments only. Live subscriptions
 *  are excluded on purpose: including a subscription that is one period into a
 *  twelve-period schedule drags the mean toward zero and calls it churn. */
export function realizedLtv(ledger) {
  const terminated = ledger.commitments.filter(isTerminated);
  const byCommitment = new Map();
  for (const ch of ledger.charges) {
    byCommitment.set(ch.commitment, (byCommitment.get(ch.commitment) ?? 0n) + ch.amountWei);
  }
  const totals = terminated.map((c) => byCommitment.get(c.commitment) ?? 0n);
  const value = totals.length === 0 ? 0n : sum(totals) / BigInt(totals.length);
  return metric(
    value,
    "wei",
    "what was actually collected, averaged over subscriptions that have ended by cancellation or completion",
    withProvenance(
      ledger,
      totals.length === 0
        ? "no subscription has ended yet, so there is nothing to average and this is zero"
        : `averaged over ${totals.length} ended subscription(s); live ones are excluded`,
    ),
  );
}

/** Escrow that went back to subscribers instead of becoming a charge. */
export function refundLeakage(ledger) {
  return metric(
    sum(ledger.reclaims.map((r) => r.amountWei)),
    "wei",
    "every refund subscribers took back, summed",
    withProvenance(
      ledger,
      "reclaim pays out the whole remaining escrow, including any period that was due but never charged; that period is forfeited to the subscriber by design",
    ),
  );
}

/** Commitments per (creator, tier). Tier is an index into one creator's
 *  ladder, so it is meaningless without the creator it indexes into. */
export function tierMix(ledger) {
  const buckets = new Map();
  for (const c of ledger.commitments) {
    if (!c.schedule) continue;
    const key = `${c.schedule.creatorId}#${c.schedule.tier}`;
    const row = buckets.get(key) ?? {
      creatorId: c.schedule.creatorId,
      tier: c.schedule.tier,
      count: 0,
      priceWei: c.tierPriceWei ?? null,
    };
    row.count += 1;
    buckets.set(key, row);
  }
  const value = [...buckets.values()].sort(
    (a, b) => b.count - a.count || a.tier - b.tier,
  );
  const noSchedule = ledger.commitments.filter((c) => !c.schedule).length;
  return metric(
    value,
    "commitments per tier",
    "how many subscriptions sit at each tier, per creator",
    withProvenance(
      ledger,
      noSchedule > 0 ? `${noSchedule} subscription(s) could not be read` : undefined,
    ),
  );
}

const cadenceLabel = (periodBlocks) => {
  if (periodBlocks === PERIOD_HOUR) return "hour";
  if (periodBlocks === PERIOD_DAY) return "day";
  if (periodBlocks === PERIOD_WEEK) return "week";
  return "off-ladder";
};

/** Commitments per billing cadence. The vault refuses any period_blocks off
 *  the three-rung ladder, so an "off-ladder" bucket means a decode problem. */
export function cadenceMix(ledger) {
  const buckets = new Map();
  for (const c of ledger.commitments) {
    if (!c.schedule) continue;
    const pb = c.schedule.periodBlocks;
    const row = buckets.get(pb) ?? { periodBlocks: pb, label: cadenceLabel(pb), count: 0 };
    row.count += 1;
    buckets.set(pb, row);
  }
  const value = [...buckets.values()].sort((a, b) => a.periodBlocks - b.periodBlocks);
  const offLadder = value.filter((r) => r.label === "off-ladder").length;
  return metric(
    value,
    "commitments per cadence",
    "how many subscriptions bill hourly, daily and weekly",
    withProvenance(
      ledger,
      offLadder > 0
        ? "a period length appeared that the vault does not accept, so treat it as a read error"
        : undefined,
    ),
  );
}

/** Gate admissions recorded on chain for these commitments. */
export function presentationsToDate(ledger) {
  const distinctCommitments = new Set(ledger.presentations.map((p) => p.commitment)).size;
  const distinctVerifiers = new Set(ledger.presentations.map((p) => p.verifierId)).size;
  return metric(
    { total: ledger.presentations.length, distinctCommitments, distinctVerifiers },
    "presentations",
    "how many times a subscription proved its tier at the on-chain gate",
    withProvenance(
      ledger,
      "proving a tier reveals the subscription id, so repeat proofs of one subscription are linkable to each other - never to the subscriber",
    ),
  );
}

/** Who fires the charges, and how promptly. A charge cannot land before its
 *  due height (the vault asserts it), so lateness is the only direction. */
export function keeperHealth(ledger, opts = {}) {
  const toleranceBlocks =
    opts.toleranceBlocks === undefined
      ? DEFAULT_KEEPER_TOLERANCE_BLOCKS
      : opts.toleranceBlocks;
  const scheduleOf = new Map(
    ledger.commitments.filter((c) => c.schedule).map((c) => [c.commitment, c.schedule]),
  );
  const chargers = new Set(ledger.charges.map((c) => c.by));
  let onTime = 0;
  let late = 0;
  let unscheduled = 0;
  let worstLatenessBlocks = 0;
  for (const ch of ledger.charges) {
    const s = scheduleOf.get(ch.commitment);
    if (!s) {
      unscheduled += 1;
      continue;
    }
    const dueAt = s.startBlock + s.periodBlocks * ch.periodIndex;
    const lateness = ch.block - dueAt;
    if (lateness > worstLatenessBlocks) worstLatenessBlocks = lateness;
    if (lateness <= toleranceBlocks) onTime += 1;
    else late += 1;
  }
  const measured = onTime + late;
  return metric(
    {
      chargers: chargers.size,
      addresses: [...chargers],
      onTime,
      late,
      onTimeRate: measured === 0 ? null : onTime / measured,
      worstLatenessBlocks,
      toleranceBlocks,
    },
    "charges, ratio",
    `a charge counts as on time when it lands within ${toleranceBlocks} blocks of the moment its period came due`,
    withProvenance(
      ledger,
      unscheduled > 0
        ? `${unscheduled} charge(s) had no readable schedule and are excluded from the rate`
        : undefined,
    ),
  );
}

/** Everything above, in one object. */
export function allMetrics(ledger, opts = {}) {
  return {
    activeSubscriptions: activeSubscriptions(ledger),
    currentlyEntitled: currentlyEntitled(ledger),
    arrears: arrears(ledger),
    escrowedRunRate30d: escrowedRunRate30d(ledger),
    contractedRemaining: contractedRemaining(ledger),
    grossRevenue: grossRevenue(ledger),
    settledVsUnsettled: settledVsUnsettled(ledger),
    committedLtv: committedLtv(ledger),
    realizedLtv: realizedLtv(ledger),
    refundLeakage: refundLeakage(ledger),
    tierMix: tierMix(ledger),
    cadenceMix: cadenceMix(ledger),
    presentationsToDate: presentationsToDate(ledger),
    keeperHealth: keeperHealth(ledger, opts.keeper ?? {}),
  };
}
