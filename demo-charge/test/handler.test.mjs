// End-to-end tests of the request rail, with the signer replaced by a stub.
// Nothing here opens a socket, imports starknet, or reads a key file.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Cooldowns, DailyBudget, PendingRegistry, parseWhitelist } from "../src/decide.mjs";
import { createHandler } from "../src/handler.mjs";

const DEMO = "0x3e4a525134a558e7fbabcd62895b879752274308ff618efdb2f20249c053c4a";
const OTHER = "0x357ba2895ba553afa1e565f3a2cbb9f39f470f09c6b63e1f23d32611379c6fe";
const CREATOR = "0x396c007ff97561b1eadf59540c71944f6ad2ccfbfc7116254f1a34d869205df";
const ONE_STRK = 10n ** 18n;
const START = 13_650_000n;

const config = (over = {}) => ({
  whitelist: parseWhitelist(DEMO).felts,
  cooldownS: 900,
  probeCooldownS: 5,
  maxPerDay: 24,
  secondsPerBlock: 1.7,
  settleWindowS: 300,
  ...over,
});

/**
 * A scripted chain: mutable schedule, a counted submit, an optional throw.
 * Same four methods as src/chain.mjs, which is the whole point of the seam.
 */
function stubChain(over = {}) {
  const s = {
    head: START,
    creatorId: BigInt(CREATOR),
    tier: 0n,
    periodBlocks: 2100n,
    startBlock: START,
    nPeriods: 24n,
    escrow: 24n * ONE_STRK,
    nextPeriod: 0n,
    cancelled: false,
    ...over,
  };
  const calls = { head: 0, schedule: 0, tierAmount: 0, submit: 0 };
  const chain = {
    state: s,
    calls,
    throwOnSubmit: null,
    beforeSubmit: null,
    async head() {
      calls.head += 1;
      return s.head;
    },
    async schedule() {
      calls.schedule += 1;
      const hex = (v) => `0x${BigInt(v).toString(16)}`;
      return [
        hex(s.creatorId), hex(s.tier), hex(s.periodBlocks), hex(s.startBlock),
        hex(s.nPeriods), hex(s.escrow), hex(s.nextPeriod), s.cancelled ? "0x1" : "0x0",
      ];
    },
    async tierAmount() {
      calls.tierAmount += 1;
      return ONE_STRK;
    },
    async submitCharge() {
      calls.submit += 1;
      if (chain.beforeSubmit) await chain.beforeSubmit();
      if (chain.throwOnSubmit) throw chain.throwOnSubmit;
      const tx = `0xfeed${calls.submit}`;
      s.nextPeriod += 1n;
      s.escrow -= ONE_STRK;
      return { txHash: tx };
    },
  };
  return chain;
}

const T0 = Date.UTC(2026, 7, 29, 12, 0, 0);

function harness(over = {}, chainOver = {}) {
  const chain = stubChain(chainOver);
  const cooldowns = new Cooldowns();
  const budget = new DailyBudget(over.maxPerDay ?? 24);
  const pending = new PendingRegistry();
  let clock = T0;
  const persisted = [];
  const handle = createHandler({
    config: config(over),
    chain,
    cooldowns,
    budget,
    pending,
    now: () => clock,
    persist: () => persisted.push(budget.snapshot()),
  });
  return {
    chain,
    cooldowns,
    budget,
    pending,
    persisted,
    handle,
    advance: (seconds) => (clock += seconds * 1000),
    at: (ms) => (clock = ms),
  };
}

// --- the happy path ---------------------------------------------------------

test("a due period on the whitelisted commitment submits one transaction", async () => {
  const h = harness();
  const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.deepEqual(res, {
    status: "submitted",
    tx_hash: "0xfeed1",
    voyager_url: "https://voyager.online/tx/0xfeed1",
  });
  assert.equal(h.chain.calls.submit, 1);
  assert.equal(h.budget.used(T0), 1);
  assert.equal(h.persisted.length, 1);
});

