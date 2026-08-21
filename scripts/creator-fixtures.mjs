// Hand-built CreatorLedger fixtures for scripts/creator-metrics.test.mjs.
//
// Every schedule here is internally consistent with what the vault would
// actually store: a charge exists for each period below next_period, its block
// is at or after start_block + period_blocks * period_index (the vault asserts
// that), escrow equals tier price times the periods left, and cancelled
// commitments have had their remainder reclaimed.
//
// The cases, one per shape the metrics have to get right:
//   C1 active        funded, paid through the current block
//   C2 cancelled     escrow reclaimed, terminated, never charges again
//   C3 exhausted     every period charged, paid window already elapsed
//   C4 arrears       funded but behind, with one keeper charge past tolerance
//   C5 final period  n_periods = 1, fully paid, so is_active is FALSE while the
//                    gate still admits it. The case that catches anyone who
//                    reaches for is_active as an entitlement test.

const STRK = 10n ** 18n;
export const wei = (n) => BigInt(n) * STRK;

export const PERIOD_DAY = 50400;
export const PERIOD_WEEK = 352800;

export const CREATOR_A = "0x0a";
export const CREATOR_B = "0x0b";
export const KEEPER = "0xkeeper0001";
export const SUBSCRIBER = "0x5ub0001";
export const VERIFIER = "0xd00r0001";

export const HEAD_BLOCK = 1_000_000;

const schedule = (o) => ({
  creatorId: o.creatorId,
  tier: o.tier,
  periodBlocks: o.periodBlocks,
  startBlock: o.startBlock,
  nPeriods: o.nPeriods,
  escrowWei: o.escrowWei,
  nextPeriod: o.nextPeriod,
  cancelled: o.cancelled ?? false,
});

const commitment = (o) => ({
  commitment: o.commitment,
  creatorId: o.creatorId,
  nPeriodsAtSubscribe: o.nPeriods,
  block: o.startBlock,
  txHash: `${o.commitment}_sub`,
  schedule: schedule(o),
  periodsDue: o.periodsDue,
  tierPriceWei: o.tierPriceWei,
  token: "0x57rk",
});

const charge = (commitmentId, periodIndex, amountWei, block, by = KEEPER) => ({
  commitment: commitmentId,
  periodIndex,
  amountWei,
  by,
  block,
  txHash: `${commitmentId}_charge_${periodIndex}`,
});

// --- the five commitments --------------------------------------------------

const C1 = commitment({
  commitment: "0xc1",
  creatorId: CREATOR_A,
  tier: 1,
  periodBlocks: PERIOD_DAY,
  startBlock: 900_000,
  nPeriods: 12,
  nextPeriod: 2,
  escrowWei: wei(100), // 10 periods left at 10
  tierPriceWei: wei(10),
  periodsDue: 0, // next due at 900,000 + 50,400*2 = 1,000,800, past head
});

const C2 = commitment({
  commitment: "0xc2",
  creatorId: CREATOR_A,
  tier: 1,
  periodBlocks: PERIOD_DAY,
  startBlock: 800_000,
  nPeriods: 6,
  nextPeriod: 1,
  escrowWei: 0n, // reclaimed after cancel
  cancelled: true,
  tierPriceWei: wei(10),
  periodsDue: 0, // the vault returns 0 for a cancelled schedule
});

const C3 = commitment({
  commitment: "0xc3",
  creatorId: CREATOR_A,
  tier: 0,
  periodBlocks: PERIOD_DAY,
  startBlock: 700_000,
  nPeriods: 2,
  nextPeriod: 2,
  escrowWei: 0n,
  tierPriceWei: wei(5),
  periodsDue: 0, // the vault returns 0 once next_period reaches n_periods
});

const C4 = commitment({
  commitment: "0xc4",
  creatorId: CREATOR_A,
  tier: 1,
  periodBlocks: PERIOD_DAY,
  startBlock: 600_000,
  nPeriods: 12,
  nextPeriod: 3,
  escrowWei: wei(90),
  tierPriceWei: wei(10),
  periodsDue: 5, // behind: periods 3..7 are all past due at head
});

const C5 = commitment({
  commitment: "0xc5",
  creatorId: CREATOR_A,
  tier: 2,
  periodBlocks: PERIOD_WEEK,
  startBlock: 980_000,
  nPeriods: 1,
  nextPeriod: 1,
  escrowWei: 0n,
  tierPriceWei: wei(7),
  periodsDue: 0,
});

