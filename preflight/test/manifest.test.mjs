// Offline checks against the manifest text.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAX_INDEXED_TX, inspectManifest } from "../src/manifest.mjs";

const VAULT = "0x277519c8bc1031188313de4528d1f0159319f8f86651422e89b6fbd920b3759";
const hash = (n) => `0x${n.toString(16).padStart(63, "0")}`;

const valid = {
  contracts: [VAULT],
  transactions: [hash(1), hash(2), hash(3)],
  demo_video: "https://example.com/demo.mp4",
  demo_url: "https://example.com",
};

const inspect = (obj) => inspectManifest(JSON.stringify(obj));
const find = (result, id) => result.checks.find((c) => c.id === id);

test("a valid manifest passes with no failures", () => {
  const result = inspect(valid);
  assert.equal(result.ok, true);
  assert.equal(result.fatal, false);
  assert.equal(find(result, "json").level, "pass");
  assert.equal(find(result, "transactions").level, "pass");
  assert.equal(find(result, "contracts").level, "pass");
  assert.equal(find(result, "demo_video").level, "pass");
  assert.equal(find(result, "demo_url").level, "pass");
  assert.deepEqual(result.contracts, [VAULT]);
  assert.equal(result.txsRead.length, 3);
});

test("invalid JSON is fatal and says the whole file is ignored", () => {
  const result = inspectManifest('{ "transactions": [ }');
  assert.equal(result.ok, false);
  assert.equal(result.fatal, true);
  assert.equal(result.checks.length, 1);
  assert.match(result.checks[0].message, /ignores the ENTIRE file/);
});

test("a top-level array is fatal too", () => {
  const result = inspectManifest("[1, 2, 3]");
  assert.equal(result.fatal, true);
  assert.equal(find(result, "json").level, "fail");
});

test("non-string transaction entries are flagged with their index", () => {
  const result = inspect({
    ...valid,
    transactions: [hash(1), { hash: hash(2) }, 42, [hash(3)], "0xzz"],
  });
  const check = find(result, "transactions");
  assert.equal(check.level, "fail");
  assert.match(check.message, /\[1\] an object/);
  assert.match(check.message, /\[2\] number 42/);
  assert.match(check.message, /\[3\] a nested array/);
  assert.match(check.message, /\[4\] the string "0xzz"/);
  assert.equal(result.ok, false);
  assert.deepEqual(result.txsRead, [hash(1)]);
});

test("more than ten transactions warns and names the ignored ones", () => {
  const transactions = Array.from({ length: 13 }, (_, i) => hash(i + 1));
  const result = inspect({ ...valid, transactions });
  const check = find(result, "transactions_limit");
  assert.equal(check.level, "warn");
  assert.match(check.message, /3 listed after them are ignored/);
  assert.match(check.message, new RegExp(hash(11)));
  assert.equal(result.txsRead.length, MAX_INDEXED_TX);
  assert.deepEqual(result.txsIgnored, [hash(11), hash(12), hash(13)]);
  assert.equal(result.ok, true, "an over-long list is a warning, not a failure");
});

test("object-form contracts are accepted", () => {
  const result = inspect({ ...valid, contracts: [{ address: VAULT }, "0x1"] });
  assert.equal(find(result, "contracts").level, "pass");
  assert.deepEqual(result.contracts, [VAULT, "0x1"]);
  assert.equal(result.ok, true);
});

test("a contracts entry with no address fails", () => {
  const result = inspect({ ...valid, contracts: [{ name: "vault" }] });
  const check = find(result, "contracts");
  assert.equal(check.level, "fail");
  assert.match(check.message, /\[0\] an object/);
});

test("a declared address that is not a felt warns", () => {
  const result = inspect({ ...valid, contracts: [{ address: "vault.cairo" }] });
  assert.equal(find(result, "contracts_format").level, "warn");
});

test("declared contracts raise the mine-rule warning", () => {
  const result = inspect(valid);
  const check = find(result, "mine_rule");
  assert.equal(check.level, "warn");
  assert.match(check.message, /MINE-RULE/);
  assert.match(check.message, /only counts when it runs through/);
  assert.match(check.message, /scoring zero transactions/);
});

test("no declared contracts means no mine-rule warning", () => {
  const result = inspect({ ...valid, contracts: [] });
  assert.equal(find(result, "mine_rule"), undefined);
  assert.equal(find(result, "contracts").level, "info");
});

test("an empty demo_video warns about finished status", () => {
  const result = inspect({ ...valid, demo_video: "" });
  const check = find(result, "demo_video");
  assert.equal(check.level, "warn");
  assert.match(check.message, /cannot reach finished status/);
  assert.equal(result.ok, true, "a missing demo video is a warning, not a failure");
});

test("a non-string demo_video fails", () => {
  const result = inspect({ ...valid, demo_video: { url: "https://example.com" } });
  assert.equal(find(result, "demo_video").level, "fail");
  assert.equal(result.ok, false);
});

test("a non-string demo_url fails and an absent one is a note", () => {
  assert.equal(find(inspect({ ...valid, demo_url: 7 }), "demo_url").level, "fail");
  const { demo_url, ...withoutUrl } = valid;
  assert.equal(find(inspect(withoutUrl), "demo_url").level, "info");
});

test("transactions as an object is a failure, not a crash", () => {
  const result = inspect({ ...valid, transactions: { first: hash(1) } });
  assert.equal(find(result, "transactions").level, "fail");
  assert.deepEqual(result.txsRead, []);
});
