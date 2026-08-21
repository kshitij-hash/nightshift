#!/usr/bin/env node --test
// Tests for the creator metric math. Plain `node --test`, no dependency, no
// build step: the arithmetic lives in site/src/lib/creator/metrics.mjs as JS
// precisely so this file can import it directly.
//
//   node --test scripts/creator-metrics.test.mjs
//
// The cases that matter most:
//   - the final fully-paid period, where vault.is_active is false and the gate
//     still admits. Any metric that reaches for is_active fails here.
//   - the settled + unsettled == gross invariant, which is the detector for a
//     scan that dropped events.
//   - a creator with zero commitments, where the mean metrics must not divide
//     by zero.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeSubscriptions,
  allMetrics,
  arrears,
  cadenceMix,
  committedLtv,
  contractedRemaining,
  currentlyEntitled,
  escrowedRunRate30d,
  grossRevenue,
  isEntitled,
  isFunded,
  isTerminated,
  keeperHealth,
  presentationsToDate,
  realizedLtv,
  refundLeakage,
  settledVsUnsettled,
  tierMix,
} from "../site/src/lib/creator/metrics.mjs";

import {
  COMMITMENTS,
  HEAD_BLOCK,
  brokenInvariantLedger,
  finalPeriodLedger,
  mixedLedger,
  truncatedLedger,
  wei,
  zeroCommitmentLedger,
} from "./creator-fixtures.mjs";

describe("commitment predicates", () => {
  it("counts a funded, running subscription as funded", () => {
    assert.equal(isFunded(COMMITMENTS.C1), true);
    assert.equal(isEntitled(COMMITMENTS.C1, HEAD_BLOCK), true);
    assert.equal(isTerminated(COMMITMENTS.C1), false);
  });

  it("treats a cancelled subscription as terminated and not entitled", () => {
    assert.equal(isFunded(COMMITMENTS.C2), false);
    assert.equal(isEntitled(COMMITMENTS.C2, HEAD_BLOCK), false);
    assert.equal(isTerminated(COMMITMENTS.C2), true);
  });

  it("treats an exhausted schedule past its paid window as lapsed", () => {
    assert.equal(isFunded(COMMITMENTS.C3), false);
    assert.equal(isEntitled(COMMITMENTS.C3, HEAD_BLOCK), false);
    assert.equal(isTerminated(COMMITMENTS.C3), true);
  });

  it("keeps a subscription in arrears funded but not entitled", () => {
    assert.equal(isFunded(COMMITMENTS.C4), true);
    assert.equal(isEntitled(COMMITMENTS.C4, HEAD_BLOCK), false);
  });

  it("admits the final fully-paid period even though is_active is false", () => {
    const c5 = COMMITMENTS.C5;
    // is_active, verbatim from vault.cairo: next_period < n_periods.
    const isActive = c5.schedule.nextPeriod < c5.schedule.nPeriods;
    assert.equal(isActive, false, "the vault would report this one as inactive");
    assert.equal(isEntitled(c5, HEAD_BLOCK), true, "the gate still admits it");
    assert.equal(isFunded(c5), false);
    assert.equal(isTerminated(c5), true);
  });
});

describe("counts", () => {
  const ledger = mixedLedger();

  it("counts only funded subscriptions as active", () => {
    const m = activeSubscriptions(ledger);
    assert.equal(m.value, 2); // C1 and C4
    assert.equal(m.unit, "subscriptions");
    assert.ok(m.basis.includes("escrow >= tier price"));
  });

  it("counts entitlement by the gate rule, not by is_active", () => {
    const m = currentlyEntitled(ledger);
    assert.equal(m.value, 2); // C1 and C5, and C5 is is_active false
    assert.ok(m.caveat.includes("final fully-paid period"));
  });

  it("reports the arrears count and the worst backlog", () => {
    const m = arrears(ledger);
    assert.deepEqual(m.value, { count: 1, maxPeriodsDue: 5 });
  });

  it("counts presentations and the distinct doors they went to", () => {
    const m = presentationsToDate(ledger);
    assert.equal(m.value.total, 3);
    assert.equal(m.value.distinctCommitments, 2);
    assert.equal(m.value.distinctVerifiers, 1);
    // The linkability caveat is not optional copy: it is what the chain shows.
    assert.ok(m.caveat.includes("linkable"));
  });
});

describe("money", () => {
  const ledger = mixedLedger();

  it("sums every charge into gross", () => {
    assert.equal(grossRevenue(ledger).value, wei(77));
  });

  it("sums escrow over funded subscriptions only", () => {
    assert.equal(contractedRemaining(ledger).value, wei(190)); // C1 100 + C4 90
  });

  it("projects a 30-day run rate from tier price and cadence", () => {
    // Both funded subs are daily at 10 STRK: 30 periods each in 1,512,000
    // blocks, so 300 + 300.
    assert.equal(escrowedRunRate30d(ledger).value, wei(600));
  });

  it("sums reclaimed escrow as refund leakage", () => {
    assert.equal(refundLeakage(ledger).value, wei(50));
  });

  it("averages committed value over every commitment", () => {
    // 120 + 60 + 10 + 120 + 7 = 317 over 5.
    assert.equal(committedLtv(ledger).value, (wei(317) / 5n));
  });

  it("averages realized value over terminated commitments only", () => {
    // C2 charged 10, C3 charged 10, C5 charged 7. Live subs are excluded.
    assert.equal(realizedLtv(ledger).value, wei(27) / 3n);
  });
});