// --- the charge history ----------------------------------------------------
// Nine charges. Eight land within the keeper tolerance; C4's period 2 is
// 4,200 blocks late, which is past the 2,100-block default.

const CHARGES = [
  charge("0xc1", 0, wei(10), 900_000),
  charge("0xc1", 1, wei(10), 950_500),
  charge("0xc2", 0, wei(10), 800_000),
  charge("0xc3", 0, wei(5), 700_000),
  charge("0xc3", 1, wei(5), 750_500),
  charge("0xc4", 0, wei(10), 600_000),
  charge("0xc4", 1, wei(10), 650_500),
  charge("0xc4", 2, wei(10), 705_000), // due at 700,800: late by 4,200
  charge("0xc5", 0, wei(7), 980_000, SUBSCRIBER),
];

// Gross charged: 20 + 10 + 10 + 30 + 7 = 77 STRK.
// Settled: 40 private + 10 public = 50. Unsettled claimable: 27. 50 + 27 = 77.

/** The main fixture: five commitments, one creator, invariant holding. */
export function mixedLedger(overrides = {}) {
  return {
    creators: [
      { creatorId: CREATOR_A, claimableWei: wei(27), claimPubNonce: 1n },
    ],
    commitments: [C1, C2, C3, C4, C5],
    charges: CHARGES,
    claims: [
      { creatorId: CREATOR_A, amountWei: wei(25), block: 760_000, txHash: "0xclaim1" },
      { creatorId: CREATOR_A, amountWei: wei(15), block: 900_500, txHash: "0xclaim2" },
    ],
    claimsPublic: [
      {
        creatorId: CREATOR_A,
        to: "0xpayout",
        amountWei: wei(10),
        block: 940_000,
        txHash: "0xclaimpub1",
      },
    ],
    cancels: [{ commitment: "0xc2", block: 850_000, txHash: "0xc2_cancel" }],
    reclaims: [
      { commitment: "0xc2", amountWei: wei(50), block: 850_100, txHash: "0xc2_reclaim" },
    ],
    presentations: [
      presentation("0xc1", CREATOR_A, 1, 999_000),
      presentation("0xc1", CREATOR_A, 1, 999_500),
      presentation("0xc5", CREATOR_A, 2, 999_900),
    ],
    headBlock: HEAD_BLOCK,
    provenance: { source: "rpc", truncated: false, partial: [] },
    ...overrides,
  };
}

function presentation(commitmentId, creatorId, tier, block) {
  return {
    commitment: commitmentId,
    verifierId: VERIFIER,
    expiryBlock: block + 100,
    creatorId,
    tier,
    block,
    txHash: `${commitmentId}_present_${block}`,
  };
}

/** A creator who registered and has no subscribers yet. Every metric has to
 *  answer zero without dividing by it. */
export function zeroCommitmentLedger() {
  return {
    creators: [{ creatorId: CREATOR_B, claimableWei: 0n, claimPubNonce: 0n }],
    commitments: [],
    charges: [],
    claims: [],
    claimsPublic: [],
    cancels: [],
    reclaims: [],
    presentations: [],
    headBlock: HEAD_BLOCK,
    provenance: { source: "rpc", truncated: false, partial: [] },
  };
}

/** The same history with one charge missing from the scan, which is exactly
 *  what a silently truncated getEvents page looks like. The invariant is the
 *  detector: settled + unsettled no longer equals gross. */
export function brokenInvariantLedger() {
  const base = mixedLedger();
  return { ...base, charges: base.charges.slice(0, -1) };
}

/** A ledger whose scan hit its page cap. Every caveat has to say so. */
export function truncatedLedger() {
  return mixedLedger({
    provenance: {
      source: "rpc",
      truncated: true,
      partial: ["Charged: page cap hit after 20 pages"],
    },
  });
}

/** Just the final-period case, isolated: n_periods = 1, fully charged. The
 *  vault's is_active is false here and the gate still admits. */
export function finalPeriodLedger() {
  return {
    creators: [{ creatorId: CREATOR_A, claimableWei: wei(7), claimPubNonce: 0n }],
    commitments: [C5],
    charges: [charge("0xc5", 0, wei(7), 980_000, SUBSCRIBER)],
    claims: [],
    claimsPublic: [],
    cancels: [],
    reclaims: [],
    presentations: [],
    headBlock: HEAD_BLOCK,
    provenance: { source: "rpc", truncated: false, partial: [] },
  };
}

export const COMMITMENTS = { C1, C2, C3, C4, C5 };
