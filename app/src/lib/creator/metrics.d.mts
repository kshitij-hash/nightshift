// Type surface for metrics.mjs.
//
// The math is plain JS so `node --test` can import it with no build step and no
// dependency; this file is what the Vite/TS side sees. Hand-written and kept in
// step with metrics.mjs by review, since tsc does not read the .mjs.

import type { CommitmentRecord, CreatorLedger, Felt, Schedule } from "./ledger";

export declare const PERIOD_HOUR: number;
export declare const PERIOD_DAY: number;
export declare const PERIOD_WEEK: number;
export declare const BLOCKS_PER_30D: number;
export declare const DEFAULT_KEEPER_TOLERANCE_BLOCKS: number;

/** Every metric carries its own label, its rule, and anything that weakens it. */
export type Metric<V> = {
  value: V;
  unit: string;
  basis: string;
  caveat?: string;
};

export declare function isFunded(c: CommitmentRecord): boolean;
export declare function isEntitled(c: CommitmentRecord, headBlock: number): boolean;
export declare function isTerminated(c: CommitmentRecord): boolean;

export declare function activeSubscriptions(ledger: CreatorLedger): Metric<number>;
export declare function currentlyEntitled(ledger: CreatorLedger): Metric<number>;

export declare function arrears(
  ledger: CreatorLedger,
): Metric<{ count: number; maxPeriodsDue: number }>;

export declare function escrowedRunRate30d(ledger: CreatorLedger): Metric<bigint>;
export declare function contractedRemaining(ledger: CreatorLedger): Metric<bigint>;
export declare function grossRevenue(ledger: CreatorLedger): Metric<bigint>;

export type SettlementSplit = {
  settledWei: bigint;
  settledPrivateWei: bigint;
  settledPublicWei: bigint;
  unsettledWei: bigint;
  grossWei: bigint;
  invariant: { holds: boolean; deltaWei: bigint };
};
export declare function settledVsUnsettled(
  ledger: CreatorLedger,
): Metric<SettlementSplit>;

export declare function committedLtv(ledger: CreatorLedger): Metric<bigint>;
export declare function realizedLtv(ledger: CreatorLedger): Metric<bigint>;
export declare function refundLeakage(ledger: CreatorLedger): Metric<bigint>;

export type TierBucket = {
  creatorId: Felt;
  tier: number;
  count: number;
  priceWei: bigint | null;
};
export declare function tierMix(ledger: CreatorLedger): Metric<TierBucket[]>;

export type CadenceBucket = {
  periodBlocks: number;
  label: "hour" | "day" | "week" | "off-ladder";
  count: number;
};
export declare function cadenceMix(ledger: CreatorLedger): Metric<CadenceBucket[]>;

export declare function presentationsToDate(
  ledger: CreatorLedger,
): Metric<{ total: number; distinctCommitments: number; distinctVerifiers: number }>;

export type KeeperHealth = {
  chargers: number;
  addresses: Felt[];
  onTime: number;
  late: number;
  /** null when no charge could be measured against a schedule. */
  onTimeRate: number | null;
  worstLatenessBlocks: number;
  toleranceBlocks: number;
};
export declare function keeperHealth(
  ledger: CreatorLedger,
  opts?: { toleranceBlocks?: number },
): Metric<KeeperHealth>;

export declare function allMetrics(
  ledger: CreatorLedger,
  opts?: { keeper?: { toleranceBlocks?: number } },
): {
  activeSubscriptions: Metric<number>;
  currentlyEntitled: Metric<number>;
  arrears: Metric<{ count: number; maxPeriodsDue: number }>;
  escrowedRunRate30d: Metric<bigint>;
  contractedRemaining: Metric<bigint>;
  grossRevenue: Metric<bigint>;
  settledVsUnsettled: Metric<SettlementSplit>;
  committedLtv: Metric<bigint>;
  realizedLtv: Metric<bigint>;
  refundLeakage: Metric<bigint>;
  tierMix: Metric<TierBucket[]>;
  cadenceMix: Metric<CadenceBucket[]>;
  presentationsToDate: Metric<{
    total: number;
    distinctCommitments: number;
    distinctVerifiers: number;
  }>;
  keeperHealth: Metric<KeeperHealth>;
};

export type { CommitmentRecord, CreatorLedger, Schedule };