test("a padded commitment is the same subscription", async () => {
  const h = harness();
  const res = await h.handle({ commitment: `0x0${DEMO.slice(2)}`, ip: "1.1.1.1" });
  assert.equal(res.status, "submitted");
});

// --- whitelist --------------------------------------------------------------

test("an unlisted commitment is refused without reading the chain", async () => {
  const h = harness();
  const res = await h.handle({ commitment: OTHER, ip: "1.1.1.1" });
  assert.equal(res.status, "error");
  assert.match(res.reason, /not the demo subscription/);
  assert.deepEqual(h.chain.calls, { head: 0, schedule: 0, tierAmount: 0, submit: 0 });
  assert.equal(h.budget.used(T0), 0);
});

test("junk in the commitment field costs nothing either", async () => {
  const h = harness();
  for (const bad of [undefined, "", "0x", "../../etc/passwd", { toString: () => DEMO }]) {
    const res = await h.handle({ commitment: bad, ip: "1.1.1.1" });
    assert.equal(res.status, "error");
  }
  assert.equal(h.chain.calls.head, 0);
});

// --- not due ----------------------------------------------------------------

test("a not-due period answers with a block and an eta and submits nothing", async () => {
  const h = harness({}, { nextPeriod: 1n }); // next due at START + 2100
  const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.deepEqual(res, { status: "not_due", next_due_block: 13_652_100, eta_minutes: 60 });
  assert.equal(h.chain.calls.submit, 0);
  assert.equal(h.budget.used(T0), 0);
});

test("a not-due answer does not burn the caller's charge cooldown", async () => {
  const h = harness({}, { nextPeriod: 1n });
  await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  h.advance(10);
  h.chain.state.head = START + 2100n; // the period lands
  const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.equal(res.status, "submitted");
});

test("a cancelled or exhausted demo subscription reports why, never submits", async () => {
  for (const [over, pattern] of [
    [{ cancelled: true }, /cancelled/],
    [{ escrow: 0n }, /escrow/],
    [{ nextPeriod: 24n }, /escrow/],
    [{ creatorId: 0n }, /no schedule/],
  ]) {
    const h = harness({}, over);
    const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
    assert.equal(res.status, "error");
    assert.match(res.reason, pattern);
    assert.equal(h.chain.calls.submit, 0);
  }
});

// --- rate limiting ----------------------------------------------------------

test("the same IP is throttled between requests and between charges", async () => {
  const h = harness();
  assert.equal((await h.handle({ commitment: DEMO, ip: "1.1.1.1" })).status, "submitted");

  const immediate = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.deepEqual(immediate, { status: "rate_limited", retry_after_s: 5 });

  h.advance(30); // probe window past, charge window not
  const later = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.equal(later.status, "rate_limited");
  assert.equal(later.retry_after_s, 870);
  assert.equal(h.chain.calls.submit, 1);
});

test("a different IP is not held by someone else's cooldown", async () => {
  const h = harness();
  await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  h.advance(1);
  h.chain.state.head = START + 2100n; // period 1 has landed
  const res = await h.handle({ commitment: DEMO, ip: "2.2.2.2" });
  assert.equal(res.status, "submitted");
  assert.equal(h.chain.calls.submit, 2);
});

// --- budget -----------------------------------------------------------------

test("the daily cap stops the whole endpoint, whoever is asking", async () => {
  const h = harness({ maxPerDay: 2 });
  let ip = 0;
  const press = async () => {
    ip += 1;
    h.advance(10);
    h.chain.state.head += 2100n; // always a fresh due period
    return h.handle({ commitment: DEMO, ip: `10.0.0.${ip}` });
  };
  assert.equal((await press()).status, "submitted");
  assert.equal((await press()).status, "submitted");
  assert.deepEqual(await press(), { status: "budget_exhausted" });
  assert.equal(h.chain.calls.submit, 2);
});

