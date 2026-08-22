// node --test smoke for the ported metrics module. metrics.mjs is plain JS
// on purpose (see its own header comment) so this runs with zero build step
// and zero dependency, exactly like site's copy did before the port.
import assert from "node:assert/strict";
import { test } from "node:test";

import { grossRevenue, PERIOD_DAY } from "../src/lib/creator/metrics.mjs";

test("grossRevenue sums the amount field over every charge in the fixture", () => {
  const ledger = {
    creators: [],
    commitments: [],
    charges: [
      { block: 100, txHash: "0x1", commitment: "0x1", periodIndex: 0, amountWei: 10n, by: "0xa" },
      { block: 200, txHash: "0x2", commitment: "0x1", periodIndex: 1, amountWei: 25n, by: "0xa" },
    ],
    claims: [],
    claimsPublic: [],
    cancels: [],
    reclaims: [],
    presentations: [],
    headBlock: 200,
    provenance: { source: "rpc", truncated: false, partial: [] },
  };

  const metric = grossRevenue(ledger);

  assert.equal(metric.value, 35n);
  assert.equal(metric.unit, "wei");
  assert.equal(metric.caveat, undefined);
});

test("PERIOD_DAY matches the vault's block ladder", () => {
  assert.equal(PERIOD_DAY, 50_400);
});
