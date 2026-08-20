// Unit tests for the per-transaction verdict. Fixture objects only, no network.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { declaredFelts, toFelt, transactionVerdict, unwrapReceipt } from "../src/verdict.mjs";

const VAULT = "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
const VAULT_PADDED = "0x0277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
const OTHER = "0x1f653f21e557e70384c8631f9c8f97e0342aa1d5e975bdcaca76bbf8715f338";

const receipt = (over = {}) => ({ execution_status: "SUCCEEDED", events: [], ...over });
const tx = (over = {}) => ({ calldata: [], ...over });

test("toFelt parses hex and rejects junk", () => {
  assert.equal(toFelt("0x10"), 16n);
  assert.equal(toFelt(16), 16n);
  assert.equal(toFelt("not a felt"), null);
  assert.equal(toFelt(null), null);
  assert.equal(toFelt({ address: "0x1" }), null);
});

test("declaredFelts accepts strings and {address} objects, drops the rest", () => {
  assert.deepEqual(declaredFelts([VAULT, { address: OTHER }, {}, null, 7]), [
    BigInt(VAULT),
    BigInt(OTHER),
  ]);
  assert.deepEqual(declaredFelts(undefined), []);
});

test("unwrapReceipt unwraps one level of .value", () => {
  const inner = receipt();
  assert.equal(unwrapReceipt({ value: inner }), inner);
  assert.equal(unwrapReceipt(inner), inner);
});

test("no contracts declared: SUCCEEDED is enough", () => {
  const v = transactionVerdict(receipt(), tx(), []);
  assert.equal(v.pass, true);
  assert.equal(v.code, "succeeded");
  assert.equal(v.mineRule, false);
});

test("reverted transactions fail with the execution status and the revert reason", () => {
  const v = transactionVerdict(
    receipt({ execution_status: "REVERTED", revert_reason: "Error at pc=0:42\ninsufficient balance" }),
    tx(),
    [],
  );
  assert.equal(v.pass, false);
  assert.equal(v.code, "not_succeeded");
  assert.match(v.reason, /execution_status=REVERTED/);
  assert.match(v.reason, /Error at pc=0:42/);
});

test("a missing receipt fails rather than passing by accident", () => {
  const v = transactionVerdict(null, tx(), [VAULT]);
  assert.equal(v.pass, false);
  assert.equal(v.code, "no_receipt");
});

test("an event from a declared contract routes the transaction", () => {
  const v = transactionVerdict(
    receipt({ events: [{ from_address: "0xdead" }, { from_address: VAULT }] }),
    tx(),
    [VAULT],
  );
  assert.equal(v.pass, true);
  assert.equal(v.code, "routed_event");
});

test("a declared address in the calldata routes the transaction", () => {
  const v = transactionVerdict(receipt(), tx({ calldata: ["0x1", VAULT, "0x0"] }), [{ address: VAULT }]);
  assert.equal(v.pass, true);
  assert.equal(v.code, "routed_calldata");
});

test("0x0 padding does not change the match", () => {
  const v = transactionVerdict(receipt({ events: [{ from_address: VAULT_PADDED }] }), tx(), [VAULT]);
  assert.equal(v.pass, true);
});

test("mine-rule: a succeeded transaction that touches no declared contract fails", () => {
  const v = transactionVerdict(
    receipt({ events: [{ from_address: "0xbeef" }] }),
    tx({ calldata: ["0x1", "0x2"] }),
    [VAULT, OTHER],
  );
  assert.equal(v.pass, false);
  assert.equal(v.code, "not_routed");
  assert.equal(v.mineRule, true);
  assert.match(v.reason, /mine-rule/);
});

test("a wrapped receipt is read the same way as a bare one", () => {
  const v = transactionVerdict({ value: receipt({ events: [{ from_address: VAULT }] }) }, tx(), [VAULT]);
  assert.equal(v.pass, true);
});

test("declared contracts already reduced to BigInt are accepted", () => {
  const v = transactionVerdict(receipt({ events: [{ from_address: VAULT }] }), tx(), [BigInt(VAULT)]);
  assert.equal(v.pass, true);
});