test("the cap lifts at the UTC day boundary", async () => {
  const h = harness({ maxPerDay: 1 });
  assert.equal((await h.handle({ commitment: DEMO, ip: "a" })).status, "submitted");
  h.at(Date.UTC(2026, 7, 29, 23, 59, 59));
  h.chain.state.head += 2100n;
  assert.equal((await h.handle({ commitment: DEMO, ip: "b" })).status, "budget_exhausted");
  h.at(Date.UTC(2026, 7, 30, 0, 0, 1));
  assert.equal((await h.handle({ commitment: DEMO, ip: "c" })).status, "submitted");
});

test("a failed submit refunds the budget slot", async () => {
  const h = harness({ maxPerDay: 1 });
  h.chain.throwOnSubmit = new Error("0x4e535f4e4f545f445545 ('NS_NOT_DUE')");
  const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.equal(res.status, "error");
  assert.match(res.reason, /not due yet/);
  assert.equal(h.budget.remaining(T0), 1);
});

// --- concurrency ------------------------------------------------------------

test("two visitors in the same instant get one transaction and the same hash", async () => {
  const h = harness();
  let release;
  h.chain.beforeSubmit = () => new Promise((r) => (release = r));
  const a = h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  const b = h.handle({ commitment: DEMO, ip: "2.2.2.2" });
  await new Promise((r) => setImmediate(r));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, "submitted");
  assert.equal(rb.status, "submitted");
  assert.equal(ra.tx_hash, rb.tx_hash);
  assert.equal(h.chain.calls.submit, 1);
  assert.equal(h.budget.used(T0), 1, "the joined caller must not spend a second slot");
});

test("a visitor arriving after the submit, before acceptance, gets the same hash", async () => {
  const h = harness();
  const first = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  // The vault has not advanced next_period yet: the chain still reads due.
  h.chain.state.nextPeriod = 0n;
  h.chain.state.escrow += ONE_STRK;
  h.advance(20);
  const second = await h.handle({ commitment: DEMO, ip: "2.2.2.2" });
  assert.deepEqual(second, first);
  assert.equal(h.chain.calls.submit, 1);
});

test("the memo expires so a genuinely stuck period can be retried", async () => {
  const h = harness();
  await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  h.chain.state.nextPeriod = 0n;
  h.chain.state.escrow += ONE_STRK;
  h.advance(400); // past settleWindowS
  const retry = await h.handle({ commitment: DEMO, ip: "2.2.2.2" });
  assert.equal(retry.status, "submitted");
  assert.equal(h.chain.calls.submit, 2);
});

// --- failure hygiene --------------------------------------------------------

test("an RPC failure is one flat sentence, not a stack", async () => {
  const h = harness();
  h.chain.head = async () => {
    const e = new Error("connect ECONNREFUSED 10.0.0.9:9545 at Socket.<anonymous> (net.js:1)");
    e.stack = "Error\n    at internal/whatever.js:1:1";
    throw e;
  };
  const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.deepEqual(res, { status: "error", reason: "the vault state could not be read" });
  assert.equal(h.budget.used(T0), 0);
});

test("no response ever carries an account address or an rpc url", async () => {
  const h = harness();
  const seen = [];
  seen.push(await h.handle({ commitment: DEMO, ip: "1.1.1.1" }));
  seen.push(await h.handle({ commitment: OTHER, ip: "1.1.1.1" }));
  seen.push(await h.handle({ commitment: DEMO, ip: "1.1.1.1" }));
  for (const res of seen) {
    const text = JSON.stringify(res);
    for (const leak of ["nightshift", "acct2", "http://", "rpc", "Private", "0x0000"]) {
      assert.ok(!text.includes(leak), `${leak} leaked in ${text}`);
    }
    assert.ok(["submitted", "not_due", "rate_limited", "budget_exhausted", "error"].includes(res.status));
  }
});

test("a submit that returns no hash is an error, not a fake success", async () => {
  const h = harness();
  h.chain.submitCharge = async () => ({ txHash: "" });
  const res = await h.handle({ commitment: DEMO, ip: "1.1.1.1" });
  assert.equal(res.status, "error");
  assert.equal(h.budget.used(T0), 0);
});