describe("settled + unsettled == gross", () => {
  it("holds on a complete ledger", () => {
    const m = settledVsUnsettled(mixedLedger());
    assert.equal(m.value.grossWei, wei(77));
    assert.equal(m.value.settledWei, wei(50));
    assert.equal(m.value.settledPrivateWei, wei(40));
    assert.equal(m.value.settledPublicWei, wei(10));
    assert.equal(m.value.unsettledWei, wei(27));
    assert.equal(m.value.invariant.holds, true);
    assert.equal(m.value.invariant.deltaWei, 0n);
    assert.equal(m.caveat, undefined);
  });

  it("fails loudly when the scan dropped a charge", () => {
    const m = settledVsUnsettled(brokenInvariantLedger());
    assert.equal(m.value.invariant.holds, false);
    assert.equal(m.value.invariant.deltaWei, wei(7)); // the missing charge
    assert.ok(m.caveat.includes("missing charges or claims"));
  });

  it("says so when a truncated scan makes the check inconclusive", () => {
    const m = settledVsUnsettled(truncatedLedger());
    assert.ok(m.caveat.includes("inconclusive"));
    assert.ok(m.caveat.includes("page cap"));
  });
});

describe("histograms", () => {
  const ledger = mixedLedger();

  it("buckets tiers per creator, biggest first", () => {
    const rows = tierMix(ledger).value;
    assert.equal(rows.length, 3);
    assert.equal(rows[0].tier, 1);
    assert.equal(rows[0].count, 3);
    assert.equal(rows[0].priceWei, wei(10));
    assert.deepEqual(
      rows.map((r) => [r.tier, r.count]),
      [
        [1, 3],
        [0, 1],
        [2, 1],
      ],
    );
  });

  it("buckets cadence against the hour/day/week ladder", () => {
    const rows = cadenceMix(ledger).value;
    assert.deepEqual(
      rows.map((r) => [r.label, r.count]),
      [
        ["day", 4],
        ["week", 1],
      ],
    );
    assert.equal(rows.some((r) => r.label === "off-ladder"), false);
  });
});

describe("keeper health", () => {
  const ledger = mixedLedger();

  it("counts distinct chargers and the on-time rate at the default tolerance", () => {
    const m = keeperHealth(ledger);
    assert.equal(m.value.chargers, 2); // the keeper account and one subscriber
    assert.equal(m.value.onTime, 8);
    assert.equal(m.value.late, 1);
    assert.equal(m.value.onTimeRate, 8 / 9);
    assert.equal(m.value.worstLatenessBlocks, 4200);
    assert.equal(m.value.toleranceBlocks, 2100);
  });

  it("moves the line when the tolerance moves", () => {
    const strict = keeperHealth(ledger, { toleranceBlocks: 0 });
    // Five charges land exactly on their due block; four land after it.
    assert.equal(strict.value.onTime, 5);
    assert.equal(strict.value.late, 4);

    const loose = keeperHealth(ledger, { toleranceBlocks: 10_000 });
    assert.equal(loose.value.late, 0);
    assert.equal(loose.value.onTimeRate, 1);
  });
});

describe("a creator with no commitments", () => {
  const ledger = zeroCommitmentLedger();

  it("answers zero everywhere without dividing by zero", () => {
    assert.equal(activeSubscriptions(ledger).value, 0);
    assert.equal(currentlyEntitled(ledger).value, 0);
    assert.deepEqual(arrears(ledger).value, { count: 0, maxPeriodsDue: 0 });
    assert.equal(grossRevenue(ledger).value, 0n);
    assert.equal(contractedRemaining(ledger).value, 0n);
    assert.equal(escrowedRunRate30d(ledger).value, 0n);
    assert.equal(refundLeakage(ledger).value, 0n);
    assert.equal(committedLtv(ledger).value, 0n);
    assert.equal(realizedLtv(ledger).value, 0n);
    assert.equal(keeperHealth(ledger).value.onTimeRate, null);
    assert.deepEqual(tierMix(ledger).value, []);
    assert.deepEqual(cadenceMix(ledger).value, []);
  });

  it("says the means are empty rather than reporting a real zero", () => {
    assert.ok(committedLtv(ledger).caveat.includes("no commitment"));
    assert.ok(realizedLtv(ledger).caveat.includes("no commitment has terminated"));
  });

  it("keeps the invariant true at zero", () => {
    assert.equal(settledVsUnsettled(ledger).value.invariant.holds, true);
  });
});

describe("the final-period ledger on its own", () => {
  const ledger = finalPeriodLedger();

  it("shows zero active and one entitled at the same time", () => {
    assert.equal(activeSubscriptions(ledger).value, 0);
    assert.equal(currentlyEntitled(ledger).value, 1);
  });

  it("counts its one charge as realized, not committed-only", () => {
    assert.equal(grossRevenue(ledger).value, wei(7));
    assert.equal(realizedLtv(ledger).value, wei(7));
    assert.equal(committedLtv(ledger).value, wei(7));
  });
});

describe("provenance", () => {
  it("carries the truncation warning into every caveat", () => {
    const m = allMetrics(truncatedLedger());
    for (const [name, entry] of Object.entries(m)) {
      assert.ok(
        entry.caveat && entry.caveat.includes("page cap"),
        `${name} dropped the truncation warning`,
      );
    }
  });

  it("returns value, unit and basis on every metric", () => {
    const m = allMetrics(mixedLedger());
    for (const [name, entry] of Object.entries(m)) {
      assert.notEqual(entry.value, undefined, `${name} has no value`);
      assert.equal(typeof entry.unit, "string", `${name} has no unit`);
      assert.ok(entry.basis.length > 20, `${name} has no usable basis`);
    }
  });
});
